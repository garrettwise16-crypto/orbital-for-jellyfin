"""Plex access. The Plex *server* client is strictly read-only: it can only issue GET requests.

plex.tv calls (PIN sign-in, server discovery, Plex Home profile switch) are account-service calls and
never modify the Plex server, its database or its media.
"""
from __future__ import annotations

import dataclasses
import urllib.parse
from typing import Iterator

from . import PRODUCT, __version__
from .netio import HttpError, decode_json, request

PLEX_TV = "https://plex.tv"
APP_AUTH = "https://app.plex.tv/auth#?"
PAGE = 200


def _guid_map(item: dict) -> dict:
    ids = {}
    for g in item.get("Guid") or []:
        gid = g.get("id", "")
        if "://" in gid:
            scheme, value = gid.split("://", 1)
            if scheme in ("imdb", "tmdb", "tvdb") and value:
                ids[scheme] = value
    return ids


@dataclasses.dataclass
class Section:
    key: str
    kind: str  # movie | show | artist | photo
    title: str
    locations: list[str]

    @property
    def state_supported(self) -> bool:
        return self.kind in ("movie", "show")


@dataclasses.dataclass
class PlexRecord:
    rating_key: str
    kind: str  # movie | episode
    title: str
    files: list[str]
    guids: dict
    year: int | None = None
    show_title: str | None = None
    season: int | None = None
    episode: int | None = None
    duration_ms: int | None = None
    view_count: int = 0
    view_offset_ms: int = 0
    last_viewed_at: int | None = None  # epoch seconds
    user_rating: float | None = None
    section_key: str = ""

    @property
    def label(self) -> str:
        if self.kind == "episode":
            s = f"S{self.season:02d}" if self.season is not None else "S??"
            e = f"E{self.episode:02d}" if self.episode is not None else "E??"
            return f"{self.show_title or '?'} {s}{e}"
        return f"{self.title} ({self.year})" if self.year else self.title

    @property
    def has_state(self) -> bool:
        return bool(self.view_count or self.view_offset_ms or self.user_rating is not None)


def record_from_json(item: dict, section_key: str = "") -> PlexRecord:
    files = [p["file"] for m in item.get("Media") or [] for p in m.get("Part") or [] if p.get("file")]
    rating = item.get("userRating")
    return PlexRecord(
        rating_key=str(item["ratingKey"]), kind=item.get("type", ""), title=item.get("title", ""),
        files=files, guids=_guid_map(item), year=item.get("year"),
        show_title=item.get("grandparentTitle"), season=item.get("parentIndex"), episode=item.get("index"),
        duration_ms=item.get("duration"), view_count=int(item.get("viewCount") or 0),
        view_offset_ms=int(item.get("viewOffset") or 0), last_viewed_at=item.get("lastViewedAt"),
        user_rating=float(rating) if rating is not None else None, section_key=section_key)


