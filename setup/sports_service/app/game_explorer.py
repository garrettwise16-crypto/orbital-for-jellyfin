"""Game explorer (Oct 20 2026, Claude): the whole game, period by period, for the deep-dive view on every client.

GET /sports/api/game-explorer?event=<id>&league=<league>
  teams:   [{id, side, abbr, name, color, logo, score, periods:[..]}]
  periods: [{n, label, away, home}]                 score in each quarter / inning / period
  units:   [{period, label, team_id, result, summary, away, home, scoring, plays:[...]}]
           football = drives; baseball = half-innings (at-bat results); others = plays grouped by period
  stats:   {"<period>": {"<team_id>": {...}}}        per-period team totals (sport-specific)
Built from ESPN's public summary (the same source the tracker uses). Cached: finals 30 min, live 20 s.
"""
import re, time

PERIOD_NAMES = {'football': 'Q', 'basketball': 'Q', 'hockey': 'P', 'soccer': 'H'}
KINDS = {'NFL': 'football', 'College football': 'football', 'MLB': 'baseball', 'NBA': 'basketball', 'WNBA': 'basketball',
         'NCAAM': 'basketball', 'NCAAW': 'basketball', 'NHL': 'hockey', 'MLS': 'soccer'}
MAX_PLAYS = 900


def _text(value, limit=300):
    return str(value or '').strip()[:limit]


