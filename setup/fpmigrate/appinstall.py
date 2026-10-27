"""Keep the app on this PC (per user, no administrator prompt) and remove it again.

Installs the running exe to %LOCALAPPDATA%\\Programs\\Orbital\\, adds a Start menu shortcut "Orbital for
Jellyfin" and an entry under Settings > Apps (HKCU uninstall key). Uninstall removes exactly those three things.
It never touches Jellyfin, Plex or media; the app's own data (journal used for undo) is kept unless the person asks
to delete it, because "Undo" and "Remove what this app added" need it.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import PRODUCT, __version__

APP_NAME = "Orbital for Jellyfin"
EXE_NAME = "MoveToJellyfin.exe"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\OrbitalMoveToJellyfin"


def default_app_dir() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Programs" / "Orbital"


def default_start_menu() -> Path:
    return Path(os.environ.get("APPDATA") or Path.home()) / "Microsoft" / "Windows" / "Start Menu" / "Programs"


class WinRegistry:
    """HKEY_CURRENT_USER only; the app never writes machine-wide settings."""

    def set(self, key: str, values: dict) -> None:
        import winreg
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
            for name, value in values.items():
                kind = winreg.REG_DWORD if isinstance(value, int) else winreg.REG_SZ
                winreg.SetValueEx(k, name, 0, kind, value)

    def get(self, key: str) -> dict | None:
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
                out, i = {}, 0
                while True:
                    try:
                        name, value, _ = winreg.EnumValue(k, i)
                    except OSError:
                        return out
                    out[name] = value
                    i += 1
        except FileNotFoundError:
            return None

    def delete(self, key: str) -> None:
        import winreg
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
        except FileNotFoundError:
            pass


def _shortcut(link: Path, target: Path) -> None:
    """A normal .lnk through Windows' own shell object (no extra libraries)."""
    script = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:FP_LINK);"
              "$s.TargetPath=$env:FP_TARGET;$s.WorkingDirectory=$env:FP_DIR;$s.Description=$env:FP_DESC;$s.Save()")
    env = dict(os.environ, FP_LINK=str(link), FP_TARGET=str(target), FP_DIR=str(target.parent),
               FP_DESC="Move your Plex progress to Jellyfin, and manage the Orbital look and sports")
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
                   env=env, check=True, capture_output=True, timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def status(app_dir: Path | None = None, registry=None) -> dict:
    app_dir = app_dir or default_app_dir()
    reg = (registry or WinRegistry()).get(UNINSTALL_KEY) if sys.platform == "win32" or registry else None
    exe = app_dir / EXE_NAME
    return {"installed": exe.is_file() and bool(reg), "path": str(exe), "version": (reg or {}).get("DisplayVersion"),
            "running": bool(getattr(sys, "frozen", False)) and Path(sys.executable).resolve() == exe.resolve() if exe.exists() else False}


def install(source: Path | None = None, app_dir: Path | None = None, start_menu: Path | None = None, registry=None,
            make_shortcut=_shortcut) -> dict:
    source = Path(source or sys.executable)
    if source.suffix.lower() != ".exe":
        raise RuntimeError("Only the packaged app can be kept on this PC.")
    app_dir, start_menu, registry = app_dir or default_app_dir(), start_menu or default_start_menu(), registry or WinRegistry()
    app_dir.mkdir(parents=True, exist_ok=True)
    target = app_dir / EXE_NAME
    if source.resolve() != target.resolve():
        tmp = target.with_suffix(".new")
        shutil.copy2(source, tmp)
        os.replace(tmp, target)  # atomic swap; an older copy is replaced only once the new one is complete
    start_menu.mkdir(parents=True, exist_ok=True)
    link = start_menu / (APP_NAME + ".lnk")
    make_shortcut(link, target)
    size_kb = max(1, target.stat().st_size // 1024)
    registry.set(UNINSTALL_KEY, {
        "DisplayName": APP_NAME, "DisplayVersion": __version__, "Publisher": "Orbital",
        "DisplayIcon": str(target), "InstallLocation": str(app_dir), "EstimatedSize": int(size_kb),
        "UninstallString": f'"{target}" uninstall-app', "QuietUninstallString": f'"{target}" uninstall-app --quiet',
        "NoModify": 1, "NoRepair": 1, "Comments": PRODUCT + ". Not affiliated with Plex or Jellyfin."})
    return {"installed": True, "path": str(target), "shortcut": str(link), "version": __version__}


def uninstall(app_dir: Path | None = None, start_menu: Path | None = None, registry=None, data_dir: Path | None = None,
              delete_data: bool = False) -> dict:
    app_dir, start_menu, registry = app_dir or default_app_dir(), start_menu or default_start_menu(), registry or WinRegistry()
    removed = []
    link = start_menu / (APP_NAME + ".lnk")
    if link.exists():
        link.unlink()
        removed.append("shortcut")
    if registry.get(UNINSTALL_KEY) is not None:
        registry.delete(UNINSTALL_KEY)
        removed.append("apps-list entry")
    exe = app_dir / EXE_NAME
    deferred = False
    if exe.exists():
        running = getattr(sys, "frozen", False) and Path(sys.executable).resolve() == exe.resolve()
        if running:  # a running exe can't delete itself on Windows: remove it a moment after this process exits
            subprocess.Popen(["cmd", "/c", f'ping -n 3 127.0.0.1 >nul & del /f /q "{exe}" & rmdir "{app_dir}"'],
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0))
            deferred = True
        else:
            exe.unlink()
            try:
                app_dir.rmdir()
            except OSError:
                pass
        removed.append("app")
    if delete_data and data_dir and data_dir.exists():
        shutil.rmtree(data_dir)
        removed.append("app data")
    return {"removed": removed, "deferred": deferred, "keptData": bool(data_dir and data_dir.exists())}
