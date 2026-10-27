"""Sept 29 polish (G2/G3/G4): the game center's real box score and baseball play-by-play, from ESPN's public summary.
Labels, names and numbers only (no locations, no provider data). Bounded, cached, single flight per game."""
import copy
import re
import threading
import time

import tracker

LEAGUES = tracker.LEAGUES
MAX_ATHLETES = 40
MAX_HALF_PLAYS = 40
# Main groups first (open by default in clients); everything ESPN reports stays available after them.
ORDER = {'football': ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'fumbles', 'kicking', 'punting', 'kickReturns', 'puntReturns'],
         'baseball': ['batting', 'pitching'], 'hockey': ['forwards', 'defenses', 'goalies', 'skaters']}
MAIN = {'football': {'passing', 'rushing', 'receiving'}, 'baseball': {'batting', 'pitching'}, 'basketball': None, 'hockey': None}
TITLES = {'kickReturns': 'Kick returns', 'puntReturns': 'Punt returns', 'defensive': 'Defense', 'defenses': 'Defense'}


class NotFound(Exception):
    pass


text, identity, number = tracker.text, tracker.identity, tracker.number


def _groups(team_block, kind):
    out = []
    for g in team_block.get('statistics') or []:
        if not isinstance(g, dict):
            continue
        key = str(g.get('name') or g.get('type') or g.get('text') or 'statistics')
        labels = [text(x, 12) or '' for x in (g.get('labels') or [])][:20]
        if not labels:
            continue
        athletes = []
        for a in (g.get('athletes') or [])[:MAX_ATHLETES]:
            who = a.get('athlete') or {}
            stats = [text(x, 16) or '' for x in (a.get('stats') or [])][:len(labels)]
            if not stats or not identity(who.get('id')):
                continue
            pos = (who.get('position') or {}).get('abbreviation') if isinstance(who.get('position'), dict) else None
            pos = pos or ((a.get('position') or {}).get('abbreviation') if isinstance(a.get('position'), dict) else None)
            row = {'id': identity(who.get('id')), 'name': text(who.get('displayName'), 60), 'short': text(who.get('shortName') or who.get('displayName'), 40),
                   'pos': text(pos, 6), 'stats': stats}
            if a.get('starter') is True: row['starter'] = True
            order = number(a.get('batOrder'), 1, 20)
            if order is not None: row['order'] = order
            shot = (who.get('headshot') or {}).get('href') if isinstance(who.get('headshot'), dict) else None
            if isinstance(shot, str) and shot.startswith('https://a.espncdn.com/i/headshots/'): row['headshot'] = shot
            athletes.append(row)
        title = TITLES.get(key) or re.sub(r'(?<!^)(?=[A-Z])', ' ', key).capitalize()
        main = MAIN.get(kind)
        out.append({'key': key, 'title': title, 'labels': labels, 'descriptions': [text(x, 60) or '' for x in (g.get('descriptions') or [])][:len(labels)],
                    'athletes': athletes, 'totals': [text(x, 16) or '' for x in (g.get('totals') or [])][:len(labels)],
                    'main': True if main is None else key in main})
    order = ORDER.get(kind) or []
    out.sort(key=lambda g: order.index(g['key']) if g['key'] in order else len(order))
    return out


def _innings(raw):
    halves, current = [], None
    for p in tracker.plays(raw):
        if (p.get('type') or {}).get('type') != 'play-result':
            continue
        per = p.get('period') or {}
        n = number(per.get('number'), 1, 30); half = text(per.get('type'), 10) or ''
        if n is None:
            continue
        key = (n, half)
        if current is None or current['key'] != key:
            current = {'key': key, 'inning': n, 'half': half.lower() or None, 'label': ((half + ' ' if half else '') + re.sub(r'\s*Inning$', '', tracker.text(per.get('displayValue'), 20) or '')).strip() or half,
                       'team_id': identity((p.get('team') or {}).get('id')), 'plays': []}
            halves.append(current)
        if len(current['plays']) < MAX_HALF_PLAYS:
            current['plays'].append({'id': identity(p.get('id')), 'text': text(p.get('text'), 200), 'away': number(p.get('awayScore'), 0, 99),
                                     'home': number(p.get('homeScore'), 0, 99), 'scoring': p.get('scoringPlay') is True, 'outs': number(p.get('outs'), 0, 3),
                                     'at': tracker.wall(p)})
    prev = (0, 0)
    for h in halves:
        last = next((x for x in reversed(h['plays']) if x['away'] is not None and x['home'] is not None), None)
        now = (last['away'], last['home']) if last else prev
        h['runs'] = (now[0] - prev[0]) + (now[1] - prev[1]); h['away'], h['home'] = now; prev = now
        del h['key']
    return halves


