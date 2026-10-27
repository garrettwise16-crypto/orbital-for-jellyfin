"""Sports add-ons and play-by-play (Oct 23 2026): Orbital publishes the mechanism and the format; an add-on
someone else wrote is installed only after the administrator sees who wrote it and confirms both that it runs code
and whose terms apply. Its plays drive the same Game Center and trackers. Offline."""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "sports_service" / "app"
sys.path.insert(0, str(APP))
sys.path.insert(0, str(HERE))

ADDON = '''
ADDON = {"name": "Test League Data", "author": "A Community Member", "version": "1.2",
         "description": "Schedules and plays for a test league.", "provides": ["schedule", "scores", "plays"],
         "terms": "Example Data Co", "terms_url": "https://example.org/terms", "leagues": ["MLB"]}

def games(day):
    return [{"id": "g1", "league": "MLB", "start": day + "T23:00:00Z", "state": "live", "status": "Top 2nd",
             "teams": [{"name": "Tampa Bay Rays", "side": "away", "abbr": "TB", "score": "0"},
                       {"name": "Milwaukee Brewers", "side": "home", "abbr": "MIL", "score": "1"}],
             "networks": ["FOX"]}]

def game(game_id):
    t = "2026-10-24T00:%02d:00Z"
    return {"plays": [
        {"id": "1", "at": t % 1, "period": 1, "half": "top", "at_bat": "ab1", "outs": 0, "bases": [],
         "type": "Ball", "pitch": {"number": 1, "type": "Four-seam FB", "mph": 97, "result": "ball", "balls": 1, "strikes": 0},
         "score": {"away": 0, "home": 0}},
        {"id": "2", "at": t % 2, "period": 1, "half": "top", "at_bat": "ab1", "outs": 0, "bases": [],
         "type": "Strike Swinging", "pitch": {"number": 2, "type": "Slider", "mph": 86, "result": "strike-swinging",
                                               "balls": 1, "strikes": 1}},
        {"id": "3", "at": t % 3, "period": 1, "half": "top", "at_bat": "ab1", "outs": 1, "bases": [],
         "type": "Ground Out", "text": "Aranda grounded out to second.", "end_of_at_bat": True, "team": "away"},
        {"id": "4", "at": t % 9, "period": 1, "half": "bottom", "at_bat": "ab2", "outs": 0, "bases": [],
         "type": "Home Run", "text": "Contreras homered to left.", "end_of_at_bat": True, "scoring": True,
         "score": {"away": 0, "home": 1}, "team": "home"},
        {"id": "5", "at": t % 20, "period": 2, "half": "top", "at_bat": "ab3", "outs": 0, "bases": [1],
         "type": "Foul Ball", "pitch": {"number": 1, "type": "Changeup", "mph": 84, "result": "foul", "balls": 0, "strikes": 1}},
        {"id": "bad", "at": "not a time", "period": 2, "half": "top"},
        {"id": "6", "at": t % 21, "period": 2, "half": "sideways"}]}
'''


