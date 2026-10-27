"""Credential storage. Windows: DPAPI (current user) via ctypes. Elsewhere: memory only (nothing written)."""
from __future__ import annotations

import base64
import ctypes
import json
import sys
from pathlib import Path


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    crypt32 = ctypes.windll.crypt32  # type: ignore[attr-defined]
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = _Blob()
    entropy = b"fpmigrate-v1"
    ebuf = ctypes.create_string_buffer(entropy, len(entropy))
    blob_e = _Blob(len(entropy), ctypes.cast(ebuf, ctypes.POINTER(ctypes.c_char)))
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(blob_in), None, ctypes.byref(blob_e), None, None, 0x1, ctypes.byref(blob_out))
    if not ok:
        raise OSError("DPAPI operation failed")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


class Vault:
    def __init__(self, path: Path):
        self.path = path
        self.persistent = sys.platform == "win32"
        self._mem: dict[str, str] = {}
        if self.persistent and path.exists():
            try:
                self._mem = json.loads(_dpapi(base64.b64decode(path.read_bytes()), protect=False))
            except (OSError, ValueError):
                self._mem = {}

    def _save(self):
        if not self.persistent:
            return
        if not self._mem:
            self.path.unlink(missing_ok=True)
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(base64.b64encode(_dpapi(json.dumps(self._mem).encode(), protect=True)))

    def get(self, key: str) -> str | None:
        return self._mem.get(key)

    def put(self, key: str, value: str | None):
        if value:
            self._mem[key] = value
        else:
            self._mem.pop(key, None)
        self._save()

    def clear(self):
        self._mem = {}
        self._save()
