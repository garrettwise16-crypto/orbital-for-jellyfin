"""Orbital Sports: add or remove the sports plugin through Jellyfin's own plugin installer.

The plugin serves the Orbital look's sports pages (scores, Game Center, play trackers, teams) on Jellyfin's own
address. Installing it needs no file access and no administrator prompt: this app offers the plugin from a
temporary repository on 127.0.0.1, asks Jellyfin (as its administrator) to install it, restores Jellyfin's
repository list exactly, and restarts Jellyfin so the plugin loads. Removal uses Jellyfin's uninstall and a restart.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import threading
import time
import urllib.parse
import zipfile
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .netio import HttpError

PLUGIN_ID = "6f1d2a3b-8c4e-4b7a-9e15-2d7c0a9b5e31"
PLUGIN_NAME = "Orbital Sports"
REPO_NAME = "Orbital (temporary, added by Move to Jellyfin)"
TARGET_ABI = "12.0.0.0"
RESTART_DOWN_WAIT_S = 30  # how long to watch for Jellyfin going away after asking it to restart


def bundle_dir() -> Path:
    base = Path(getattr(sys, "_MEIPASS", os.environ.get("ORBITAL_SETUP_PAYLOAD", Path(__file__).resolve().parent.parent)))
    return base / "fpmigrate" / "sports_plugin"


def bundle_info() -> dict:
    return json.loads((bundle_dir() / "bundle.json").read_text(encoding="utf-8"))


def available() -> bool:
    return (bundle_dir() / "bundle.json").is_file()


def package() -> tuple[bytes, str, dict]:
    """The plugin zip exactly as Jellyfin installs it: the plugin assembly plus service/ (the bundled service)."""
    info = bundle_info()
    root = bundle_dir()
    buf = io.BytesIO()
    meta = {  # Jellyfin otherwise tries to load every .dll in the folder, including the bundled service runtime
        "category": "General", "changelog": info.get("changelog", ""), "description": "Scores, Game Center and play trackers for the Orbital look.",
        "guid": PLUGIN_ID, "name": PLUGIN_NAME, "overview": "Sports for the Orbital look on this server.", "owner": "Orbital",
        "targetAbi": TARGET_ABI, "timestamp": "2026-10-22T00:00:00.0000000Z", "version": info["version"],
        "status": "Active", "autoUpdate": False, "imagePath": "", "assemblies": ["Orbital.Sports.dll"]}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("meta.json", date_time=(2026, 10, 22, 0, 0, 0)), json.dumps(meta, indent=2))
        for rel in sorted(info["files"]):
            path = root / rel
            zi = zipfile.ZipInfo(rel, date_time=(2026, 10, 22, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = (0o755 if rel.startswith("service/") else 0o644) << 16
            z.writestr(zi, path.read_bytes())
    data = buf.getvalue()
    return data, hashlib.md5(data).hexdigest(), info  # MD5 is what Jellyfin's repository format checks


def manifest(zip_url: str, checksum: str, info: dict) -> list:
    return [{
        "guid": PLUGIN_ID, "name": PLUGIN_NAME, "category": "General", "owner": "Orbital",
        "description": "Scores, Game Center and play trackers for the Orbital look.",
        "overview": "Sports for the Orbital look on this server. Not affiliated with the Jellyfin project.",
        "versions": [{"version": info["version"], "changelog": info.get("changelog", ""), "targetAbi": TARGET_ABI,
                      "sourceUrl": zip_url, "checksum": checksum,
                      "timestamp": datetime(2026, 10, 22, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}],
    }]


class RepoServer:
    """Serves the manifest and zip for a few minutes on one address; counts downloads. Read-only, two paths."""

    def __init__(self, host: str = "127.0.0.1", advertise: str | None = None, port: int = 0):
        self.zip, self.checksum, self.info = package()
        self.downloads = 0
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == "/manifest.json":
                    data = json.dumps(manifest(outer.zip_url, outer.checksum, outer.info)).encode()
                    kind = "application/json"
                elif self.path == outer.zip_path:
                    data, kind = outer.zip, "application/zip"
                    outer.downloads += 1
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer((host, port), Handler)
        self.server.daemon_threads = True
        base = f"http://{advertise or host}:{self.server.server_address[1]}"
        self.zip_path = f"/orbital-sports_{self.info['version']}.zip"
        self.manifest_url = base + "/manifest.json"
        self.zip_url = base + self.zip_path
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


def plugin_entry(jf) -> dict | None:
    for p in jf.call("GET", "/Plugins") or []:
        if str(p.get("Id", "")).replace("-", "").lower() == PLUGIN_ID.replace("-", ""):
            return p
    return None


def service_status(jf) -> dict | None:
    try:
        return jf.call("GET", "/Orbital/Sports/Status", timeout=8, retries=0)
    except HttpError:
        return None


def get_sources(jf) -> dict:
    """The server's sports sources (keys shortened by the service). Needs an administrator's sign-in."""
    return jf.call("GET", "/sports/api/sources", timeout=10, retries=1)


def check_sources(jf, progress=lambda message: None) -> dict:
    """Read actual source health; no channel playback and no guessed logo availability."""
    board = {}
    for attempt in range(3):
        progress("Asking your connected sports sources for today's games…")
        board = jf.call("GET", "/sports/api/events", timeout=8, retries=0)
        if not board.get("metadata_pending"):
            break
        if attempt < 2:
            time.sleep(1.5)
    pending = bool(board.get("metadata_pending"))
    health = board.get("sources") or []
    warnings = board.get("warnings") or []
    rows = []
    names = {"guide": "Your TV guide", "thesportsdb": "TheSportsDB", "feed": "Your feed", "file": "Your add-on", "espn-public": "ESPN public data"}
    remedies = {
        "credentials": "The provider refused access. Copy your current key from its account page and check that your plan includes this data, then save again.",
        "rate-limit": "The provider's request limit was reached. Wait a minute, then check connections again; you do not need to re-enter your key.",
        "address": "This feed address was not found. Copy the complete feed URL from your provider, then save again.",
        "network": "The provider could not be reached. Check your internet connection, then check connections again.",
        "response": "The provider returned an unsupported response. Check the key and feed format, or try another source.",
    }
    for item in health:
        ok = item.get("ok") is True and not pending
        badges = (f" {int(item.get('badgeLinks') or 0)} of {int(item['teamEntries'])} team entries include badge links (image loading not verified)."
                  if item.get('teamEntries') else " No team entries to check for badges today.")
        rows.append({"name": names.get(item.get("type"), "Sports source"), "ok": ok,
                     "message": "Still loading; check again shortly." if pending else
                     (f"No source error reported; {int(item.get('games') or 0)} games returned." + badges if ok else
                      remedies.get(item.get('reason'), "The source could not answer. Check its key or address, then retry."))})
    return {"ready": bool(rows) and all(r["ok"] for r in rows) and not warnings,
            "pending": pending, "sources": rows, "hasWarnings": bool(warnings),
            "message": "No source health information was returned. Try again shortly." if not rows else
                       "Some results are incomplete. Check your source settings and retry." if warnings else
                       "Team logos appear only when your source supplies them. This check does not verify every logo."}


def _with_reason(call):
    """The sports service explains a refusal ("This file has no ADDON description..."); pass that on to the person."""
    try:
        return call()
    except HttpError as error:
        if error.status in (400, 403, 404):
            try:
                reason = json.loads(error.detail).get("error")
            except (ValueError, AttributeError):
                reason = None
            if reason:
                raise ValueError(reason) from None
        raise


def set_sources(jf, settings: dict) -> dict:
    """Replace the sports sources; the service checks them strictly and answers with a reason when one is refused."""
    return _with_reason(lambda: jf.call("POST", "/sports/api/sources", body=settings, timeout=20))


def addons(jf, body: dict | None = None) -> dict:
    """Sports add-ons: list (no body), or {"action": "inspect"|"install"|"remove", ...}. Inspecting only reads the
    file's own description; installing needs both confirmations the person gave on the confirmation screen."""
    if body is None:
        return jf.call("GET", "/sports/api/sources/addons", timeout=10, retries=1)
    return _with_reason(lambda: jf.call("POST", "/sports/api/sources/addons", body=body, timeout=30))


