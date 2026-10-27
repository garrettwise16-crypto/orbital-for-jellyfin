"""Small JSON-over-HTTP helper (stdlib only) with bounded retries and secret redaction."""
from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

_SECRET_PATTERNS = [
    (re.compile(r"([?&](?:username|password)=)[^&\s\"']+", re.I), r"\1[REDACTED]"),
    (re.compile(r"(X-Plex-Token=)[^&\s\"']+", re.I), r"\1[REDACTED]"),
    (re.compile(r"(api_key=|ApiKey=|access_token=)[^&\s\"']+", re.I), r"\1[REDACTED]"),
    (re.compile(r'(Token=")[^"]*(")', re.I), r"\1[REDACTED]\2"),
    (re.compile(r'("(?:Pw|Password|AccessToken|authToken|accessToken)"\s*:\s*")[^"]*(")'), r"\1[REDACTED]\2"),
]


def redact(text: str) -> str:
    for pattern, repl in _SECRET_PATTERNS:
        text = pattern.sub(repl, text)
    return text


class HttpError(Exception):
    def __init__(self, status: int | None, method: str, url: str, detail: str = ""):
        self.status = status
        self.method = method
        self.url = redact(url)
        self.detail = redact(detail)[:300]
        super().__init__(f"{method} {self.url} -> {status if status is not None else 'no response'} {self.detail}".strip())

    @property
    def unreachable(self) -> bool:
        return self.status is None

    @property
    def unauthorized(self) -> bool:
        return self.status in (401, 403)


RETRY_STATUS = {429, 502, 503, 504}


def request(method: str, url: str, *, params: dict | None = None, headers: dict | None = None,
            body: object | None = None, timeout: float = 30.0, retries: int = 2,
            backoff: float = 0.75) -> tuple[int, bytes]:
    """Perform a request. Retries only idempotent-safe failures (network errors and 429/5xx gateway codes)."""
    if params:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None}, doseq=True)
        url = url + ("&" if "?" in url else "?") + query
    data = None
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    attempt = 0
    while True:
        attempt += 1
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            payload = exc.read()[:2000].decode("utf-8", "replace")
            if exc.code in RETRY_STATUS and attempt <= retries:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                delay = float(retry_after) if retry_after and retry_after.isdigit() else backoff * attempt
                time.sleep(min(delay, 10.0))
                continue
            raise HttpError(exc.code, method, url, payload) from None
        except (urllib.error.URLError, socket.timeout, ConnectionError, TimeoutError) as exc:
            if attempt <= retries:
                time.sleep(backoff * attempt)
                continue
            raise HttpError(None, method, url, str(getattr(exc, "reason", exc))) from None


def decode_json(raw: bytes):
    if not raw or not raw.strip():
        return None
    return json.loads(raw.decode("utf-8"))