# Oct 6 Game Center redesign: spray chart and series status, from the same ESPN summary (no extra request).
NOT_BATTED = {'foul-ball', 'end-batterpitcher', 'play-result', 'start-batterpitcher'}
HIT_TYPES = {'single', 'double', 'triple', 'home-run'}
MAX_BATTED = 120


def _batted(raw):
    """Balls in play with ESPN/Gameday field coordinates (home plate near x=125, y=204; y grows toward the plate)."""
    out = []
    for p in tracker.plays(raw):
        c = p.get('hitCoordinate') if isinstance(p.get('hitCoordinate'), dict) else None
        kind = text((p.get('type') or {}).get('type'), 60) or ''
        if not c or kind in NOT_BATTED or p.get('atBatPitchNumber') is None:
            continue
        x, y = number(c.get('x'), 0, 255), number(c.get('y'), 0, 255)
        if x is None or y is None:
            continue
        per = p.get('period') or {}
        batter = next((identity((a.get('athlete') or {}).get('id')) for a in (p.get('participants') or [])
                       if isinstance(a, dict) and a.get('type') == 'batter'), None)
        out.append({'x': x, 'y': y, 'result': text((p.get('type') or {}).get('text'), 40), 'hit': kind in HIT_TYPES,
                    'trajectory': p.get('trajectory') if p.get('trajectory') in ('G', 'L', 'F', 'P') else None,
                    'half': (text(per.get('type'), 10) or '').lower() or None, 'inning': number(per.get('number'), 1, 30),
                    'batter_id': batter})  # ESPN's play team is the fielding side; use half for the batting team
        if len(out) >= MAX_BATTED:
            break
    return out


def _series(comp, known):
    s = next((x for x in (comp.get('series') or []) if isinstance(x, dict) and x.get('type') == 'current'), None)
    if not s:
        return None
    wins = {identity(c.get('id')): number(c.get('wins'), 0, 9) for c in (s.get('competitors') or [])
            if isinstance(c, dict) and identity(c.get('id')) in known}
    return {'summary': text(s.get('summary'), 60), 'best_of': number(s.get('totalCompetitions'), 1, 9),
            'completed': s.get('completed') is True, 'wins': wins}


MAX_DRIVES = 8


def _drives(raw, known):
    """Last completed drives. yard_line is ESPN's absolute line: 0 = home goal line, 100 = away goal line."""
    out = []
    for d in ((raw.get('drives') or {}).get('previous') or [])[-MAX_DRIVES:]:
        if not isinstance(d, dict):
            continue
        team = identity((d.get('team') or {}).get('id'))
        start, end = d.get('start') or {}, d.get('end') or {}
        a, b = number(start.get('yardLine'), 0, 100), number(end.get('yardLine'), 0, 100)
        if team not in known or a is None or b is None:
            continue
        out.append({'team_id': team, 'start_yard_line': a, 'end_yard_line': b, 'result': text(d.get('displayResult') or d.get('result'), 40),
                    'score': d.get('isScore') is True, 'description': text(d.get('description'), 80),
                    'period': number((start.get('period') or {}).get('number'), 1, 10), 'clock': text((start.get('clock') or {}).get('displayValue'), 10)})
    return out


