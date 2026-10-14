import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from read_chats import cleanup_orphaned_data


class TestCleanupOrphanedData(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.fav_file = os.path.join(self.test_dir.name, "favorites.json")
        self.tags_file = os.path.join(self.test_dir.name, "tags.json")

    def tearDown(self):
        self.test_dir.cleanup()

    def test_cleanup_removes_orphaned_favorites(self):
        with open(self.fav_file, "w", encoding="utf-8") as f:
            json.dump(["chat1", "orphan_fav", "chat2"], f)

        chat_map = [{"fileId": "chat1"}, {"fileId": "chat2"}]
        stats = cleanup_orphaned_data(chat_map, favorites_file=self.fav_file, tags_file=self.tags_file)

        self.assertEqual(stats["removed_favorites"], 1)
        self.assertEqual(stats["removed_favorite_ids"], ["orphan_fav"])

        with open(self.fav_file, encoding="utf-8") as f:
            updated = json.load(f)
        self.assertEqual(updated, ["chat1", "chat2"])

    def test_cleanup_removes_orphaned_tags(self):
        with open(self.tags_file, "w", encoding="utf-8") as f:
            json.dump({
                "chat1": ["tagA"],
                "orphan_chat": ["tagB"],
                "chat2": ["tagC", "tagD"]
            }, f)

        chat_map = [{"fileId": "chat1"}, {"fileId": "chat2"}]
        stats = cleanup_orphaned_data(chat_map, favorites_file=self.fav_file, tags_file=self.tags_file)

        self.assertEqual(stats["removed_tags"], 1)
        self.assertEqual(stats["removed_tag_ids"], ["orphan_chat"])

        with open(self.tags_file, encoding="utf-8") as f:
            updated = json.load(f)
        self.assertEqual(updated, {
            "chat1": ["tagA"],
            "chat2": ["tagC", "tagD"]
        })

    def test_cleanup_preserves_when_all_valid(self):
        with open(self.fav_file, "w", encoding="utf-8") as f:
            json.dump(["chat1"], f)
        with open(self.tags_file, "w", encoding="utf-8") as f:
            json.dump({"chat1": ["tagA"]}, f)

        chat_map = [{"fileId": "chat1"}, {"fileId": "chat2"}]
        stats = cleanup_orphaned_data(chat_map, favorites_file=self.fav_file, tags_file=self.tags_file)

        self.assertEqual(stats["removed_favorites"], 0)
        self.assertEqual(stats["removed_tags"], 0)

        with open(self.fav_file, encoding="utf-8") as f:
            self.assertEqual(json.load(f), ["chat1"])
        with open(self.tags_file, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"chat1": ["tagA"]})

    def test_cleanup_guard_against_empty_chat_map(self):
        with open(self.fav_file, "w", encoding="utf-8") as f:
            json.dump(["chat1", "chat2"], f)
        with open(self.tags_file, "w", encoding="utf-8") as f:
            json.dump({"chat1": ["tagA"]}, f)

        stats = cleanup_orphaned_data([], favorites_file=self.fav_file, tags_file=self.tags_file)
        self.assertEqual(stats["removed_favorites"], 0)
        self.assertEqual(stats["removed_tags"], 0)

        with open(self.fav_file, encoding="utf-8") as f:
            self.assertEqual(json.load(f), ["chat1", "chat2"])
        with open(self.tags_file, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"chat1": ["tagA"]})

    def test_cleanup_handles_missing_files(self):
        chat_map = [{"fileId": "chat1"}]
        stats = cleanup_orphaned_data(
            chat_map,
            favorites_file=os.path.join(self.test_dir.name, "nonexistent_favs.json"),
            tags_file=os.path.join(self.test_dir.name, "nonexistent_tags.json")
        )
        self.assertEqual(stats["removed_favorites"], 0)
        self.assertEqual(stats["removed_tags"], 0)

    def test_cleanup_handles_corrupted_json(self):
        with open(self.fav_file, "w", encoding="utf-8") as f:
            f.write("{invalid json syntax")

        chat_map = [{"fileId": "chat1"}]
        stats = cleanup_orphaned_data(chat_map, favorites_file=self.fav_file, tags_file=self.tags_file)
        self.assertEqual(stats["removed_favorites"], 0)

        with open(self.fav_file, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{invalid json syntax")


if __name__ == "__main__":
    unittest.main()
