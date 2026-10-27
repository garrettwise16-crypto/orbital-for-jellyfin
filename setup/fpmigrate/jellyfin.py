"""Jellyfin REST client covering the supported admin/user-data APIs used by the migration (verified on 12.0)."""
from __future__ import annotations

import dataclasses
import time
import uuid
from datetime import datetime, timezone
from typing import Iterator

from . import PRODUCT, __version__
from .netio import HttpError, decode_json, request

TICKS_PER_MS = 10_000
PAGE = 500
COLLECTION_TYPES = {"movie": "movies", "show": "tvshows", "artist": "music", "photo": "homevideos"}


def parse_jf_date(value: str | None) -> datetime | None:
    if not value:
        return None
    v = value.rstrip("Z")
    if "." in v:
        head, frac = v.split(".", 1)
        v = f"{head}.{frac[:6]}"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def format_jf_date(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")


@dataclasses.dataclass
class UserState:
    played: bool = False
    play_count: int = 0
    position_ticks: int = 0
    last_played: datetime | None = None
    rating: float | None = None
    is_favorite: bool = False
    likes: bool | None = None

    @classmethod
    def from_json(cls, d: dict | None) -> "UserState":
        d = d or {}
        return cls(played=bool(d.get("Played")), play_count=int(d.get("PlayCount") or 0),
                   position_ticks=int(d.get("PlaybackPositionTicks") or 0),
                   last_played=parse_jf_date(d.get("LastPlayedDate")), rating=d.get("Rating"),
                   is_favorite=bool(d.get("IsFavorite")), likes=d.get("Likes"))

    def to_record(self) -> dict:
        return {"Played": self.played, "PlayCount": self.play_count, "PlaybackPositionTicks": self.position_ticks,
                "LastPlayedDate": format_jf_date(self.last_played) if self.last_played else None,
                "Rating": self.rating, "IsFavorite": self.is_favorite, "Likes": self.likes}


@dataclasses.dataclass
class JfItem:
    id: str
    kind: str  # Movie | Episode
    name: str
    paths: list[str]
    provider_ids: dict
    series_name: str | None = None
    season: int | None = None
    episode: int | None = None
    episode_end: int | None = None
    library_id: str | None = None
    state: UserState | None = None


class Jellyfin:
    def __init__(self, base_url: str, token: str | None = None, device_id: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.device_id = device_id or uuid.uuid4().hex
        self.user_id: str | None = None

    # -- plumbing -----------------------------------------------------------------------------------
    def _auth_header(self) -> dict:
        parts = [f'Client="{PRODUCT}"', 'Device="Migration companion"', f'DeviceId="{self.device_id}"',
                 f'Version="{__version__}"']
        if self.token:
            parts.append(f'Token="{self.token}"')
        return {"Authorization": "MediaBrowser " + ", ".join(parts)}

    def call(self, method: str, path: str, params: dict | None = None, body=None, timeout: float = 60.0,
             retries: int | None = None):
        if retries is None:
            retries = 2 if method == "GET" else 0
        _, raw = request(method, self.base_url + path, params=params, body=body, headers=self._auth_header(),
                         timeout=timeout, retries=retries)
        return decode_json(raw)

    # -- server / setup -----------------------------------------------------------------------------
    def public_info(self) -> dict:
        return self.call("GET", "/System/Info/Public", timeout=4, retries=0)

    def wait_until_ready(self, timeout_s: float = 120) -> dict:
        deadline = time.time() + timeout_s
        while True:
            try:
                info = self.public_info()
                if info and info.get("Version"):
                    return info
            except (HttpError, ValueError):
                pass
            if time.time() > deadline:
                raise TimeoutError("Jellyfin did not become ready")
            time.sleep(2)

    def complete_startup(self, admin_name: str, password: str, culture: str = "en-US", country: str = "US",
                         language: str = "en", allow_remote: bool = False) -> None:
        """Run the stock first-run wizard through its own API. Only valid while StartupWizardCompleted=false."""
        self.call("POST", "/Startup/Configuration", body={"UICulture": culture, "MetadataCountryCode": country,
                                                         "PreferredMetadataLanguage": language})
        self.call("GET", "/Startup/User")  # materialises the initial user as the wizard does
        self.call("POST", "/Startup/User", body={"Name": admin_name, "Password": password})
        self.call("POST", "/Startup/RemoteAccess", body={"EnableRemoteAccess": allow_remote})
        self.call("POST", "/Startup/Complete")

    def authenticate(self, username: str, password: str) -> dict:
        data = self.call("POST", "/Users/AuthenticateByName", body={"Username": username, "Pw": password})
        self.token = data["AccessToken"]
        self.user_id = data["User"]["Id"]
        return data["User"]

    def me(self) -> dict:
        return self.call("GET", "/Users/Me")

    def logout(self) -> None:
        if self.token:
            try:
                self.call("POST", "/Sessions/Logout")
            except HttpError:
                pass
            self.token = None

    # -- users --------------------------------------------------------------------------------------
    def users(self) -> list[dict]:
        return self.call("GET", "/Users")

    def user(self, user_id: str) -> dict:
        return self.call("GET", f"/Users/{user_id}")

    def create_user(self, name: str, password: str) -> dict:
        return self.call("POST", "/Users/New", body={"Name": name, "Password": password})

    def delete_user(self, user_id: str) -> None:
        self.call("DELETE", f"/Users/{user_id}")

    def set_policy(self, user_id: str, policy: dict) -> None:
        self.call("POST", f"/Users/{user_id}/Policy", body=policy)

    # -- libraries ----------------------------------------------------------------------------------
    def virtual_folders(self) -> list[dict]:
        return self.call("GET", "/Library/VirtualFolders") or []

    def validate_path(self, path: str) -> bool:
        try:
            self.call("POST", "/Environment/ValidatePath", body={"Path": path, "ValidateWritable": False,
                                                                 "IsFile": False})
            return True
        except HttpError as exc:
            if exc.status in (400, 404):
                return False
            raise

    def directory_contents(self, path: str) -> list[str]:
        rows = self.call("GET", "/Environment/DirectoryContents",
                         {"path": path, "includeFiles": "false", "includeDirectories": "true"}) or []
        return [r["Path"] for r in rows if r.get("Path")]

    def drives(self) -> list[str]:
        return [d["Path"] for d in self.call("GET", "/Environment/Drives") or [] if d.get("Path")]

    def add_library(self, name: str, collection_type: str, paths: list[str]) -> None:
        options = {"PathInfos": [{"Path": p} for p in paths], "EnableRealtimeMonitor": True}
        if collection_type == "movies":
            options["AutomaticallyAddToCollection"] = True  # franchise collections, as Plex shows them
        self.call("POST", "/Library/VirtualFolders",
                  {"name": name, "collectionType": collection_type, "refreshLibrary": "true"},
                  body={"LibraryOptions": options}, timeout=120)

    def remove_library(self, name: str) -> None:
        # refreshLibrary=true: without it Jellyfin keeps the removed library's items visible until a later scan
        self.call("DELETE", "/Library/VirtualFolders", {"name": name, "refreshLibrary": "true"}, timeout=120)

    def refresh_library(self) -> None:
        self.call("POST", "/Library/Refresh")

    def library_scan_running(self) -> tuple[bool, float | None]:
        for t in self.call("GET", "/ScheduledTasks", {"isHidden": "false"}) or []:
            if t.get("Key") == "RefreshLibrary":
                return t.get("State") != "Idle", t.get("CurrentProgressPercentage")
        return False, None

    # -- items & user data ------------------------------------------------------------------------
    def items(self, user_id: str, kinds=("Movie", "Episode"), parent_id: str | None = None) -> Iterator[JfItem]:
        start = 0
        while True:
            data = self.call("GET", "/Items", {
                "userId": user_id, "recursive": "true", "includeItemTypes": ",".join(kinds),
                "fields": "Path,ProviderIds,MediaSources", "enableUserData": "true", "parentId": parent_id,
                "startIndex": start, "limit": PAGE, "sortBy": "SortName", "enableImages": "false"}, timeout=120)
            rows = data.get("Items") or []
            for r in rows:
                paths = [s["Path"] for s in r.get("MediaSources") or [] if s.get("Path")]
                if r.get("Path") and r["Path"] not in paths:
                    paths.insert(0, r["Path"])
                yield JfItem(id=r["Id"], kind=r.get("Type", ""), name=r.get("Name", ""), paths=paths,
                             provider_ids={k.lower(): str(v) for k, v in (r.get("ProviderIds") or {}).items() if v},
                             series_name=r.get("SeriesName"), season=r.get("ParentIndexNumber"),
                             episode=r.get("IndexNumber"), episode_end=r.get("IndexNumberEnd"),
                             library_id=parent_id, state=UserState.from_json(r.get("UserData")))
            start += len(rows)
            if not rows or start >= int(data.get("TotalRecordCount") or 0):
                break

    def count_items(self, user_id: str, parent_id: str | None = None) -> int:
        data = self.call("GET", "/Items", {"userId": user_id, "recursive": "true",
                                           "includeItemTypes": "Movie,Episode", "parentId": parent_id,
                                           "limit": 0, "enableTotalRecordCount": "true"})
        return int(data.get("TotalRecordCount") or 0)

    def get_user_data(self, user_id: str, item_id: str) -> UserState:
        return UserState.from_json(self.call("GET", f"/UserItems/{item_id}/UserData", {"userId": user_id}))

    def update_user_data(self, user_id: str, item_id: str, fields: dict) -> UserState:
        body = {k: v for k, v in fields.items() if v is not None}
        data = self.call("POST", f"/UserItems/{item_id}/UserData", {"userId": user_id}, body=body, retries=1)
        return UserState.from_json(data)

    def clear_rating(self, user_id: str, item_id: str, keep_likes: bool | None = None) -> UserState:
        """Jellyfin ignores Rating=null; its rating DELETE clears Rating and Likes, so Likes is put back."""
        data = self.call("DELETE", f"/UserItems/{item_id}/Rating", {"userId": user_id})
        if keep_likes is not None:
            data = self.call("POST", f"/UserItems/{item_id}/Rating", {"userId": user_id,
                                                                     "likes": str(keep_likes).lower()})
        return UserState.from_json(data)

    # -- home layout ----------------------------------------------------------------------------------
    def home_prefs(self, user_id: str) -> dict:
        return self.call("GET", "/DisplayPreferences/usersettings", {"userId": user_id, "client": "emby"})

    def set_home_prefs(self, user_id: str, prefs: dict) -> None:
        self.call("POST", "/DisplayPreferences/usersettings", {"userId": user_id, "client": "emby"}, body=prefs)

    # -- playlists & collections ---------------------------------------------------------------------
    def _named(self, user_id: str, kind: str) -> dict:
        data = self.call("GET", "/Items", {"userId": user_id, "recursive": "true", "includeItemTypes": kind})
        return {r["Name"]: r["Id"] for r in data.get("Items") or []}

    def user_playlists(self, user_id: str) -> dict:
        return self._named(user_id, "Playlist")

    def collections(self, user_id: str) -> dict:
        return self._named(user_id, "BoxSet")

    def playlist_item_ids(self, playlist_id: str, user_id: str) -> list[str]:
        data = self.call("GET", f"/Playlists/{playlist_id}/Items", {"userId": user_id})
        return [r["Id"] for r in data.get("Items") or []]

    def collection_item_ids(self, collection_id: str, user_id: str) -> list[str]:
        data = self.call("GET", "/Items", {"userId": user_id, "parentId": collection_id})
        return [r["Id"] for r in data.get("Items") or []]

    def create_playlist(self, name: str, ids: list[str], user_id: str) -> str:
        data = self.call("POST", "/Playlists", body={"Name": name, "Ids": ids, "UserId": user_id,
                                                     "MediaType": "Video", "IsPublic": False})
        return data["Id"]

    def add_to_playlist(self, playlist_id: str, ids: list[str], user_id: str) -> None:
        self.call("POST", f"/Playlists/{playlist_id}/Items", {"ids": ",".join(ids), "userId": user_id})

    def create_collection(self, name: str, ids: list[str]) -> str:
        data = self.call("POST", "/Collections", {"name": name, "ids": ",".join(ids), "isLocked": "false"})
        return data["Id"]

    def add_to_collection(self, collection_id: str, ids: list[str]) -> None:
        self.call("POST", f"/Collections/{collection_id}/Items", {"ids": ",".join(ids)})

    def delete_item(self, item_id: str) -> None:
        self.call("DELETE", f"/Items/{item_id}")

    def resume_items(self, user_id: str, limit: int = 12) -> list[dict]:
        data = self.call("GET", "/UserItems/Resume", {"userId": user_id, "limit": limit,
                                                      "mediaTypes": "Video"})
        return data.get("Items") or []