def status(jf) -> dict:
    entry = plugin_entry(jf)
    out = {"bundled": available(), "installed": bool(entry), "version": entry and entry.get("Version"),
           "state": entry and entry.get("Status")}
    if entry and entry.get("Status") == "Active":
        out["service"] = service_status(jf)
    return out


def restart_and_wait(jf, timeout_s: float = 150) -> dict:
    """Ask Jellyfin to restart and wait until it answers again (it first stops answering)."""
    jf.call("POST", "/System/Restart", retries=0)
    deadline = time.time() + RESTART_DOWN_WAIT_S
    while time.time() < deadline:  # wait for it to go away, but don't insist (a fast restart can be missed)
        try:
            jf.public_info()
            time.sleep(1)
        except (HttpError, ValueError, OSError):
            break
    return jf.wait_until_ready(timeout_s)


def install(jf, repo_host: str = "127.0.0.1", repo_advertise: str | None = None, restart: bool = True,
            progress=lambda message: None) -> dict:
    """Install (or update) the plugin via Jellyfin's repository mechanism, then restart Jellyfin and confirm."""
    info = bundle_info()
    entry = plugin_entry(jf)
    if entry and entry.get("Version") == info["version"] and entry.get("Status") == "Active":
        return {"installed": True, "changed": False, "version": info["version"], "service": service_status(jf)}
    original = jf.call("GET", "/Repositories") or []
    with RepoServer(repo_host, repo_advertise) as repo:
        progress("Adding sports to Jellyfin…")
        ours = {"Name": REPO_NAME, "Url": repo.manifest_url, "Enabled": True}
        jf.call("POST", "/Repositories", body=[r for r in original if r.get("Url") != repo.manifest_url] + [ours])
        try:
            jf.call("POST", "/Packages/Installed/" + urllib.parse.quote(PLUGIN_NAME),
                    params={"assemblyGuid": PLUGIN_ID, "version": info["version"], "repositoryUrl": repo.manifest_url},
                    timeout=180)
            deadline = time.time() + 60
            while repo.downloads < 1 and time.time() < deadline:
                time.sleep(0.5)
            if repo.downloads < 1:
                raise RuntimeError("Jellyfin did not download the sports plugin")
            time.sleep(2)  # let Jellyfin finish unpacking before the restart
        finally:
            jf.call("POST", "/Repositories", body=original)  # Jellyfin's list exactly as it was
    if not restart:
        return {"installed": True, "changed": True, "version": info["version"], "restartNeeded": True}
    progress("Restarting Jellyfin so sports can start…")
    restart_and_wait(jf)
    entry = plugin_entry(jf)
    if not entry or entry.get("Status") != "Active":
        raise RuntimeError("Jellyfin restarted but the sports plugin isn't active ("
                           + str(entry and entry.get("Status")) + ")")
    service = None
    deadline = time.time() + 45
    while time.time() < deadline:
        service = service_status(jf)
        if service and service.get("ready"):
            break
        time.sleep(1.5)
    return {"installed": True, "changed": True, "version": info["version"], "service": service}


