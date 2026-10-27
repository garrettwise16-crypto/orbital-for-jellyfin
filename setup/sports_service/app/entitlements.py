"""Orbital plans for the customer edition (Oct 22 2026).

Owner direction: everyone gets full access for free; the more developed versions of two technologies cost money.
  Free, forever, never gated here: migration, the Orbital look, sports scores/Game Center/play trackers, and the
  watched game's tracker on an estimated delay with one-press "Sync to your picture" (basic picture alignment), plus games
  paired with your own channels by network (basic source matching).
  Orbital Plus (paid, later): automatic picture lock (advanced picture alignment) and picture-checked feed trust with
  automatic failover (advanced source matching). Neither is released for customers yet, so no code can switch them on
  and no clock starts.

A Orbital code is an offline-signed grant (Ed25519). Checking it needs no account, no server and no network.
An expired, invalid or missing code only ever turns Plus features off; free features and Jellyfin are unaffected.
Founding households receive codes issued after their setup is confirmed (so no trial clock runs before that).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time

MODULES = {
    "picture-lock": {"name": "Automatic picture lock", "family": "picture alignment", "released": False,
                     "free": "Estimated delay with one-press Sync to your picture"},
    "feed-trust": {"name": "Picture-checked feed trust", "family": "source matching", "released": False,
                   "free": "Games paired with your own channels by network"},
    "picture-plays": {"name": "Plays read from your picture", "family": "Picture reading", "released": False,
                      "free": "Plays from the sources you connect"},
}
# Public keys of the codes Orbital issues, by key id. Empty until the owner creates the issuing key
# (tools/issue_code.py init): until then no code is valid, which is the honest state today.
ISSUER_KEYS: dict[str, str] = {}
CLOCK_FILE = "clock-watermark"
MAX_CODE = 4096

# ---------------- Ed25519 (RFC 8032), pure Python ----------------
_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _xrecover(y):
    xx = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P:
        x = x * _I % _P
    if x % 2:
        x = _P - x
    return x


_BY = 4 * pow(5, _P - 2, _P) % _P
_B = (_xrecover(_BY), _BY, 1, _xrecover(_BY) * _BY % _P)


def _add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    A = (y1 - x1) * (y2 - x2) % _P
    B = (y1 + x1) * (y2 + x2) % _P
    C = 2 * _D * t1 * t2 % _P
    Dd = 2 * z1 * z2 % _P
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(s, p):
    q = (0, 1, 1, 0)
    while s:
        if s & 1:
            q = _add(q, p)
        p = _add(p, p)
        s >>= 1
    return q


def _encode(p):
    x, y, z, _ = p
    zi = pow(z, _P - 2, _P)
    x, y = x * zi % _P, y * zi % _P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _decode(b):
    if len(b) != 32:
        raise ValueError("bad point")
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    x = _xrecover(y)
    if (x & 1) != (b[31] >> 7):
        x = _P - x
    p = (x, y, 1, x * y % _P)
    if (-x * x + y * y - 1 - _D * x * x * y * y) % _P:
        raise ValueError("point not on curve")
    return p


def _h(*parts):
    return int.from_bytes(hashlib.sha512(b"".join(parts)).digest(), "little")


def public_key(secret: bytes) -> bytes:
    a = _clamp(hashlib.sha512(secret).digest()[:32])
    return _encode(_mul(a, _B))


def _clamp(b):
    a = int.from_bytes(b, "little")
    return (a & ((1 << 254) - 8)) | (1 << 254)


def sign(secret: bytes, message: bytes) -> bytes:
    h = hashlib.sha512(secret).digest()
    a, prefix = _clamp(h[:32]), h[32:]
    A = _encode(_mul(a, _B))
    r = _h(prefix, message) % _L
    R = _encode(_mul(r, _B))
    s = (r + _h(R, A, message) * a) % _L
    return R + s.to_bytes(32, "little")


def verify(public: bytes, message: bytes, signature: bytes) -> bool:
    try:
        if len(signature) != 64:
            return False
        R, s = _decode(signature[:32]), int.from_bytes(signature[32:], "little")
        if s >= _L:
            return False
        A = _decode(public)
        lhs = _encode(_mul(s, _B))
        rhs = _encode(_add(R, _mul(_h(signature[:32], public, message) % _L, A)))
        return lhs == rhs
    except (ValueError, TypeError):
        return False


# ---------------- codes ----------------
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue(secret: bytes, key_id: str, payload: dict) -> str:
    """Owner side (tools/issue_code.py). The code is 'FP1.<key id>.<payload>.<signature>'."""
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return "FP1." + key_id + "." + _b64(body) + "." + _b64(sign(secret, body))


def read_code(code: str, keys: dict | None = None) -> dict:
    """Validated payload, or a reason it isn't valid. Never raises on bad input."""
    keys = ISSUER_KEYS if keys is None else keys
    code = (code or "").strip()
    if not code:
        return {"valid": False, "reason": "none"}
    if len(code) > MAX_CODE or code.count(".") != 3 or not code.startswith("FP1."):
        return {"valid": False, "reason": "That isn't a Orbital code."}
    _, kid, body_b64, sig_b64 = code.split(".")
    key = keys.get(kid)
    if not key:
        return {"valid": False, "reason": "This code was issued for a different Orbital release."}
    try:
        body, sig = _unb64(body_b64), _unb64(sig_b64)
        if not verify(_unb64(key), body, sig):
            return {"valid": False, "reason": "This code's signature doesn't check out."}
        payload = json.loads(body)
    except (ValueError, TypeError):
        return {"valid": False, "reason": "That isn't a Orbital code."}
    if payload.get("v") != 1 or not isinstance(payload.get("modules"), list):
        return {"valid": False, "reason": "This code needs a newer Orbital release."}
    return {"valid": True, "payload": payload}


