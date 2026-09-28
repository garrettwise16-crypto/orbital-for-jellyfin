"""Pregame preview for the game center.

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
                  'opponent': _txt((g.get('opponent') or {}).get('abbreviation'), 8), 'at': g.get('atVs')} for g in x.get('events') or [] if g.get('gameResult')]
        if side and games:
            last.append({'side': side, 'games': games[:5]})
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
