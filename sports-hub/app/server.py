"""Orbital sports-hub: live scores, game centers and play trackers for Jellyfin.

Schedules, scores, polls and play-by-play come from ESPN's public site API. That API is unofficial and
undocumented; it can change without notice. Every request must carry a valid Jellyfin token. Games are
paired with the Live TV channels the signed-in viewer is already allowed to watch, by matching ESPN's
broadcast network to channel names; this service never opens or proxies video.
"""
import concurrent.futures
from datetime import date, datetime, timedelta, timezone
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

LEAGUES = {'MLB': 'baseball/mlb', 'NFL': 'football/nfl', 'College football': 'football/college-football',
           'NBA': 'basketball/nba', 'WNBA': 'basketball/wnba', 'NHL': 'hockey/nhl', 'MLS': 'soccer/usa.1',
           'UFC / MMA': 'mma/ufc'}

# The calendar day a schedule belongs to ("today", "yesterday") is decided in this zone.
ZONE = ZoneInfo(os.environ.get('SPORTS_TIMEZONE', 'America/New_York'))
CACHE, LOCK = {}, threading.Lock()
REFRESHING = {}
LIVE_BOARDS, LIVE_REFRESHING = {}, {}
# Live trackers are pre-warmed only while someone used Sports recently.
LAST_SPORTS_USE = [0.0]
PREWARM_WINDOW = 600
PREWARM_EVERY = 8
PREWARM_MAX = 16
JELLYFIN = os.environ.get('JELLYFIN_URL', 'http://jellyfin:8096').rstrip('/')
USER_AGENT = os.environ.get('SPORTS_USER_AGENT', 'orbital-sports-hub/1.0')

def get_json(url, token=None):
    headers = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
    if token:
        headers['X-Emby-Token'] = token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=8) as response:
        body = response.read(8*1024*1024+1)
        if len(body) > 8*1024*1024:
            raise ValueError('response limit')
        return json.loads(body)


CHANNEL_CACHE, CHANNEL_TTL = {}, 30


def permitted_channels(user_id, token):
    """Every channel the caller may see (Id/Number/Name only), cached per viewer for
    CHANNEL_TTL seconds. the full DTOs with current programmes cost ~0.55 s per
    board load; only these three fields are used. A new event channel is at most 30 s late
    here, and meanwhile shows as feed_status 'preparing'."""
    with LOCK:
        hit = CHANNEL_CACHE.get(user_id)
        if hit and time.time()-hit[0] < CHANNEL_TTL:
            return hit[1]
    channels = _permitted_channels(user_id, token)
    slim = [{k: c.get(k) for k in ('Id', 'Number', 'Name')} for c in channels]
    with LOCK:
        CHANNEL_CACHE[user_id] = (time.time(), slim)
        while len(CHANNEL_CACHE) > 16:
            del CHANNEL_CACHE[next(iter(CHANNEL_CACHE))]
    return slim


def _permitted_channels(user_id, token):
    """Read every page using the caller's permissions; reject incomplete inventory."""
    channels, seen, start = [], set(), 0
    while True:
        page = get_json(JELLYFIN+'/LiveTv/Channels?'+urlencode({
            'UserId': user_id, 'Limit': 1000, 'StartIndex': start, 'EnableImages': 'false',
            'EnableUserData': 'false', 'AddCurrentProgram': 'false', 'EnableTotalRecordCount': 'true'}), token)
        items = page['Items']
        total = page['TotalRecordCount']
        if not items and start < total:
            raise ValueError('Incomplete channel inventory')
        for item in items:
            if item['Id'] in seen:
                raise ValueError('Channel inventory changed during pagination')
            seen.add(item['Id'])
            channels.append(item)
        start += len(items)
        if start >= total:
            return channels


def team_name(value):
    return (value or '').replace('Athletics Athletics', 'Athletics').strip()


def poll_rank(value):
    """ESPN marks unranked teams as 99; only 1-25 is a real poll position."""
    try:
        rank = int(value)
    except (TypeError, ValueError):
        return None
    return rank if 1 <= rank <= 25 else None


RANKINGS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings'
# The AP and Coaches polls are FBS-only; the CFP committee poll joins them from late October.
# FCS/Division II/III polls in the same payload are deliberately left out.
FBS_POLLS = ('AP Top 25', 'AFCA Coaches Poll', 'College Football Playoff Rankings')
FBS_GROUP = '80'  # ESPN group id for the Football Bowl Subdivision
RANKINGS_TTL = 6*3600  # polls move on Sunday/Tuesday; there is nothing to gain from polling faster
RANKINGS = {}