def _leaders(raw, known):
    out = []
    for side in raw.get('leaders') or []:
        team = identity((side.get('team') or {}).get('id'))
        if team not in known:
            continue
        for cat in (side.get('leaders') or [])[:3]:
            top = next(iter(cat.get('leaders') or []), None) or {}
            ath = top.get('athlete') or {}
            shot = (ath.get('headshot') or {}).get('href') if isinstance(ath.get('headshot'), dict) else None
            if not ath.get('displayName'):
                continue
            out.append({'team_id': team, 'category': text(cat.get('displayName'), 40), 'name': text(ath.get('displayName'), 80),
                        'line': text(top.get('displayValue'), 80),
                        'headshot': shot if isinstance(shot, str) and re.fullmatch(r'https://a\.espncdn\.com/i/headshots/[a-z]+/players/full/\d+\.png', shot) else None})
    return out


def normalize(raw, league, event_id):
    header = raw.get('header') or {}
    if str(header.get('id')) != str(event_id):
        raise ValueError('Box score identity mismatch')
    comp = next((c for c in (header.get('competitions') or []) if str(c.get('id')) == str(event_id)), None)
    if not comp:
        raise ValueError('Box score competition missing')
    typ = (comp.get('status') or {}).get('type') or {}
    state = 'live' if typ.get('state') == 'in' else 'final' if typ.get('completed') is True else 'scheduled'
    kind = LEAGUES[league][1]
    teams = []
    for c in comp.get('competitors') or []:
        t = c.get('team') or {}
        ident = identity(t.get('id') or c.get('id'))
        if not ident:
            continue
        rec = next((r.get('summary') or r.get('displayValue') for r in (c.get('record') or []) if isinstance(r, dict) and r.get('type') == 'total'), None)
        teams.append({'id': ident, 'side': c.get('homeAway') if c.get('homeAway') in ('home', 'away') else None, 'name': text(t.get('displayName'), 100),
                      'abbreviation': text(t.get('abbreviation'), 12), 'record': text(rec, 12),
                      'color': '#' + str(t.get('color')).lower() if re.fullmatch(r'[0-9a-fA-F]{6}', str(t.get('color') or '')) else None,
                      'alt_color': '#' + str(t.get('alternateColor')).lower() if re.fullmatch(r'[0-9a-fA-F]{6}', str(t.get('alternateColor') or '')) else None})
    known = {t['id'] for t in teams}
    players = []
    for block in ((raw.get('boxscore') or {}).get('players') or []):
        tid = identity((block.get('team') or {}).get('id'))
        if tid in known:
            players.append({'team_id': tid, 'groups': _groups(block, kind)})
    out = {'schema_version': 1, 'league': league, 'event_id': str(event_id), 'kind': kind, 'state': state,
           'status': text(typ.get('shortDetail') or typ.get('detail'), 120), 'teams': teams, 'players': players, 'fetched_at': time.time()}
    if kind == 'baseball' and state in ('live', 'final'):
        out['innings'] = _innings(raw)
        out['batted_balls'] = _batted(raw)
    if kind == 'football' and state in ('live', 'final'):
        out['drives'] = _drives(raw, known)
        out['leaders'] = _leaders(raw, known)
    series = _series(comp, known)
    if series:
        out['series'] = series
    return out


