import os
import json
import io
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
from typing import List, Dict, Any, Optional, Callable

# --- Configuration ---
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
CREDENTIALS_FILE = "credentials.json"
TOKEN_FILE = "token.json"
OUTPUT_FILE = "chat_data.json"
# This is a literal folder name and should not be changed unless your folder is named differently.
AI_STUDIO_FOLDER_NAME = "Google AI Studio"
MAX_WORKERS = 6

# Thread-local storage for Drive API services to ensure thread safety
_thread_local = threading.local()

def get_thread_drive_service(creds: Credentials) -> Any:
    """Returns a thread-local instance of the Google Drive service."""
    if not hasattr(_thread_local, "service"):
        _thread_local.service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _thread_local.service

# --- Core Functions ---

def authenticate(interactive: bool = True) -> Optional[Credentials]:
    """
    Handles user authentication via OAuth2.
    Creates or refreshes the token.json file.
    Returns the credentials object.
    """
    if not os.path.exists(CREDENTIALS_FILE):
        raise FileNotFoundError(
            f"'{CREDENTIALS_FILE}' not found. Download OAuth credentials from Google Cloud Console."
        )

    creds = None
    if os.path.exists(TOKEN_FILE):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
        except Exception as e:
            print(f"Failed to read token file: {e}")
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:
                print(f"Failed to refresh token: {e}. Please authenticate again.")
                creds = None

        if not creds:
            if not interactive:
                raise RuntimeError(
                    f"'{TOKEN_FILE}' not found or expired. Run 'python read_chats.py' in terminal to authenticate."
                )

            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "w", encoding="utf-8") as token:
            token.write(creds.to_json())
    return creds

def find_aistudio_folder_id(service: Any) -> Optional[str]:
    """Finds and returns the ID of the Google AI Studio folder."""
    query = f"mimeType='application/vnd.google-apps.folder' and name='{AI_STUDIO_FOLDER_NAME}' and trashed=false"
    response = service.files().list(q=query, spaces="drive", fields="files(id)").execute()
    if not response.get('files'):
        return None
    return response['files'][0]['id']

def fetch_all_files(service: Any, folder_id: str) -> List[Dict[str, Any]]:
    """Retrieves a list of all files from the specified folder, handling pagination."""
    files = []
    page_token = None
    query = f"'{folder_id}' in parents and trashed=false"

    print("--- Fetching file list from Google Drive... ---")
    while True:
        response = service.files().list(
            q=query, spaces='drive', pageSize=1000,
            fields="nextPageToken, files(id, name, description, createdTime, modifiedTime, mimeType)",
            pageToken=page_token
        ).execute()
        files.extend(response.get('files', []))
        page_token = response.get('nextPageToken', None)
        if page_token is None:
            break
    print(f"--- Found {len(files)} total files in folder. ---")
    return files

def load_existing_cache(filename: str) -> Dict[str, Dict[str, Any]]:
    """Loads previously saved chat data from the local cache file."""
    if not os.path.exists(filename):
        return {}
    try:
        with open(filename, "r", encoding="utf-8") as f:
            data = json.load(f)
            chats = data.get("chats", [])
            cache = {chat["fileId"]: chat for chat in chats if "fileId" in chat}
            print(f"--- Loaded {len(cache)} chats from cache. ---")
            return cache
    except Exception as e:
        print(f"--- Warning: Failed to load cache ({e}). Starting fresh. ---")
        return {}

