"""Guided migration app served on 127.0.0.1 only.

Security: random port, per-launch secret (passed to the page in the URL fragment, sent back in a header),
Host and Origin checks against DNS rebinding/cross-site requests, bounded request bodies, no CORS, CSP.
"""
from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import secrets
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import PRODUCT, __version__
from .engine import Cancelled, Engine
from .netio import HttpError, redact

MAX_BODY = 64 * 1024
ADDON_BODY = 600 * 1024  # a sports add-on file (at most 256 KB) sent as JSON text


def ui_dir() -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / "fpmigrate" / "ui"


def friendly(exc: Exception) -> str:
    if isinstance(exc, HttpError):
        if exc.unreachable:
            return "That server did not answer. Check that it is running and the address is right."
        if exc.unauthorized:
            return "The server refused the sign-in. Check the user name and password and try again."
        return f"The server reported a problem ({exc.status}). Details are in the report."
    if isinstance(exc, (PermissionError, RuntimeError, ValueError, TimeoutError)):
        return str(exc)
    return "This step did not finish. Some changes may already be saved. Check the results before retrying."


class Job:
    def __init__(self):
        self.lock = threading.Lock()
        self.name = None
        self.running = False
        self.result = None
        self.error = None
        self.on_start = None

    def start(self, name, fn) -> bool:
        with self.lock:
            if self.running:
                return False
            self.name, self.running, self.result, self.error = name, True, None, None
            if self.on_start:
                self.on_start()

        def run():
            try:
                res = fn()
                with self.lock:
                    self.result = res
            except Cancelled:
                with self.lock:
                    self.error = "Paused. You can continue whenever you like."
            except Exception as exc:  # noqa: BLE001 - surfaced to the user in friendly form
                with self.lock:
                    self.error = friendly(exc)
                sys.stderr.write(redact(traceback.format_exc()))
            finally:
                with self.lock:
                    self.running = False
        threading.Thread(target=run, daemon=True).start()
        return True

    def view(self):
        with self.lock:
            return {"name": self.name, "running": self.running, "result": self.result, "error": self.error}


