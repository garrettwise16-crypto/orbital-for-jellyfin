"""Original Orbital experience candidate. Python 3.12+, standard library only.

No production side effects on import. HTTP adapters must authenticate every call.
No Jellyfin writes, provider probes, acquisition, telemetry, or external AI calls.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import stat
import re
import secrets
import sqlite3
import threading
import time
from collections import Counter, OrderedDict
from contextlib import contextmanager, closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

SCHEMA = 3
MUTATION_RECEIPT_LIMIT = 20000
MAX_DOCUMENT = 262144
ID = re.compile(r"[0-9a-f]{32}\Z")


class Fault(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status, self.code = status, code


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def item_id(value: Any) -> str:
    if not isinstance(value, str):
        raise Fault(400, "invalid_item_id")
    value = value.lower().replace("-", "")
    if not ID.fullmatch(value):
        raise Fault(400, "invalid_item_id")
    return value


def integer(value: Any, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise Fault(400, "invalid_integer")
    return value


def text(value: Any, limit: int, empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise Fault(400, "invalid_text")
    if any(ord(c) < 32 for c in value):
        raise Fault(400, "invalid_text")
    return value.strip()


def keys(value: Any, allowed: Iterable[str], required: Iterable[str] = ()) -> dict:
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise Fault(400, "invalid_fields")
    return value


@dataclass(frozen=True)
class Actor:
    server: str
    user: str
    policy: str

    @classmethod
    def from_user(cls, server: str, user: Mapping[str, Any]) -> "Actor":
        uid = item_id(user.get("Id"))
        policy = user.get("Policy")
        if not isinstance(policy, dict) or policy.get("IsDisabled"):
            raise Fault(403, "account_unavailable")
        return cls(text(server, 128), uid, digest(policy))

    @property
    def key(self) -> str:
        return digest([self.server, self.user])


PREFS = {
    "episode_images": False, "episode_titles": False, "episode_descriptions": False,
    "sports_scores": False, "sports_results": False, "sports_headlines": False,
    "sports_thumbnails": False, "auto_intro": True, "auto_credits": True, "subtitle_language": "",
}


def defaults() -> dict:
    return {"schema": SCHEMA, "preferences": dict(PREFS), "shelves": [], "hidden": [],
            "watchlist": [], "dismissed": [], "snoozed": {}, "feedback": {}, "bookmarks": []}


def rule(value: Any) -> dict:
    allowed = {"types", "genres", "year_min", "year_max", "runtime_max_minutes", "watched",
               "availability", "sort", "favorites_only", "provider", "discovery", "min_rating", "subgenre", "co_genre", "parent_id"}
    keys(value, allowed)
    out = copy.deepcopy(value)
    if 'parent_id' in out:
        out['parent_id'] = item_id(out['parent_id'])
    if 'co_genre' in out:
        out['co_genre'] = text(out['co_genre'],80)
    if 'subgenre' in out:
        from experience_taxonomy import TAXONOMY
        out['subgenre'] = text(out['subgenre'],160)
        modes = ['tv' if t == 'Series' else 'movies' for t in out.get('types',['Movie','Series'])]
        if not any(out['subgenre'] == n for mode in modes for genre in out.get('genres',[]) for n,_ in TAXONOMY.get(mode,{}).get(genre,[])):
            raise Fault(400,'unknown_subgenre')
    for name in ("types", "genres"):
        if name in out:
            if not isinstance(out[name], list) or not 1 <= len(out[name]) <= 20:
                raise Fault(400, "invalid_rule")
            out[name] = sorted(set(text(v, 80) for v in out[name]))
    if set(out.get("types", [])) - {"Movie", "Series", "Episode"}:
        raise Fault(400, "invalid_rule_type")
    for name in ("year_min", "year_max"):
        if name in out:
            integer(out[name], 1800, 2500)
    if out.get("year_min", 1800) > out.get("year_max", 2500):
        raise Fault(400, "invalid_year_range")
    if "runtime_max_minutes" in out:
        integer(out["runtime_max_minutes"], 1, 1440)
    if out.get("watched", "all") not in {"all", "watched", "unwatched", "unfinished"}:
        raise Fault(400, "invalid_watch_filter")
    if out.get("availability", "library") not in {"all", "library", "verified"}:
        raise Fault(400, "invalid_availability")
    if "min_rating" in out:
        integer(out["min_rating"], 1, 10)
    if out.get("sort", "name") not in {"name", "year", "runtime", "source", "rating", "added"}:
        raise Fault(400, "invalid_sort")
    if "favorites_only" in out and type(out["favorites_only"]) is not bool:
        raise Fault(400, "invalid_boolean")
    if "provider" in out:
        if out["provider"] not in {"apple-tv", "netflix", "disney-plus", "hulu", "max", "prime-video", "peacock", "paramount-plus"}:
            raise Fault(400, "invalid_provider")
    if "discovery" in out:
        # Preserve existing supported _discover attributes without interpreting them as SQL.
        d = keys(out["discovery"], {"genre", "sub", "co", "decade", "watch", "favorite", "rating", "sort", "type", "scope", "search"})
        out["discovery"] = {k: text(v, 160, True) for k, v in d.items()}
        if not out.get("provider"):
            raise Fault(400, "discovery_requires_provider")
    return out


TEMPLATES = [
    {"name": "Unwatched short movies", "rule": {"types": ["Movie"], "watched": "unwatched", "runtime_max_minutes": 95}},
    {"name": "Unfinished series", "rule": {"types": ["Series"], "watched": "unfinished"}},
]


class Store:
    """One small SQLite database, CAS revisions, user isolation and atomic migrations.

    Directory must be a private durable mount, not Jellyfin's own database. Nothing
    copies viewing history here. Connections are short-lived and never hold tokens.
    """
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent_info = Path(path).parent.lstat()
        if not stat.S_ISDIR(parent_info.st_mode) or (os.name == 'posix' and (parent_info.st_mode & 0o077 or parent_info.st_uid != os.getuid())):
            raise Fault(503, 'private_directory_required')
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            os.close(descriptor)
        except FileExistsError:
            info = Path(path).lstat()
            if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and info.st_mode & 0o077):
                raise Fault(503, "private_database_permissions_required")
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("BEGIN IMMEDIATE")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA:
                raise Fault(503, "newer_database_schema")
            if version == 0:
                db.execute("CREATE TABLE state (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)")
                db.execute("CREATE TABLE intents (owner TEXT NOT NULL, ikey TEXT NOT NULL, logical TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, remote_id TEXT, updated REAL NOT NULL, PRIMARY KEY(owner,ikey), UNIQUE(owner,logical))")
                db.execute("PRAGMA user_version=1")
            if version < 2:
                db.execute("CREATE TABLE mutations (owner TEXT NOT NULL, mutation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, applied_revision INTEGER NOT NULL, PRIMARY KEY(owner,mutation_id))")
                db.execute("PRAGMA user_version=2")
            if version < 3:
                db.execute("CREATE TABLE mutation_cancellations (owner TEXT NOT NULL, mutation_id TEXT NOT NULL, PRIMARY KEY(owner,mutation_id))")
                db.execute("PRAGMA user_version=3")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=3)
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _read(db, owner: str) -> dict:
        row = db.execute("SELECT revision,document FROM state WHERE owner=?", (owner,)).fetchone()
        if not row:
            return {"revision": 0, **defaults()}
        state = json.loads(row[1])
        state.setdefault("snoozed", {})
        state["preferences"] = {**PREFS, **state.get("preferences", {})}
        state["schema"] = SCHEMA  # schema-1 fields are unchanged; projection does not invent a write
        return {"revision": row[0], **state}

    def read(self, actor: Actor) -> dict:
        with self.connect() as db:
            return self._read(db, actor.key)

    def mutation_receipt(self, actor: Actor, mutation_id: str, fingerprint: str | None = None) -> dict:
        """A receipt is evidence of a COMMITTED transaction; absence is only unknown.

        Keys are retained, never automatically evicted and later accepted again.
        No operation payload, title, bookmark label or credential is retained here.
        """
        mutation_id = item_id(mutation_id)
        with self.connect() as db:
            row = db.execute("SELECT fingerprint,applied_revision FROM mutations WHERE owner=? AND mutation_id=?", (actor.key, mutation_id)).fetchone()
            if row and fingerprint is not None and row[0] != fingerprint:
                raise Fault(409, "mutation_id_reused")
            cancelled = db.execute("SELECT 1 FROM mutation_cancellations WHERE owner=? AND mutation_id=?", (actor.key, mutation_id)).fetchone()
            return {"id": mutation_id, "outcome": "committed" if row else "cancelled" if cancelled else "unknown", "applied_revision": row[1] if row else None}

    def cancel_mutation(self, actor: Actor, mutation_id: str) -> dict:
        """Seal an unknown operation against late commits, or report its prior commit.

        Uses the SAME write lock/transaction as mutate. A cancelled ID can never
        later write. This never reverses a committed user preference.
        """
        mutation_id = item_id(mutation_id)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            committed = db.execute("SELECT applied_revision FROM mutations WHERE owner=? AND mutation_id=?", (actor.key, mutation_id)).fetchone()
            if committed:
                return {"id": mutation_id, "outcome": "committed", "applied_revision": committed[0]}
            count = db.execute("SELECT COUNT(*) FROM mutation_cancellations WHERE owner=?", (actor.key,)).fetchone()[0]
            if count >= MUTATION_RECEIPT_LIMIT: raise Fault(422, "cancellation_capacity")
            db.execute("INSERT OR IGNORE INTO mutation_cancellations VALUES(?,?)", (actor.key, mutation_id))
            return {"id": mutation_id, "outcome": "cancelled", "applied_revision": None}

    def mutate(self, actor: Actor, revision: int, operation: dict, mutation_id: str | None = None) -> dict:
        integer(revision, 0, 2**53 - 1)
        keys(operation, {"kind", "value", "id", "order"}, {"kind"})
        fingerprint = digest({"revision": revision, "operation": operation})
        if mutation_id is not None:
            mutation_id = item_id(mutation_id)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            state = self._read(db, actor.key)
            if mutation_id is not None:
                if db.execute("SELECT 1 FROM mutation_cancellations WHERE owner=? AND mutation_id=?", (actor.key, mutation_id)).fetchone():
                    raise Fault(410, "mutation_cancelled")
                prior = db.execute("SELECT fingerprint,applied_revision FROM mutations WHERE owner=? AND mutation_id=?", (actor.key, mutation_id)).fetchone()
                if prior:
                    if prior[0] != fingerprint:
                        raise Fault(409, "mutation_id_reused")
                    # Return current state, never resurrect the state of an older receipt.
                    return {**state, "mutation": {"id": mutation_id, "outcome": "committed", "applied_revision": prior[1], "replayed": True}}
                if db.execute("SELECT COUNT(*) FROM mutations WHERE owner=?", (actor.key,)).fetchone()[0] >= MUTATION_RECEIPT_LIMIT:
                    raise Fault(422, "mutation_receipt_capacity")
            if state.pop("revision") != revision:
                raise Fault(409, "revision_conflict")
            kind, value = text(operation["kind"], 40), operation.get("value")
            if kind == "preferences":
                keys(value, PREFS)
                for k, v in value.items():
                    if k == "subtitle_language":
                        if not isinstance(v, str) or not re.fullmatch(r"(?:[a-z]{2,3}(?:-[A-Z]{2})?)?", v):
                            raise Fault(400, "invalid_language")
                    elif type(v) is not bool:
                        raise Fault(400, "invalid_boolean")
                state["preferences"].update(value)
            elif kind in {"hide", "unhide", "watchlist_add", "watchlist_remove", "dismiss", "undismiss"}:
                uid = item_id(operation.get("id"))
                bucket = "hidden" if kind in {"hide", "unhide"} else "watchlist" if kind.startswith("watchlist") else "dismissed"
                adding = kind in {"hide", "watchlist_add", "dismiss"}
                values = set(state[bucket])
                values.add(uid) if adding else values.discard(uid)
                if len(values) > 2000:
                    raise Fault(422, "personal_list_limit")
                state[bucket] = sorted(values)
            elif kind in {"snooze", "unsnooze"}:
                uid = item_id(operation.get("id"))
                now = int(time.time())
                values = {k:v for k,v in state.get("snoozed", {}).items() if v > now}
                if kind == "snooze":
                    days = integer(value, 1, 30)
                    values[uid] = now + days * 86400
                else:
                    values.pop(uid, None)
                if len(values) > 2000:
                    raise Fault(422, "personal_list_limit")
                state["snoozed"] = values
            elif kind == "shelf_put":
                keys(value, {"id", "name", "rule", "pinned"}, {"name", "rule", "pinned"})
                uid = item_id(value["id"]) if "id" in value else secrets.token_hex(16)
                if type(value["pinned"]) is not bool:
                    raise Fault(400, "invalid_boolean")
                shelf = {"id": uid, "name": text(value["name"], 80), "rule": rule(value["rule"]), "pinned": value["pinned"]}
                found = next((i for i, v in enumerate(state["shelves"]) if v["id"] == uid), None)
                if found is None:
                    if len(state["shelves"]) >= 32:
                        raise Fault(422, "shelf_limit")
                    state["shelves"].append(shelf)
                else:
                    state["shelves"][found] = shelf
            elif kind == "shelf_delete":
                uid = item_id(operation.get("id"))
                state["shelves"] = [s for s in state["shelves"] if s["id"] != uid]
            elif kind == "shelf_order":
                order = operation.get("order")
                if not isinstance(order, list):
                    raise Fault(400, "invalid_order")
                order = [item_id(v) for v in order]
                shelves = {s["id"]: s for s in state["shelves"]}
                if len(order) != len(set(order)) or set(order) != set(shelves):
                    raise Fault(400, "invalid_order")
                state["shelves"] = [shelves[v] for v in order]
            elif kind == "feedback":
                uid = item_id(operation.get("id"))
                if value not in ("more", "less", "clear"):
                    raise Fault(400, "invalid_feedback")
                if value == "clear":
                    state["feedback"].pop(uid, None)
                else:
                    state["feedback"][uid] = value
                if len(state["feedback"]) > 2000:
                    raise Fault(422, "feedback_limit")
            elif kind == "bookmark_put":
                keys(value, {"item_id", "ticks", "label", "source_id", "copy_key"}, {"item_id", "ticks", "label"})
                uid = item_id(value["item_id"])
                ticks = integer(value["ticks"], 0, 86400 * 10_000_000)
                mark = {"item_id": uid, "ticks": ticks, "label": text(value["label"], 120)}
                if "copy_key" in value:
                    if not isinstance(value["copy_key"],str) or not re.fullmatch(r"[0-9a-f]{64}",value["copy_key"]):raise Fault(400,"invalid_copy_key")
                    mark.update(copy_key=value["copy_key"],source_id=text(value.get("source_id"),128))
                state["bookmarks"] = [b for b in state["bookmarks"] if (b["item_id"], b["ticks"]) != (uid, ticks)] + [mark]
                if len(state["bookmarks"]) > 1000:
                    raise Fault(422, "bookmark_limit")
            elif kind == "bookmark_delete":
                keys(value, {"item_id", "ticks"}, {"item_id", "ticks"})
                uid, ticks = item_id(value["item_id"]), integer(value["ticks"], 0, 86400 * 10_000_000)
                state["bookmarks"] = [b for b in state["bookmarks"] if (b["item_id"], b["ticks"]) != (uid, ticks)]
            else:
                raise Fault(400, "unknown_operation")
            raw = canonical(state)
            if len(raw.encode()) > MAX_DOCUMENT:
                raise Fault(413, "personal_state_too_large")
            db.execute("INSERT INTO state VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,document=excluded.document", (actor.key, revision + 1, raw))
            result = {"revision": revision + 1, **state}
            if mutation_id is not None:
                db.execute("INSERT INTO mutations VALUES(?,?,?,?)", (actor.key, mutation_id, fingerprint, revision + 1))
                result["mutation"] = {"id": mutation_id, "outcome": "committed", "applied_revision": revision + 1, "replayed": False}
            return result

    def backup(self, destination: str | Path):
        # SQLite backup includes WAL consistently. No overwrite; run only in an operator-owned private directory.
        dest = Path(destination)
        descriptor = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.close(descriptor)
        try:
            with self.connect() as source:
                with closing(sqlite3.connect(str(dest))) as target:
                    source.backup(target)
        except BaseException:
            dest.unlink(missing_ok=True)
            raise

    def intent(self, actor: Actor, idempotency_key: str, payload: dict) -> dict:
        """Reserve only. Never sends a request or retries an ambiguous send."""
        ikey = text(idempotency_key, 128)
        keys(payload, {"type", "tmdb", "seasons"}, {"type", "tmdb"})
        if payload["type"] not in {"movie", "tv"}:
            raise Fault(400, "invalid_media_type")
        tmdb = integer(payload["tmdb"], 1, 2**53 - 1)
        seasons = payload.get("seasons", [])
        if not isinstance(seasons, list) or len(seasons) > 100:
            raise Fault(400, "invalid_seasons")
        seasons = sorted(set(integer(s, 0, 1000) for s in seasons))
        if payload["type"] == "movie" and seasons or payload["type"] == "tv" and not seasons:
            raise Fault(400, "explicit_seasons_required")
        normalized = {"type": payload["type"], "tmdb": tmdb, "seasons": seasons}
        raw, logical = canonical(normalized), digest(normalized)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            same_key = db.execute("SELECT logical FROM intents WHERE owner=? AND ikey=?", (actor.key, ikey)).fetchone()
            if same_key and same_key[0] != logical:
                raise Fault(409, "idempotency_key_reused")
            row = db.execute("SELECT ikey,state,remote_id FROM intents WHERE owner=? AND logical=?", (actor.key, logical)).fetchone()
            if row:
                return {"key": row[0], "state": row[1], "remote_id": row[2], "reused": True}
            if db.execute("SELECT COUNT(*) FROM intents WHERE owner=?", (actor.key,)).fetchone()[0] >= 2000:
                raise Fault(422, "request_intent_limit")
            db.execute("INSERT INTO intents VALUES(?,?,?,?,?,?,?)", (actor.key, ikey, logical, raw, "reserved", None, time.time()))
            return {"key": ikey, "state": "reserved", "remote_id": None, "reused": False}

    def transition(self, actor: Actor, key: str, expected: str, state: str, remote_id: str | None = None) -> dict:
        transitions = {"reserved": {"sending", "cancelled"}, "sending": {"submitted", "unknown", "rejected"},
                       "unknown": {"submitted", "rejected"}, "submitted": {"available", "partial", "failed"},
                       "partial": {"available", "failed"}, "failed": set(), "rejected": set(), "cancelled": set(), "available": set()}
        if state not in transitions.get(expected, set()):
            raise Fault(409, "unsafe_request_transition")
        if remote_id is not None:
            remote_id = text(remote_id, 80)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute("UPDATE intents SET state=?,remote_id=COALESCE(?,remote_id),updated=? WHERE owner=? AND ikey=? AND state=?", (state, remote_id, time.time(), actor.key, key, expected))
            if result.rowcount != 1:
                raise Fault(409, "request_state_conflict")
        return {"state": state, "automatic_retry": False}


def hidden(item: Mapping[str, Any], state: Mapping[str, Any]) -> bool:
    values = set(state.get("hidden", []))
    return any(str(item.get(k, "")).lower().replace("-", "") in values for k in ("Id", "SeriesId", "SeasonId"))


def matches(item: Mapping[str, Any], r: Mapping[str, Any], verified_ids: set[str] | None = None) -> bool:
    if r.get("provider") or r.get("discovery"):
        raise Fault(422, "provider_adapter_required")
    if r.get("types") and item.get("Type") not in r["types"]:
        return False
    if r.get("genres") and not {g.casefold() for g in r["genres"]} <= {str(g).casefold() for g in item.get("Genres", [])}:
        return False
    if r.get('co_genre') and r['co_genre'].casefold() not in {str(g).casefold() for g in item.get('Genres',[])}:
        return False
    if r.get('subgenre'):
        from experience_taxonomy import TAXONOMY
        mode='tv' if item.get('Type')=='Series' else 'movies'
        rules=[v for genre in r.get('genres',[]) for n,v in TAXONOMY.get(mode,{}).get(genre,[]) if n==r['subgenre']]
        gs={str(g).casefold() for g in item.get('Genres',[])}
        def submatch(v):
            if any(g.casefold() in gs for g in v.get('x',[])):return False
            if any(g.casefold() in gs for g in v.get('g',[])):return True
            terms=[re.compile(t,re.I) for t in v.get('k','').split('|') if t]
            if any(t.search(item.get('Name') or '') for t in terms) or sum(bool(t.search(item.get('Overview') or '')) for t in terms)>=2:return True
            y=item.get('ProductionYear')
            return 'y' in v and type(y) is int and v['y'][0]<=y<=v['y'][1]
        if not any(submatch(v) for v in rules):return False
    if r.get('min_rating'):
        rating=item.get('CommunityRating')
        if type(rating) not in (float,int) or not r['min_rating']<=rating<9:return False
    year = item.get("ProductionYear")
    if ("year_min" in r or "year_max" in r) and (type(year) is not int or not r.get("year_min", 1800) <= year <= r.get("year_max", 2500)):
        return False
    runtime = item.get("RunTimeTicks")
    if "runtime_max_minutes" in r and (type(runtime) is not int or runtime <= 0 or runtime > r["runtime_max_minutes"] * 600_000_000):
        return False
    ud = item.get("UserData") or {}
    watch = r.get("watched", "all")
    # Absent user data is unknown, NOT evidence of unwatched content.
    if watch in {"watched", "unwatched"} and (type(ud.get("Played")) is not bool or ud["Played"] != (watch == "watched")):
        return False
    if watch == "unfinished":
        if ud.get("Played") is not False:
            return False
        if item.get("Type") == "Series":
            count, unplayed = item.get("RecursiveItemCount"), ud.get("UnplayedItemCount", item.get("UnplayedItemCount"))
            if type(count) is not int or type(unplayed) is not int or not 0 < unplayed < count:
                return False
        elif not isinstance(ud.get("PlaybackPositionTicks"), int) or ud["PlaybackPositionTicks"] <= 0:
            return False
    if r.get("favorites_only") and ud.get("IsFavorite") is not True:
        return False
    if r.get("availability", "library") == "library" and item.get("LocationType") == "Virtual":
        return False
    if r.get("availability") == "verified" and item_id(item.get("Id")) not in (verified_ids or set()):
        return False
    return True


class Pager:
    """Bounded, expiring snapshot of IDs, reauthorized/hydrated on EVERY page.

    The caller supplies complete viewer-scoped rows once, never administrator rows.
    Changed preferences/policy invalidate cursors. Catalogue membership is a dated
    snapshot, not a promise that removed titles still exist. No paths/artwork cached.
    """
    def __init__(self, ttl: float = 120, max_snapshots: int = 8, clock: Callable[[], float] = time.monotonic):
        self.ttl, self.maximum, self.clock = ttl, max_snapshots, clock
        self.lock = threading.RLock()
        self.snapshots: OrderedDict[str, dict] = OrderedDict()

    def open(self, actor: Actor, state: dict, rows: Iterable[dict], query: dict, include_hidden: bool = False, verified_ids: set[str] | None = None) -> str:
        r = rule(query)
        if type(include_hidden) is not bool:
            raise Fault(400, "invalid_boolean")
        by_id: dict[str, dict] = {}
        for i, row in enumerate(rows):
            if i >= 100000:
                raise Fault(422, "catalogue_bound_exceeded")
            uid = item_id(row.get("Id"))
            if uid in by_id:
                if canonical(by_id[uid]) != canonical(row):
                    raise Fault(409, "catalogue_changed")
                continue
            by_id[uid] = row
        selected = [v for v in by_id.values() if (include_hidden or not hidden(v, state)) and matches(v, r, verified_ids)]
        def order(v):
            first = int(v.get("_source_order",0)) if r.get("sort") == "source" else -int(v.get("ProductionYear") or 0) if r.get("sort") == "year" else (v.get("RunTimeTicks") or 2**63) if r.get("sort") == "runtime" else 0
            return first, str(v.get("SortName") or v.get("Name") or "").casefold(), item_id(v["Id"])
        ids = [item_id(v["Id"]) for v in sorted(selected, key=order)]
        sid = secrets.token_urlsafe(24)
        with self.lock:
            self._expire()
            # At most two retained query snapshots per account.
            own = [k for k, s in self.snapshots.items() if s["owner"] == actor.key]
            for k in own[:-1]:
                self.snapshots.pop(k)
            self.snapshots[sid] = {"owner": actor.key, "policy": actor.policy, "revision": state["revision"], "expires": self.clock() + self.ttl,
                                   "ids": ids, "rule": r, "include_hidden": include_hidden, "at": time.time()}
            while len(self.snapshots) > self.maximum:
                self.snapshots.popitem(last=False)
        return sid + ":0"

    def _expire(self):
        for key in [k for k, s in self.snapshots.items() if s["expires"] <= self.clock()]:
            self.snapshots.pop(key)

    def page(self, actor: Actor, state: dict, cursor: str, hydrate: Callable[[list[str]], Iterable[dict]], limit: int = 40, verified_ids: set[str] | None = None) -> dict:
        integer(limit, 1, 60)
        if not isinstance(cursor, str) or len(cursor) > 128:
            raise Fault(400, "invalid_cursor")
        try:
            sid, raw_offset = cursor.split(":")
            if not re.fullmatch(r"0|[1-9][0-9]{0,5}", raw_offset):
                raise ValueError()
            offset = int(raw_offset)
        except ValueError:
            raise Fault(400, "invalid_cursor") from None
        with self.lock:
            self._expire()
            snapshot = copy.deepcopy(self.snapshots.get(sid))
        if not snapshot or snapshot["owner"] != actor.key:
            raise Fault(410, "snapshot_expired")
        if snapshot["policy"] != actor.policy or snapshot["revision"] != state["revision"]:
            raise Fault(409, "snapshot_changed")
        ids = snapshot["ids"]
        if offset > len(ids):
            raise Fault(400, "invalid_cursor")
        chosen = ids[offset:offset + limit]
        rows = {item_id(v["Id"]): v for v in hydrate(chosen)} if chosen else {}
        # Never trust extras from an adapter or retain data removed by a fresh permission check.
        items = [rows[i] for i in chosen if i in rows and (snapshot["include_hidden"] or not hidden(rows[i], state)) and matches(rows[i], snapshot["rule"], verified_ids)]
        position = offset + len(chosen)
        return {"items": items, "cursor": cursor, "next": sid + ":" + str(position) if position < len(ids) else None,
                "snapshot_count": len(ids), "snapshot_at": snapshot["at"], "removed_or_changed": len(chosen) - len(items),
                "complete": position == len(ids)}


SAFE_ITEM = {"Id", "Type", "Name", "SeriesName", "SeriesId", "SeasonId", "IndexNumber", "ParentIndexNumber", "RunTimeTicks", "ProductionYear", "Genres", "OfficialRating", "Overview", "ImageTags", "BackdropImageTags", "PrimaryImageAspectRatio", "UserData", "LocationType", "PlayAccess", "RecursiveItemCount", "UnplayedItemCount"}


def episode_projection(item: Mapping[str, Any], preferences: Mapping[str, Any], reveal: bool = False) -> dict:
    out = {k: copy.deepcopy(v) for k, v in item.items() if k in SAFE_ITEM}
    if isinstance(out.get("UserData"), dict):
        out["UserData"] = {k: v for k, v in out["UserData"].items() if k in {"Played", "PlaybackPositionTicks", "IsFavorite", "PlayedPercentage", "UnplayedItemCount"}}
    if item.get("Type") != "Episode" or (item.get("UserData") or {}).get("Played") is True or reveal:
        return out
    masked = []
    if preferences.get("episode_titles"):
        number = item.get("IndexNumber")
        out["Name"] = "Episode " + str(number) if type(number) is int else "Unwatched episode"
        masked.append("title")
    if preferences.get("episode_descriptions"):
        out.pop("Overview", None)
        masked.append("description")
    if preferences.get("episode_images"):
        out["ImageTags"], out["BackdropImageTags"] = {}, []
        masked.append("image")
    out["spoiler_mask"] = masked
    return out


def sports_projection(event: Mapping[str, Any], preferences: Mapping[str, Any], reveal: bool = False) -> dict:
    # Only apply to the new renderer DTO, NEVER mutate tracker/game synchronization input.
    safe = {k: copy.deepcopy(event[k]) for k in ("id", "league", "start", "state", "home_name", "away_name", "tracker_ref") if k in event}
    groups = {"sports_scores": ("home_score", "away_score", "scoreboard"), "sports_results": ("winner", "result", "recap", "highlights"),
              "sports_headlines": ("headlines", "news"), "sports_thumbnails": ("thumbnails", "recap_images")}
    for pref, fields in groups.items():
        if reveal or not preferences.get(pref):
            safe.update({k: copy.deepcopy(event[k]) for k in fields if k in event})
    # A recap/headline or thumbnail can disclose scores: stricter preferences dominate.
    if not reveal and (preferences.get("sports_scores") or preferences.get("sports_results")):
        for k in ("scoreboard", "winner", "result", "recap", "highlights", "headlines", "news", "thumbnails", "recap_images", "home_score", "away_score"):
            safe.pop(k, None)
    return safe


def segment_decision(segments: Iterable[dict], position: int, duration: int, auto_intro: bool = False, already_skipped: Iterable[str] = ()) -> dict | None:
    integer(duration, 1, 86400 * 10_000_000)
    integer(position, 0, duration)
    candidates = []
    for raw in segments:
        if not isinstance(raw, dict):
            continue
        kind, start, end = raw.get("Type"), raw.get("StartTicks"), raw.get("EndTicks")
        if kind not in {"Intro", "Outro"} or type(start) is not int or type(end) is not int or not 0 <= start < end <= duration:
            continue
        key = digest([kind, start, end])[:24]
        if start <= position < end and key not in set(already_skipped):
            candidates.append((start, end, kind, key))
    if not candidates:
        return None
    start, end, kind, key = sorted(candidates)[0]
    # Ambiguous overlapping segments are manual-only. Credits NEVER trigger auto-next.
    automatic = auto_intro is True and kind == "Intro" and len(candidates) == 1 and end < duration
    return {"id": key, "kind": kind, "seek_ticks": end, "automatic": automatic, "auto_next": False,
            "label": "Skip intro" if kind == "Intro" else "Skip credits", "preserve_postcredits": True}


def resume_position(item: Mapping[str, Any]) -> int:
    duration = item.get("RunTimeTicks")
    ud = item.get("UserData") or {}
    if ud.get("Played") is True:
        return 0
    value = ud.get("PlaybackPositionTicks", 0)
    if type(value) is not int or value < 0:
        return 0
    if type(duration) is int and duration > 0:
        return min(value, max(0, duration - 1))
    return value


def request_view(*, in_library: bool, playback_verified: bool, available_seasons: Iterable[int], requested_seasons: Iterable[int], status: str, source_failed: bool = False) -> dict:
    """Normalized request-service state, not guessed upstream numeric enums."""
    known = {"none", "pending", "approved", "processing", "available", "partial", "failed", "declined", "unknown"}
    if status not in known:
        status = "unknown"
    requested, available = set(requested_seasons), set(available_seasons)
    missing = sorted(requested - available)
    if source_failed:
        state, label = "source_unavailable", "A source is unavailable. Report the problem; another request may not fix it."
    elif in_library and requested and missing and available:
        state, label = "partial", "Some requested seasons are in your library."
    elif in_library and (not requested or not missing):
        state, label = ("playable", "Playback has been verified.") if playback_verified else ("in_library", "In your library; playback is not verified.")
    else:
        state = "indexing" if status == "available" else status
        label = {"indexing": "Reported available upstream; waiting for your library.", "none": "Not requested.", "pending": "Awaiting approval.",
                 "approved": "Approved; not yet in your library.", "processing": "Processing; not yet in your library.", "partial": "Partial upstream availability; checking your library.",
                 "failed": "Request processing failed.", "declined": "Request was declined.", "unknown": "Status is unavailable; do not submit a duplicate."}[state]
    return {"state": state, "label": label, "missing_seasons": missing, "can_play": bool(in_library and not source_failed),
            "automatic_retry": False, "allow_new_request": status == "none" and not in_library and not source_failed}


def recommendations(rows: Iterable[dict], state: dict, verified_ids: set[str], limit: int = 18, *, recent_genres: Iterable[str] = ()) -> list[dict]:
    """Local deterministic baseline. Eligibility MUST be supplied by the authorized adapter.

    No rating-threshold invention, remote history transfer, or inferred physical playability.
    """
    integer(limit, 1, 60)
    items = list(rows)
    if len(items) > 100000:
        raise Fault(422, "catalogue_bound_exceeded")
    positives, negatives = Counter(), Counter()
    recent = Counter(str(g) for g in recent_genres)
    for item in items:
        uid = item_id(item["Id"])
        feedback = state["feedback"].get(uid)
        target = negatives if feedback == "less" else positives
        if feedback or (item.get("UserData") or {}).get("IsFavorite") is True:
            if not hidden(item, state):
                target.update(str(g) for g in item.get("Genres", []))
    ranked = []
    for item in items:
        uid = item_id(item["Id"])
        if uid not in verified_ids or hidden(item, state) or uid in state["dismissed"] or state.get("snoozed", {}).get(uid, 0) > time.time() or state["feedback"].get(uid) == "less" or (item.get("UserData") or {}).get("Played") is not False:
            continue
        gs = set(map(str, item.get("Genres", [])))
        affinity = sum(3 * (positives[g] - negatives[g]) + min(recent[g], 3) for g in gs)
        preferred = sorted(g for g in gs if positives[g] > negatives[g])
        watched = sorted(g for g in gs if recent[g])
        reasons = ["Matches your genre preferences: " + ", ".join(preferred)] if preferred else ["Because you watch " + ", ".join(watched)] if watched else ["Explore an unwatched title in your verified library"]
        ranked.append((affinity, item, reasons))
    def rating(item):
        value = item.get("CommunityRating")
        return value if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 10 else 0
    ranked.sort(key=lambda x: (-x[0], -rating(x[1]), str(x[1].get("Name", "")).casefold(), item_id(x[1]["Id"])))
    result, franchises, genres, types, seen = [], Counter(), Counter(), Counter(), set()
    type_cap = max(1, math.ceil(limit * .65))
    # Two passes retain catalogue coverage while preferring diversity on the first pass.
    for relaxed in (False, True):
        for score, item, reasons in ranked:
            uid = item_id(item["Id"])
            identity = (item.get("Type"), (item.get("ProviderIds") or {}).get("Tmdb") or uid)
            franchise = str(item.get("CollectionId") or item.get("SeriesId") or uid)
            gs = item.get("Genres") or []
            primary = str(gs[0]) if gs else ""
            if identity in seen or franchises[franchise] >= 2 or (not relaxed and ((primary and genres[primary] >= 3) or types[item.get("Type")] >= type_cap)):
                continue
            result.append({"id": uid, "reasons": reasons, "score": score})
            seen.add(identity); franchises[franchise] += 1; genres[primary] += 1; types[item.get("Type")] += 1
            if len(result) >= limit:
                return result
    return result
