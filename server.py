import json
import os
import traceback
import threading
import read_chats
from flask import Flask, request, jsonify, send_from_directory

# --- Configuration ---
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024  # Limit request payloads to 2MB

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')

DATA_FILES = {
    'favorites': {'path': os.path.join(BASE_DIR, 'favorites.json'), 'default': []},
    'tags': {'path': os.path.join(BASE_DIR, 'tags.json'), 'default': {}},
    'all_tags': {'path': os.path.join(BASE_DIR, 'all_tags.json'), 'default': []}
}

# --- Helper Functions ---

def read_json_file(filepath, default_value):
    """
    Safely reads a JSON file.
    Returns the default value if the file is not found, is empty, or contains an error.
    """
    try:
        if not os.path.exists(filepath):
            return default_value
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return default_value

def write_json_file(filepath, data):
    """
    Safely and atomically writes data to a JSON file.
    Writes to a temporary file first, then atomically replaces the destination.
    """
    temp_filepath = f"{filepath}.tmp"
    try:
        with open(temp_filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_filepath, filepath)
        return True
    except Exception as e:
        print(f"Error writing to file {filepath}: {e}")
        if os.path.exists(temp_filepath):
            try:
                os.remove(temp_filepath)
            except OSError:
                pass
        return False

# --- Frontend Serving ---

@app.route('/')
def serve_index():
    """Serves the main index.html page."""
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    """Serves static files (CSS, JS, favicon, etc.)."""
    return send_from_directory(STATIC_DIR, path)

@app.route('/chat_data.json')
def serve_chat_data():
    """Serves the generated chat data JSON file."""
    chat_data_path = os.path.join(BASE_DIR, 'chat_data.json')
    if not os.path.exists(chat_data_path):
        return jsonify({"chats": [], "message": "Chat data not found. Please refresh data."}), 404
    return send_from_directory(BASE_DIR, 'chat_data.json')

# --- API Endpoints ---

@app.route('/api/favorites', methods=['GET', 'POST'])
def handle_favorites():
    """Handles reading and writing the favorites data."""
    config = DATA_FILES['favorites']
    if request.method == 'GET':
        data = read_json_file(config['path'], config['default'])
        return jsonify(data)
    if request.method == 'POST':
        if not request.is_json:
            return jsonify({"status": "error", "message": "Expected JSON payload"}), 400
        data = request.get_json(silent=True)
        if not isinstance(data, list) or not all(isinstance(item, str) and 0 < len(item) <= 255 for item in data):
            return jsonify({"status": "error", "message": "Favorites must be a list of non-empty string IDs"}), 400
        if write_json_file(config['path'], data):
            return jsonify({"status": "success"})
        return jsonify({"status": "error", "message": "Failed to save favorites"}), 500

@app.route('/api/tags', methods=['GET', 'POST'])
def handle_tags():
    """Handles reading and writing the chat-to-tag assignments."""
    config = DATA_FILES['tags']
    if request.method == 'GET':
        data = read_json_file(config['path'], config['default'])
        return jsonify(data)
    if request.method == 'POST':
        if not request.is_json:
            return jsonify({"status": "error", "message": "Expected JSON payload"}), 400
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"status": "error", "message": "Tags must be a dictionary mapping chat IDs to lists of tags"}), 400
        for chat_id, tags in data.items():
            if not isinstance(chat_id, str) or not isinstance(tags, list):
                return jsonify({"status": "error", "message": "Invalid tag mapping structure"}), 400
            if not all(isinstance(t, str) and 0 < len(t.strip()) <= 100 for t in tags):
                return jsonify({"status": "error", "message": "Tags must be non-empty strings (max 100 chars)"}), 400
        if write_json_file(config['path'], data):
            return jsonify({"status": "success"})
        return jsonify({"status": "error", "message": "Failed to save tags"}), 500

@app.route('/api/all-tags', methods=['GET', 'POST'])
def handle_all_tags():
    """Handles reading and writing the global list of all available tags."""
    config = DATA_FILES['all_tags']
    if request.method == 'GET':
        data = read_json_file(config['path'], config['default'])
        return jsonify(data)
    if request.method == 'POST':
        if not request.is_json:
            return jsonify({"status": "error", "message": "Expected JSON payload"}), 400
        data = request.get_json(silent=True)
        if not isinstance(data, list) or not all(isinstance(t, str) and 0 < len(t.strip()) <= 100 for t in data):
            return jsonify({"status": "error", "message": "All tags must be a list of non-empty strings (max 100 chars)"}), 400
        if write_json_file(config['path'], data):
            return jsonify({"status": "success"})
        return jsonify({"status": "error", "message": "Failed to save all tags"}), 500

# --- Background Sync Management ---

sync_lock = threading.Lock()
sync_state = {
    "status": "idle",       # "idle", "running", "success", "error"
    "message": "",
    "current": 0,
    "total": 0,
    "error": None
}

def run_sync_task():
    """Executes the Google Drive sync in a background daemon thread."""
    global sync_state
    try:
        def on_progress(current, total, msg):
            with sync_lock:
                sync_state["current"] = current
                sync_state["total"] = total
                sync_state["message"] = msg

        print("--- Background sync task started. ---")
        read_chats.main(interactive=False, progress_callback=on_progress)
        print("--- Background sync task finished successfully. ---")
        with sync_lock:
            sync_state["status"] = "success"
            sync_state["message"] = "Data updated successfully"
            sync_state["error"] = None
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"--- ERROR during background data refresh: {e} ---")
        print(error_details)
        with sync_lock:
            sync_state["status"] = "error"
            sync_state["message"] = str(e) or "An error occurred while fetching data from Google Drive."
            sync_state["error"] = error_details

@app.route('/api/refresh-data', methods=['POST'])
def handle_refresh():
    """Runs the read_chats.py script in the background to refresh data from Google Drive."""
    global sync_state
    with sync_lock:
        if sync_state["status"] == "running":
            return jsonify({
                "status": "running",
                "message": "Sync is already in progress.",
                "current": sync_state["current"],
                "total": sync_state["total"]
            }), 200

        sync_state = {
            "status": "running",
            "message": "Connecting to Google Drive...",
            "current": 0,
            "total": 0,
            "error": None
        }

    thread = threading.Thread(target=run_sync_task, daemon=True)
    thread.start()
    return jsonify({"status": "started", "message": "Data refresh started in background"}), 202

@app.route('/api/refresh-status', methods=['GET'])
def handle_refresh_status():
    """Returns the current background sync status and progress."""
    with sync_lock:
        return jsonify(sync_state)

if __name__ == '__main__':
    host = os.environ.get('FLASK_RUN_HOST', '127.0.0.1')
    port = int(os.environ.get('FLASK_RUN_PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1')
    print(f"Server is running! Open http://{host}:{port} in your browser.")
    app.run(host=host, port=port, debug=debug)