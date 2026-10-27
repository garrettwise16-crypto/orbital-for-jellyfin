"""Pregame preview for the game center (Claude, Sept 24, 2026).

Replaces "Tracking unavailable" before a game starts with real, public ESPN data only:
records, last five, probable starters (MLB/NHL), series, season leaders, injuries, ESPN's
own Matchup Predictor (labelled as such), venue + photo, weather, broadcasts, and news
about the two teams. Betting/odds/fantasy content is excluded. Missing parts are omitted,
never guessed. Cached per event (PREVIEW_TTL) and per team for news (NEWS_TTL).
"""
import copy, re, threading, time

PREVIEW_TTL = 600
NEWS_TTL = 1800
MAX_NEWS = 4
EXCLUDE = re.compile(r'\b(bet|bets|betting|odds|line|lines|spread|parlay|props?|picks?|fantasy|dfs|sportsbook|wager)\b', re.I)
PATHS = {'MLB': 'baseball/mlb', 'NFL': 'football/nfl', 'College football': 'football/college-football',
         'NBA': 'basketball/nba', 'WNBA': 'basketball/wnba', 'NHL': 'hockey/nhl', 'MLS': 'soccer/usa.1'}
WEATHER = {'1': 'Sunny', '2': 'Mostly sunny', '3': 'Partly sunny', '4': 'Intermittent clouds', '5': 'Hazy sunshine',
           '6': 'Mostly cloudy', '7': 'Cloudy', '8': 'Overcast', '11': 'Fog', '12': 'Showers', '13': 'Mostly cloudy, showers',
           '14': 'Partly sunny, showers', '15': 'Thunderstorms', '18': 'Rain', '33': 'Clear', '34': 'Mostly clear',
           '35': 'Partly cloudy', '36': 'Intermittent clouds', '38': 'Mostly cloudy'}
_cache, _news, _lock = {}, {}, threading.Lock()


def _img(url):
    return url if isinstance(url, str) and url.startswith('https://a.espncdn.com/') else None


def _txt(v, limit=240):
    return str(v).strip()[:limit] if v not in (None, '') else None


def _team_news(league, team_id, get_json):
    key = (league, team_id)
    with _lock:
        hit = _news.get(key)
        if hit and time.time() - hit[0] < NEWS_TTL:
            return hit[1]
    try:
        data = get_json(f'https://site.api.espn.com/apis/site/v2/sports/{PATHS[league]}/news?team={team_id}&limit=8')
        items = []
        for a in data.get('articles') or []:
            head = _txt(a.get('headline'), 160)
            if not head or EXCLUDE.search(head + ' ' + (a.get('description') or '')):
                continue
            img = next((_img(i.get('url')) for i in a.get('images') or [] if _img(i.get('url'))), None)
            items.append({'headline': head, 'description': _txt(a.get('description'), 220),
                          'published': a.get('published'), 'image': img, 'type': a.get('type')})
    except Exception:
        items = []
    with _lock:
        _news[key] = (time.time(), items)
    return items


def _this_season(games):
    def day(g):
        try:
            return _dt.datetime.fromisoformat(str(g.get('date') or '').replace('Z', '+00:00'))
        except ValueError:
            return None
    dated = [(day(g), g) for g in games]
    if not dated or any(d is None for d, _ in dated):
        return games
    dated.sort(key=lambda x: x[0], reverse=True)          # newest first
    kept = [dated[0]]
    for d, g in dated[1:]:
        if (kept[-1][0] - d).days > 100:
            break
        kept.append((d, g))
    return [g for _, g in sorted(kept, key=lambda x: x[0])]


def _played(record):
    """Games in a record like '12-8-6' or '87-75'; None when the record is missing or unreadable."""
    parts = re.findall(r'\d+', str(record or ''))
    return sum(int(x) for x in parts) if record and re.fullmatch(r'\s*\d+(?:\s*-\s*\d+){1,2}\s*', str(record)) else None


