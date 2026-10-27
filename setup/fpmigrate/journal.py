"""Local SQLite journal: every owned change with its before/after state, so runs resume, re-runs are no-ops
and rollback restores only what this tool changed (and only where nobody changed it since)."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, created REAL, plex_id TEXT, jellyfin_id TEXT, status TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS actions (
  run_id TEXT, seq INTEGER, source_user TEXT, jf_user_id TEXT, jf_item_id TEXT, label TEXT, plex_keys TEXT,
  categories TEXT, changes TEXT, before TEXT, notes TEXT, status TEXT, error TEXT, applied_at REAL,
  after TEXT, PRIMARY KEY (run_id, seq));
CREATE TABLE IF NOT EXISTS exceptions (
  run_id TEXT, source_user TEXT, plex_key TEXT, label TEXT, kind TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS owned (
  run_id TEXT, kind TEXT, jf_id TEXT, name TEXT, created REAL, removed REAL);
CREATE TABLE IF NOT EXISTS lists (
  run_id TEXT, source_user TEXT, jf_user_id TEXT, kind TEXT, plex_key TEXT, title TEXT, item_ids TEXT,
  missing TEXT, status TEXT, jf_id TEXT, note TEXT);
"""

PLANNED, APPLIED, VERIFIED, FAILED, ROLLED_BACK, ROLLBACK_SKIPPED, SUPERSEDED = (
    "planned", "applied", "verified", "failed", "rolled_back", "rollback_skipped", "superseded")


