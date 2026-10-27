"""Orbital Sports for Jellyfin: the customer sports service (Oct 22 2026; sources Oct 23).

Games come from the sources this server's administrator chose (sources.py): the person's own TV guide is built in;
TheSportsDB (their key), a Orbital Sports Feed address, a provider file, or ESPN's public site data are connected
by the administrator. The rich Game Center, trackers, box scores, polls and team pages need the ESPN source; without
it those answer "not available from this server's sports sources". This service never opens, proxies or records
video. Games are paired with Live TV channels the signed-in person may already watch, by broadcast network.

It listens on 127.0.0.1 only. Browsers reach it through the Orbital Sports Jellyfin plugin, which serves
/sports/api/* on Jellyfin's own address and adds a per-install secret; every request must also carry a valid
Jellyfin sign-in, which this service checks with Jellyfin itself.

Environment: PORT, JELLYFIN_URL, ORBITAL_BRIDGE_SECRET, SPORTS_DATA_DIR, ORBITAL_PARENT_PID, SPORTS_BIND,
CHANNEL_ALIASES ('WFLD=FOX;WBBM=CBS': channels named by call sign).
"""
import hmac
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

import espn_core as core
import sources
import tracker  # Verify packaged tracker modules before reporting healthy.
import personal_library
import integrations
import catalogue_sources
import catalogue_discovery
import catalogue_refresh
import provider_catalogue

VERSION = 'sports-ce-20261027-public.6'
SECRET = os.environ.get('ORBITAL_BRIDGE_SECRET', '')
JELLYFIN = os.environ.get('JELLYFIN_URL', 'http://127.0.0.1:8096').rstrip('/')
core.JELLYFIN = JELLYFIN
ROUTES = {'/sports/api/status', '/sports/api/events', '/sports/api/rankings', '/sports/api/tracker',
          '/sports/api/preview', '/sports/api/recap', '/sports/api/boxscore', '/sports/api/pitch-flight',
          '/sports/api/batter-profile', '/sports/api/team-directory', '/sports/api/team', '/sports/api/teams',
          '/sports/api/team-preferences', '/sports/api/team-videos', '/sports/api/team-hub', '/sports/api/game-explorer',
          '/sports/api/sources', '/sports/api/sources/addons', '/sports/api/integrations', '/sports/api/catalogues/import', '/sports/api/catalogues/discover', '/sports/api/catalogue'}
GAME = re.compile(r'/sports/api/game/([0-9]{1,12})/state')
# Built on ESPN's public site data: answered only when the administrator switched that source on.
ESPN_ONLY = {'/sports/api/tracker', '/sports/api/preview', '/sports/api/recap', '/sports/api/boxscore',
             '/sports/api/pitch-flight', '/sports/api/batter-profile', '/sports/api/team-directory', '/sports/api/team',
             '/sports/api/team-videos', '/sports/api/team-hub', '/sports/api/game-explorer'}
NOT_FROM_SOURCES = {'error': "Not available from this server's sports sources", 'needs_source': 'espn-public'}

def current_plan():
    import entitlements
    data_dir = os.environ.get('SPORTS_DATA_DIR')
    code = os.environ.get('ORBITAL_CODE', '')
    if not code and data_dir:
        try:
            code = open(os.path.join(data_dir, 'orbital-code.txt'), encoding='utf-8').read(4096)
        except OSError:
            code = ''
    return entitlements.plan(code, data_dir)






def jellyfin_json(path, token):
    """Jellyfin with the person's own sign-in, sent the modern way: fresh Jellyfin 12 servers refuse the legacy
    X-Emby-Token header unless an administrator turns legacy authorization back on."""
    request = urllib.request.Request(JELLYFIN + path, headers={
        'Accept': 'application/json', 'User-Agent': 'OrbitalSports/' + VERSION,
        'Authorization': 'MediaBrowser Client="Orbital Sports", Device="Sports service", DeviceId="orbital-sports", '
                         'Version="1", Token="' + token.replace('"', '') + '"'})
    with urllib.request.urlopen(request, timeout=8) as response:
        body = response.read(8 * 1024 * 1024 + 1)
    if len(body) > 8 * 1024 * 1024:
        raise ValueError('response limit')
    return json.loads(body)


