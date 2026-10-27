"""In-process fake Plex server, plex.tv and Jellyfin for automated tests.

Shapes follow responses captured from real Plex 1.43.4 and Jellyfin 12.0 in the isolated lab
(see ../lab/). Known real quirks are reproduced: Jellyfin ignores Rating/LastPlayedDate=null, its rating
DELETE clears Rating+Likes; Plex history only contains real plays. The fake Plex server rejects and
records any non-GET request so tests can prove the product never writes to Plex.
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class _Server:
    def __init__(self, app):
        self.app = app
        handler = self._handler()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def _handler(self):
        app = self.app

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _do(self):
                u = urlparse(self.path)
                q = {k: v[-1] for k, v in parse_qs(u.query).items()}
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"null") if n else None
                status, payload = app.handle(self.command, u.path, q, dict(self.headers), body)
                raw = b"" if payload is None else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            do_GET = do_POST = do_PUT = do_DELETE = _do

        return H

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


# ----------------------------------------------------------------------------------------------- Plex
def plex_movie(rk, title, year, file, guids=(), view_count=0, offset=0, last=None, rating=None):
    d = {"ratingKey": str(rk), "type": "movie", "title": title, "year": year,
         "Media": [{"Part": [{"file": f} for f in ([file] if isinstance(file, str) else file)]}],
         "Guid": [{"id": g} for g in guids]}
    return _state(d, view_count, offset, last, rating)


def plex_episode(rk, show, season, ep, file, guids=(), view_count=0, offset=0, last=None, rating=None):
    d = {"ratingKey": str(rk), "type": "episode", "title": f"Ep {ep}", "grandparentTitle": show,
         "parentIndex": season, "index": ep, "Media": [{"Part": [{"file": file}]}], "Guid": [{"id": g} for g in guids]}
    return _state(d, view_count, offset, last, rating)


def _state(d, view_count, offset, last, rating):
    if view_count:
        d["viewCount"] = view_count
    if offset:
        d["viewOffset"] = offset
    if last:
        d["lastViewedAt"] = last
    if rating is not None:
        d["userRating"] = rating
    return d


class FakePlex:
    """sections: list of {key,type,title,locations,items:[...]}; per-token state overrides via user_states."""

    def __init__(self, sections, tokens=None, history=None, accounts=None, machine="machine-1"):
        self.sections = sections
        self.tokens = tokens  # None -> unclaimed/local-network access; else {token: user_key}
        self.user_states = {}  # user_key -> {ratingKey: {viewCount..}}
        self.history = history or []  # [{accountID, ratingKey, viewedAt}]
        self.accounts = accounts or [{"id": 1, "name": "Owner"}]
        self.machine = machine
        self.violations = []
        self.requests = 0
        self.playlists = {}  # user_key -> [{key, title, smart, items:[ratingKey]}]
        self.server = _Server(self)
        self.url = self.server.url

    def handle(self, method, path, q, headers, body):
        self.requests += 1
        if method != "GET":
            self.violations.append((method, path))
            return 405, None
        if path == "/identity":
            return 200, {"MediaContainer": {"machineIdentifier": self.machine, "version": "1.43.4-fake",
                                            "claimed": self.tokens is not None}}
        user = "owner"
        if self.tokens is not None:
            tok = headers.get("X-Plex-Token")
            if tok not in self.tokens:
                return 401, None
            user = self.tokens[tok]
        if path == "/library/sections":
            return 200, {"MediaContainer": {"Directory": [
                {"key": s["key"], "type": s["type"], "title": s["title"],
                 "Location": [{"path": p} for p in s["locations"]]} for s in self.sections]}}
        m = re.fullmatch(r"/library/sections/(\w+)/all", path)
        if m:
            sec = next(s for s in self.sections if s["key"] == m.group(1))
            want = "movie" if q.get("type") == "1" else "episode"
            items = [self._view(i, user) for i in sec["items"] if i["type"] == want]
            start, size = int(q.get("X-Plex-Container-Start", 0)), int(q.get("X-Plex-Container-Size", 10**9))
            return 200, {"MediaContainer": {"totalSize": len(items), "Metadata": items[start:start + size]}}
        if path == "/playlists":
            return 200, {"MediaContainer": {"Metadata": [{"ratingKey": pl["key"], "title": pl["title"],
                                                          "smart": pl.get("smart", False)}
                                                         for pl in self.playlists.get(user, [])]}}
        m = re.fullmatch(r"/playlists/(\w+)/items", path)
        if m:
            pl = next(pl for pl in self.playlists.get(user, []) if pl["key"] == m.group(1))
            rows = [{"ratingKey": k} for k in pl["items"]]
            return 200, {"MediaContainer": {"totalSize": len(rows), "Metadata": rows}}
        m = re.fullmatch(r"/library/sections/(\w+)/collections", path)
        if m:
            sec = next(s for s in self.sections if s["key"] == m.group(1))
            return 200, {"MediaContainer": {"Metadata": [{"ratingKey": c["key"], "title": c["title"],
                                                          "smart": c.get("smart", False)}
                                                         for c in sec.get("collections", [])]}}
        m = re.fullmatch(r"/library/collections/(\w+)/children", path)
        if m:
            col = next(c for s in self.sections for c in s.get("collections", []) if c["key"] == m.group(1))
            rows = [{"ratingKey": k} for k in col["items"]]
            return 200, {"MediaContainer": {"totalSize": len(rows), "Metadata": rows}}
        if path == "/accounts":
            return 200, {"MediaContainer": {"Account": self.accounts}}
        if path == "/status/sessions/history/all":
            rows = [h for h in self.history if str(h["accountID"]) == q.get("accountID")]
            start, size = int(q.get("X-Plex-Container-Start", 0)), int(q.get("X-Plex-Container-Size", 10**9))
            return 200, {"MediaContainer": {"totalSize": len(rows), "Metadata": rows[start:start + size]}}
        return 404, None

    def _view(self, item, user):
        if user == "owner":
            return item
        base = {k: v for k, v in item.items() if k not in ("viewCount", "viewOffset", "lastViewedAt", "userRating")}
        base.update(self.user_states.get(user, {}).get(item["ratingKey"], {}))
        return base

    def close(self):
        self.server.close()


class FakePlexTv:
    def __init__(self, servers_by_token, home_users=(), switch_tokens=None, polls_before_auth=1,
                 owner_token="account-owner"):
        self.servers_by_token = servers_by_token
        self.home = list(home_users)
        self.switch_tokens = switch_tokens or {}
        self.polls_before_auth = polls_before_auth
        self.owner_token = owner_token
        self.pins = {}
        self.server = _Server(self)
        self.url = self.server.url

    def handle(self, method, path, q, headers, body):
        if path == "/api/v2/pins" and method == "POST":
            pid = len(self.pins) + 1
            self.pins[pid] = 0
            return 201, {"id": pid, "code": f"CODE{pid}"}
        m = re.fullmatch(r"/api/v2/pins/(\d+)", path)
        if m:
            pid = int(m.group(1))
            self.pins[pid] += 1
            done = self.pins[pid] > self.polls_before_auth
            return 200, {"id": pid, "authToken": self.owner_token if done else None}
        tok = headers.get("X-Plex-Token")
        if path == "/api/v2/resources":
            return 200, self.servers_by_token.get(tok, [])
        if path == "/api/v2/home/users" and tok == self.owner_token:
            return 200, {"users": self.home}
        m = re.fullmatch(r"/api/v2/home/users/([\w-]+)/switch", path)
        if m and method == "POST" and tok == self.owner_token:
            user = next(u for u in self.home if u["uuid"] == m.group(1))
            if user.get("protected") and q.get("pin") != user.get("pin"):
                return 403, None
            return 201, {"authToken": self.switch_tokens[m.group(1)]}
        return 404, None

    def close(self):
        self.server.close()


# ------------------------------------------------------------------------------------------- Jellyfin
class FakeJellyfin:
    """filesystem: {jellyfin_path_of_library_root: [item specs]}; item spec keys: Name, Type, files,
    SeriesName, ParentIndexNumber, IndexNumber, IndexNumberEnd, ProviderIds."""

    def __init__(self, filesystem, wizard_done=True, admin=("admin", "pw")):
        self.fs = filesystem
        self.wizard_done = wizard_done
        self.users = {}
        self.tokens = {}
        self.folders = []
        self.items = {}
        self.userdata = {}
        self.fail_writes_after = None
        self.revoke_after_writes = None
        self.writes = 0
        self.prefs = {}
        if wizard_done:
            self._new_user(admin[0], admin[1], admin=True)
        self.server = _Server(self)
        self.url = self.server.url
        self.lock = threading.Lock()

    def _new_user(self, name, pw, admin=False):
        uid = uuid.uuid4().hex
        self.users[uid] = {"Id": uid, "Name": name, "pw": pw,
                           "Policy": {"IsAdministrator": admin, "EnableAllFolders": True, "EnabledFolders": [],
                                      "AuthenticationProviderId": "x", "PasswordResetProviderId": "y"}}
        return self.users[uid]

    def _pub(self, u):
        return {"Id": u["Id"], "Name": u["Name"], "Policy": u["Policy"]}

    def add_existing_library(self, name, path):
        self._add_folder(name, "movies", [path])

    def _add_folder(self, name, ctype, paths):
        fid = uuid.uuid4().hex
        self.folders.append({"Name": name, "CollectionType": ctype, "Locations": paths, "ItemId": fid})
        for p in paths:
            for spec in self.fs.get(p, []):
                iid = uuid.uuid4().hex
                self.items[iid] = dict(spec, Id=iid, library=fid)

    def _auth(self, headers):
        m = re.search(r'Token="([^"]+)"', headers.get("Authorization", ""))
        return self.tokens.get(m.group(1)) if m else None

    def handle(self, method, path, q, headers, body):
        with self.lock:
            return self._handle(method, path, q, headers, body)

    def _handle(self, method, path, q, headers, body):
        if path == "/System/Info/Public":
            return 200, {"Version": "12.0.0", "Id": "jf-fake", "ServerName": "fake",
                         "StartupWizardCompleted": self.wizard_done}
        if path.startswith("/Startup/"):
            if self.wizard_done:
                return 401, None
            if path == "/Startup/User" and method == "POST":
                self._new_user(body["Name"], body["Password"], admin=True)
            if path == "/Startup/Complete":
                self.wizard_done = True
            return 204, None
        if path == "/Users/AuthenticateByName":
            for u in self.users.values():
                if u["Name"] == body["Username"] and u["pw"] == body["Pw"]:
                    tok = uuid.uuid4().hex
                    self.tokens[tok] = u["Id"]
                    return 200, {"AccessToken": tok, "User": self._pub(u)}
            return 401, None
        uid = self._auth(headers)
        if not uid:
            return 401, None
        me = self.users[uid]
        admin = me["Policy"]["IsAdministrator"]
        if path == "/Sessions/Logout":
            self.tokens = {t: v for t, v in self.tokens.items() if v != uid}
            return 204, None
        if path == "/Users/Me":
            return 200, self._pub(me)
        if path == "/Users" and method == "GET":
            return 200, [self._pub(u) for u in self.users.values()]
        if path == "/Users/New" and admin:
            return 200, self._pub(self._new_user(body["Name"], body["Password"]))
        m = re.fullmatch(r"/Users/(\w+)(/Policy)?", path)
        if m and admin:
            target = self.users.get(m.group(1))
            if not target:
                return 404, None
            if m.group(2):
                target["Policy"] = body
                return 204, None
            if method == "DELETE":
                del self.users[target["Id"]]
                return 204, None
            return 200, self._pub(target)
        if path == "/Library/VirtualFolders":
            if method == "GET":
                return 200, self.folders
            if method == "POST" and admin:
                paths = [p["Path"] for p in body["LibraryOptions"]["PathInfos"]]
                self._add_folder(q["name"], q.get("collectionType"), paths)
                return 204, None
            if method == "DELETE" and admin:
                f = next(f for f in self.folders if f["Name"] == q["name"])
                self.folders.remove(f)
                self.items = {k: v for k, v in self.items.items() if v["library"] != f["ItemId"]}
                return 204, None
        if path == "/Environment/ValidatePath":
            ok = body["Path"] in self.fs or any(body["Path"] == r.rsplit("/", 1)[0] for r in self.fs)
            return (204, None) if ok else (404, None)
        if path == "/Environment/Drives":
            return 200, [{"Path": "/"}]
        if path == "/Environment/DirectoryContents":
            base = q["path"].rstrip("/")
            kids = set()
            for root in self.fs:
                if root.startswith(base + "/"):
                    kids.add(base + "/" + root[len(base) + 1:].split("/")[0])
            return 200, [{"Path": k} for k in sorted(kids)]
        if path == "/ScheduledTasks":
            return 200, [{"Key": "RefreshLibrary", "State": "Idle"}]
        if path == "/Library/Refresh":
            return 204, None
        if path == "/DisplayPreferences/usersettings":
            key = q["userId"]
            if method == "POST":  # real Jellyfin merges CustomPrefs; absent keys are kept
                old = self.prefs.get(key, {"CustomPrefs": {"skipForwardLength": "30000"}})
                merged = dict(old.get("CustomPrefs") or {})
                merged.update(body.get("CustomPrefs") or {})
                self.prefs[key] = dict(body, CustomPrefs=merged)
                return 204, None
            return 200, self.prefs.get(key, {"Id": "x", "CustomPrefs": {"skipForwardLength": "30000"}, "Client": "emby"})
        if path == "/Playlists" and method == "POST":
            return 200, {"Id": self._new_list("Playlist", body["Name"], body["Ids"], body["UserId"])}
        if path == "/Collections" and method == "POST":
            ids = [i for i in (q.get("ids") or "").split(",") if i]
            return 200, {"Id": self._new_list("BoxSet", q["name"], ids, None)}
        m = re.fullmatch(r"/(Playlists|Collections)/(\w+)/Items", path)
        if m:
            lst = self.items[m.group(2)]
            if method == "POST":
                lst["children"] += [i for i in q["ids"].split(",") if i]
                return 204, None
            return 200, {"Items": [{"Id": i} for i in lst["children"]]}
        m = re.fullmatch(r"/Items/(\w+)", path)
        if m and method == "DELETE":
            self.items.pop(m.group(1), None)
            return 204, None
        if path == "/Items" and q.get("parentId") in self.items:
            return 200, {"Items": [{"Id": i} for i in self.items[q["parentId"]]["children"]]}
        if path == "/Items" and q.get("includeItemTypes") in ("Playlist", "BoxSet"):
            t, target_uid = q["includeItemTypes"], q.get("userId", uid)
            rows = [{"Id": i["Id"], "Name": i["Name"]} for i in self.items.values()
                    if i["Type"] == t and i.get("owner") in (None, target_uid)]
            return 200, {"Items": rows, "TotalRecordCount": len(rows)}
        if path == "/Items":
            target_uid = q.get("userId", uid)
            kinds = set((q.get("includeItemTypes") or "Movie,Episode").split(","))
            rows = [self._item_json(i, target_uid) for i in self.items.values() if i["Type"] in kinds]
            rows.sort(key=lambda r: r["Id"])
            start, limit = int(q.get("startIndex", 0)), int(q.get("limit", 10**9))
            return 200, {"Items": rows[start:start + limit] if limit else [], "TotalRecordCount": len(rows)}
        m = re.fullmatch(r"/UserItems/(\w+)/UserData", path)
        if m:
            key = (q.get("userId", uid), m.group(1))
            if m.group(1) not in self.items:
                return 404, None
            if method == "POST":
                self.writes += 1
                if self.revoke_after_writes is not None and self.writes > self.revoke_after_writes:
                    self.tokens.clear()
                    return 401, None
                if self.fail_writes_after is not None and self.writes > self.fail_writes_after:
                    return 500, None
                ud = self.userdata.setdefault(key, {})
                for k, v in body.items():
                    if v is None and k in ("Rating", "LastPlayedDate"):
                        continue  # real Jellyfin ignores null for these
                    ud[k] = v
            return 200, self._ud(key)
        m = re.fullmatch(r"/UserItems/(\w+)/Rating", path)
        if m:
            key = (q.get("userId", uid), m.group(1))
            ud = self.userdata.setdefault(key, {})
            if method == "DELETE":
                ud.pop("Rating", None)
                ud.pop("Likes", None)
            else:
                ud["Likes"] = q.get("likes") == "true"
            return 200, self._ud(key)
        if path == "/UserItems/Resume":
            target_uid = q.get("userId", uid)
            rows = [self._item_json(i, target_uid) for i in self.items.values()
                    if self.userdata.get((target_uid, i["Id"]), {}).get("PlaybackPositionTicks")]
            return 200, {"Items": rows}
        return 404, None

    def _new_list(self, kind, name, ids, owner):
        iid = uuid.uuid4().hex
        self.items[iid] = {"Id": iid, "Name": name, "Type": kind, "children": list(ids), "owner": owner,
                           "files": [""], "library": None}
        return iid

    def lists(self, kind):
        return {i["Name"]: i["children"] for i in self.items.values() if i["Type"] == kind}

    def _ud(self, key):
        ud = {"Played": False, "PlayCount": 0, "PlaybackPositionTicks": 0, "IsFavorite": False}
        ud.update(self.userdata.get(key, {}))
        return ud

    def _item_json(self, i, uid):
        return {"Id": i["Id"], "Name": i["Name"], "Type": i["Type"], "Path": i["files"][0],
                "MediaSources": [{"Path": f} for f in i["files"]], "ProviderIds": i.get("ProviderIds", {}),
                "SeriesName": i.get("SeriesName"), "ParentIndexNumber": i.get("ParentIndexNumber"),
                "IndexNumber": i.get("IndexNumber"), "IndexNumberEnd": i.get("IndexNumberEnd"),
                "UserData": self._ud((uid, i["Id"]))}

    def state(self, uid, name):
        iid = next(k for k, v in self.items.items() if v["Name"] == name)
        return self._ud((uid, iid))

    def user_id(self, name):
        return next(u["Id"] for u in self.users.values() if u["Name"] == name)

    def close(self):
        self.server.close()


def epoch(y, m, d):
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp())
