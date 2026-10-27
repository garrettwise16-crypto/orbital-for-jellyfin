"""Sports sources (Oct 23 2026): the free edition's games come from the person's own TV guide plus sources the
administrator connects (TheSportsDB with their key, a Orbital Sports Feed address, a provider file); ESPN's public
data is off unless switched on. Offline: no ESPN, no TheSportsDB."""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "sports_service" / "app"
sys.path.insert(0, str(APP))


def serve(handler_body):
    """A tiny local HTTP server; handler_body(path, headers) -> (status, dict)."""
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def reply(self):
            status, body = handler_body(self.path, self.headers, self.rfile.read(int(self.headers.get("Content-Length") or 0)))
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        do_GET = do_POST = reply
    server = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def program(name, episode, start, end, channel="FOX 32", channel_id="c-fox", repeat=False):
    return {"Name": name, "EpisodeTitle": episode, "StartDate": start, "EndDate": end, "ChannelName": channel,
            "ChannelId": channel_id, "IsRepeat": repeat}


@unittest.skipUnless((APP / "sources.py").is_file(), "build work/sports_service first")
class SourceTests(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        os.environ["SPORTS_DATA_DIR"] = self.data
        import sources
        self.s = sources
        sources.CACHE.clear()

    def test_guide_programmes_become_games_with_their_channel(self):
        g = self.s.guide_game(program("MLB Baseball", "Tampa Bay Rays at Milwaukee Brewers",
                                      "2026-10-24T00:00:00Z", "2099-10-24T03:30:00Z"))
        self.assertEqual(g["league"], "MLB")
        sides = {t["side"]: t["name"] for t in g["teams"]}
        self.assertEqual(sides, {"away": "Tampa Bay Rays", "home": "Milwaukee Brewers"})
        self.assertEqual(g["guide_channels"], ["c-fox"])
        self.assertIs(g["score_known"], False)
        self.assertTrue(g["id"].startswith("7") and len(g["id"]) == 12, "own id space, never an ESPN id")
        cf = self.s.guide_game(program("College Football", "#5 Ohio State at Michigan", "2026-11-28T17:00:00Z", "2026-11-28T20:30:00Z"))
        self.assertEqual(cf["league"], "College football")
        self.assertEqual({t["side"]: t["name"] for t in cf["teams"]}["away"], "Ohio State", "poll rank stripped")
        vs = self.s.guide_game(program("NBA Basketball: Milwaukee Bucks vs. Chicago Bulls", "", "2026-10-24T00:00:00Z", "2026-10-24T02:30:00Z"))
        self.assertEqual({t["side"]: t["name"] for t in vs["teams"]}["home"], "Milwaukee Bucks", "'A vs. B' lists the home team first")

    def test_guide_listing_without_teams_adds_its_channel_to_the_one_matching_game(self):
        hint = self.s.guide_game(program("Live: 2026 World Series", "", "2026-10-24T00:00:00Z", "2026-10-24T04:00:00Z",
                                         channel="FOX 32 Chicago", channel_id="c-fox32"))
        self.assertTrue(hint["hint"])
        self.assertEqual(hint["league"], "MLB")
        db = self.s.sportsdb_game({"idEvent": "1", "idLeague": "4424", "strHomeTeam": "Milwaukee Brewers",
                                   "strAwayTeam": "Tampa Bay Rays", "strStatus": "NS", "strTimestamp": "2026-10-24T00:08:00"})
        events = self.s.merge([("thesportsdb", [db])])
        self.s.attach_hints(events, [hint])
        self.assertEqual(events[0]["guide_channels"], ["c-fox32"])
        two = self.s.merge([("thesportsdb", [db, dict(db, id="x", teams=[{"name": "A B", "side": "home", "score": ""},
                                                                          {"name": "C D", "side": "away", "score": ""}])])])
        self.s.attach_hints(two, [hint])
        self.assertFalse(any(e.get("guide_channels") for e in two), "two MLB games at once: the listing is ambiguous")
        game = self.s.guide_game(program("MLB: Tampa Bay Rays @ Milwaukee Brewers [Brewers channel]", "",
                                         "2026-10-24T00:00:00Z", "2026-10-24T04:00:00Z"))
        self.assertEqual({t["side"]: t["name"] for t in game["teams"]}["home"], "Milwaukee Brewers", "suffix removed")

    def test_guide_shows_that_are_not_games_are_ignored(self):
        for name, episode, repeat in (("MLB Tonight", "", False), ("SportsCenter", "", False),
                                      ("MLB Baseball", "Rays at Brewers", True), ("NFL Draft", "Round 1", False),
                                      ("College Football Pregame", "", False)):
            self.assertIsNone(self.s.guide_game(program(name, episode, "2026-10-24T00:00:00Z", "2026-10-24T03:00:00Z", repeat=repeat)), name)

    def test_feed_games_are_checked_field_by_field(self):
        ok = {"league": "NHL", "start": "2026-10-24T00:00:00Z", "state": "live", "status": "2nd 10:12",
              "teams": [{"name": "Chicago Blackhawks", "side": "away", "score": "2", "logo": "http://x/logo.png"},
                        {"name": "Detroit Red Wings", "side": "home", "score": "1<script>", "logo": "https://x/l.png"}]}
        g = self.s.validate_game(ok, "feed:test")
        self.assertEqual(g["name"], "Chicago Blackhawks at Detroit Red Wings")
        away = next(t for t in g["teams"] if t["side"] == "away")
        home = next(t for t in g["teams"] if t["side"] == "home")
        self.assertNotIn("logo", away, "only https logos")
        self.assertEqual(home["score"], "", "a score that isn't a number is dropped")
        for bad in ({**ok, "league": "Cricket"}, {**ok, "teams": ok["teams"][:1]}, {**ok, "start": "soon"},
                    {**ok, "teams": [{"name": "A", "side": "home"}, {"name": "B", "side": "home"}]}):
            self.assertIsNone(self.s.validate_game(bad, "feed:test"))

    def test_settings_are_strict_and_keys_never_come_back_whole(self):
        for bad in ({"sources": [{"type": "scraper"}]}, {"sources": [{"type": "feed", "url": "https://u:p@example.com/f"}]},
                    {"sources": [{"type": "feed", "url": "file:///etc/passwd"}]}, {"sources": [{"type": "file", "module": "../x"}]},
                    {"sources": [{"type": "thesportsdb", "key": "a b"}]}, {"sources": [{"type": "guide", "leagues": ["XFL"]}]}):
            with self.assertRaises(ValueError, msg=json.dumps(bad)):
                self.s.validate_settings(bad)
        saved = self.s.save_settings({"sources": [{"type": "guide"}, {"type": "thesportsdb", "key": "abc123secret"}]})
        self.assertEqual(saved["sources"][1]["key"], "abc123secret")
        shown = self.s.masked(self.s.load_settings())
        self.assertNotIn("abc123secret", json.dumps(shown))
        # A settings screen that only saw the shortened key can save without retyping it.
        self.s.save_settings({"sources": [{"type": "guide"}, {"type": "thesportsdb", "key": self.s.KEEP}, {"type": "espn-public"}]})
        self.assertEqual(self.s.load_settings()["sources"][1]["key"], "abc123secret")
        with self.assertRaises(ValueError):
            self.s.save_settings({"sources": [{"type": "feed", "url": "https://x.example/f", "token": self.s.KEEP}]})

    def test_espn_is_off_unless_switched_on(self):
        self.assertEqual(self.s.load_settings(), {"sources": [{"type": "guide"}]})
        self.assertFalse(self.s.espn_enabled())
        self.s.save_settings({"sources": [{"type": "guide"}, {"type": "espn-public"}]})
        self.assertTrue(self.s.espn_enabled())

    def test_a_connected_source_gives_the_score_and_the_guide_gives_the_channel(self):
        guide = self.s.guide_game(program("MLB Baseball", "Tampa Bay Rays at Milwaukee Brewers", "2026-10-24T00:05:00Z", "2099-01-01T00:00:00Z"))
        db = self.s.sportsdb_game({"idEvent": "123", "idLeague": "4424", "strHomeTeam": "Milwaukee Brewers",
                                   "strAwayTeam": "Tampa Bay Rays", "intHomeScore": "3", "intAwayScore": "1",
                                   "strStatus": "In Progress", "strTimestamp": "2026-10-24T00:00:00", "strTVStation": "FOX"})
        merged = self.s.merge([("thesportsdb", [db]), ("guide", [guide])])
        self.assertEqual(len(merged), 1)
        game = merged[0]
        self.assertEqual({t["side"]: t["score"] for t in game["teams"]}, {"home": "3", "away": "1"})
        self.assertEqual(game["state"], "live")
        self.assertEqual(game["guide_channels"], ["c-fox"])
        self.assertIn("FOX 32", game["networks"])
        self.assertEqual(game["sources_used"], ["thesportsdb", "guide"])

    def test_one_broken_source_never_hides_the_others(self):
        def feed(path, headers, body):
            if path.startswith("/bad"):
                return 200, {"format": "something-else"}
            return 200, {"format": "orbital-sports-feed/1", "games": [
                {"id": "g1", "league": "NBA", "start": "2026-10-24T00:00:00Z", "state": "final",
                 "teams": [{"name": "Chicago Bulls", "side": "away", "score": "101"},
                           {"name": "Milwaukee Bucks", "side": "home", "score": "99"}]}]}
        server, url = serve(feed)
        try:
            self.s.save_settings({"sources": [{"type": "feed", "url": url + "/bad", "name": "broken"},
                                              {"type": "feed", "url": url + "/good", "name": "mine"}]})
            board = self.s.board("2026-10-23")
            self.assertEqual([e["name"] for e in board["events"]], ["Chicago Bulls at Milwaukee Bucks"])
            self.assertTrue(any("broken" in w for w in board["warnings"]))
            self.assertEqual([h["ok"] for h in board["sources"]], [False, True])
        finally:
            server.shutdown()

    def test_rate_limited_source_keeps_what_it_got_and_says_why(self):
        import urllib.error
        calls = []

        def fake(url, *a, **k):
            calls.append(url)
            if len(calls) > 1:
                raise urllib.error.HTTPError(url, 429, "Too Many Requests", {}, None)
            return {"events": [{"idEvent": "9", "idLeague": "4424", "strHomeTeam": "Milwaukee Brewers",
                                "strAwayTeam": "Tampa Bay Rays", "strStatus": "NS",
                                "strTimestamp": "2026-10-23T18:00:00"}]}
        self.s.save_settings({"sources": [{"type": "thesportsdb", "key": "123", "leagues": ["MLB"]}]})
        with mock.patch.object(self.s, "get_json", side_effect=fake), mock.patch.object(self.s.time, "sleep"), \
                mock.patch.object(self.s, "local_day", return_value="2026-10-23"):
            board = self.s.board("2026-10-23")
        self.assertEqual(len(board["events"]), 1)
        self.assertTrue(any("rate limit" in w for w in board["warnings"]))

    def test_provider_file_from_the_sources_folder(self):
        folder = Path(self.data) / "sources"
        folder.mkdir()
        (folder / "my_league.py").write_text(
            "def games(day):\n    return [{'league': 'MLS', 'start': day + 'T23:30:00Z', 'state': 'scheduled',\n"
            "             'teams': [{'name': 'Chicago Fire', 'side': 'away'}, {'name': 'Inter Miami', 'side': 'home'}]}]\n")
        self.s.save_settings({"sources": [{"type": "file", "module": "my_league"}]})
        board = self.s.board("2026-10-23")
        self.assertEqual(board["events"][0]["source"], "file:my_league")
        self.assertEqual(board["events"][0]["league"], "MLS")


@unittest.skipUnless((APP / "sources.py").is_file(), "build work/sports_service first")
class ServiceWithSourcesTests(unittest.TestCase):
    """The service end to end with only the built-in guide: games, channels, admin-only settings, ESPN pages off."""

    @classmethod
    def setUpClass(cls):
        from datetime import datetime, timedelta, timezone
        began = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")  # on now
        cls.day = datetime.fromisoformat(began.replace("Z", "+00:00")).astimezone().date()  # match the service calendar, including evenings across UTC midnight
        programmes = [program("MLB Baseball", "Tampa Bay Rays at Milwaukee Brewers", began,
                              "2099-10-24T03:30:00Z", channel="FOX 32 Chicago", channel_id="c-fox")]

        def jf(path, headers, body):
            auth = headers.get("Authorization") or ""
            if 'Token="admin"' in auth:
                user = {"Id": "admin1", "Policy": {"EnableLiveTvAccess": True, "IsAdministrator": True}}
            elif 'Token="good"' in auth:
                user = {"Id": "u1", "Policy": {"EnableLiveTvAccess": True, "IsAdministrator": False}}
            else:
                return 401, {}
            if path.startswith("/Users/Me"):
                return 200, user
            if path.startswith("/Items") and "LiveTvProgram" in path:
                term = __import__("urllib.parse").parse.parse_qs(path.split("?", 1)[1]).get("searchTerm", [""])[0].lower()
                found = [p for p in programmes if term in (p["Name"] + " " + p["EpisodeTitle"]).lower()]
                return 200, {"Items": [dict(p, Id="p%d" % i) for i, p in enumerate(found)], "TotalRecordCount": len(found)}
            return 200, {"Items": [{"Id": "c-fox", "Name": "FOX 32 Chicago"}], "TotalRecordCount": 1}
        cls.jf, url = serve(jf)
        os.environ.update(JELLYFIN_URL=url, ORBITAL_BRIDGE_SECRET="s3cret", SPORTS_DATA_DIR=tempfile.mkdtemp())
        import service
        service.JELLYFIN = service.core.JELLYFIN = url
        cls.service = service
        cls.server = service.Server(("127.0.0.1", 0), service.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    def call(self, path, token="good", body=None):
        headers = {"X-Orbital-Bridge": "s3cret", "Authorization": f'MediaBrowser Client="t", Token="{token}"'}
        data = json.dumps(body).encode() if body is not None else None
        if data:
            headers["Content-Type"] = "application/json"
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + path, data=data, headers=headers), timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def test_guide_games_reach_the_board_with_the_viewers_channel(self):
        import sources
        sources.CACHE.clear()
        with mock.patch.object(self.service, "chosen_day", return_value=(None, self.day)):
            status, body = self.call("/sports/api/events")
        self.assertEqual(status, 200)
        game = next(e for e in body["events"] if e["league"] == "MLB")
        self.assertEqual(game["carriers"], ["c-fox"])
        self.assertTrue(game["sources"][0]["automatic_eligible"], "live game on the person's own channel can be watched")

    def test_rich_pages_need_the_espn_source(self):
        for path in ("/sports/api/tracker?league=MLB&event=401908042", "/sports/api/boxscore?league=MLB&event=1",
                     "/sports/api/team-directory?league=MLB"):
            status, body = self.call(path)
            self.assertEqual((status, body.get("needs_source")), (404, "espn-public"), path)
        status, body = self.call("/sports/api/rankings")
        self.assertEqual((status, body["polls"]), (200, []))

    def test_only_administrators_see_or_change_sources(self):
        self.assertEqual(self.call("/sports/api/sources")[0], 403)
        self.assertEqual(self.call("/sports/api/sources", body={"sources": [{"type": "guide"}]})[0], 403)
        status, body = self.call("/sports/api/sources", token="admin",
                                 body={"sources": [{"type": "guide"}, {"type": "thesportsdb", "key": "k3yvalue"}]})
        self.assertEqual(status, 200)
        self.assertNotIn("k3yvalue", json.dumps(body))
        self.assertEqual(self.call("/sports/api/sources", token="admin", body={"sources": [{"type": "nope"}]})[0], 400)
        status, body = self.call("/sports/api/status")
        self.assertEqual(body["sources"], ["guide", "thesportsdb"])
        self.assertFalse(body["rich_game_details"])
        import sources
        sources.save_settings({"sources": [{"type": "guide"}]})


if __name__ == "__main__":
    unittest.main()