def parse_rankings(payload, fetched_at=None):
    polls = []
    for poll in payload.get('rankings', []):
        if poll.get('name') not in FBS_POLLS:
            continue
        teams = []
        for entry in poll.get('ranks', []):
            team = entry.get('team', {})
            rank = poll_rank(entry.get('current'))
            if rank is None or not team.get('id'):
                continue
            # Belt and braces: a poll we call FBS must only carry FBS (group 80) teams.
            if str(team.get('groups', {}).get('parent', {}).get('id', FBS_GROUP)) != FBS_GROUP:
                continue
            # In this payload `location` is the school ("Texas"), `name` the mascot ("Longhorns") and
            # `nickname` the short name; the scoreboard's displayName is "<location> <name>".
            location, mascot = team_name(team.get('location')), team_name(team.get('name'))
            teams.append({'rank': rank, 'previous': poll_rank(entry.get('previous')), 'trend': entry.get('trend') or '-',
                          'espn_id': str(team['id']), 'name': (location+' '+mascot).strip(), 'location': location,
                          'short': team_name(team.get('nickname')) or location, 'abbreviation': team.get('abbreviation') or '',
                          'record': entry.get('recordSummary') or '',
                          'logo': team.get('logo') if str(team.get('logo', '')).startswith('https://a.espncdn.com/') else None})
        polls.append({'name': poll['name'], 'short': poll.get('shortName') or poll['name'],
                      'week': poll.get('occurrence', {}).get('number'), 'date': poll.get('date'),
                      'headline': poll.get('headline') or '', 'teams': sorted(teams, key=lambda t: t['rank'])})
    if not polls:
        raise ValueError('No FBS poll in rankings payload')
    return {'polls': polls, 'fetched_at': fetched_at or time.time(), 'stale': False}


def rankings():
    """FBS Top 25 polls, cached; a failed refresh serves the last good copy flagged stale."""
    with LOCK:
        cached = RANKINGS.get('data')
        if cached and time.time()-cached['fetched_at'] < RANKINGS_TTL:
            return cached
    try:
        fresh = parse_rankings(get_json(RANKINGS_URL))
    except Exception:
        if not cached:
            raise
        return {**cached, 'stale': True}
    with LOCK:
        RANKINGS['data'] = fresh
    return fresh


def annotate_ranks(events, polls):
    """Attach the AP rank (first FBS poll) to college football teams by ESPN id, else exact name."""
    poll = next(iter(polls or []), None)
    if not poll:
        return events
    by_id = {t['espn_id']: t['rank'] for t in poll['teams']}
    # Exact display name only: "Texas Longhorns" must never rank "Texas Tech Red Raiders".
    by_name = {t['name'].lower(): t['rank'] for t in poll['teams']}
    result = []
    for event in events:
        if event.get('league') != 'College football':
            result.append(event)
            continue
        teams = []
        for team in event.get('teams', []):
            rank = by_id.get(team.get('espn_id') or '') or by_name.get(team_name(team.get('name')).lower())
            teams.append({**team, 'rank': rank})
        result.append({**event, 'teams': teams})
    return result


WATCH_EARLY, WATCH_LATE = timedelta(minutes=15), timedelta(hours=5)


def watchable(event, now=None):
    """A game can be watched when it is live, or from 15 minutes before its scheduled
    start while ESPN still says 'scheduled' (pregame coverage is already on the feeds)."""
    if event.get('state') == 'live':
        return True
    if event.get('state') != 'scheduled':
        return False
    try:
        start = datetime.fromisoformat(str(event.get('start')).replace('Z', '+00:00'))
    except ValueError:
        return False
    now = now or datetime.now(timezone.utc)
    return start - WATCH_EARLY <= now <= start + WATCH_LATE


FINAL_CACHE = {}
DECISION_ROLES = {'winningPitcher': 'Winning pitcher', 'losingPitcher': 'Losing pitcher', 'savingPitcher': 'Save',
                  'winningGoalie': 'Winning goalie', 'losingGoalie': 'Losing goalie', 'firstStar': 'First star',
                  'secondStar': 'Second star', 'thirdStar': 'Third star'}


FINAL_TTL = 6 * 3600      # finals can still be corrected upstream (scoring changes, stars)
FINAL_MAX = 400


def final_summary(league, event_id):
    """Cached finished-game summary: revalidated after FINAL_TTL, bounded, previous copy on error."""
    key = (league, str(event_id))
    hit = FINAL_CACHE.get(key)
    if hit and time.time() - hit[0] < FINAL_TTL:
        return hit[1]
    try:
        result = _fetch_final_summary(league, event_id)
    except Exception:
        if hit:
            return hit[1]
        raise
    if result is not None:
        FINAL_CACHE.pop(key, None)
        FINAL_CACHE[key] = (time.time(), result)
        while len(FINAL_CACHE) > FINAL_MAX:
            FINAL_CACHE.pop(next(iter(FINAL_CACHE)))
    return result


