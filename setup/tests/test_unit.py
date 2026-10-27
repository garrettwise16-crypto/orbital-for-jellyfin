import unittest
from datetime import datetime, timezone

from fpmigrate.jellyfin import JfItem, UserState
from fpmigrate.matching import AMBIGUOUS, MATCHED, UNMATCHED, JellyfinIndex, norm_path
from fpmigrate.netio import redact
from fpmigrate.planner import (FAVORITE, KEPT, RATING, RESUME, SKIPPED, UNCHANGED, WATCHED, fields_hold,
                               plan_item)
from fpmigrate.plex import PlexRecord

T = 10_000


def rec(rk="1", kind="movie", files=("/data/Movies/A (2000)/A (2000).mkv",), guids=None, **kw):
    return PlexRecord(rating_key=rk, kind=kind, title=kw.pop("title", "A"), files=list(files), guids=guids or {}, **kw)


def item(iid, paths, kind="Movie", pids=None):
    return JfItem(id=iid, kind=kind, name=iid, paths=list(paths), provider_ids=pids or {}, state=UserState())


class MatchingTests(unittest.TestCase):
    def test_exact_path_windows_case_and_slashes(self):
        idx = JellyfinIndex([item("x", [r"d:\movies\A (2000)\A (2000).MKV"])], [r"D:\Movies"])
        m = idx.match(rec(files=[r"D:\Movies\A (2000)\A (2000).mkv"]), [r"D:\Movies"])
        self.assertEqual((m.status, m.item_id, m.method), (MATCHED, "x", "path"))

    def test_unicode_nfd_vs_nfc(self):
        nfd = "/m/Ame\u0301lie (2001)/Ame\u0301lie (2001).mp4"
        nfc = "/m/Am\u00e9lie (2001)/Am\u00e9lie (2001).mp4"
        self.assertEqual(norm_path(nfd), norm_path(nfc))
        idx = JellyfinIndex([item("x", [nfc])], ["/m"])
        self.assertEqual(idx.match(rec(files=[nfd]), ["/m"]).item_id, "x")

    def test_different_roots_use_library_relative_path(self):
        idx = JellyfinIndex([item("x", [r"\\NAS\media\Movies\A (2000)\A (2000).mkv"])], [r"\\NAS\media\Movies"])
        m = idx.match(rec(files=[r"M:\Movies\A (2000)\A (2000).mkv"]), [r"M:\Movies"])
        self.assertEqual((m.status, m.method), (MATCHED, "library_relative_path"))

    def test_relative_path_cannot_cross_shows(self):
        jf = [item("b1", ["/media/TV/ShowB/Season 01/S01E01.mkv"], "Episode")]
        idx = JellyfinIndex(jf, ["/media/TV"])
        m = idx.match(rec(kind="episode", files=["/data/TV/ShowA/Season 01/S01E01.mkv"]), ["/data/TV"])
        self.assertEqual(m.status, UNMATCHED)

    def test_versions_on_one_item(self):
        idx = JellyfinIndex([item("x", ["/m/BR/BR - Final.mp4", "/m/BR/BR - Theatrical.mp4"])], ["/m"])
        m = idx.match(rec(files=["/d/BR/BR - Theatrical.mp4"]), ["/d"])
        self.assertEqual(m.item_id, "x")

    def test_provider_fallback_and_ambiguity(self):
        idx = JellyfinIndex([item("x", ["/other/x.mkv"], pids={"imdb": "tt1"})], ["/other"])
        m = idx.match(rec(files=["/nowhere/a.mkv"], guids={"imdb": "tt1"}), ["/nowhere"])
        self.assertEqual((m.status, m.method), (MATCHED, "external_id_imdb"))
        idx = JellyfinIndex([item("x", ["/o/x.mkv"], pids={"tmdb": "5"}), item("y", ["/o/y.mkv"], pids={"tmdb": "5"})],
                            ["/o"])
        self.assertEqual(idx.match(rec(files=["/n/a.mkv"], guids={"tmdb": "5"}), ["/n"]).status, AMBIGUOUS)

    def test_provider_id_kind_must_match(self):
        idx = JellyfinIndex([item("x", ["/o/x.mkv"], kind="Episode", pids={"imdb": "tt1"})], ["/o"])
        self.assertEqual(idx.match(rec(files=["/n/a.mkv"], guids={"imdb": "tt1"}), ["/n"]).status, UNMATCHED)

    def test_ambiguous_path_resolved_only_by_consistent_provider(self):
        jf = [item("x", ["/m/A/a.mkv"], pids={"imdb": "tt1"}), item("y", ["/m/A/a.mkv"], pids={"imdb": "tt2"})]
        idx = JellyfinIndex(jf, ["/m"])
        self.assertEqual(idx.match(rec(files=["/m/A/a.mkv"], guids={"imdb": "tt2"}), ["/m"]).item_id, "y")
        self.assertEqual(idx.match(rec(files=["/m/A/a.mkv"], guids={"imdb": "tt9"}), ["/m"]).status, AMBIGUOUS)

    def test_no_files_unmatched(self):
        self.assertEqual(JellyfinIndex([], []).match(rec(files=[]), []).status, UNMATCHED)


