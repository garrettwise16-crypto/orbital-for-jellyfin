"""Refresh explicitly connected catalogues daily, preserving saved data on failure."""
from datetime import datetime, timezone
import hashlib
import json
import threading
import time
import catalogue_discovery
import catalogue_sources

_lock = threading.Lock()
_state = {}

def status():
    with _lock:
        return {key: dict(value) for key, value in _state.items()}

def record(provider, **value):
    with _lock:
        _state[provider] = value

def refresh(provider, snapshot, stop, now=time.time):
    """Fetch complete pages before atomically replacing this exact saved snapshot."""
    old = json.loads(snapshot)
    if old.get('automatic_refresh') is not True:
        return False
    observed = datetime.fromisoformat(old['updated_at'].replace('Z', '+00:00')).timestamp()
    if now() - observed < 86400:
        return False
    deadline = time.monotonic() + 1200
    entries = {}
    for kind, title_type in (('movies', 'Movie'), ('tv', 'Series')):
        number, total = 1, 1
        while number <= total:
            if stop.is_set() or time.monotonic() > deadline:
                raise InterruptedError('Refresh stopped; saved catalogue kept')
            record(provider, state='refreshing', kind=kind, page=number, total_pages=total)
            data = catalogue_discovery.page(provider, kind, number)
            total = data['totalPages']
            for row in data['results']:
                if row.get('adult'):
                    continue
                tmdb = row.get('id')
                if type(tmdb) is not int:
                    raise ValueError('Invalid catalogue title')
                date = row.get('releaseDate') or row.get('firstAirDate') or ''
                entries[title_type + ':' + str(tmdb)] = {
                    'tmdb': tmdb, 'type': title_type, 'title': row.get('title') or row.get('name'),
                    'year': int(date[:4]) if date[:4].isdigit() else None,
                    'genres': row.get('genreIds', []), 'overview': row.get('overview') or '',
                    'poster': row.get('posterPath'), 'backdrop': row.get('backdropPath'),
                    'rating': row.get('voteAverage'), 'votes': row.get('voteCount'),
                    'popularity': row.get('popularity')}
                if len(entries) > 100000:
                    raise ValueError('Catalogue entry limit')
            number += 1
            if number <= total and stop.wait(.35):
                raise InterruptedError('Refresh stopped')
    if stop.is_set():
        raise InterruptedError('Refresh stopped')
    saved = catalogue_sources.save({
        'provider': provider, 'region': 'US', 'automatic_refresh': True,
        'updated_at': datetime.now(timezone.utc).isoformat(), 'entries': list(entries.values())
    }, expected_sha256=hashlib.sha256(snapshot).hexdigest())
    record(provider, state='ready', updated_at=saved['updated_at'])
    return True

def cycle(stop):
    for provider in catalogue_sources.PROVIDERS:
        if stop.is_set():
            return
        path = catalogue_sources.root() / (provider + '.json')
        try:
            if path.is_file() and not path.is_symlink() and path.stat().st_size <= 32 * 1024 * 1024:
                refresh(provider, path.read_bytes(), stop)
        except Exception:
            # Upstream errors can contain credentials. Expose only a safe recovery message.
            record(provider, state='retrying', message='Could not refresh. Your saved catalogue is available; retrying in an hour.')

def run():
    stop = threading.Event()
    while not stop.wait(60):
        cycle(stop)
        if stop.wait(3540):
            return