def _num(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def period_label(kind, n):
    if kind == 'baseball':
        return str(n)
    if kind == 'soccer':
        return {1: '1st half', 2: '2nd half'}.get(n, 'ET' if n <= 4 else 'Pens')
    regular = 4 if kind in ('football', 'basketball') else 3
    if n <= regular:
        return PERIOD_NAMES.get(kind, 'P') + str(n)
    return 'OT' if n == regular + 1 else 'OT' + str(n - regular)


def teams_of(raw):
    comp = raw['header']['competitions'][0]
    out = []
    for c in comp.get('competitors', []):
        t = c.get('team') or {}
        logo = next((l.get('href') for l in t.get('logos', []) if str(l.get('href', '')).startswith('https://a.espncdn.com/')), None) \
            or (t.get('logo') if str(t.get('logo', '')).startswith('https://a.espncdn.com/') else None)
        out.append({'id': str(t.get('id', '')), 'side': c.get('homeAway'), 'abbr': _text(t.get('abbreviation'), 8),
                    'name': _text(t.get('displayName') or t.get('name'), 80), 'color': _text(t.get('color'), 8),
                    'logo': logo, 'score': _text(c.get('score'), 6),
                    'periods': [_text(l.get('displayValue'), 4) for l in c.get('linescores', [])][:20]})
    return out, comp


def football(raw, teams):
    units, stats = [], {}
    drives = list((raw.get('drives') or {}).get('previous') or [])
    current = (raw.get('drives') or {}).get('current')
    if isinstance(current, dict) and current.get('plays') and all(current.get('id') != d.get('id') for d in drives):
        drives.append(current)
    played = 0
    for d in drives:
        team = str((d.get('team') or {}).get('id', ''))
        plays = []
        away = home = None
        for p in d.get('plays') or []:
            if played >= MAX_PLAYS:
                break
            kind = _text((p.get('type') or {}).get('text'), 40)
            if kind in ('Timeout', 'End Period', 'End of Half', 'End of Game', 'Official Timeout', 'Two-minute warning'):
                continue
            period = _num((p.get('period') or {}).get('number')) or 0
            yards = _num(p.get('statYardage'))
            start = p.get('start') or {}
            plays.append({'period': period, 'clock': _text((p.get('clock') or {}).get('displayValue'), 8),
                          'situation': _text(start.get('downDistanceText'), 40), 'type': kind, 'text': _text(p.get('text'), 400),
                          'yards': yards, 'scoring': bool(p.get('scoringPlay')), 'turnover': bool(p.get('isTurnover')),
                          'penalty': bool(p.get('isPenalty'))})
            played += 1
            away, home = _num(p.get('awayScore')), _num(p.get('homeScore'))
            s = stats.setdefault(str(period), {}).setdefault(team, {'plays': 0, 'yards': 0, 'pass_yards': 0, 'rush_yards': 0,
                                                                       'first_downs': 0, 'turnovers': 0, 'penalties': 0})
            if kind.startswith(('Pass', 'Rush', 'Sack')) or kind in ('Rushing Touchdown', 'Passing Touchdown'):
                s['plays'] += 1
                s['yards'] += yards or 0
                if kind.startswith('Rush') or kind == 'Rushing Touchdown':
                    s['rush_yards'] += yards or 0
                else:
                    s['pass_yards'] += yards or 0
            end = p.get('end') or {}
            if start.get('down') and end.get('down') == 1 and (end.get('team') or {}).get('id') == (start.get('team') or {}).get('id') \
                    and not p.get('scoringPlay') and kind not in ('Kickoff', 'Punt'):
                s['first_downs'] += 1
            if p.get('isTurnover'):
                s['turnovers'] += 1
            if p.get('isPenalty'):
                s['penalties'] += 1
        if not plays:
            continue
        period = _num(((d.get('start') or {}).get('period') or {}).get('number')) or plays[0]['period']
        units.append({'period': period, 'team_id': team, 'label': _text((d.get('team') or {}).get('abbreviation'), 8) + ' drive',
                      'result': _text(d.get('displayResult'), 40), 'summary': _text(d.get('description'), 60),
                      'start': _text((d.get('start') or {}).get('text'), 20), 'end': _text((d.get('end') or {}).get('text'), 20),
                      'away': away, 'home': home, 'scoring': bool(d.get('isScore')), 'plays': plays})
    return units, stats


HIT = re.compile(r'\b(singled|doubled|tripled|homered|single|double|triple|home run)\b', re.I)


def baseball(raw, teams):
    units, stats, index = [], {}, {}
    played = 0
    for p in raw.get('plays') or []:
        per = p.get('period') or {}
        n, half = _num(per.get('number')) or 0, _text(per.get('type'), 8)
        key = (n, half)
        if key not in index:
            index[key] = len(units)
            units.append({'period': n, 'half': half, 'label': (half or '') + ' ' + _text(per.get('displayValue'), 20),
                          'team_id': None, 'result': '', 'summary': '', 'away': None, 'home': None, 'scoring': False, 'plays': [],
                          '_start': (_num(p.get('awayScore')) or 0, _num(p.get('homeScore')) or 0)})
        u = units[index[key]]
        typ = (p.get('type') or {}).get('type')
        text = _text(p.get('text'), 300)
        u['away'], u['home'] = _num(p.get('awayScore')), _num(p.get('homeScore'))
        if typ == 'play-result' and text and played < MAX_PLAYS:
            team = str((p.get('team') or {}).get('id', ''))
            u['team_id'] = u['team_id'] or team
            u['plays'].append({'period': n, 'clock': '', 'situation': (str(_num(p.get('outs'))) + ' out') if _num(p.get('outs')) is not None else '',
                               'type': 'At bat', 'text': text, 'yards': None, 'scoring': bool(p.get('scoringPlay')),
                               'hit': bool(HIT.search(text))})
            played += 1
            if p.get('scoringPlay'):
                u['scoring'] = True
    for u in units:
        a0, h0 = u.pop('_start')
        runs = ((u['away'] or 0) - a0) + ((u['home'] or 0) - h0)
        hits = sum(1 for p in u['plays'] if p.get('hit'))
        u['result'] = (str(runs) + ' run' + ('' if runs == 1 else 's')) if runs else 'No runs'
        u['summary'] = str(hits) + ' hit' + ('' if hits == 1 else 's') + ' · ' + str(len(u['plays'])) + ' batters'
        if u['team_id']:
            s = stats.setdefault(str(u['period']), {}).setdefault(u['team_id'], {'runs': 0, 'hits': 0, 'batters': 0})
            s['runs'] += runs; s['hits'] += hits; s['batters'] += len(u['plays'])
    return [u for u in units if u['plays']], stats


def by_period(raw, teams, kind):
    units, stats, index = [], {}, {}
    played = 0
    for p in raw.get('plays') or []:
        n = _num((p.get('period') or {}).get('number')) or 0
        team = str((p.get('team') or {}).get('id', ''))
        typ = _text((p.get('type') or {}).get('text'), 40)
        s = stats.setdefault(str(n), {}).setdefault(team, {'points': 0, 'shots': 0, 'made': 0, 'threes': 0} if kind == 'basketball'
                                                     else {'goals': 0, 'shots': 0, 'hits': 0, 'penalties': 0})
        if kind == 'basketball' and p.get('shootingPlay'):
            s['shots'] += 1
            if p.get('scoringPlay'):
                s['made'] += 1; s['points'] += _num(p.get('scoreValue')) or 0
                if (_num(p.get('scoreValue')) or 0) == 3:
                    s['threes'] += 1
        elif kind != 'basketball':
            if typ in ('Shot', 'Goal'):
                s['shots'] += 1
            if p.get('scoringPlay'):
                s['goals'] += 1
            if typ == 'Hit':
                s['hits'] += 1
            if typ == 'Penalty':
                s['penalties'] += 1
        if n not in index:
            index[n] = len(units)
            units.append({'period': n, 'label': period_label(kind, n), 'team_id': None, 'result': '', 'summary': '',
                          'away': None, 'home': None, 'scoring': False, 'plays': []})
        u = units[index[n]]
        u['away'], u['home'] = _num(p.get('awayScore')), _num(p.get('homeScore'))
        if played >= MAX_PLAYS or typ in ('End Period', 'End Game', 'Period Start', 'Game Start', 'End of Period', 'Start of Period'):
            continue
        u['plays'].append({'period': n, 'clock': _text((p.get('clock') or {}).get('displayValue'), 8), 'situation': '',
                           'type': typ, 'text': _text(p.get('text'), 300), 'yards': None, 'scoring': bool(p.get('scoringPlay')),
                           'team_id': team})
        played += 1
    for u in units:
        goals = [p for p in u['plays'] if p['scoring']]
        u['scoring'] = bool(goals)
        u['result'] = (str(len(goals)) + (' scoring plays' if kind == 'basketball' else ' goal' + ('' if len(goals) == 1 else 's'))) if goals else 'No scoring'
        u['summary'] = str(len(u['plays'])) + ' plays'
    return units, stats


def explore(raw, league):
    kind = KINDS.get(league, 'other')
    teams, comp = teams_of(raw)
    side = {t['side']: t for t in teams}
    count = max((len(t['periods']) for t in teams), default=0)
    periods = [{'n': i + 1, 'label': period_label(kind, i + 1),
                'away': (side.get('away') or {}).get('periods', [None] * count)[i] if i < len((side.get('away') or {}).get('periods', [])) else None,
                'home': (side.get('home') or {}).get('periods', [None] * count)[i] if i < len((side.get('home') or {}).get('periods', [])) else None}
               for i in range(count)]
    if kind == 'football':
        units, stats = football(raw, teams)
    elif kind == 'baseball':
        units, stats = baseball(raw, teams)
    elif kind in ('basketball', 'hockey', 'soccer'):
        units, stats = by_period(raw, teams, kind)
    else:
        units, stats = [], {}
    stats = {k: {t: v for t, v in rows.items() if t} for k, rows in stats.items()}
    status = (comp.get('status') or {}).get('type') or {}
    return {'schema': 1, 'league': league, 'kind': kind, 'final': bool(status.get('completed')),
            'status': _text(status.get('shortDetail') or status.get('detail'), 40), 'teams': teams, 'periods': periods,
            'units': units, 'stats': stats, 'fetched_at': time.time()}


_cache = {}


def game_explorer(league, event_id, fetch_summary):
    key = (league, event_id)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < (1800 if hit[1].get('final') else 20):
        return hit[1]
    value = explore(fetch_summary(league, event_id), league)
    if len(_cache) > 64:
        _cache.clear()
    _cache[key] = (time.time(), value)
    return value