class App:
    def __init__(self, data_dir: Path):
        self.engine = Engine(data_dir)
        self.job = Job()
        def start_job():
            self.engine.cancel_event.clear()
            self.engine.progress = {"phase": "starting", "done": 0, "total": 0, "message": "Starting..."}
        self.job.on_start = start_job
        self.key = secrets.token_urlsafe(24)
        self.last_run = None
        self.library_rows = None
        self.port = 0
        self.stop = threading.Event()
        self.request_lock = threading.RLock()
        self.setup_file = Path(data_dir) / "feature-setup.json"
        self.deployment_mode = 'windows'

    def target_key(self):
        if not self.engine.jf:
            return None
        identity = self.engine.jf_info.get("Id") or self.engine.jf.base_url
        return hashlib.sha256(str(identity).encode()).hexdigest()

    def save_setup(self, state):
        # No account names, passwords, source keys or folder paths in this checkpoint.
        tmp = self.setup_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({**state, "target": self.target_key()}), encoding="utf-8")
        tmp.replace(self.setup_file)

    def setup_progress(self, _q, _b):
        try:
            state = json.loads(self.setup_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        if not self.target_key() or state.get("target") != self.target_key():
            state = {}
        job = self.job.view()
        return {**state, "running": job["running"], "jobName": job["name"]}

    # ---- API ------------------------------------------------------------------------------------
    def status(self, _q, _b):
        e = self.engine
        return {"product": PRODUCT, "version": __version__,
                "plex": {"connected": bool(e.plex), "url": e.plex.base_url if e.plex else None,
                         "version": e.plex_identity.get("version"), "signedIn": bool(e.plex_account_token)},
                "jellyfin": {"connected": bool(e.jf and e.jf.token), "url": e.jf.base_url if e.jf else None,
                             "version": e.jf_info.get("Version"), "serverName": e.jf_info.get("ServerName")},
                "sources": [{"key": s.key, "name": s.name, "completeness": s.completeness, "note": s.note}
                            for s in e.sources],
                "userMap": e.user_map, "lastRun": self.last_run, "job": self.job.view(),
                "suggestedName": _suggested_name(), "librariesPlanned": self.library_rows is not None,
                "progress": e.progress,
                "previousRuns": [{"id": r["id"], "status": r["status"], "created": r["created"]}
                                 for r in e.journal.runs()[:5]]}

    def detect(self, _q, b):
        from .onboarding import MODES
        mode = b.get('deployment', self.deployment_mode)
        if mode not in MODES:
            raise ValueError('Choose a deployment type.')
        if self.job.view()['running'] and mode != self.deployment_mode:
            raise RuntimeError('Wait for the current step before changing deployment.')
        self.deployment_mode = mode
        return self.engine.detect([b["plexUrl"]] if b.get("plexUrl") else None,
                                  [b["jellyfinUrl"]] if b.get("jellyfinUrl") else None,
                                  include_defaults=mode == 'windows')

    def preflight(self, _q, _b):
        from .onboarding import preflight
        return preflight()

    def deployment(self, _q, b):
        from .onboarding import deployment
        return deployment(b)

    def findings(self, _q, b):
        from .onboarding import findings
        return findings(self, b)

    def migration_check(self, _q, b):
        run_id = b.get('runId') or self.last_run
        if not run_id or not self.engine.jf:
            raise ValueError('Complete a migration and connect its Jellyfin server first.')
        return {'started': self.job.start('verify', lambda: {'verify': self.engine.verify(run_id)})}

    def plex_connect(self, _q, b):
        try:
            return {"ok": True, **self.engine.connect_plex(b["url"], b.get("token") or None)}
        except PermissionError:
            return {"ok": False, "needsSignIn": True}

    def plex_signin_start(self, _q, _b):
        return self.engine.plex_signin_start()

    def plex_signin_poll(self, _q, b):
        return self.engine.plex_signin_poll(b["url"])

    def plex_profiles(self, _q, b):
        added = self.engine.add_home_users(b.get("pins") or {}) if b.get("home", True) else []
        if b.get("history"):
            added += self.engine.add_history_accounts()
        return {"added": added}

    def jellyfin_connect(self, _q, b):
        if self.job.view()["running"]:
            raise RuntimeError("Setup is still running. Wait before changing the connected server.")
        return {"ok": True, **self.engine.connect_jellyfin(b["url"], b["username"], b["password"],
                                                           bool(b.get("createAdmin")))}

    def server_install(self, _q, b):
        from . import serverinstall
        if self.deployment_mode != 'windows':
            raise ValueError('Windows installation is only available for This Windows PC.')
        if b.get("agreed") is not True:
            raise ValueError("Accept the installation agreements first.")
        if self.engine.jf:
            raise ValueError("Jellyfin is already connected. Continue with your setup.")
        started = self.job.start("server-install", lambda: serverinstall.install(
            lambda msg: self.engine._p("install", message=msg)))
        if not started:
            raise RuntimeError("Another setup step is running. Wait for it to finish.")
        return {"started": True}

    def folders(self, _q, b):
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        path = b.get("path") or ""
        if not isinstance(path, str):
            raise ValueError("Choose a folder.")
        return {"paths": self.engine.jf.directory_contents(path) if path else self.engine.jf.drives()}

    def library_create(self, _q, b):
        if self.job.view()["running"]:
            raise RuntimeError("Wait for the current setup step to finish.")
        jf = self.engine.jf
        if not jf:
            raise ValueError("Connect Jellyfin first.")
        name, kind, path = b.get("name"), b.get("kind"), b.get("path")
        if not isinstance(name, str) or not name.strip() or kind not in ("movies", "tvshows", "music") or not isinstance(path, str) or not path:
            raise ValueError("Choose a name, media type and folder.")
        name = name.strip()
        for existing in jf.virtual_folders():
            if existing.get("Name", "").casefold() == name.casefold():
                if path in existing.get("Locations", []) and existing.get("CollectionType") == kind:
                    return {"message": "This library is already added. You can add another folder later in Jellyfin."}
                raise ValueError("That library name already exists. Choose a different name.")
        if not jf.validate_path(path):
            raise ValueError("Jellyfin cannot read that folder. Choose another folder or give the Jellyfin account access, then retry.")
        jf.add_library(name, kind, [path])
        found = next((v for v in jf.virtual_folders() if v.get("Name") == name and path in v.get("Locations", [])), None)
        if not found:
            raise RuntimeError("The library was requested but could not be verified. Check Jellyfin before retrying.")
        self.engine.journal.add_owned("setup", "library", found.get("ItemId") or "", name)
        return {"message": "Library added and checked. Jellyfin is finding your titles in the background; you can continue or add another library."}

    def libraries(self, _q, _b):
        self.library_rows = self.engine.library_plan()
        return {"rows": self.library_rows}

    def library_path(self, _q, b):
        ok = self.engine.set_library_path(b["plexPath"], b["jfPath"])
        if ok:
            self.library_rows = self.engine.library_plan()
        return {"ok": ok, "rows": self.library_rows}

    def libraries_apply(self, _q, b):
        include = set(b.get("include") or [])
        rows = [dict(r, include=r["sectionKey"] in include) for r in self.library_rows or []]
        self.engine.selected_sections = {r["sectionKey"] for r in rows if r["include"]}
        return {"started": self.job.start("libraries", lambda: {"created": self.engine.apply_libraries(rows)})}

    def setup(self, _q, b):
        """One step for the express path: libraries -> scan -> accounts -> review (nothing watched is written)."""
        include = set(b.get("include") or [r["sectionKey"] for r in self.library_rows or []
                                             if r["action"] in ("create", "reuse")])
        rows = [dict(r, include=r["sectionKey"] in include) for r in self.library_rows or []]
        self.engine.selected_sections = include

        def run():
            e = self.engine
            e.apply_libraries(rows)
            names = {r["libraryName"] for r in rows if r["include"]}
            lib_ids = [v.get("ItemId") for v in e.jf.virtual_folders() if v["Name"] in names]
            choices = b.get("choices")
            if not choices:
                choices = {}
                for src in e.user_plan()["sources"]:
                    sug = src["suggestion"]
                    choices[src["key"]] = ({"mode": "skip"} if src["completeness"] == "unavailable" else sug)
            created = e.apply_users(choices, lib_ids)
            if b.get("homeLayout", True):
                e.apply_home_layout()
            look = None
            if b.get("orbital"):
                e._p("libraries", 0, 0, "Applying the Orbital look")
                try:
                    e.install_orbital()
                    look = {"applied": True}
                except Exception as exc:  # noqa: BLE001 - the migration continues without the new look
                    look = {"applied": False, "reason": friendly(exc)}
            sports_result = None
            if b.get("sports") and look and look.get("applied"):
                e._p("libraries", 0, 0, "Adding sports")
                try:
                    done = e.install_sports()
                    sports_result = {"applied": True, "ready": bool((done.get("service") or {}).get("ready"))}
                except Exception as exc:  # noqa: BLE001 - the migration continues without sports
                    sports_result = {"applied": False, "reason": friendly(exc)}
            e._p("preview", 0, 0, "Matching your titles")
            summary = e.preview(transfer_ratings=bool(b.get("ratings", True)),
                                favorite_at=8.0 if b.get("favorites") else None)
            self.last_run = summary["runId"]
            return {"summary": summary, "exceptions": e.journal.exceptions(summary["runId"]),
                    "newAccounts": created, "orbital": look, "sports": sports_result}
        return {"started": self.job.start("setup", run)}

    def orbital_state(self, _q, _b):
        return self.engine.orbital_status()

    def features_install(self, _q, b):
        """Install selected features without a Plex connection or migration."""
        selected = b.get("features")
        if not isinstance(selected, list) or not selected or any(x not in ("orbital", "sports") for x in selected):
            raise ValueError("Choose the Orbital look, Sports, or both.")
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        if "sports" in selected and b.get("allowRestart") is not True:
            raise ValueError("Confirm that Jellyfin can restart before adding Sports.")

        def run():
            results = {}
            self.save_setup({"features": selected, "results": results, "phase": "running"})
            for feature in dict.fromkeys(selected):
                try:
                    self.engine._p("features", message="Setting up and checking " + ("the Orbital look" if feature == "orbital" else "Sports. Jellyfin may restart"))
                    if feature == "orbital":
                        self.engine.install_orbital()
                        state = self.engine.orbital_status()
                        ready = state.get("installed") and state.get("filesPresent") and not state.get("needsReapply")
                    else:
                        self.engine.install_sports()
                        state = self.engine.sports_status()
                        ready = state.get("installed") and (state.get("service") or {}).get("ready")
                    results[feature] = {"ready": bool(ready), "message": "Ready" if ready else "Installed, but the check did not pass. You can retry this feature."}
                except Exception as exc:
                    results[feature] = {"ready": False, "message": redact(friendly(exc))}
                self.save_setup({"features": selected, "results": results, "phase": "running"})
            self.save_setup({"features": selected, "results": results, "phase": "finished"})
            return {"features": results}
        if not self.job.start("features", run):
            raise RuntimeError("Another setup step is running. Wait for it to finish.")
        return {"started": True}

    def orbital_remove(self, _q, _b):
        return {"removed": self.engine.remove_orbital()}

    def app_state(self, _q, _b):
        from . import appinstall, updates
        st = appinstall.status() if sys.platform == "win32" else {"installed": False}
        return {**st, "canInstall": bool(getattr(sys, "frozen", False)) and sys.platform == "win32", "update": updates.check()}

    def app_install(self, _q, _b):
        from . import appinstall
        return appinstall.install()

    def sports_state(self, _q, _b):
        return self.engine.sports_status()

    def sports_sources_get(self, _q, _b):
        return self.engine.sports_sources()

    def catalogues_import(self, _q, body):
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        return self.engine.jf.call("POST", "/sports/api/catalogues/import", body=body, timeout=30, retries=0)

    def catalogues_connect(self, _q, body):
        from . import catalogues
        jf = self.engine.jf
        if not jf:
            raise ValueError("Connect Jellyfin first.")
        provider = (body or {}).get('provider')
        if provider not in (*catalogues.PROVIDERS, 'all'):
            raise ValueError("Choose a catalogue")
        def check_cancel():
            if self.engine.cancel_event.is_set():
                raise Cancelled()
        if not self.job.start('catalogues', lambda: catalogues.connect(jf, provider,
                lambda message: self.engine._p('catalogues', message=message), check_cancel,
                (body or {}).get('automatic_refresh', True))):
            raise ValueError("Another setup step is running. Wait for it to finish.")
        return {'started': True}

    def remote_access(self, _q, body):
        from . import remote_access
        jf = self.engine.jf
        if not jf:
            raise ValueError('Connect Jellyfin first.')
        if not jf.call('GET', '/Users/Me').get('Policy', {}).get('IsAdministrator'):
            raise ValueError('Sign in as a Jellyfin administrator to configure remote access.')
        action = (body or {}).get('action', 'status')
        if action.startswith('direct-'):
            from . import direct_https
            method=action.removeprefix('direct-')
            if method not in ('assess','configure','check','confirm','remove','resume'):
                raise ValueError('Unknown HTTPS setup step.')
            token=jf.token
            def direct_progress(message):
                if self.engine.jf is not jf or jf.token!=token:raise Cancelled()
                self.engine._p('remote-access',message=message)
            def direct_work():
                direct_progress('Preparing your HTTPS connection…')
                if method=='assess':return direct_https.assess(jf,body or {},direct_progress)
                return getattr(direct_https,method)(jf,self.engine.data_dir,body or {},direct_progress)
            if not self.job.start('remote-access',direct_work):
                raise ValueError('Another setup step is running. Wait for it to finish.')
            return {'started':True}
        if action == 'status':
            return remote_access.status(jf)
        if action == 'verify':
            return remote_access.verify(jf, (body or {}).get('url', ''))
        if action not in ('install', 'enable', 'advance'):
            raise ValueError('Unknown remote access step.')
        token = jf.token
        def progress(message):
            if self.engine.jf is not jf or jf.token != token:
                raise Cancelled()
            self.engine._p('remote-access', message=message)
        if not self.job.start('remote-access', lambda: getattr(remote_access, action)(jf, progress)):
            raise ValueError('Another setup step is running. Wait for it to finish.')
        return {'started': True}

    def live_tv_status(self, _q, _b):
        from . import live_tv
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        return live_tv.status(self.engine.jf)

    def rebel_status(self, _q, _b):
        from . import rebel
        if not self.engine.jf:
            raise ValueError('Connect Jellyfin first.')
        return rebel.ready(self.engine.jf)

    def rebel_install(self, _q, body):
        from . import rebel
        jf = self.engine.jf
        if not jf:
            raise ValueError('Connect Jellyfin first.')
        token = jf.token
        def progress(message):
            if self.engine.jf is not jf or jf.token != token:
                raise Cancelled()
            self.engine._p('rebel', message=message)
        if not self.job.start('rebel', lambda: rebel.install(jf, body or {}, progress)):
            raise ValueError('Another setup step is running. Wait for it to finish.')
        return {'started': True}

    def live_tv_check(self, _q, body):
        from . import live_tv
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        return live_tv.check(body or {})

    def live_tv_save(self, _q, body):
        from . import live_tv
        jf = self.engine.jf
        if not jf:
            raise ValueError("Connect Jellyfin first.")
        token = jf.token
        def progress(message):
            if self.engine.jf is not jf or jf.token != token:
                raise Cancelled()
            self.engine._p('live-tv', message=message)
        if not self.job.start('live-tv', lambda: live_tv.save(jf, body or {}, progress)):
            raise ValueError("Another setup step is running. Wait for it to finish.")
        return {'started': True}

    def integrations_get(self, _q, _b):
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        return self.engine.jf.call("GET", "/sports/api/integrations", timeout=10, retries=0)

    def integrations_set(self, _q, body):
        if not self.engine.jf:
            raise ValueError("Connect Jellyfin first.")
        return self.engine.jf.call("POST", "/sports/api/integrations", body=body or {}, timeout=15, retries=0)

    def sports_sources_set(self, _q, b):
        return self.engine.sports_sources(b or {})

    def sports_sources_check(self, _q, _b):
        from . import sports
        jf = self.engine.jf
        if not jf:
            raise ValueError("Connect Jellyfin first.")
        if not self.job.start("sources-check", lambda: sports.check_sources(jf,
                lambda msg: self.engine._p("sources", message=msg))):
            raise RuntimeError("Another setup step is running. Wait for it to finish.")
        return {"started": True}

    def sports_addons_get(self, _q, _b):
        return self.engine.sports_addons()

    def sports_addons_post(self, _q, b):
        return self.engine.sports_addons(b or {})

    def sports_remove(self, _q, _b):
        return {"started": self.job.start("sports-remove", lambda: {"sports": self.engine.remove_sports()})}

    def users(self, _q, _b):
        return self.engine.user_plan()

    def users_apply(self, _q, b):
        lib_names = {r["libraryName"] for r in self.library_rows or [] if r["sectionKey"] in
                     (self.engine.selected_sections or set())}
        lib_ids = [v.get("ItemId") for v in self.engine.jf.virtual_folders() if v["Name"] in lib_names]
        created = self.engine.apply_users(b.get("choices") or {}, lib_ids)
        return {"created": created}  # one-time passwords: returned once, never stored

    def preview(self, _q, b):
        def run():
            s = self.engine.preview(transfer_ratings=bool(b.get("ratings", True)),
                                    favorite_at=8.0 if b.get("favorites") else None)
            self.last_run = s["runId"]
            return {"summary": s, "exceptions": self.engine.journal.exceptions(s["runId"])}
        return {"started": self.job.start("preview", run)}

    def apply(self, _q, b):
        run_id = b.get("runId") or self.last_run

        def run():
            res = self.engine.apply(run_id)
            res["verify"] = self.engine.verify(run_id)
            res["firstPlayback"] = self.engine.first_playback()
            return res
        return {"started": self.job.start("apply", run)}

    def cancel(self, _q, _b):
        self.engine.cancel_event.set()
        return {"ok": True}

    def rollback(self, _q, b):
        run_id = b.get("runId") or self.last_run
        return {"started": self.job.start("rollback", lambda: self.engine.rollback(run_id))}

    def undo_setup(self, _q, _b):
        return {"started": self.job.start("undo", lambda: {"removed": self.engine.remove_owned(),
            "legacyHistoryPreserved": bool(self.engine.journal.legacy_owned_count())})}

    def report(self, q, _b):
        run_id = q.get("run") or self.last_run
        return {"report": self.engine.report(run_id), "csv": self.engine.report_csv(run_id)}

    def forget(self, _q, _b):
        self.engine.forget_local_data()
        self.stop.set()
        return {"ok": True}

    def quit(self, _q, _b):
        self.stop.set()
        return {"ok": True}

    ROUTES = {
        ("GET", "/api/preflight"): "preflight", ("POST", "/api/deployment"): "deployment",
        ("POST", "/api/findings"): "findings", ("POST", "/api/migration/check"): "migration_check",
        ("GET", "/api/status"): "status", ("POST", "/api/detect"): "detect",
        ("POST", "/api/plex/connect"): "plex_connect", ("POST", "/api/plex/signin/start"): "plex_signin_start",
        ("POST", "/api/plex/signin/poll"): "plex_signin_poll", ("POST", "/api/plex/profiles"): "plex_profiles",
        ("POST", "/api/jellyfin/connect"): "jellyfin_connect", ("GET", "/api/libraries"): "libraries",
        ("POST", "/api/server/install"): "server_install", ("POST", "/api/folders"): "folders",
        ("POST", "/api/library/create"): "library_create",
        ("POST", "/api/libraries/path"): "library_path", ("POST", "/api/libraries/apply"): "libraries_apply",
        ("GET", "/api/users"): "users", ("POST", "/api/setup"): "setup",
        ("GET", "/api/orbital"): "orbital_state", ("POST", "/api/orbital/remove"): "orbital_remove",
        ("POST", "/api/features/install"): "features_install",
        ("GET", "/api/setup/progress"): "setup_progress",
        ("GET", "/api/app"): "app_state", ("POST", "/api/app/install"): "app_install",
        ("GET", "/api/sports"): "sports_state", ("POST", "/api/sports/remove"): "sports_remove",
        ("GET", "/api/sports/sources"): "sports_sources_get", ("POST", "/api/sports/sources"): "sports_sources_set", ("GET", "/api/sports/addons"): "sports_addons_get", ("POST", "/api/sports/addons"): "sports_addons_post", ("POST", "/api/users/apply"): "users_apply",
        ("POST", "/api/sports/sources/check"): "sports_sources_check",
        ("POST", "/api/catalogues/import"): "catalogues_import",
        ("POST", "/api/catalogues/connect"): "catalogues_connect",
        ("GET", "/api/integrations"): "integrations_get", ("POST", "/api/integrations"): "integrations_set",
        ("GET", "/api/live-tv"): "live_tv_status", ("POST", "/api/live-tv/check"): "live_tv_check",
        ("POST", "/api/live-tv/save"): "live_tv_save",
        ("GET", "/api/rebel"): "rebel_status", ("POST", "/api/rebel/install"): "rebel_install",
        ("POST", "/api/remote-access"): "remote_access",
        ("POST", "/api/preview"): "preview", ("POST", "/api/apply"): "apply", ("POST", "/api/cancel"): "cancel",
        ("POST", "/api/rollback"): "rollback", ("POST", "/api/undo-setup"): "undo_setup",
        ("GET", "/api/report"): "report", ("POST", "/api/forget"): "forget", ("POST", "/api/quit"): "quit",
    }
    STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript"),
              "/app.css": ("app.css", "text/css")}


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "fpmigrate"

        def log_message(self, *a):
            pass

        def _send(self, status, payload, ctype="application/json"):
            raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' data: http: https:; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(raw)

        def _host_ok(self):
            allowed = {f"127.0.0.1:{app.port}", f"localhost:{app.port}"}
            if self.headers.get("Host") not in allowed:
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in {f"http://{h}" for h in allowed}

        def _handle(self):
            if not self._host_ok():
                return self._send(403, {"error": "forbidden"})
            u = urlparse(self.path)
            if self.command == "GET" and u.path in Application.STATIC:
                name, ctype = Application.STATIC[u.path]
                return self._send(200, (ui_dir() / name).read_bytes(), ctype)
            route = Application.ROUTES.get((self.command, u.path))
            if not route:
                return self._send(404, {"error": "not found"})
            if not hmac.compare_digest(self.headers.get("X-FP-Key", ""), app.key):
                return self._send(403, {"error": "forbidden"})
            n = int(self.headers.get("Content-Length") or 0)
            if n > (32 * 1024 * 1024 if u.path == "/api/catalogues/import" else ADDON_BODY if u.path == "/api/sports/addons" else MAX_BODY):
                if n <= 16 * MAX_BODY:
                    self.rfile.read(n)  # drain so the client receives the refusal instead of a reset
                self.close_connection = True
                return self._send(413, {"error": "too large"})
            try:
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                if not isinstance(body, dict):
                    raise ValueError("bad body")
            except ValueError:
                return self._send(400, {"error": "invalid request"})
            q = {k: v[-1] for k, v in parse_qs(u.query).items()}
            try:
                # A second browser tab cannot reconnect, undo or close the app while
                # an asynchronous mutation owns the current server and journal.
                if self.command == "POST":
                    with app.request_lock:
                        if app.job.view()["running"] and route not in ("detect", "folders", "cancel"):
                            raise RuntimeError("Another setup step is running. Wait for it to finish.")
                        return self._send(200, getattr(app, route)(q, body))
                return self._send(200, getattr(app, route)(q, body))
            except KeyError as exc:
                return self._send(400, {"error": f"missing field {exc}"})
            except Exception as exc:  # noqa: BLE001
                if not isinstance(exc, (HttpError, PermissionError, RuntimeError, ValueError, TimeoutError)):
                    sys.stderr.write(redact(traceback.format_exc()))
                return self._send(409, {"error": friendly(exc)})

        do_GET = do_POST = _handle

    return Handler


Application = App


def _suggested_name() -> str:
    try:
        name = getpass.getuser()
    except Exception:  # noqa: BLE001
        return ""
    return name if name and name.isprintable() and len(name) <= 40 else ""


def serve(data_dir: Path, open_browser: bool = True, port: int = 0, ready: threading.Event | None = None,
          holder: dict | None = None) -> int:
    app = App(data_dir)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    app.port = httpd.server_port
    url = f"http://127.0.0.1:{app.port}/#k={app.key}"
    if holder is not None:
        holder.update(app=app, url=url, httpd=httpd)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    print(f"{PRODUCT} is open in your browser. If it did not open, visit:\n  {url}\nKeep this window open "
          f"until you are finished.", flush=True)
    if ready:
        ready.set()
    if open_browser:
        webbrowser.open(url)
    try:
        while not app.stop.wait(1):
            pass
    except KeyboardInterrupt:
        pass
    time.sleep(0.5)
    httpd.shutdown()
    if app.engine.jf:
        app.engine.jf.logout()
    return 0