def build(league, event_id, get_json):
    s = get_json(f'https://site.api.espn.com/apis/site/v2/sports/{PATHS[league]}/summary?event={event_id}')
    comp = ((s.get('header') or {}).get('competitions') or [{}])[0]
    out = {'event_id': str(event_id), 'league': league, 'source': 'ESPN', 'teams': [], 'fetched_at': time.time()}
    status = (comp.get('status') or {}).get('type') or {}
    out['state'] = status.get('state')
    ids = {}
    for c in comp.get('competitors') or []:
        t = c.get('team') or {}
        side = c.get('homeAway')
        ids[str(t.get('id'))] = side
        records = {r.get('type') or r.get('name'): r.get('summary') or r.get('displayValue') for r in c.get('record') or []}
        logo = next((_img(l.get('href')) for l in t.get('logos') or [] if _img(l.get('href'))), None) or _img(t.get('logo'))
        out['teams'].append({'side': side, 'id': str(t.get('id')), 'name': t.get('displayName'), 'short': t.get('shortDisplayName') or t.get('name'),
                             'abbr': t.get('abbreviation'), 'logo': logo, 'color': t.get('color'), 'alt': t.get('alternateColor'),
                             'record': records.get('total') or records.get('overall') or next(iter(records.values()), None),
                             'split': records.get('home') if side == 'home' else records.get('road') or records.get('away')})
    out['teams'].sort(key=lambda t: t['side'] != 'away')          # away first, like the header
    # Probable starters (MLB pitchers; NHL goalies come as "goalies" in the summary).
    starters = []
    for c in comp.get('competitors') or []:
        for p in c.get('probables') or []:
            a = p.get('athlete') or {}
            raw = p.get('statistics') or []
            if isinstance(raw, dict):                     # summary shape: {'splits': {'categories': [...]}}
                raw = (raw.get('splits') or {}).get('categories') or []
            stats = {st.get('abbreviation'): st.get('displayValue') for st in raw if isinstance(st, dict)}
            line = ', '.join(x for x in ((f"{stats['W']}-{stats['L']}" if 'W' in stats and 'L' in stats else None),
                                         (stats.get('ERA') and stats['ERA'] + ' ERA'),
                                         (stats.get('K') and stats['K'] + ' K'),
                                         (stats.get('WHIP') and stats['WHIP'] + ' WHIP')) if x)
            if a.get('displayName'):
                starters.append({'side': c.get('homeAway'), 'name': a['displayName'], 'role': 'Probable pitcher' if league == 'MLB' else 'Probable',
                                 'headshot': _img((a.get('headshot') or {}).get('href') if isinstance(a.get('headshot'), dict) else a.get('headshot')),
                                 'line': line or None})
    if starters:
        out['starters'] = sorted(starters, key=lambda x: x['side'] != 'away')
    # Series (MLB/NBA/NHL) and last five.
    series = next((x for x in s.get('seasonseries') or [] if x.get('type') == 'current'), None) or next(iter(s.get('seasonseries') or []), None)
    if series and _txt(series.get('summary')):
        out['series'] = {'title': _txt(series.get('title') or 'Season series', 60), 'summary': _txt(series.get('summary'), 80)}
    last = []
    for x in s.get('lastFiveGames') or []:
        side = ids.get(str((x.get('team') or {}).get('id')))
        games = [{'result': g.get('gameResult'), 'score': _txt(g.get('score'), 20),
                  'opponent': _txt((g.get('opponent') or {}).get('abbreviation'), 8), 'at': g.get('atVs'), 'date': _txt(g.get('gameDate'), 30)}
                 for g in x.get('events') or [] if g.get('gameResult')]
        # Sept 29 (G8): only THIS season. ESPN's last five can reach back into last season (Texas Tech 4-0 showed L W W W W);
        # a gap of more than 100 days between consecutive games is the season boundary in every league we carry.
        games = _this_season(games)
        played = _played(next((t.get('record') for t in out['teams'] if t['side'] == side), None))
        if played is not None:
            games = games[-played:] if played else []   # preseason games are not in the record
        if side and games:
            last.append({'side': side, 'games': games[-5:]})
    if last:
        out['last_five'] = sorted(last, key=lambda x: x['side'] != 'away')
    # Season leaders (per team, top 3 categories).
    leaders = []
    for team in s.get('leaders') or []:
        side = ids.get(str((team.get('team') or {}).get('id')))
        rows = []
        for cat in (team.get('leaders') or [])[:3]:
            top = (cat.get('leaders') or [{}])[0]
            a = top.get('athlete') or {}
            if a.get('displayName') and top.get('displayValue'):
                rows.append({'category': _txt(cat.get('displayName') or cat.get('name'), 40), 'name': a['displayName'],
                             'value': _txt(top.get('displayValue'), 60),
                             'headshot': _img((a.get('headshot') or {}).get('href') if isinstance(a.get('headshot'), dict) else a.get('headshot'))})
        if side and rows:
            leaders.append({'side': side, 'rows': rows})
    if leaders:
        out['leaders'] = sorted(leaders, key=lambda x: x['side'] != 'away')
    # Injuries (top 3 per team).
    injuries = []
    for team in s.get('injuries') or []:
        side = ids.get(str((team.get('team') or {}).get('id')))
        rows = [{'name': (i.get('athlete') or {}).get('displayName'), 'status': _txt(i.get('status'), 30),
                 'detail': _txt((i.get('details') or {}).get('type'), 40)} for i in (team.get('injuries') or [])[:3]
                if (i.get('athlete') or {}).get('displayName')]
        if side and rows:
            injuries.append({'side': side, 'rows': rows})
    if injuries:
        out['injuries'] = sorted(injuries, key=lambda x: x['side'] != 'away')
    # ESPN Matchup Predictor (ESPN's own projection; shown with its name, never as odds).
    pred = s.get('predictor') or {}
    try:
        home = float((pred.get('homeTeam') or {}).get('gameProjection'))
        away = float((pred.get('awayTeam') or {}).get('gameProjection'))
        if 0 <= home <= 100 and 0 <= away <= 100:
            out['predictor'] = {'label': 'ESPN Matchup Predictor', 'home': round(home, 1), 'away': round(away, 1)}
    except (TypeError, ValueError):
        pass
    info = s.get('gameInfo') or {}
    venue = info.get('venue') or {}
    if venue.get('fullName'):
        addr = venue.get('address') or {}
        img = next((_img(i.get('href')) for i in venue.get('images') or [] if _img(i.get('href'))), None)
        out['venue'] = {'name': venue['fullName'], 'city': ', '.join(x for x in (addr.get('city'), addr.get('state')) if x) or None, 'image': img}
    w = info.get('weather') or {}
    if isinstance(w.get('temperature'), (int, float)):
        out['weather'] = {'temperature': w['temperature'], 'condition': WEATHER.get(str(w.get('conditionId'))),
                          'precipitation': w.get('precipitation') if isinstance(w.get('precipitation'), (int, float)) else None}
    names = [n for b in comp.get('broadcasts') or [] for n in ([b.get('media', {}).get('shortName')] if b.get('media') else b.get('names') or []) if n]
    if names:
        out['broadcasts'] = list(dict.fromkeys(names))[:4]
    # News about these two teams (interleaved), betting/fantasy excluded.
    per_team = [_team_news(league, t['id'], get_json) for t in out['teams'] if t.get('id')]
    news, seen = [], set()
    for i in range(MAX_NEWS):
        for items in per_team:
            if i < len(items) and items[i]['headline'] not in seen and len(news) < MAX_NEWS:
                seen.add(items[i]['headline']); news.append(items[i])
    if news:
        out['news'] = news
    return out