class Cache:
    LIVE, FINAL, SCHEDULED, MAX = 20, 900, 120, 24

    def __init__(self, fetch=tracker.fetch_summary):
        self.fetch = fetch; self.lock = threading.Lock(); self.entries = {}

    def get(self, league, event_id):
        if league not in LEAGUES or not re.fullmatch(r'[0-9]{1,12}', event_id):
            raise ValueError('Invalid game')
        key = (league, event_id)
        with self.lock:
            e = self.entries.get(key)
            if e and time.time() - e['at'] < e['ttl']:
                return copy.deepcopy(e['value'])
            wait = e['event'] if e and e.get('pending') else None
            if not wait:
                e = self.entries.setdefault(key, {'at': 0, 'ttl': 0, 'value': None})
                e['pending'] = True; e['event'] = threading.Event()
        if wait:
            wait.wait(10)
            with self.lock:
                e = self.entries.get(key)
                if e and e.get('value') is not None:
                    return copy.deepcopy(e['value'])
            raise OSError('Box score pending')
        try:
            try:
                raw = self.fetch(league, event_id)
            except tracker.TrackerNotFound:
                raise NotFound() from None
            value = normalize(raw, league, event_id)
            ttl = self.LIVE if value['state'] == 'live' else self.FINAL if value['state'] == 'final' else self.SCHEDULED
            with self.lock:
                e.update(at=time.time(), ttl=ttl, value=value)
                while len(self.entries) > self.MAX:
                    oldest = min(self.entries, key=lambda k: self.entries[k]['at'])
                    if oldest == key: break
                    del self.entries[oldest]
            return copy.deepcopy(value)
        except Exception:
            with self.lock:
                if e.get('value') is not None and time.time() - e['at'] < 600:
                    stale = copy.deepcopy(e['value']); stale['stale'] = True; return stale
            raise
        finally:
            with self.lock:
                e['pending'] = False; e['event'].set()


CACHE = Cache()


def get(league, event_id):
    return CACHE.get(league, event_id)


# Batter heat map (catcher view, zones 1-9): Baseball Savant Statcast, pitches before the game date only.
# One fetch at a time, bounded cache; the profile is history, never this game's pitches.
PROFILE_TTL, PROFILE_MAX, PROFILE_MIN_SAMPLE, PROFILE_BYTES = 12 * 3600, 64, 20, 6_000_000
_SW = {'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip', 'hit_into_play', 'foul_bunt', 'missed_bunt', 'bunt_foul_tip'}
_CON = {'foul', 'foul_tip', 'hit_into_play', 'foul_bunt', 'bunt_foul_tip'}
_HIT = {'single', 'double', 'triple', 'home_run'}
_PROFILES, _PROFILE_LOCK, _PROFILE_FETCH = {}, threading.Lock(), threading.Lock()


def _savant_csv(mlbam, season):
    import urllib.request
    url = ('https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_type=batter'
           '&hfSea=%d%%7C&hfGT=R%%7CPO%%7C&batters_lookup%%5B%%5D=%d' % (season, mlbam))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Orbital sports)'})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read(PROFILE_BYTES + 1)
    if len(data) > PROFILE_BYTES:
        raise ValueError('Savant response too large')
    return data.decode('utf-8-sig', 'replace')


def profile_from_csv(body, mlbam, before):
    import csv
    import io
    cells = [{'index': i, 'pitches': 0, 'contact': {'success': 0, 'sample': 0}, 'power': {'success': 0, 'sample': 0},
              'hits': {'success': 0, 'sample': 0}} for i in range(9)]
    last = None
    for r in csv.DictReader(io.StringIO(body)):
        if str(r.get('batter')) != str(mlbam) or not (r.get('game_date') or '') < before:
            continue
        z = r.get('zone') or ''
        if not z.isdigit() or not 1 <= int(z) <= 9:
            continue
        c = cells[int(z) - 1]; c['pitches'] += 1; d = r.get('description')
        last = max(last or '', r['game_date'])
        if d in _SW:
            c['contact']['sample'] += 1; c['contact']['success'] += d in _CON
        if d == 'hit_into_play':
            c['hits']['sample'] += 1; c['hits']['success'] += r.get('events') in _HIT
            try:
                speed = float(r.get('launch_speed') or '')
            except ValueError:
                speed = None
            if speed is not None:
                c['power']['sample'] += 1; c['power']['success'] += speed >= 95
    return {'schema_version': 1, 'batter_id': str(mlbam), 'before': before, 'period': before[:4] + ' season', 'perspective': 'catcher',
            'source': 'Baseball Savant', 'minimum_color_sample': PROFILE_MIN_SAMPLE, 'pitches': sum(c['pitches'] for c in cells),
            'last_game': last, 'cells': cells}


