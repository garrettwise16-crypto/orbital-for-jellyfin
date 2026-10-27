"""Connect user-supplied Live TV sources. Metadata checks never open a video stream."""
from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

from .netio import HttpError

_SAVE = threading.Lock()
MAX_METADATA = 8 * 1024 * 1024


def address(value: str) -> str:
    value = str(value or '').strip()
    if '://' not in value:
        value = 'http://' + value
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        if parsed.fragment or any(ord(c) < 32 for c in value) or len(value) > 8192:
            raise ValueError()
        _ = parsed.port
    except ValueError:
        raise ValueError('Enter an HTTP or HTTPS address. Put IPTV credentials in the username and password fields.') from None
    return value


def settings(body: dict) -> dict:
    kind = body.get('kind')
    if kind not in ('m3u', 'xtream', 'hdhomerun'):
        raise ValueError('Choose a playlist, IPTV login, or HDHomeRun tuner.')
    url = address(body.get('url'))
    guide = str(body.get('guide') or '').strip()
    if kind == 'xtream':
        user, password = str(body.get('username') or ''), str(body.get('password') or '')
        if not user or not password or len(user) > 512 or len(password) > 512:
            raise ValueError('Enter the username and password supplied by your IPTV provider.')
        if urllib.parse.urlsplit(url).query:
            raise ValueError('Enter only the provider server address here; choose Playlist if you have a complete M3U link.')
        base = url.rstrip('/')
        query = urllib.parse.urlencode({'username': user, 'password': password})
        url = base + '/get.php?' + query + '&type=m3u_plus&output=ts'
        if not guide:
            guide = base + '/xmltv.php?' + query
    try:
        limit = int(body.get('connections', 1))
    except (ValueError, TypeError):
        raise ValueError('Enter the number of simultaneous streams your provider allows.') from None
    if not 1 <= limit <= 20:
        raise ValueError('Choose between 1 and 20 simultaneous streams.')
    return {'kind': kind, 'url': url, 'guide': address(guide) if guide else '',
            'name': str(body.get('name') or 'My Live TV').strip()[:80], 'connections': limit}


class _Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        address(newurl)
        if urllib.parse.urlsplit(req.full_url).scheme == 'https' and urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ValueError('Secure provider addresses cannot redirect to an unencrypted address.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def metadata(url: str, limit: int = MAX_METADATA) -> tuple[bytes, bool]:
    try:
        req = urllib.request.Request(address(url), headers={'User-Agent': 'OrbitalSetup/0.2', 'Accept-Encoding': 'identity'})
        with urllib.request.build_opener(_Redirect()).open(req, timeout=20) as response:
            raw = response.read(limit + 1)
        return raw[:limit], len(raw) > limit
    except (OSError, urllib.error.URLError, ValueError):
        # Provider URLs often contain passwords. Never return them or upstream error bodies.
        raise ValueError('Could not read the provider information. Check the address and login, then try again.') from None


def check(body: dict) -> dict:
    config = settings(body)
    if config['kind'] == 'hdhomerun':
        raw, truncated = metadata(config['url'].rstrip('/') + '/lineup.json')
        try:
            channels = json.loads(raw)
            if truncated or not isinstance(channels, list):
                raise ValueError()
            count = sum(isinstance(c, dict) and bool(c.get('GuideName')) for c in channels)
        except (ValueError, UnicodeError):
            raise ValueError('This address did not return an HDHomeRun channel list. Use the tuner address on your home network.') from None
    else:
        raw, truncated = metadata(config['url'])
        text = raw.decode('utf-8-sig', 'replace').lstrip()
        if not text.startswith('#EXTM3U'):
            raise ValueError('The provider did not return an M3U playlist. Check your login or copy the playlist link again.')
        count = sum(line.startswith('#EXTINF:') for line in text.splitlines())
    if not count:
        raise ValueError('The connection worked, but its channel list is empty. Ask your provider or scan channels on your tuner.')
    guide_ok = False
    if config['guide']:
        raw, _ = metadata(config['guide'], 65536)
        text = raw.decode('utf-8-sig', 'replace')
        if '<!ENTITY' in text.upper() or not re.search(r'<tv(?:\s|>)', text):
            raise ValueError('The guide address did not return XMLTV data. Check the guide link supplied by your provider.')
        guide_ok = True
    return {'checked': True, 'channels': count, 'at_least': truncated, 'guide_checked': guide_ok,
            'message': 'Channel list checked. No video was opened. Save below to connect this source to Jellyfin.'}


def status(jf) -> dict:
    config = jf.call('GET', '/System/Configuration/livetv', timeout=15, retries=0)
    tuners = config.get('TunerHosts') or []
    return {'sources': [{'id': t.get('Id'), 'name': t.get('FriendlyName') or 'Live TV source',
                         'kind': t.get('Type')} for t in tuners],
            'guides': len(config.get('ListingProviders') or [])}


def save(jf, body: dict, progress=lambda message: None) -> dict:
    with _SAVE:
        progress('Checking the channel list and guide. No video is opened.')
        checked = check(body)
        config = settings(body)
        tuner_type = 'hdhomerun' if config['kind'] == 'hdhomerun' else 'm3u'
        try:
            current = jf.call('GET', '/System/Configuration/livetv', timeout=15, retries=0)
            tuner = next((t for t in current.get('TunerHosts', []) if t.get('Url') == config['url'] and t.get('Type') == tuner_type), None)
            created = tuner is None
            if created:
                progress('Connecting the source in Jellyfin and importing its channels.')
                tuner = jf.call('POST', '/LiveTv/TunerHosts', body={
                    'Type': tuner_type, 'Url': config['url'], 'FriendlyName': config['name'],
                    'TunerCount': config['connections'], 'AllowStreamSharing': True,
                    'ReadAtNativeFramerate': True, 'ImportFavoritesOnly': False,
                }, timeout=60, retries=0)
            if not tuner or not tuner.get('Id'):
                raise ValueError('Jellyfin did not confirm the source. Check the connected-source list before retrying.')
            if config['guide']:
                current = jf.call('GET', '/System/Configuration/livetv', timeout=15, retries=0)
                existing = next((g for g in current.get('ListingProviders', []) if g.get('Path') == config['guide'] and
                                 (g.get('EnableAllTuners') or tuner['Id'] in (g.get('EnabledTuners') or []))), None)
                if not existing:
                    progress('Connecting the programme guide to this source.')
                    jf.call('POST', '/LiveTv/ListingProviders', params={'validateListings': True}, body={
                        'Type': 'xmltv', 'Path': config['guide'], 'EnableAllTuners': False,
                        'EnabledTuners': [tuner['Id']],
                    }, timeout=60, retries=0)
            progress('Saved. Jellyfin is refreshing channels and guide listings.')
            return {'saved': True, 'created': created, 'channels_checked': checked['channels'],
                    'guide_connected': bool(config['guide']), 'sources': status(jf)['sources'],
                    'message': 'Saved in Jellyfin. Channels and guide listings may take a few minutes to appear. Your other sources were kept.'}
        except HttpError:
            raise ValueError('Jellyfin could not confirm every step. A source may already have been saved; check Connected sources, then retry. Existing sources are kept.') from None
