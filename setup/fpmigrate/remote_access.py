"""Optional private remote access. Never enables public forwarding or replaces a proxy."""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit
from .jellyfin import Jellyfin


class ApprovalRequired(ValueError):
    """A provider permission the signed-in owner must grant themselves."""
    def __init__(self, message, url='https://login.tailscale.com/admin/dns'):
        super().__init__(message)
        self.url = url


def qr(url):
    import segno
    return segno.make(url, micro=False).svg_data_uri(scale=5, border=4)


def advance(jf, progress):
    """Resume the same simple workflow after account approval, without changing accounts."""
    local_target(jf)
    if not executable():
        install(jf, progress)
    progress('Checking your private connection…')
    data = json.loads(command([executable(), 'status', '--json']))
    if data.get('BackendState') != 'Running':
        if data.get('BackendState') not in ('NeedsLogin', 'NoState'):
            return {'phase':'approval', 'message':'Open Tailscale and turn its connection on. Then choose Continue below.', 'approval_url':'https://tailscale.com/download'}
        progress('Preparing your secure sign-in. Your account password stays with the connection provider.')
        try:
            result = subprocess.run([executable(), 'login', '--timeout=5s', '--unattended', '--accept-routes=false'],
                capture_output=True, text=True, timeout=15, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            output = result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            output = ''
        data = json.loads(command([executable(), 'status', '--json']))
        if data.get('BackendState') != 'Running':
            url = data.get('AuthURL', '')
            if not url:
                match = re.search(r'https://login\.tailscale\.com/[a-zA-Z0-9/_?=&.-]+', output)
                url = match.group() if match else ''
            if urlsplit(url).scheme != 'https' or urlsplit(url).hostname != 'login.tailscale.com':
                raise RuntimeError('Open Tailscale from the Start menu to approve this computer, then choose Continue here.')
            return {'phase':'approval', 'approval_url':url, 'message':'Approve this computer in the secure sign-in page. Return here and choose Continue when it says connected.'}
    try:
        result = enable(jf, progress)
    except ApprovalRequired as error:
        return {'phase':'approval', 'approval_url':error.url,
                'message':str(error)}
    result.update(phase='phone', qr=qr(result['url']))
    return result


def executable():
    path = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Tailscale/tailscale.exe'
    return str(path) if path.is_file() else shutil.which('tailscale')


def command(args, timeout=30):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.TimeoutExpired as error:
        serve_approval(args, error.stdout, error.stderr)
        raise RuntimeError('This step needs more time or your approval in Tailscale. Complete it there, then check again.') from None
    if result.returncode:
        serve_approval(args, result.stdout, result.stderr)
        raise RuntimeError('Tailscale could not complete this step. Open Tailscale, check your sign-in and HTTPS permission, then retry. Existing connections are kept.')
    return result.stdout


def serve_approval(args, *output):
    if len(args) < 2 or args[1] != 'serve':
        return
    text = '\n'.join(x.decode('utf-8', errors='replace') if isinstance(x, bytes) else (x or '') for x in output)
    match = re.search(r'https://login\.tailscale\.com/[a-zA-Z0-9/_?=&.-]+', text)
    if match:
        raise ApprovalRequired('Your account needs permission to create a secure address. Choose Approve your connection, accept the request on that page, then return here and choose Continue.', match.group())


def local_target(jf):
    parsed = urlsplit(jf.base_url)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Connect with a plain local Jellyfin address first.')
    if parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        # The user may have selected their LAN address. Recognize the same server
        # locally without forwarding another computer through this one.
        local = f'{parsed.scheme}://127.0.0.1:{parsed.port or (443 if parsed.scheme=="https" else 80)}{parsed.path}'.rstrip('/')
        try:
            expected = jf.public_info().get('Id')
            if expected and Jellyfin(local).public_info().get('Id') == expected:
                return local
        except Exception:
            pass
        raise ValueError('Open Orbital Setup on the computer that stores your Jellyfin library, then try this step there. We cannot install the connection app on a different computer from here.')
    return jf.base_url.rstrip('/')


def status(jf):
    local_target(jf)
    cli = executable()
    if not cli:
        return {'installed': False, 'connected': False, 'message': 'Install Tailscale on this server, then sign in. It creates a private connection for your devices.'}
    data = json.loads(command([cli, 'status', '--json']))
    running = data.get('BackendState') == 'Running'
    return {'installed': True, 'connected': running,
            'message': 'Tailscale is connected. You can enable private HTTPS access.' if running else 'Open Tailscale from the Start menu and sign in, then choose Check sign-in.'}


def install(jf, progress):
    local_target(jf)
    if sys.platform != 'win32':
        raise ValueError('Automatic installation supports Windows. Install Tailscale on your server, then check again.')
    if not executable():
        winget = shutil.which('winget')
        if not winget:
            raise ValueError('Install Microsoft App Installer, then retry.')
        progress('Installing Tailscale. Approve the Windows permission prompt if shown.')
        command([winget, 'install', '--id', 'Tailscale.Tailscale', '--exact', '--source', 'winget',
                 '--silent', '--no-upgrade', '--accept-package-agreements', '--accept-source-agreements',
                 '--disable-interactivity'], timeout=1200)
    progress('Installation checked. Sign in through the Tailscale app, then return here.')
    return status(jf)


def verify(jf, url):
    parsed = urlsplit(str(url).strip())
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Enter an HTTPS server address without credentials or query parameters.')
    expected = jf.public_info().get('Id')
    actual = Jellyfin(str(url).strip()).public_info().get('Id')
    if not expected or actual != expected:
        raise ValueError('That address does not identify the Jellyfin server connected in setup.')
    return {'url': str(url).strip().rstrip('/'), 'verified_here': True, 'verified_away': False,
            'message': 'This HTTPS address reaches the correct server from this computer. Finish by opening it on your phone with Wi-Fi off; that confirms access away from home.'}


def enable(jf, progress):
    target = local_target(jf)
    if not status(jf)['connected']:
        raise ValueError('Sign in to Tailscale on this server first, then check sign-in.')
    cli = executable()
    state = json.loads(command([cli, 'status', '--json']))
    host = str((state.get('Self') or {}).get('DNSName', '')).rstrip('.')
    if not re.fullmatch(r'[a-zA-Z0-9.-]+\.ts\.net', host):
        raise ApprovalRequired('One account approval remains. Choose Approve your connection below. On that page, turn on MagicDNS and HTTPS Certificates if they are off, then return here and choose Continue. Setup will create and check your server address for you.')
    progress('Checking existing private web routes…')
    config = json.loads(command([cli, 'serve', 'status', '--json']) or '{}') or {}
    endpoint = host + ':443'
    handler = config.get('Web', {}).get(endpoint, {}).get('Handlers', {}).get('/', {})
    if config and handler.get('Proxy') != target:
        raise ValueError('Tailscale already serves another application. Setup will not replace it. Use an existing HTTPS address below or configure a separate route in Tailscale.')
    if config.get('AllowFunnel') and any(config['AllowFunnel'].values()):
        raise ValueError('This device has public forwarding enabled. Review that configuration in Tailscale before choosing private access.')
    if not config:
        progress('Enabling HTTPS inside your private Tailscale network. This does not open a public router port.')
        command([cli, 'serve', '--bg', '--https=443', target])
    progress('Checking that the HTTPS address reaches this Jellyfin server…')
    result = verify(jf, 'https://' + host)
    result['message'] = ('Private HTTPS is configured. Install Tailscale on each viewing device and sign in to the same network. '
                         'Use the address below in stock Jellyfin or Orbital. Turn Wi-Fi off on your phone and open it to finish the outside-home check.')
    return result
