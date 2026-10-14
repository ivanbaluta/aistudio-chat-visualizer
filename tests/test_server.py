import os
import sys
import copy
import json
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import server


class TestServerEndpoints(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.orig_data_files = copy.deepcopy(server.DATA_FILES)

        self.fav_path = os.path.join(self.test_dir.name, "favorites.json")
        self.tags_path = os.path.join(self.test_dir.name, "tags.json")
        self.all_tags_path = os.path.join(self.test_dir.name, "all_tags.json")

        with open(self.fav_path, "w", encoding="utf-8") as f:
            json.dump(["fav1"], f)
        with open(self.tags_path, "w", encoding="utf-8") as f:
            json.dump({"fav1": ["Work"]}, f)
        with open(self.all_tags_path, "w", encoding="utf-8") as f:
            json.dump(["Work", "Personal"], f)

        server.DATA_FILES['favorites']['path'] = self.fav_path
        server.DATA_FILES['tags']['path'] = self.tags_path
        server.DATA_FILES['all_tags']['path'] = self.all_tags_path

        server.app.config['TESTING'] = True
        self.client = server.app.test_client()

    def tearDown(self):
        server.DATA_FILES = self.orig_data_files
        self.test_dir.cleanup()

    def test_serve_index(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"AI Studio Chat Visualizer", response.data)
        response.close()

    def test_get_favorites(self):
        response = self.client.get('/api/favorites')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), ["fav1"])

    def test_post_favorites_valid(self):
        response = self.client.post('/api/favorites', json=["chat1", "chat2"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "success"})

        with open(self.fav_path, encoding="utf-8") as f:
            self.assertEqual(json.load(f), ["chat1", "chat2"])

    def test_post_favorites_rejects_non_json(self):
        response = self.client.post('/api/favorites', data="plain text")
        self.assertEqual(response.status_code, 400)

    def test_post_favorites_rejects_non_list(self):
        response = self.client.post('/api/favorites', json={"not": "a list"})
        self.assertEqual(response.status_code, 400)

    def test_post_favorites_rejects_empty_id(self):
        response = self.client.post('/api/favorites', json=[""])
        self.assertEqual(response.status_code, 400)

    def test_get_tags(self):
        response = self.client.get('/api/tags')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"fav1": ["Work"]})

    def test_post_tags_valid(self):
        response = self.client.post('/api/tags', json={"chat1": ["tagA", "tagB"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "success"})

        with open(self.tags_path, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"chat1": ["tagA", "tagB"]})

    def test_post_tags_rejects_non_dict(self):
        response = self.client.post('/api/tags', json=["not", "a", "dict"])
        self.assertEqual(response.status_code, 400)

    def test_post_tags_rejects_empty_tag(self):
        response = self.client.post('/api/tags', json={"chat1": [""]})
        self.assertEqual(response.status_code, 400)

    def test_get_all_tags(self):
        response = self.client.get('/api/all-tags')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), ["Work", "Personal"])

    def test_post_all_tags_valid(self):
        response = self.client.post('/api/all-tags', json=["Alpha", "Beta"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "success"})

        with open(self.all_tags_path, encoding="utf-8") as f:
            self.assertEqual(json.load(f), ["Alpha", "Beta"])

    def test_post_all_tags_rejects_non_list(self):
        response = self.client.post('/api/all-tags', json="not a list")
        self.assertEqual(response.status_code, 400)

    def test_refresh_status(self):
        response = self.client.get('/api/refresh-status')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("status", data)
        self.assertIn("message", data)


if __name__ == "__main__":
    unittest.main()
