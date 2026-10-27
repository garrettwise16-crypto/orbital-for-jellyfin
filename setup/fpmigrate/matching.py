"""Match Plex records to Jellyfin items without guessing.

Order:
 1. exact file path (same machine, same drive letters/shares);
 2. path relative to the library folder (Plex section location vs Jellyfin library location), which
    survives different mount roots such as D:\\Media vs \\\\NAS\\Media or /data vs /media, but cannot
    confuse ShowA/Season 01/S01E01 with ShowB/Season 01/S01E01;
 3. a unique external id (IMDb/TMDB/TVDB) of the same item kind.
Any ambiguity is reported, never resolved silently.
"""
from __future__ import annotations

import dataclasses
import unicodedata
from collections import defaultdict

from .jellyfin import JfItem
from .plex import PlexRecord

MATCHED = "matched"
AMBIGUOUS = "ambiguous"
UNMATCHED = "unmatched"


def norm_path(path: str) -> str:
    p = unicodedata.normalize("NFC", path).replace("\\", "/")
    unc = p.startswith("//")
    while "//" in p:
        p = p.replace("//", "/")
    if unc:
        p = "/" + p
    return p.rstrip("/").casefold()


def relative_to(path: str, roots: list[str]) -> list[str]:
    """Relative paths of `path` under each root that contains it (normalised)."""
    np = norm_path(path)
    out = []
    for r in roots:
        nr = norm_path(r)
        if nr and np.startswith(nr + "/"):
            out.append(np[len(nr) + 1:])
    return out


@dataclasses.dataclass
class Match:
    status: str
    item_id: str | None = None
    method: str = ""
    reason: str = ""
    candidates: list[str] = dataclasses.field(default_factory=list)


class JellyfinIndex:
    def __init__(self, items: list[JfItem], library_roots: list[str]):
        self.items = {i.id: i for i in items}
        self.roots = list(library_roots)
        self.by_path: dict[str, set[str]] = defaultdict(set)
        self.by_rel: dict[str, set[str]] = defaultdict(set)
        self.by_provider: dict[tuple, set[str]] = defaultdict(set)
        for it in items:
            for p in it.paths:
                self.by_path[norm_path(p)].add(it.id)
                for rel in relative_to(p, self.roots):
                    self.by_rel[rel].add(it.id)
            for scheme, value in it.provider_ids.items():
                if scheme in ("imdb", "tmdb", "tvdb"):
                    self.by_provider[(it.kind, scheme, value.casefold())].add(it.id)

    def _lookup(self, table, keys) -> set[str]:
        hits: set[str] = set()
        for k in keys:
            hits |= table.get(k, set())
        return hits

    def _by_files(self, files: list[str], plex_roots: list[str]) -> Match | None:
        hits = self._lookup(self.by_path, [norm_path(f) for f in files])
        method = "path"
        if not hits:
            rels = [rel for f in files for rel in relative_to(f, plex_roots)]
            hits = self._lookup(self.by_rel, rels)
            method = "library_relative_path"
        if len(hits) == 1:
            return Match(MATCHED, next(iter(hits)), method)
        if len(hits) > 1:
            return Match(AMBIGUOUS, reason="this file corresponds to several Jellyfin items",
                         candidates=sorted(hits))
        return None

    def _by_provider(self, rec: PlexRecord) -> Match | None:
        kind = "Movie" if rec.kind == "movie" else "Episode"
        found: dict[str, set[str]] = {}
        for scheme in ("imdb", "tmdb", "tvdb"):
            value = rec.guids.get(scheme)
            if value:
                ids = self.by_provider.get((kind, scheme, value.casefold()), set())
                if ids:
                    found[scheme] = ids
        if not found:
            return None
        union = set().union(*found.values())
        if len(union) == 1:
            return Match(MATCHED, next(iter(union)), "external_id_" + "+".join(sorted(found)))
        return Match(AMBIGUOUS, reason="several Jellyfin items carry the same external id (editions or duplicates)",
                     candidates=sorted(union))

    def match(self, rec: PlexRecord, plex_roots: list[str]) -> Match:
        by_files = self._by_files(rec.files, plex_roots)
        if by_files and by_files.status == MATCHED:
            return by_files
        by_provider = self._by_provider(rec)
        if by_files and by_files.status == AMBIGUOUS:
            if by_provider and by_provider.status == MATCHED and by_provider.item_id in by_files.candidates:
                return Match(MATCHED, by_provider.item_id, "ambiguous_path+" + by_provider.method)
            return by_files
        if by_provider:
            return by_provider
        if not rec.files:
            return Match(UNMATCHED, reason="Plex lists no file for this item")
        return Match(UNMATCHED, reason="Jellyfin has no item with this file or external id yet "
                                       "(not scanned, not in a migrated library, or a different file)")
