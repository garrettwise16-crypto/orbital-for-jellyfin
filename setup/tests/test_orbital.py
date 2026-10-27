import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from fpmigrate import orbital

STOCK = ('<!doctype html><html dir="ltr"><head><meta charset="utf-8"><title>Jellyfin</title><style>.x{}</style>'
         '<script defer="defer" src="runtime.bundle.js?a"></script><script defer="defer" src="main.jellyfin.bundle.js?a">'
         '</script><link href="main.jellyfin.css?a" rel="stylesheet"></head><body dir="ltr"><div id="reactRoot"></div>'
         '</body></html>')


class OrbitalLayer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.web = Path(self.tmp.name) / "jellyfin-web"
        self.web.mkdir()
        (self.web / "index.html").write_text(STOCK, encoding="utf-8")
        (self.web / "main.jellyfin.bundle.js").write_text("// stock", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_manifest_is_clean_and_complete(self):
        m = orbital.manifest()
        for entry in m["files"].values():
            data = (orbital.layer_dir() / entry["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
        blob = b"".join((orbital.layer_dir() / e["file"]).read_bytes() for e in m["files"].values())
        for household in (b"private-user-example", b"private.example.invalid", b"203.0.113.10",
                          b"327c6584b367533841ce2b8d23e876734569a4a0fcac7031213e26cf494c66ff"):
            self.assertNotIn(household, blob)
        self.assertTrue(orbital.supported("12.0.0"))
        self.assertFalse(orbital.supported("10.11.11"))

    def test_install_status_reinstall_remove_exact(self):
        self.assertEqual(orbital.find_webdir(str(self.web)), self.web)
        st = orbital.install(self.web)
        self.assertTrue(st["installed"])
        index = (self.web / "index.html").read_text(encoding="utf-8")
        early = index.index(orbital.START_HEAD)
        self.assertLess(early, index.index("runtime.bundle.js"))  # adapter loads before Jellyfin's scripts
        self.assertLess(index.index(orbital.START_TAIL), index.index("</head>"))
        for entry in orbital.manifest()["files"].values():
            self.assertTrue((self.web / "orbital" / entry["file"]).exists())
        orbital.install(self.web)  # idempotent: exactly one copy of each block
        index = (self.web / "index.html").read_text(encoding="utf-8")
        self.assertEqual(index.count(orbital.START_HEAD), 1)
        self.assertEqual(index.count(orbital.START_TAIL), 1)
        r = orbital.remove(self.web)
        self.assertEqual((self.web / "index.html").read_text(encoding="utf-8"), STOCK)
        self.assertFalse((self.web / "orbital").exists())
        self.assertTrue(r["indexRestored"])
        self.assertEqual((self.web / "main.jellyfin.bundle.js").read_text(encoding="utf-8"), "// stock")

    def test_jellyfin_update_detected_and_reapply(self):
        orbital.install(self.web)
        (self.web / "index.html").write_text(STOCK.replace("?a", "?b"), encoding="utf-8")  # update overwrote it
        st = orbital.status(self.web)
        self.assertTrue(st["needsReapply"])
        self.assertFalse(st["installed"])
        orbital.install(self.web)
        self.assertTrue(orbital.status(self.web)["installed"])
        orbital.remove(self.web)
        self.assertEqual((self.web / "index.html").read_text(encoding="utf-8"), STOCK.replace("?a", "?b"))

    def test_refuses_foreign_folder_and_keeps_unknown_files(self):
        (self.web / "orbital").mkdir()
        (self.web / "orbital" / "theirs.css").write_text("x", encoding="utf-8")
        with self.assertRaises(RuntimeError):
            orbital.install(self.web)
        self.assertEqual((self.web / "index.html").read_text(encoding="utf-8"), STOCK)
        (self.web / "orbital" / "theirs.css").unlink()
        (self.web / "orbital").rmdir()
        orbital.install(self.web)
        (self.web / "orbital" / "mine-later.txt").write_text("user file", encoding="utf-8")
        orbital.remove(self.web)
        self.assertTrue((self.web / "orbital" / "mine-later.txt").exists())  # never deletes what it didn't add

    def test_remove_after_other_edits_keeps_them(self):
        orbital.install(self.web)
        index = (self.web / "index.html").read_text(encoding="utf-8")
        (self.web / "index.html").write_text(index.replace("<title>Jellyfin</title>", "<title>Home</title>"),
                                             encoding="utf-8")
        orbital.remove(self.web)
        self.assertEqual((self.web / "index.html").read_text(encoding="utf-8"),
                         STOCK.replace("<title>Jellyfin</title>", "<title>Home</title>"))

    def test_rejects_non_jellyfin_index(self):
        (self.web / "index.html").write_text("<html><body>some other app</body></html>", encoding="utf-8")
        self.assertIsNone(orbital.find_webdir(str(self.web)))
        with self.assertRaises(RuntimeError):
            orbital.install(self.web)


class EngineIntegration(unittest.TestCase):
    def test_engine_installs_journals_and_undo_removes(self):
        from fpmigrate.engine import Engine
        from tests.fakes import FakeJellyfin
        with tempfile.TemporaryDirectory() as tmp:
            web = Path(tmp) / "jellyfin-web"
            web.mkdir()
            (web / "index.html").write_text(STOCK, encoding="utf-8")
            jf = FakeJellyfin({})
            e = Engine(Path(tmp) / "data")
            try:
                self.assertFalse(e.orbital_status()["available"])  # needs Jellyfin first
                e.connect_jellyfin(jf.url, "admin", "pw")
                e.orbital_webdir_hint = None
                e.orbital_webdir_hint = str(web)
                st = e.orbital_status()
                self.assertTrue(st["available"])
                e.install_orbital()
                e.install_orbital()  # second run: still one journal entry
                self.assertEqual([o["kind"] for o in e.journal.owned()], ["orbital"])
                self.assertTrue(orbital.status(web)["installed"])
                e.remove_owned()
                self.assertEqual((web / "index.html").read_text(encoding="utf-8"), STOCK)
                e.orbital_webdir_hint = str(Path(tmp) / "missing")
                self.assertIn("weren't found", e.orbital_status()["reason"])
            finally:
                e.journal.close()
                jf.close()


if __name__ == "__main__":
    unittest.main()