def batter_profile(mlbam, before, fetch=None):
    if not re.fullmatch(r'[0-9]{4,8}', str(mlbam)) or not re.fullmatch(r'20[0-9]{2}-[01][0-9]-[0-3][0-9]', str(before)):
        raise ValueError('Invalid batter')
    fetch = fetch or _savant_csv
    key = (str(mlbam), before)
    with _PROFILE_LOCK:
        hit = _PROFILES.get(key)
        if hit and time.time() - hit[0] < PROFILE_TTL:
            return copy.deepcopy(hit[1])
    if not _PROFILE_FETCH.acquire(timeout=8):
        if hit:
            return copy.deepcopy(hit[1])
        raise OSError('Profile pending')
    try:
        try:
            value = profile_from_csv(fetch(int(mlbam), int(before[:4])), mlbam, before)
        except Exception:
            if hit:
                stale = copy.deepcopy(hit[1]); stale['stale'] = True; return stale
            raise
        with _PROFILE_LOCK:
            _PROFILES[key] = (time.time(), value)
            while len(_PROFILES) > PROFILE_MAX:
                del _PROFILES[min(_PROFILES, key=lambda k: _PROFILES[k][0])]
        return copy.deepcopy(value)
    finally:
        _PROFILE_FETCH.release()


# Pitch flight (Oct 6): MLB's measured 9-parameter pitch fit from statsapi feed/live for the last two at-bats.
# The response can be AHEAD of a delayed picture: clients draw only pitches they have already released.
_FLIGHT_SCHED, _FLIGHT_FEED, _FLIGHT_LOCK = {}, {}, threading.Lock()
FLIGHT_FEED_TTL, FLIGHT_SCHED_TTL = 6, 600


def _statsapi(url, timeout=8):
    import json, urllib.request as _u
    req = _u.Request(url, headers={'User-Agent': 'Mozilla/5.0 Orbital'})
    with _u.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(8_000_000))


def _flight_norm(s):
    return re.sub(r'[^a-z]', '', (s or '').lower())


def mlb_game_pk(date, away, home, fetch=None):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date or '') or not away or not home or len(away) > 80 or len(home) > 80:
        raise ValueError('bad game')
    fetch = fetch or _statsapi
    hit = _FLIGHT_SCHED.get(date)
    if not hit or time.time() - hit[0] > FLIGHT_SCHED_TTL:
        s = fetch('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' + date)
        hit = (time.time(), [(g['gamePk'], g['teams']['away']['team']['name'], g['teams']['home']['team']['name'], g.get('status', {}).get('abstractGameState', ''))
                             for d in s.get('dates', []) for g in d.get('games', [])])
        _FLIGHT_SCHED[date] = hit
        while len(_FLIGHT_SCHED) > 8:
            _FLIGHT_SCHED.pop(min(_FLIGHT_SCHED, key=lambda k: _FLIGHT_SCHED[k][0]))
    a, h = _flight_norm(away), _flight_norm(home)
    match = [g for g in hit[1] if (a in _flight_norm(g[1]) or _flight_norm(g[1]) in a) and (h in _flight_norm(g[2]) or _flight_norm(g[2]) in h)]
    live = [g for g in match if g[3] == 'Live']
    return (live or match or [(None,)])[0][0]


