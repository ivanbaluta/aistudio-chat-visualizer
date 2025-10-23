import json
import os
from flask import Flask, request, jsonify, send_from_directory

# --- Configuration ---
app = Flask(__name__)
DATA_FILES = {
    'favorites': {'path': 'favorites.json', 'default': []},
    'tags': {'path': 'tags.json', 'default': {}},
    'all_tags': {'path': 'all_tags.json', 'default': []}
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
    Safely writes data to a JSON file.
    Returns True on success, False on error.
    """
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        return True
    except Exception as e:
        print(f"Error writing to file {filepath}: {e}")
        return False

# --- Frontend Serving ---

@app.route('/')
def serve_index():
    """Serves the main index.html page."""
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    """Serves static files (CSS, JS, favicon, etc.)."""
    return send_from_directory('.', path)

# --- API Endpoints ---

@app.route('/api/favorites', methods=['GET', 'POST'])
def handle_favorites():
    """Handles reading and writing the favorites data."""
    config = DATA_FILES['favorites']
    if request.method == 'GET':
        data = read_json_file(config['path'], config['default'])
        return jsonify(data)
    if request.method == 'POST':
        if write_json_file(config['path'], request.json):
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
        if write_json_file(config['path'], request.json):
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
        if write_json_file(config['path'], request.json):
            return jsonify({"status": "success"})
        return jsonify({"status": "error", "message": "Failed to save all tags"}), 500


if __name__ == '__main__':
    print("Server is running! Open http://127.0.0.1:5000 in your browser.")
    app.run(host='0.0.0.0', port=5000, debug=True)