class Journal:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.server_key = None
        self._lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        cols = [r[1] for r in self.db.execute("PRAGMA table_info(owned)")]
        if "meta" not in cols:
            self.db.execute("ALTER TABLE owned ADD COLUMN meta TEXT")
        if "server_key" not in cols:
            self.db.execute("ALTER TABLE owned ADD COLUMN server_key TEXT")

    def bind_server(self, server_key: str):
        """Keep owned changes separate even when two servers reuse an item id."""
        self.server_key = server_key

    def _x(self, sql, args=()):
        with self._lock:
            return self.db.execute(sql, args)

    # runs
    def new_run(self, plex_id: str, jellyfin_id: str) -> str:
        rid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        self._x("INSERT INTO runs VALUES (?,?,?,?,?,?)", (rid, time.time(), plex_id, jellyfin_id, "previewed", "{}"))
        return rid

    def set_run(self, run_id: str, status: str | None = None, summary: dict | None = None):
        if status:
            self._x("UPDATE runs SET status=? WHERE id=?", (status, run_id))
        if summary is not None:
            self._x("UPDATE runs SET summary=? WHERE id=?", (json.dumps(summary), run_id))

    def run(self, run_id: str) -> dict | None:
        row = self._x("SELECT id, created, plex_id, jellyfin_id, status, summary FROM runs WHERE id=?",
                      (run_id,)).fetchone()
        if not row:
            return None
        return {"id": row[0], "created": row[1], "plexId": row[2], "jellyfinId": row[3], "status": row[4],
                "summary": json.loads(row[5] or "{}")}

    def runs(self) -> list[dict]:
        ids = [r[0] for r in self._x("SELECT id FROM runs ORDER BY created DESC").fetchall()]
        return [self.run(i) for i in ids]

    # actions
    def add_actions(self, run_id: str, source_user: str, jf_user_id: str, actions) -> None:
        base = self._x("SELECT COALESCE(MAX(seq), 0) FROM actions WHERE run_id=?", (run_id,)).fetchone()[0]
        with self._lock:
            self.db.execute("BEGIN")
            for i, a in enumerate(actions, start=base + 1):
                self.db.execute("INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    run_id, i, source_user, jf_user_id, a.item_id, a.label, json.dumps(a.plex_keys),
                    json.dumps(a.categories), json.dumps(a.changes), json.dumps(a.before), json.dumps(a.notes),
                    PLANNED, None, None, None))
            self.db.execute("COMMIT")

    def actions(self, run_id: str, status: str | None = None, writes_only: bool = False) -> list[dict]:
        sql = ("SELECT seq, source_user, jf_user_id, jf_item_id, label, plex_keys, categories, changes, before, notes,"
               " status, error, after FROM actions WHERE run_id=?")
        args: list = [run_id]
        if status:
            sql += " AND status=?"
            args.append(status)
        rows = self._x(sql + " ORDER BY seq", args).fetchall()
        out = []
        for r in rows:
            changes = json.loads(r[7])
            if writes_only and not changes:
                continue
            out.append({"seq": r[0], "sourceUser": r[1], "jfUserId": r[2], "itemId": r[3], "label": r[4],
                        "plexKeys": json.loads(r[5]), "categories": json.loads(r[6]), "changes": changes,
                        "before": json.loads(r[8]), "notes": json.loads(r[9]), "status": r[10], "error": r[11],
                        "after": json.loads(r[12]) if r[12] else None})
        return out

    def mark(self, run_id: str, seq: int, status: str, error: str | None = None, after: dict | None = None):
        self._x("UPDATE actions SET status=?, error=?, after=COALESCE(?, after), applied_at=COALESCE(applied_at, ?)"
                " WHERE run_id=? AND seq=?",
                (status, error, json.dumps(after) if after is not None else None,
                 time.time() if status in (APPLIED, VERIFIED) else None, run_id, seq))

    def replace_action(self, run_id: str, seq: int, action) -> None:
        self._x("UPDATE actions SET categories=?, changes=?, before=?, notes=? WHERE run_id=? AND seq=?",
                (json.dumps(action.categories), json.dumps(action.changes), json.dumps(action.before),
                 json.dumps(action.notes), run_id, seq))

    # exceptions
    def add_exception(self, run_id: str, source_user: str, plex_key: str, label: str, kind: str, reason: str):
        self._x("INSERT INTO exceptions VALUES (?,?,?,?,?,?)", (run_id, source_user, plex_key, label, kind, reason))

    def exceptions(self, run_id: str) -> list[dict]:
        rows = self._x("SELECT source_user, plex_key, label, kind, reason FROM exceptions WHERE run_id=?",
                       (run_id,)).fetchall()
        return [{"sourceUser": r[0], "plexKey": r[1], "label": r[2], "kind": r[3], "reason": r[4]} for r in rows]

    # owned objects (libraries/users created by this tool)
    def add_owned(self, run_id: str, kind: str, jf_id: str, name: str, meta: str | None = None):
        self._x("INSERT INTO owned (run_id, kind, jf_id, name, created, removed, meta, server_key) VALUES (?,?,?,?,?,NULL,?,?)",
                (run_id, kind, jf_id, name, time.time(), meta, self.server_key))

    def owned(self, include_removed: bool = False) -> list[dict]:
        sql = "SELECT run_id, kind, jf_id, name, created, removed, meta FROM owned"
        conditions, args = [], []
        if not include_removed:
            conditions.append("removed IS NULL")
        if self.server_key is not None:
            conditions.append("server_key=?")
            args.append(self.server_key)
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        return [{"runId": r[0], "kind": r[1], "jfId": r[2], "name": r[3], "created": r[4], "removed": r[5],
                 "meta": r[6]} for r in self._x(sql, args).fetchall()]

    def legacy_owned_count(self):
        return self._x("SELECT COUNT(*) FROM owned WHERE server_key IS NULL AND removed IS NULL").fetchone()[0]

    def owned_by_meta(self, kind: str, meta: str) -> dict | None:
        return next((o for o in self.owned() if o["kind"] == kind and o["meta"] == meta), None)

    # playlists / collections
    def add_list(self, run_id, source_user, jf_user_id, kind, plex_key, title, item_ids, missing, status, note=""):
        self._x("INSERT INTO lists VALUES (?,?,?,?,?,?,?,?,?,?,?)", (run_id, source_user, jf_user_id, kind, plex_key,
                title, json.dumps(item_ids), json.dumps(missing), status, None, note))

    def lists(self, run_id: str) -> list[dict]:
        rows = self._x("SELECT rowid, source_user, jf_user_id, kind, plex_key, title, item_ids, missing, status, jf_id,"
                       " note FROM lists WHERE run_id=? ORDER BY rowid", (run_id,)).fetchall()
        return [{"rowid": r[0], "sourceUser": r[1], "jfUserId": r[2], "kind": r[3], "plexKey": r[4], "title": r[5],
                 "itemIds": json.loads(r[6]), "missing": json.loads(r[7]), "status": r[8], "jfId": r[9],
                 "note": r[10]} for r in rows]

    def mark_list(self, rowid: int, status: str, jf_id: str | None = None, note: str | None = None):
        self._x("UPDATE lists SET status=?, jf_id=COALESCE(?, jf_id), note=COALESCE(?, note) WHERE rowid=?",
                (status, jf_id, note, rowid))

    def mark_owned_removed(self, kind: str, jf_id: str):
        sql = "UPDATE owned SET removed=? WHERE kind=? AND jf_id=?"
        args = [time.time(), kind, jf_id]
        if self.server_key is not None:
            sql += " AND server_key=?"
            args.append(self.server_key)
        self._x(sql, args)

    def close(self):
        with self._lock:
            self.db.close()