def _flight_pitch(ev):
    pd = ev.get('pitchData') or {}
    c = pd.get('coordinates') or {}
    br = pd.get('breaks') or {}
    det = ev.get('details') or {}
    out = {'n': ev.get('pitchNumber'), 'play_id': ev.get('playId'), 'call': (det.get('call') or {}).get('description') or det.get('description'),
           'call_code': (det.get('call') or {}).get('code'), 'type': (det.get('type') or {}).get('description'), 'type_code': (det.get('type') or {}).get('code'),
           'mph': pd.get('startSpeed'), 'spin_rpm': br.get('spinRate'), 'ivb_in': br.get('breakVerticalInduced'), 'hb_in': br.get('breakHorizontal'),
           'ext_ft': pd.get('extension'), 'zone_top_ft': pd.get('strikeZoneTop'), 'zone_bottom_ft': pd.get('strikeZoneBottom'),
           'count': ev.get('count')}
    keys = ('x0', 'y0', 'z0', 'vX0', 'vY0', 'vZ0', 'aX', 'aY', 'aZ')
    if all(isinstance(c.get(k), (int, float)) for k in keys) and isinstance(pd.get('extension'), (int, float)):
        out['fit'] = [float(c[k]) for k in keys]
        out['plate'] = [c.get('pX'), c.get('pZ')]
    hd = ev.get('hitData')
    if isinstance(hd, dict):
        hc = hd.get('coordinates') or {}
        out['hit'] = {'launch_speed': hd.get('launchSpeed'), 'launch_angle': hd.get('launchAngle'), 'distance': hd.get('totalDistance'),
                      'trajectory': hd.get('trajectory'), 'hardness': hd.get('hardness'), 'location': hd.get('location'),
                      'coord_x': hc.get('coordX'), 'coord_y': hc.get('coordY')}
    rv = ev.get('reviewDetails')
    if rv and rv.get('reviewType') == 'MJ':
        out['abs'] = {'overturned': bool(rv.get('isOverturned')), 'in_progress': bool(rv.get('inProgress')), 'team_id': rv.get('challengeTeamId'),
                      'challenger': (rv.get('player') or {}).get('fullName')}
    return out


def _flight_build(f, pk):
    teams = {f['gameData']['teams'][k]['id']: f['gameData']['teams'][k].get('abbreviation') for k in ('away', 'home')}
    abs_ = []
    for p in (f.get('liveData', {}).get('plays', {}).get('allPlays') or [])[-2:]:
        m = p.get('matchup') or {}
        pitches = [_flight_pitch(e) for e in p.get('playEvents') or [] if e.get('isPitch')]
        for q in pitches:
            if q.get('abs'):
                q['abs']['team'] = teams.get(q['abs'].pop('team_id'))
        abs_.append({'index': (p.get('about') or {}).get('atBatIndex'), 'batter': (m.get('batter') or {}).get('fullName'),
                     'batter_id': (m.get('batter') or {}).get('id'), 'pitcher': (m.get('pitcher') or {}).get('fullName'), 'pitcher_id': (m.get('pitcher') or {}).get('id'),
                     'bat_side': (m.get('batSide') or {}).get('code'), 'pitch_hand': (m.get('pitchHand') or {}).get('code'),
                     'result': (p.get('result') or {}).get('event'), 'description': (p.get('result') or {}).get('description') if (p.get('about') or {}).get('isComplete') else None,
                     'complete': bool((p.get('about') or {}).get('isComplete')), 'pitches': pitches})
    return {'schema_version': 1, 'game_pk': pk, 'frame': 'mlb-statsapi-v1', 'ref_y_ft': 50.0, 'plate_y_ft': 17 / 12,
            'source': 'MLB Stats API', 'at_bats': abs_}


def pitch_flight(date, away, home, fetch=None):
    fetch = fetch or _statsapi
    pk = mlb_game_pk(date, away, home, fetch)
    if pk is None:
        raise NotFound()
    with _FLIGHT_LOCK:
        hit = _FLIGHT_FEED.get(pk)
        if not hit or time.time() - hit[0] > FLIGHT_FEED_TTL:
            try:
                hit = (time.time(), _flight_build(fetch('https://statsapi.mlb.com/api/v1.1/game/%d/feed/live' % int(pk)), pk))
            except Exception:
                if not hit:
                    raise
                hit = (time.time() - FLIGHT_FEED_TTL + 2, hit[1])  # serve the last good copy, retry soon
            _FLIGHT_FEED[pk] = hit
            while len(_FLIGHT_FEED) > 16:
                _FLIGHT_FEED.pop(min(_FLIGHT_FEED, key=lambda k: _FLIGHT_FEED[k][0]))
        return hit[1]
