"""Optional provider catalogues, joined only to the signed-in viewer library."""
import os
import json, time, threading, hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from collections import OrderedDict
ROOT = Path(os.environ.get('SPORTS_DATA_DIR', '.')) / 'catalogues'
PROVIDERS = {'apple-tv', 'netflix', 'disney-plus', 'hulu', 'max', 'prime-video', 'peacock', 'paramount-plus'}
GENRES = {28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'}
WORK = threading.BoundedSemaphore(1)
VIEW_FRESH = 120
VIEW_SERVE = 1800
VIEW_HARD = 6 * 3600
MAX_VIEWS = 8
PAGE = 2000
DETAIL_FIELDS = 'ProviderIds,Genres,Path,Tags,Overview,Etag'
KEEP = ('Id', 'Name', 'Type', 'ProductionYear', 'Genres', 'ProviderIds', 'ImageTags', 'BackdropImageTags', 'PrimaryImageAspectRatio', 'OfficialRating', 'CommunityRating', 'PremiereDate', 'DateCreated')
_meta = {}
_views = OrderedDict()
_lock = threading.Lock()
_pending = {}
_refresh_slot = threading.BoundedSemaphore(1)
_sources = {'mtime': None, 'map': {}}
_files = {}

def _view_key(user):
    return hashlib.sha256((user['Id'] + json.dumps(user.get('Policy', {}), sort_keys=True)).encode()).hexdigest()

def _default_source(raw):
    path = str(raw.get('Path', '')).lower()
    tags = ' '.join(raw.get('Tags', [])).lower()
    return 'iptv' if any((v in path + ' ' + tags for v in ('iptv', 'iptv'))) else 'cloud' if path.endswith('.strm') or any((v in path + ' ' + tags for v in ('cloud', 'debrid', 'catalog'))) else 'local'

def _source_map():
    f = ROOT / 'library-sources.json'
    try:
        mtime = f.stat().st_mtime_ns
    except FileNotFoundError:
        mtime = None
    if mtime != _sources['mtime']:
        _sources['map'] = {r['id']: r['source'] for r in json.loads(f.read_text()).get('items', [])} if mtime else {}
        _sources['mtime'] = mtime
    return _sources['map']

def _refresh(user, token, fetch, base):
    """Read the viewer's visible ids + user data, then details only for new or changed titles."""
    with _refresh_slot:

        def page(start):
            q = {'Recursive': 'true', 'IncludeItemTypes': 'Movie,Series', 'Fields': 'Etag', 'Limit': PAGE, 'StartIndex': start, 'EnableTotalRecordCount': 'true' if start == 0 else 'false', 'EnableImages': 'false', 'EnableUserData': 'true', 'SortBy': 'SortName', 'SortOrder': 'Ascending'}
            return fetch(base + '/Users/' + user['Id'] + '/Items?' + urlencode(q), token)
        first = page(0)
        total = first.get('TotalRecordCount', len(first.get('Items', [])))
        if total > 100000:
            raise ValueError('Library inventory exceeds supported bound')
        pages = [first]
        with ThreadPoolExecutor(max_workers=3) as pool:
            pages += list(pool.map(page, range(PAGE, total, PAGE)))
        ids, userdata, etags = ([], {}, {})
        for data in pages:
            for raw in data.get('Items', []):
                if raw['Id'] in userdata:
                    raise ValueError('Library changed during inventory')
                ids.append(raw['Id'])
                userdata[raw['Id']] = raw.get('UserData') or {}
                etags[raw['Id']] = raw.get('Etag')
        if len(ids) != total:
            raise ValueError('Incomplete library inventory')
        with _lock:
            need = [i for i in ids if i not in _meta or _meta[i]['etag'] != etags[i]]

        def details(batch):
            q = {'Ids': ','.join(batch), 'Fields': DETAIL_FIELDS, 'ImageTypeLimit': 1, 'EnableUserData': 'false', 'Limit': len(batch), 'EnableTotalRecordCount': 'false'}
            return fetch(base + '/Users/' + user['Id'] + '/Items?' + urlencode(q), token).get('Items', [])
        with ThreadPoolExecutor(max_workers=3) as pool:
            for items in pool.map(details, [need[i:i + 200] for i in range(0, len(need), 200)]):
                with _lock:
                    for raw in items:
                        item = {k: raw[k] for k in KEEP if k in raw}
                        item['Overview'] = str(raw.get('Overview', ''))[:500]
                        _meta[raw['Id']] = {'etag': raw.get('Etag'), 'item': item, 'source': _default_source(raw)}
        with _lock:
            if any((i not in _meta for i in ids)):
                raise ValueError('Incomplete library details')
            key = _view_key(user)
            _views[key] = {'at': time.monotonic(), 'ids': ids, 'userdata': userdata, 'rows': None, 'rows_key': None}
            _views.move_to_end(key)
            while len(_views) > MAX_VIEWS:
                _views.popitem(last=False)
            if len(_meta) > len(ids) + 5000:
                live = set().union(*(set(v['ids']) for v in _views.values()))
                for i in [i for i in _meta if i not in live]:
                    del _meta[i]

def _start(user, token, fetch, base):
    """Single-flight refresh for this viewer; returns (event, started)."""
    key = _view_key(user)
    with _lock:
        event = _pending.get(key)
        if event:
            return (event, False)
        event = _pending[key] = threading.Event()

    def run():
        try:
            _refresh(user, token, fetch, base)
        except Exception:
            pass
        finally:
            with _lock:
                _pending.pop(key, None)
            event.set()
    threading.Thread(target=run, daemon=True, name='catalogue-view').start()
    return (event, True)

def warm(user, token, fetch, base):
    """Non-blocking: refresh this viewer's view if missing or older than VIEW_FRESH."""
    try:
        with _lock:
            v = _views.get(_view_key(user))
            if v and time.monotonic() - v['at'] < VIEW_FRESH:
                return False
        return _start(user, token, fetch, base)[1]
    except Exception:
        return False

def inventory(user, token, fetch, base):
    key = _view_key(user)
    with _lock:
        v = _views.get(key)
        age = time.monotonic() - v['at'] if v else None
    if v is None or age >= VIEW_SERVE:
        event, _ = _start(user, token, fetch, base)
        if not event.wait(60):
            raise ValueError('Library inventory timed out')
        with _lock:
            v = _views.get(key)
        if v is None or time.monotonic() - v['at'] >= VIEW_HARD:
            raise ValueError('Library inventory unavailable')
    elif age >= VIEW_FRESH:
        _start(user, token, fetch, base)
    sources = _source_map()
    with _lock:
        stamp = (v['at'], _sources['mtime'])
        if v['rows_key'] == stamp:
            return v['rows']
        rows = []
        for i in v['ids']:
            m = _meta[i]
            item = dict(m['item'])
            item['source'] = sources.get(i, m['source'])
            if v['userdata'].get(i):
                item['UserData'] = v['userdata'][i]
            rows.append(item)
        v['rows'], v['rows_key'] = (rows, stamp)
        return rows

def view_age(user):
    """Seconds since this viewer's library inventory was read (None if never)."""
    with _lock:
        v = _views.get(_view_key(user))
    return None if v is None else time.monotonic() - v['at']

def join(entries, items):
    indexed = {}
    for item in items:
        tmdb = item.get('ProviderIds', {}).get('Tmdb')
        if tmdb:
            key = item['Type'] + ':' + str(tmdb)
            if key not in indexed or ['local', 'cloud', 'iptv'].index(item['source']) < ['local', 'cloud', 'iptv'].index(indexed[key]['source']):
                indexed[key] = item
    out = []
    for entry in entries:
        item = indexed.get(entry['id'])
        out.append({**entry, 'overview': str(entry.get('overview') or '')[:500], 'genre_names': [GENRES[g] for g in entry.get('genres', []) if g in GENRES], 'in_library': bool(item), 'item': item})
    return out

def catalogue(query, user, token, fetch, base):
    if query.get('view', [''])[0] == 'curated':
        return curated_library(query, user, token, fetch, base)
    if query.get('view', [''])[0] == 'hero':
        return library_heroes(query, user, token, fetch, base)
    provider = query.get('provider', [''])[0]
    if provider not in PROVIDERS:
        raise ValueError('Unknown provider')
    path = ROOT / (provider + '.json')
    if not path.is_file():
        return {'provider': provider, 'entries': [], 'available': False, 'reason': 'Ask your server administrator to connect this catalogue in Orbital Setup.', 'stale': True, 'current_claim': False}
    mtime = path.stat().st_mtime_ns
    with _lock:
        cached = _files.get(provider)
    if not cached or cached[0] != mtime:
        cached = (mtime, json.loads(path.read_text()))
        with _lock:
            _files[provider] = cached
    data = cached[1]
    from datetime import datetime
    age = time.time() - datetime.fromisoformat(data['updated_at']).timestamp()
    entries = join(data['entries'], inventory(user, token, fetch, base))
    inv = view_age(user)
    taxonomy = json.loads((ROOT / 'taxonomy.json').read_text()) if (ROOT / 'taxonomy.json').exists() else {}
    view = query.get('view', [''])[0]
    if view == 'discover':
        return validate_hero_page(_discover(query, data, entries, age, inv), user, token, fetch, base)
    if view == 'first':
        return validate_hero_page(_first(query, data, entries, age, inv), user, token, fetch, base)
    if view == 'lite':
        entries = [_lite(e) for e in entries]
    return {k: v for k, v in {**data, 'entries': entries, 'taxonomy': taxonomy, 'stale': age > 86400, 'current_claim': age <= 259200, 'inventory_age_seconds': None if inv is None else int(inv), 'inventory_stale': bool(inv is not None and inv >= VIEW_SERVE)}.items() if k != 'provider_ids'}
FIRST_COUNT = 60
_ENTRY_LITE = ('tmdb', 'type', 'title', 'year', 'poster', 'popularity', 'genre_names', 'in_library')
_USERDATA = ('Played', 'PlaybackPositionTicks', 'IsFavorite', 'PlayedPercentage')
THIN_FLOOR = {'Movie': 9.0, 'Series': 9.0}

def _trusted_rating(e):
    """Community rating, or 0 when it is thin: no widely voted title scores 9.0+ (series with a flat 9.0 are common junk)."""
    item = e.get('item') or {}
    try:
        value = float(item.get('CommunityRating') or e.get('rating') or 0)
    except (TypeError, ValueError):
        return 0.0
    kind = item.get('Type') or e.get('type')
    return 0.0 if value >= THIN_FLOOR.get(kind, 9.0) else value

def _slim_item(item, overview=True):
    out = {k: v for k, v in item.items() if k not in ('ProviderIds', 'UserData') and (overview or k != 'Overview')}
    if item.get('UserData'):
        out['UserData'] = {k: item['UserData'][k] for k in _USERDATA if k in item['UserData']}
    return out

def _lite(e):
    out = {k: e[k] for k in _ENTRY_LITE if k in e}
    if e.get('item'):
        out['item'] = _slim_item(e['item'])
    else:
        out['overview'] = e.get('overview', '')
    t = 'movie' if e.get('type') == 'Movie' else 'tv'
    if e.get('source') and e['source'] != f"https://www.themoviedb.org/{t}/{e.get('tmdb')}/watch?locale=US":
        out['source'] = e['source']
    return out

def _first(query, data, entries, age, inv):
    try:
        seed = int(query.get('seed', ['0'])[0]) & 4294967295
    except ValueError:
        seed = 0
    counts = {'library': 0, 'service': 0}
    genres = {}
    for e in entries:
        scope = 'library' if e['in_library'] else 'service'
        counts[scope] += 1
        genres.setdefault(scope + '|' + e['type'], set()).update(e['genre_names'])
    lib_movies = [e for e in entries if e['in_library'] and e['type'] == 'Movie']
    grid = sorted(lib_movies, key=lambda e: (-(e.get('popularity') or 0), e['title'].casefold()))[:FIRST_COUNT]
    heroes = hero_candidates([e['item'] for e in entries if e.get('item')], {e['id']: e for e in entries}, now=time.time())
    heroes = heroes[:20]
    meta = {k: v for k, v in data.items() if k not in ('entries', 'provider_ids')}
    return {**meta, 'view': 'first', 'counts': counts, 'library_movies': len(lib_movies), 'genres': {k: sorted(v) for k, v in genres.items()}, 'entries': [_lite(e) for e in grid], 'hero': [_slim_item(h) for h in heroes], 'stale': age > 86400, 'current_claim': age <= 259200, 'inventory_age_seconds': None if inv is None else int(inv), 'inventory_stale': bool(inv is not None and inv >= VIEW_SERVE)}

def recommendations(query, user, token, fetch, base):
    return _uncached_recommendations(query, user, token, fetch, base)

def _uncached_recommendations(query, user, token, fetch, base):
    """Require shared genre plus a second affinity; broad Similar rank alone is insufficient."""
    seed_id = query.get('seed', [''])[0]
    if not seed_id or len(seed_id) > 36:
        raise ValueError('Invalid seed')
    rows = inventory(user, token, fetch, base)
    seed = next((r for r in rows if r['Id'].replace('-', '') == seed_id.replace('-', '')), None)
    if not seed:
        return {'items': []}
    import re

    def tokens(item):
        return set(re.findall('[a-z]{4,}', item.get('Overview', '').lower())) - {'their', 'they', 'that', 'with', 'from', 'this', 'when', 'about', 'into', 'after', 'have', 'will', 'life', 'world', 'them', 'must', 'find'}
    genres = set(seed.get('Genres', []))
    terms = tokens(seed)
    ranked = []
    seed_year = seed.get('ProductionYear', 0)
    for item in rows:
        if item['Type'] != seed['Type'] or item['Id'] == seed['Id'] or item.get('UserData', {}).get('Played'):
            continue
        own = set(item.get('Genres', []))
        common = genres & own
        if not common:
            continue
        if 'Comedy' in genres and 'Comedy' not in own:
            continue
        if ('Animation' in own) != ('Animation' in genres):
            continue
        semantic = len(terms & tokens(item))
        overlap = len(common) / max(1, len(genres | own))
        if len(common) < 2 and semantic < 2:
            continue
        score = overlap * 8 + min(semantic, 8) * 0.7 + (max(0, 2 - abs(item.get('ProductionYear', 0) - seed_year) / 10) if seed_year else 0)
        ranked.append((score, item))
    ranked.sort(key=lambda p: (-p[0], p[1]['Name']))
    seen = set()
    result = []
    for score, item in ranked:
        identity = item.get('ProviderIds', {}).get('Tmdb') or (item['Name'], item.get('ProductionYear'))
        if identity in seen:
            continue
        seen.add(identity)
        result.append(item)
        if len(result) == 18:
            break
    return {'seed': seed['Name'], 'items': result, 'method': 'Shared genre, synopsis affinity, format and era; accessible unplayed titles only'}
DISCOVERY_TAXONOMY = {'movies': {'Documentary': [['True crime', {'g': ['Crime'], 'k': 'murder|killer|homicide|serial killer|cold case|kidnap|true crime|manhunt|convicted|fbi|crime spree|unsolved|wrongful'}], ['White-collar & scams', {'k': 'fraud|ponzi|scam|embezzl|wall street|swindl|con man|con artist|bankrupt|corruption|scandal|insider'}], ['Disasters & survival', {'k': 'disaster|hurricane|earthquake|tsunami|wildfire|avalanche|flood|survival|shipwreck|titanic|chernobyl|explosion|collapse|tornado|rescue'}], ['Music & concerts', {'g': ['Music', 'Concerts', 'Concert'], 'k': 'concert|band|album|tour|singer|rapper|hip-hop|rock|jazz|festival'}], ['Nature & wildlife', {'k': 'wildlife|nature|planet|ocean|shark|animal|species|jungle|arctic|wilderness|reef|predator|elephant|whale'}], ['Space & science', {'k': 'space|nasa|universe|cosmos|astronaut|physics|scientist|science|quantum|galaxy|moon landing|rocket'}], ['History & war', {'g': ['History', 'War'], 'k': 'world war|wwii|ww2|nazi|hitler|battle|ancient|empire|civil war|vietnam|holocaust|cold war|revolution'}], ['Sports', {'k': 'football|basketball|baseball|boxing|olympic|nfl|nba|soccer|racing|formula|wrestl|athlete|championship|hockey|golf|tennis|ufc|mma|skateboard|surf'}], ['Biographies & portraits', {'k': 'life of|biography|biopic|portrait of|his life|her life|memoir|the story of|rise and fall|the man behind|the woman behind|in his own words|in her own words'}], ['Comedy & stand-up', {'g': ['Comedy', 'Stand-Up Comedy'], 'k': 'stand-up|standup|comedian|comedy special'}], ['Food & travel', {'k': 'chef|cuisine|restaurant|food|cooking|travel|expedition|road trip|journey across|voyage'}], ['Cults, conspiracies & the unexplained', {'k': 'cult|conspiracy|ufo|alien|paranormal|secret society|bigfoot|mystery of|unexplained|haunted|psychic'}], ['Politics & society', {'k': 'politic|president|election|democracy|activist|protest|racism|immigra|civil rights|inequality|climate change|social justice'}], ['Crime & cartels', {'k': 'cartel|drug|trafficking|mafia|mob|gang|narco'}]], 'Action': [['Superheroes & comics', {'k': 'superhero|marvel|avengers|batman|spider-man|x-men|justice league|comic|mutant|superman|wolverine'}], ['Martial arts', {'k': 'martial|kung fu|karate|ninja|samurai|fighter|tournament|shaolin|bruce lee|jackie chan'}], ['Spies & espionage', {'k': '\\bspy\\b|espionage|\\bcia\\b|\\bmi6\\b|\\bkgb\\b|secret agent|covert|undercover|intelligence agency'}], ['Heists & getaways', {'k': 'heist|robbery|thieves|steal|bank job|getaway|casino'}], ['Military & war', {'g': ['War'], 'k': 'soldier|marine|navy seal|special forces|platoon|army|sniper'}], ['Sci-fi action', {'g': ['Science Fiction']}], ['Crime action', {'g': ['Crime']}], ['Adventures', {'g': ['Adventure']}], ['Survival & disaster', {'k': 'survive|survival|disaster|stranded|earthquake|tsunami|hijack|hostage'}], ['Action comedies', {'g': ['Comedy']}]], 'Comedy': [['Romantic comedies', {'g': ['Romance']}], ['Family comedies', {'g': ['Family']}], ['Animated comedies', {'g': ['Animation']}], ['Stand-up & specials', {'g': ['Stand-Up Comedy'], 'k': 'stand-up|standup|comedy special|live at|comedian'}], ['Dark comedies', {'g': ['Crime', 'Thriller'], 'k': 'dark comedy|black comedy|murder|crime'}], ['Holiday comedies', {'k': 'christmas|holiday|santa|thanksgiving|new year'}], ['Buddies, weddings & road trips', {'k': 'road trip|best friend|buddy|bachelor|wedding|bromance|vacation|reunion'}], ['Teen & coming of age', {'k': 'high school|teen|coming of age|college|prom|graduat'}], ['Workplace & satire', {'k': 'office|satire|corporate|boss|workplace|campaign|spoof|parody'}], ['Comedy classics', {'y': [1900, 1989]}]], 'Drama': [['Crime dramas', {'g': ['Crime']}], ['Period & historical', {'g': ['History'], 'k': 'century|victorian|kingdom|1800s|1900s|regency|medieval|empire|dynasty'}], ['Based on true stories', {'k': 'true story|based on the true|based on a true|biopic|real-life|inspired by true|the true story|biography'}], ['Sports dramas', {'k': 'football|basketball|baseball|boxing|boxer|olympic|coach|champion|athlete|racing|wrestl|hockey|golf'}], ['Romantic dramas', {'g': ['Romance']}], ['Legal & political', {'k': 'lawyer|trial|courtroom|attorney|senator|president|political|verdict|justice|judge'}], ['War dramas', {'g': ['War']}], ['Family dramas', {'g': ['Family'], 'k': 'family drama|coming of age|single mother|single father|estranged|generations|adoption|foster'}], ['Music & musicals', {'g': ['Music', 'Musical']}], ['Thrillers & suspense', {'g': ['Thriller']}], ['Independent & festival', {'k': 'sundance|independent|festival|award-winning'}]], 'Horror': [['Supernatural & haunted', {'k': 'ghost|haunt|demon|possess|exorcis|paranormal|spirit|curse|occult|ouija'}], ['Slashers & serial killers', {'k': 'slasher|killer|masked|serial|massacre|stalk|murder'}], ['Zombies & outbreaks', {'k': 'zombie|undead|outbreak|infected|virus|plague|apocalyp'}], ['Creature features', {'k': 'creature|monster|shark|werewolf|vampire|beast|swamp|giant|spider'}], ['Found footage', {'k': 'found footage|footage|camera crew|documentary crew|recording'}], ['Horror comedies', {'g': ['Comedy']}], ['Psychological horror', {'k': 'psycholog|madness|insanity|nightmare|obsess|asylum|mind'}], ['Sci-fi horror', {'g': ['Science Fiction']}], ['Cabins, cults & backwoods', {'k': 'cabin|woods|cult|forest|camp|backwoods|island|remote'}], ['Horror classics', {'y': [1900, 1989]}]], 'Science Fiction': [['Space & galaxies', {'k': 'space|galaxy|planet|astronaut|starship|mars|orbit|cosmos'}], ['Time travel & loops', {'k': 'time travel|time loop|travels back|the future|timeline|paradox'}], ['Dystopias & apocalypse', {'k': 'dystopia|apocalyp|wasteland|post-apocalyptic|survivors|totalitarian|last humans'}], ['AI, robots & cyborgs', {'k': 'robot|android|artificial intelligence|a\\.i\\.|cyborg|machine|computer|simulation|virtual'}], ['Aliens & invasions', {'k': 'alien|invasion|extraterrestrial|first contact|ufo'}], ['Sci-fi thrillers', {'g': ['Thriller']}], ['Sci-fi action', {'g': ['Action']}], ['Superheroes', {'k': 'superhero|marvel|comic|mutant'}], ['Sci-fi horror', {'g': ['Horror']}], ['Sci-fi classics', {'y': [1900, 1989]}]], 'Thriller': [['Psychological thrillers', {'k': 'psycholog|obsess|paranoi|mind games|manipulat|twisted|secret'}], ['Crime thrillers', {'g': ['Crime']}], ['Spies & conspiracies', {'k': 'spy|espionage|conspiracy|cover-up|government|agent|cia'}], ['Mysteries', {'g': ['Mystery']}], ['Action thrillers', {'g': ['Action']}], ['Kidnappings, hostages & home invasion', {'k': 'kidnap|hostage|home invasion|abduct|ransom|captive|intruder'}], ['Serial killers', {'k': 'serial killer|murderer|killer'}], ['Survival thrillers', {'k': 'survive|survival|stranded|wilderness|trapped|shark'}], ['Erotic & noir', {'k': 'noir|seduct|affair|femme fatale|erotic'}]], 'Crime': [['Heists', {'k': 'heist|robbery|bank job|steal|casino|thieves'}], ['Mafia & gangsters', {'k': 'mafia|gangster|mob|cartel|crime family|godfather|syndicate|hitman'}], ['Detectives & noir', {'k': 'detective|noir|investigat|private eye|inspector'}], ['Prison stories', {'k': 'prison|inmate|penitentiary|jail|escape'}], ['True crime documentaries', {'g': ['Documentary']}], ['Serial killers', {'k': 'serial killer|murderer|killer|slasher'}], ['Cops & undercover', {'k': 'cop|police|undercover|narcotics|precinct|officer|detective'}], ['Crime comedies', {'g': ['Comedy']}], ['Crime dramas', {'g': ['Drama']}]], 'Romance': [['Romantic comedies', {'g': ['Comedy']}], ['Period romance', {'g': ['History'], 'k': 'century|regency|victorian|1800s|kingdom|aristocrat'}], ['Tearjerkers', {'g': ['Drama'], 'k': 'illness|dying|cancer|grief|loss|memory|goodbye'}], ['Holiday romance', {'k': 'christmas|holiday|snow|winter wedding'}], ['Teen romance', {'k': 'high school|teen|first love|prom|college'}], ['Romantic thrillers', {'g': ['Thriller', 'Mystery']}], ['Musical romance', {'g': ['Music', 'Musical']}]], 'Adventure': [['Family adventures', {'g': ['Family']}], ['Fantasy quests', {'g': ['Fantasy'], 'k': 'quest|kingdom|dragon|sword|magic'}], ['Action adventures', {'g': ['Action']}], ['Animated adventures', {'g': ['Animation']}], ['Treasure & expeditions', {'k': 'treasure|expedition|jungle|lost city|explorer|island|voyage|pirate'}], ['Survival', {'k': 'survive|survival|stranded|wilderness'}], ['Sci-fi adventures', {'g': ['Science Fiction']}]], 'Family': [['Animated', {'g': ['Animation']}], ['Family adventures', {'g': ['Adventure']}], ['Holiday favourites', {'k': 'christmas|holiday|santa|halloween|easter'}], ['Animals & pets', {'k': 'dog|puppy|cat|horse|animal|pet|dolphin'}], ['Family comedies', {'g': ['Comedy']}], ['Fantasy & magic', {'g': ['Fantasy']}], ['Sports & underdogs', {'k': 'team|coach|championship|soccer|football|baseball|basketball'}]], 'Animation': [['Family animation', {'g': ['Family']}], ['Anime', {'k': 'anime|japan|tokyo|manga|studio ghibli'}], ['Animated comedies', {'g': ['Comedy'], 'x': ['Family']}], ['Superheroes', {'k': 'superhero|batman|spider|marvel|justice league|dc'}], ['Fantasy & adventure', {'g': ['Fantasy', 'Adventure']}], ['Animated sci-fi', {'g': ['Science Fiction']}]], 'Fantasy': [['Epic & sword-and-sorcery', {'k': 'kingdom|sword|dragon|wizard|quest|realm|throne|warrior'}], ['Fairy tales', {'k': 'fairy|princess|tale|once upon|enchanted'}], ['Magic & witches', {'k': 'witch|magic|sorcer|spell|wizard'}], ['Superheroes', {'k': 'superhero|marvel|comic'}], ['Animated fantasy', {'g': ['Animation']}], ['Family fantasy', {'g': ['Family']}], ['Dark fantasy', {'g': ['Horror', 'Thriller']}]], 'Mystery': [['Whodunits & detectives', {'k': 'whodunit|detective|investigat|inspector|sleuth|clue|murder'}], ['Supernatural mysteries', {'g': ['Horror', 'Fantasy'], 'k': 'ghost|haunt|supernatural'}], ['Crime mysteries', {'g': ['Crime']}], ['Psychological', {'g': ['Thriller'], 'k': 'psycholog|memory|amnesia|obsess'}], ['Sci-fi mysteries', {'g': ['Science Fiction']}]], 'History': [['Ancient worlds', {'k': 'rome|roman|greek|egypt|pharaoh|gladiator|spartan|ancient'}], ['Medieval & knights', {'k': 'medieval|knight|crusade|viking|castle|middle ages'}], ['Kings, queens & royalty', {'k': 'queen|king|royal|throne|monarch|palace|prince'}], ['Wars & revolutions', {'g': ['War'], 'k': 'war|revolution|battle'}], ['20th century', {'k': '19[0-9]0s|world war|cold war|1960s|1970s|1980s'}], ['Biopics', {'k': 'true story|biography|life of|biopic'}]], 'War': [['World War II', {'k': 'wwii|world war ii|world war 2|nazi|hitler|1944|1945|normandy|d-day|pearl harbor|holocaust'}], ['Vietnam', {'k': 'vietnam|saigon|viet cong'}], ['Modern conflicts', {'k': 'iraq|afghanistan|marine|navy seal|special forces|kabul|baghdad|taliban'}], ['World War I & earlier', {'k': 'world war i|1914|1917|1918|trench|civil war|napoleon|revolution'}], ['War dramas', {'g': ['Drama']}], ['War action', {'g': ['Action']}]], 'Western': [['Classic westerns', {'y': [1900, 1979]}], ['Modern westerns', {'y': [1990, 2030]}], ['Outlaws & gunslingers', {'k': 'outlaw|bandit|gunslinger|bounty|sheriff|posse|gang'}], ['Frontier & cattle', {'k': 'frontier|ranch|cattle|homestead|pioneer|trail'}]], 'Music': [['Concerts & live', {'g': ['Concerts', 'Concert'], 'k': 'concert|live at|live from|tour'}], ['Music biopics', {'k': 'life of|biography|true story|rise of|the story of'}], ['Musicals', {'g': ['Musical'], 'k': 'musical|broadway|sing|dance'}], ['Music documentaries', {'g': ['Documentary']}], ['Music dramas', {'g': ['Drama']}]], 'TV Movie': [['Holiday & Christmas', {'k': 'christmas|holiday|santa|hallmark|snow|reindeer|mistletoe'}], ['Romances', {'g': ['Romance']}], ['Thrillers & mysteries', {'g': ['Thriller', 'Mystery']}], ['Family', {'g': ['Family']}], ['Animated', {'g': ['Animation']}], ['Based on true stories', {'k': 'true story|based on the true|based on a true|real-life|biopic|inspired by true'}], ['Documentaries', {'g': ['Documentary']}]]}, 'tv': {'Documentary': [['True crime', {'g': ['Crime'], 'k': 'murder|killer|homicide|serial killer|cold case|true crime|manhunt|convicted|unsolved|victims|detective'}], ['Nature & wildlife', {'k': 'nature|wildlife|planet|animal|ocean|predator|earth|species'}], ['History', {'k': 'history|war|empire|ancient|century|historical'}], ['Science & space', {'k': 'space|science|universe|cosmos|nasa|physics|technology|engineering'}], ['Sports', {'k': 'football|basketball|baseball|soccer|nfl|nba|racing|formula|athlete|boxing|wrestl|golf|hockey|olympic'}], ['Music & culture', {'k': 'music|band|album|hip-hop|rock|artist|culture'}], ['Food & travel', {'k': 'food|chef|cooking|restaurant|travel|journey|road'}], ['Paranormal, UFOs & mysteries', {'k': 'ufo|paranormal|ghost|alien|unexplained|mystery|haunted|bigfoot|conspiracy'}], ['Politics & society', {'g': ['War & Politics', 'News'], 'k': 'politic|president|election|justice|society|activist|scandal'}], ['Scams & scandals', {'k': 'fraud|scam|ponzi|scandal|con artist|cult|corruption'}], ['Docuseries about people', {'k': 'life of|family|behind the scenes|intimate|portrait|celebrity'}]], 'Reality': [['Competitions', {'k': 'competition|compete|contest|challenge|race|win|prize|elimination'}], ['Dating & relationships', {'k': 'dating|love|bachelor|couple|marriage|single|romance|wedding'}], ['Cooking & food', {'k': 'cook|chef|kitchen|food|bake|restaurant|recipe'}], ['Home & renovation', {'k': 'renovat|home|house|property|design|flip|estate'}], ['Celebrities & families', {'k': 'celebrit|family|housewives|kardashian|famous|lifestyle'}], ['Survival & adventure', {'k': 'survival|wild|alone|island|expedition|outdoor|treasure'}], ['Talent, music & dance', {'k': 'talent|sing|dance|idol|voice|performance|band'}], ['Business & makeovers', {'k': 'business|makeover|shark|pitch|deal|restore|garage|auction'}], ['True crime reality', {'g': ['Crime', 'Documentary']}]], 'Comedy': [['Sitcoms', {'k': 'sitcom|roommates|neighbors|apartment|workplace|office|family|friends'}], ['Animated comedies', {'g': ['Animation']}], ['Sketch, satire & late night', {'g': ['Talk'], 'k': 'sketch|satire|late night|talk show|parody|improv'}], ['Dramedies', {'g': ['Drama']}], ['Teen & coming of age', {'k': 'high school|teen|college|coming of age'}], ['Family comedies', {'g': ['Family', 'Kids']}], ['Romantic comedies', {'g': ['Romance'], 'k': 'romance|love|dating'}], ['British comedies', {'k': 'british|london|england|bbc|uk '}], ['Comedy classics', {'y': [1900, 1999]}]], 'Crime': [['Detectives & procedurals', {'k': 'detective|police|investigat|procedural|homicide|precinct|forensic|inspector'}], ['True crime docuseries', {'g': ['Documentary']}], ['Gangs, mafia & cartels', {'k': 'mafia|gangster|cartel|mob|gang|drug|narco'}], ['Legal dramas', {'k': 'lawyer|law|court|attorney|trial|prosecut'}], ['Spies & thrillers', {'k': 'spy|espionage|agent|terror|conspiracy'}], ['Crime comedies', {'g': ['Comedy']}], ['Prison & undercover', {'k': 'prison|undercover|inmate'}], ['British crime', {'k': 'british|london|scotland|bbc|england|itv'}]], 'Drama': [['Crime dramas', {'g': ['Crime']}], ['Period dramas', {'k': 'century|victorian|regency|1800s|1900s|1920s|1950s|1960s|kingdom|royal|dynasty|historical'}], ['Medical dramas', {'k': 'hospital|doctor|medical|nurse|surgeon|paramedic'}], ['Legal & political', {'g': ['War & Politics'], 'k': 'lawyer|law|court|politic|senator|president|white house'}], ['Family sagas', {'g': ['Family'], 'k': 'family|generations|sisters|brothers|dynasty'}], ['Teen dramas', {'k': 'high school|teen|college|coming of age'}], ['Soaps', {'g': ['Soap']}], ['Sci-fi & fantasy dramas', {'g': ['Sci-Fi & Fantasy']}], ['Mysteries', {'g': ['Mystery']}], ['Based on true stories', {'k': 'true story|based on|real events|biograph|scandal'}], ['British dramas', {'k': 'british|london|england|bbc|itv|scotland|wales'}]], 'Kids': [['Preschool', {'k': 'preschool|toddler|little|learn|abc|numbers|sing'}], ['Cartoons', {'g': ['Animation']}], ['Live-action & family', {'g': ['Family'], 'x': ['Animation']}], ['Educational & discovery', {'k': 'learn|science|explore|discover|education|nature'}], ['Adventures & heroes', {'k': 'adventure|hero|rescue|superhero|quest'}]], 'Family': [['Cartoons & animation', {'g': ['Animation']}], ['Kids shows', {'g': ['Kids']}], ['Family comedies', {'g': ['Comedy']}], ['Family dramas', {'g': ['Drama']}], ['Adventure & fantasy', {'g': ['Sci-Fi & Fantasy', 'Action & Adventure']}]], 'Animation': [['Anime', {'k': 'anime|japan|tokyo|manga|shonen|isekai'}], ['Kids cartoons', {'g': ['Kids', 'Family']}], ['Adult animation', {'g': ['Comedy'], 'x': ['Kids', 'Family']}], ['Superheroes', {'k': 'superhero|batman|spider|marvel|justice league|dc'}], ['Sci-fi & fantasy animation', {'g': ['Sci-Fi & Fantasy']}]], 'Sci-Fi & Fantasy': [['Space & aliens', {'k': 'space|galaxy|starship|planet|alien|astronaut'}], ['Superheroes', {'k': 'superhero|marvel|dc|comic|mutant|powers'}], ['Supernatural & horror', {'k': 'vampire|werewolf|ghost|demon|supernatural|witch|zombie'}], ['Dystopias & apocalypse', {'k': 'dystopia|apocalyp|post-apocalyptic|survivors|virus'}], ['Epic fantasy', {'k': 'kingdom|dragon|sword|magic|realm|throne|quest'}], ['Time travel & mysteries', {'k': 'time travel|timeline|parallel|mystery|conspiracy'}], ['Anime', {'g': ['Animation'], 'k': 'anime|japan'}]], 'Action & Adventure': [['Superheroes', {'k': 'superhero|marvel|dc|comic|mutant'}], ['Spies & agents', {'k': 'spy|agent|espionage|cia|undercover'}], ['Military & tactical', {'k': 'military|soldier|navy|seal|special forces|war'}], ['Survival & wilderness', {'k': 'survival|wilderness|island|stranded|apocalyp'}], ['Sci-fi action', {'g': ['Sci-Fi & Fantasy']}], ['Crime action', {'g': ['Crime']}], ['Anime action', {'g': ['Animation']}]], 'Mystery': [['Detective mysteries', {'k': 'detective|investigat|inspector|whodunit|clue|solve'}], ['Supernatural mysteries', {'g': ['Sci-Fi & Fantasy'], 'k': 'supernatural|ghost|paranormal'}], ['Crime mysteries', {'g': ['Crime']}], ['Psychological', {'k': 'psycholog|memory|secret|missing|disappear'}], ['British mysteries', {'k': 'british|london|england|bbc|itv|village'}]], 'War & Politics': [['Political dramas', {'k': 'politic|president|white house|senator|election|prime minister'}], ['War', {'k': 'war|soldier|battle|military|nazi|resistance'}], ['Spy thrillers', {'k': 'spy|espionage|agent|cia|kgb'}], ['Docuseries', {'g': ['Documentary']}]], 'Western': [['Classic westerns', {'y': [1900, 1989]}], ['Modern westerns', {'y': [1990, 2100]}], ['Drama', {'g': ['Drama']}]], 'Talk': [['Late night', {'k': 'late night|tonight|late show|talk show|monologue'}], ['Comedy', {'g': ['Comedy']}], ['News & politics', {'g': ['News', 'War & Politics'], 'k': 'news|politic|election|daily'}]], 'Soap': [['Drama', {'g': ['Drama']}], ['Romance', {'k': 'love|romance|affair|marriage|wedding'}], ['Family sagas', {'g': ['Family'], 'k': 'family|dynasty|generations|heir|empire'}]]}}

def _discover(query, data, entries, age, inv):
    import re

    def value(k, default=''):
        return str(query.get(k, [default])[0])[:160]
    kind = value('type', 'All')
    scope = value('scope', 'library')
    if kind not in ('All', 'Movie', 'Series') or scope not in ('library', 'service'):
        raise ValueError('Invalid discovery scope')

    def selections(key, allowed=None):
        raw = str(query.get(key, [''])[0])
        if len(raw) > 2048:
            raise ValueError('Too many filter values')
        values = list(dict.fromkeys((v.strip() for v in raw.split('|') if v.strip())))
        if len(values) > 40 or any((len(v) > 80 for v in values)):
            raise ValueError('Too many filter values')
        if allowed is not None and any((v not in allowed for v in values)):
            raise ValueError('Invalid filter')
        return values
    selected_genres = selections('genre')
    selected_decades = selections('decade', ('1900', '1980', '1990', '2000', '2010', '2020'))
    genre = selected_genres[0] if len(selected_genres) == 1 else ''
    decade = '|'.join(selected_decades)
    sub = value('sub')
    watch = value('watch')
    favorite = value('favorite')
    rating = value('rating')
    sort = value('sort', 'rated')
    search = value('search').casefold()
    if sub and len(selected_genres) != 1:
        raise ValueError('Subgenre requires one genre')
    if scope == 'service' and (watch or favorite):
        raise ValueError('Watch state requires library titles')
    if watch not in ('', 'yes', 'no') or favorite not in ('', '1') or rating not in ('', '6', '7', '8'):
        raise ValueError('Invalid filter')
    if sort not in ('rated', 'new', 'az', 'popular', 'added'):
        raise ValueError('Invalid sort')
    start = max(0, min(50000, int(value('start', '0'))))
    limit = max(1, min(60, int(value('limit', '60'))))
    scoped = [e for e in entries if (kind == 'All' or e['type'] == kind) and bool(e.get('in_library')) == (scope == 'library')]
    genres = sorted({g for e in scoped for g in e.get('genre_names', [])})
    rules_by_type = {t: DISCOVERY_TAXONOMY['tv' if t == 'Series' else 'movies'].get(genre, []) for t in ('Movie', 'Series')}
    names = list(dict.fromkeys((n for t in ('Movie', 'Series') for n, r in rules_by_type[t])))

    def matches(e, r):
        gs = [g.casefold() for g in e.get('genre_names', [])]
        item = e.get('item') or {}
        if any((g.casefold() in gs for g in r.get('x', []))):
            return False
        if any((g.casefold() in gs for g in r.get('g', []))):
            return True
        terms = [re.compile(t, re.I) for t in r.get('k', '').split('|') if t]
        if any((t.search(e.get('title', '')) for t in terms)) or sum((bool(t.search(item.get('Overview') or e.get('overview', ''))) for t in terms)) >= 2:
            return True
        return 'y' in r and r['y'][0] <= int(e.get('year') or 0) <= r['y'][1]

    def accepts(e):
        item = e.get('item') or {}
        ud = item.get('UserData') or {}
        year = int(e.get('year') or 0)
        return (not selected_genres or any((g in e.get('genre_names', []) for g in selected_genres))) and (not selected_decades or any((int(d) <= year <= (1979 if d == '1900' else int(d) + 9) for d in selected_decades))) and (not watch or bool(ud.get('Played')) == (watch == 'yes')) and (not favorite or bool(ud.get('IsFavorite'))) and (not rating or _trusted_rating(e) >= int(rating)) and (not search or search in e.get('title', '').casefold())
    pool = [e for e in scoped if accepts(e)]

    def order(e, sort=sort):
        item = e.get('item') or {}
        if sort == 'added':
            from datetime import datetime
            try:
                score = datetime.fromisoformat(str(item.get('DateCreated', '')).replace('Z', '+00:00')).timestamp()
            except ValueError:
                score = 0
            return (-score, e.get('title', '').casefold(), str(e.get('tmdb', '')))
        score = 0 if sort == 'az' else int(e.get('year') or 0) if sort == 'new' else float(e.get('popularity') or 0) if sort == 'popular' else _trusted_rating(e)
        return (-score, e.get('title', '').casefold(), str(e.get('tmdb', '')))
    pool.sort(key=order)

    def match_sub(e, name):
        return any((n == name and matches(e, r) for n, r in rules_by_type[e['type']]))
    subs = [name for name in names if any((match_sub(e, name) for e in pool))]
    if sub:
        if sub not in names:
            raise ValueError('Unknown subgenre')
        pool = [e for e in pool if match_sub(e, sub)]

    def row(name, key, items, filters):
        return {'id': key, 'title': name, 'count': len(items), 'entries': [_lite(e) for e in items[:12]], 'filters': filters}
    rows = []
    if not sub and value('grid') != '1' and (not search):
        if genre:
            for name in subs:
                group = [e for e in pool if match_sub(e, name)]
                if group:
                    rows.append(row(name, 'sub:' + name, group, {'sub': name, 'grid': '1'}))
            if not rows:
                for other in genres:
                    group = [e for e in pool if other != genre and other in e.get('genre_names', [])]
                    if group and len(group) < len(pool):
                        rows.append(row(other, 'co:' + other, group, {'co': other, 'grid': '1'}))
        else:
            if pool:
                rows.append(row('Recently released', 'new', sorted(pool, key=lambda e: order(e, 'new')), {'sort': 'new', 'grid': '1'}))
                rows.append(row('Top rated', 'rated', sorted(pool, key=lambda e: order(e, 'rated')), {'sort': 'rated', 'grid': '1'}))
            for g in genres:
                group = [e for e in pool if g in e.get('genre_names', [])]
                if group:
                    rows.append(row(g, 'genre:' + g, group, {'co': g} if selected_genres else {'genre': g}))
    co = value('co')
    if co:
        pool = [e for e in pool if co in e.get('genre_names', [])]
        rows = []
    for r in rows[2:]:
        r['entries'] = []
    meta = {k: v for k, v in data.items() if k not in ('entries', 'provider_ids', 'taxonomy')}
    heroes = hero_candidates([e['item'] for e in pool if e.get('item')], {e['id']: e for e in pool}, now=time.time())[:5] if not any((selected_genres, decade, watch, favorite, rating, sub, co, search, value('grid'))) else []
    return {**meta, 'view': 'discover', 'total': len(pool), 'start': start, 'entries': [] if rows else [_lite(e) for e in pool[start:start + limit]], 'rows': rows, 'hero': heroes, 'genres': genres, 'subgenres': subs, 'scope': scope, 'type': kind, 'stale': age > 86400, 'current_claim': age <= 259200, 'inventory_age_seconds': None if inv is None else int(inv)}
'One permission-scoped hero policy used by every owned renderer.'
from datetime import datetime, timezone
'One permission-scoped hero policy used by every owned renderer.'
from datetime import datetime

def hero_candidates(items, metadata, *, now):
    selected = []
    for item in items:
        m = metadata.get(item.get('Type', '') + ':' + str(item.get('ProviderIds', {}).get('Tmdb')), {})
        try:
            rating = float(item.get('CommunityRating') or m.get('rating') or 0)
            votes = int(m.get('votes') or 0)
            popularity = float(m.get('popularity') or 0)
        except (ValueError, TypeError):
            continue
        if not 0 < rating < 9 or (votes < 20 and (not 6.8 <= rating <= 8.6)):
            continue
        if not item.get('BackdropImageTags') or not item.get('ImageTags', {}).get('Logo'):
            continue
        progress = (item.get('UserData') or {}).get('PlaybackPositionTicks') or 0
        try:
            age = now - datetime.fromisoformat(item.get('DateCreated', '').replace('Z', '+00:00')).timestamp()
        except (TypeError, ValueError):
            age = float('inf')
        if item.get('Type') == 'Episode' and item.get('HeroContinuation'):
            reason = 'Continue S%s E%s' % (item.get('ParentIndexNumber', '?'), item.get('IndexNumber', '?'))
            tier = 0
        elif progress > 0:
            reason = 'Continue watching'
            tier = 0
        elif 0 <= age <= 30 * 86400:
            reason = 'New to your library'
            tier = 1
        elif popularity >= 20:
            reason = 'Trending'
            tier = 2
        elif rating >= 7 and (votes >= 200 or votes < 20) and (not (item.get('UserData') or {}).get('Played')):
            reason = 'Highly rated'
            tier = 3
        else:
            continue
        source_rank = {'local': 0, 'cloud': 1, 'iptv': 2}.get(item.get('source'), 3)
        selected.append((tier, source_rank, -popularity, item['Id'], {**item, 'HeroReason': reason, 'HeroVotes': votes}))
    seen = set()
    result = []
    for row in sorted(selected):
        item = row[-1]
        kind = 'Series' if item.get('Type') == 'Episode' else item.get('Type')
        identity = (kind, str(item.get('ProviderIds', {}).get('Tmdb') or item.get('SeriesId') or item['Id']))
        if identity in seen:
            continue
        seen.add(identity)
        result.append(item)
    return result
import hashlib as _rot_hash, random as _rot_random
ROTATION = 3 * 3600
ROTATE_MOVIE_GENRES = ('Action', 'Comedy', 'Thriller', 'Science Fiction', 'Documentary', 'Family', 'Horror', 'Romance', 'Animation', 'Crime', 'Mystery', 'Adventure', 'Fantasy', 'War', 'History', 'Drama', 'Western', 'Music')
ROTATE_SERIES_GENRES = ('Drama', 'Comedy', 'Crime', 'Reality', 'Documentary', 'Kids', 'Animation', 'Mystery', 'Action & Adventure', 'Sci-Fi & Fantasy', 'War & Politics', 'Family', 'Western')

def rotation_seed(user, salt=''):
    window = int(time.time() // ROTATION)
    digest = _rot_hash.sha256(('%s|%s|%s' % (str(user.get('Id', '')).replace('-', ''), window, salt)).encode()).hexdigest()
    return int(digest[:12], 16)

def weighted_order(rows, weight, rng):
    """Efraimidis-Spirakis weighted shuffle: heavier rows tend to come first, but not always."""
    keyed = []
    for row in rows:
        w = max(1e-06, float(weight(row)))
        keyed.append((rng.random() ** (1.0 / w), row))
    keyed.sort(key=lambda pair: -pair[0])
    return [row for _, row in keyed]

def rotate_heroes(heroes, user, salt):
    rng = _rot_random.Random(rotation_seed(user, 'hero|' + salt))
    cont = [h for h in heroes if str(h.get('HeroReason', '')).startswith('Continue')]
    new = [h for h in heroes if h.get('HeroReason') == 'New to your library']
    rest = [h for h in heroes if h not in cont and h not in new]
    weight = lambda h: 1.0 + math.log1p(max(0, int(h.get('HeroVotes') or 0))) / 3.0
    picks = weighted_order(rest, weight, rng)
    fresh = weighted_order(new, weight, rng)
    order = []
    if fresh:
        order.append(fresh.pop(0))
    order += picks[:2]
    if cont:
        order.insert(rng.randint(0, min(2, len(order))), cont[0])
    order += fresh + picks[2:] + cont[1:2]
    seen = set()
    result = []
    for h in order:
        if h['Id'] in seen:
            continue
        seen.add(h['Id'])
        result.append(h)
    return result
_hero_playable = {}
_hero_cache = {}

def playable_hero(item, user, token, fetch, base):
    key = (_view_key(user), item['Id'])
    cached = _hero_playable.get(key)
    if cached and time.monotonic() - cached[0] < 120:
        return cached[1]
    if item.get('Type') == 'Series':
        q = {'ParentId': item['Id'], 'Recursive': 'true', 'IncludeItemTypes': 'Episode', 'IsMissing': 'false', 'Limit': 0, 'EnableTotalRecordCount': 'true'}
        okay = fetch(base + '/Users/' + user['Id'] + '/Items?' + urlencode(q), token).get('TotalRecordCount', 0) > 0
    elif item.get('IsMissing'):
        okay = False
    elif item.get('MediaSources') or item.get('MediaSourceCount', 0) > 0:
        okay = True
    else:
        row = fetch(base + '/Users/' + user['Id'] + '/Items/' + item['Id'] + '?Fields=MediaSources', token)
        okay = not row.get('IsMissing') and bool(row.get('MediaSources') or row.get('MediaSourceCount', 0) > 0)
    if len(_hero_playable) > 500:
        _hero_playable.clear()
    _hero_playable[key] = (time.monotonic(), okay)
    return okay

def validate_hero_page(page, user, token, fetch, base):
    chosen = []
    for item in page.get('hero', [])[:20]:
        if playable_hero(item, user, token, fetch, base):
            chosen.append(item)
        if len(chosen) >= 5:
            break
    page['hero'] = chosen
    return page

def hero_inventory(kind, parent, genre, user, token, fetch, base):
    scope = {'ParentId': parent} if parent else {}
    if genre:
        scope['Genres'] = genre
    fields = 'ProviderIds,DateCreated,Genres,MediaSources,Path,Tags'
    root = base + '/Users/' + user['Id'] + '/Items'
    common = {'Recursive': 'true', 'IncludeItemTypes': 'Movie,Series' if kind == 'All' else kind, 'Limit': 160, 'Fields': fields, 'ImageTypeLimit': 1, 'EnableUserData': 'true', 'EnableTotalRecordCount': 'false', 'IsMissing': 'false', **scope}
    items = fetch(root + '?' + urlencode({**common, 'SortBy': 'DateCreated', 'SortOrder': 'Descending'}), token).get('Items', [])
    items += fetch(root + '?' + urlencode({**common, 'Limit': 80, 'MinCommunityRating': 6.5, 'SortBy': 'CommunityRating,DateCreated', 'SortOrder': 'Descending'}), token).get('Items', [])
    offset = 80 + rotation_seed(user, 'hero-offset|' + kind) % 600
    items += fetch(root + '?' + urlencode({**common, 'Limit': 60, 'StartIndex': offset, 'MinCommunityRating': 6.5, 'SortBy': 'CommunityRating,DateCreated', 'SortOrder': 'Descending'}), token).get('Items', [])
    if kind != 'Series':
        q = {'Limit': 40, 'IncludeItemTypes': 'Movie', 'Fields': fields, **scope}
        items += [i for i in fetch(root + '/Resume?' + urlencode(q), token).get('Items', []) if i.get('Type') == 'Movie']
    episodes = []
    if kind != 'Movie':
        q = {'UserId': user['Id'], 'Limit': 40, 'EnableResumable': 'true', 'EnableRewatching': 'false', 'Fields': fields}
        episodes = fetch(base + '/Shows/NextUp?' + urlencode(q), token).get('Items', [])
        ids = sorted({str(e.get('SeriesId')) for e in episodes if e.get('SeriesId')})
        if ids:
            items += fetch(root + '?' + urlencode({**common, 'Ids': ','.join(ids), 'Limit': 40}), token).get('Items', [])
    by = {i['Id']: i for i in items if i.get('Id') and (kind == 'All' or i.get('Type') == kind) and (not genre or genre in i.get('Genres', []))}
    sources = _source_map()
    return ([{**i, 'source': sources.get(i['Id'], _default_source(i))} for i in by.values()], episodes)

def library_heroes(query, user, token, fetch, base):
    kind = query.get('type', ['All'])[0]
    if kind not in ('All', 'Movie', 'Series'):
        raise ValueError('Invalid hero type')
    parent = query.get('parent', [''])[0]
    genre = query.get('genre', [''])[0]
    if parent and (len(parent) > 36 or not all((c in '0123456789abcdefABCDEF-' for c in parent))):
        raise ValueError('Invalid parent')
    key = (_view_key(user), kind, parent, genre, int(time.time() // ROTATION))
    cached = _hero_cache.get(key)
    if cached and time.monotonic() - cached[0] < 30:
        return cached[1]
    metadata = {}
    for provider in sorted(PROVIDERS):
        try:
            for e in json.loads((ROOT / (provider + '.json')).read_text()).get('entries', []):
                if e.get('id') not in metadata or int(e.get('votes') or 0) > int(metadata[e['id']].get('votes') or 0):
                    metadata[e['id']] = e
        except (OSError, ValueError, TypeError):
            continue
    items, next_rows = hero_inventory(kind, parent, genre, user, token, fetch, base)
    if kind != 'Movie':
        series = {i['Id'].replace('-', ''): i for i in items if i.get('Type') == 'Series'}
        for episode in next_rows:
            parent_item = series.get(str(episode.get('SeriesId', '')).replace('-', ''))
            if not parent_item or not episode.get('MediaSources') or episode.get('IsMissing'):
                continue
            e = {**episode, 'ProviderIds': parent_item.get('ProviderIds', {}), 'CommunityRating': parent_item.get('CommunityRating'), 'BackdropImageTags': parent_item.get('BackdropImageTags', []), 'ImageTags': {**episode.get('ImageTags', {}), 'Logo': parent_item.get('ImageTags', {}).get('Logo')}, 'HeroArtId': parent_item['Id'], 'HeroContinuation': True, 'source': parent_item.get('source')}
            m = metadata.get('Series:' + str(parent_item.get('ProviderIds', {}).get('Tmdb')))
            if m:
                metadata['Episode:' + str(e['ProviderIds'].get('Tmdb'))] = m
            items.append(e)
    result = validate_hero_page({'hero': rotate_heroes(hero_candidates(items, metadata, now=time.time()), user, kind + parent + genre)[:20], 'policy': 'playable-art-rating-reason-v1', 'vote_floor': 20}, user, token, fetch, base)
    if len(_hero_cache) > 32:
        _hero_cache.clear()
    if result['hero']:
        _hero_cache[key] = (time.monotonic(), result)
    return result
import math
_curation_metadata_cache = None
CURATED_MOVIE_GENRES = ('Action', 'Comedy', 'Thriller', 'Science Fiction', 'Documentary', 'Family')
CURATED_SERIES_GENRES = ('Drama', 'Comedy', 'Crime', 'Reality', 'Documentary', 'Kids')

def _curation_metadata():
    global _curation_metadata_cache
    files = [ROOT / (provider + '.json') for provider in sorted(PROVIDERS)]
    stamp = tuple(((str(p), p.stat().st_mtime_ns) for p in files if p.exists()))
    if _curation_metadata_cache and _curation_metadata_cache[0] == stamp:
        return _curation_metadata_cache[1]
    metadata = {}
    for name, mtime in stamp:
        for entry in json.loads(Path(name).read_text()).get('entries', []):
            try:
                votes = int(entry.get('votes') or 0)
                rating = float(entry.get('rating') or 0)
            except (TypeError, ValueError, OverflowError):
                continue
            if votes < 50 or not math.isfinite(rating) or (not 0 < rating <= 10):
                continue
            previous = metadata.get(entry.get('id'))
            if previous is None or votes > previous['votes']:
                metadata[entry.get('id')] = {'rating': rating, 'votes': votes, 'genres': [GENRES[g] for g in entry.get('genres', []) if g in GENRES]}
    _curation_metadata_cache = (stamp, metadata)
    return metadata

def _curation_score(rating, votes):
    return (rating * votes + 6.8 * 500) / (votes + 500)

def curated_library(query, user, token, fetch, base):
    value = lambda name, default='': query.get(name, [default])[0]
    kind = value('type', 'All')
    if kind not in ('All', 'Movie', 'Series'):
        raise ValueError('Invalid curated kind')
    genres = [g for g in value('genre').split('|') if g]
    if len(genres) > 20 or any((g not in GENRES.values() for g in genres)):
        raise ValueError('Invalid curated genre')
    watch = value('watch')
    favorite = value('favorite')
    minimum = value('rating')
    decades = [d for d in value('decade').split('|') if d]
    if watch not in ('', 'yes', 'no') or favorite not in ('', '1') or minimum not in ('', '6', '7', '8'):
        raise ValueError('Invalid curated filter')
    if any((d not in ('1900', '1980', '1990', '2000', '2010', '2020') for d in decades)):
        raise ValueError('Invalid curated decade')
    limit = max(1, min(24, int(value('limit', '24'))))
    metadata = _curation_metadata()
    items = inventory(user, token, fetch, base)
    candidates = []
    seen = set()
    for item in items:
        item_kind = item.get('Type')
        tmdb = item.get('ProviderIds', {}).get('Tmdb')
        key = item_kind + ':' + str(tmdb) if item_kind in ('Movie', 'Series') else ''
        m = metadata.get(key)
        if not m or key in seen or (kind != 'All' and item_kind != kind):
            continue
        actual_genres = m['genres'] or item.get('Genres', [])
        if genres and (not any((g in actual_genres for g in genres))):
            continue
        ud = item.get('UserData') or {}
        year = int(item.get('ProductionYear') or 0)
        if watch and bool(ud.get('Played')) != (watch == 'yes'):
            continue
        if favorite and (not ud.get('IsFavorite')):
            continue
        if minimum and m['rating'] < int(minimum):
            continue
        if decades and (not any((int(d) <= year <= (1979 if d == '1900' else int(d) + 9) for d in decades))):
            continue
        if not item.get('ImageTags', {}).get('Primary'):
            continue
        seen.add(key)
        candidates.append((item, m, actual_genres, _curation_score(m['rating'], m['votes'])))
    rows = []
    used = set()
    kinds = ('Movie', 'Series') if kind == 'All' else (kind,)
    for current in kinds:
        rotating = list(ROTATE_MOVIE_GENRES if current == 'Movie' else ROTATE_SERIES_GENRES)
        _rot_random.Random(rotation_seed(user, 'genres|' + current)).shuffle(rotating)
        row_genres = (None,) + (tuple(rotating[:4]) if kind == 'All' and (not genres) else ())
        for genre in row_genres:
            pool = [e for e in candidates if e[0]['Type'] == current and (not genre or genre in e[2]) and (genre is not None or watch or (not (e[0].get('UserData') or {}).get('Played')))]
            pool.sort(key=lambda e: (-(e[3] - (0.22 if e[0]['Id'] in used else 0)), e[0].get('Name', '').casefold(), e[0]['Id']))
            top = [e for e in pool[:max(limit * 5, 60)] if e[0]['Id'] not in used] or pool[:max(limit * 5, 60)]
            rng = _rot_random.Random(rotation_seed(user, 'row|' + current + '|' + str(genre) + '|' + watch + favorite + minimum + '|'.join(decades)))
            selected = sorted(weighted_order(top, lambda e: max(0.05, e[3] - 5.5) ** 2, rng)[:limit], key=lambda e: -e[3])
            rows.append({'key': current + (':' + genre if genre else ''), 'items': [{'Id': e[0]['Id'], 'rating': e[1]['rating'], 'votes': e[1]['votes']} for e in selected]})
            used.update((e[0]['Id'] for e in selected))
    return {'view': 'curated', 'policy': 'catalogue-votes-weighted-v1', 'vote_floor': 50, 'rows': rows}
