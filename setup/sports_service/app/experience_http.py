"""Additive sports-hub HTTP adapter. Disabled unless an operator supplies config.

Pass sports-hub's existing get_json (viewer token only), not an administrative
client. This adapter never sends Jellyfin, Seerr, or acquisition-service mutations.
"""
from __future__ import annotations
import copy
import json
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode, urlsplit
from experience import (Actor, Fault, Pager, Store, TEMPLATES, episode_projection,
                        integer, item_id, keys, rule, text, digest)

PREFIX = "/sports/api/experience/v1"
FIELDS = "Genres,Overview,RecursiveItemCount,SortName,PlayAccess"


@dataclass(frozen=True)
class Config:
    server: str
    database: str
    enabled: bool = False
    all_authenticated_users: bool = False
    allowed_users: frozenset[str] = field(default_factory=frozenset)
    allowed_origins: frozenset[str] = field(default_factory=frozenset)
    personal: bool = False
    spoilers: bool = False
    shelves: bool = False
    bookmarks: bool = False
    playback_preferences: bool = False
    catalog_timeout: float = 8.0


class Service:
    def __init__(self, config: Config, get_json, jellyfin: str, clock=time.monotonic):
        self.config, self.fetch, self.base = config, get_json, jellyfin.rstrip("/")
        self.store = Store(config.database) if config.enabled else None
        self.pager = Pager(clock=clock)
        self.clock = clock
        self.scan_slot = threading.BoundedSemaphore(1)

    def _json(self, path: str, credential: str, params: dict | None = None):
        return self.fetch(self.base + path + ("?" + urlencode(params) if params else ""), credential)

    def _actor(self, headers):
        # HTTP header names are case insensitive. Only caller-held Jellyfin auth is accepted.
        h = {k.lower(): v for k, v in headers.items()}
        credential = h.get("x-emby-token")
        if not credential:
            match = re.search(r'\bToken="([^"\r\n]+)"', h.get("authorization") or h.get("x-emby-authorization") or "")
            credential = match[1] if match else None
        if not isinstance(credential, str) or not 1 <= len(credential) <= 512 or any(ord(c) < 32 for c in credential):
            raise Fault(401, "sign_in_required")
        try:
            user = self._json("/Users/Me", credential)
        except Exception as exc:
            raise Fault(401 if getattr(exc, "status", getattr(exc, "code", None)) in (401, 403) else 503, "authentication_unavailable") from None
        actor = Actor.from_user(self.config.server, user)
        if not self.config.all_authenticated_users and actor.user not in self.config.allowed_users:
            raise Fault(403, "experience_not_enabled_for_account")
        return actor, credential

    def _items(self, actor, credential, ids):
        if not ids:
            return []
        if len(ids) > 2000:
            raise Fault(422, "item_batch_limit")
        ids = [item_id(i) for i in ids]
        result = self._json("/Users/" + actor.user + "/Items", credential, {
            "Ids": ",".join(ids), "Limit": len(ids), "EnableUserData": "true", "Fields": FIELDS,
            "EnableTotalRecordCount": "false", "ImageTypeLimit": 1})
        allowed = set(ids)
        return [i for i in result.get("Items", []) if item_id(i.get("Id")) in allowed]

    def _inventory(self, actor, credential, r):
        if not self.scan_slot.acquire(False):
            raise Fault(429, "catalogue_busy")
        try:
            deadline, rows, seen, total = self.clock() + self.config.catalog_timeout, [], set(), None
            while total is None or len(rows) < total:
                if self.clock() >= deadline:
                    raise Fault(503, "catalogue_deadline")
                response = self._json("/Users/" + actor.user + "/Items", credential, {
                    "Recursive": "true", "IncludeItemTypes": ",".join(r.get("types", ["Movie", "Series"])),
                    "Limit": 2000, "StartIndex": len(rows), "SortBy": "SortName", "SortOrder": "Ascending",
                    "Fields": FIELDS, "EnableUserData": "true", "EnableTotalRecordCount": "true", "ImageTypeLimit": 1})
                current_total = response.get("TotalRecordCount")
                if type(current_total) is not int or not 0 <= current_total <= 100000:
                    raise Fault(503, "catalogue_count_unavailable")
                if total is not None and current_total != total:
                    raise Fault(409, "catalogue_changed")
                total = current_total
                page = response.get("Items")
                if not isinstance(page, list) or (not page and len(rows) < total):
                    raise Fault(503, "catalogue_incomplete")
                for item in page:
                    uid = item_id(item.get("Id"))
                    if uid in seen:
                        raise Fault(409, "catalogue_changed")
                    seen.add(uid); rows.append(item)
                if len(rows) > total:
                    raise Fault(409, "catalogue_changed")
            return rows
        finally:
            self.scan_slot.release()

    def request(self, method: str, path: str, headers: dict, body: bytes = b"") -> tuple[int, dict]:
        """Framework-neutral entry; all exceptions are mapped to non-sensitive errors."""
        try:
            return self._request(method, path, headers, body)
        except Fault as exc:
            return exc.status, {"error": exc.code}
        except (OSError, ValueError, TypeError, KeyError, sqlite3.DatabaseError):
            return 503, {"error": "experience_unavailable"}

    def _request(self, method, path, headers, body):
        if not self.config.enabled or self.store is None:
            raise Fault(404, "not_enabled")
        route = urlsplit(path)
        if route.query or not route.path.startswith(PREFIX + "/"):
            raise Fault(400, "invalid_route")
        endpoint = route.path[len(PREFIX):]
        receipt_match = re.fullmatch(r"/mutations/([0-9a-f]{32})", endpoint)
        if not (method == "GET" and receipt_match) and (method, endpoint) not in {("GET", "/state"), ("POST", "/state"), ("GET", "/hidden"), ("GET", "/watchlist"), ("POST", "/query")}:
            raise Fault(404, "not_found")
        actor, credential = self._actor(headers)
        if receipt_match:
            return 200, self.store.mutation_receipt(actor, receipt_match[1])
        state = self.store.read(actor)
        h = {k.lower(): v for k, v in headers.items()}
        data = None
        if method == "POST":
            if h.get("origin") is not None and h["origin"] not in self.config.allowed_origins:
                raise Fault(403, "origin_not_allowed")
            if h.get("content-type", "").split(";")[0].strip().lower() != "application/json":
                raise Fault(415, "json_required")
            if not 1 <= len(body) <= 65536:
                raise Fault(413, "body_size")
            try:
                data = json.loads(body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            except (ValueError, UnicodeDecodeError):
                raise Fault(400, "invalid_json") from None
        if endpoint == "/state" and method == "GET":
            return 200, {**state, "capabilities": {**{k: getattr(self.config, k) for k in ("personal", "spoilers", "shelves", "bookmarks", "playback_preferences")}, "mutation_receipts": True},
                         "templates": copy.deepcopy(TEMPLATES)}
        if endpoint == "/state":
            keys(data, {"revision", "operation", "mutation_id"}, {"revision", "operation"})
            operation = keys(data["operation"], {"kind", "value", "id", "order"}, {"kind"})
            kind = text(operation["kind"], 40)
            capability = "spoilers" if kind == "preferences" else "shelves" if kind.startswith("shelf_") else "bookmarks" if kind.startswith("bookmark_") else "personal"
            if kind == "preferences":
                values = keys(operation.get("value"), state["preferences"])
                needs_spoilers = any(k.startswith(("episode_", "sports_")) for k in values)
                needs_playback = any(k in {"auto_intro", "auto_credits", "subtitle_language"} for k in values)
                if needs_spoilers and not self.config.spoilers or needs_playback and not self.config.playback_preferences:
                    raise Fault(403, "feature_not_enabled")
                capability = None
            if capability and not getattr(self.config, capability):
                raise Fault(403, "feature_not_enabled")
            mutation_id = data.get("mutation_id")
            if mutation_id is not None:
                mutation_id = item_id(mutation_id)
                fingerprint = digest({"revision": data["revision"], "operation": operation})
                prior = self.store.mutation_receipt(actor, mutation_id, fingerprint)
                if prior["outcome"] == "committed":
                    return 200, {**self.store.read(actor), "mutation": {**prior, "replayed": True}}
            # Adding a personal reference requires a fresh user-scoped item check.
            # Removal remains possible after deletion or a parental-policy change.
            uid = None
            if kind in {"hide", "watchlist_add", "dismiss", "snooze"} or kind == "feedback" and operation.get("value") != "clear":
                uid = item_id(operation.get("id"))
            elif kind == "bookmark_put":
                value = keys(operation.get("value"), {"item_id", "ticks", "label"}, {"item_id", "ticks", "label"})
                uid = item_id(value["item_id"])
            if uid:
                items = self._items(actor, credential, [uid])
                if not items:
                    raise Fault(404, "item_unavailable")
                if kind == "bookmark_put":
                    duration = items[0].get("RunTimeTicks")
                    if type(duration) is not int or duration <= 0:
                        raise Fault(422, "duration_unavailable")
                    integer(operation["value"]["ticks"], 0, duration - 1)
            return 200, self.store.mutate(actor, data["revision"], operation, mutation_id)
        if endpoint in {"/hidden", "/watchlist"}:
            bucket = endpoint[1:]
            if not self.config.personal:
                raise Fault(403, "feature_not_enabled")
            items = []
            for start in range(0, len(state[bucket]), 100):
                items.extend(self._items(actor, credential, state[bucket][start:start + 100]))
            found = {item_id(i["Id"]) for i in items}
            prefs = state["preferences"] if self.config.spoilers else {}
            return 200, {"items": [episode_projection(i, prefs) for i in items], "unavailable_ids": [i for i in state[bucket] if i not in found], "revision": state["revision"]}
        if not self.config.shelves:
            raise Fault(403, "feature_not_enabled")
        keys(data, {"rule", "cursor", "limit", "include_hidden", "reveal"})
        reveal = data.get("reveal", [])
        if not isinstance(reveal, list) or len(reveal) > 60:
            raise Fault(400, "invalid_reveal")
        reveal = {item_id(i) for i in reveal}
        cursor = data.get("cursor")
        if cursor is not None and ("rule" in data or "include_hidden" in data):
            raise Fault(400, "cursor_query_mismatch")
        if cursor is None:
            r = rule(data.get("rule", {}))
            if r.get("provider") or r.get("discovery"):
                raise Fault(422, "provider_adapter_required")
            if r.get("availability") == "verified":
                raise Fault(422, "verification_adapter_required")
            cursor = self.pager.open(actor, state, self._inventory(actor, credential, r), r, data.get("include_hidden", False))
        page = self.pager.page(actor, state, cursor, lambda ids: self._items(actor, credential, ids), data.get("limit", 40))
        prefs = state["preferences"] if self.config.spoilers else {}
        page["items"] = [episode_projection(i, prefs, item_id(i["Id"]) in reveal) for i in page["items"]]
        return 200, page


def install(handler_class, config: Config, get_json, jellyfin: str):
    """Wrap only the new path; every old route/method remains owned by sports-hub.

    Call BEFORE constructing HTTPServer. This is source wiring, not a deploy action.
    Config.enabled=False leaves the handler and filesystem completely unchanged.
    """
    if not config.enabled:
        return None
    if getattr(handler_class, "_experience_installed", False):
        raise RuntimeError("experience adapter already installed")
    service = Service(config, get_json, jellyfin)
    old_get, old_post = handler_class.do_GET, handler_class.do_POST
    def dispatch(original):
        def wrapped(handler):
            if not urlsplit(handler.path).path.startswith(PREFIX + "/"):
                return original(handler)
            body = b""
            if handler.command == "POST":
                try:
                    length = int(handler.headers.get("Content-Length", "0"))
                except ValueError:
                    return handler.respond(400, {"error": "invalid_length"})
                if not 1 <= length <= 65536:
                    return handler.respond(413, {"error": "body_size"})
                body = handler.rfile.read(length)
            code, result = service.request(handler.command, handler.path, dict(handler.headers), body)
            return handler.respond(code, result)  # existing response uses Cache-Control:no-store
        return wrapped
    handler_class.do_GET, handler_class.do_POST = dispatch(old_get), dispatch(old_post)
    handler_class._experience_installed = True
    return service