@unittest.skipUnless((APP / "sources.py").is_file(), "build work/sports_service first")
class AddonTests(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        os.environ["SPORTS_DATA_DIR"] = self.data
        import sources
        self.s = sources
        sources.CACHE.clear()
        sources.DETAILS.clear()
        sources.MODULES.clear()

    def install(self, code=ADDON):
        staged = self.s.stage_addon(code)
        return staged, self.s.install_addon(staged["pending"], True, staged["addon"]["terms"])

    def test_the_description_is_read_without_running_the_file(self):
        staged = self.s.stage_addon(ADDON + "\nraise SystemExit('this must not run while inspecting')\n")
        self.assertEqual(staged["addon"]["author"], "A Community Member")
        self.assertEqual(staged["addon"]["module"], "test_league_data")
        self.assertTrue(staged["addon"]["details"])
        self.assertIn("Example Data Co", staged["confirm"]["terms"])
        self.assertIn("runs inside Orbital Sports", staged["confirm"]["runs_code"].replace("will run", "runs"))

    def test_both_confirmations_are_required(self):
        staged = self.s.stage_addon(ADDON)
        with self.assertRaisesRegex(ValueError, "runs code"):
            self.s.install_addon(staged["pending"], False, "Example Data Co")
        with self.assertRaisesRegex(ValueError, "terms"):
            self.s.install_addon(staged["pending"], True, None)
        self.assertEqual(self.s.load_settings()["sources"], [{"type": "guide"}], "nothing installed yet")
        record = self.s.install_addon(staged["pending"], True, "Example Data Co")
        self.assertEqual(len(record["sha256"]), 64)
        entry = self.s.load_settings()["sources"][-1]
        self.assertEqual((entry["type"], entry["module"], entry["leagues"]), ("file", "test_league_data", ["MLB"]))
        with self.assertRaisesRegex(ValueError, "expired"):
            self.s.install_addon(staged["pending"], True, "Example Data Co")

    def test_files_that_are_not_add_ons_are_refused(self):
        cases = {"def games(day):\n    return []\n": "no ADDON",
                 "ADDON = {'name': 'x', 'author': 'y'}\n": "games",
                 "ADDON = dict(name='x', author='y')\ndef games(d): return []\n": "plain values",
                 "ADDON = {'name': 'x', 'author': 'y', 'provides': ['plays']}\ndef games(d): return []\n": "game",
                 "ADDON = {'name': 'x'}\ndef games(d): return []\n": "author",
                 "def broken(:\n": "not a valid Python"}
        for code, reason in cases.items():
            with self.assertRaisesRegex(ValueError, reason, msg=code):
                self.s.stage_addon(code)

    def test_an_installed_add_on_lists_games_and_plays(self):
        self.install()
        with mock.patch.object(self.s, "local_day", return_value="2026-10-23"):
            board = self.s.board("2026-10-23")
            event = board["events"][0]
            self.assertEqual(event["source"], "file:test_league_data")
            plays = self.s.detail(event)
        self.assertEqual([p["id"] for p in plays], ["1", "2", "3", "4", "5"], "invalid plays dropped, order by time")
        view = self.s.tracker_view(event, plays)
        self.assertTrue(view["tracking_available"])
        self.assertEqual(view["line_score"], {"away": [0, 0], "home": [1]})
        self.assertEqual(view["summary"]["at_bat_id"], "ab3")
        self.assertEqual(view["plays"][0]["mph"], 84)
        self.assertEqual([r["text"] for r in view["recent"]], ["Aranda grounded out to second.", "Contreras homered to left."])
        pitch = next(r for r in view["timeline"] if r["id"] == "2")
        self.assertEqual((pitch["half"], pitch["inning"], pitch["team_id"], pitch["pitch"]), ("Top", "1st Inning", "home", True))
        self.assertEqual(view["timeline"][-1]["home"], 1, "the score carries forward")

    def test_a_changed_add_on_stops_until_approved_again(self):
        self.install()
        path = Path(self.data) / "sources" / "test_league_data.py"
        path.write_bytes(path.read_bytes() + b"\n# changed\n")
        with mock.patch.object(self.s, "local_day", return_value="2026-10-23"):
            board = self.s.board("2026-10-23")
        self.assertEqual(board["events"], [])
        self.assertTrue(any("source unavailable" in w for w in board["warnings"]))

    def test_removing_sets_the_file_aside(self):
        self.install()
        self.s.remove_addon("test_league_data")
        self.assertEqual(self.s.load_settings()["sources"], [{"type": "guide"}])
        self.assertFalse((Path(self.data) / "sources" / "test_league_data.py").exists())
        self.assertEqual(len(list((Path(self.data) / "sources" / "removed").iterdir())), 1)
        with self.assertRaises(ValueError):
            self.s.remove_addon("test_league_data")

    def test_github_page_addresses_are_read_from_the_raw_file(self):
        seen = []

        class Reply:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return ADDON.encode()
        with mock.patch.object(self.s.urllib.request, "urlopen", side_effect=lambda r, timeout: seen.append(r.full_url) or Reply()):
            self.assertIn("ADDON", self.s.addon_from_url("https://github.com/someone/fp-addon/blob/main/addon.py"))
        self.assertEqual(seen, ["https://raw.githubusercontent.com/someone/fp-addon/main/addon.py"])
        for bad in ("http://example.org/a.py", "https://user:pw@example.org/a.py", "file:///etc/passwd"):
            with self.assertRaises(ValueError):
                self.s.addon_from_url(bad)

    def test_feed_inline_plays(self):
        from test_sources import serve
        doc = {"format": "orbital-sports-feed/1", "games": [
            {"id": "x", "league": "MLB", "start": "2026-10-23T23:00:00Z", "state": "live",
             "teams": [{"name": "A Team", "side": "away"}, {"name": "B Team", "side": "home"}],
             "plays": [{"id": "p1", "at": "2026-10-23T23:05:00Z", "period": 1, "half": "top", "type": "Ball",
                        "pitch": {"number": 1, "result": "ball", "balls": 1, "strikes": 0}}]}]}
        server, url = serve(lambda path, headers, body: (200, doc))
        try:
            self.s.save_settings({"sources": [{"type": "feed", "name": "Mine", "url": url}]})
            with mock.patch.object(self.s, "local_day", return_value="2026-10-23"):
                event = self.s.board("2026-10-23")["events"][0]
            self.assertEqual(event["details"], "inline")
            self.assertEqual([p["id"] for p in self.s.detail(event)], ["p1"])
        finally:
            server.shutdown()


@unittest.skipUnless((APP / "sources.py").is_file(), "build work/sports_service first")
class AddonServiceTests(unittest.TestCase):
    """Through the service: administrators add add-ons in two steps; everyone's Game Center gets the plays."""

    @classmethod
    def setUpClass(cls):
        from test_sources import serve

        def jf(path, headers, body):
            auth = headers.get("Authorization") or ""
            admin = 'Token="admin"' in auth
            if not admin and 'Token="good"' not in auth:
                return 401, {}
            if path.startswith("/Users/Me"):
                return 200, {"Id": "addon-admin" if admin else "addon-viewer", "Policy": {"EnableLiveTvAccess": True, "IsAdministrator": admin}}
            return 200, {"Items": [], "TotalRecordCount": 0}
        cls.jf, url = serve(jf)
        cls.data = tempfile.mkdtemp()
        os.environ.update(JELLYFIN_URL=url, ORBITAL_BRIDGE_SECRET="s3cret", SPORTS_DATA_DIR=cls.data)
        import service
        service.JELLYFIN = service.core.JELLYFIN = url
        cls.service = service
        cls.server = service.Server(("127.0.0.1", 0), service.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.jf.shutdown()

    def call(self, path, token="good", body=None):
        os.environ["SPORTS_DATA_DIR"] = self.data
        headers = {"X-Orbital-Bridge": "s3cret", "Authorization": f'MediaBrowser Client="t", Token="{token}"'}
        data = json.dumps(body).encode() if body is not None else None
        if data:
            headers["Content-Type"] = "application/json"
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + path, data=data, headers=headers), timeout=15) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_two_step_install_then_game_center_plays(self):
        self.assertEqual(self.call("/sports/api/sources/addons", body={"action": "inspect", "code": ADDON})[0], 403)
        status, staged = self.call("/sports/api/sources/addons", "admin", {"action": "inspect", "code": ADDON})
        self.assertEqual(status, 200)
        status, body = self.call("/sports/api/sources/addons", "admin", {"action": "install", "pending": staged["pending"]})
        self.assertEqual(status, 400, "no confirmation, no install")
        status, body = self.call("/sports/api/sources/addons", "admin",
                                 {"action": "install", "pending": staged["pending"], "runs_code": True, "terms": "Example Data Co"})
        self.assertEqual((status, body["installed"]["author"]), (200, "A Community Member"))
        import sources
        with mock.patch.object(sources, "local_day", return_value="2026-10-23"):
            status, board = self.call("/sports/api/events?date=2026-10-23")
            self.assertEqual(status, 200, board)
            game = board["events"][0]
            status, state = self.call("/sports/api/game/%s/state?league=MLB&date=2026-10-23" % game["id"])
            self.assertEqual(status, 200, state)
            self.assertTrue(state["tracker_available"])
            self.assertEqual(state["line_score"], {"away": [0, 0], "home": [1]})
            status, view = self.call("/sports/api/tracker?league=MLB&event=%s&date=2026-10-23" % game["id"])
        self.assertEqual(status, 200, view)
        self.assertEqual(view["summary"]["at_bat_id"], "ab3")
        self.assertEqual(view["source"], "file:test_league_data")
        status, listed = self.call("/sports/api/sources/addons", "admin")
        self.assertEqual([a["module"] for a in listed["addons"]], ["test_league_data"])
        self.assertEqual(self.call("/sports/api/sources/addons", "admin", {"action": "remove", "module": "test_league_data"})[0], 200)


if __name__ == "__main__":
    unittest.main()
