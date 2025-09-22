import os
import json
import io
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
from typing import List, Dict, Any, Optional

# --- Configuration ---
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
CREDENTIALS_FILE = "credentials.json"
TOKEN_FILE = "token.json"
OUTPUT_FILE = "chat_data.json"
# This is a literal folder name and should not be changed unless your folder is named differently.
AI_STUDIO_FOLDER_NAME = "Google AI Studio"

# --- Core Functions ---

def authenticate() -> Optional[Credentials]:
    """
    Handles user authentication via OAuth2.
    Creates or refreshes the token.json file.
    Returns the credentials object.
    """
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:
                print(f"Failed to refresh token: {e}. Please authenticate again.")
                creds = None # Reset to trigger the auth flow
        
        if not creds:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        
        with open(TOKEN_FILE, "w") as token:
            token.write(creds.to_json())
    return creds

def find_aistudio_folder_id(service: Any) -> Optional[str]:
    """Finds and returns the ID of the Google AI Studio folder."""
    query = f"mimeType='application/vnd.google-apps.folder' and name='{AI_STUDIO_FOLDER_NAME}' and trashed=false"
    response = service.files().list(q=query, spaces="drive", fields="files(id)").execute()
    if not response['files']:
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
    print(f"--- Found {len(files)} total files. ---")
    return files

def process_files(service: Any, files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Processes a list of files: downloads content, parses JSON, and builds the initial chat map.
    """
    chat_map = []
    total_files = len(files)
    for i, file_data in enumerate(files):
        file_name = file_data.get("name", "Unknown")
        # \r carriage return and end="" creates a single-line progress indicator.
        print(f"\r--- Processing file {i+1}/{total_files}: {file_name[:50]:<50}", end="")

        mime_type = file_data.get("mimeType", "")

        known_non_chat_types = [
            'application/javascript', 
            'text/css', 
            'text/plain',
            'image/png', 
            'image/jpeg',
            'application/json'
        ]
        if mime_type in known_non_chat_types:
            continue

        try:
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
                    children_info = [{"id": child.get("promptId")} for child in chunk["branchChildren"]]

            chat_map.append({
                "fileName": file_name,
                "fileId": file_data.get("id").replace("prompts/", ""),
                "parent": parent_info,
                "children": children_info,
                "createdDate": file_data.get("createdTime"),
                "modifiedDate": file_data.get("modifiedTime"),
                "description": file_data.get("description")
            })
            
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Silently skip files that are not text or valid JSON.
            continue
        except Exception as e:
            print(f"\n--- An unexpected error occurred while processing file {file_name}: {e}")
    
    print("\n--- File processing complete. ---")
    return chat_map

def sanitize_chat_links(chat_map: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Fixes 'broken' parent links by iterating through the chat map once.
    """
    print("\n--- Checking link integrity... ---")
    chat_map_by_id = {chat['fileId']: chat for chat in chat_map}
    fixed_links_count = 0

    for parent_chat in chat_map:
        if parent_chat['children']:
            for child_info in parent_chat['children']:
                child_id = child_info['id'].replace('prompts/', '')
                if child_id in chat_map_by_id:
                    child_chat_object = chat_map_by_id[child_id]
                    if child_chat_object['parent'] is None:
                        child_chat_object['parent'] = {'id': f"prompts/{parent_chat['fileId']}"}
                        print(f"\n--- Checking link integrity: '{parent_chat['fileName']}' -> '{child_chat_object['fileName']}'")
                        fixed_links_count += 1
    
    print(f"--- Check complete. Fixed links: {fixed_links_count}. ---")
    return chat_map

def save_data(folder_id: str, chat_map: List[Dict[str, Any]], filename: str):
    """Saves the final data structure to a JSON file."""
    output_data = {"folderId": folder_id, "chats": chat_map}
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    print(f"\n\n--- SUCCESS! ---\nChat map ({len(chat_map)} chats) saved to file: {filename}")

# --- Main Execution ---

def main():
    """Main function to run the script."""
    try:
        creds = authenticate()
        if not creds:
            print("Authentication failed. Exiting.")
            return

        service = build("drive", "v3", credentials=creds)
        
        folder_id = find_aistudio_folder_id(service)
        if not folder_id:
            print(f"Folder '{AI_STUDIO_FOLDER_NAME}' not found on your Google Drive.")
            return
        print(f"--- Folder '{AI_STUDIO_FOLDER_NAME}' found. ---")

        all_files = fetch_all_files(service, folder_id)
        raw_chat_map = process_files(service, all_files)
        sanitized_chat_map = sanitize_chat_links(raw_chat_map)
        save_data(folder_id, sanitized_chat_map, OUTPUT_FILE)

    except HttpError as error:
        print(f"\nAn error occurred with the Google Drive API: {error}")
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")

if __name__ == "__main__":
    main()