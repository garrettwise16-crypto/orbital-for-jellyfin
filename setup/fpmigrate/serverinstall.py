"""Local Windows bootstrap; package integrity remains enforced by Windows Package Manager."""
import shutil
import subprocess
import sys
from .jellyfin import Jellyfin
from .netio import HttpError


def install(progress):
    if sys.platform != "win32":
        raise RuntimeError("Automatic server installation currently supports Windows. Connect an existing server instead.")
    jf = Jellyfin("http://127.0.0.1:8096")
    progress("Checking whether Jellyfin is already running…")
    try:
        info = jf.public_info()
        if isinstance(info, dict) and info.get("Version"):
            return {"ready": True, "alreadyRunning": True, "version": info["Version"]}
    except (HttpError, ValueError):
        pass
    winget = shutil.which("winget")
    if not winget:
        raise RuntimeError("Windows App Installer is missing. Install it from Microsoft Store, then retry here.")
    progress("Downloading and installing Jellyfin. Allow the Windows permission prompt if it appears.")
    try:
        result = subprocess.run([winget, "install", "--id", "Jellyfin.Server", "--exact", "--source", "winget",
                             "--version", "12.2", "--silent", "--no-upgrade", "--accept-package-agreements", "--accept-source-agreements",
                             "--disable-interactivity"], capture_output=True, timeout=1200,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise TimeoutError("Windows is taking longer than expected. The installer may still be running. "
                           "Let it finish, then choose Look again; existing installations will not be upgraded.") from None
    if result.returncode:
        raise RuntimeError("Windows could not finish installing Jellyfin. Check any permission prompt and retry. "
                           "If Jellyfin is already installed, start it and choose Look again.")
    progress("Installation finished. Waiting for Jellyfin to answer…")
    try:
        info = jf.wait_until_ready(120)
    except TimeoutError:
        raise TimeoutError("Jellyfin was installed, but has not answered yet. Open Jellyfin from the Windows Start menu, "
                           "then choose Look again. Your installation is kept.") from None
    return {"ready": True, "version": info.get("Version")}