class PlannerTests(unittest.TestCase):
    def test_watched_sets_played_count_date(self):
        a = plan_item("x", "A", [rec(view_count=2, last_viewed_at=1_000_000_000)], UserState())
        self.assertIn(WATCHED, a.categories)
        self.assertEqual(a.changes["Played"], True)
        self.assertEqual(a.changes["PlayCount"], 2)
        self.assertTrue(a.changes["LastPlayedDate"].startswith("2001-09-09T01:46:40"))

    def test_never_unplay_or_lower_count(self):
        cur = UserState(played=True, play_count=5, last_played=datetime(2030, 1, 1, tzinfo=timezone.utc))
        a = plan_item("x", "A", [rec(view_count=1, last_viewed_at=1_000_000_000)], cur)
        self.assertEqual(a.changes, {})
        self.assertEqual(a.categories, [UNCHANGED])
        a = plan_item("x", "A", [rec()], UserState(played=True))  # no Plex state -> nothing
        self.assertEqual(a.changes, {})

    def test_resume_written_when_empty(self):
        a = plan_item("x", "A", [rec(view_offset_ms=61000, last_viewed_at=10)], UserState())
        self.assertEqual(a.changes["PlaybackPositionTicks"], 61000 * T)
        self.assertIn(RESUME, a.categories)

    def test_resume_kept_when_jellyfin_played(self):
        a = plan_item("x", "A", [rec(view_offset_ms=61000, last_viewed_at=10)], UserState(played=True))
        self.assertNotIn("PlaybackPositionTicks", a.changes)
        self.assertIn(KEPT, a.categories)

    def test_resume_newer_wins_older_kept(self):
        cur = UserState(position_ticks=5000 * T, last_played=datetime(2020, 1, 1, tzinfo=timezone.utc))
        newer = plan_item("x", "A", [rec(view_offset_ms=90000, last_viewed_at=1_700_000_000)], cur)
        self.assertEqual(newer.changes["PlaybackPositionTicks"], 90000 * T)
        older = plan_item("x", "A", [rec(view_offset_ms=90000, last_viewed_at=1_000_000_000)], cur)
        self.assertIn(KEPT, older.categories)
        self.assertNotIn("PlaybackPositionTicks", older.changes)

    def test_watched_clears_stale_partial_position(self):
        a = plan_item("x", "A", [rec(view_count=1, last_viewed_at=10)], UserState(position_ticks=300 * T))
        self.assertEqual(a.changes["PlaybackPositionTicks"], 0)

    def test_rating_only_when_empty_and_favorite_option(self):
        a = plan_item("x", "A", [rec(user_rating=8.0)], UserState(), favorite_at=8.0)
        self.assertEqual(a.changes, {"Rating": 8.0, "IsFavorite": True})
        self.assertEqual(set(a.categories), {RATING, FAVORITE})
        a = plan_item("x", "A", [rec(user_rating=8.0)], UserState(rating=4.0))
        self.assertEqual(a.changes, {})
        self.assertIn(KEPT, a.categories)
        a = plan_item("x", "A", [rec(user_rating=8.0)], UserState(), transfer_ratings=False)
        self.assertEqual(a.changes, {})

    def test_multi_episode_file(self):
        e1 = rec("1", "episode", season=1, episode=1, view_count=1, last_viewed_at=10)
        e2 = rec("2", "episode", season=1, episode=2, view_count=1, last_viewed_at=20)
        self.assertTrue(plan_item("x", "S", [e1, e2], UserState()).changes["Played"])
        e2u = rec("2", "episode", season=1, episode=2)
        a = plan_item("x", "S", [e1, e2u], UserState())
        self.assertEqual((a.categories, a.changes), ([SKIPPED], {}))
        e2r = rec("2", "episode", season=1, episode=2, view_offset_ms=70000)
        self.assertEqual(plan_item("x", "S", [rec("1", "episode", season=1, episode=1), e2r], UserState()).categories,
                         [SKIPPED])

    def test_versions_any_watch_counts(self):
        a = plan_item("x", "BR", [rec("1", view_count=1, last_viewed_at=10), rec("2")], UserState())
        self.assertTrue(a.changes["Played"])
        a = plan_item("x", "BR", [rec("1", user_rating=6.0), rec("2", user_rating=8.0)], UserState())
        self.assertEqual(a.categories, [SKIPPED])

    def test_fields_hold(self):
        st = UserState(played=True, play_count=2, position_ticks=61000 * T)
        self.assertTrue(fields_hold(st, {"Played": True, "PlayCount": 2, "PlaybackPositionTicks": 60000 * T}))
        self.assertFalse(fields_hold(st, {"PlaybackPositionTicks": 10000 * T}))
        self.assertFalse(fields_hold(st, {"Rating": 8.0}))


class SecurityTests(unittest.TestCase):
    def test_redaction(self):
        s = redact('GET http://x/?X-Plex-Token=abc123&a=1 {"Pw": "hunter2", "AccessToken": "zzz"} Token="tt"')
        for secret in ("abc123", "hunter2", "zzz", '"tt"'):
            self.assertNotIn(secret, s)


if __name__ == "__main__":
    unittest.main()