def get(league, event_id, get_json):
    if league not in PATHS or not re.fullmatch(r'[0-9]{1,12}', str(event_id)):
        raise ValueError('Invalid preview identity')
    key = (league, str(event_id))
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < PREVIEW_TTL:
            return copy.deepcopy(hit[1])
    value = build(league, event_id, get_json)
    with _lock:
        _cache[key] = (time.time(), value)
        while len(_cache) > 64:
            del _cache[next(iter(_cache))]
    return copy.deepcopy(value)


# ===== Game recap + highlight reels (Claude, Sept 28 2026) =====
# Finished games: our own written game story (from ESPN numbers), team stats, top performers, line score,
# win probability, ESPN clips, the AP recap headline/lede with a link, team-tagged news, and YouTube highlight
# reels found by search (official league/conference/team channels first; each video checked embeddable).
# Team pages: the team's own YouTube channel (archived on disk so older games stay reachable) + recent game reels.
# Every external source is optional: failures leave that section out, never break the page.
import json as _json, os as _os, urllib.parse as _up, urllib.request as _ur, datetime as _dt

RECAP_FRESH, RECAP_SETTLED = 1800, 6 * 3600
YT_FILE = _os.path.join(_os.environ.get('SPORTS_DATA_DIR', '.'), 'highlights-cache.json')
YT_SEARCHES_PER_HOUR = 40
YT_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.8', 'Cookie': 'CONSENT=YES+1'}
OFFICIAL = {'MLB': {'MLB'}, 'NFL': {'NFL'}, 'NBA': {'NBA'}, 'WNBA': {'WNBA'}, 'NHL': {'NHL'}, 'MLS': {'Major League Soccer', 'MLS'},
            'College football': {'Big 12 Conference', 'SEC', 'SEC Network', 'ACC Digital Network', 'ACC Network', 'Big Ten Network',
                                 'NCAA Championships', 'ESPN College Football', 'Mountain West Conference', 'The American',
                                 'Sun Belt Conference', 'Conference USA', 'MACSports', 'CBS Sports College Football', 'FOX College Football',
                                 'Big Ten', 'ACC'}}
TEAM_CHANNELS = {('College football', '2641'): 'UCeGcdO4Xell4mdc_RLIjEew'}   # Texas Tech Red Raiders (official athletics)
SPORT_WORD = {'College football': 'football'}
BLOCK = re.compile(r'\b(preseason|reaction|reacts?|live ?stream|streaming|predictions?|preview|picks|odds|bet|betting|madden|'
                   r'simulation|sim|mlb[\s-]*the[\s-]*show(?:\s*\d{2,4})?|podcast|rumou?rs?|trailer|mock|ranking the|every team|all 30|top \d+ plays of the (week|season))\b', re.I)
FAN = re.compile(r'\b(fan|fans|talk|nation|report|playback|radio|show|podcast|breakdown|reacts?)\b', re.I)
OTHER_SPORTS = {'football': r'basketball|baseball|softball|soccer|volleyball|hockey|wrestling|lacrosse|tennis|golf|track',
                'basketball': r'football|baseball|softball|soccer|volleyball|hockey', 'baseball': r'football|basketball|softball|soccer|hockey',
                'hockey': r'football|basketball|baseball|soccer', 'soccer': r'football|basketball|baseball|hockey|volleyball'}
MONTHS = 'january february march april may june july august september october november december'.split()
_yt = {'search': {}, 'embed': {}, 'channel': {}, 'archive': {}, 'budget': []}
_yt_lock, _yt_loaded = threading.Lock(), [False]
_recap = {}


def _yt_load():
    if _yt_loaded[0]:
        return
    _yt_loaded[0] = True
    try:
        data = _json.loads(open(YT_FILE, encoding='utf-8').read())
        for k in ('search', 'embed', 'channel', 'archive'):
            if isinstance(data.get(k), dict):
                _yt[k] = data[k]
    except Exception:
        pass


def _yt_save():
    try:
        for key, limit in (('search', 600), ('embed', 3000), ('channel', 300)):
            while len(_yt[key]) > limit:
                del _yt[key][next(iter(_yt[key]))]
        tmp = YT_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(_json.dumps({k: _yt[k] for k in ('search', 'embed', 'channel', 'archive')}))
        _os.replace(tmp, YT_FILE)
    except Exception:
        pass


def _fetch_text(url, limit=4 * 1024 * 1024):
    with _ur.urlopen(_ur.Request(url, headers=YT_HEADERS), timeout=10) as r:
        body = r.read(limit + 1)
    if len(body) > limit:
        raise ValueError('response limit')
    return body.decode('utf-8', 'replace')


def _initial_data(html):
    m = re.search(r'var ytInitialData = (\{.*?\});</script>', html, re.S)
    return _json.loads(m.group(1)) if m else {}


def _walk(x, key, out):
    if isinstance(x, dict):
        if key in x:
            out.append(x[key])
        for v in x.values():
            _walk(v, key, out)
    elif isinstance(x, list):
        for v in x:
            _walk(v, key, out)
    return out


def _runs(t):
    return ''.join(r.get('text', '') for r in (t or {}).get('runs', [])) or (t or {}).get('simpleText') or ''


def _age_seconds(text):
    # YouTube writes both '1 day ago' and '1d ago' / '3mo ago' / '2y ago'.
    m = re.search(r'(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|mo|s|m|h|d|w|y)\b', text or '')
    if not m:
        return None
    unit = m.group(2)
    unit = 'mo' if unit.startswith('mo') else unit[0]
    return int(m.group(1)) * {'s': 1, 'm': 60, 'h': 3600, 'd': 86400, 'w': 604800, 'mo': 2592000, 'y': 31536000}[unit]


def _budget_ok():
    now = time.time()
    _yt['budget'] = [t for t in _yt['budget'] if now - t < 3600]
    if len(_yt['budget']) >= YT_SEARCHES_PER_HOUR:
        return False
    _yt['budget'].append(now)
    return True


