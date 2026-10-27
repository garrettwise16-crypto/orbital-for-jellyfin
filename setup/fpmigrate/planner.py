"""Turn matched Plex state into Jellyfin user-data changes.

Precedence ("never lose progress"):
- never mark anything unplayed and never lower a play count;
- a Plex 'watched' marks a Jellyfin item played, raising count/last-played only upward;
- a Plex resume point is written only if Jellyfin has no position, or Plex's is more recent;
  a Jellyfin item already played keeps that state;
- a Plex rating is written only where Jellyfin has none; differing ratings are kept and reported.
Only fields that actually change are sent, so a re-run is a no-op.
"""
from __future__ import annotations

import dataclasses
from datetime import datetime, timezone

from .jellyfin import TICKS_PER_MS, UserState, format_jf_date
from .plex import PlexRecord

POSITION_TOLERANCE_TICKS = 2_000 * TICKS_PER_MS  # 2 s

WATCHED = "watched"
RESUME = "resume"
RATING = "rating"
FAVORITE = "favorite"
UPDATED = "count_or_date"
UNCHANGED = "already_up_to_date"
KEPT = "kept_newer_jellyfin_state"
SKIPPED = "skipped"


@dataclasses.dataclass
class Desired:
    played: bool
    play_count: int
    position_ticks: int
    last_played: datetime | None
    rating: float | None
    note: str = ""


@dataclasses.dataclass
class Action:
    item_id: str
    label: str
    plex_keys: list[str]
    categories: list[str]
    changes: dict  # Jellyfin UpdateUserItemDataDto fields to send
    before: dict
    notes: list[str] = dataclasses.field(default_factory=list)

    @property
    def writes(self) -> bool:
        return bool(self.changes)


def _dt(epoch: int | None) -> datetime | None:
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc) if epoch else None


def desired_from_group(records: list[PlexRecord]) -> tuple[Desired | None, str]:
    """Combine Plex records that map to one Jellyfin item. Returns (desired, problem)."""
    if len(records) == 1:
        r = records[0]
        return Desired(played=r.view_count > 0, play_count=r.view_count,
                       position_ticks=r.view_offset_ms * TICKS_PER_MS, last_played=_dt(r.last_viewed_at),
                       rating=r.user_rating), ""
    episodes = {(r.season, r.episode) for r in records if r.kind == "episode"}
    lasts = [d for d in (_dt(r.last_viewed_at) for r in records) if d]
    if len(episodes) > 1:  # one file holds several episodes (e.g. S01E01-E02)
        played = [r.view_count > 0 for r in records]
        if all(played):
            return Desired(True, min(r.view_count for r in records), 0, max(lasts) if lasts else None, None,
                           "multi-episode file: all parts watched in Plex"), ""
        if any(played):
            return None, "multi-episode file is only partly watched in Plex; Jellyfin tracks it as one item"
        if any(r.view_offset_ms for r in records):
            return None, "resume point inside a multi-episode file cannot be mapped to one Jellyfin item"
        return Desired(False, 0, 0, None, None), ""
    # several Plex items (versions/duplicates) of the same title -> any watch counts
    newest = max(records, key=lambda r: r.last_viewed_at or 0)
    ratings = {r.user_rating for r in records if r.user_rating is not None}
    if len(ratings) > 1:
        return None, "Plex has different ratings for the copies of this title"
    return Desired(played=any(r.view_count for r in records), play_count=max(r.view_count for r in records),
                   position_ticks=newest.view_offset_ms * TICKS_PER_MS, last_played=max(lasts) if lasts else None,
                   rating=next(iter(ratings)) if ratings else None,
                   note="several Plex copies map to one Jellyfin item"), ""


def plan_item(item_id: str, label: str, records: list[PlexRecord], current: UserState,
              transfer_ratings: bool = True, favorite_at: float | None = None) -> Action:
    """favorite_at: optionally mark titles rated at/above this Plex value (0-10, 8 = four stars) as favorites."""
    keys = [r.rating_key for r in records]
    before = current.to_record()
    desired, problem = desired_from_group(records)
    if desired is None:
        return Action(item_id, label, keys, [SKIPPED], {}, before, [problem])
    changes: dict = {}
    cats: list[str] = []
    notes: list[str] = [desired.note] if desired.note else []

    newer_last = desired.last_played and (current.last_played is None or desired.last_played > current.last_played)

    if desired.played:
        if not current.played:
            changes["Played"] = True
            cats.append(WATCHED)
        if desired.play_count > current.play_count:
            changes["PlayCount"] = desired.play_count
        if newer_last:
            changes["LastPlayedDate"] = format_jf_date(desired.last_played)
        if not current.played and desired.position_ticks == 0 and current.position_ticks:
            changes["PlaybackPositionTicks"] = 0  # finished in Plex: clear a stale partial position
        if (changes.keys() - {"Played"}) and WATCHED not in cats:
            cats.append(UPDATED)
    if desired.position_ticks > 0:
        if current.played and not desired.played:
            cats.append(KEPT)
            notes.append("already played in Jellyfin; Plex resume point not applied")
        elif abs(current.position_ticks - desired.position_ticks) <= POSITION_TOLERANCE_TICKS:
            pass
        elif current.position_ticks == 0 or newer_last:
            changes["PlaybackPositionTicks"] = desired.position_ticks
            if newer_last and "LastPlayedDate" not in changes:
                changes["LastPlayedDate"] = format_jf_date(desired.last_played)
            cats.append(RESUME)
        else:
            cats.append(KEPT)
            notes.append("Jellyfin has a more recent resume point")
    if transfer_ratings and desired.rating is not None:
        if current.rating is None:
            changes["Rating"] = desired.rating
            cats.append(RATING)
        elif abs(float(current.rating) - desired.rating) > 1e-6:
            cats.append(KEPT)
            notes.append("Jellyfin already has a different rating")
    if favorite_at is not None and desired.rating is not None and desired.rating >= favorite_at             and not current.is_favorite:
        changes["IsFavorite"] = True
        cats.append(FAVORITE)
    if not cats:
        cats.append(UNCHANGED)
    return Action(item_id, label, keys, cats, changes, before, notes)


def fields_hold(state: UserState, changes: dict) -> bool:
    """True if `state` already reflects every field in `changes` (used for verify and rollback CAS)."""
    rec = state.to_record()
    for k, v in changes.items():
        cur = rec.get(k)
        if k == "PlaybackPositionTicks":
            if abs(int(cur or 0) - int(v or 0)) > POSITION_TOLERANCE_TICKS:
                return False
        elif k == "LastPlayedDate":
            if (cur or "")[:19] != (v or "")[:19]:
                return False
        elif k == "Rating":
            if cur is None or v is None:
                if cur is not v:
                    return False
            elif abs(float(cur) - float(v)) > 1e-6:
                return False
        elif cur != v:
            return False
    return True
