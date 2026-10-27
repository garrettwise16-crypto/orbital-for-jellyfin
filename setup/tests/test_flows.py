import json
import tempfile
import time
import unittest
from pathlib import Path

from fpmigrate import journal as J
from fpmigrate.engine import Engine
from fpmigrate.netio import HttpError
from tests.fakes import FakeJellyfin, FakePlex, FakePlexTv, epoch, plex_episode, plex_movie

T = 10_000
OLD = epoch(2024, 5, 1)


def movie_lib(items, key="1", root="/data/Movies"):
    return {"key": key, "type": "movie", "title": "Movies", "locations": [root], "items": items}


def jf_movie(name, root, folder_file, pids=None):
    return {"Name": name, "Type": "Movie", "files": [f"{root}/{folder_file}"], "ProviderIds": pids or {}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.closers = []

    def tearDown(self):
        for c in self.closers:
            c.close()
        self.tmp.cleanup()

    def track(self, *objs):
        self.closers.extend(objs)
        return objs[0] if len(objs) == 1 else objs

    def engine(self, tv_url=None, sub="d"):
        e = Engine(Path(self.tmp.name) / sub, plex_tv_base=tv_url or "http://127.0.0.1:9")
        self.closers.append(e.journal)
        return e


def standard_world():
    plex_items = [
        plex_movie(1, "Watched", 2001, "/data/Movies/Watched (2001)/Watched (2001).mkv", view_count=2, last=OLD),
        plex_movie(2, "Resume", 2002, "/data/Movies/Resume (2002)/Resume (2002).mkv", offset=75000, last=OLD),
        plex_movie(3, "Rated", 2003, "/data/Movies/Rated (2003)/Rated (2003).mkv", rating=10.0),
        plex_movie(4, "Untouched", 2004, "/data/Movies/Untouched (2004)/Untouched (2004).mkv"),
        plex_movie(5, "Missing", 2005, "/data/Movies/Missing (2005)/Missing (2005).mkv", view_count=1, last=OLD),
    ]
    root = "/media/Movies"
    fs = {root: [jf_movie(n, root, f"{n} ({y})/{n} ({y}).mkv") for n, y in
                 [("Watched", 2001), ("Resume", 2002), ("Rated", 2003), ("Untouched", 2004)]]}
    return plex_items, fs


class OwnerFlow(Base):
    def test_fresh_jellyfin_full_journey_and_plex_untouched(self):
        plex_items, fs = standard_world()
        plex = self.track(FakePlex([movie_lib(plex_items)]))
        jf = self.track(FakeJellyfin(fs, wizard_done=False))
        e = self.engine()
        det = e.detect([plex.url], [jf.url], include_defaults=False)
        self.assertTrue(det["plex"][0]["found"])
        self.assertFalse(det["jellyfin"][0]["wizardCompleted"])
        e.connect_plex(plex.url)
        with self.assertRaises(RuntimeError):
            e.connect_jellyfin(jf.url, "me", "pw1")  # refuses to run setup implicitly
        e.connect_jellyfin(jf.url, "me", "pw1", create_admin=True)
        plan = e.library_plan()
        self.assertEqual((plan[0]["action"], plan[0]["jfPaths"]), ("create", ["/media/Movies"]))
        e.apply_libraries(plan)
        e.user_map["owner"] = e.jf.user_id
        summary = e.preview(favorite_at=8.0)
        c = summary["users"][0]["counts"]
        self.assertEqual((c["matched"], c["unmatched"], c["toWrite"]), (4, 1, 3))
        res = e.apply(summary["runId"])
        self.assertEqual((res["status"], res["verified"]), ("completed", 3))
        uid = jf.user_id("me")
        self.assertEqual((jf.state(uid, "Watched")["Played"], jf.state(uid, "Watched")["PlayCount"]), (True, 2))
        self.assertEqual(jf.state(uid, "Resume")["PlaybackPositionTicks"], 75000 * T)
        self.assertEqual((jf.state(uid, "Rated")["Rating"], jf.state(uid, "Rated")["IsFavorite"]), (10.0, True))
        self.assertFalse(jf.state(uid, "Untouched")["Played"])
        exc = e.journal.exceptions(summary["runId"])
        self.assertEqual([(x["label"], x["kind"]) for x in exc], [("Missing (2005)", "unmatched")])
        self.assertEqual(plex.violations, [])
        self.assertEqual(e.first_playback()["continueWatching"][0]["name"], "Resume")
        # re-run is a no-op
        s2 = e.preview()
        self.assertEqual(s2["users"][0]["counts"]["toWrite"], 0)
        self.assertEqual(e.apply(s2["runId"]).get("verified", 0), 0)

    def test_existing_jellyfin_state_precedence(self):
        plex_items, fs = standard_world()
        plex = self.track(FakePlex([movie_lib(plex_items)]))
        jf = self.track(FakeJellyfin(fs))
        jf.add_existing_library("Films", "/media/Movies")
        uid = jf.user_id("admin")
        iid = {v["Name"]: k for k, v in jf.items.items()}
        jf.userdata[(uid, iid["Resume"])] = {"Played": True, "PlayCount": 1}  # finished in Jellyfin already
        jf.userdata[(uid, iid["Rated"])] = {"Rating": 3.0}
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        plan = e.library_plan()
        self.assertEqual((plan[0]["action"], plan[0]["libraryName"]), ("reuse", "Films"))
        e.user_map["owner"] = uid
        s = e.preview()
        e.apply(s["runId"])
        self.assertEqual(jf.state(uid, "Resume")["PlaybackPositionTicks"], 0)
        self.assertTrue(jf.state(uid, "Resume")["Played"])
        self.assertEqual(jf.state(uid, "Rated")["Rating"], 3.0)
        kept = [a for a in e.journal.actions(s["runId"]) if "kept_newer_jellyfin_state" in a["categories"]]
        self.assertEqual(len(kept), 2)

    def test_rollback_restores_only_unchanged_items(self):
        plex_items, fs = standard_world()
        plex = self.track(FakePlex([movie_lib(plex_items)]))
        jf = self.track(FakeJellyfin(fs))
        jf.add_existing_library("Movies", "/media/Movies")
        uid = jf.user_id("admin")
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.library_plan()
        e.user_map["owner"] = uid
        s = e.preview()
        e.apply(s["runId"])
        iid = {v["Name"]: k for k, v in jf.items.items()}
        jf.userdata[(uid, iid["Resume"])]["PlaybackPositionTicks"] = 99000 * T  # household kept watching
        r = e.rollback(s["runId"])
        self.assertEqual((r["restored"], r["skipped"]), (2, 1))
        self.assertEqual(r.get("restoredInexact", 0), 0)
        self.assertFalse(jf.state(uid, "Watched")["Played"])
        self.assertEqual(jf.state(uid, "Watched")["PlayCount"], 0)
        self.assertNotIn("Rating", jf.state(uid, "Rated"))
        self.assertEqual(jf.state(uid, "Resume")["PlaybackPositionTicks"], 99000 * T)
        self.assertEqual(r["lastPlayedDateKept"], 1)  # Jellyfin cannot erase last-played dates

    def test_change_after_preview_is_superseded_not_overwritten(self):
        plex_items, fs = standard_world()
        plex = self.track(FakePlex([movie_lib(plex_items)]))
        jf = self.track(FakeJellyfin(fs))
        jf.add_existing_library("Movies", "/media/Movies")
        uid = jf.user_id("admin")
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map["owner"] = uid
        s = e.preview()
        iid = {v["Name"]: k for k, v in jf.items.items()}
        jf.userdata[(uid, iid["Resume"])] = {"PlaybackPositionTicks": 5000 * T}
        res = e.apply(s["runId"])
        self.assertEqual(res["superseded"], 1)
        self.assertEqual(jf.state(uid, "Resume")["PlaybackPositionTicks"], 5000 * T)


class Interruptions(Base):
    def test_auth_revoked_mid_apply_then_resume(self):
        items = [plex_movie(i, f"M{i}", 2000, f"/data/Movies/M{i}/M{i}.mkv", view_count=1, last=OLD) for i in range(10)]
        plex = self.track(FakePlex([movie_lib(items)]))
        jf = self.track(FakeJellyfin({"/media/Movies": [jf_movie(f"M{i}", "/media/Movies", f"M{i}/M{i}.mkv")
                                                        for i in range(10)]}))
        jf.add_existing_library("Movies", "/media/Movies")
        jf.revoke_after_writes = 4
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map["owner"] = e.jf.user_id
        s = e.preview()
        res = e.apply(s["runId"])
        self.assertEqual(res["status"], "interrupted")
        jf.revoke_after_writes = None
        e.connect_jellyfin(jf.url, "admin", "pw")
        res2 = e.apply(s["runId"])
        self.assertEqual(res2["status"], "completed")
        acts = e.journal.actions(s["runId"])
        self.assertTrue(all(a["status"] == J.VERIFIED for a in acts))
        uid = jf.user_id("admin")
        self.assertTrue(all(jf.state(uid, f"M{i}")["Played"] for i in range(10)))

    def test_server_errors_reported_not_hidden(self):
        items = [plex_movie(i, f"M{i}", 2000, f"/data/Movies/M{i}/M{i}.mkv", view_count=1, last=OLD) for i in range(3)]
        plex = self.track(FakePlex([movie_lib(items)]))
        jf = self.track(FakeJellyfin({"/media/Movies": [jf_movie(f"M{i}", "/media/Movies", f"M{i}/M{i}.mkv")
                                                        for i in range(3)]}))
        jf.add_existing_library("Movies", "/media/Movies")
        jf.fail_writes_after = 1
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map["owner"] = e.jf.user_id
        s = e.preview()
        res = e.apply(s["runId"])
        self.assertEqual((res["status"], res["failed"], res["verified"]), ("completed_with_problems", 2, 1))

    def test_cancel_pauses_and_resumes(self):
        items = [plex_movie(i, f"M{i}", 2000, f"/data/Movies/M{i}/M{i}.mkv", view_count=1, last=OLD) for i in range(5)]
        plex = self.track(FakePlex([movie_lib(items)]))
        jf = self.track(FakeJellyfin({"/media/Movies": [jf_movie(f"M{i}", "/media/Movies", f"M{i}/M{i}.mkv")
                                                        for i in range(5)]}))
        jf.add_existing_library("Movies", "/media/Movies")
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map["owner"] = e.jf.user_id
        s = e.preview()
        orig = e._p

        def cancel_on_third(phase, done=0, total=0, message=""):
            if phase == "apply" and done == 2:
                e.cancel_event.set()
            orig(phase, done, total, message)
        e._p = cancel_on_third
        self.assertEqual(e.apply(s["runId"])["status"], "paused")
        e._p = orig
        self.assertEqual(e.apply(s["runId"])["status"], "completed")
        self.assertEqual(sum(1 for a in e.journal.actions(s["runId"]) if a["status"] == J.VERIFIED), 5)


class Accounts(Base):
    def world(self):
        items = [plex_movie(1, "Shared", 2001, "/data/Movies/Shared/Shared.mkv"),
                 plex_movie(2, "KidsFilm", 2002, "/data/Movies/KidsFilm/KidsFilm.mkv")]
        plex = self.track(FakePlex([movie_lib(items)], tokens={"srv-owner": "owner", "srv-kid": "kid"},
                                   history=[{"accountID": 7, "ratingKey": "1", "viewedAt": OLD},
                                            {"accountID": 7, "ratingKey": "1", "viewedAt": OLD + 99}],
                                   accounts=[{"id": 1, "name": "Owner"}, {"id": 7, "name": "Friend"}]))
        plex.user_states["kid"] = {"2": {"viewCount": 1, "lastViewedAt": OLD}, "1": {"viewOffset": 70000}}
        servers = {"account-owner": [{"provides": "server", "clientIdentifier": "machine-1", "owned": True,
                                      "accessToken": "srv-owner", "name": "Home", "connections": []}],
                   "kid-account": [{"provides": "server", "clientIdentifier": "machine-1", "owned": False,
                                    "accessToken": "srv-kid", "name": "Home", "connections": []}]}
        tv = self.track(FakePlexTv(servers, home_users=[
            {"id": 1, "uuid": "u-owner", "title": "Owner", "admin": True},
            {"id": 2, "uuid": "u-kid", "title": "Kid", "admin": False, "restricted": True},
            {"id": 3, "uuid": "u-locked", "title": "Locked", "admin": False, "protected": True, "pin": "1234"}],
            switch_tokens={"u-kid": "kid-account", "u-locked": "kid-account"}))
        jf = self.track(FakeJellyfin({"/media/Movies": [jf_movie("Shared", "/media/Movies", "Shared/Shared.mkv"),
                                                        jf_movie("KidsFilm", "/media/Movies", "KidsFilm/KidsFilm.mkv")]}))
        jf.add_existing_library("Movies", "/media/Movies")
        return plex, tv, jf

    def test_signin_home_profiles_and_friend_history(self):
        plex, tv, jf = self.world()
        e = self.engine(tv.url)
        self.assertTrue(e.detect([plex.url], [], include_defaults=False)["plex"][0]["needsSignIn"])
        with self.assertRaises(PermissionError):
            e.connect_plex(plex.url)
        self.assertIn("CODE1", e.plex_signin_start()["authUrl"])
        self.assertEqual(e.plex_signin_poll(plex.url)["status"], "waiting")
        self.assertEqual(e.plex_signin_poll(plex.url)["status"], "connected")
        added = e.add_home_users()
        self.assertEqual({a["name"]: a["completeness"] for a in added}, {"Kid": "full", "Locked": "unavailable"})
        e.add_history_accounts()
        e.connect_jellyfin(jf.url, "admin", "pw")
        lib_ids = [f["ItemId"] for f in jf.folders]
        plan = e.user_plan()
        self.assertEqual(len(plan["sources"]), 4)
        created = e.apply_users({"owner": {"mode": "existing", "jfUserId": e.jf.user_id},
                                 "home:u-kid": {"mode": "create", "name": "Kid"},
                                 "account:7": {"mode": "create", "name": "Friend"},
                                 "home:u-locked": {"mode": "create"}}, lib_ids)
        self.assertEqual(sorted(c["name"] for c in created), ["Friend", "Kid"])
        kid = jf.users[jf.user_id("Kid")]
        self.assertEqual((kid["Policy"]["IsAdministrator"], kid["Policy"]["EnableAllFolders"],
                          kid["Policy"]["EnabledFolders"]), (False, False, lib_ids))
        s = e.preview()
        e.apply(s["runId"])
        kid_id, friend_id = jf.user_id("Kid"), jf.user_id("Friend")
        self.assertTrue(jf.state(kid_id, "KidsFilm")["Played"])
        self.assertEqual(jf.state(kid_id, "Shared")["PlaybackPositionTicks"], 70000 * T)
        self.assertEqual((jf.state(friend_id, "Shared")["Played"], jf.state(friend_id, "Shared")["PlayCount"]),
                         (True, 2))
        self.assertFalse(jf.state(jf.user_id("admin"), "KidsFilm")["Played"])
        self.assertEqual(plex.violations, [])
        # one-time passwords and tokens must never be persisted
        blob = b"".join(p.read_bytes() for p in Path(e.data_dir).glob("journal.sqlite*"))
        blob += e.report_csv(s["runId"]).encode() + json.dumps(e.report(s["runId"])).encode()
        for secret in [c["password"] for c in created] + ["srv-owner", "srv-kid", "account-owner", "kid-account"]:
            self.assertNotIn(secret.encode(), blob)

    def test_protected_profile_with_pin(self):
        plex, tv, jf = self.world()
        e = self.engine(tv.url)
        e.plex_signin_start()
        e.plex_signin_poll(plex.url)
        e.plex_signin_poll(plex.url)
        added = e.add_home_users(pins={"u-locked": "1234"})
        self.assertEqual({a["name"]: a["completeness"] for a in added}["Locked"], "full")

    def test_not_owner_account_refused(self):
        plex, tv, jf = self.world()
        tv.servers_by_token["account-owner"][0]["owned"] = False
        e = self.engine(tv.url)
        e.plex_signin_start()
        e.plex_signin_poll(plex.url)
        self.assertEqual(e.plex_signin_poll(plex.url)["status"], "not_owner")


class Scale(Base):
    def test_large_library_pagination_episodes_and_ambiguity(self):
        n = 1234
        items = [plex_movie(i, f"M{i}", 2000, f"/data/Movies/M{i}/M{i}.mkv",
                            view_count=1 if i % 3 == 0 else 0, last=OLD if i % 3 == 0 else None) for i in range(n)]
        # duplicate Jellyfin entries for one title -> must be reported ambiguous, not guessed
        items.append(plex_movie(99999, "Dup", 2000, "/elsewhere/Dup.mkv", guids=["imdb://tt42"], view_count=1, last=OLD))
        eps = [plex_episode(50000 + k, "Show", 1, k, f"/data/TV/Show/Season 01/S01E{k:02d}.mkv", view_count=1, last=OLD)
               for k in range(1, 4)]
        plex = self.track(FakePlex([movie_lib(items),
                                    {"key": "2", "type": "show", "title": "TV", "locations": ["/data/TV"], "items": eps}]))
        fs = {"/media/Movies": [jf_movie(f"M{i}", "/media/Movies", f"M{i}/M{i}.mkv") for i in range(n)] +
              [jf_movie("Dup", "/media/Movies", "Dup A/Dup.mkv", {"Imdb": "tt42"}),
               jf_movie("Dup", "/media/Movies", "Dup B/Dup.mkv", {"Imdb": "tt42"})],
              "/media/TV": [{"Name": f"Ep{k}", "Type": "Episode", "files": [f"/media/TV/Show/Season 01/S01E{k:02d}.mkv"],
                             "SeriesName": "Show", "ParentIndexNumber": 1, "IndexNumber": k} for k in range(1, 4)]}
        jf = self.track(FakeJellyfin(fs))
        jf.add_existing_library("Movies", "/media/Movies")
        jf.add_existing_library("TV", "/media/TV")
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map["owner"] = e.jf.user_id
        t0 = time.time()
        s = e.preview()
        c = s["users"][0]["counts"]
        self.assertEqual((c["plexItems"], c["matched"], c["ambiguous"]), (n + 4, n + 3, 1))
        res = e.apply(s["runId"])
        self.assertEqual(res["verified"], len(range(0, n, 3)) + 3)
        self.assertLess(time.time() - t0, 120)


class Detection(Base):
    def test_typed_address_never_falls_back_to_other_servers(self):
        from fpmigrate.engine import Engine
        d = Engine.detect(["http://127.0.0.1:9"], ["http://127.0.0.1:9"])
        self.assertEqual([x["url"] for x in d["plex"]], ["http://127.0.0.1:9"])
        self.assertEqual([x["url"] for x in d["jellyfin"]], ["http://127.0.0.1:9"])
        self.assertFalse(d["jellyfin"][0]["found"])


class HomeLayout(Base):
    def test_plex_like_home_applied_respects_custom_and_undoes(self):
        plex_items, fs = standard_world()
        plex = self.track(FakePlex([movie_lib(plex_items)]))
        jf = self.track(FakeJellyfin(fs))
        jf._new_user("custom", "pw")
        cid = jf.user_id("custom")
        jf.prefs[cid] = {"CustomPrefs": {"homesection0": "latestmedia"}}
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map = {"owner": e.jf.user_id, "account:9": cid}
        self.assertEqual(e.apply_home_layout(), 1)
        prefs = jf.prefs[e.jf.user_id]["CustomPrefs"]
        self.assertEqual((prefs["homesection0"], prefs["homesection1"], prefs["skipForwardLength"]),
                         ("resume", "nextup", "30000"))
        self.assertEqual(jf.prefs[cid]["CustomPrefs"], {"homesection0": "latestmedia"})
        self.assertEqual(e.apply_home_layout(), 0)  # idempotent: now customised
        e.remove_owned()
        self.assertIsNone(jf.prefs[e.jf.user_id]["CustomPrefs"].get("homesection0"))
        self.assertEqual(jf.prefs[e.jf.user_id]["CustomPrefs"]["skipForwardLength"], "30000")


class Lists(Base):
    def test_playlists_and_collections(self):
        plex_items, fs = standard_world()
        lib = movie_lib(plex_items)
        lib["collections"] = [{"key": "c1", "title": "Faves", "items": ["2", "1"]},
                              {"key": "c2", "title": "Auto", "smart": True, "items": []}]
        plex = self.track(FakePlex([lib]))
        plex.playlists["owner"] = [{"key": "p1", "title": "Weekend", "items": ["3", "5", "1"]},
                                   {"key": "p2", "title": "Rules", "smart": True, "items": []}]
        jf = self.track(FakeJellyfin(fs))
        jf.add_existing_library("Movies", "/media/Movies")
        uid = jf.user_id("admin")
        own = jf._new_list("Playlist", "Weekend", [], uid)  # the person's own list with the same name
        e = self.engine()
        e.connect_plex(plex.url)
        e.connect_jellyfin(jf.url, "admin", "pw")
        e.user_map["owner"] = uid
        s = e.preview()
        self.assertEqual(s["lists"], {"playlists": 1, "playlistItems": 2, "playlistItemsMissing": 1,
                                      "playlistsSkipped": 1, "collections": 1, "collectionItems": 2,
                                      "collectionItemsMissing": 0, "collectionsSkipped": 1})
        res = e.apply(s["runId"])
        self.assertEqual((res["playlistsCreated"], res["collectionsCreated"]), (1, 1))
        names = {v["Name"]: k for k, v in jf.items.items()}
        weekend = jf.lists("Playlist")["Weekend (from Plex)"]
        self.assertEqual([jf.items[i]["Name"] for i in weekend], ["Rated", "Watched"])  # Plex order, missing skipped
        self.assertEqual(jf.items[own]["children"], [])  # the person's own list untouched
        self.assertEqual(sorted(jf.items[i]["Name"] for i in jf.lists("BoxSet")["Faves"]), ["Resume", "Watched"])
        # idempotent re-run: nothing duplicated
        res2 = e.apply(e.preview()["runId"])
        self.assertEqual((res2.get("playlistsUpToDate"), res2.get("collectionsUpToDate")), (1, 1))
        self.assertEqual(len(jf.lists("Playlist")), 2)
        # undo removes only what the app created
        removed = e.remove_owned()
        self.assertEqual(sorted(r["kind"] for r in removed), ["collection", "playlist"])
        self.assertEqual(list(jf.lists("Playlist")), ["Weekend"])
        self.assertIn(own, jf.items)
        self.assertEqual(plex.violations, [])


if __name__ == "__main__":
    unittest.main()