# ---------- the viewer's own channels ----------
CHANNELS, CHANNEL_TTL, CHANNEL_LOCK = {}, 30, threading.Lock()


def permitted_channels(user_id, token):
    """Every Live TV channel this person may watch (names and ids only), cached 30 s per person."""
    with CHANNEL_LOCK:
        hit = CHANNELS.get(user_id)
    if hit and time.time() - hit[0] < CHANNEL_TTL:
        return hit[1]
    channels, start = [], 0
    while True:
        page = jellyfin_json('/LiveTv/Channels?' + urlencode({
            'UserId': user_id, 'Limit': 500, 'StartIndex': start, 'EnableImages': 'false', 'EnableUserData': 'false',
            'EnableTotalRecordCount': 'true'}), token)
        items = page.get('Items') or []
        channels.extend({'Id': c.get('Id'), 'Name': c.get('Name'), 'Number': c.get('ChannelNumber')} for c in items if c.get('Id'))
        start += len(items)
        if not items or start >= int(page.get('TotalRecordCount') or 0) or start >= 5000:
            break
    with CHANNEL_LOCK:
        CHANNELS[user_id] = (time.time(), channels)
        while len(CHANNELS) > 32:
            CHANNELS.pop(next(iter(CHANNELS)))
    return channels


NETWORK_SUFFIX = re.compile(r'\s*(?:[·|-]\s*tv channel|tv channel|\(?(?:f?hd|uhd|4k|east|west)\)?)\s*$', re.I)
CHANNEL_NUMBER = re.compile(r'^\s*\d+(?:[.-]\d+)?\s+')
ALIASES = {'fs1': 'fox sports 1', 'fs2': 'fox sports 2', 'cbssn': 'cbs sports network', 'accn': 'acc network',
           'secn': 'sec network', 'btn': 'big ten network', 'nfl net': 'nfl network', 'mlb net': 'mlb network',
           'espnu': 'espnu', 'nbcsn': 'nbc sports network', 'tru tv': 'trutv'}


def network_key(name):
    """'ESPN HD', 'ESPN - TV channel', '206 ESPN' -> 'espn'; 'FS1' -> 'fox sports 1'. 'ESPN' never matches 'ESPNU'."""
    value = CHANNEL_NUMBER.sub('', re.sub(r'\s+', ' ', str(name or ''))).strip()
    for _ in range(3):
        value = NETWORK_SUFFIX.sub('', value).strip()
    value = value.lower()
    return ALIASES.get(value, value)


def channel_aliases(setting=None):
    extra = {}
    for pair in filter(None, (os.environ.get('CHANNEL_ALIASES', '') if setting is None else setting).split(';')):
        channel, _, network = pair.partition('=')
        if channel.strip() and network.strip():
            extra.setdefault(network_key(network), set()).add(network_key(channel))
    return extra


def attach_channels(events, channels, aliases=None, now=None):
    """Pair each game with the person's permitted channels that carry its broadcast network.

    'carriers' lets the player recognise that the person is watching this game, so that game's tracker is held to
    their picture (estimated delay plus one-press sync) instead of running ahead of it.
    """
    aliases = channel_aliases() if aliases is None else aliases
    now = now or datetime.now(timezone.utc)
    by_network = {}
    for c in channels:
        key = network_key(c.get('Name'))
        if not key:
            continue
        by_network.setdefault(key, []).append(c)
        for network, names in aliases.items():
            if key in names:
                by_network.setdefault(network, []).append(c)
    by_id = {c['Id']: c for c in channels}
    result = []
    for event in events:
        try:
            watchable = core.watchable(event, now)
        except (TypeError, ValueError, OverflowError):
            watchable = False
        networks = event.get('networks') or event.get('broadcasts') or []
        sources, seen = [], set()
        if event.get('state') not in ('final', 'unavailable'):
            # Channels the person's own guide lists for this game come first, then any channel of a listed network.
            guide = [(by_id[i].get('Name') or '', [by_id[i]]) for i in event.get('guide_channels') or [] if i in by_id]
            for network, found in guide + [(n, by_network.get(network_key(n), [])) for n in networks]:
                for c in found:
                    if c['Id'] in seen:
                        continue
                    seen.add(c['Id'])
                    # Each carrier is an ordinary channel the viewer can open. 'automatic' means a household
                    # fallback parent in the shell, which is never offered as a Watch choice, so it stays False here;
                    # the shell plays the first automatic_eligible source (lowest priority) and falls back in order.
                    sources.append({'id': c['Id'], 'name': c.get('Name') or network, 'label': c.get('Name') or network,
                                    'label_short': network, 'network': network, 'kind': 'game', 'priority': len(sources),
                                    'automatic': False, 'eligible': watchable, 'automatic_eligible': watchable,
                                    'manual_available': True, 'jellyfin_channel_id': c['Id']})
        status = 'ended' if event.get('state') in ('final', 'unavailable') else 'available' if sources else 'none'
        result.append({**event, 'watchable': watchable, 'sources': sources[:8], 'carriers': [s['id'] for s in sources][:12],
                       'feeds_confirmed': bool(sources), 'has_candidates': bool(sources), 'feed_status': status})
    return result


