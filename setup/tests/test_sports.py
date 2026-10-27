"""Sports step (Oct 22 2026): plugin packaging and install/remove through Jellyfin's plugin API, plus the customer
sports service's own boundaries (bridge secret, Jellyfin sign-in, edition limits, channel pairing). Offline: no ESPN."""
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from fpmigrate import sports  # noqa: E402
from fpmigrate.jellyfin import Jellyfin  # noqa: E402
from fpmigrate.netio import HttpError  # noqa: E402

APP = HERE.parent / "sports_service" / "app"


def fake_bundle(tmp: Path) -> Path:
    root = tmp / "sports_plugin"
    (root / "service").mkdir(parents=True)
    (root / "Orbital.Sports.dll").write_bytes(b"MZ fake plugin")
    (root / "service" / "OrbitalSports.exe").write_bytes(b"MZ fake service")
    (root / "service" / "python312.dll").write_bytes(b"MZ not a .NET assembly")
    (root / "bundle.json").write_text(json.dumps({"version": "1.0.0.0", "changelog": "test", "files": {
        "Orbital.Sports.dll": {}, "service/OrbitalSports.exe": {}, "service/python312.dll": {}}}))
    return root


class FakeJellyfin:
    """Just enough of Jellyfin 12's plugin, repository and restart API, with its real install behaviour:
    fetch the manifest, download the zip, check the MD5, then require a restart before the plugin is active."""

    def __init__(self, fail_install=False, malfunction=False, windows_lock=False):
        self.windows_lock, self.lock_released = windows_lock, False
        self.repos = [{"Name": "Jellyfin Stable", "Url": "https://repo.jellyfin.org/files/plugin/manifest.json", "Enabled": True}]
        self.plugins, self.pending, self.calls = [], None, []
        self.fail_install, self.malfunction, self.restarts = fail_install, malfunction, 0
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def send(self, code, body=None):
                raw = json.dumps(body).encode() if body is not None else b""
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n)) if n else None

            def do_GET(self):
                outer.calls.append(("GET", self.path))
                if self.path.startswith("/System/Info/Public"):
                    return self.send(200, {"Version": "12.0.0", "Id": "x"})
                if self.path.startswith("/Repositories"):
                    return self.send(200, outer.repos)
                if self.path.startswith("/Plugins"):
                    return self.send(200, outer.plugins)
                if self.path.startswith("/Orbital/Sports/Status"):
                    return self.send(200, {"mode": "bundled", "ready": True}) if outer.plugins else self.send(404)
                return self.send(404)

            def do_POST(self):
                outer.calls.append(("POST", self.path))
                b = self.body()
                if self.path == "/Repositories":
                    outer.repos = b
                    return self.send(204)
                if self.path.startswith("/Packages/Installed/"):
                    if outer.fail_install:
                        return self.send(500)
                    url = next(r["Url"] for r in outer.repos if "Orbital" in r["Name"])
                    man = json.loads(urllib.request.urlopen(url).read())
                    ver = man[0]["versions"][0]
                    data = urllib.request.urlopen(ver["sourceUrl"]).read()
                    assert hashlib.md5(data).hexdigest() == ver["checksum"]
                    outer.pending = zipfile.ZipFile(io.BytesIO(data))
                    return self.send(204)
                if self.path == "/System/Restart":
                    outer.restarts += 1
                    if outer.pending == "remove":
                        if outer.windows_lock and not outer.lock_released:
                            # DLL still loaded by this process: Jellyfin regenerates a default, Active manifest
                            outer.plugins = [{**outer.plugins[0], "Status": "Active"}]
                            outer.lock_released = True
                        else:
                            outer.plugins = []
                        outer.pending = None
                    elif outer.pending is not None:
                        meta = json.loads(outer.pending.read("meta.json"))
                        status = "Malfunctioned" if outer.malfunction else "Active"
                        outer.plugins = [{"Id": meta["guid"], "Name": meta["name"], "Version": meta["version"], "Status": status}]
                        outer.pending = None
                    return self.send(204)
                if self.path.endswith("/Disable"):
                    for p in outer.plugins:
                        p["Status"] = "Disabled"
                    outer.loaded_disabled = True
                    return self.send(204)
                if self.path.startswith("/Plugins/") and self.path.endswith("/Configuration"):
                    outer.config = b
                    return self.send(204)
                return self.send(404)

            def do_DELETE(self):
                outer.calls.append(("DELETE", self.path))
                outer.uninstalled = True
                outer.pending = "remove"
                return self.send(204)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class PluginInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        root = fake_bundle(self.tmp)
        self.patch = mock.patch.object(sports, "bundle_dir", lambda: root)
        self.patch.start()
        self.sleep = mock.patch.object(sports.time, "sleep", lambda s: None)
        self.sleep.start()
        self.down = mock.patch.object(sports, "RESTART_DOWN_WAIT_S", 0)
        self.down.start()

    def tearDown(self):
        self.patch.stop()
        self.sleep.stop()
        self.down.stop()

    def test_package_limits_loaded_assemblies_and_carries_checksum(self):
        data, md5, info = sports.package()
        self.assertEqual(md5, hashlib.md5(data).hexdigest())
        z = zipfile.ZipFile(io.BytesIO(data))
        meta = json.loads(z.read("meta.json"))
        # Jellyfin would otherwise try to load the bundled runtime's DLLs and disable the plugin.
        self.assertEqual(meta["assemblies"], ["Orbital.Sports.dll"])
        self.assertFalse(meta["autoUpdate"])
        self.assertIn("service/OrbitalSports.exe", z.namelist())
        self.assertEqual(sports.package()[1], md5, "package must be reproducible")

    def test_install_restores_repositories_restarts_and_confirms(self):
        jf = FakeJellyfin()
        try:
            before = json.loads(json.dumps(jf.repos))
            out = sports.install(Jellyfin(jf.url, token="t"))
            self.assertTrue(out["installed"] and out["changed"])
            self.assertEqual(jf.repos, before, "Jellyfin's repository list must be left exactly as it was")
            self.assertEqual(jf.restarts, 1)
            self.assertTrue(out["service"]["ready"])
            again = sports.install(Jellyfin(jf.url, token="t"))
            self.assertFalse(again["changed"], "re-running is a no-op")
            self.assertEqual(jf.restarts, 1)
        finally:
            jf.close()

    def test_failed_install_still_restores_repositories(self):
        jf = FakeJellyfin(fail_install=True)
        try:
            before = json.loads(json.dumps(jf.repos))
            with self.assertRaises(HttpError):
                sports.install(Jellyfin(jf.url, token="t"))
            self.assertEqual(jf.repos, before)
            self.assertEqual(jf.restarts, 0)
        finally:
            jf.close()

    def test_malfunctioned_plugin_is_reported_not_hidden(self):
        jf = FakeJellyfin(malfunction=True)
        try:
            with self.assertRaisesRegex(RuntimeError, "Malfunctioned"):
                sports.install(Jellyfin(jf.url, token="t"))
        finally:
            jf.close()

    def test_remove_disables_then_deletes(self):
        jf = FakeJellyfin()
        try:
            sports.install(Jellyfin(jf.url, token="t"))
            out = sports.remove(Jellyfin(jf.url, token="t"))
            self.assertTrue(out["removed"] and out["off"])
            disable = jf.calls.index(("POST", f"/Plugins/{sports.PLUGIN_ID}/1.0.0.0/Disable"))
            self.assertLess(disable, jf.calls.index(("DELETE", f"/Plugins/{sports.PLUGIN_ID}/1.0.0.0")))
            self.assertEqual(jf.restarts, 3)  # install, disable, delete
        finally:
            jf.close()

    def test_windows_locked_plugin_is_left_off_and_finished_on_a_later_run(self):
        jf = FakeJellyfin(windows_lock=True)
        try:
            sports.install(Jellyfin(jf.url, token="t"))
            first = sports.remove(Jellyfin(jf.url, token="t"))
            self.assertFalse(first["removed"])
            self.assertTrue(first["off"])
            self.assertEqual(jf.plugins[0]["Status"], "Disabled", "a regenerated manifest must not leave sports running")
            second = sports.remove(Jellyfin(jf.url, token="t"))  # next run, after Jellyfin started fresh
            self.assertTrue(second["removed"])
            self.assertEqual(jf.plugins, [])
        finally:
            jf.close()


