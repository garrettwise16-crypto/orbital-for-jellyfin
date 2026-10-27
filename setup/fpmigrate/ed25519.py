"""Ed25519 (RFC 8032) in pure Python: signing for tests and owner tools, verification for signed update manifests.
Same implementation as the sports service's plan checks; verified against the RFC 8032 test vectors."""
from __future__ import annotations

import base64
import hashlib

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


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