class PlexServer:
    """Read-only Plex Media Server client."""

    def __init__(self, base_url: str, token: str | None = None, client_id: str = "fpmigrate"):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.client_id = client_id

    def _headers(self) -> dict:
        h = {"X-Plex-Product": PRODUCT, "X-Plex-Version": __version__, "X-Plex-Client-Identifier": self.client_id}
        if self.token:
            h["X-Plex-Token"] = self.token
        return h

    def get(self, path: str, params: dict | None = None, timeout: float = 30.0, retries: int = 2):
        # The only request method this class exposes. Never add PUT/POST/DELETE here.
        _, raw = request("GET", self.base_url + path, params=params, headers=self._headers(), timeout=timeout,
                         retries=retries)
        return decode_json(raw)

    def identity(self) -> dict:
        return self.get("/identity", timeout=4, retries=0)["MediaContainer"]

    def can_read_library(self) -> bool:
        try:
            self.get("/library/sections", timeout=10, retries=0)
            return True
        except HttpError as exc:
            if exc.unauthorized:
                return False
            raise

    def sections(self) -> list[Section]:
        dirs = self.get("/library/sections")["MediaContainer"].get("Directory") or []
        return [Section(key=str(d["key"]), kind=d.get("type", ""), title=d.get("title", ""),
                        locations=[loc["path"] for loc in d.get("Location") or []]) for d in dirs]

    def leaf_items(self, section: Section) -> Iterator[PlexRecord]:
        if section.kind == "movie":
            ptype = 1
        elif section.kind == "show":
            ptype = 4
        else:
            return
        start = 0
        while True:
            mc = self.get(f"/library/sections/{section.key}/all",
                          {"type": ptype, "includeGuids": 1, "X-Plex-Container-Start": start,
                           "X-Plex-Container-Size": PAGE})["MediaContainer"]
            items = mc.get("Metadata") or []
            for it in items:
                yield record_from_json(it, section.key)
            start += len(items)
            total = mc.get("totalSize")
            if not items or (total is not None and start >= int(total)):
                break

    def _keys(self, path: str) -> list[str]:
        out, start = [], 0
        while True:
            mc = self.get(path, {"X-Plex-Container-Start": start, "X-Plex-Container-Size": PAGE})["MediaContainer"]
            rows = mc.get("Metadata") or []
            out += [str(r["ratingKey"]) for r in rows]
            start += len(rows)
            total = mc.get("totalSize")
            if not rows or total is None or start >= int(total):
                return out

    def playlists(self) -> list[dict]:
        rows = self.get("/playlists", {"playlistType": "video"})["MediaContainer"].get("Metadata") or []
        return [{"key": str(r["ratingKey"]), "title": r.get("title", ""), "smart": bool(r.get("smart"))} for r in rows]

    def playlist_items(self, key: str) -> list[str]:
        return self._keys(f"/playlists/{key}/items")

    def collections(self, section: Section) -> list[dict]:
        rows = self.get(f"/library/sections/{section.key}/collections")["MediaContainer"].get("Metadata") or []
        return [{"key": str(r["ratingKey"]), "title": r.get("title", ""), "smart": bool(r.get("smart"))} for r in rows]

    def collection_items(self, key: str) -> list[str]:
        return self._keys(f"/library/collections/{key}/children")

    def accounts(self) -> list[dict]:
        return self.get("/accounts")["MediaContainer"].get("Account") or []

    def history_for_account(self, account_id: int) -> Iterator[dict]:
        """Completed-view history (viewedAt/ratingKey). Does not include items only *marked* watched."""
        start = 0
        while True:
            mc = self.get("/status/sessions/history/all",
                          {"accountID": account_id, "sort": "viewedAt:desc", "X-Plex-Container-Start": start,
                           "X-Plex-Container-Size": PAGE})["MediaContainer"]
            rows = mc.get("Metadata") or []
            yield from rows
            start += len(rows)
            total = mc.get("totalSize")
            if not rows or (total is not None and start >= int(total)):
                break


class PlexAccountService:
    """plex.tv sign-in via the documented PIN flow; the user signs in on plex.tv, never in this app."""

    def __init__(self, client_id: str, base: str = PLEX_TV, app_auth: str = APP_AUTH):
        self.client_id = client_id
        self.base = base.rstrip("/")
        self.app_auth = app_auth

    def _headers(self, token: str | None = None) -> dict:
        h = {"X-Plex-Product": PRODUCT, "X-Plex-Version": __version__, "X-Plex-Client-Identifier": self.client_id}
        if token:
            h["X-Plex-Token"] = token
        return h

    def start_pin(self) -> dict:
        _, raw = request("POST", self.base + "/api/v2/pins", params={"strong": "true"}, headers=self._headers(),
                         retries=0)
        pin = decode_json(raw)
        query = urllib.parse.urlencode({"clientID": self.client_id, "code": pin["code"],
                                        "context[device][product]": PRODUCT})
        return {"id": pin["id"], "code": pin["code"], "authUrl": self.app_auth + query}

    def poll_pin(self, pin_id) -> str | None:
        _, raw = request("GET", f"{self.base}/api/v2/pins/{pin_id}", headers=self._headers())
        return (decode_json(raw) or {}).get("authToken") or None

    def servers(self, token: str) -> list[dict]:
        _, raw = request("GET", self.base + "/api/v2/resources", params={"includeHttps": 1},
                         headers=self._headers(token))
        out = []
        for r in decode_json(raw) or []:
            if "server" in (r.get("provides") or ""):
                out.append({"name": r.get("name"), "machineIdentifier": r.get("clientIdentifier"),
                            "owned": bool(r.get("owned")), "accessToken": r.get("accessToken"),
                            "connections": [{"uri": c.get("uri"), "local": bool(c.get("local"))}
                                            for c in r.get("connections") or []]})
        return out

    def home_users(self, token: str) -> list[dict]:
        _, raw = request("GET", self.base + "/api/v2/home/users", headers=self._headers(token))
        data = decode_json(raw) or {}
        users = data.get("users", data) if isinstance(data, dict) else data
        return [{"id": u.get("id"), "uuid": u.get("uuid"), "title": u.get("title") or u.get("username"),
                 "admin": bool(u.get("admin")), "restricted": bool(u.get("restricted")),
                 "protected": bool(u.get("protected"))} for u in users or []]

    def switch_home_user(self, token: str, uuid: str, pin: str | None = None) -> str:
        _, raw = request("POST", f"{self.base}/api/v2/home/users/{uuid}/switch",
                         params={"pin": pin} if pin else None, headers=self._headers(token), retries=0)
        return decode_json(raw)["authToken"]
