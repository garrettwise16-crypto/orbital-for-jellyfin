"""Where Orbital Sports gets its games (customer edition, Oct 23 2026).

Owner direction: Orbital pays for no data until there is profit, and anything that costs money stays on the user's
side. So the free edition has one built-in source that costs nothing, the person's own TV guide, and everything else is
a source the server's administrator connects with their own account and key:

  guide         Sports programmes in this person's own Jellyfin TV guide: which games are on, when, on which channel.
  thesportsdb   TheSportsDB with the administrator's own key: schedules, scores, team badges.
  feed          A URL returning the Orbital Sports Feed format (SOURCES.md). No code runs.
  file          A Python module in <data dir>/sources/ defining games(day). Runs on their own server, under their terms.
  espn-public   ESPN's public site data (the rich Game Center, trackers, box scores). Off unless switched on.

Settings live in <data dir>/sources.json; only Jellyfin administrators can read or change them (keys are never
returned in full). Every source returns games in one shape, the same shape the Orbital Sports pages already use, and
the service merges them: a connected source's facts win over the guide's, the guide supplies the channels.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit

FORMAT = 'orbital-sports-feed/1'
LEAGUES = ('MLB', 'NFL', 'NBA', 'WNBA', 'NHL', 'MLS', 'College football')
STATES = ('scheduled', 'live', 'final', 'postponed', 'canceled')
TYPES = ('guide', 'thesportsdb', 'feed', 'file', 'espn-public')
DEFAULT = {'sources': [{'type': 'guide'}]}
TTL = 60
SPORTSDB_TTL = 180  # 14 requests per refresh; free keys are rate-limited
FEED_LIMIT = 4 * 1024 * 1024
USER_AGENT = 'OrbitalSports-sources/1'


# ---------- settings ----------
def data_dir() -> Path | None:
    value = os.environ.get('SPORTS_DATA_DIR')
    return Path(value) if value else None


def load_settings() -> dict:
    folder = data_dir()
    path = folder / 'sources.json' if folder else None
    if not path or not path.is_file():
        return json.loads(json.dumps(DEFAULT))
    try:
        return validate_settings(json.loads(path.read_text(encoding='utf-8')))
    except (OSError, ValueError):
        return json.loads(json.dumps(DEFAULT))


def validate_settings(raw) -> dict:
    """Strict: unknown types, bad URLs, odd keys or file names are refused, not ignored."""
    if not isinstance(raw, dict) or not isinstance(raw.get('sources'), list) or len(raw['sources']) > 12:
        raise ValueError('Settings need a "sources" list (at most 12)')
    out = []
    for item in raw['sources']:
        if not isinstance(item, dict) or item.get('type') not in TYPES:
            raise ValueError('Unknown source type; use one of: ' + ', '.join(TYPES))
        clean = {'type': item['type']}
        if item.get('name') is not None:
            clean['name'] = text(item['name'], 40)
        if 'leagues' in item:
            leagues = item['leagues']
            if not isinstance(leagues, list) or any(x not in LEAGUES for x in leagues):
                raise ValueError('leagues must be a list of: ' + ', '.join(LEAGUES))
            clean['leagues'] = leagues
        if item['type'] == 'thesportsdb':
            key = str(item.get('key', ''))
            if not re.fullmatch(r'[A-Za-z0-9]{1,64}', key):
                raise ValueError('TheSportsDB needs your API key (letters and digits)')
            clean['key'] = key
        if item['type'] == 'feed':
            url = str(item.get('url', ''))
            parts = urlsplit(url)
            if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or len(url) > 500:
                raise ValueError('A feed needs an http(s) address without a user name or password in it')
            clean['url'] = url
            if item.get('token') is not None:
                clean['token'] = text(item['token'], 200)
        if item['type'] == 'file':
            module = str(item.get('module', ''))
            if not re.fullmatch(r'[a-z][a-z0-9_]{0,40}', module):
                raise ValueError('A provider file is named like my_source (lower case, digits, underscores)')
            clean['module'] = module
            if item.get('addon') is not None:
                clean['addon'] = clean_addon_record(item['addon'])
        out.append(clean)
    return {'sources': out}


KEEP = '__keep__'  # "keep the saved key": settings screens only ever see shortened keys


def save_settings(raw) -> dict:
    if isinstance(raw, dict) and isinstance(raw.get('sources'), list):
        current = load_settings()['sources']
        for item in raw['sources']:
            for secret in ('key', 'token'):
                if isinstance(item, dict) and item.get(secret) == KEEP:
                    old = next((c for c in current if c['type'] == item.get('type') and secret in c and
                                c.get('url') == item.get('url')), None)
                    if old is None:
                        raise ValueError('There is no saved %s to keep for %s' % (secret, item.get('type')))
                    item[secret] = old[secret]
    settings = validate_settings(raw)
    folder = data_dir()
    if not folder:
        raise ValueError('This server has no data folder for settings')
    folder.mkdir(parents=True, exist_ok=True)
    temp = folder / 'sources.json.tmp'
    temp.write_text(json.dumps(settings, indent=2), encoding='utf-8')
    os.replace(temp, folder / 'sources.json')
    with LOCK:
        CACHE.clear()
    return settings


def masked(settings: dict) -> dict:
    """For the admin page: keys and tokens shortened, never returned whole."""
    out = []
    for item in settings['sources']:
        item = dict(item)
        for secret in ('key', 'token'):
            if secret in item:
                item[secret] = item[secret][:2] + '…' if len(item[secret]) > 3 else '…'
        out.append(item)
    return {'sources': out, 'types': list(TYPES), 'leagues': list(LEAGUES), 'format': FORMAT,
            'addons': [dict(s['addon'], module=s['module']) for s in settings['sources'] if s.get('addon')]}


# ---------- add-ons: provider files someone else wrote, installed with a deliberate confirmation ----------
# Orbital publishes only this mechanism and the format. An add-on describes itself in a literal ADDON = {...}
# (read without running the file), the administrator sees who wrote it, what it provides and whose terms apply, and
# confirms both that it runs code on this server and that they accept those terms. The approved file's SHA-256 is
# kept: if the file changes afterwards it stops running until it is approved again.
ADDON_LIMIT = 256 * 1024
PROVIDES = ('schedule', 'scores', 'plays')
PENDING_MAX_AGE = 3600


def https_url(value, limit=300) -> str | None:
    value = str(value or '').strip()
    parts = urlsplit(value)
    return value if parts.scheme == 'https' and parts.hostname and not parts.username and len(value) <= limit else None


def clean_addon_record(raw) -> dict:
    if not isinstance(raw, dict) or not re.fullmatch(r'[0-9a-f]{64}', str(raw.get('sha256', ''))):
        raise ValueError('Add-on record needs the approved file fingerprint')
    record = {'name': text(raw.get('name'), 60), 'author': text(raw.get('author'), 60),
              'version': text(raw.get('version'), 20), 'sha256': raw['sha256'], 'terms': text(raw.get('terms'), 60),
              'accepted_at': text(raw.get('accepted_at'), 25), 'details': bool(raw.get('details')),
              'provides': [p for p in raw.get('provides') or [] if p in PROVIDES]}
    if not record['name'] or not record['author']:
        raise ValueError('Add-on record needs a name and an author')
    return record


def addon_manifest(code: str) -> dict:
    """The add-on's own description, read with the parser only: nothing in the file runs here."""
    import ast
    try:
        tree = ast.parse(code)
    except SyntaxError as error:
        raise ValueError('This is not a valid Python file (line %s)' % error.lineno)
    raw, functions = None, set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and [getattr(t, 'id', None) for t in node.targets] == ['ADDON']:
            try:
                raw = ast.literal_eval(node.value)
            except ValueError:
                raise ValueError('ADDON must be written out as plain values (no code inside it)')
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.add(node.name)
    if not isinstance(raw, dict):
        raise ValueError('This file has no ADDON = {...} description, so it is not a Orbital Sports add-on')
    if 'games' not in functions:
        raise ValueError('An add-on must define games(day)')
    manifest = {'name': text(raw.get('name'), 60), 'author': text(raw.get('author'), 60),
                'version': text(raw.get('version'), 20), 'description': text(raw.get('description'), 300),
                'terms': text(raw.get('terms'), 60), 'terms_url': https_url(raw.get('terms_url')),
                'homepage': https_url(raw.get('homepage')), 'details': 'game' in functions,
                'provides': [p for p in raw.get('provides') or ['schedule', 'scores'] if p in PROVIDES],
                'leagues': [lg for lg in raw.get('leagues') or [] if lg in LEAGUES]}
    if not manifest['name'] or not manifest['author']:
        raise ValueError('ADDON needs at least a name and an author')
    if 'plays' in manifest['provides'] and not manifest['details']:
        raise ValueError('An add-on that provides plays must define game(game_id)')
    slug = re.sub(r'[^a-z0-9]+', '_', manifest['name'].lower()).strip('_')[:34]
    manifest['module'] = slug if re.fullmatch(r'[a-z][a-z0-9_]*', slug or '') else 'addon_' + (slug or 'source')[:34]
    return manifest