# ---------- requests ----------
def chosen_day(query, back=7, ahead=6):
    today = datetime.now(core.ZONE).date()
    chosen = date.fromisoformat(query.get('date', [today.isoformat()])[0])
    if not today - timedelta(days=back) <= chosen <= today + timedelta(days=ahead):
        raise ValueError('Choose a day within the supported window')
    return today, chosen


class Handler(BaseHTTPRequestHandler):
    server_version = 'OrbitalSports'
    sys_version = ''

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

    def bridged(self):
        return not SECRET or hmac.compare_digest(self.headers.get('X-Orbital-Bridge', ''), SECRET)

    def token(self):
        token = self.headers.get('X-Emby-Token') or self.headers.get('X-MediaBrowser-Token')
        if not token:
            authorization = self.headers.get('X-Emby-Authorization') or self.headers.get('Authorization') or ''
            match = re.search(r'\bToken="([^"\r\n]+)"', authorization)
            token = match[1] if match else None
        return token if token and len(token) <= 512 else None

    def do_POST(self):
        if not self.bridged():
            return self.respond(403, {'error': 'Not available'})
        target = urlsplit(self.path).path
        if target.startswith('/sports/api/experience/v1/'):
            return self.personal_request()
        if target not in ('/sports/api/team-preferences', '/sports/api/sources', '/sports/api/sources/addons', '/sports/api/integrations', '/sports/api/catalogues/import'):
            return self.respond(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > (32 * 1024 * 1024 if target.endswith('/catalogues/import') else 600 * 1024 if target.endswith('/addons') else 16384):
                return self.respond(413, {'error': 'Preferences too large'})
            self.body = json.loads(self.rfile.read(size))
        except (ValueError, OSError):
            return self.respond(400, {'error': 'Invalid preferences'})
        self.do_GET()

    def do_GET(self):
        try:
            path = urlsplit(self.path)
            if path.path == '/health':
                return self.respond(200, {'alive': True, 'version': VERSION})
            if not self.bridged():
                return self.respond(403, {'error': 'Not available'})
            if path.path.startswith('/sports/api/experience/v1/'):
                return self.personal_request()
            game = GAME.fullmatch(path.path)
            if path.path not in ROUTES and not game:
                return self.respond(404, {'error': 'Not part of this edition'})
            token = self.token()
            if not token:
                return self.respond(401, {'error': 'Sign in to Jellyfin to browse sports'})
            try:
                user = jellyfin_json('/Users/Me', token)
            except urllib.error.HTTPError as error:
                return self.respond(401 if error.code in (401, 403) else 503,
                                    {'error': 'Jellyfin sign-in unavailable; sign in again or retry'})
            return self.route(path, game, user, token)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ValueError as error:
            self.respond(400, {'error': str(error) if str(error).startswith('Choose') else 'Invalid date or upstream data'})
        except Exception:
            self.respond(503, {'error': 'Sports is temporarily unavailable. Retry shortly.'})

    def personal_request(self):
        if not self.bridged():
            return self.respond(403, {'error': 'Not available'})
        try:
            raw = b''
            if self.command == 'POST':
                size = int(self.headers.get('Content-Length', '0'))
                if not 1 <= size <= 65536 or self.headers.get('Transfer-Encoding'):
                    return self.respond(413, {'error': 'Request too large'})
                raw = self.rfile.read(size)
                if len(raw) != size:
                    return self.respond(400, {'error': 'Incomplete request'})
            def fetch(url, credential):
                if not url.startswith(JELLYFIN + '/'):
                    raise ValueError('Unexpected library origin')
                return jellyfin_json(url[len(JELLYFIN):], credential)
            code, data = personal_library.dispatch(self.command, self.path, dict(self.headers),
                                                    raw, JELLYFIN, fetch)
            return self.respond(code, data)
        except (ValueError, OSError):
            return self.respond(503, {'error': 'Personal library is temporarily unavailable'})

    def route(self, path, game, user, token):
        query = parse_qs(path.query, keep_blank_values=True)
        one = lambda key: (query.get(key) or [''])[0]
        p = path.path
        if p == '/sports/api/catalogues/discover':
            if not user.get('Policy', {}).get('IsAdministrator'):
                return self.respond(403, {'error':'Only an administrator can connect catalogues'})
            return self.respond(200, catalogue_discovery.page(one('provider'), one('kind'), int(one('page'))))
        if p == '/sports/api/catalogues/import':
            if not user.get('Policy', {}).get('IsAdministrator'):
                return self.respond(403, {'error':'Only an administrator can connect catalogues'})
            return self.respond(200, catalogue_sources.save(self.body) if hasattr(self,'body') else {**catalogue_sources.status(), 'refresh': catalogue_refresh.status()})
        if p == '/sports/api/catalogue':
            def fetch(url, credential):
                if not url.startswith(JELLYFIN+'/'):raise ValueError('Unexpected library origin')
                return jellyfin_json(url[len(JELLYFIN):],credential)
            return self.respond(200,provider_catalogue.catalogue(query,user,token,fetch,JELLYFIN))
        if p == '/sports/api/integrations':
            if not user.get('Policy', {}).get('IsAdministrator'):
                return self.respond(403, {'error': 'Only an administrator can configure integrations'})
            try:
                data = integrations.save(self.body) if hasattr(self,'body') else integrations.masked()
                return self.respond(200,data)
            except Exception:
                return self.respond(400, {'error': 'Could not verify or save the integration. Check the address, API key and service availability.'})
        if p == '/sports/api/status':
            plan = current_plan()
            return self.respond(200, {'edition': 'customer', 'version': VERSION, 'sports': True,
                                      'personal_library': personal_library.enabled(),
                                      'services': bool(os.environ.get('SPORTS_DATA_DIR') and catalogue_sources.status()['catalogues']),
                                      'requests': bool(os.environ.get('SPORTS_DATA_DIR') and integrations.load().get('requests',{}).get('enabled')),
                                      'watched_game': 'estimated-delay-with-sync',
                                      'picture_lock': plan['plus']['picture-lock']['on'], 'plan': plan,
                                      'sources': [s['type'] for s in sources.load_settings()['sources']],
                                      'rich_game_details': sources.espn_enabled()})
        if p == '/sports/api/sources':
            if not user.get('Policy', {}).get('IsAdministrator'):
                return self.respond(403, {'error': 'Only a server administrator can see or change sports sources'})
            body = getattr(self, 'body', None)
            if body is not None:
                try:
                    sources.save_settings(body)
                except ValueError as error:
                    return self.respond(400, {'error': str(error)})
            return self.respond(200, sources.masked(sources.load_settings()))
        if p == '/sports/api/sources/addons':
            if not user.get('Policy', {}).get('IsAdministrator'):
                return self.respond(403, {'error': 'Only a server administrator can add sports add-ons'})
            body = getattr(self, 'body', None)
            if not isinstance(body, dict):
                return self.respond(200, {'addons': sources.masked(sources.load_settings())['addons']})
            try:
                action = body.get('action')
                if action == 'inspect':
                    code = body['code'] if isinstance(body.get('code'), str) else sources.addon_from_url(body.get('url'))
                    return self.respond(200, sources.stage_addon(code))
                if action == 'install':
                    return self.respond(200, {'installed': sources.install_addon(body.get('pending'), body.get('runs_code'),
                                                                                body.get('terms'))})
                if action == 'remove':
                    sources.remove_addon(str(body.get('module', '')))
                    return self.respond(200, {'removed': body['module']})
            except ValueError as error:
                return self.respond(400, {'error': str(error)})
            return self.respond(400, {'error': 'Choose inspect, install or remove'})
        if p == '/sports/api/team-preferences':
            import team_preferences
            status, data = team_preferences.access(user['Id'], getattr(self, 'body', None))
            return self.respond(status, data)
        def tracker_response(model):
            if one('view') != 'estimated':
                return self.respond(200, model)
            import estimated_view
            try:
                cutoff = float(one('cutoff')) if one('cutoff') else None
                return self.respond(200, estimated_view.project(model, cutoff))
            except (ValueError, OverflowError):
                return self.respond(400, {'error': 'Choose a valid tracker time'})

        if p in ('/sports/api/events', '/sports/api/tracker') or game:
            core.LAST_SPORTS_USE[0] = time.time()
        espn = sources.espn_enabled()
        if p == '/sports/api/rankings':
            if not espn:
                return self.respond(200, {'polls': [], 'fetched_at': time.time(), 'stale': False, 'unavailable': True})
            return self.respond(200, core.rankings(progressive=True))
        source_game = (one('event') if p == '/sports/api/tracker' else game[1] if game else '')
        if len(source_game) == 12 and source_game.startswith('7') or game and not espn:
            # A game from the guide, TheSportsDB, a feed, a provider file or an add-on: its plays (when the source
            # has them) drive the same Game Center and trackers.
            _, chosen = chosen_day(query, 400, 220)
            fetch = (lambda path: jellyfin_json(path, token)) if user.get('Policy', {}).get('EnableLiveTvAccess', False) else None
            event = sources.find(source_game, chosen.isoformat(), fetch, user['Id'])
            if event is None:
                return self.respond(404, {'error': 'Game unavailable for this date and league'})
            plays = sources.detail(event)
            view = sources.tracker_view(event, plays)
            if p == '/sports/api/tracker':
                return tracker_response(view)
            used = ', '.join(dict.fromkeys(event.get('sources_used') or [event['source']]))
            return self.respond(200, {**event, 'fetched_at': time.time(), 'stale': False, 'situation': None,
                                      'tracker_available': view['tracking_available'], 'line_score': view.get('line_score'),
                                      'recent_plays': view['recent'],
                                      'details': ('Plays, score and schedule from ' if plays else 'Score and schedule from ') + used})
        if p in ESPN_ONLY and not espn:
            return self.respond(404, NOT_FROM_SOURCES)
        if p == '/sports/api/teams':
            return self.respond(200, {'teams': {}, 'fetched_at': time.time(), 'stale': False})
        if p in ('/sports/api/team-directory', '/sports/api/team'):
            import personal_teams
            if p.endswith('team-directory'):
                return self.respond(200, personal_teams.directory(one('league'), core.get_json))
            return self.respond(200, {'teams': {one('key'): personal_teams.context(one('key'), core.get_json)}})
        if p == '/sports/api/team-hub':
            import team_hub
            if one('league') not in team_hub.ROUTES:
                return self.respond(400, {'error': 'Unknown league'})
            return self.respond(200, team_hub.team_hub(one('league'), lambda: core.rankings(progressive=True)))
        if p == '/sports/api/team-videos':
            import preview, personal_teams
            try:
                ctx = personal_teams.context(one('key'), core.get_json)
            except (ValueError, KeyError):
                return self.respond(400, {'error': 'Choose a supported team'})
            team = {'id': ctx['id'], 'name': ctx['name'], 'short': ctx.get('short') or ctx['name'], 'location': ctx.get('location'),
                    'nickname': ctx.get('nickname'), 'abbr': ctx.get('abbr'), 'pro': ctx['league'] != 'College football'}
            return self.respond(200, preview.team_reels(ctx['league'], team, ctx.get('schedule') or [], core.get_json))
        if p in ('/sports/api/pitch-flight', '/sports/api/batter-profile', '/sports/api/boxscore'):
            import boxscore
            try:
                if p.endswith('pitch-flight'):
                    return self.respond(200, boxscore.pitch_flight(one('date'), one('away'), one('home')))
                if p.endswith('batter-profile'):
                    return self.respond(200, boxscore.batter_profile(one('mlbam'), one('before')))
                if one('league') not in boxscore.LEAGUES or not re.fullmatch(r'[0-9]{1,12}', one('event')):
                    return self.respond(400, {'error': 'Choose a supported league and event'})
                return self.respond(200, boxscore.get(one('league'), one('event')))
            except boxscore.NotFound:
                return self.respond(404, {'error': 'Game not found'})
        if p in ('/sports/api/preview', '/sports/api/recap'):
            import preview
            if one('league') not in preview.PATHS or not re.fullmatch(r'[0-9]{1,12}', one('event')):
                return self.respond(400, {'error': 'Choose a supported league and event'})
            handler = preview.recap if p.endswith('recap') else preview.get
            try:
                return self.respond(200, handler(one('league'), one('event'), core.get_json))
            except (OSError, ValueError, KeyError, TypeError):
                return self.respond(503, {'error': 'Not available right now. Retry shortly.'})
        if p == '/sports/api/game-explorer':
            import tracker, game_explorer
            if not re.fullmatch(r'[0-9]{1,12}', one('event')) or one('league') not in game_explorer.KINDS or one('league') not in tracker.LEAGUES:
                return self.respond(400, {'error': 'Unknown game'})
            try:
                return self.respond(200, game_explorer.game_explorer(one('league'), one('event'), tracker.fetch_summary))
            except tracker.TrackerNotFound:
                return self.respond(404, {'error': 'No such game'})
        if p == '/sports/api/tracker':
            import tracker
            if one('league') not in tracker.LEAGUES or not re.fullmatch(r'[0-9]{1,12}', one('event')):
                return self.respond(400, {'error': 'Choose a supported league and event'})
            _, chosen = chosen_day(query, 400, 220)
            try:
                return tracker_response(tracker.CACHE.get(one('league'), one('event'), chosen.isoformat()))
            except tracker.TrackerBusy:
                return self.respond(429, {'error': 'Tracker capacity is busy. Hide an unused tracker and retry.', 'retry_after_seconds': 10})
            except tracker.TrackerNotFound:
                return self.respond(404, {'error': 'Game not found'})
            except tracker.TrackerUnavailable:
                return self.respond(503, {'error': 'Tracker data unavailable. Retry shortly.', 'retry_after_seconds': 10})
        if game:
            import tracker
            league = one('league')
            if league not in core.LEAGUES:
                return self.respond(400, {'error': 'Choose a supported league'})
            _, chosen = chosen_day(query, 400, 220)
            board = core.live_scoreboard(league, chosen.isoformat())
            raw = next((e for e in board['events'] if str(e.get('id')) == game[1]), None)
            if raw is None:
                return self.respond(404, {'error': 'Game unavailable for this date and league'})
            state = core.game_state(raw, league, board['fetched_at'], board['stale'])
            if league in ('MLB', 'NFL', 'College football') and state.get('state') in ('live', 'final'):
                try:
                    tracker.CACHE.get(league, game[1], chosen.isoformat())
                except (tracker.TrackerBusy, tracker.TrackerUnavailable, tracker.TrackerNotFound, ValueError):
                    pass
                state = core._report_health_split(state, tracker.CACHE.decorate(state, chosen.isoformat()))
            if state.get('state') == 'final':
                try:
                    state['final_summary'] = core.final_summary(league, game[1])
                except Exception:
                    state['final_summary'] = None
            return self.respond(200, state)
        return self.events(query, user, token)

    def events(self, query, user, token):
        target = core.event_metadata_target(query)
        cards = query.get('projection') == ['cards']
        channels = []
        if not cards and user.get('Policy', {}).get('EnableLiveTvAccess', False):
            try:
                channels = permitted_channels(user['Id'], token)
            except (OSError, ValueError, KeyError, TypeError):
                channels = []
        today, chosen = chosen_day(query)
        live_tv = user.get('Policy', {}).get('EnableLiveTvAccess', False)
        fetch = (lambda path: jellyfin_json(path, token)) if live_tv else None
        schedules = sources.board(chosen.isoformat(), fetch, user['Id'])  # board_reported_event applied per source
        warnings = list(schedules.get('warnings', []))
        events = schedules['events']
        polls = []
        if sources.espn_enabled():
            try:
                polls = core.rankings(progressive=True)['polls']
                events = core.annotate_ranks(events, polls)
            except Exception:
                polls = []
        band = (query.get('band') or [None])[0]
        followed = []
        if band:
            import team_preferences
            followed = team_preferences.access(user['Id'])[1].get('teams', [])
        selected = core.page_events({**schedules, 'events': events}, band, followed)
        if target is not None:
            matches = [e for e in events if str(e.get('id')) == target[0] and e.get('league') == target[1]]
            if not matches and schedules.get('metadata_pending') is not True:
                return self.respond(404, {'error': 'Game unavailable for this date and league'})
            selected = {**selected, 'events': matches, 'event_selection': {
                'event_id': target[0], 'league': target[1], 'status': 'ready' if matches else 'pending'}}
        pending = schedules.get('metadata_pending') is True
        rows = ([core.card_metadata_event(e) for e in selected['events']] if cards
                else attach_channels(selected['events'], channels))
        payload = {**selected, 'warnings': warnings, 'events': rows, 'metadata_pending': pending,
                   **({'retry_after_seconds': 2} if pending else {}),
                   'poll': {'name': polls[0]['name'], 'week': polls[0]['week']} if polls else None}
        if cards:
            payload.update(source_projection='deferred', schedule_scope='full_day')
        return self.respond(200, payload)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(16)

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
    """While Sports was used in the last 10 minutes, keep live games' trackers fresh (public data only)."""
    import tracker
    while True:
        time.sleep(core.PREWARM_EVERY)
        try:
            if time.time() - core.LAST_SPORTS_USE[0] > core.PREWARM_WINDOW or not sources.espn_enabled():
                continue
            today = datetime.now(core.ZONE).date().isoformat()
            with core.LOCK:
                cached = core.CACHE.get(today)
            live = [e for e in (cached or {}).get('events', []) if e.get('state') == 'live' and e.get('league') in tracker.LEAGUES]
            for event in live[:core.PREWARM_MAX]:
                day = datetime.fromisoformat(event['start'].replace('Z', '+00:00')).astimezone(core.ZONE).date().isoformat()
                tracker.CACHE.prefetch(event['league'], event['id'], day, inline=True)
        except Exception:
            pass


def parent_alive(pid):
    if pid <= 0:
        return True
    if sys.platform == 'win32':
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return False
        try:
            return ctypes.windll.kernel32.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT: still running
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def watch_parent(pid):
    """Exit when the Jellyfin process that started this service is gone (no orphaned helpers)."""
    while True:
        time.sleep(5)
        if not parent_alive(pid):
            os._exit(0)


def main():
    data = os.environ.get('SPORTS_DATA_DIR')
    if data:
        os.makedirs(data, exist_ok=True)
    bind = os.environ.get('SPORTS_BIND', '127.0.0.1')
    if bind != '127.0.0.1' and not SECRET and os.environ.get('SPORTS_STANDALONE') != '1':
        raise SystemExit('Refusing to listen beyond loopback without a bridge secret or explicit standalone deployment')
    parent = int(os.environ.get('ORBITAL_PARENT_PID') or 0)
    if parent:
        threading.Thread(target=watch_parent, args=(parent,), daemon=True, name='parent-watch').start()
    threading.Thread(target=prewarm_trackers, daemon=True, name='tracker-prewarm').start()
    threading.Thread(target=catalogue_refresh.run, daemon=True, name='catalogue-refresh').start()
    server = Server((bind, int(os.environ.get('PORT', '8765'))), Handler)
    print(json.dumps({'listening': server.server_address[1], 'version': VERSION}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