def yt_search(query, ttl, kind='video'):
    """YouTube results page (no API key). Cached in memory and on disk; bounded to YT_SEARCHES_PER_HOUR."""
    key = kind + ':' + query.lower()
    with _yt_lock:
        _yt_load()
        hit = _yt['search'].get(key)
        if hit and time.time() - hit['at'] < ttl:
            return hit['items']
        if not _budget_ok():
            return hit['items'] if hit else []
    sp = 'EgIQAg%3D%3D' if kind == 'channel' else 'EgIQAQ%3D%3D'
    try:
        data = _initial_data(_fetch_text('https://www.youtube.com/results?search_query=' + _up.quote_plus(query) + '&sp=' + sp))
    except Exception:
        return hit['items'] if hit else []
    items = []
    if kind == 'channel':
        for c in _walk(data, 'channelRenderer', []):
            items.append({'id': c.get('channelId'), 'title': _runs(c.get('title')),
                          'verified': 'VERIFIED' in _json.dumps(c.get('ownerBadges', []))})
    else:
        now = time.time()
        for v in _walk(data, 'videoRenderer', []):
            vid = v.get('videoId')
            if not vid or not re.fullmatch(r'[A-Za-z0-9_-]{11}', vid):
                continue
            owner = (v.get('ownerText') or {}).get('runs') or [{}]
            age = _age_seconds(_runs(v.get('publishedTimeText')))
            items.append({'id': vid, 'title': _runs(v.get('title'))[:200], 'channel': owner[0].get('text', '')[:80],
                          'channel_id': owner[0].get('navigationEndpoint', {}).get('browseEndpoint', {}).get('browseId'),
                          'verified': 'VERIFIED' in _json.dumps(v.get('ownerBadges', [])),
                          'duration': _runs(v.get('lengthText')) or None, 'published_est': now - age if age is not None else None,
                          'live': 'LIVE' in _json.dumps(v.get('badges', []))})
    with _yt_lock:
        _yt['search'][key] = {'at': time.time(), 'items': items[:25]}
        _yt_save()
    return items[:25]


def yt_embeddable(vid):
    with _yt_lock:
        _yt_load()
        hit = _yt['embed'].get(vid)
        if hit is not None and time.time() - hit['at'] < 7 * 86400:
            return hit['ok']
    try:
        with _ur.urlopen(_ur.Request('https://www.youtube.com/oembed?format=json&url=' + _up.quote('https://www.youtube.com/watch?v=' + vid),
                                     headers=YT_HEADERS), timeout=6) as r:
            ok = r.status == 200
    except Exception as e:
        ok = False if getattr(e, 'code', None) in (401, 403, 404) else None
    if ok is not None:
        with _yt_lock:
            _yt['embed'][vid] = {'at': time.time(), 'ok': ok}
    return ok is not False


def _video(item, source):
    return {'kind': 'youtube', 'id': item['id'], 'title': item['title'], 'channel': item.get('channel'), 'duration': item.get('duration'),
            'thumb': 'https://i.ytimg.com/vi/' + item['id'] + '/hqdefault.jpg', 'official': source,
            'published': item.get('published') or (_dt.datetime.fromtimestamp(item['published_est'], _dt.timezone.utc).isoformat() if item.get('published_est') else None)}


def _names(team):
    names = {team.get(k) for k in ('name', 'short', 'location', 'nickname') if team.get(k)}
    if team.get('abbr') and len(team['abbr']) >= 3 and team.get('pro'):
        names.add(team['abbr'])
    return {n for n in names if len(n) >= 3}


def _mentions(title, team):
    t = title.lower()
    return any(re.search(r'(?<![a-z])' + re.escape(n.lower()) + r'(?![a-z])', t) for n in _names(team))


def _dates_in(title):
    t = title.lower()
    found = set()
    for i, m in enumerate(MONTHS):
        for d in re.findall(r'\b(?:' + m + '|' + m[:3] + r')\.?\s+(\d{1,2})\b', t):
            found.add((i + 1, int(d)))
    for mo, d in re.findall(r'\b(\d{1,2})/(\d{1,2})(?:/\d{2,4})?\b', t):
        if 1 <= int(mo) <= 12:
            found.add((int(mo), int(d)))
    return found


def game_highlights(league, away, home, start_iso, limit=6):
    """Highlight reels for one game, best first. Titles must name both teams (or be the team's own upload naming
    the opponent), be a highlight/recap, not dated to another day, and be published after kickoff."""
    try:
        start = _dt.datetime.fromisoformat(start_iso.replace('Z', '+00:00'))
    except Exception:
        return []
    local = start.astimezone(_dt.timezone(_dt.timedelta(hours=-5)))
    day = (local.month, local.day)
    age_days = (time.time() - start.timestamp()) / 86400
    if age_days < -0.1:
        return []
    ttl = 3 * 3600 if age_days < 3 else 7 * 86400
    series = league in ('MLB', 'NBA', 'WNBA', 'NHL')
    word = lambda t: t['short'] if league == 'College football' else (t.get('nickname') or t['short'])
    queries = [f"{word(away)} vs {word(home)} highlights" + (f" {MONTHS[day[0]-1].title()} {day[1]}" if series else '')]
    own = {TEAM_CHANNELS.get((league, str(t['id']))) for t in (away, home)} - {None}
    picked, seen = [], set()
    for q in queries:
        for it in yt_search(q, ttl):
            if it['id'] in seen or it.get('live'):
                continue
            title = it['title']
            if BLOCK.search(title):
                continue
            sport = SPORT.get(league)
            if sport and re.search(r'\b(' + OTHER_SPORTS[sport] + r')\b', title, re.I) and not (sport == 'soccer' and 'football' in title.lower()):
                continue
            years = {int(y) for y in re.findall(r'\b(20\d\d)\b', title)} | {2000 + int(y) for y in re.findall(r'\b20\d\d[-/](\d\d)\b', title)}
            if years and not years & {local.year, local.year - 1 if local.month < 7 else local.year + 1}:
                continue
            if years and league in ('NFL', 'College football', 'MLB', 'WNBA', 'MLS') and local.year not in years:
                continue
            dates = _dates_in(title)
            if dates and day not in dates:
                continue
            if it.get('published_est') and it['published_est'] < start.timestamp() - 6 * 3600:
                continue
            if age_days > 45 and it.get('published_est') and it['published_est'] > start.timestamp() + 60 * 86400:
                continue
            both = _mentions(title, away) and _mentions(title, home)
            is_own = it.get('channel_id') in own and (_mentions(title, away) or _mentions(title, home))
            if not (both or is_own):
                continue
            if not re.search(r'highlight|recap|condensed|every (touchdown|goal|run)|all (touchdowns|goals)', title, re.I) and not is_own:
                continue
            official = 'league' if it['channel'] in OFFICIAL.get(league, ()) else 'team' if is_own else 'verified' if it['verified'] else None
            if not official:
                continue
            seen.add(it['id'])
            rank = {'league': 0, 'team': 1, 'verified': 2}[official] + (0.5 if 'extended' in title.lower() else 0)
            picked.append((rank, len(picked), it, official))
    out = []
    for _, _, it, official in sorted(picked):
        if len(out) >= limit:
            break
        if yt_embeddable(it['id']):
            out.append(_video(it, official))
    return out