def addon_from_url(url: str) -> str:
    """https only, at most 256 KB. A GitHub page address is read from its raw file."""
    url = https_url(url, 500)
    if not url:
        raise ValueError('Use an https:// address without a user name or password in it')
    match = re.fullmatch(r'https://github\.com/([^/]+)/([^/]+)/blob/(.+)', url)
    if match:
        url = 'https://raw.githubusercontent.com/%s/%s/%s' % match.groups()
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read(ADDON_LIMIT + 1)
    except (urllib.error.URLError, OSError):
        raise ValueError('Could not download the add-on from that address')
    if len(body) > ADDON_LIMIT:
        raise ValueError('That file is larger than 256 KB, too large for an add-on')
    try:
        return body.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('That address did not return a Python text file')


def addon_folders() -> tuple[Path, Path]:
    folder = data_dir()
    if not folder:
        raise ValueError('This server has no data folder for add-ons')
    pending = folder / 'sources' / 'pending'
    pending.mkdir(parents=True, exist_ok=True)
    for old in pending.iterdir():  # unconfirmed add-ons are forgotten after an hour
        try:
            if time.time() - old.stat().st_mtime > PENDING_MAX_AGE:
                old.unlink()
        except OSError:
            pass
    return folder / 'sources', pending


def stage_addon(code: str) -> dict:
    """Step 1 of 2: check the file and keep it aside, unapproved. Returns what the confirmation screen shows."""
    if not isinstance(code, str) or not code.strip() or len(code.encode('utf-8')) > ADDON_LIMIT:
        raise ValueError('Choose an add-on file (at most 256 KB)')
    manifest = addon_manifest(code)
    digest = hashlib.sha256(code.encode('utf-8')).hexdigest()
    _, pending = addon_folders()
    (pending / (digest[:16] + '.py')).write_bytes(code.encode('utf-8'))  # bytes: the fingerprint is of exactly these
    (pending / (digest[:16] + '.json')).write_text(json.dumps(manifest), encoding='utf-8')
    installed = next((s for s in load_settings()['sources'] if s.get('module') == manifest['module']), None)
    return {'pending': digest[:16], 'sha256': digest, 'bytes': len(code.encode('utf-8')), 'addon': manifest,
            'replaces': (installed or {}).get('addon'),
            'confirm': {'runs_code': 'This add-on is Python code. It will run inside Orbital Sports on this server '
                                     'with the same access the sports service has. Only add add-ons you trust.',
                        'terms': ("Its data comes from %s. You're responsible for following %s's terms." %
                                  (manifest['terms'], manifest['terms'])) if manifest['terms'] else None}}


