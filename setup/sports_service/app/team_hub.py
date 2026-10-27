"""Teams hub (Oct 20 2026, Claude): every team in a league, grouped by conference, for the Sports hub's Teams view.

GET /sports/api/team-hub?league=<league>
  {league, groups:[{name, teams:[{key, id, name, short, abbr, logo, record, conference_record, streak, seed, rank,
                                   points_for, points_against}]}], fetched_at, stale}
Built from ESPN's public standings (college football: FBS). Top 25 ranks come from the server's existing rankings.
Cached one hour; a failed refresh keeps the last good copy (marked stale).
"""
import json, time, urllib.request

ROUTES = {'NFL': 'football/nfl', 'College football': 'football/college-football', 'MLB': 'baseball/mlb', 'NBA': 'basketball/nba',
          'WNBA': 'basketball/wnba', 'NHL': 'hockey/nhl', 'MLS': 'soccer/usa.1'}
_cache = {}


def _get(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'curl/8.7.1'})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = r.read(8_000_001)
    if len(data) > 8_000_000:
        raise ValueError('standings too large')
    return json.loads(data)


def _groups(node, out):
    for child in node.get('children') or []:
        entries = (child.get('standings') or {}).get('entries') or []
        if entries:
            out.append((child.get('name') or '', entries))
        _groups(child, out)
    return out


def _row(league, entry, ranks):
    t = entry.get('team') or {}
    stats = {}
    for s in entry.get('stats') or []:
        stats.setdefault(s.get('type') or s.get('name'), s.get('displayValue'))
        stats.setdefault(s.get('name'), s.get('displayValue'))
    tid = str(t.get('id', ''))
    record = stats.get('total') or stats.get('overall')
    if not record and stats.get('wins') is not None:
        record = '-'.join(str(stats[k]) for k in ('wins', 'losses', 'ties') if stats.get(k) not in (None, '', '0', '0.000') or k != 'ties')
    logo = next((l.get('href') for l in t.get('logos') or [] if str(l.get('href', '')).startswith('https://a.espncdn.com/')), None)
    seed = stats.get('playoffSeed')
    return {'key': league + '~' + tid, 'id': tid, 'name': t.get('displayName') or t.get('name') or '', 'short': t.get('shortDisplayName') or '',
            'abbr': t.get('abbreviation') or '', 'logo': logo, 'record': record or '',
            'conference_record': stats.get('vsconf') or stats.get('vs. Conf.') or stats.get('divisionRecord') or '',
            'streak': stats.get('streak') if stats.get('streak') not in ('-', None) else '',
            'seed': int(seed) if str(seed or '').isdigit() else None, 'rank': ranks.get(tid),
            'points_for': stats.get('pointsFor') or '', 'points_against': stats.get('pointsAgainst') or ''}


def team_hub(league, rankings=None):
    if league not in ROUTES:
        raise KeyError(league)
    hit = _cache.get(league)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    try:
        raw = _get('https://site.api.espn.com/apis/v2/sports/' + ROUTES[league] + '/standings' +
                   ('?group=80' if league == 'College football' else '?level=3' if league in ('NFL', 'MLB', 'NBA', 'NHL') else ''))
        ranks = {}
        if league == 'College football' and rankings:
            try:
                polls = (rankings() or {}).get('polls') or []
                for team in (polls[0].get('teams') if polls else []) or []:
                    if team.get('espn_id') is not None and team.get('rank') is not None:
                        ranks[str(team['espn_id'])] = int(team['rank'])
            except Exception:
                ranks = {}
        groups = []
        for name, entries in _groups(raw, []):
            rows = [_row(league, e, ranks) for e in entries]
            rows.sort(key=lambda r: (r['seed'] is None, r['seed'] or 0, r['name']))
            short = name.replace(' Conference', '').replace(' Division', '').replace('American League', 'AL').replace('National League', 'NL').strip()
            groups.append({'name': short or league, 'teams': rows})
        value = {'schema': 1, 'league': league, 'groups': groups, 'fetched_at': time.time(), 'stale': False,
                 'scope': 'FBS' if league == 'College football' else 'league'}
        _cache[league] = (time.time(), value)
        return value
    except Exception:
        if hit:
            return {**hit[1], 'stale': True}
        raise
