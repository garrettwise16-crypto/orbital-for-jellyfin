"""Migration orchestration shared by the guided UI and the command line."""
from __future__ import annotations

import csv
import dataclasses
import os
import io
import secrets
import string
import threading
import time
import uuid
from urllib.parse import urlparse
from collections import defaultdict
from pathlib import Path, PurePath, PureWindowsPath

from . import journal as J
from .jellyfin import COLLECTION_TYPES, Jellyfin
from .matching import AMBIGUOUS, MATCHED, JellyfinIndex, norm_path
from .netio import HttpError
from .planner import KEPT, SKIPPED, UNCHANGED, fields_hold, plan_item
from .plex import PLEX_TV, PlexAccountService, PlexRecord, PlexServer, Section

DEFAULT_PLEX_URLS = ["http://127.0.0.1:32400"]
DEFAULT_JELLYFIN_URLS = ["http://127.0.0.1:8096"]
SCAN_TIMEOUT_S = 6 * 3600


class Cancelled(Exception):
    pass


@dataclasses.dataclass
class SourceUser:
    key: str
    name: str
    plex: PlexServer | None
    completeness: str = "full"  # full | history_only | unavailable
    note: str = ""


def generate_password(n: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(n // 4 + 1)]
    return "-".join(groups)[: n + n // 4]


def _basename(p: str) -> str:
    return PurePath(p.replace("\\", "/")).name


def _parent(p: str) -> str:
    q = p.replace("\\", "/").rstrip("/")
    return q.rsplit("/", 1)[0] if "/" in q else ""


class Engine:
    def __init__(self, data_dir: Path, plex_tv_base: str = PLEX_TV):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        id_file = self.data_dir / "client-id"
        if not id_file.exists():
            id_file.write_text(uuid.uuid4().hex)
        self.client_id = id_file.read_text().strip()
        self.journal = J.Journal(self.data_dir / "journal.sqlite")
        self.plex_tv = PlexAccountService(self.client_id, base=plex_tv_base)
        self.plex: PlexServer | None = None
        self.plex_identity: dict = {}
        self.plex_account_token: str | None = None
        self.jf: Jellyfin | None = None
        self.jf_info: dict = {}
        self.sources: list[SourceUser] = []
        self.user_map: dict[str, str] = {}  # source key -> jellyfin user id
        self.path_map: list[tuple[str, str]] = []
        self.selected_sections: set[str] | None = None
        self.copy_lists = True
        self.orbital_webdir_hint: str | None = os.environ.get("FPMIGRATE_JF_WEBDIR")
        self.progress = {"phase": "idle", "done": 0, "total": 0, "message": ""}
        self.cancel_event = threading.Event()
        self._pin: dict | None = None

    # -- progress ---------------------------------------------------------------------------------
    def _p(self, phase: str, done: int = 0, total: int = 0, message: str = ""):
        self.progress = {"phase": phase, "done": done, "total": total, "message": message, "at": time.time()}
        if self.cancel_event.is_set():
            raise Cancelled()

    # -- discovery --------------------------------------------------------------------------------
    @staticmethod
    def detect(plex_urls=None, jellyfin_urls=None, include_defaults: bool = True) -> dict:
        out = {"plex": [], "jellyfin": []}
        # An address the person typed is the only one used: never fall back silently to another server.
        plex_candidates = plex_urls if plex_urls else (DEFAULT_PLEX_URLS if include_defaults else [])
        jf_candidates = jellyfin_urls if jellyfin_urls else (DEFAULT_JELLYFIN_URLS if include_defaults else [])
        for url in plex_candidates:
            if any(p["url"] == url for p in out["plex"]):
                continue
            try:
                ident = PlexServer(url).identity()
                readable = PlexServer(url).can_read_library()
                out["plex"].append({"url": url, "found": True, "version": ident.get("version"),
                                    "machineIdentifier": ident.get("machineIdentifier"),
                                    "claimed": ident.get("claimed"), "needsSignIn": not readable})
            except HttpError:
                out["plex"].append({"url": url, "found": False})
        for url in jf_candidates:
            if any(p["url"] == url for p in out["jellyfin"]):
                continue
            try:
                info = Jellyfin(url).public_info()
                if not isinstance(info, dict):
                    raise ValueError("not json")
                out["jellyfin"].append({"url": url, "found": True, "version": info.get("Version"),
                                        "serverName": info.get("ServerName"), "id": info.get("Id"),
                                        "wizardCompleted": bool(info.get("StartupWizardCompleted"))})
            except ValueError:  # answered, but not with its info yet: Jellyfin is still starting
                out["jellyfin"].append({"url": url, "found": False, "starting": True})
            except HttpError as exc:
                out["jellyfin"].append({"url": url, "found": False, "starting": exc.status == 503})
        return out

    # -- Plex connection --------------------------------------------------------------------------
    def connect_plex(self, url: str, token: str | None = None) -> dict:
        server = PlexServer(url, token, self.client_id)
        ident = server.identity()
        if not server.can_read_library():
            raise PermissionError("Plex needs you to sign in before its libraries can be read")
        self.plex, self.plex_identity = server, ident
        self.sources = [SourceUser("owner", "Plex server owner", server)]
        return {"version": ident.get("version"), "machineIdentifier": ident.get("machineIdentifier")}

    def plex_signin_start(self) -> dict:
        self._pin = self.plex_tv.start_pin()
        return {"authUrl": self._pin["authUrl"]}

    def plex_signin_poll(self, url: str) -> dict:
        if not self._pin:
            return {"status": "not_started"}
        token = self.plex_tv.poll_pin(self._pin["id"])
        if not token:
            return {"status": "waiting"}
        self._pin = None
        self.plex_account_token = token
        machine = PlexServer(url).identity().get("machineIdentifier")
        for srv in self.plex_tv.servers(token):
            if srv["machineIdentifier"] == machine:
                if not srv["owned"]:
                    return {"status": "not_owner", "message": "This Plex account does not own the server on this PC."}
                self.connect_plex(url, srv["accessToken"])
                return {"status": "connected"}
        return {"status": "server_not_in_account",
                "message": "Signed in, but this Plex server is not linked to that Plex account."}

    def add_home_users(self, pins: dict | None = None) -> list[dict]:
        """Add Plex Home profiles as sources (full state, read via each profile's own server token)."""
        if not (self.plex_account_token and self.plex):
            return []
        machine = self.plex_identity.get("machineIdentifier")
        added = []
        for hu in self.plex_tv.home_users(self.plex_account_token):
            if hu["admin"]:
                continue
            key = f"home:{hu['uuid']}"
            if any(s.key == key for s in self.sources):
                continue
            pin = (pins or {}).get(hu["uuid"])
            if hu["protected"] and not pin:
                src = SourceUser(key, hu["title"], None, "unavailable", "profile PIN required")
            else:
                try:
                    user_token = self.plex_tv.switch_home_user(self.plex_account_token, hu["uuid"], pin)
                    token = next((s["accessToken"] for s in self.plex_tv.servers(user_token)
                                  if s["machineIdentifier"] == machine), None)
                    src = (SourceUser(key, hu["title"], PlexServer(self.plex.base_url, token, self.client_id))
                           if token else SourceUser(key, hu["title"], None, "unavailable", "profile has no access"))
                except HttpError as exc:
                    src = SourceUser(key, hu["title"], None, "unavailable", f"could not open profile ({exc.status})")
            self.sources.append(src)
            added.append({"key": src.key, "name": src.name, "completeness": src.completeness, "note": src.note})
        return added

    def add_history_accounts(self) -> list[dict]:
        """Other server accounts (e.g. friends): watched items from Plex's play history only."""
        if not self.plex:
            return []
        added = []
        for acc in self.plex.accounts():
            aid = int(acc.get("id") or 0)
            if aid <= 1 or any(s.key == f"account:{aid}" for s in self.sources):
                continue
            src = SourceUser(f"account:{aid}", acc.get("name") or f"Account {aid}", self.plex, "history_only",
                             "watched items from Plex play history only; no resume points")
            self.sources.append(src)
            added.append({"key": src.key, "name": src.name, "completeness": src.completeness, "note": src.note})
        return added

    # -- Jellyfin connection ----------------------------------------------------------------------
    def connect_jellyfin(self, url: str, username: str, password: str, create_admin: bool = False) -> dict:
        jf = Jellyfin(url, device_id=self.client_id)
        info = jf.wait_until_ready(60)
        if not info.get("StartupWizardCompleted"):
            if not create_admin:
                raise RuntimeError("Jellyfin has not been set up yet; choose to create the administrator account")
            jf.complete_startup(username, password)
            info = jf.wait_until_ready(60)
        user = jf.authenticate(username, password)
        if not (user.get("Policy") or {}).get("IsAdministrator"):
            jf.logout()
            raise PermissionError("This Jellyfin account is not an administrator")
        self.jf, self.jf_info = jf, info
        self.journal.bind_server(str(info.get("Id") or "") + "@" + jf.base_url)
        return {"version": info.get("Version"), "serverName": info.get("ServerName"), "user": user.get("Name"),
                "userId": user.get("Id")}

    # -- libraries --------------------------------------------------------------------------------
    def _mapped(self, plex_path: str) -> str | None:
        np = norm_path(plex_path)
        for src, dst in self.path_map:
            ns = norm_path(src)
            if np == ns or np.startswith(ns + "/"):
                rest = plex_path.replace("\\", "/")[len(src.replace("\\", "/").rstrip("/")):]
                sep = "\\" if "\\" in dst else "/"
                return dst.rstrip("/\\") + rest.replace("/", sep)
        return None

    def _suggest(self, plex_path: str, max_listings: int = 120) -> str | None:
        """Bounded search of Jellyfin-visible folders for a folder with the same name."""
        want = _basename(plex_path).casefold()
        frontier = [(d, 0) for d in self.jf.drives()]
        seen = 0
        while frontier and seen < max_listings:
            path, depth = frontier.pop(0)
            seen += 1
            try:
                children = self.jf.directory_contents(path)
            except HttpError:
                continue
            for c in children:
                if _basename(c).casefold() == want:
                    return c
                if depth < 2:
                    frontier.append((c, depth + 1))
        return None

    def resolve_path(self, plex_path: str) -> tuple[str | None, str]:
        if self.jf.validate_path(plex_path):
            return plex_path, "same"
        mapped = self._mapped(plex_path)
        if mapped and self.jf.validate_path(mapped):
            return mapped, "mapped"
        found = self._suggest(plex_path)
        if found:
            self.path_map.append((_parent(plex_path), _parent(found)))
            return found, "found"
        return None, "missing"

    def library_plan(self) -> list[dict]:
        vfs = self.jf.virtual_folders()
        names = {v["Name"].casefold() for v in vfs}
        rows = []
        for sec in self.plex.sections():
            row = {"sectionKey": sec.key, "title": sec.title, "kind": sec.kind, "plexPaths": sec.locations,
                   "stateSupported": sec.state_supported, "jfPaths": [], "action": "", "libraryName": "",
                   "libraryId": None, "problems": []}
            if sec.kind not in COLLECTION_TYPES:
                row["action"] = "unsupported"
                row["problems"].append("This Plex library type is not migrated")
                rows.append(row)
                continue
            for loc in sec.locations:
                target, how = self.resolve_path(loc)
                if target is None:
                    row["problems"].append(f"Jellyfin cannot see {loc}")
                else:
                    row["jfPaths"].append(target)
            existing = None
            for v in vfs:
                vl = {norm_path(x) for x in v.get("Locations") or []}
                if row["jfPaths"] and all(norm_path(p) in vl for p in row["jfPaths"]):
                    existing = v
                    break
            if existing:
                row.update(action="reuse", libraryName=existing["Name"], libraryId=existing.get("ItemId"))
            elif row["problems"]:
                row["action"] = "needs_path"
            else:
                name = sec.title if sec.title.casefold() not in names else f"{sec.title} (from Plex)"
                row.update(action="create", libraryName=name)
            rows.append(row)
        return rows

    def set_library_path(self, plex_path: str, jf_path: str) -> bool:
        if not self.jf.validate_path(jf_path):
            return False
        self.path_map.insert(0, (plex_path, jf_path))
        return True

    def apply_libraries(self, rows: list[dict], run_tag: str = "setup") -> list[dict]:
        created = []
        before = {v["Name"] for v in self.jf.virtual_folders()}
        for row in rows:
            if row.get("action") != "create" or not row.get("include", True):
                continue
            self._p("libraries", len(created), len(rows), f"Creating {row['libraryName']}")
            self.jf.add_library(row["libraryName"], COLLECTION_TYPES[row["kind"]], row["jfPaths"])
            created.append(row["libraryName"])
        for v in self.jf.virtual_folders():
            if v["Name"] in created and v["Name"] not in before:
                self.journal.add_owned(run_tag, "library", v.get("ItemId") or "", v["Name"])
        if created:
            self.wait_for_scan()
        return created

    def wait_for_scan(self, timeout_s: float = SCAN_TIMEOUT_S, settle_s: float = 6.0) -> None:
        start = time.time()
        uid = self.jf.user_id
        last, stable_since = -1, None
        while time.time() - start < timeout_s:
            running, pct = self.jf.library_scan_running()
            count = self.jf.count_items(uid)
            self._p("scan", int(pct or 0), 100, f"Jellyfin is reading your library: {count} videos found")
            if not running and count == last:
                stable_since = stable_since or time.time()
                if time.time() - stable_since >= settle_s:
                    return
            else:
                stable_since = None
            last = count
            time.sleep(2)
        raise TimeoutError("Jellyfin is still scanning; you can continue later")

    # -- users ------------------------------------------------------------------------------------
    def user_plan(self) -> dict:
        jf_users = self.jf.users()
        by_name = {u["Name"].casefold(): u for u in jf_users}
        rows = []
        for s in self.sources:
            if s.key == "owner":
                suggestion = {"mode": "existing", "jfUserId": self.jf.user_id}
            elif s.name.casefold() in by_name:
                suggestion = {"mode": "existing", "jfUserId": by_name[s.name.casefold()]["Id"]}
            else:
                suggestion = {"mode": "create", "name": s.name}
            rows.append({"key": s.key, "name": s.name, "completeness": s.completeness, "note": s.note,
                         "suggestion": suggestion, "mappedTo": self.user_map.get(s.key)})
        return {"sources": rows, "jellyfinUsers": [{"id": u["Id"], "name": u["Name"],
                                                    "admin": bool((u.get("Policy") or {}).get("IsAdministrator"))}
                                                   for u in jf_users]}

    def apply_users(self, choices: dict, library_ids: list[str], run_tag: str = "setup") -> list[dict]:
        """choices: source key -> {'mode': 'existing'|'create'|'skip', 'jfUserId'?, 'name'?}.
        Returns one-time passwords for created users (never stored)."""
        created = []
        for s in self.sources:
            c = choices.get(s.key) or {"mode": "skip"}
            if c["mode"] == "skip" or s.completeness == "unavailable":
                self.user_map.pop(s.key, None)
            elif c["mode"] == "existing":
                self.user_map[s.key] = c["jfUserId"]
            elif c["mode"] == "create":
                password = generate_password()
                user = self.jf.create_user(c.get("name") or s.name, password)
                policy = dict(self.jf.user(user["Id"]).get("Policy") or {})
                policy.update({"IsAdministrator": False, "EnableAllFolders": False,
                               "EnabledFolders": [i for i in library_ids if i]})
                self.jf.set_policy(user["Id"], policy)
                self.journal.add_owned(run_tag, "user", user["Id"], user["Name"])
                self.user_map[s.key] = user["Id"]
                created.append({"name": user["Name"], "password": password})
        return created

    PLEX_LIKE_HOME = {"homesection0": "resume", "homesection1": "nextup", "homesection2": "latestmedia",
                      "homesection3": "smalllibrarytiles"}

    def apply_home_layout(self, run_tag: str = "setup") -> int:
        """Continue Watching first, like Plex, for mapped people whose Home is still Jellyfin's default."""
        changed = 0
        for jf_user in sorted(set(self.user_map.values())):
            prefs = self.jf.home_prefs(jf_user)
            custom = dict(prefs.get("CustomPrefs") or {})
            if any(k.startswith("homesection") and v for k, v in custom.items()):
                continue  # the person arranged their Home already; leave it
            prefs["CustomPrefs"] = {**custom, **self.PLEX_LIKE_HOME}
            self.jf.set_home_prefs(jf_user, prefs)
            self.journal.add_owned(run_tag, "homelayout", jf_user, "Home layout", "plex-like-v1")
            changed += 1
        return changed

    # -- Orbital look (owner-approved web shell layer) ----------------------------------------------
    def orbital_status(self) -> dict:
        from . import orbital
        if not self.jf:
            return {"available": False, "reason": "Connect Jellyfin first."}
        if urlparse(self.jf.base_url).hostname not in ("localhost", "127.0.0.1", "::1") and not self.orbital_webdir_hint:
            return {"available": False, "reason": "Run this setup app on the computer running Jellyfin to add its web look. Your connected server has not been changed."}
        version = self.jf_info.get("Version")
        if not orbital.supported(version):
            return {"available": False, "reason": f"Not yet tested with Jellyfin {version}; Jellyfin keeps its own look."}
        webdir = orbital.find_webdir(self.orbital_webdir_hint)
        if not webdir:
            return {"available": False, "reason": "Jellyfin's web files weren't found on this PC (for example, Jellyfin "
                                                  "runs on another computer or in Docker), so its own look stays."}
        return {"available": True, **orbital.status(webdir)}

    def _layer(self, action: str, webdir: Path) -> dict:
        from . import elevate, orbital
        if elevate.needs_elevation(webdir):
            return elevate.run_layer_action(action, webdir)
        return orbital.install(webdir) if action == "install" else orbital.remove(webdir)

    def install_orbital(self, run_tag: str = "setup") -> dict:
        from . import orbital
        st = self.orbital_status()
        if not st["available"]:
            raise RuntimeError(st["reason"])
        webdir = Path(st["webdir"])
        result = self._layer("install", webdir)
        if not any(o["kind"] == "orbital" and o["jfId"] == str(webdir) for o in self.journal.owned()):
            self.journal.add_owned(run_tag, "orbital", str(webdir), "Orbital look", orbital.manifest()["layer"])
        return result

    def remove_orbital(self) -> dict:
        removed = {}
        for o in self.journal.owned():
            if o["kind"] == "orbital":
                removed = self._layer("remove", Path(o["jfId"]))
                self.journal.mark_owned_removed("orbital", o["jfId"])
        return removed

    # -- Sports (Orbital Sports plugin; free) ----------------------------------------------------
    def sports_status(self) -> dict:
        from . import sports
        if not self.jf:
            return {"available": False, "reason": "Connect Jellyfin first."}
        if not sports.available():
            return {"available": False, "reason": "Sports isn't included in this download."}
        version = self.jf_info.get("Version") or ""
        if ".".join(version.split(".")[:2]) not in ("12.0", "12.1", "12.2", "12.4"):  # verified on native Windows
            return {"available": False, "reason": f"Sports isn't tested with Jellyfin {version} yet."}
        try:
            current = sports.status(self.jf)
        except HttpError:
            current = {}
        if current.get("deployment") == "standalone":
            return {"available": True, **current}
        external = os.environ.get("FPMIGRATE_SPORTS_SERVICE_URL")
        if not external and urlparse(self.jf.base_url).hostname not in ("localhost", "127.0.0.1", "::1"):
            return {"available": False, "reason": "Run this setup app on the Jellyfin computer to add Sports automatically."}
        try:
            system = self.jf.call("GET", "/System/Info")
        except HttpError:
            system = {}
        reported_os = str(system.get("OperatingSystem") or system.get("OperatingSystemDisplayName") or "").lower()
        # Jellyfin 12.4 omits the legacy OS fields. Require an existing absolute
        # Windows data path on this Windows host; a loopback Linux container is insufficient.
        data_path = system.get("ProgramDataPath") or ""
        native_windows = "windows" in reported_os or (not reported_os and os.name == "nt"
            and PureWindowsPath(data_path).is_absolute() and Path(data_path).is_dir())
        if not external and not native_windows:
            return {"available": False, "reason": "Sports runs next to Jellyfin on Windows; this Jellyfin runs on "
                                                  f"{system.get('OperatingSystemDisplayName') or 'another system'}."}
        try:
            current = sports.status(self.jf)
        except HttpError:
            current = {}
        return {"available": True, **current}

    def install_sports(self, run_tag: str = "setup") -> dict:
        from . import sports
        st = self.sports_status()
        if not st["available"]:
            raise RuntimeError(st["reason"])
        if st.get("deployment") == "standalone":
            return {"installed": True, "changed": False, "deployment": "standalone", "service": st["service"]}
        result = sports.install(self.jf, repo_host=os.environ.get("FPMIGRATE_SPORTS_REPO_HOST", "127.0.0.1"),
                                repo_advertise=os.environ.get("FPMIGRATE_SPORTS_REPO_HOST"),
                                progress=lambda m: self._p("libraries", 0, 0, m))
        external = os.environ.get("FPMIGRATE_SPORTS_SERVICE_URL")
        if external:  # containers: the service runs beside Jellyfin rather than inside it
            sports.configure_external(self.jf, external, os.environ.get("FPMIGRATE_SPORTS_SERVICE_SECRET", ""))
        if not any(o["kind"] == "sports" for o in self.journal.owned()):
            self.journal.add_owned(run_tag, "sports", sports.PLUGIN_ID, "Sports", result.get("version") or "")
        return result

    def sports_sources(self, settings: dict | None = None) -> dict:
        """Read (or, with settings, replace) where Sports gets its games: the TV guide is built in; TheSportsDB,
        a feed address or ESPN's public data are the person's own choice."""
        from . import sports
        if not self.jf:
            raise RuntimeError("Connect Jellyfin first.")
        return sports.set_sources(self.jf, settings) if settings is not None else sports.get_sources(self.jf)

    def sports_addons(self, body: dict | None = None) -> dict:
        """Add-ons someone else wrote (for example shared on GitHub): inspect, install after confirmation, remove."""
        from . import sports
        if not self.jf:
            raise RuntimeError("Connect Jellyfin first.")
        return sports.addons(self.jf, body)

    def remove_sports(self) -> dict:
        from . import sports
        out = {"removed": False}
        for o in self.journal.owned():
            if o["kind"] == "sports":
                out = sports.remove(self.jf)
                if out.get("removed"):  # otherwise kept, so the next run finishes the removal
                    self.journal.mark_owned_removed("sports", o["jfId"])
        return out

    # -- preview / apply / verify / rollback --------------------------------------------------------
    def _records(self, src: SourceUser, sections: list[Section]) -> list[PlexRecord]:
        if src.completeness == "full":
            out = []
            for sec in sections:
                out.extend(src.plex.leaf_items(sec))
            return out
        # history-only: map history rows onto the owner's view of the items
        owner_items = {r.rating_key: r for sec in sections for r in self.plex.leaf_items(sec)}
        aid = int(src.key.split(":", 1)[1])
        agg: dict[str, PlexRecord] = {}
        for row in self.plex.history_for_account(aid):
            base = owner_items.get(str(row.get("ratingKey")))
            if not base:
                continue
            rec = agg.get(base.rating_key) or dataclasses.replace(base, view_count=0, view_offset_ms=0,
                                                                  last_viewed_at=None, user_rating=None)
            rec.view_count += 1
            rec.last_viewed_at = max(rec.last_viewed_at or 0, int(row.get("viewedAt") or 0))
            agg[base.rating_key] = rec
        return list(agg.values())

    def preview(self, transfer_ratings: bool = True, favorite_at: float | None = None) -> dict:
        self.cancel_event.clear()
        run_id = self.journal.new_run(self.plex_identity.get("machineIdentifier", ""), self.jf_info.get("Id", ""))
        sections = [s for s in self.plex.sections() if s.state_supported
                    and (self.selected_sections is None or s.key in self.selected_sections)]
        plex_roots = {s.key: s.locations for s in sections}
        vfs = self.jf.virtual_folders()
        jf_roots = [loc for v in vfs for loc in v.get("Locations") or []]
        summary = {"runId": run_id, "users": [], "startedAt": time.time()}
        rk_to_item: dict[str, str] = {}
        for ui, src in enumerate(self.sources):
            jf_user = self.user_map.get(src.key)
            if not jf_user or src.completeness == "unavailable":
                continue
            self._p("preview", ui, len(self.sources), f"Reading Plex watch state for {src.name}")
            records = self._records(src, sections)
            self._p("preview", ui, len(self.sources), f"Reading Jellyfin library for {src.name}")
            items = list(self.jf.items(jf_user))
            index = JellyfinIndex(items, jf_roots)
            groups: dict[str, list[PlexRecord]] = defaultdict(list)
            counts = defaultdict(int)
            counts["plexItems"] = len(records)
            counts["jellyfinItems"] = len(items)
            for rec in records:
                counts["withState"] += rec.has_state
                m = index.match(rec, plex_roots.get(rec.section_key, []))
                if m.status == MATCHED:
                    rk_to_item[rec.rating_key] = m.item_id
                    counts["matched"] += 1
                    counts["by_" + m.method] += 1
                    groups[m.item_id].append(rec)
                elif rec.has_state:
                    counts["ambiguous" if m.status == AMBIGUOUS else "unmatched"] += 1
                    self.journal.add_exception(run_id, src.key, rec.rating_key, rec.label, m.status, m.reason)
                else:
                    counts["unmatchedWithoutState"] += 1
            actions = []
            for item_id, recs in groups.items():
                if not any(r.has_state for r in recs):
                    continue
                item = index.items[item_id]
                a = plan_item(item_id, recs[0].label, recs, item.state, transfer_ratings, favorite_at)
                for c in a.categories:
                    counts["cat_" + c] += 1
                if SKIPPED in a.categories:
                    self.journal.add_exception(run_id, src.key, ",".join(a.plex_keys), a.label, "skipped",
                                               "; ".join(a.notes))
                actions.append(a)
            counts["toWrite"] = sum(1 for a in actions if a.writes)
            self.journal.add_actions(run_id, src.key, jf_user, actions)
            summary["users"].append({"source": src.key, "name": src.name, "completeness": src.completeness,
                                     "jfUserId": jf_user, "counts": dict(counts)})
        if self.copy_lists:
            summary["lists"] = self._plan_lists(run_id, sections, rk_to_item)
        self.journal.set_run(run_id, "previewed", summary)
        self._p("previewed", 1, 1, "Preview ready")
        return summary

    def _plan_lists(self, run_id: str, sections: list[Section], rk_to_item: dict) -> dict:
        counts = defaultdict(int)

        def plan(src_key, jf_user, kind, entry, keys):
            if entry["smart"]:
                self.journal.add_list(run_id, src_key, jf_user, kind, entry["key"], entry["title"], [], [], "skipped",
                                      "smart (rule-based) list: Jellyfin has no equivalent, not copied")
                counts[kind + "sSkipped"] += 1
                return
            ids, seen = [], set()
            for k in keys:
                i = rk_to_item.get(k)
                if i and i not in seen:
                    ids.append(i)
                    seen.add(i)
            missing = [k for k in keys if k not in rk_to_item]
            self.journal.add_list(run_id, src_key, jf_user, kind, entry["key"], entry["title"], ids, missing,
                                  "planned" if ids else "empty",
                                  f"{len(missing)} items not found in Jellyfin" if missing else "")
            counts[kind + "s"] += 1
            counts[kind + "Items"] += len(ids)
            counts[kind + "ItemsMissing"] += len(missing)

        for src in self.sources:
            jf_user = self.user_map.get(src.key)
            if not jf_user or src.completeness != "full":
                continue
            self._p("preview", 0, 0, f"Reading playlists for {src.name}")
            for pl in src.plex.playlists():
                plan(src.key, jf_user, "playlist", pl, [] if pl["smart"] else src.plex.playlist_items(pl["key"]))
        owner_jf = self.user_map.get("owner")
        if owner_jf:
            for sec in sections:
                for col in self.plex.collections(sec):
                    plan("owner", owner_jf, "collection", col,
                         [] if col["smart"] else self.plex.collection_items(col["key"]))
        return dict(counts)

    def _apply_lists(self, run_id: str, stats: dict) -> None:
        for lst in self.journal.lists(run_id):
            if lst["status"] not in ("planned", "failed"):
                continue
            self._p("apply", 0, 0, f"Creating {lst['kind']} {lst['title']}")
            uid, ids, kind = lst["jfUserId"], lst["itemIds"], lst["kind"]
            meta = f"{kind}:{lst['sourceUser']}:{lst['plexKey']}"
            try:
                existing = self.jf.user_playlists(uid) if kind == "playlist" else self.jf.collections(uid)
                owned = self.journal.owned_by_meta(kind, meta)
                if owned and owned["jfId"] in existing.values():
                    present = set(self.jf.playlist_item_ids(owned["jfId"], uid) if kind == "playlist"
                                  else self.jf.collection_item_ids(owned["jfId"], uid))
                    add = [i for i in ids if i not in present]
                    if add:
                        if kind == "playlist":
                            self.jf.add_to_playlist(owned["jfId"], add, uid)
                        else:
                            self.jf.add_to_collection(owned["jfId"], add)
                    self.journal.mark_list(lst["rowid"], "updated" if add else "up_to_date", owned["jfId"])
                    stats[kind + ("sUpdated" if add else "sUpToDate")] += 1
                    continue
                name, n = lst["title"], 1
                while name in existing:  # never change a list the person made in Jellyfin themselves
                    name = f"{lst['title']} (from Plex)" if n == 1 else f"{lst['title']} (from Plex {n})"
                    n += 1
                jf_id = (self.jf.create_playlist(name, ids, uid) if kind == "playlist"
                         else self.jf.create_collection(name, ids))
                self.journal.add_owned(run_id, kind, jf_id, name, meta)
                renamed = None if name == lst["title"] else f"created as '{name}' because that name was taken"
                self.journal.mark_list(lst["rowid"], "created", jf_id, renamed)
                stats[kind + "sCreated"] += 1
            except HttpError as exc:
                if exc.unauthorized or exc.unreachable:
                    raise
                self.journal.mark_list(lst["rowid"], "failed", note=str(exc))
                stats[kind + "sFailed"] += 1

    def _check_run_server(self, run_id: str):
        run=self.journal.run(run_id)
        if not run or not self.jf:
            raise ValueError('Choose a saved migration and connect its Jellyfin server first.')
        current=self.jf.public_info().get('Id')
        if not current or not run.get('jellyfinId') or current!=run['jellyfinId']:
            raise ValueError('This migration belongs to a different Jellyfin server. Nothing was changed.')

    def apply(self, run_id: str) -> dict:
        self._check_run_server(run_id)
        self.cancel_event.clear()
        self.journal.set_run(run_id, "applying")
        todo = [a for a in self.journal.actions(run_id, writes_only=True)
                if a["status"] in (J.PLANNED, J.APPLIED, J.FAILED)]
        stats = defaultdict(int)
        try:
            for n, a in enumerate(todo):
                self._p("apply", n, len(todo), f"Updating {a['label']}")
                try:
                    current = self.jf.get_user_data(a["jfUserId"], a["itemId"])
                    if fields_hold(current, a["changes"]):
                        self.journal.mark(run_id, a["seq"], J.VERIFIED, after=current.to_record())
                        stats["alreadyDone"] += 1
                        continue
                    if a["status"] in (J.PLANNED, J.FAILED) and current.to_record() != a["before"]:
                        self.journal.mark(run_id, a["seq"], J.SUPERSEDED,
                                          "Jellyfin changed after the preview; preview again to include it")
                        stats["superseded"] += 1
                        continue
                    after = self.jf.update_user_data(a["jfUserId"], a["itemId"], a["changes"])
                    self.journal.mark(run_id, a["seq"], J.APPLIED, after=after.to_record())
                    check = self.jf.get_user_data(a["jfUserId"], a["itemId"])
                    if fields_hold(check, a["changes"]):
                        self.journal.mark(run_id, a["seq"], J.VERIFIED, after=check.to_record())
                        stats["verified"] += 1
                    else:
                        self.journal.mark(run_id, a["seq"], J.FAILED, "Jellyfin did not keep the new value",
                                          after=check.to_record())
                        stats["failed"] += 1
                except HttpError as exc:
                    if exc.unauthorized or exc.unreachable:
                        # outcome may be unknown: leave resumable; the next apply re-reads before writing
                        self.journal.mark(run_id, a["seq"], a["status"], str(exc))
                        raise
                    self.journal.mark(run_id, a["seq"], J.FAILED, str(exc))
                    stats["failed"] += 1
            self._apply_lists(run_id, stats)
        except Cancelled:
            self.journal.set_run(run_id, "paused")
            return {"status": "paused", **stats}
        except HttpError as exc:
            self.journal.set_run(run_id, "interrupted")
            return {"status": "interrupted", "error": str(exc), **stats}
        problems = stats["failed"] or stats["playlistsFailed"] or stats["collectionsFailed"]
        status = "completed_with_problems" if problems else "completed"
        run = self.journal.run(run_id)
        summary = run["summary"]
        summary["apply"] = dict(stats)
        self.journal.set_run(run_id, status, summary)
        self._p("applied", len(todo), len(todo), "Done")
        return {"status": status, **stats}

    def verify(self, run_id: str) -> dict:
        self._check_run_server(run_id)
        stats = defaultdict(int)
        for a in self.journal.actions(run_id, writes_only=True):
            if a["status"] != J.VERIFIED:
                stats["not_" + a["status"]] += 1
                continue
            cur = self.jf.get_user_data(a["jfUserId"], a["itemId"])
            stats["holds" if fields_hold(cur, a["changes"]) else "changedSince"] += 1
        return dict(stats)

    def rollback(self, run_id: str) -> dict:
        self._check_run_server(run_id)
        stats = defaultdict(int)
        for a in reversed(self.journal.actions(run_id, writes_only=True)):
            if a["status"] not in (J.APPLIED, J.VERIFIED):
                continue
            self._p("rollback", stats["restored"] + stats["skipped"], 0, f"Restoring {a['label']}")
            cur = self.jf.get_user_data(a["jfUserId"], a["itemId"])
            if not fields_hold(cur, a["changes"]):
                self.journal.mark(run_id, a["seq"], J.ROLLBACK_SKIPPED,
                                  "changed in Jellyfin after the migration; left as is")
                stats["skipped"] += 1
                continue
            restore, clear_rating, residual = {}, False, []
            for k in a["changes"]:
                b = a["before"].get(k)
                if k == "LastPlayedDate" and b is None:
                    residual.append(k)  # Jellyfin offers no way to erase a last-played date
                elif k == "Rating" and b is None:
                    clear_rating = True
                elif b is None and k in ("PlaybackPositionTicks", "PlayCount"):
                    restore[k] = 0
                else:
                    restore[k] = b
            after = self.jf.update_user_data(a["jfUserId"], a["itemId"], restore) if restore else cur
            if clear_rating:
                after = self.jf.clear_rating(a["jfUserId"], a["itemId"], a["before"].get("Likes"))
            exact = fields_hold(after, restore) and (not clear_rating or after.rating is None)
            self.journal.mark(run_id, a["seq"], J.ROLLED_BACK,
                              None if exact else "Jellyfin did not accept every restored value",
                              after=after.to_record())
            stats["lastPlayedDateKept"] += 1 if residual else 0
            stats["restoredInexact"] += 0 if exact else 1
            stats["restored"] += 1
        self.journal.set_run(run_id, "rolled_back")
        return dict(stats)

    def remove_owned(self, kinds=("sports", "orbital", "homelayout", "playlist", "collection", "library", "user")) -> list[dict]:
        """Undo setup: remove only what this tool created. Media files are never touched."""
        removed = []
        vfs = {v.get("ItemId"): v["Name"] for v in self.jf.virtual_folders()}
        order = {"sports": -2, "orbital": -1, "homelayout": 0, "playlist": 1, "collection": 2, "library": 3, "user": 4}
        for o in sorted(self.journal.owned(), key=lambda o: order.get(o["kind"], 9)):
            if o["kind"] not in kinds:
                continue
            if o["kind"] == "sports":
                from . import sports
                if not sports.remove(self.jf).get("removed"):  # Windows: off now, files go after Jellyfin's next start
                    removed.append({**o, "pending": True})
                    continue
            elif o["kind"] == "orbital":
                self._layer("remove", Path(o["jfId"]))
            elif o["kind"] == "homelayout":
                try:
                    prefs = self.jf.home_prefs(o["jfId"])
                    custom = dict(prefs.get("CustomPrefs") or {})
                    if all(custom.get(k) == v for k, v in self.PLEX_LIKE_HOME.items()):  # unchanged since: restore
                        for k in self.PLEX_LIKE_HOME:
                            custom[k] = None  # Jellyfin merges preferences: missing keys would be kept
                        prefs["CustomPrefs"] = custom
                        self.jf.set_home_prefs(o["jfId"], prefs)
                except HttpError as exc:
                    if exc.status != 404:
                        raise
            elif o["kind"] == "library" and o["jfId"] in vfs:
                self.jf.remove_library(vfs[o["jfId"]])
            elif o["kind"] in ("user", "playlist", "collection"):
                try:
                    if o["kind"] == "user":
                        self.jf.delete_user(o["jfId"])
                    else:
                        self.jf.delete_item(o["jfId"])
                except HttpError as exc:
                    if exc.status != 404:
                        raise
            self.journal.mark_owned_removed(o["kind"], o["jfId"])
            removed.append(o)
        if any(o["kind"] == "library" for o in removed):
            self.wait_for_scan(timeout_s=600, settle_s=4)
        return removed

    # -- reporting --------------------------------------------------------------------------------
    def report(self, run_id: str) -> dict:
        run = self.journal.run(run_id)
        statuses = defaultdict(int)
        for a in self.journal.actions(run_id, writes_only=True):
            statuses[a["status"]] += 1
        lists = [{k: v for k, v in x.items() if k not in ("itemIds", "rowid", "missing")} | {"items": len(x["itemIds"])}
                 for x in self.journal.lists(run_id)]
        return {"run": run, "writeStatus": dict(statuses), "exceptions": self.journal.exceptions(run_id), "lists": lists}

    def report_csv(self, run_id: str) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["user", "title", "result", "categories", "changes", "notes_or_reason"])
        for a in self.journal.actions(run_id):
            w.writerow([a["sourceUser"], a["label"], a["status"], " ".join(a["categories"]),
                        " ".join(sorted(a["changes"])), "; ".join(a["notes"]) or (a["error"] or "")])
        for e in self.journal.exceptions(run_id):
            w.writerow([e["sourceUser"], e["label"], e["kind"], "", "", e["reason"]])
        for x in self.journal.lists(run_id):
            w.writerow([x["sourceUser"], f"{x['kind']}: {x['title']}", x["status"], "", f"{len(x['itemIds'])} items",
                        x["note"] or ""])
        return buf.getvalue()

    def first_playback(self, source_key: str = "owner") -> dict:
        uid = self.user_map.get(source_key) or self.jf.user_id
        items = self.jf.resume_items(uid, limit=6)
        base = self.jf.base_url
        def image(i):
            target = i.get("SeriesId") if i.get("Type") == "Episode" and i.get("SeriesId") else i["Id"]
            return f"{base}/Items/{target}/Images/Primary?fillHeight=270&quality=90"
        return {"open": f"{base}/web/", "continueWatching": [
            {"name": i.get("Name"), "series": i.get("SeriesName"), "image": image(i),
             "link": f"{base}/web/#/details?id={i['Id']}"} for i in items]}

    def forget_local_data(self):
        """Delete the local journal and stored sign-ins (exported reports are the user's own files)."""
        self.journal.close()
        for name in ("journal.sqlite", "journal.sqlite-wal", "journal.sqlite-shm", "vault.bin", "operation-timeline.json"):
            (self.data_dir / name).unlink(missing_ok=True)