def configure_external(jf, url: str, secret: str) -> None:
    """Containers (lab, Docker hosts): point the plugin at an already running sports service."""
    jf.call("POST", f"/Plugins/{PLUGIN_ID}/Configuration", body={"ServiceUrl": url, "ServiceSecret": secret})


def remove(jf) -> dict:
    """Turn sports off at once, then delete the plugin.

    Windows locks a loaded plugin's DLL, and Jellyfin's in-process restart keeps it loaded, so a delete can only finish
    after Jellyfin has started fresh with the plugin disabled (verified on native Windows, Oct 22). Order:
    disable -> restart (sports off, service stopped) -> delete -> restart. If the plugin comes back (file still in use),
    it is disabled again and the result says removal finishes after Jellyfin's next full start; running the app again
    completes it. On Linux/Docker the first delete succeeds.
    """
    entry = plugin_entry(jf)
    if not entry:
        return {"removed": True, "off": True, "already": True}
    if entry.get("Status") != "Disabled":
        jf.call("POST", f"/Plugins/{PLUGIN_ID}/{entry['Version']}/Disable")
        restart_and_wait(jf)
    entry = plugin_entry(jf) or entry
    jf.call("DELETE", f"/Plugins/{PLUGIN_ID}/{entry['Version']}")
    restart_and_wait(jf)
    again = plugin_entry(jf)
    if again:
        if again.get("Status") != "Disabled":
            jf.call("POST", f"/Plugins/{PLUGIN_ID}/{again['Version']}/Disable")
            restart_and_wait(jf)
        return {"removed": False, "off": True, "version": entry["Version"], "finish": "next-full-start",
                "message": "Sports is off. Jellyfin finishes removing its files after it next starts fresh "
                           "(for example after restarting the PC); open this app again to complete it."}
    return {"removed": True, "off": True, "version": entry["Version"]}
