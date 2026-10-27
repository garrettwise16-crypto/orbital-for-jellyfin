"""Run catalogue connection as a cancellable setup job with real progress."""
from datetime import datetime, timezone
import time
from urllib.parse import urlencode

PROVIDERS = ('apple-tv', 'netflix', 'disney-plus', 'hulu', 'max', 'prime-video', 'peacock', 'paramount-plus')

def connect(jf, provider, progress, cancelled, automatic_refresh=True):
    if provider not in (*PROVIDERS, 'all'):
        raise ValueError('Choose a catalogue')
    if type(automatic_refresh) is not bool:
        raise ValueError('Choose whether to refresh daily')
    completed = []
    for name in PROVIDERS if provider == 'all' else (provider,):
        entries = {}
        for kind, title_type in (('movies', 'Movie'), ('tv', 'Series')):
            number, total = 1, 1
            while number <= total:
                cancelled()
                progress(f'Connecting {name}: reading {kind}, page {number} of {total}…')
                data = jf.call('GET', '/sports/api/catalogues/discover?' + urlencode(
                    {'provider': name, 'kind': kind, 'page': number}), timeout=20, retries=0)
                total = data['totalPages']
                if type(total) is not int or not 0 <= total <= 500:
                    raise ValueError('Catalogue is too large; your saved catalogue was kept')
                for row in data['results']:
                    if row.get('adult'): continue
                    tmdb = row.get('id')
                    if type(tmdb) is not int: raise ValueError('Catalogue returned an invalid title ID')
                    date = row.get('releaseDate') or row.get('firstAirDate') or ''
                    entries[title_type + ':' + str(tmdb)] = {
                        'tmdb': tmdb, 'type': title_type, 'title': row.get('title') or row.get('name'),
                        'year': int(date[:4]) if date[:4].isdigit() else None,
                        'genres': row.get('genreIds', []), 'overview': row.get('overview') or '',
                        'poster': row.get('posterPath'), 'backdrop': row.get('backdropPath'),
                        'rating': row.get('voteAverage'), 'votes': row.get('voteCount'),
                        'popularity': row.get('popularity')}
                number += 1
                if number <= total: time.sleep(.35)
        cancelled()
        progress(f'Checking and saving {name}: {len(entries):,} titles…')
        saved = jf.call('POST', '/sports/api/catalogues/import', body={
            'provider': name, 'region': 'US', 'automatic_refresh': automatic_refresh, 'updated_at': datetime.now(timezone.utc).isoformat(),
            'entries': list(entries.values())}, timeout=30, retries=0)
        completed.append(saved)
    return {'catalogues': completed}