def trusted_now(data_dir: str | None, now: float | None = None) -> float:
    """Wall clock that can't be rolled back to stretch a code: the latest time ever seen is kept on disk."""
    now = time.time() if now is None else now
    if not data_dir:
        return now
    path = os.path.join(data_dir, CLOCK_FILE)
    try:
        seen = float(open(path, encoding="utf-8").read().strip() or 0)
    except (OSError, ValueError):
        seen = 0.0
    if now > seen:
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(f"{now:.0f}")
            os.replace(tmp, path)
        except OSError:
            pass
        return now
    return seen


def plan(code: str | None, data_dir: str | None = None, server_id: str | None = None, keys: dict | None = None,
         now: float | None = None) -> dict:
    """What this server gets. Free is always complete; Plus modules need a valid, current, matching code AND a
    released module. Expiry, a bad code or a missing key never affect free features."""
    result = {"free": True, "tier": "free", "plus": {}, "code": None}
    now = trusted_now(data_dir, now)
    read = read_code(code or "", keys)
    if not read["valid"]:
        if read["reason"] != "none":
            result["code"] = {"valid": False, "reason": read["reason"]}
        granted = []
    else:
        p = read["payload"]
        reason = None
        if p.get("server") and server_id and p["server"] != server_id:
            reason = "This code belongs to a different Jellyfin server."
        elif now < float(p.get("not_before", 0)):
            reason = "This code isn't active yet."
        elif now >= float(p.get("expires", 0)):
            reason = "This code has ended. Everything free keeps working."
        result["code"] = {"valid": reason is None, "reason": reason, "kind": p.get("kind"),
                          "expires": p.get("expires"), "id": p.get("id")}
        granted = [] if reason else [m for m in p["modules"] if m in MODULES]
    for key, module in MODULES.items():
        on = key in granted and module["released"]
        result["plus"][key] = {"name": module["name"], "family": module["family"], "on": on,
                               "released": module["released"], "granted": key in granted, "free": module["free"]}
    if any(m["on"] for m in result["plus"].values()):
        result["tier"] = "plus"
    return result