def _feed(url):
    xml = _fetch_text(url, 2 * 1024 * 1024)
    items = []
    for entry in re.findall(r'<entry>(.*?)</entry>', xml, re.S):
        vid = re.search(r'<yt:videoId>([A-Za-z0-9_-]{11})</yt:videoId>', entry)
        title = re.search(r'<title>(.*?)</title>', entry, re.S)
        pub = re.search(r'<published>(.*?)</published>', entry)
        author = re.search(r'<author>\s*<name>(.*?)</name>', entry, re.S)
        if vid and title:
            import html as _h
            items.append({'id': vid.group(1), 'title': _h.unescape(title.group(1)).strip()[:200], 'published': pub.group(1) if pub else None,
                          'channel': _h.unescape(author.group(1)).strip()[:80] if author else None})
    return items


def team_channel(league, team):
    key = league + '~' + str(team['id'])
    if (league, str(team['id'])) in TEAM_CHANNELS:
        return TEAM_CHANNELS[(league, str(team['id']))]
    with _yt_lock:
        _yt_load()
        hit = _yt['channel'].get(key)
        if hit and time.time() - hit['at'] < (30 if hit.get('id') else 7) * 86400:
            return hit.get('id')
    q = team['name'] if league != 'College football' else team['short'] + ' ' + team.get('nickname', '') + ' athletics'
    found = None
    for c in yt_search(q.strip(), 30 * 86400, kind='channel'):
        title = c['title'].lower()
        if FAN.search(title) or (team.get('location') or team['short']).lower() not in title:
            continue
        if team.get('nickname', '').lower() in title or 'athletic' in title or team['name'].lower() == title:
            found = c['id']
            break
    with _yt_lock:
        _yt['channel'][key] = {'at': time.time(), 'id': found}
        _yt_save()
    return found


def team_videos(league, team, limit=16):
    cid = team_channel(league, team)
    if not cid or not re.fullmatch(r'UC[A-Za-z0-9_-]{22}', cid):
        return {'channel': None, 'videos': []}
    with _yt_lock:
        _yt_load()
        arch = _yt['archive'].setdefault(cid, {'at': 0, 'items': []})
        fresh = time.time() - arch['at'] < 1800
    if not fresh:
        try:
            got = _feed('https://www.youtube.com/feeds/videos.xml?channel_id=' + cid)
            with _yt_lock:
                named = {v['id']: v.get('channel') for v in got}
                for v in arch['items']:
                    v['channel'] = v.get('channel') or named.get(v['id'])
                known = {v['id'] for v in arch['items']}
                arch['items'] = sorted([v for v in got if v['id'] not in known] + arch['items'], key=lambda v: v.get('published') or '', reverse=True)[:300]
                arch['at'] = time.time()
                _yt_save()
        except Exception:
            pass
    word = SPORT_WORD.get(league)
    shorts = lambda t: '#shorts' in t.lower() or t.count('#') >= 2        # vertical Shorts clutter the reel row
    items, titles = [], set()
    for v in arch['items']:                 # newest first; channels sometimes re-upload the same video under the same title
        norm = re.sub(r'[^a-z0-9]+', ' ', v['title'].lower()).strip()
        if (word and word not in v['title'].lower()) or shorts(v['title']) or norm in titles:
            continue
        titles.add(norm); items.append(v)
    return {'channel': cid, 'videos': [_video(v, 'team') for v in items[:limit]]}


def _num(v):
    try:
        f = float(str(v).replace(',', ''))
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


TEAM_STAT_KEYS = {
    'football': ['totalYards', 'netPassingYards', 'rushingYards', 'firstDowns', 'thirdDownEff', 'turnovers', 'totalPenaltiesYards', 'possessionTime'],
    'basketball': ['fieldGoalPct', 'threePointFieldGoalPct', 'freeThrowPct', 'totalRebounds', 'assists', 'turnovers', 'steals', 'blocks'],
    'hockey': ['shotsTotal', 'powerPlayGoals', 'powerPlayOpportunities', 'faceoffPercent', 'hits', 'blockedShots', 'takeaways', 'giveaways'],
    'baseball': ['hits', 'runs', 'homeRuns', 'RBIs', 'walks', 'strikeouts', 'errors', 'leftOnBase'],
    'soccer': ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'yellowCards', 'saves', 'offsides']}
SPORT = {'NFL': 'football', 'College football': 'football', 'NBA': 'basketball', 'WNBA': 'basketball', 'NHL': 'hockey', 'MLB': 'baseball', 'MLS': 'soccer'}
REGULATION = {'football': 4, 'basketball': 4, 'hockey': 3, 'baseball': 9, 'soccer': 2}
PERIOD = {'football': 'quarter', 'basketball': 'quarter', 'hockey': 'period', 'baseball': 'inning', 'soccer': 'half'}


