"""Signed update check. Off until Orbital hosts releases (UPDATE_URL is None and no key ships).

The manifest is JSON {"kid", "payload" (base64url JSON), "sig" (base64url Ed25519)}. The payload names the product,
version, an https download URL, its SHA-256 and size, and short notes. The app only tells the person an update exists
and, if they choose, downloads it and checks the hash; it never runs anything by itself.
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path

from . import __version__, ed25519

UPDATE_URL: str | None = os.environ.get("FPMIGRATE_UPDATE_URL") or None
UPDATE_KEYS: dict[str, str] = {}
PRODUCT_ID = "orbital-move-to-jellyfin"
MAX_MANIFEST = 64 * 1024


def _version(v: str) -> tuple:
    return tuple(int(x) for x in str(v).split(".") if x.isdigit())


def read_manifest(raw: bytes, keys: dict) -> dict:
    if len(raw) > MAX_MANIFEST:
        raise ValueError("manifest too large")
    doc = json.loads(raw)
    key = keys.get(doc.get("kid"))
    if not key:
        raise ValueError("unknown signing key")
    body, sig = ed25519.unb64(doc["payload"]), ed25519.unb64(doc["sig"])
    if not ed25519.verify(ed25519.unb64(key), body, sig):
        raise ValueError("bad signature")
    payload = json.loads(body)
    if payload.get("product") != PRODUCT_ID:
        raise ValueError("manifest for another product")
    if not str(payload.get("url", "")).startswith("https://"):
        raise ValueError("download must be https")
    if not (isinstance(payload.get("sha256"), str) and len(payload["sha256"]) == 64 and int(payload.get("size", 0)) > 0):
        raise ValueError("download hash and size required")
    return payload


def check(url: str | None = None, keys: dict | None = None, current: str = __version__, fetch=None) -> dict:
    url, keys = url or UPDATE_URL, UPDATE_KEYS if keys is None else keys
    if not url or not keys:
        return {"enabled": False, "reason": "Update checks start once Orbital publishes releases."}
    try:
        raw = fetch(url) if fetch else urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "MoveToJellyfin/" + current}), timeout=10).read(MAX_MANIFEST + 1)
        info = read_manifest(raw, keys)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {"enabled": True, "available": False, "error": str(exc)[:120]}
    newer = _version(info["version"]) > _version(current)
    return {"enabled": True, "available": newer, "version": info["version"], "notes": info.get("notes", ""),
            "url": info["url"], "sha256": info["sha256"], "size": int(info["size"])}


def download(info: dict, dest_dir: Path, fetch=None) -> Path:
    """Downloads the update next to the app and checks size and hash. Nothing is started."""
    data = fetch(info["url"]) if fetch else urllib.request.urlopen(info["url"], timeout=120).read(info["size"] + 1)
    if len(data) != info["size"] or hashlib.sha256(data).hexdigest() != info["sha256"]:
        raise ValueError("The download didn't match the signed release; it was discarded.")
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"MoveToJellyfin-{info['version']}.exe"
    path.write_bytes(data)
    return path