def _fetch_final_summary(league, event_id):
    """What a finished game's Summary shows -- scoring plays with the running score and
    the decisions (pitchers, goalies, stars). ESPN summary endpoint."""
    if league not in LEAGUES or league in ('NBA', 'WNBA', 'UFC / MMA') or not re.fullmatch(r'[0-9]{1,12}', str(event_id)):
        return None
    data = get_json('https://site.api.espn.com/apis/site/v2/sports/' + LEAGUES[league] + '/summary?event=' + str(event_id))
    comp = next(iter(data.get('header', {}).get('competitions', [])), {})
    names = {str(c.get('id')): c.get('team', {}).get('displayName') for c in comp.get('competitors', [])}
    def clean(value, limit):
        value = ' '.join(str(value or '').split())
        return value[:limit] if value and not re.search(r'https?://', value) else ''
    rows = data.get('scoringPlays') or [p for p in data.get('plays') or [] if p.get('scoringPlay')]
    scoring = []
    for p in rows[:40]:
        period = p.get('period') or {}
        team = p.get('team') or {}
        label = clean(period.get('displayValue'), 20) or (('Q' if league in ('NFL', 'College football') else 'P') + str(period.get('number'))
                                                        if period.get('number') else '')
        scoring.append({'period': label, 'clock': clean((p.get('clock') or {}).get('displayValue'), 10) or None,
                        'team': clean(team.get('displayName') or names.get(str(team.get('id'))), 60) or None,
                        'text': clean(p.get('text'), 160), 'away': p.get('awayScore'), 'home': p.get('homeScore')})
    decisions = [{'role': DECISION_ROLES[f['name']], 'name': clean(f.get('athlete', {}).get('displayName'), 60)}
                 for f in comp.get('status', {}).get('featuredAthletes', []) if f.get('name') in DECISION_ROLES
                 and f.get('athlete', {}).get('displayName')]
    return {'scoring': [s for s in scoring if s['text']], 'decisions': decisions, 'truncated': len(rows) > 40}


def normalize(raw, league):
    status = raw.get('status', {}).get('type', {})
    state = 'live' if status.get('state') == 'in' else 'final' if status.get('completed') else 'scheduled'
    label = status.get('shortDetail') or status.get('description') or state.title()
    if state == 'scheduled' and status.get('name') != 'STATUS_DELAYED':
        label = 'Scheduled'
    if status.get('name') in ('STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED'):
        state = 'unavailable'
    competitions = raw.get('competitions', [])
    if league == 'UFC / MMA':
        # One watchable card per event, not one duplicate feed per bout. ESPN orders
        # bouts from prelims to the main event; athlete fields differ from team sports.
        main = competitions[-1] if competitions else {}
        fighters = main.get('competitors', [])
        teams = [{'name': v.get('athlete', {}).get('displayName') or v.get('athlete', {}).get('fullName') or '',
                  'score': None, 'side': 'away' if i == 0 else 'home',
                  'espn_id': str(v.get('id') or '') or None, 'rank': None}
                 for i, v in enumerate(fighters)]
        active = next((c for c in competitions if c.get('status', {}).get('type', {}).get('state') == 'in'), None)
        detail = active.get('status', {}).get('type', {}).get('shortDetail') if active else None
        label = (raw.get('shortName') or 'UFC') + ' · ' + (detail or label)
        out = {'id': str(raw['id']), 'league': league, 'name': raw.get('name') or 'UFC event',
               'start': raw['date'], 'state': state, 'status': label, 'teams': teams}
        return out | {'watchable': watchable(out)}
    competitors = next(iter(competitions), {}).get('competitors', [])
    teams = [{'name': team_name(v.get('team', {}).get('displayName', '')), 'score': v.get('score'),
              'side': v.get('homeAway'), 'espn_id': str(v.get('team', {}).get('id') or '') or None,
              'rank': poll_rank(v.get('curatedRank', {}).get('current'))} for v in competitors]
    comp = next(iter(competitions), {})
    networks = [n for b in comp.get('broadcasts', []) for n in b.get('names', []) if isinstance(n, str)]
    networks += [b['media']['shortName'] for b in comp.get('geoBroadcasts', [])
                 if isinstance((b.get('media') or {}).get('shortName'), str)]
    out = {'id': str(raw['id']), 'league': league, 'name': raw.get('name', 'Game').replace('Athletics Athletics', 'Athletics'),
           'start': raw['date'], 'state': state, 'status': label, 'teams': teams,
           'broadcasts': list(dict.fromkeys(n[:40] for n in networks))[:6]}
    return out | {'watchable': watchable(out)}


def core_event(raw, league, now=None):
    """Normalize ESPN's lower-level event endpoint.

    The scoreboard endpoint is convenient, but it is occasionally rejected at
    the edge while the core event API remains available.  Event names and IDs
    are kept intact so ESPN IDs stay stable across both endpoints.
    """
    now = now or datetime.now(timezone.utc)
    start = datetime.fromisoformat(raw['date'].replace('Z', '+00:00'))
    state, label = ('scheduled', 'Scheduled')
    status = raw.get('_resolved_status', {}).get('type', {})
    if status:
        state = 'live' if status.get('state') == 'in' else 'final' if status.get('completed') else 'scheduled'
        label = status.get('shortDetail') or status.get('description') or state.title()
        if status.get('name') in ('STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED'):
            state = 'unavailable'
    elif start < now-timedelta(hours=8):
        state, label = ('unresolved', 'Status unavailable')
    name = raw.get('name') or raw.get('shortName') or 'Game'
    separator = ' at ' if ' at ' in name else ' vs. ' if ' vs. ' in name else ' vs ' if ' vs ' in name else None
    teams = []
    if separator:
        matchup = name.split(':', 1)[-1].strip() if league == 'UFC / MMA' else name
        left, right = matchup.split(separator, 1)
        scores = raw.get('_resolved_scores', {})
        teams = [{'name': team_name(left), 'score': scores.get('away'), 'side': 'away'},
                 {'name': team_name(right), 'score': scores.get('home'), 'side': 'home'}]
    out = {'id': str(raw['id']), 'league': league, 'name': name.replace('Athletics Athletics', 'Athletics'),
           'start': raw['date'], 'state': state, 'status': label, 'teams': teams}
    return out | {'watchable': watchable(out, now)}