class FakeAuthJellyfin:
    """/Users/Me and /LiveTv/Channels as fresh Jellyfin 12 answers them: the legacy X-Emby-Token header is refused."""

    def __init__(self, channels):
        outer = self
        self.seen = []

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                auth = self.headers.get("Authorization") or ""
                outer.seen.append(("legacy" if self.headers.get("X-Emby-Token") else "modern", self.path.split("?")[0]))
                ok = 'Token="good"' in auth
                if not ok:
                    self.send_response(401)
                    self.end_headers()
                    return
                body = {"Id": "u1", "Policy": {"EnableLiveTvAccess": True}} if self.path.startswith("/Users/Me") else \
                    {"Items": channels, "TotalRecordCount": len(channels)}
                raw = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@unittest.skipUnless((APP / "espn_core.py").is_file(), "build work/sports_service first")
class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jf = FakeAuthJellyfin([{"Id": "c-espn", "Name": "ESPN HD"}, {"Id": "c-espnu", "Name": "206 ESPNU"},
                                   {"Id": "c-wfld", "Name": "WFLD"}])
        os.environ.update(JELLYFIN_URL=cls.jf.url, ORBITAL_BRIDGE_SECRET="s3cret", SPORTS_DATA_DIR=tempfile.mkdtemp())
        sys.path.insert(0, str(APP))
        import service  # noqa: E402
        service.JELLYFIN = service.core.JELLYFIN = cls.jf.url
        cls.service = service
        cls.server = service.Server(("127.0.0.1", 0), service.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    def get(self, path, secret="s3cret", token="good"):
        headers = {}
        if secret:
            headers["X-Orbital-Bridge"] = secret
        if token:
            headers["Authorization"] = f'MediaBrowser Client="t", Token="{token}"'
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers), timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_bridge_secret_required(self):
        self.assertEqual(self.get("/sports/api/status", secret=None)[0], 403)
        self.assertEqual(self.get("/sports/api/status", secret="wrong")[0], 403)
        self.assertEqual(self.get("/health", secret=None)[0], 200)

    def test_jellyfin_sign_in_required_and_sent_the_modern_way(self):
        self.assertEqual(self.get("/sports/api/status", token=None)[0], 401)
        self.assertEqual(self.get("/sports/api/status", token="bad")[0], 401)
        status, body = self.get("/sports/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(body["watched_game"], "estimated-delay-with-sync")
        self.assertFalse(body["picture_lock"])
        self.assertNotIn("legacy", {kind for kind, _ in self.jf.seen})

    def test_private_services_are_not_part_of_this_edition(self):
        for path in ("/sports/api/experience/v1/picture-estimate", "/sports/api/catalogue", "/sports/api/capacity",
                     "/sports/api/playback-report", "/sports/api/library-tags"):
            self.assertEqual(self.get(path)[0], 404, path)

    def test_games_pair_with_the_viewers_own_channels_exactly(self):
        svc = self.service
        channels = [{"Id": "c-espn", "Name": "ESPN HD"}, {"Id": "c-espnu", "Name": "206 ESPNU"}, {"Id": "c-wfld", "Name": "WFLD"},
                    {"Id": "c-fs1", "Name": "FS1"}]
        events = [
            {"id": "1", "league": "NBA", "state": "live", "start": "2026-10-22T23:00:00Z", "networks": ["ESPN"]},
            {"id": "2", "league": "NFL", "state": "scheduled", "start": "2099-10-22T23:00:00Z", "networks": ["FOX"]},
            {"id": "3", "league": "MLB", "state": "final", "start": "2026-10-21T23:00:00Z", "networks": ["ESPN"]},
            {"id": "4", "league": "College football", "state": "live", "start": "2026-10-22T23:00:00Z", "networks": ["Fox Sports 1"]},
        ]
        out = {e["id"]: e for e in svc.attach_channels(events, channels, svc.channel_aliases("WFLD=FOX"))}
        self.assertEqual(out["1"]["carriers"], ["c-espn"], "ESPN must not match ESPNU")
        first = out["1"]["sources"][0]
        # The shell's Watch choice: not an automatic parent, and automatic_eligible (live-tv.js/orbital.js eligible()).
        self.assertFalse(first["automatic"], "carriers must not look like household fallback parents")
        self.assertTrue(first["automatic_eligible"] and first["manual_available"], "a live carried game must be watchable")
        self.assertEqual(out["2"]["carriers"], ["c-wfld"], "call-sign channel mapped by CHANNEL_ALIASES")
        self.assertFalse(out["2"]["watchable"], "far-future game is not watchable yet")
        self.assertEqual(out["3"]["sources"], [], "finished games offer no channel")
        self.assertEqual(out["3"]["feed_status"], "ended")
        self.assertEqual(out["4"]["carriers"], ["c-fs1"], "FS1 alias")


if __name__ == "__main__":
    unittest.main()