def install_addon(pending: str, runs_code: bool, terms: str | None) -> dict:
    """Step 2 of 2: only with both confirmations, the add-on is moved into place and switched on."""
    if not re.fullmatch(r'[0-9a-f]{16}', str(pending or '')):
        raise ValueError('Add the add-on again; that confirmation has expired')
    folder, staging = addon_folders()
    code_path, manifest_path = staging / (pending + '.py'), staging / (pending + '.json')
    if not code_path.is_file() or not manifest_path.is_file():
        raise ValueError('Add the add-on again; that confirmation has expired')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if runs_code is not True:
        raise ValueError('Confirm that this add-on runs code on your server')
    if manifest['terms'] and terms != manifest['terms']:
        raise ValueError("Confirm that you're responsible for following %s's terms" % manifest['terms'])
    code = code_path.read_bytes()
    record = clean_addon_record({**manifest, 'sha256': hashlib.sha256(code).hexdigest(),
                                 'accepted_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})
    target = folder / (manifest['module'] + '.py')
    temp = folder / (manifest['module'] + '.py.tmp')
    temp.write_bytes(code)
    os.replace(temp, target)
    code_path.unlink()
    manifest_path.unlink()
    current = [s for s in load_settings()['sources'] if s.get('module') != manifest['module']]
    entry = {'type': 'file', 'module': manifest['module'], 'name': manifest['name'][:40], 'addon': record}
    if manifest['leagues']:
        entry['leagues'] = manifest['leagues']
    save_settings({'sources': current + [entry]})
    return record


def remove_addon(module: str) -> None:
    """Switched off and set aside (moved to sources/removed/, not deleted)."""
    settings = load_settings()
    if not any(s.get('module') == module and s.get('addon') for s in settings['sources']):
        raise ValueError('No add-on by that name is installed')
    save_settings({'sources': [s for s in settings['sources'] if s.get('module') != module]})
    folder, _ = addon_folders()
    source = folder / (module + '.py')
    if source.is_file():
        removed = folder / 'removed'
        removed.mkdir(exist_ok=True)
        os.replace(source, removed / ('%s-%d.py' % (module, time.time())))


# ---------- the common game shape ----------
def text(value, limit) -> str:
    return re.sub(r'[\x00-\x1f\x7f]', '', str(value or '')).strip()[:limit]


def game_id(source: str, original: str) -> str:
    """Numeric, 12 digits, starting with 7: never collides with ESPN's 9-digit ids, stable across restarts."""
    return '7' + str(int(hashlib.sha256((source + '|' + original).encode()).hexdigest(), 16))[:11]


def iso(value) -> str | None:
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')


def validate_game(raw, source: str) -> dict | None:
    """One game in the Orbital Sports Feed format -> the board shape, or None if it isn't valid."""
    if not isinstance(raw, dict) or raw.get('league') not in LEAGUES:
        return None
    start = iso(raw.get('start'))
    teams = raw.get('teams')
    if not start or not isinstance(teams, list) or len(teams) != 2:
        return None
    sides = sorted(str(t.get('side')) for t in teams if isinstance(t, dict))
    if sides != ['away', 'home']:
        return None
    clean_teams = []
    for t in teams:
        name = text(t.get('name'), 80)
        if not name:
            return None
        score = text(t.get('score'), 4)
        team = {'name': name, 'side': t['side'], 'score': score if re.fullmatch(r'\d{0,3}', score) else '',
                'short': text(t.get('short') or name.split()[-1], 40), 'abbr': text(t.get('abbr'), 6).upper() or None,
                'rank': None, 'record': text(t.get('record'), 20) or None}
        logo = str(t.get('logo') or '')
        if logo.startswith('https://') and len(logo) <= 300:
            team['logo'] = logo
        clean_teams.append(team)
    state = raw.get('state') if raw.get('state') in STATES else 'scheduled'
    original = text(raw.get('id'), 80) or (raw['league'] + start + clean_teams[0]['name'] + clean_teams[1]['name'])
    away = next(t for t in clean_teams if t['side'] == 'away')
    home = next(t for t in clean_teams if t['side'] == 'home')
    return {'id': game_id(source, original), 'league': raw['league'], 'name': '%s at %s' % (away['name'], home['name']),
            'start': start, 'state': state, 'status': text(raw.get('status'), 60) or state.title(),
            'teams': [home, away], 'networks': [text(n, 40) for n in (raw.get('networks') or [])[:8] if text(n, 40)],
            'venue': text(raw.get('venue'), 80) or None, 'postseason': bool(raw.get('postseason')),
            'source': source, 'watchable': False, 'ref': original}


# ---------- play-by-play (feeds and add-ons; Plus adds the picture's own) ----------
HALVES = ('top', 'bottom')
PITCH_RESULTS = ('ball', 'strike-looking', 'strike-swinging', 'foul', 'foul-tip', 'in-play', 'hit-by-pitch',
                 'pitchout', 'intentional-ball', 'unknown')


def seconds(value) -> float | None:
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp()


def small(value, low=0, high=999):
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def validate_play(raw, league: str) -> dict | None:
    """One play in a game's "plays" list (SOURCES.md) -> the checked shape, or None if it isn't valid."""
    if not isinstance(raw, dict) or not text(raw.get('id'), 80):
        return None
    at = seconds(raw.get('at'))
    period = small(raw.get('period'), 1, 30)
    if at is None or period is None:
        return None
    play = {'id': text(raw['id'], 80), 'at': at, 'period': period,
            'team': raw.get('team') if raw.get('team') in ('away', 'home') else None,
            'type': text(raw.get('type'), 40) or 'Play', 'text': text(raw.get('text'), 200),
            'clock': text(raw.get('clock'), 12) or None, 'scoring': bool(raw.get('scoring')),
            'end_of_at_bat': bool(raw.get('end_of_at_bat'))}
    score = raw.get('score')
    if isinstance(score, dict) and small(score.get('away')) is not None and small(score.get('home')) is not None:
        play['score'] = {'away': small(score['away']), 'home': small(score['home'])}
    if league == 'MLB':
        if raw.get('half') not in HALVES:
            return None
        play['half'] = raw['half']
        play['outs'] = small(raw.get('outs'), 0, 3)
        bases = raw.get('bases')
        play['bases'] = sorted({b for b in bases if b in (1, 2, 3)}) if isinstance(bases, list) else None
        play['at_bat'] = text(raw.get('at_bat'), 80) or None
        pitch = raw.get('pitch')
        if isinstance(pitch, dict):
            play['pitch'] = {'number': small(pitch.get('number'), 1, 40), 'type': text(pitch.get('type'), 30) or None,
                             'mph': small(pitch.get('mph'), 30, 110),
                             'result': pitch.get('result') if pitch.get('result') in PITCH_RESULTS else 'unknown',
                             'balls': small(pitch.get('balls'), 0, 4), 'strikes': small(pitch.get('strikes'), 0, 3)}
    return play


def validate_plays(raw, league: str) -> list[dict]:
    if not isinstance(raw, list):
        return []
    plays, seen = [], set()
    for item in raw[:3000]:
        play = validate_play(item, league)
        if play and play['id'] not in seen:
            seen.add(play['id'])
            plays.append(play)
    plays.sort(key=lambda p: p['at'])
    return plays


DETAILS, DETAIL_TTL = {}, 10  # game id -> (time, plays): inline plays from feeds, and game() answers


def keep_inline_plays(game: dict, raw: dict) -> None:
    if isinstance(raw.get('plays'), list):
        plays = validate_plays(raw['plays'], game['league'])
        with LOCK:
            DETAILS[game['id']] = (time.time(), plays)
            while len(DETAILS) > 128:
                DETAILS.pop(next(iter(DETAILS)))
        game['details'] = 'inline'  # refreshed with the schedule; no separate request


# ---------- providers ----------
def get_json(url, headers=None, limit=FEED_LIMIT, timeout=8):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json', **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError('response too large')
    return json.loads(body)


LEAGUE_WORDS = [  # (pattern, league), checked in order: 'College Football' before 'Football', 'WNBA' before 'NBA'
    (r'\b(college|ncaa)\b.*\bfootball\b|\bfootball\b.*\b(college|ncaa)\b', 'College football'),
    (r'\bnfl\b|\bsuper bowl\b', 'NFL'), (r'\bwnba\b', 'WNBA'), (r'\bnba\b', 'NBA'),
    (r'\bmlb\b|\bbaseball\b|\bworld series\b', 'MLB'), (r'\bnhl\b|\bhockey\b|\bstanley cup\b', 'NHL'), (r'\bmls\b', 'MLS'),
]
# Words searched in the guide (Jellyfin's own search, so a 40,000-listing guide isn't read in full).
GUIDE_TERMS = ('MLB', 'Baseball', 'World Series', 'NFL', 'Football', 'NBA', 'Basketball', 'NHL', 'Hockey', 'MLS', 'Soccer')
NOT_A_GAME = re.compile(r'\b(pregame|postgame|pre-game|post-game|tonight|countdown|highlights|classic|classics|replay|'
                        r'encore|rewind|preview|recap|analysis|show|magazine|draft|insider|live!|extra|central)\b', re.I)
MATCHUP = re.compile(r'^\s*(?:#\d+\s+)?(.+?)\s+(at|@|vs\.?|v\.?)\s+(?:#\d+\s+)?(.+?)\s*$', re.I)


def guide_game(program) -> dict | None:
    """'MLB Baseball' + 'Tampa Bay Rays at Milwaukee Brewers' (or the matchup in the title) -> a game.
    A live sports listing without teams ('Live: 2026 World Series' on FOX) becomes a channel hint instead."""
    title = re.sub(r'^\s*live:\s*', '', text(program.get('Name'), 160), flags=re.I)
    title = re.sub(r'\s*\[[^\]]*\]\s*$', '', title)  # '[Rays channel]'-style suffixes
    episode = text(program.get('EpisodeTitle'), 160)
    whole = title + ' ' + episode
    if program.get('IsRepeat') or NOT_A_GAME.search(whole) and not MATCHUP.match(episode or ''):
        return None
    league = next((lg for pattern, lg in LEAGUE_WORDS if re.search(pattern, whole, re.I)), None)
    if not league:
        return None
    candidates = [episode, title.split(':', 1)[-1]]
    match = next((MATCHUP.match(c) for c in candidates if c and MATCHUP.match(c)), None)
    if not match:
        start = iso(program.get('StartDate'))
        channel = text(program.get('ChannelName'), 60)
        if not start or not program.get('ChannelId'):
            return None
        return {'hint': True, 'league': league, 'start': start, 'guide_channels': [str(program['ChannelId'])],
                'networks': [channel] if channel else []}
    first, word, second = match.group(1), match.group(2).lower(), match.group(3)
    away, home = (first, second) if word in ('at', '@') else (second, first)
    start, end = iso(program.get('StartDate')), iso(program.get('EndDate'))
    if not start:
        return None
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    state = 'scheduled' if now < start else 'live' if not end or now < end else 'final'
    channel = text(program.get('ChannelName'), 60)
    game = validate_game({'id': league + start[:10] + away + home, 'league': league, 'start': start, 'state': state,
                          'status': {'scheduled': 'Scheduled', 'live': 'On now', 'final': 'Ended'}[state],
                          'teams': [{'name': away, 'side': 'away'}, {'name': home, 'side': 'home'}],
                          'networks': [channel] if channel else []}, 'guide')
    if game:
        game['score_known'] = False
        if program.get('ChannelId'):
            game['guide_channels'] = [str(program['ChannelId'])]
    return game


def guide_games(day: str, fetch, user_id: str = '') -> list[dict]:
    """fetch(path) reads Jellyfin with the person's own sign-in (their guide, their channels). Guides rarely flag
    sports reliably, so listings are found with Jellyfin's search for sports words, then parsed."""
    items, seen = [], set()
    for term in GUIDE_TERMS:
        query = {'searchTerm': term, 'includeItemTypes': 'LiveTvProgram', 'recursive': 'true', 'limit': 500,
                 'fields': 'ChannelInfo,StartDate,EndDate', 'enableImages': 'false', 'enableUserData': 'false'}
        if user_id:
            query['userId'] = user_id
        for p in (fetch('/Items?' + urlencode(query)) or {}).get('Items') or []:
            if p.get('Id') not in seen:
                seen.add(p.get('Id'))
                items.append(p)
    games = []
    for g in (guide_game(p) for p in items):
        if g and g.get('hint'):
            if local_day(g['start']) == day:
                games.append(g)
            continue
        if g and local_day(g['start']) == day and not any(x.get('id') == g['id'] for x in games):
            games.append(g)
        elif g:  # the same game on a second channel: one game, both channels
            twin = next((x for x in games if x.get('id') == g['id']), None)
            if twin:
                twin['guide_channels'] = list(dict.fromkeys(twin['guide_channels'] + g.get('guide_channels', [])))
                twin['networks'] = list(dict.fromkeys(twin['networks'] + g['networks']))
    return games


SPORTSDB_LEAGUES = {'4424': 'MLB', '4391': 'NFL', '4387': 'NBA', '4516': 'WNBA', '4380': 'NHL', '4346': 'MLS',
                    '4479': 'College football'}
FINAL_CODES = {'FT', 'AOT', 'AET', 'AP', 'MATCH FINISHED', 'FINAL', 'FINISHED', 'AWARDED'}


def sportsdb_game(ev) -> dict | None:
    league = SPORTSDB_LEAGUES.get(str(ev.get('idLeague')))
    if not league:
        return None
    status = text(ev.get('strStatus'), 40)
    home, away = ev.get('intHomeScore'), ev.get('intAwayScore')
    if str(ev.get('strPostponed', '')).lower() == 'yes' or status.upper() in ('PST', 'POSTPONED'):
        state = 'postponed'
    elif status.upper() in ('CANC', 'CANCELLED', 'CANCELED', 'ABD'):
        state = 'canceled'
    elif status.upper() in FINAL_CODES:
        state = 'final'
    elif status.upper() in ('NS', 'NOT STARTED', '') and home in (None, '') :
        state = 'scheduled'
    else:
        state = 'live'
    start = ev.get('strTimestamp') or ('%sT%s' % (ev.get('dateEvent'), ev.get('strTime') or '00:00:00'))
    return validate_game({'id': ev.get('idEvent'), 'league': league, 'start': start, 'state': state,
                          'status': {'final': 'Final', 'scheduled': 'Scheduled'}.get(state, status or state.title()),
                          'teams': [{'name': ev.get('strAwayTeam'), 'side': 'away', 'score': away if away is not None else '',
                                     'logo': ev.get('strAwayTeamBadge')},
                                    {'name': ev.get('strHomeTeam'), 'side': 'home', 'score': home if home is not None else '',
                                     'logo': ev.get('strHomeTeamBadge')}],
                          'networks': [n.strip() for n in str(ev.get('strTVStation') or '').split(',') if n.strip()],
                          'venue': ev.get('strVenue')}, 'thesportsdb')


def sportsdb_games(day: str, key: str, leagues=None) -> list[dict]:
    """League by league (a whole-sport request returns only a few games on free keys). TheSportsDB files games
    by UTC date, so an evening game here sits on the next UTC day: ask for both and keep this local day's games."""
    following = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    games = []
    for league_id, league in SPORTSDB_LEAGUES.items():
        if leagues and league not in leagues:
            continue
        for d in (day, following):
            url = 'https://www.thesportsdb.com/api/v1/json/%s/eventsday.php?%s' % (key, urlencode({'d': d, 'l': league_id}))
            try:
                found = (get_json(url) or {}).get('events') or []
            except urllib.error.HTTPError as error:
                if error.code == 429:  # keep what we have; the next refresh picks up the rest
                    raise PartialError(games, 'TheSportsDB rate limit reached (a paid key raises it)')
                raise
            time.sleep(0.2)
            for ev in found:
                game = sportsdb_game(ev)
                if game and local_day(game['start']) == day and not any(g['id'] == game['id'] for g in games):
                    games.append(game)
    return games


def local_day(start: str) -> str:
    """The calendar day of a game's start on this server's clock."""
    return datetime.fromisoformat(start.replace('Z', '+00:00')).astimezone().date().isoformat()


def feed_games(day: str, item: dict) -> list[dict]:
    separator = '&' if '?' in item['url'] else '?'
    headers = {'Authorization': 'Bearer ' + item['token']} if item.get('token') else {}
    data = get_json(item['url'] + separator + urlencode({'date': day}), headers)
    if not isinstance(data, dict) or data.get('format') != FORMAT or not isinstance(data.get('games'), list):
        raise ValueError('not a %s document' % FORMAT)
    source = source_label(item)
    games = []
    for raw in data['games'][:500]:
        game = validate_game(raw, source)
        if game:
            keep_inline_plays(game, raw)
            if data.get('details') is True:
                game['details'] = True
            games.append(game)
    return games


def source_label(item: dict) -> str:
    if item['type'] == 'feed':
        return 'feed:' + (item.get('name') or urlsplit(item['url']).hostname)
    return 'file:' + item['module'] if item['type'] == 'file' else item['type']


MODULES = {}  # module name -> (sha256, loaded module)


def load_module(item: dict):
    folder = data_dir()
    path = (folder / 'sources' / (item['module'] + '.py')) if folder else None
    if not path or not path.is_file():
        raise ValueError('provider file %s.py not found in the sources folder' % item['module'])
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if item.get('addon') and digest != item['addon']['sha256']:
        raise ValueError('add-on %s changed since it was approved; add it again to approve the new version' % item['module'])
    with LOCK:
        hit = MODULES.get(item['module'])
    if hit and hit[0] == digest:
        return hit[1]
    spec = importlib.util.spec_from_file_location('fp_source_' + item['module'], path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with LOCK:
        MODULES[item['module']] = (digest, module)
    return module


def bounded(function, *args, limit=10):
    """A provider file must not hang the service: give it 10 s."""
    result, failure, done = [], [], threading.Event()

    def call():
        try:
            result.append(function(*args))
        except Exception as error:  # reported as the source being unavailable
            failure.append(error)
        finally:
            done.set()
    threading.Thread(target=call, daemon=True).start()
    if not done.wait(limit):
        raise ValueError('provider file took longer than %d s' % limit)
    if failure:
        raise failure[0]
    return result[0]


def file_games(day: str, item: dict) -> list[dict]:
    module = load_module(item)
    games = []
    for raw in (bounded(module.games, day) or [])[:500]:
        game = validate_game(raw, source_label(item))
        if game:
            keep_inline_plays(game, raw)
            if callable(getattr(module, 'game', None)):
                game['details'] = True
            games.append(game)
    return games


def detail(event: dict) -> list[dict] | None:
    """Play-by-play for one game from the source that listed it: inline plays, a feed's ?game= answer, or an
    add-on's game(id). None when that source has no plays for it."""
    if not event.get('details'):
        return None
    with LOCK:
        hit = DETAILS.get(event['id'])
    if event['details'] == 'inline' or hit and time.time() - hit[0] < DETAIL_TTL:
        return hit[1] if hit else None
    item = next((s for s in load_settings()['sources'] if source_label(s) == event.get('source')), None)
    if item is None or item['type'] not in ('file', 'feed'):
        return hit[1] if hit else None
    try:
        if item['type'] == 'file':
            module = load_module(item)
            raw = bounded(module.game, event['ref']) if callable(getattr(module, 'game', None)) else None
        else:
            separator = '&' if '?' in item['url'] else '?'
            headers = {'Authorization': 'Bearer ' + item['token']} if item.get('token') else {}
            data = get_json(item['url'] + separator + urlencode({'game': event['ref']}), headers)
            raw = data.get('game') if isinstance(data, dict) and data.get('format') == FORMAT else None
    except Exception:
        return hit[1] if hit else None
    if not isinstance(raw, dict):
        return hit[1] if hit else None
    plays = validate_plays(raw.get('plays'), event['league'])
    with LOCK:
        DETAILS[event['id']] = (time.time(), plays)
    return plays


def espn_games(day: str) -> list[dict]:
    import espn_core as core
    today = datetime.now(core.ZONE).date()
    board = core.schedule_board(day, today)
    games = [dict(core.board_reported_event(e, e.get('carryover_date') or day), source='espn-public') for e in board['events']]
    if board.get('metadata_pending'):
        raise PendingError(games)
    return games


class PendingError(Exception):
    def __init__(self, games):
        super().__init__('pending')
        self.games = games


class PartialError(Exception):
    """Some games arrived before the source stopped answering; use them and say why."""
    def __init__(self, games, reason):
        super().__init__(reason)
        self.games, self.reason = games, reason


# ---------- merging ----------
LOCK, CACHE = threading.Lock(), {}
PRECEDENCE = {'file': 0, 'feed': 1, 'thesportsdb': 2, 'espn-public': 3, 'guide': 4}


def nickname(name: str) -> str:
    words = re.findall(r'[a-z0-9]+', name.lower())
    return words[-1] if words else ''


def same_game(a: dict, b: dict) -> bool:
    if a['league'] != b['league']:
        return False
    if abs((datetime.fromisoformat(a['start'].replace('Z', '+00:00')) -
            datetime.fromisoformat(b['start'].replace('Z', '+00:00'))).total_seconds()) > 4 * 3600:
        return False
    return {nickname(t['name']) for t in a['teams']} == {nickname(t['name']) for t in b['teams']}


def merge(groups: list[tuple[str, list[dict]]]) -> list[dict]:
    """groups in precedence order (first wins). Scores, state and names come from the first source that has them;
    networks and guide channels are combined from all."""
    merged: list[dict] = []
    for _, games in groups:
        for game in games:
            twin = next((m for m in merged if same_game(m, game)), None)
            if twin is None:
                merged.append(dict(game, sources_used=[game['source']]))
                continue
            twin['sources_used'].append(game['source'])
            for network in game.get('networks') or []:
                if network not in twin['networks']:
                    twin['networks'].append(network)
            twin['guide_channels'] = list(dict.fromkeys((twin.get('guide_channels') or []) + (game.get('guide_channels') or [])))
            if twin.get('score_known') is False and game.get('score_known') is not False:
                for key in ('state', 'status', 'teams', 'id', 'source', 'ref'):
                    twin[key] = game[key]
                if game.get('details'):
                    twin['details'] = game['details']
                twin.pop('score_known', None)
    merged.sort(key=lambda g: (g['start'], g['league'], g['name']))
    return merged


def attach_hints(events: list[dict], hints: list[dict]) -> None:
    """A guide listing without teams ('2026 World Series' on FOX 32) adds its channel to the one game of that league
    starting within 45 minutes. When two games of that league start then, the listing is ambiguous and skipped."""
    for hint in hints:
        moment = datetime.fromisoformat(hint['start'].replace('Z', '+00:00'))
        near = [e for e in events if e['league'] == hint['league'] and e.get('state') != 'final' and
                abs((datetime.fromisoformat(e['start'].replace('Z', '+00:00')) - moment).total_seconds()) <= 45 * 60]
        if len(near) == 1:
            game = near[0]
            game['guide_channels'] = list(dict.fromkeys((game.get('guide_channels') or []) + hint['guide_channels']))
            for network in hint['networks']:
                if network not in game['networks']:
                    game['networks'].append(network)


def board(day: str, fetch=None, user_key: str = '') -> dict:
    """All games for one day from the configured sources, in the shape schedule_board returns."""
    settings = load_settings()
    groups, warnings, health, pending, hints = [], [], [], False, []
    for item in sorted(settings['sources'], key=lambda s: PRECEDENCE[s['type']]):
        kind = item['type']
        cache_key = (day, json.dumps(item, sort_keys=True), user_key if kind == 'guide' else '')
        with LOCK:
            hit = CACHE.get(cache_key)
        if hit and time.time() - hit[0] < (SPORTSDB_TTL if kind == 'thesportsdb' else TTL):
            games = hit[1]
        else:
            try:
                if kind == 'guide':
                    games = guide_games(day, fetch, user_key) if fetch else []
                elif kind == 'thesportsdb':
                    games = sportsdb_games(day, item['key'], item.get('leagues'))
                elif kind == 'feed':
                    games = feed_games(day, item)
                elif kind == 'file':
                    games = file_games(day, item)
                else:
                    games = espn_games(day)
                with LOCK:
                    CACHE[cache_key] = (time.time(), games)
                    while len(CACHE) > 256:
                        CACHE.pop(next(iter(CACHE)))
            except PendingError as wait:
                games, pending = wait.games, True
            except PartialError as partial:
                games = partial.games or (hit[1] if hit else [])
                warnings.append('%s: %s' % (item.get('name') or kind, partial.reason))
            except Exception as error:  # one broken source never takes Sports down
                games = hit[1] if hit else []
                warnings.append('%s source unavailable: %s' % (item.get('name') or kind, type(error).__name__))
                status = error.code if isinstance(error, urllib.error.HTTPError) else None
                reason = ('credentials' if status in (401, 403) else 'rate-limit' if status == 429 else
                          'address' if status == 404 else 'network' if isinstance(error, (urllib.error.URLError, TimeoutError))
                          else 'response')
                health.append({'type': kind, 'name': item.get('name'), 'ok': False, 'reason': reason})
                groups.append((kind, games))
                continue
        if item.get('leagues'):
            games = [g for g in games if g['league'] in item['leagues']]
        hints += [g for g in games if g.get('hint')]
        games = [g for g in games if not g.get('hint')]
        teams = [team for game in games for team in game.get('teams', [])]
        health.append({'type': kind, 'name': item.get('name'), 'ok': True, 'games': len(games),
                       'teamEntries': len(teams), 'badgeLinks': sum(bool(t.get('logo')) for t in teams)})
        groups.append((kind, games))
    events = merge(groups)
    attach_hints(events, hints)
    return {'date': day, 'events': events, 'fetched_at': time.time(), 'leagues': sorted({e['league'] for e in events}),
            'metadata_pending': pending, 'schedule_source': 'orbital-sources', 'stale': False, 'stale_leagues': [],
            'warnings': warnings, 'sources': health}


def espn_enabled() -> bool:
    return any(s['type'] == 'espn-public' for s in load_settings()['sources'])


def find(game: str, day: str, fetch=None, user_key: str = '') -> dict | None:
    return next((e for e in board(day, fetch, user_key)['events'] if str(e['id']) == str(game)), None)


# ---------- the tracker view of a source's plays ----------
# The Orbital Game Center and player trackers read /sports/api/tracker in one shape (the one ESPN games produce).
# A source's plays are turned into that shape, so the same pages show them. Baseball is complete (pitches, counts,
# outs, bases, at-bat results, line score); other sports get their plays as a list until their field trackers exist.
def inning_name(n: int) -> str:
    suffix = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return '%d%s Inning' % (n, suffix)


def line_score(plays: list[dict]) -> dict:
    """Runs per inning from score changes (MLB): {'away': [0, 1, ...], 'home': [...]}. A score lower than one already
    seen is a stale row (ESPN's pitch rows sometimes carry the score from before a run), never runs taken away."""
    lines, previous = {'away': [], 'home': []}, {'away': 0, 'home': 0}
    for play in plays:
        innings = {'away': play['period'], 'home': play['period'] - (play['half'] == 'top')}
        for key in lines:
            while len(lines[key]) < innings[key]:
                lines[key].append(0)
        for key in lines:
            if 'score' in play:
                gained = play['score'][key] - previous[key]
                if gained > 0:
                    if not lines[key]:
                        lines[key].append(0)
                    lines[key][-1] += gained
                    previous[key] = play['score'][key]
    return lines


def tracker_view(event: dict, plays: list[dict]) -> dict:
    teams = [{'id': t['side'], 'name': t['name'], 'abbreviation': t.get('abbr') or t['short'][:3].upper(),
              'side': t['side'], 'score': t['score']} for t in event['teams']]
    baseball = event['league'] == 'MLB'
    score = {'away': 0, 'home': 0}
    timeline, recent = [], []
    last = plays[-1] if plays else None
    for play in plays:
        if play.get('score'):  # never backwards (see line_score)
            score = {key: max(score[key], play['score'][key]) for key in score}
        row = {'id': play['id'], 'at': play['at'], 'text': play['text'] or None, 'type': play['type'],
               'period': play['period'], 'clock': play.get('clock'), 'away': score['away'], 'home': score['home'],
               'scoring': play['scoring'], 'team_id': play['team'], 'first_seen_at': play['at'], 'changed_at': play['at'],
               'complete_first_seen_at': None}
        if baseball:
            batting = 'away' if play['half'] == 'top' else 'home'
            pitch = play.get('pitch')
            row.update({'half': play['half'].title(), 'inning': inning_name(play['period']), 'outs': play.get('outs'),
                        'bases': play.get('bases') or [], 'at_bat': play.get('at_bat'), 'pitch': bool(pitch),
                        'result': bool(play['end_of_at_bat']), 'pitch_number': (pitch or {}).get('number'),
                        'pitch_type': (pitch or {}).get('type'), 'mph': (pitch or {}).get('mph'),
                        'balls': (pitch or {}).get('balls'), 'strikes': (pitch or {}).get('strikes'),
                        'team_id': ('home' if batting == 'away' else 'away') if pitch else batting})
        timeline.append(row)
        if play['end_of_at_bat'] or not baseball:
            recent.append({'id': play['id'], 'text': play['text'] or play['type'], 'at': play['at'],
                           'inning': row.get('inning') or ('Period %d' % play['period']), 'team_id': row['team_id'],
                           'away': score['away'], 'home': score['home']})
    view = {'schema_version': 1, 'event_id': event['id'], 'league': event['league'],
            'kind': 'baseball' if baseball else 'plays', 'state': event['state'], 'status': event['status'],
            'start': event['start'], 'period': last['period'] if last else None, 'clock': last.get('clock') if last else None,
            'teams': teams, 'fetched_at': time.time(), 'source_updated_at': None, 'stale': False,
            'tracking_available': bool(baseball and plays), 'orientation_verified': False, 'geometry_available': False,
            'raw_axes_verified': False, 'direction_derived': False, 'orientation_method': None,
            'unavailable_reason': None if plays else 'No plays from this source yet',
            'calibration': {'status': 'unverified', 'periods': [], 'note': 'Pitch locations are not provided by this source',
                            'method': 'Plays from ' + event['source'], 'source': None, 'coordinate_system': None},
            'field': None, 'points': [], 'plays': [], 'summary': None, 'truncated': False, 'poll_interval_seconds': 10,
            'timeline': timeline[-400:], 'recent': recent[-6:], 'source': event['source']}
    if baseball and plays:
        view['line_score'] = line_score(plays)
        at_bat = last.get('at_bat')
        mine = [p for p in plays if p.get('at_bat') == at_bat] if at_bat else [last]
        pitches = [p for p in mine if p.get('pitch')]
        view['plays'] = [{'id': p['id'], 'text': p['text'] or None, 'type': p['type'],
                          'team_id': 'home' if p['half'] == 'top' else 'away', 'period': p['period'], 'clock': None,
                          'at': p['at'], 'number': p['pitch']['number'], 'pitch_type': p['pitch']['type'],
                          'mph': p['pitch']['mph'], 'balls': p['pitch']['balls'], 'strikes': p['pitch']['strikes'],
                          'result': p['pitch']['result']} for p in pitches]
        ending = next((p for p in reversed(mine) if p['end_of_at_bat']), None)
        view['summary'] = {'at_bat_id': at_bat, 'pitch_count': len(pitches),
                           'balls': (pitches[-1]['pitch']['balls'] if pitches else 0) or 0,
                           'strikes': (pitches[-1]['pitch']['strikes'] if pitches else 0) or 0,
                           'outcome': ending['text'] if ending else None, 'completed': bool(ending),
                           'scope': 'current_or_latest_at_bat'}
    return view