def _ordinal(n):
    return str(n) + ('th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th'))


def _flat_stats(team_box):
    out = {}
    for s in team_box.get('statistics') or []:
        if isinstance(s.get('stats'), list):
            for x in s['stats']:
                if x.get('name') and x.get('displayValue') is not None:
                    out.setdefault(x['name'], (x.get('label') or x.get('abbreviation') or x['name'], x['displayValue']))
        elif s.get('name') and s.get('displayValue') is not None:
            out[s['name']] = (s.get('label') or s['name'], s['displayValue'])
    return out


def _story(sport, teams, plays, info, pro=True):
    """Plain, factual sentences built only from the game's numbers.
    Sept 29 (G7): pro nicknames take "the" ("the Chiefs"), college names do not ("Texas Tech"); the verb follows the margin."""
    def n(t, start=False):
        name = t['short']
        if not pro or not name:
            return name
        return ('The ' if start else 'the ') + name

    if len(teams) != 2 or any(t['score'] is None for t in teams):
        return []
    w, l = sorted(teams, key=lambda t: -t['score'])
    if w['score'] == l['score']:
        return [f"{n(w, True)} and {n(l)} tied {w['score']}–{l['score']}."]
    periods = max(len(t['linescores']) for t in teams)
    extra = ''
    if periods > REGULATION[sport]:
        extra = f' in {periods} innings' if sport == 'baseball' else ' in a shootout' if 'SO' in (info.get('detail') or '') else ' in overtime'
    where = 'at home' if w['home'] else 'on the road'
    margin = w['score'] - l['score']
    big = {'football': 21, 'basketball': 20, 'hockey': 4, 'baseball': 7, 'soccer': 3}[sport]
    close = {'football': 3, 'basketball': 3, 'hockey': 1, 'baseball': 1, 'soccer': 1}[sport]
    verb = 'routed' if margin >= big else 'edged' if margin <= close else 'beat'
    s = [f"{n(w, True)} {verb} {n(l)} {w['score']}–{l['score']} {where}{extra}."]
    # Flow from each scoring play (running score), else from period totals.
    run = [(p['away'], p['home']) for p in plays if p.get('away') is not None and p.get('home') is not None]
    if not run:
        a = h = 0
        for i in range(periods):
            a += _num((teams[0] if not teams[0]['home'] else teams[1])['linescores'][i] if i < len((teams[0] if not teams[0]['home'] else teams[1])['linescores']) else 0) or 0
            h += _num((teams[0] if teams[0]['home'] else teams[1])['linescores'][i] if i < len((teams[0] if teams[0]['home'] else teams[1])['linescores']) else 0) or 0
            run.append((a, h))
    sign = 1 if w['home'] else -1
    margins = [sign * (h - a) for a, h in run]
    worst = min(margins + [0])
    changes = sum(1 for x, y in zip(margins, margins[1:]) if x and y and (x > 0) != (y > 0))
    thresholds = {'football': 10, 'basketball': 12, 'hockey': 2, 'baseball': 3, 'soccer': 1}
    if worst <= -thresholds[sport]:
        s.append(f"{n(w, True)} came back from {-worst} down.")
    elif worst == 0 and margins and max(margins) > 0:
        s.append(f"{n(w, True)} never trailed.")
    elif changes >= 3:
        s.append(f"The lead changed hands {changes} times.")
    if sport in ('football', 'basketball') and all(len(t['linescores']) >= 2 for t in teams):
        wh = sum(_num(x) or 0 for x in w['linescores'][:2]); lh = sum(_num(x) or 0 for x in l['linescores'][:2])
        s.append(f"It was tied {wh}–{lh} at halftime." if wh == lh else f"{n(w if wh > lh else l, True)} led {max(wh, lh)}–{min(wh, lh)} at halftime.")
    best, best_p = 0, None
    for i in range(min(len(w['linescores']), len(l['linescores']))):
        d = (_num(w['linescores'][i]) or 0) - (_num(l['linescores'][i]) or 0)
        if d > best:
            best, best_p = d, i
    if best_p is not None and best >= {'football': 10, 'basketball': 10, 'hockey': 2, 'baseball': 3, 'soccer': 2}[sport]:
        a_, b_ = _num(w['linescores'][best_p]) or 0, _num(l['linescores'][best_p]) or 0
        s.append(f"{n(w, True)} outscored {n(l)} {a_}–{b_} in the {_ordinal(best_p + 1)} {PERIOD[sport]}.")
    for team in (w, l):
        lead = next(iter(team.get('leaders') or []), None)
        if lead:
            s.append(f"{lead['name']} led {n(team)} in {lead['category'].lower()} ({lead['value']}).")
    tov = {t['short']: _num(t['stats'].get('turnovers', ('', None))[1]) for t in teams}
    if sport == 'football' and None not in tov.values():
        if tov[l['short']] - tov[w['short']] >= 2:
            s.append(f"{n(w, True)} won the turnover battle {tov[l['short']]}–{tov[w['short']]}.")
    if info.get('attendance'):
        s.append(f"Attendance: {info['attendance']:,}." if isinstance(info['attendance'], int) else '')
    return [x for x in s if x]


