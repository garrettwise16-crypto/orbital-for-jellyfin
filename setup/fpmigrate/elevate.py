"""Run one Orbital layer action with Windows administrator rights (a normal UAC prompt), only when the
Jellyfin web folder is not writable by the signed-in user (e.g. under Program Files)."""
from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import tempfile
import uuid
from ctypes import wintypes
from pathlib import Path


class _ShellExecuteInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("fMask", ctypes.c_ulong), ("hwnd", wintypes.HWND),
                ("lpVerb", wintypes.LPCWSTR), ("lpFile", wintypes.LPCWSTR), ("lpParameters", wintypes.LPCWSTR),
                ("lpDirectory", wintypes.LPCWSTR), ("nShow", ctypes.c_int), ("hInstApp", wintypes.HINSTANCE),
                ("lpIDList", ctypes.c_void_p), ("lpClass", wintypes.LPCWSTR), ("hkeyClass", wintypes.HKEY),
                ("dwHotKey", wintypes.DWORD), ("hIconOrMonitor", wintypes.HANDLE), ("hProcess", wintypes.HANDLE)]


def _self_command(args: list[str]) -> tuple[str, str]:
    if getattr(sys, "frozen", False):  # packaged MoveToJellyfin.exe
        return sys.executable, subprocess.list2cmdline(args)
    return sys.executable, subprocess.list2cmdline(["-m", "fpmigrate", *args])


def run_layer_action(action: str, webdir: Path, timeout_ms: int = 120_000) -> dict:
    """action: install | remove. Returns the action's JSON result or raises PermissionError if declined."""
    result_file = Path(tempfile.gettempdir()) / f"fpmigrate-{uuid.uuid4().hex}.json"
    exe, params = _self_command([f"orbital-{action}", "--webdir", str(webdir), "--result", str(result_file)])
    info = _ShellExecuteInfo()
    info.cbSize = ctypes.sizeof(info)
    info.fMask = 0x00000040  # SEE_MASK_NOCLOSEPROCESS
    info.lpVerb, info.lpFile, info.lpParameters, info.nShow = "runas", exe, params, 0
    if not ctypes.windll.shell32.ShellExecuteExW(ctypes.byref(info)):  # type: ignore[attr-defined]
        raise PermissionError("Administrator permission was not given, so the Orbital look was not changed.")
    ctypes.windll.kernel32.WaitForSingleObject(info.hProcess, timeout_ms)  # type: ignore[attr-defined]
    ctypes.windll.kernel32.CloseHandle(info.hProcess)  # type: ignore[attr-defined]
    try:
        data = json.loads(result_file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RuntimeError("The administrator step did not finish; nothing was changed.") from None
    finally:
        result_file.unlink(missing_ok=True)
    if data.get("error"):
        raise RuntimeError(data["error"])
    return data


def needs_elevation(webdir: Path) -> bool:
    if os.name != "nt":
        return False
    probe = webdir / f".fpmigrate-write-test-{uuid.uuid4().hex}"
    try:
        probe.write_text("x")
        probe.unlink()
        return False
    except PermissionError:
        return True
