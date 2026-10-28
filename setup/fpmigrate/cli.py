"""Command line (headless) mode. The guided app is the default; this exists for automation and support.

Passwords/tokens are read from environment variables, never from arguments:
  FPMIGRATE_JF_PASSWORD, FPMIGRATE_PLEX_TOKEN (optional).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .engine import Engine


def default_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "Orbital" / "MoveToJellyfin"


def _orbital_command(args) -> int:
    """Also used as the elevated helper: does one layer action and reports through --result."""
    from . import orbital
    try:
        webdir = orbital.find_webdir(args.webdir)
        if not webdir:
            raise RuntimeError("Jellyfin web folder not found")
        if args.command == "orbital-install":
            out = orbital.install(webdir)
        elif args.command == "orbital-remove":
            out = orbital.remove(webdir)
        else:
            out = orbital.status(webdir)
        code = 0
    except Exception as exc:  # noqa: BLE001 - reported to the calling app
        out, code = {"error": str(exc)}, 1
    if args.result:
        Path(args.result).write_text(json.dumps(out), encoding="utf-8")
    else:
        print(json.dumps(out, indent=2))
    return code


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="fpmigrate")
    ap.add_argument("command", choices=["detect", "plan", "migrate", "rollback", "report", "undo-setup", "ui",
                                        "orbital-status", "orbital-install", "orbital-remove",
                                        "install-app", "uninstall-app", "update-check", "direct-https-helper"])
    ap.add_argument("--request", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--webdir", default=None, help="Jellyfin web folder (orbital-* commands)")
    ap.add_argument("--result", default=None, help="write the orbital-* result as JSON to this file")
    ap.add_argument("--orbital", action="store_true", help="migrate: also apply the Orbital look")
    ap.add_argument("--sports", action="store_true", help="migrate: also add Orbital Sports (with --orbital)")
    ap.add_argument("--quiet", action="store_true", help="uninstall-app: no questions")
    ap.add_argument("--delete-data", action="store_true", help="uninstall-app: also delete this app's own data")
    ap.add_argument("--plex", default="http://127.0.0.1:32400")
    ap.add_argument("--jellyfin", default="http://127.0.0.1:8096")
    ap.add_argument("--jf-user", default=None)
    ap.add_argument("--create-admin", action="store_true", help="complete Jellyfin's first-run setup")
    ap.add_argument("--path-map", action="append", default=[], help="PLEXPATH=JELLYFINPATH")
    ap.add_argument("--create-libraries", action="store_true")
    ap.add_argument("--apply", action="store_true", help="write changes (default is preview only)")
    ap.add_argument("--run", default=None)
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--port", type=int, default=0, help="ui: fixed local port (default: random)")
    args = ap.parse_args(argv)

    if args.command == 'direct-https-helper':
        from .direct_https import admin_helper
        try:
            out=admin_helper(json.loads(Path(args.request).read_text(encoding='utf-8')));code=0
        except Exception as error:
            out={'error':str(error)};code=1
        Path(args.result).write_text(json.dumps(out),encoding='utf-8')
        return code

    if args.command.startswith("orbital-"):
        return _orbital_command(args)
    data_dir = Path(args.data_dir) if args.data_dir else default_data_dir()
    if args.command in ("install-app", "uninstall-app", "update-check"):
        from . import appinstall, updates
        if args.command == "install-app":
            out = appinstall.install()
        elif args.command == "uninstall-app":
            out = appinstall.uninstall(data_dir=data_dir, delete_data=args.delete_data)
            if not args.quiet:
                out["note"] = ("Jellyfin keeps everything this app set up. To undo it first, open the app and use "
                               "\"Remove what this app added\".") if not args.delete_data else None
        else:
            out = updates.check()
        print(json.dumps(out, indent=2))
        return 0
    if args.command == "ui":
        if args.webdir:
            os.environ["FPMIGRATE_JF_WEBDIR"] = args.webdir  # non-standard Jellyfin web folder location
        from .webui import serve
        return serve(data_dir, open_browser=not args.no_browser, port=args.port)

    eng = Engine(data_dir)
    out: dict = {}
    if args.command == "detect":
        out = eng.detect([args.plex], [args.jellyfin])
        print(json.dumps(out, indent=2))
        return 0

    eng.connect_plex(args.plex, os.environ.get("FPMIGRATE_PLEX_TOKEN"))
    password = os.environ.get("FPMIGRATE_JF_PASSWORD")
    if not (args.jf_user and password):
        print("Set --jf-user and FPMIGRATE_JF_PASSWORD", file=sys.stderr)
        return 2
    out["jellyfin"] = eng.connect_jellyfin(args.jellyfin, args.jf_user, password, create_admin=args.create_admin)
    for pm in args.path_map:
        src, dst = pm.split("=", 1)
        eng.path_map.append((src, dst))

    if args.command in ("rollback", "report", "undo-setup"):
        run = args.run or (eng.journal.runs()[0]["id"] if eng.journal.runs() else None)
        eng.user_map["owner"] = eng.jf.user_id
        if args.command == "rollback":
            out["rollback"] = eng.rollback(run)
        elif args.command == "undo-setup":
            out["removed"] = eng.remove_owned()
        else:
            out["report"] = eng.report(run)
        print(json.dumps(out, indent=2, default=str))
        return 0

    plan = eng.library_plan()
    out["libraries"] = plan
    if args.create_libraries:
        out["created"] = eng.apply_libraries(plan)
    eng.user_map["owner"] = eng.jf.user_id
    if args.create_libraries:
        out["homeLayout"] = eng.apply_home_layout()
    if args.orbital:
        if args.webdir:
            eng.orbital_webdir_hint = args.webdir
        out["orbital"] = eng.install_orbital()
        if args.sports:
            out["sports"] = eng.install_sports()
    if args.command == "plan":
        print(json.dumps(out, indent=2, default=str))
        return 0
    summary = eng.preview()
    out["preview"] = summary
    if args.apply:
        out["apply"] = eng.apply(summary["runId"])
        out["verify"] = eng.verify(summary["runId"])
        out["firstPlayback"] = eng.first_playback()
    out["report"] = eng.report(summary["runId"])
    print(json.dumps(out, indent=2, default=str))
    return 0
