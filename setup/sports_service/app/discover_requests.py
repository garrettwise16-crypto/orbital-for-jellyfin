"""In-app Requests screen backend (Oct 20 2026, Claude).

Endpoints (POST JSON, viewer token, linked Seerr account only):
  /discover-search   {term}                      Seerr title search, marked with library/request state
  /discover-plan     {type, tmdb}                what this viewer may request (seasons for TV)
  /discover-submit   {type, tmdb, seasons}       one normal Seerr request as this viewer
  /my-requests       {}                          this viewer's recent requests with titles

Seerr keeps every permission, quota, approval rule and duplicate check; nothing
here approves or forces anything, and no acquisition-service/provider call is made. The Seerr
key never leaves the server. Library matches come from the viewer's own
permission-scoped Jellyfin inventory.
"""
import json, re, threading, time, urllib.error, urllib.request
from urllib.parse import quote
from experience import Fault, integer, keys, text
from title_requests import plan, verified, _locks, _locks_guard
from title_request_transport import FixedSeerrPost

IMAGE = 'https://image.tmdb.org/t/p/w342'
_titles = {}
_titles_lock = threading.Lock()
MEDIA_STATE = {2: 'requested', 3: 'requested', 4: 'partial', 5: 'available'}
REQUEST_STATE = {1: 'pending', 2: 'approved', 3: 'declined', 4: 'failed', 5: 'completed'}


def _get(bridge, path, deadline):
    """Fixed Seerr GET for the two read routes this module owns (search, request list, title)."""
    if not re.fullmatch(r'/api/v1/(search\?query=[^&#\s]{1,300}&page=1&language=en'
                        r'|request\?take=\d{1,2}&skip=0&sort=added&requestedBy=\d{1,12}'
                        r'|(movie|tv)/\d{1,12})', path):
        raise Fault(403, 'upstream_route_rejected')
    remaining = (deadline - time.monotonic()) if deadline else 8
    if remaining <= 0.2:
        raise Fault(504, 'request_deadline')
    from experience_transport import FixedJsonGet
    if isinstance(bridge.transport, FixedJsonGet):
        return bridge.transport(bridge.base + path, bridge._key, deadline=deadline)
    return bridge.transport(bridge.base + path, bridge._key)


_lib = {}
_lib_lock = threading.Lock()


def _library(service, actor, credential):
    """tmdb -> jellyfin id for titles this viewer can already open. Never blocks a request: the first call
    starts a background scan (a full catalogue read can take longer than the request budget) and returns what
    is cached; the map refreshes every 10 minutes."""
    key = (actor.key, actor.policy)
    with _lib_lock:
        hit = _lib.get(key)
        stale = hit is None or time.time() - hit[0] > 600
        running = hit is not None and hit[2]
        if stale and not running:
            _lib[key] = (hit[0] if hit else 0, hit[1] if hit else {}, True)
            threading.Thread(target=_scan, args=(service, actor, credential), daemon=True, name='requests-library').start()
    return hit[1] if hit else {}


def _scan(service, actor, credential):
    mapping = None
    try:
        mapping = _map(service.inventory(actor, credential))
    except Exception:
        pass
    with _lib_lock:
        old = _lib.get(actor.key)
        if len(_lib) > 50:
            _lib.clear()
        _lib[actor.key] = (time.time(), mapping if mapping is not None else (old[1] if old else {}), False)


def _map(rows):
    out = {}
    for row in rows:
        tmdb = (row.get('ProviderIds') or {}).get('Tmdb')
        kind = {'Movie': 'movie', 'Series': 'tv'}.get(row.get('Type'))
        if kind and isinstance(tmdb, str) and tmdb.isdigit():
            out.setdefault((kind, int(tmdb)), str(row.get('Id', '')).replace('-', ''))
    return out


def _card(row, library):
    kind = row.get('mediaType')
    if kind not in ('movie', 'tv') or type(row.get('id')) is not int:
        return None
    date = row.get('releaseDate') if kind == 'movie' else row.get('firstAirDate')
    info = row.get('mediaInfo') or {}
    state = MEDIA_STATE.get(info.get('status'), 'none') if isinstance(info, dict) else 'none'
    item = library.get((kind, row['id']))
    if item and state == 'none':
        state = 'in_library'
    poster = row.get('posterPath')
    return {'type': kind, 'tmdb': row['id'], 'title': str(row.get('title') or row.get('name') or '')[:200],
            'year': str(date)[:4] if isinstance(date, str) and date[:4].isdigit() else None,
            'overview': str(row.get('overview') or '')[:400],
            'poster': IMAGE + poster if isinstance(poster, str) and re.fullmatch(r'/[A-Za-z0-9_.-]{1,80}', poster) else None,
            'rating': round(float(row['voteAverage']), 1) if isinstance(row.get('voteAverage'), (int, float)) and row.get('voteCount', 0) >= 20 else None,
            'state': state, 'item_id': item}


def _title(bridge, kind, tmdb, deadline):
    key = (kind, tmdb)
    with _titles_lock:
        hit = _titles.get(key)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    raw = _get(bridge, f'/api/v1/{kind}/{tmdb}', deadline)
    row = dict(raw, mediaType=kind)
    with _titles_lock:
        if len(_titles) > 2000:
            _titles.clear()
        _titles[key] = (time.time(), row)
    return row