def recap_build(league, event_id, get_json):
    s = get_json(f'https://site.api.espn.com/apis/site/v2/sports/{PATHS[league]}/summary?event={event_id}')
    sport = SPORT[league]
    comp = ((s.get('header') or {}).get('competitions') or [{}])[0]
    status = (comp.get('status') or {}).get('type') or {}
    out = {'event_id': str(event_id), 'league': league, 'state': status.get('state'), 'detail': status.get('detail'), 'teams': [], 'fetched_at': time.time()}
    box = {str((t.get('team') or {}).get('id')): _flat_stats(t) for t in (s.get('boxscore') or {}).get('teams') or []}
    leaders = {}
    for block in s.get('leaders') or []:
        tid = str((block.get('team') or {}).get('id'))
        rows = []
        for cat in block.get('leaders') or []:
            top = (cat.get('leaders') or [{}])[0]
            ath = top.get('athlete') or {}
            if ath.get('displayName') and top.get('displayValue'):
                rows.append({'category': cat.get('displayName') or cat.get('name'), 'name': ath['displayName'][:60],
                             'headshot': _img((ath.get('headshot') or {}).get('href')), 'value': str(top['displayValue'])[:60],
                             'position': (ath.get('position') or {}).get('abbreviation')})
        leaders[tid] = rows[:4]
    if sport == 'baseball':
        for block in (s.get('boxscore') or {}).get('players') or []:
            tid = str((block.get('team') or {}).get('id'))
            if leaders.get(tid):
                continue
            rows = []
            for group in block.get('statistics') or []:
                names = group.get('names') or group.get('labels') or []
                ix = {n: i for i, n in enumerate(names)}
                best, best_key = None, None
                for a in group.get('athletes') or []:
                    st, ath = a.get('stats') or [], a.get('athlete') or {}
                    val = lambda n: _num(st[ix[n]]) if n in ix and ix[n] < len(st) else None
                    if group.get('type') == 'batting' and 'H-AB' in ix:
                        key = ((val('HR') or 0) * 4 + (val('H') or 0) * 2 + (val('RBI') or 0) * 2 + (val('R') or 0))
                        text = ', '.join(x for x in [st[ix['H-AB']] if ix['H-AB'] < len(st) else '', f"{val('HR')} HR" if val('HR') else '', f"{val('RBI')} RBI" if val('RBI') else ''] if x)
                        cat = 'Batting'
                    elif group.get('type') == 'pitching' and 'IP' in ix:
                        if best is not None:
                            continue            # starting pitcher = first listed
                        key, text, cat = 1, f"{st[ix['IP']]} IP, {val('K') or 0} K, {val('ER') or 0} ER", 'Starting pitcher'
                    else:
                        continue
                    if ath.get('displayName') and (best_key is None or key > best_key):
                        best_key, best = key, {'category': cat, 'name': ath['displayName'][:60], 'headshot': _img((ath.get('headshot') or {}).get('href')), 'value': text[:60], 'position': None}
                if best:
                    rows.append(best)
            leaders[tid] = rows
    for c in comp.get('competitors') or []:
        t = c.get('team') or {}
        tid = str(t.get('id'))
        logo = next((_img(x.get('href')) for x in t.get('logos') or [] if _img(x.get('href'))), None) or _img(t.get('logo'))
        short = (t.get('name') if league != 'College football' else None) or t.get('shortDisplayName') or t.get('location') or t.get('displayName')
        out['teams'].append({'id': tid, 'name': t.get('displayName'), 'short': short,
                             'location': t.get('location'), 'nickname': t.get('name'), 'abbr': t.get('abbreviation'), 'pro': league != 'College football',
                             'logo': logo, 'color': t.get('color') if re.fullmatch(r'[0-9a-fA-F]{6}', str(t.get('color') or '')) else None,
                             'home': c.get('homeAway') == 'home', 'winner': c.get('winner'), 'score': _num(c.get('score')),
                             'record': next((r.get('summary') or r.get('displayValue') for r in c.get('record') or [] if (r.get('type') in ('total', None))), None),
                             'rank': c.get('rank') if isinstance(c.get('rank'), int) and 0 < c.get('rank') <= 25 else None,
                             'linescores': [x.get('displayValue') if x.get('displayValue') is not None else x.get('value') for x in c.get('linescores') or []],
                             'leaders': leaders.get(tid, []), 'stats': box.get(tid, {})})
    out['teams'].sort(key=lambda t: t['home'])            # away first
    keys = TEAM_STAT_KEYS.get(sport, [])
    if len(out['teams']) == 2:
        rows = []
        for k in keys:
            a, h = out['teams'][0]['stats'].get(k), out['teams'][1]['stats'].get(k)
            if a and h:
                rows.append({'key': k, 'label': a[0], 'away': a[1], 'home': h[1]})
        out['team_stats'] = rows
    for t in out['teams']:
        t.pop('stats_raw', None)
    plays = [{'away': _num(p.get('awayScore')), 'home': _num(p.get('homeScore')), 'period': (p.get('period') or {}).get('number'),
              'clock': (p.get('clock') or {}).get('displayValue'), 'team': (p.get('team') or {}).get('abbreviation'), 'text': _txt(p.get('text'), 160)}
             for p in s.get('scoringPlays') or []]
    gi = s.get('gameInfo') or {}
    venue = gi.get('venue') or {}
    addr = venue.get('address') or {}
    info = {'venue': _txt(venue.get('fullName'), 80), 'place': ', '.join(x for x in (addr.get('city'), addr.get('state')) if x) or None,
            'attendance': gi.get('attendance') if isinstance(gi.get('attendance'), int) and gi.get('attendance') > 0 else None,
            'detail': status.get('detail')}
    out['info'] = {k: v for k, v in info.items() if v}
    rows = [p for p in s.get('winprobability') or [] if isinstance(p.get('homeWinPercentage'), (int, float))]
    wp = [p['homeWinPercentage'] for p in rows]
    if len(wp) >= 8:
        step = max(1, len(wp) // 120)
        out['win_probability'] = [round(x, 3) for x in wp[::step]] + ([round(wp[-1], 3)] if (len(wp) - 1) % step else [])
        # Sept 29 (G6): where each period starts on the chart (index into win_probability), for axis ticks.
        period_of = {}
        for q in s.get('plays') or []:
            if isinstance(q, dict): period_of[str(q.get('id'))] = (q.get('period') or {}).get('number')
        drives = s.get('drives') or {}
        for d in (drives.get('previous') or []) + ([drives['current']] if isinstance(drives.get('current'), dict) else []):
            for q in (d.get('plays') or []) if isinstance(d, dict) else []:
                if isinstance(q, dict): period_of[str(q.get('id'))] = (q.get('period') or {}).get('number')
        idx = list(range(0, len(wp), step)) + ([len(wp) - 1] if (len(wp) - 1) % step else [])
        marks, last = [], None
        for j, i in enumerate(idx):
            per = period_of.get(str(rows[i].get('playId')))
            if isinstance(per, int) and 1 <= per <= 30:
                if last is not None and per != last:
                    marks.append({'index': j, 'period': per})
                last = per
        if marks:
            out['win_probability_periods'] = marks[:30]
    out['story'] = _story(sport, out['teams'], plays, info, pro=league != 'College football')
    for t in out['teams']:
        t.pop('stats', None)
    a = s.get('article') or {}
    if a.get('headline'):
        url = ((a.get('links') or {}).get('web') or {}).get('href') or ''
        url = re.sub(r'^http://', 'https://', url)
        out['article'] = {'headline': _txt(a.get('headline'), 200), 'description': _txt(a.get('description'), 400),
                          'source': _txt(a.get('source'), 40), 'url': url if re.match(r'https://(www\.)?espn\.com/', url) else None,
                          'image': next((i.get('url') for i in a.get('images') or [] if str(i.get('url', '')).startswith(('https://a.espncdn.com/', 'https://espnmedia-cdn.akamaized.net/'))), None)}
    vids = []
    for v in s.get('videos') or []:
        src = (v.get('links') or {}).get('source') or {}
        mp4 = (src.get('HD') or {}).get('href') or src.get('href')
        if isinstance(mp4, str) and mp4.startswith('https://espnmedia-cdn.akamaized.net/') and mp4.endswith('.mp4'):
            thumb = v.get('thumbnail') if str(v.get('thumbnail', '')).startswith('https://espnmedia-cdn.akamaized.net/') else None
            vids.append({'kind': 'espn', 'title': _txt(v.get('headline'), 200), 'duration': v.get('duration'), 'thumb': thumb, 'src': mp4, 'official': 'espn'})
    ids = {t['id'] for t in out['teams']}
    news = []
    for n in (s.get('news') or {}).get('articles') or []:
        tagged = {str(c.get('teamId')) for c in n.get('categories') or [] if c.get('type') == 'team'}
        head = _txt(n.get('headline'), 160)
        url = re.sub(r'^http://', 'https://', (((n.get('links') or {}).get('web') or {}).get('href') or ''))
        if head and tagged & ids and not EXCLUDE.search(head + ' ' + (n.get('description') or '')):
            news.append({'headline': head, 'description': _txt(n.get('description'), 220), 'published': n.get('published'),
                         'url': url if re.match(r'https://(www\.)?espn\.com/', url) else None,
                         'image': next((_img(i.get('url')) for i in n.get('images') or [] if _img(i.get('url'))), None)})
    out['news'] = news[:4]
    yt = []
    if status.get('completed') and len(out['teams']) == 2:
        try:
            yt = game_highlights(league, out['teams'][0], out['teams'][1], comp.get('date') or s.get('header', {}).get('competitions', [{}])[0].get('date', ''))
        except Exception:
            yt = []
    out['videos'] = yt + vids
    return out


def recap(league, event_id, get_json):
    if league not in PATHS or not re.fullmatch(r'[0-9]{1,12}', str(event_id)):
        raise ValueError('Invalid recap identity')
    key = (league, str(event_id))
    with _lock:
        hit = _recap.get(key)
        if hit:
            settled = hit[1].get('state') == 'post' and time.time() - hit[0] < RECAP_SETTLED and hit[1].get('videos')
            if time.time() - hit[0] < (RECAP_SETTLED if settled else 300 if hit[1].get('state') != 'post' else RECAP_FRESH):
                return copy.deepcopy(hit[1])
    value = recap_build(league, event_id, get_json)
    with _lock:
        _recap[key] = (time.time(), value)
        while len(_recap) > 64:
            del _recap[next(iter(_recap))]
    return copy.deepcopy(value)


def team_reels(league, team, schedule, get_json, games=3):
    """Team page: the team's own channel + highlight reels for its most recent finished games."""
    out = team_videos(league, team)
    recent = [g for g in schedule if g.get('state') == 'final'][-games:][::-1]
    reels, used = [], set()
    for g in recent:
        opp = g.get('opponent') or {}
        opp_team = {'id': opp.get('id'), 'name': opp.get('name') or '', 'short': opp.get('short') or opp.get('name') or '',
                    'location': opp.get('short'), 'nickname': (opp.get('name') or '').replace(opp.get('short') or '', '').strip(),
                    'abbr': opp.get('abbr'), 'pro': league != 'College football'}
        away, home = (opp_team, team) if g.get('home') else (team, opp_team)
        try:
            vids = game_highlights(league, away, home, g.get('date') or '', limit=4)
        except Exception:
            vids = []
        same_day = [x for x in schedule if x.get('state') == 'final' and str(x.get('date', ''))[:10] == str(g.get('date', ''))[:10]]
        if len(same_day) > 1:                     # doubleheader: prefer the matching 'Game N' upload
            n = [x.get('id') for x in same_day].index(g.get('id')) + 1
            vids = sorted(vids, key=lambda v: 0 if f'game {n}' in v['title'].lower() else 1 if not re.search(r'game \d', v['title'].lower()) else 2)
        vids = [v for v in vids if v['id'] not in used]
        if vids:
            used.add(vids[0]['id'])
            reels.append({'game_id': g.get('id'), 'date': g.get('date'), 'opponent': opp.get('short') or opp.get('name'),
                          'result': g.get('result'), 'score': g.get('score'), 'opponent_score': g.get('opponent_score'),
                          'home': g.get('home'), 'video': vids[0]})
    out['game_reels'] = reels
    return out