def core_schedule(league, chosen):
    """Read one date from ESPN Core with bounded parallel detail requests."""
    sport, slug = LEAGUES[league].split('/', 1)
    url = ('https://sports.core.api.espn.com/v2/sports/'+sport+'/leagues/'+slug+
           '/events?'+urlencode({'dates': chosen.strftime('%Y%m%d'), 'limit': 500}))
    index = get_json(url)
    items = index.get('items')
    if not isinstance(items, list) or int(index.get('count', len(items))) > 500 or index.get('pageCount', 1) not in (0, 1):
        raise ValueError('core pagination limit')
    now = datetime.now(timezone.utc)

    def load(item):
        ref = str(item.get('$ref') or '')
        if not ref.startswith(('http://sports.core.api.espn.com/', 'https://sports.core.api.espn.com/')):
            raise ValueError('unexpected core reference')
        raw = get_json('https://'+ref.split('://', 1)[1])
        start = datetime.fromisoformat(raw['date'].replace('Z', '+00:00'))
        # Resolve status and scores for the active/recent window. This keeps
        # yesterday's final scores available when ESPN's richer scoreboard is
        # temporarily unavailable, without multiplying requests for future games.
        if now-timedelta(hours=36) <= start <= now+timedelta(hours=2):
            competitions = raw.get('competitions', [])
            # A finished prelim is not a finished UFC card. Core fallback uses
            # the main event's status; the richer scoreboard owns whole-card live status.
            competition = (competitions[-1] if competitions else {}) if league == 'UFC / MMA' else next(iter(competitions), {})
            status_ref = competition.get('status', {}).get('$ref', '')
            if status_ref.startswith(('http://sports.core.api.espn.com/', 'https://sports.core.api.espn.com/')):
                try:
                    raw['_resolved_status'] = get_json('https://'+status_ref.split('://', 1)[1])
                except (OSError, ValueError, KeyError, TypeError):
                    pass
            scores = {}
            for competitor in competition.get('competitors', []):
                side = competitor.get('homeAway')
                score_ref = competitor.get('score', {}).get('$ref', '')
                if side not in ('home', 'away') or not score_ref.startswith(
                        ('http://sports.core.api.espn.com/', 'https://sports.core.api.espn.com/')):
                    continue
                try:
                    score = get_json('https://'+score_ref.split('://', 1)[1])
                    value = score.get('displayValue')
                    if value is None and score.get('value') is not None:
                        value = f"{float(score['value']):g}"
                    if value is not None:
                        scores[side] = str(value)
                except (OSError, ValueError, KeyError, TypeError):
                    pass
            if scores:
                raw['_resolved_scores'] = scores
        return core_event(raw, league, now)

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        return list(pool.map(load, items))


def schedule(day):
    """Coalesce one date without holding the cache lock over network work."""
    date.fromisoformat(day)
    with LOCK:
        old = CACHE.get(day)
        if old and time.time()-old['fetched_at'] < 120:
            return old
        pending = REFRESHING.get(day)
        owner = pending is None
        if owner:
            pending = REFRESHING[day] = threading.Event()
    if not owner:
        if old:
            return {**old, 'stale': True}
        if not pending.wait(50):
            raise TimeoutError('Schedule refresh is still running')
        with LOCK:
            ready = CACHE.get(day)
        if ready is None:
            raise ValueError('Schedule refresh failed; retry')
        return ready
    try:
        return refresh_schedule(day, old)
    finally:
        with LOCK:
            REFRESHING.pop(day, None)
            pending.set()