def handle(service, endpoint, data, actor, credential, deadline):
    bridge = service.seerr_read
    if endpoint == '/discover-search':
        keys(data, {'term'}, {'term'})
        term = text(data['term'], 100)
        verified(bridge, actor, deadline)
        raw = _get(bridge, '/api/v1/search?query=' + quote(term, safe='') + '&page=1&language=en', deadline)
        library = _library(service, actor, credential)
        results = [c for c in (_card(r, library) for r in (raw.get('results') or [])[:40] if isinstance(r, dict)) if c]
        return {'term': term, 'results': results}
    if endpoint == '/discover-plan':
        keys(data, {'type', 'tmdb'}, {'type', 'tmdb'})
        kind = data['type']
        if kind not in ('movie', 'tv'):
            raise Fault(400, 'invalid_media_type')
        tmdb = integer(data['tmdb'], 1, 10**12)
        result, _ = plan(bridge, actor, kind, tmdb, deadline)
        item = _library(service, actor, credential).get((kind, tmdb))
        return dict(result, item_id=item)
    if endpoint == '/discover-submit':
        keys(data, {'type', 'tmdb', 'seasons'}, {'type', 'tmdb', 'seasons'})
        kind = data['type']
        if kind not in ('movie', 'tv'):
            raise Fault(400, 'invalid_media_type')
        tmdb = integer(data['tmdb'], 1, 10**12)
        seasons = data['seasons']
        if not isinstance(seasons, list) or len(seasons) > 100 or any(type(n) is not int or not 0 <= n <= 1000 for n in seasons) or len(set(seasons)) != len(seasons):
            raise Fault(400, 'invalid_seasons')
        if (kind == 'movie' and seasons) or (kind == 'tv' and not seasons):
            raise Fault(400, 'select_seasons')
        with _locks_guard:
            if actor.key not in _locks:
                if len(_locks) >= 100:
                    raise Fault(429, 'request_busy')
                _locks[actor.key] = threading.Lock()
            lock = _locks[actor.key]
        if not lock.acquire(blocking=False):
            raise Fault(409, 'request_in_progress')
        try:
            result, user = plan(bridge, actor, kind, tmdb, deadline)
            if not result['can_request']:
                return dict(result, submitted=False)
            if kind == 'tv' and not set(seasons) <= {s['number'] for s in result['seasons'] if s['requestable']}:
                raise Fault(409, 'seasons_already_requested_or_unavailable')
            current, _ = verified(bridge, actor, deadline)
            if current != user:
                raise Fault(403, 'seerr_account_binding_changed')
            if not hasattr(bridge, 'title_sender'):
                bridge.title_sender = FixedSeerrPost(bridge.base, header='X-Api-Key', timeout=8, max_bytes=1000000)
            body = {'mediaType': kind, 'mediaId': tmdb, 'is4k': False}
            if kind == 'tv':
                body['seasons'] = seasons
            try:
                reply = bridge.title_sender(bridge.base + '/api/v1/request', bridge._key, user=user, body=body, deadline=deadline)
            except Fault as e:
                if e.status == 409:
                    latest, _ = plan(bridge, actor, kind, tmdb, deadline)
                    return dict(latest, submitted=False)
                raise
            if (not isinstance(reply, dict) or type(reply.get('id')) is not int or (reply.get('requestedBy') or {}).get('id') != user
                    or (reply.get('media') or {}).get('tmdbId') != tmdb or reply.get('type') != kind):
                raise Fault(502, 'request_result_unconfirmed')
            state = {1: 'pending', 2: 'approved', 5: 'completed'}.get(reply.get('status'))
            if state is None:
                raise Fault(502, 'request_result_unconfirmed')
            return {'identity': result['identity'], 'title': result['title'], 'state': state, 'request_id': reply['id'],
                    'submitted': True, 'selected_seasons': seasons}
        finally:
            lock.release()
    if endpoint == '/my-requests':
        keys(data, set())
        user, _ = verified(bridge, actor, deadline)
        raw = _get(bridge, f'/api/v1/request?take=30&skip=0&sort=added&requestedBy={user}', deadline)
        library = _library(service, actor, credential)
        out = []
        rows = [r for r in (raw.get('results') or [])[:30] if isinstance(r, dict)]
        wanted = {(r.get('type'), (r.get('media') or {}).get('tmdbId')) for r in rows}
        wanted = [w for w in wanted if w[0] in ('movie', 'tv') and type(w[1]) is int]
        # Titles are looked up in parallel (and cached for a day) so 30 requests fit the time budget.
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as pool:
            for (k, t), fut in [(w, pool.submit(_title, bridge, w[0], w[1], deadline)) for w in wanted]:
                try:
                    fut.result()
                except Exception:
                    pass
        for r in rows:
            if not isinstance(r, dict) or (r.get('requestedBy') or {}).get('id') != user:
                continue
            media = r.get('media') or {}
            kind, tmdb = r.get('type'), media.get('tmdbId')
            if kind not in ('movie', 'tv') or type(tmdb) is not int:
                continue
            try:
                card = _card(_title(bridge, kind, tmdb, deadline), library)
            except Fault:
                card = {'type': kind, 'tmdb': tmdb, 'title': 'Title ' + str(tmdb), 'year': None, 'overview': '', 'poster': None,
                        'rating': None, 'state': MEDIA_STATE.get(media.get('status'), 'none'), 'item_id': library.get((kind, tmdb))}
            if card is None:
                continue
            card['request'] = {'id': r.get('id'), 'status': REQUEST_STATE.get(r.get('status'), 'unknown'),
                               'created': str(r.get('createdAt') or '')[:10],
                               'seasons': sorted({s.get('seasonNumber') for s in (r.get('seasons') or []) if isinstance(s, dict) and type(s.get('seasonNumber')) is int})}
            out.append(card)
        return {'requests': out}
    raise Fault(404, 'not_found')