def download_and_parse_single_file(creds: Credentials, file_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Downloads content, parses JSON, and extracts chat metadata."""
    file_id = file_data.get("id", "").replace("prompts/", "")
    file_name = file_data.get("name", "Unknown")

    try:
        service = get_thread_drive_service(creds)
        request = service.files().get_media(fileId=file_data.get("id"))
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        file_content = fh.getvalue().decode('utf-8')
        data = json.loads(file_content)

        parent_info = None
        children_info = []
        chunks = data.get("chunkedPrompt", {}).get("chunks", [])
        for chunk in chunks:
            if chunk.get("branchParent"):
                parent_info = {"id": chunk["branchParent"].get("promptId")}
            if chunk.get("branchChildren"):
                children_info.extend([{"id": child.get("promptId")} for child in chunk["branchChildren"]])

        return {
            "fileName": file_name,
            "fileId": file_id,
            "parent": parent_info,
            "children": children_info,
            "createdDate": file_data.get("createdTime"),
            "modifiedDate": file_data.get("modifiedTime"),
            "description": file_data.get("description")
        }

    except (json.JSONDecodeError, UnicodeDecodeError):
        # Silently skip files that are not valid JSON
        return None
    except Exception as e:
        print(f"\n--- Error processing file {file_name}: {e}")
        return None

def process_files(
    creds: Credentials,
    files: List[Dict[str, Any]],
    existing_cache: Dict[str, Dict[str, Any]],
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> List[Dict[str, Any]]:
    """Processes files incrementally and downloads new or modified chats in parallel."""
    known_non_chat_types = {
        'application/javascript',
        'text/css',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'video/mp4',
        'audio/mpeg',
        'application/pdf',
        'application/zip'
    }

    files_to_download: List[Dict[str, Any]] = []
    chat_map: List[Dict[str, Any]] = []
    cached_count = 0

    for file_data in files:
        mime_type = file_data.get("mimeType", "")
        if mime_type in known_non_chat_types:
            continue

        raw_id = file_data.get("id", "")
        file_id = raw_id.replace("prompts/", "")
        modified_time = file_data.get("modifiedTime")

        if file_id in existing_cache:
            cached_chat = existing_cache[file_id]
            if cached_chat.get("modifiedDate") == modified_time:
                cached_chat["fileName"] = file_data.get("name", cached_chat.get("fileName"))
                cached_chat["description"] = file_data.get("description", cached_chat.get("description"))
                chat_map.append(cached_chat)
                cached_count += 1
                continue

        files_to_download.append(file_data)

    total_needed = len(files_to_download)
    total_all = len(files)
    print(f"--- Cache hit: {cached_count} chats up to date. Need to download: {total_needed} files. ---")

    if progress_callback:
        progress_callback(cached_count, total_all, f"Found {cached_count} cached chats. Downloading {total_needed} updated...")

    if files_to_download:
        completed_downloads = 0
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_file = {
                executor.submit(download_and_parse_single_file, creds, f): f
                for f in files_to_download
            }
            for future in as_completed(future_to_file):
                completed_downloads += 1
                result = future.result()
                if result:
                    chat_map.append(result)

                msg = f"Downloaded {completed_downloads}/{total_needed} files"
                print(f"\r--- {msg} ---", end="")
                if progress_callback:
                    progress_callback(cached_count + completed_downloads, total_all, msg)

        print("\n--- File downloading complete. ---")
    else:
        print("--- All files are up to date in cache. ---")

    return chat_map

def sanitize_chat_links(chat_map: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Fixes 'broken' parent links by iterating through the chat map once.
    """
    print("\n--- Checking link integrity... ---")
    chat_map_by_id = {chat['fileId']: chat for chat in chat_map}
    fixed_links_count = 0

    for parent_chat in chat_map:
        if parent_chat.get('children'):
            for child_info in parent_chat['children']:
                child_id = child_info['id'].replace('prompts/', '')
                if child_id in chat_map_by_id:
                    child_chat_object = chat_map_by_id[child_id]
                    if child_chat_object.get('parent') is None:
                        child_chat_object['parent'] = {'id': f"prompts/{parent_chat['fileId']}"}
                        fixed_links_count += 1

    print(f"--- Check complete. Fixed links: {fixed_links_count}. ---")
    return chat_map

def save_data(folder_id: str, chat_map: List[Dict[str, Any]], filename: str):
    """Saves the final data structure to a JSON file."""
    output_data = {"folderId": folder_id, "chats": chat_map}
    temp_filename = f"{filename}.tmp"
    try:
        with open(temp_filename, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_filename, filename)
        print(f"\n\n--- SUCCESS! ---\nChat map ({len(chat_map)} chats) saved to file: {filename}")
    except Exception as e:
        print(f"--- Error saving data to {filename}: {e}")
        if os.path.exists(temp_filename):
            try:
                os.remove(temp_filename)
            except OSError:
                pass
        raise

# --- Main Execution ---

def main(interactive: bool = True, progress_callback: Optional[Callable[[int, int, str], None]] = None):
    """Main function to run the sync script."""
    try:
        creds = authenticate(interactive=interactive)
        if not creds:
            print("Authentication failed. Exiting.")
            raise RuntimeError("Authentication failed")

        service = build("drive", "v3", credentials=creds, cache_discovery=False)

        folder_id = find_aistudio_folder_id(service)
        if not folder_id:
            print(f"Folder '{AI_STUDIO_FOLDER_NAME}' not found on your Google Drive.")
            raise FileNotFoundError(f"Folder '{AI_STUDIO_FOLDER_NAME}' not found on Google Drive.")
        print(f"--- Folder '{AI_STUDIO_FOLDER_NAME}' found (ID: {folder_id}). ---")

        existing_cache = load_existing_cache(OUTPUT_FILE)
        all_files = fetch_all_files(service, folder_id)

        raw_chat_map = process_files(creds, all_files, existing_cache, progress_callback)
        sanitized_chat_map = sanitize_chat_links(raw_chat_map)
        save_data(folder_id, sanitized_chat_map, OUTPUT_FILE)

        if progress_callback:
            progress_callback(len(all_files), len(all_files), f"Successfully synced {len(sanitized_chat_map)} chats.")

    except HttpError as error:
        print(f"\nAn error occurred with the Google Drive API: {error}")
        raise
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")
        raise

if __name__ == "__main__":
    main()