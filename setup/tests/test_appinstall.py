"""Keep-this-app install/uninstall (per user) and the signed update check (Oct 22 2026)."""
import hashlib
import json
import secrets
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from fpmigrate import appinstall, ed25519, updates  # noqa: E402


class FakeRegistry:
    def __init__(self):
        self.keys = {}

    def set(self, key, values):
        self.keys.setdefault(key, {}).update(values)

    def get(self, key):
        return self.keys.get(key)

    def delete(self, key):
        self.keys.pop(key, None)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.exe = self.tmp / "dl" / "MoveToJellyfin.exe"
        self.exe.parent.mkdir()
        self.exe.write_bytes(b"MZ app " * 1000)
        self.app, self.menu, self.reg = self.tmp / "Programs" / "Orbital", self.tmp / "Start", FakeRegistry()
        self.links = []

    def install(self):
        return appinstall.install(self.exe, self.app, self.menu, self.reg,
                                  make_shortcut=lambda link, target: (self.links.append((link, target)), link.write_text("lnk")))

    def test_install_creates_exactly_three_things_and_reinstall_is_safe(self):
        out = self.install()
        self.assertEqual((self.app / "MoveToJellyfin.exe").read_bytes(), self.exe.read_bytes())
        entry = self.reg.get(appinstall.UNINSTALL_KEY)
        self.assertEqual(entry["DisplayName"], "Orbital for Jellyfin")
        self.assertIn("uninstall-app", entry["UninstallString"])
        self.assertTrue((self.menu / "Orbital for Jellyfin.lnk").exists())
        self.assertEqual(out["version"], entry["DisplayVersion"])
        self.install()  # again: no error, same three things
        self.assertEqual(sorted(p.name for p in self.app.iterdir()), ["MoveToJellyfin.exe"])

    def test_uninstall_removes_only_what_install_added_and_keeps_data_by_default(self):
        self.install()
        data = self.tmp / "data"
        data.mkdir()
        (data / "journal.sqlite").write_text("x")
        other = self.menu / "Something else.lnk"
        other.write_text("keep me")
        out = appinstall.uninstall(self.app, self.menu, self.reg, data_dir=data)
        self.assertEqual(sorted(out["removed"]), ["app", "apps-list entry", "shortcut"])
        self.assertFalse(self.app.exists())
        self.assertIsNone(self.reg.get(appinstall.UNINSTALL_KEY))
        self.assertTrue(other.exists() and (data / "journal.sqlite").exists())
        self.assertTrue(out["keptData"])

    def test_uninstall_can_delete_own_data_when_asked(self):
        self.install()
        data = self.tmp / "data"
        data.mkdir()
        out = appinstall.uninstall(self.app, self.menu, self.reg, data_dir=data, delete_data=True)
        self.assertIn("app data", out["removed"])
        self.assertFalse(data.exists())

    def test_only_the_packaged_exe_can_be_kept(self):
        with self.assertRaises(RuntimeError):
            appinstall.install(self.tmp / "launch.py", self.app, self.menu, self.reg, make_shortcut=lambda *a: None)

    @unittest.skipUnless(sys.platform == "win32", "Windows shell shortcut")
    def test_real_windows_shortcut(self):
        link, real = self.tmp / "t.lnk", self.tmp / "real" / "MoveToJellyfin.exe"
        real.parent.mkdir()
        real.write_bytes(Path(sys.executable).read_bytes())  # the shell reads a real program's metadata
        appinstall._shortcut(link, real)
        self.assertTrue(link.is_file() and link.stat().st_size > 100)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_bytes(32)
        self.keys = {"u1": ed25519.b64(ed25519.public_key(self.secret))}
        self.blob = b"new exe bytes" * 100

    def manifest(self, **over):
        payload = {"product": updates.PRODUCT_ID, "version": "0.2.0", "url": "https://example.invalid/app.exe",
                   "sha256": hashlib.sha256(self.blob).hexdigest(), "size": len(self.blob), "notes": "Sports", **over}
        body = json.dumps(payload).encode()
        return json.dumps({"kid": "u1", "payload": ed25519.b64(body), "sig": ed25519.b64(ed25519.sign(self.secret, body))}).encode()

    def test_off_until_releases_are_published(self):
        self.assertFalse(updates.check(url=None, keys={})["enabled"])

    def test_newer_signed_release_is_offered_and_download_is_hash_checked(self):
        info = updates.check(url="x", keys=self.keys, current="0.1.0", fetch=lambda u: self.manifest())
        self.assertTrue(info["available"])
        path = updates.download(info, Path(tempfile.mkdtemp()), fetch=lambda u: self.blob)
        self.assertEqual(path.read_bytes(), self.blob)
        with self.assertRaises(ValueError):
            updates.download(info, Path(tempfile.mkdtemp()), fetch=lambda u: self.blob + b"x")

    def test_same_or_older_version_not_offered(self):
        self.assertFalse(updates.check(url="x", keys=self.keys, current="0.2.0", fetch=lambda u: self.manifest())["available"])

    def test_forged_or_unsafe_manifests_rejected(self):
        doc = json.loads(self.manifest())
        doc["payload"] = ed25519.b64(json.dumps({"product": updates.PRODUCT_ID, "version": "9.9", "url": "https://evil.invalid",
                                                  "sha256": "0" * 64, "size": 1}).encode())
        for raw in (json.dumps(doc).encode(), self.manifest(url="http://plain.invalid/app.exe"),
                    self.manifest(product="other"), b"{}", b"x" * 70000):
            out = updates.check(url="x", keys=self.keys, current="0.1.0", fetch=lambda u, r=raw: r)
            self.assertFalse(out["available"], raw[:40])


if __name__ == "__main__":
    unittest.main()