def refresh_schedule(day, old=None):
    # Upstream requests run outside LOCK; cached dates remain immediately usable.
    chosen = date.fromisoformat(day)
    def fetch(league):
        events, failures = {}, []
        groups = ('90', '35') if league == 'College football' else (None,)
        scoreboard_ok = False
        group_failed = False
        for group in groups:
            try:
                # ESPN's site scoreboard accepts one calendar day. The old
                # three-day range is rejected with HTTP 400 and silently
                # forced every league onto the scoreless Core fallback.
                params = {'dates': chosen.strftime('%Y%m%d')}
                if group:
                    params['groups'] = group
                payload = get_json('https://site.api.espn.com/apis/site/v2/sports/'+LEAGUES[league]+'/scoreboard?'+urlencode(params))
                if not isinstance(payload.get('events'), list):
                    raise ValueError('missing events')
                scoreboard_ok = True
                if league == 'College football' and len(payload['events']) == 25:
                    failures.append(league+' coverage may be truncated')
                for raw in payload['events']:
                    event = normalize(raw, league)
                    local_day = datetime.fromisoformat(event['start'].replace('Z', '+00:00')).astimezone(ZONE).date()
                    if local_day == chosen or (event['state'] == 'live' and chosen == datetime.now(ZONE).date()):
                        events[event['id']] = event
            except (OSError, ValueError, KeyError, TypeError):
                group_failed = True
        source = 'ESPN scoreboard'
        failed = False
        if not scoreboard_ok:
            try:
                for event in core_schedule(league, chosen):
                    events[event['id']] = event
                source = 'ESPN core fallback'
            except (OSError, ValueError, KeyError, TypeError):
                failures.append(league+' unavailable')
                failed = True
        elif group_failed:
            failures.append(league+' partly unavailable')
            failed = True
        return list(events.values()), failures, source, failed
    # Last-good is per league. A failed league (or college group) keeps its previous
    # events, marked stale, instead of disappearing because another league refreshed successfully.
    previous = {}
    for event in (old or {}).get('events', []):
        previous.setdefault(event.get('league'), []).append(event)
    events, failures, sources, stale_leagues = [], [], [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for league, (items, errors, source, failed) in zip(list(LEAGUES), pool.map(fetch, LEAGUES)):
            if failed and previous.get(league):
                have = {e['id'] for e in items}
                kept = [{**e, 'stale': True} for e in previous[league] if e['id'] not in have]
                if kept:
                    items = items + kept
                    stale_leagues.append(league)
            events.extend(items)
            failures.extend(errors)
            sources.append(source)
    if stale_leagues:
        failures.append('Showing the previous schedule for ' + ', '.join(stale_leagues) + '; status may be outdated')
    result = {'events': events, 'warnings': failures, 'fetched_at': time.time(),
              'schedule_source': 'ESPN resilient schedule endpoints' if 'ESPN core fallback' in sources else 'ESPN schedules',
              'leagues': list(LEAGUES), 'date': day, 'stale_leagues': stale_leagues}
    if failures and not events and old:
        result = {**old, 'warnings': failures+['Showing the previous schedule; status may be outdated']}
    with LOCK:
        CACHE[day] = result
        for key in list(CACHE):
            if key < (datetime.now(ZONE).date()-timedelta(days=1)).isoformat():
                del CACHE[key]
    return result


def live_scoreboard(league, day):
    """One refresh per league/date, at most every 15 s; stale state is explicit."""
    key = (league, day)
    with LOCK:
        old = LIVE_BOARDS.get(key)
        if old and time.time()-old['fetched_at'] < 15:
            return old
        pending = LIVE_REFRESHING.get(key)
        owner = pending is None
        if owner:
            pending = LIVE_REFRESHING[key] = threading.Event()
    if not owner:
        if old:
            return {**old, 'stale': True}
        if not pending.wait(10):
            raise TimeoutError('Live state refresh pending')
        with LOCK:
            if key not in LIVE_BOARDS:
                raise ValueError('Live state unavailable')
            return LIVE_BOARDS[key]
    try:
        params = {'dates': date.fromisoformat(day).strftime('%Y%m%d'), 'limit': 500}
        if league == 'College football':
            params['groups'] = FBS_GROUP
        data = get_json('https://site.api.espn.com/apis/site/v2/sports/'+LEAGUES[league]+'/scoreboard?'+urlencode(params))
        if not isinstance(data.get('events'), list):
            raise ValueError('Missing live events')
        result = {'events': data['events'], 'fetched_at': time.time(), 'stale': False}
        with LOCK:
            LIVE_BOARDS[key] = result
            while len(LIVE_BOARDS) > 32:
                del LIVE_BOARDS[next(iter(LIVE_BOARDS))]
        return result
    except Exception:
        if old:
            return {**old, 'stale': True}
        raise
    finally:
        with LOCK:
            LIVE_REFRESHING.pop(key, None)
            pending.set()


def game_state(raw, league, fetched_at, stale=False):
    """Only render graphics supported by the current provider fields, never guesses."""
    event = normalize(raw, league)
    comp = next(iter(raw.get('competitions', [])), {})
    situation = comp.get('situation') or {}
    result = {**event, 'fetched_at': fetched_at, 'stale': stale,
              'clock': raw.get('status', {}).get('displayClock'),
              'period': raw.get('status', {}).get('period'), 'graphics': None,
              'source': 'ESPN scoreboard'}
    result['venue'] = comp.get('venue', {}).get('fullName')
    result['broadcasts'] = [name for b in comp.get('broadcasts', []) for name in b.get('names', [])]
    result['statistics'] = [{'name': c.get('team', {}).get('displayName') or c.get('athlete', {}).get('displayName'),
                             'values': [{'label': s.get('shortDisplayName') or s.get('displayName') or s.get('name'), 'value': s.get('displayValue')} for s in c.get('statistics', []) if s.get('displayValue') is not None][:12],
                             'periods': [s.get('displayValue', s.get('value')) for s in c.get('linescores', [])]}
                            for c in comp.get('competitors', [])]
    if league == 'MLB':
        for row in result['statistics']:
            row['values'] = [v for v in row['values'] if str(v['label']).lower() in ('hits','runs','errors','h','r','e')]
    result['last_play'] = situation.get('lastPlay', {}).get('text') if event['state']=='live' and not stale else None
    def person(role):
        entry = situation.get(role) if isinstance(situation.get(role), dict) else {}
        athlete = entry.get('athlete') or {}
        if not athlete.get('displayName'):
            return None
        shot = athlete.get('headshot')
        shot = shot.get('href') if isinstance(shot, dict) else shot
        jersey = str(athlete.get('jersey') or '')
        position = athlete.get('position')
        position = position.get('abbreviation') if isinstance(position, dict) else position
        line = entry.get('summary')
        return {'role': role.title(), 'name': athlete['displayName'][:80],
                'jersey': jersey if re.fullmatch(r'\d{1,3}', jersey) else None,
                'position': position[:6] if isinstance(position, str) and re.fullmatch(r'[A-Z0-9]{1,6}', position) else None,
                # Official ESPN headshot only; anything else is dropped.
                'headshot': shot if isinstance(shot, str) and re.fullmatch(r'https://a\.espncdn\.com/i/headshots/[a-z]+/players/full/\d+\.png', shot) else None,
                'today': line[:80] if isinstance(line, str) and not re.search(r'https?://', line) else None}
    result['participants'] = [p for p in (person(r) for r in ('batter', 'pitcher')) if p] if event['state']=='live' and not stale else []
    if league == 'UFC / MMA':
        result['bouts'] = [{'name': c.get('headline') or 'Bout', 'status': c.get('status', {}).get('type', {}).get('detail'),
                            'fighters': [{'name': v.get('athlete', {}).get('displayName') or v.get('athlete', {}).get('fullName'), 'winner': v.get('winner') is True} for v in c.get('competitors', [])]}
                           for c in raw.get('competitions', [])]
    if stale or event['state'] != 'live':
        return result
    def integer(key, low, high):
        value = situation.get(key)
        return value if type(value) is int and low <= value <= high else None
    if league == 'MLB':
        balls, strikes, outs = integer('balls', 0, 4), integer('strikes', 0, 3), integer('outs', 0, 3)
        bases = [situation.get(k) for k in ('onFirst', 'onSecond', 'onThird')]
        if None not in (balls, strikes, outs) and all(type(v) is bool for v in bases):
            result['graphics'] = {'kind': 'baseball', 'bases': bases, 'balls': balls, 'strikes': strikes, 'outs': outs}
    elif league in ('NFL', 'College football'):
        down, distance, yard = integer('down', 1, 4), integer('distance', 0, 100), integer('yardLine', 0, 100)
        possession = str(situation.get('possession') or '')
        ids = {str(c.get('team', {}).get('id')) for c in comp.get('competitors', [])}
        if None not in (down, distance, yard) and possession in ids and situation.get('possessionText'):
            result['graphics'] = {'kind': 'football', 'down': down, 'distance': distance, 'yard_line': yard,
                                  'possession': possession, 'spot': situation['possessionText'],
                                  'description': situation.get('downDistanceText')}
    elif league in ('NBA', 'WNBA') and type(result['period']) is int and result['period'] > 0 and isinstance(result['clock'], str):
        possession = str(situation.get('possession') or '')
        ids = {str(c.get('team', {}).get('id')) for c in comp.get('competitors', [])}
        result['graphics'] = {'kind': 'basketball', 'possession': possession if possession in ids else None,
                              'period': result['period'], 'clock': result['clock']}
    elif league == 'UFC / MMA':
        live = next((c for c in raw.get('competitions', []) if c.get('status', {}).get('type', {}).get('state') == 'in'), None)
        if live and type(live.get('status', {}).get('period')) is int and isinstance(live.get('status', {}).get('displayClock'), str):
            result['graphics'] = {'kind': 'mma', 'period': live.get('status', {}).get('period'), 'clock': live.get('status', {}).get('displayClock'),
                                  'fighters': [c.get('athlete', {}).get('displayName') or c.get('athlete', {}).get('fullName') for c in live.get('competitors', [])]}
    return result


def number(value):
    try:
        return f'{float(value):g}'
    except (ValueError, TypeError):
        return ''

NETWORK_SUFFIX = re.compile(r'\s*(?:[·|-]\s*tv channel|tv channel|\(?(?:f?hd|uhd|4k|east|west)\)?)\s*$', re.I)
CHANNEL_NUMBER = re.compile(r'^\s*\d+(?:[.-]\d+)?\s+')
ALIASES = {'fs1': 'fox sports 1', 'fs2': 'fox sports 2', 'cbssn': 'cbs sports network', 'accn': 'acc network',
           'secn': 'sec network', 'btn': 'big ten network', 'nfl net': 'nfl network', 'mlb net': 'mlb network'}


def network_key(name):
    """'ESPN HD', 'ESPN - TV channel', '206 ESPN' -> 'espn'; 'FS1' -> 'fox sports 1'."""
    value = CHANNEL_NUMBER.sub('', re.sub(r'\s+', ' ', str(name or ''))).strip()
    for _ in range(3):
        value = NETWORK_SUFFIX.sub('', value).strip()
    value = value.lower()
    return ALIASES.get(value, value)


def channel_aliases(setting=None):
    """CHANNEL_ALIASES='WFLD=FOX;WBBM=CBS' maps channels named by call sign to a network."""
    extra = {}
    for pair in filter(None, (os.environ.get('CHANNEL_ALIASES', '') if setting is None else setting).split(';')):
        channel, _, network = pair.partition('=')
        if channel.strip() and network.strip():
            extra.setdefault(network_key(network), set()).add(network_key(channel))
    return extra


def attach_channels(events, channels, aliases=None):
    """Pair each game with the viewer's permitted Live TV channels that carry its broadcast network.

    Matching is exact on the normalized network name, so 'ESPN' never matches 'ESPNU'. Channels named by
    call sign (for example an antenna's 'WFLD') are matched through CHANNEL_ALIASES.
    """
    aliases = channel_aliases() if aliases is None else aliases
    by_network = {}
    for c in channels:
        key = network_key(c.get('Name'))
        if not key:
            continue
        by_network.setdefault(key, []).append(c)
        for network, names in aliases.items():
            if key in names:
                by_network.setdefault(network, []).append(c)
    result = []
    for event in events:
        sources, seen = [], set()
        if event['state'] not in ('final', 'unavailable'):
            for network in event.get('broadcasts', []):
                for c in by_network.get(network_key(network), []):
                    if c['Id'] in seen:
                        continue
                    seen.add(c['Id'])
                    sources.append({'id': c['Id'], 'name': c.get('Name') or network, 'label_short': network,
                                    'automatic': False, 'eligible': True, 'priority': len(sources),
                                    'kind': 'game', 'jellyfin_channel_id': c['Id']})
        status = 'ended' if event['state'] in ('final', 'unavailable') else 'available' if sources else 'none'
        # 'carriers' lets clients recognise that the viewer is watching this game on a regular channel and
        # keep its live tracker hidden, so the tracker never reveals a score before the picture does.
        result.append({**event, 'sources': sources[:8], 'carriers': [s['id'] for s in sources][:12],
                       'feeds_confirmed': bool(sources), 'has_candidates': bool(sources), 'feed_status': status})
    order = {'live': 0, 'scheduled': 1, 'unresolved': 2, 'unavailable': 3, 'final': 4}
    return sorted(result, key=lambda e: (order.get(e['state'], 2), e['start'], e['id']))

ROUTES = ('/sports/api/events', '/sports/api/rankings', '/sports/api/tracker', '/sports/api/preview',
          '/sports/api/team-directory', '/sports/api/team', '/sports/api/team-preferences')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, data):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if urlsplit(self.path).path != '/sports/api/team-preferences':
            return self.respond(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 16384:
                return self.respond(413, {'error': 'Preferences too large'})
            self.preference_body = json.loads(self.rfile.read(size))
        except (ValueError, OSError):
            return self.respond(400, {'error': 'Invalid preferences'})
        self.do_GET()

    def token(self):
        token = self.headers.get('X-Emby-Token')
        if not token:
            authorization = self.headers.get('X-Emby-Authorization') or self.headers.get('Authorization') or ''
            match = re.search(r'\bToken="([^"\r\n]+)"', authorization)
            token = match[1] if match else None
        return token if token and len(token) <= 512 else None

    def chosen_date(self, query):
        today = datetime.now(ZONE).date()
        chosen = date.fromisoformat(query.get('date', [today.isoformat()])[0])
        if not today - timedelta(days=1) <= chosen <= today + timedelta(days=6):
            raise ValueError('Choose yesterday or a day within the next seven days')
        return chosen

    def do_GET(self):
        try:
            path = urlsplit(self.path)
            query = parse_qs(path.query)
            if path.path == '/health':
                return self.respond(200, {'alive': True})
            game_match = re.fullmatch(r'/sports/api/game/([0-9]{1,12})/state', path.path)
            if path.path not in ROUTES and not game_match:
                return self.respond(404, {'error': 'Not found'})
            token = self.token()
            if not token:
                return self.respond(401, {'error': 'Sign in to Jellyfin to browse sports'})
            try:
                user = get_json(JELLYFIN + '/Users/Me', token)
                if path.path == '/sports/api/team-preferences':
                    import team_preferences
                    status, data = team_preferences.access(user['Id'], getattr(self, 'preference_body', None))
                    return self.respond(status, data)
                if path.path in ('/sports/api/team-directory', '/sports/api/team'):
                    import personal_teams
                    if path.path.endswith('team-directory'):
                        return self.respond(200, personal_teams.directory(query.get('league', [''])[0], get_json))
                    key = query.get('key', [''])[0]
                    return self.respond(200, {'teams': {key: personal_teams.context(key, get_json)}})
                if path.path == '/sports/api/rankings':
                    # Same sign-in gate as events, so this is not an open relay to ESPN.
                    return self.respond(200, rankings())
                if path.path in ('/sports/api/events', '/sports/api/tracker') or game_match:
                    LAST_SPORTS_USE[0] = time.time()
                if path.path == '/sports/api/tracker':
                    import tracker
                    event_id, league = query.get('event', [''])[0], query.get('league', [''])[0]
                    if league not in tracker.LEAGUES or not re.fullmatch(r'[0-9]{1,12}', event_id):
                        return self.respond(400, {'error': 'Choose a supported league and event'})
                    try:
                        return self.respond(200, tracker.CACHE.get(league, event_id, self.chosen_date(query).isoformat()))
                    except tracker.TrackerBusy:
                        return self.respond(429, {'error': 'Tracker capacity is busy. Hide an unused tracker and retry.',
                                                  'retry_after_seconds': 10})
                    except tracker.TrackerUnavailable:
                        return self.respond(503, {'error': 'Tracker data unavailable. Retry shortly.', 'retry_after_seconds': 10})
                if path.path == '/sports/api/preview':
                    import preview
                    league, event_id = query.get('league', [''])[0], query.get('event', [''])[0]
                    if league not in preview.PATHS or not re.fullmatch(r'[0-9]{1,12}', event_id):
                        return self.respond(400, {'error': 'Choose a supported league and event'})
                    try:
                        return self.respond(200, preview.get(league, event_id, get_json))
                    except (OSError, ValueError, KeyError, TypeError):
                        return self.respond(503, {'error': 'Preview unavailable. Retry shortly.'})
                if game_match:
                    league = query.get('league', [''])[0]
                    if league not in LEAGUES:
                        return self.respond(400, {'error': 'Choose a supported league'})
                    board = live_scoreboard(league, self.chosen_date(query).isoformat())
                    raw = next((e for e in board['events'] if str(e.get('id')) == game_match[1]), None)
                    if raw is None:
                        return self.respond(404, {'error': 'Game unavailable for this date and league'})
                    state = game_state(raw, league, board['fetched_at'], board['stale'])
                    if state.get('state') == 'final':
                        try:
                            state['final_summary'] = final_summary(league, game_match[1])
                        except Exception:
                            state['final_summary'] = None  # the rest of the game center still renders
                    return self.respond(200, state)
                # /sports/api/events: the day's schedule joined to this viewer's own channels.
                channels = []
                if user.get('Policy', {}).get('EnableLiveTvAccess', False):
                    channels = permitted_channels(user['Id'], token)
            except urllib.error.HTTPError as error:
                return self.respond(401 if error.code in (401, 403) else 503,
                                    {'error': 'Jellyfin authentication unavailable; sign in again or retry'})
            schedules = schedule(self.chosen_date(query).isoformat())
            events = schedules['events']
            try:
                # Ranks decorate the schedule; a rankings outage must not hide games.
                polls = rankings()['polls']
                events = annotate_ranks(events, polls)
            except Exception:
                polls = []
            return self.respond(200, {**schedules, 'events': attach_channels(events, channels),
                                      'poll': {'name': polls[0]['name'], 'week': polls[0]['week']} if polls else None})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ValueError as error:
            self.respond(400, {'error': str(error) if str(error).startswith('Choose') else 'Invalid date or upstream data'})
        except Exception:
            self.respond(503, {'error': 'Sports is temporarily unavailable. Retry shortly.'})

class Server(ThreadingHTTPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(12)
    def process_request(self, request, address):
        request.settimeout(60)
        if not self.slots.acquire(False):
            request.close()
            return
        super().process_request(request, address)
    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


def prewarm_trackers():
    """While Sports was used in the last PREWARM_WINDOW seconds, keep live games' trackers
    fresh in the background so opening a game center is a cache hit. Public ESPN data only;
    bounded to PREWARM_MAX games; one summary decode at a time (tracker fetch lock)."""
    import tracker
    while True:
        time.sleep(PREWARM_EVERY)
        try:
            if time.time() - LAST_SPORTS_USE[0] > PREWARM_WINDOW:
                continue
            today = datetime.now(ZONE).date().isoformat()
            with LOCK:
                cached = CACHE.get(today)
            live = [e for e in (cached or {}).get('events', []) if e.get('state') == 'live' and e.get('league') in tracker.LEAGUES]
            for event in live[:PREWARM_MAX]:
                day = datetime.fromisoformat(event['start'].replace('Z', '+00:00')).astimezone(ZONE).date().isoformat()
                tracker.CACHE.prefetch(event['league'], event['id'], day, inline=True)
        except Exception:
            pass

if __name__ == '__main__':
    threading.Thread(target=prewarm_trackers, daemon=True, name='tracker-prewarm').start()
    Server(('0.0.0.0', int(os.environ.get('PORT', '8080'))), Handler).serve_forever()
