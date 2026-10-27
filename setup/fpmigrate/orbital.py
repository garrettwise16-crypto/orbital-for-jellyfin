"""Install / remove the Orbital web layer on a Jellyfin server's own web folder.

The layer is a set of files in <jellyfin-web>/orbital/ plus two marked blocks in index.html. Nothing in Jellyfin's own
files is replaced: removing the blocks and the folder returns Jellyfin's web client exactly to how it was.
A backup of index.html is kept until removal. Jellyfin updates replace index.html; status() detects that and the app
offers to apply the layer again.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

START_HEAD = "<!--fpmigrate-orbital:early-->"
END_HEAD = "<!--/fpmigrate-orbital:early-->"
START_TAIL = "<!--fpmigrate-orbital:shell-->"
END_TAIL = "<!--/fpmigrate-orbital:shell-->"
OWNER_FILE = ".fpmigrate-layer.json"
BACKUP = "index.html.fpmigrate-backup"
BLOCKS = re.compile(r"<!--fpmigrate-orbital:(early|shell)-->.*?<!--/fpmigrate-orbital:\1-->", re.S)


def layer_dir() -> Path:
    base = Path(getattr(sys, "_MEIPASS", os.environ.get("ORBITAL_SETUP_PAYLOAD", Path(__file__).resolve().parent.parent)))
    return base / "fpmigrate" / "orbital_layer"


def manifest() -> dict:
    return json.loads((layer_dir() / "manifest.json").read_text(encoding="utf-8"))


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def candidate_webdirs() -> list[Path]:
    out = []
    for env in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        root = os.environ.get(env)
        if root:
            out.append(Path(root) / "Jellyfin" / "Server" / "jellyfin-web")
    out.append(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Jellyfin" / "Server" / "jellyfin-web")
    return [p for p in out if str(p)]


def find_webdir(hint: str | None = None) -> Path | None:
    for p in ([Path(hint)] if hint else []) + candidate_webdirs():
        if (p / "index.html").is_file() and "jellyfin" in (p / "index.html").read_text(encoding="utf-8", errors="replace").lower():
            return p
    return None


def supported(server_version: str | None) -> bool:
    if not server_version:
        return False
    major_minor = ".".join(server_version.split(".")[:2])
    return major_minor in manifest()["supportedJellyfin"]


def _blocks(m: dict) -> tuple[str, str]:
    f = {k: "orbital/" + v["file"] for k, v in m["files"].items()}
    early = (f'{START_HEAD}<link rel="stylesheet" href="{f["orbital.css"]}"><link rel="stylesheet" href="{f["live-tv.css"]}">'
             f'<link rel="stylesheet" href="{f["customer.css"]}"><script src="{f["customer.js"]}"></script>'
             f'<script src="{f["phone.js"]}"></script>{END_HEAD}')
    tail = (f'{START_TAIL}<script defer src="{f["orbital.js"]}"></script>'
            f'<script defer src="{f["live-tv.js"]}"></script>{END_TAIL}')
    return early, tail


def strip(index: str) -> str:
    return BLOCKS.sub("", index)


def status(webdir: Path) -> dict:
    index = (webdir / "index.html").read_text(encoding="utf-8")
    owner = webdir / "orbital" / OWNER_FILE
    info = json.loads(owner.read_text(encoding="utf-8")) if owner.exists() else None
    return {"webdir": str(webdir), "installed": bool(BLOCKS.search(index)) and info is not None,
            "layer": info and info.get("layer"), "available": manifest()["layer"],
            "filesPresent": info is not None,
            "needsReapply": info is not None and not BLOCKS.search(index),  # Jellyfin update replaced index.html
            "writable": os.access(webdir, os.W_OK)}


def install(webdir: Path) -> dict:
    m = manifest()
    index_path = webdir / "index.html"
    index = index_path.read_text(encoding="utf-8")
    clean = strip(index)
    if "</head>" not in clean or "<script" not in clean:
        raise RuntimeError("This Jellyfin web folder does not look like a stock Jellyfin web client")
    dest = webdir / "orbital"
    owner = dest / OWNER_FILE
    if dest.exists() and not owner.exists():
        raise RuntimeError(f"{dest} exists and was not created by this app; refusing to touch it")
    dest.mkdir(exist_ok=True)
    previous = json.loads(owner.read_text(encoding="utf-8")) if owner.exists() else {"files": []}
    names = []
    for entry in m["files"].values():
        data = (layer_dir() / entry["file"]).read_bytes()
        if _sha(data) != entry["sha256"]:
            raise RuntimeError(f"packaged file {entry['file']} failed its integrity check")
        (dest / entry["file"]).write_bytes(data)
        names.append(entry["file"])
    for stale in set(previous.get("files", [])) - set(names):
        (dest / stale).unlink(missing_ok=True)
    backup = webdir / BACKUP
    backup.write_text(clean, encoding="utf-8")  # Jellyfin's own index (minus any earlier layer blocks)
    early, tail = _blocks(m)
    first_script = clean.index("<script")
    patched = clean[:first_script] + early + clean[first_script:]
    patched = patched.replace("</head>", tail + "</head>", 1)
    tmp = webdir / "index.html.fpmigrate-tmp"
    tmp.write_text(patched, encoding="utf-8")
    os.replace(tmp, index_path)
    owner.write_text(json.dumps({"layer": m["layer"], "files": names, "stockIndexSha256": _sha(clean.encode()),
                                 "patchedIndexSha256": _sha(patched.encode())}, indent=2), encoding="utf-8")
    return status(webdir)


def remove(webdir: Path) -> dict:
    index_path = webdir / "index.html"
    index = index_path.read_text(encoding="utf-8")
    restored = strip(index)
    if restored != index:
        tmp = webdir / "index.html.fpmigrate-tmp"
        tmp.write_text(restored, encoding="utf-8")
        os.replace(tmp, index_path)
    dest = webdir / "orbital"
    owner = dest / OWNER_FILE
    removed = []
    if owner.exists():
        info = json.loads(owner.read_text(encoding="utf-8"))
        for name in info.get("files", []):
            if (dest / name).exists():
                (dest / name).unlink()
                removed.append(name)
        owner.unlink()
        try:
            dest.rmdir()  # only if empty: never delete files we did not create
        except OSError:
            pass
    (webdir / BACKUP).unlink(missing_ok=True)
    return {"removedFiles": len(removed), "indexRestored": restored != index,
            "indexSha256": _sha(index_path.read_bytes())}
