"""Owned Windows HTTPS endpoint. No router changes or public port probes on page load."""
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen
from . import remote_access

SERVICE = 'OrbitalRemoteHttps'

def hostname(value):
    value = str(value).strip().lower()
    if value.startswith('https://'):
        parsed = urlsplit(value)
        if parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.port or parsed.username:
            raise ValueError('Enter only your server name, such as my-library.duckdns.org.')
        value = parsed.hostname or ''
    if len(value)>253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', value):
        raise ValueError('Enter a complete public server name, without a port or path.')
    if value.endswith(('.localhost', '.local', '.internal', '.test', '.invalid', '.example')):
        raise ValueError('Use a public name you control, rather than a local-only name.')
    return value

def target(jf):
    local = remote_access.local_target(jf)
    p = urlsplit(local)
    if p.scheme!='http' or p.path not in ('','/') or p.hostname not in ('localhost','127.0.0.1','::1'):
        raise ValueError('Automatic HTTPS needs the local HTTP Jellyfin address without a base path. Keep an existing proxy using Check an existing address instead.')
    port = p.port or 80
    if port in (80,443):
        raise ValueError('Jellyfin already uses a web port. Keep your existing proxy, or use the private connection option.')
    return f'http://127.0.0.1:{port}'

def caddyfile(host, upstream):
    host=hostname(host)
    if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}',upstream) or not 1 <= int(upstream.rsplit(':',1)[-1]) <= 65535:
        raise ValueError('Invalid local upstream')
    return '{\n admin off\n storage file_system {\n  root C:/ProgramData/OrbitalRemote/data\n }\n}\n'+host+' {\n reverse_proxy '+upstream+'\n}\n'

def public_ip():
    try:
        with urlopen('https://api.ipify.org',timeout=8) as response:
            value=response.read(64).decode().strip()
        address=ipaddress.ip_address(value)
        return str(address) if address.version==4 and address.is_global else None
    except Exception:
        return None

def network():
    """Read local routing; no packets are sent by UDP connect itself."""
    lan=None
    try:
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
            s.connect(('1.1.1.1',443));lan=s.getsockname()[0]
    except OSError:pass
    gateway=None
    if sys.platform=='win32':
        script="Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop"
        r=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],capture_output=True,text=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            ip=ipaddress.ip_address(r.stdout.strip())
            if ip.version==4 and ip.is_private and not ip.is_loopback:gateway=str(ip)
        except ValueError:pass
    return {'lan_ip':lan,'router_url':'http://'+gateway if gateway else None,'public_ip':public_ip()}

def assess(jf, body, progress):
    target(jf);progress('Checking this computer and your internet address…')
    info=network();wan=str(body.get('router_wan','')).strip();reason=None
    if wan:
        try:
            address=ipaddress.ip_address(wan)
        except ValueError:
            raise ValueError('Copy the Internet / WAN IPv4 address shown in your router.') from None
        if address.version!=4 or not address.is_global:
            reason='Your router does not have a public IPv4 address. This may be an ISP shared address or another router in front of yours. Use the private connection option, or ask your ISP for a public IPv4 address.'
        elif info['public_ip'] and wan!=info['public_ip']:
            reason='Your router address differs from the address seen online. A VPN or another router may be involved. Check this before forwarding ports, or use the private connection option.'
    return dict(info,phase='network',direct_possible=False if reason else None,
                message=reason or 'Network details found. Next choose your address. A public address alone does not prove incoming connections work; we will check HTTPS after the router step.')

def paths(folder):
    folder=Path(folder)/'direct-https';folder.mkdir(parents=True,exist_ok=True)
    return folder,folder/'state.json'

def read_state(folder,jf):
    _,path=paths(folder)
    state=json.loads(path.read_text()) if path.exists() else {}
    if state and state['server_id']!=jf.public_info().get('Id'):
        raise ValueError('This setup profile belongs to a different Jellyfin server. Its remote connection was not changed.')
    return state

def executable(progress):
    cli=shutil.which('caddy')
    link=Path(os.environ.get('LOCALAPPDATA',''))/'Microsoft/WinGet/Links/caddy.exe'
    if not cli and link.is_file():cli=str(link.resolve())
    if cli:return str(Path(cli).resolve())
    winget=shutil.which('winget')
    if not winget:raise ValueError('Install Microsoft App Installer, then retry this step.')
    progress('Installing Caddy from Windows Package Manager. Allow the Windows permission prompt if shown.')
    r=subprocess.run([winget,'install','--id','CaddyServer.Caddy','--exact','--source','winget','--silent','--no-upgrade','--accept-package-agreements','--accept-source-agreements','--disable-interactivity'],capture_output=True,timeout=1200,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if r.returncode:raise RuntimeError('Caddy installation did not finish. Check the Windows prompt and retry; existing services are kept.')
    cli=shutil.which('caddy') or (str(link.resolve()) if link.is_file() else None)
    if not cli:raise RuntimeError('Caddy was installed but is not visible yet. Close and reopen Setup, then continue.')
    return cli

def configure(jf, folder, body, progress):
    if sys.platform!='win32':raise ValueError('Automatic direct HTTPS currently supports Windows servers.')
    if body.get('expose') is not True:raise ValueError('Confirm that you want this Jellyfin sign-in page reachable from the internet.')
    upstream=target(jf);host=hostname(body.get('hostname',''));mode=body.get('dns_mode','existing')
    if mode not in ('existing','duckdns'):raise ValueError('Choose an address option.')
    token=str(body.get('dns_token','')).strip()
    state=read_state(folder,jf)
    if mode=='duckdns' and (not re.fullmatch(r'[a-z0-9-]+\.duckdns\.org',host) or not token and not state or token and not re.fullmatch(r'[a-zA-Z0-9-]{20,100}',token)):
        raise ValueError('Enter your DuckDNS name and the token from your own DuckDNS account.')
    if state and (state['host']!=host or state['upstream']!=upstream or state['dns_mode']!=mode):
        raise ValueError('Remove the existing connection here before choosing a different address or server port.')
    progress('Checking for an existing remote connection…')
    cli=executable(progress)
    config=jf.call('GET','/System/Configuration/network')
    before={k:config.get(k) for k in ('KnownProxies','EnableRemoteAccess')}
    desired=dict(config);desired['KnownProxies']=list(dict.fromkeys([*(config.get('KnownProxies') or []),'127.0.0.1','::1']));desired['EnableRemoteAccess']=True
    _,file=paths(folder)
    state=state or {'server_id':jf.public_info()['Id'],'host':host,'upstream':upstream,'network_before':before}
    state.update(network_applied={k:desired[k] for k in before},dns_mode=mode,phase='installing',verified_away=False)
    file.write_text(json.dumps(state,indent=2))
    # Elevation installs only our named service/rules; it refuses unowned services or ports.
    progress('Preparing HTTPS and automatic startup. Approve the Windows administrator prompt to continue.')
    from .elevate import run_direct_action
    payload={'action':'install','host':host,'upstream':upstream,'caddy':cli,'caddy_sha256':hashlib.sha256(Path(cli).read_bytes()).hexdigest(),'dns_mode':mode,'dns_token':token}
    installed=run_direct_action(payload)
    progress('Configuring Jellyfin to recognize the local HTTPS proxy…')
    config=jf.call('GET','/System/Configuration/network')
    if not state.get('network_changed'):
        state['network_before']={k:config.get(k) for k in ('KnownProxies','EnableRemoteAccess')}
    desired=dict(config);desired['KnownProxies']=list(dict.fromkeys([*(config.get('KnownProxies') or []),'127.0.0.1','::1']));desired['EnableRemoteAccess']=True
    state['network_applied']={k:desired[k] for k in state['network_before']}
    state['network_changed']=True
    state['phase']='router';file.write_text(json.dumps(state,indent=2))
    jf.call('POST','/System/Configuration/network',body=desired,retries=0)
    info=network()
    return dict(info,url='https://'+host,phase='router',dns_updated=installed.get('dns_updated',False),message='HTTPS is installed and will start with Windows. Now forward TCP ports 80 and 443 in your router to this computer. Keep Jellyfin port 8096 closed to the internet. If you use your own domain, point its A record to the internet address below and remove any stale AAAA record. Reserve this computer’s local address so the forwarding keeps working.')

def resume(jf,folder,body,progress):
    state=read_state(folder,jf)
    if not state:return {'phase':'network','message':'No direct HTTPS connection is saved in this setup profile. Start with Check my network.'}
    return dict(network(),host=state['host'],dns_mode=state['dns_mode'],phase='router',url='https://'+state['host'],message='Your saved address is restored. If installation was interrupted, choose Set up my HTTPS address again; a saved DuckDNS token can be reused without typing it. Otherwise check HTTPS below. We will not assume away-from-home access still works without testing it.')

def check(jf,folder,body,progress):
    state=read_state(folder,jf)
    if not state:raise ValueError('Set up your address first.')
    progress('Checking DNS, the HTTPS certificate, and the Jellyfin server identity…')
    try:result=remote_access.verify(jf,'https://'+state['host'])
    except Exception:
        url='https://'+state['host']
        return {'phase':'router','url':url,'show_phone':True,'qr':remote_access.qr(url),'verified_here':False,'verified_away':False,'message':'HTTPS is not verified from this computer yet. Check the router entries, address records, and Windows firewall. Certificates can take a few minutes. Some routers cannot loop back to their own public address: try the address on mobile data too. Do not bypass a browser certificate warning. If incoming connections are blocked by your ISP, use the private connection option.'}
    state.update(phase='phone',verified_here=True,verified_away=False);paths(folder)[1].write_text(json.dumps(state,indent=2))
    return dict(result,phase='phone',qr=remote_access.qr(result['url']),message='The HTTPS certificate is valid and the address reaches your Jellyfin server from here. Next test on your phone with Wi-Fi off. No Tailscale app is needed for this connection.')

def confirm(jf,folder,body,progress):
    state=read_state(folder,jf)
    if not state or body.get('away_played') is not True or body.get('url')!='https://'+state['host']:raise ValueError('First open this saved address and play a title with Wi-Fi off.')
    state.update(phase='complete',away_confirmation='owner_reported_playback',verified_away=True)
    paths(folder)[1].write_text(json.dumps(state,indent=2))
    return {'phase':'complete','message':'You confirmed playback over mobile data. Save this address in Jellyfin or Orbital. Keep the server on; Caddy renews its certificate automatically.','url':'https://'+state['host'],'verified_away':True,'verification_source':'owner_reported'}

def remove(jf,folder,body,progress):
    state=read_state(folder,jf)
    if not state:raise ValueError('This setup profile does not own a direct HTTPS connection.')
    progress('Removing only the HTTPS service, address-update task and firewall rule created by this workflow…')
    from .elevate import run_direct_action
    run_direct_action({'action':'remove','host':state['host'],'upstream':state['upstream']})
    config=jf.call('GET','/System/Configuration/network');changed=False
    for key,value in state['network_before'].items():
        if state.get('network_changed') and config.get(key)==state['network_applied'][key]:config[key]=value;changed=True
    if changed:jf.call('POST','/System/Configuration/network',body=config,retries=0)
    paths(folder)[1].unlink()
    return {'phase':'removed','message':'The managed HTTPS connection is stopped and its firewall rule and address-update task are removed. Delete the two forwarding entries in your router. Your library, users and unrelated network changes are kept.'}

def admin_helper(payload):
    """Called only by the normal elevated helper. Its request contains no Jellyfin token."""
    import base64
    host=hostname(payload.get('host',''));upstream=payload.get('upstream','');config=caddyfile(host,upstream)
    action=payload.get('action')
    if action not in ('install','remove'):raise ValueError('Unknown helper action')
    if action=='install':
        if payload.get('dns_mode') not in ('existing','duckdns'):raise ValueError('Invalid address provider')
        if payload['dns_mode']=='duckdns' and (not re.fullmatch(r'[a-z0-9-]+\.duckdns\.org',host) or payload.get('dns_token') and not re.fullmatch(r'[a-zA-Z0-9-]{20,100}',str(payload['dns_token']))):
            raise ValueError('Invalid address-update settings')
        cli=Path(payload['caddy']).resolve()
        if not cli.is_file() or cli.name.lower()!='caddy.exe' or hashlib.sha256(cli.read_bytes()).hexdigest()!=payload['caddy_sha256']:raise ValueError('Caddy changed before installation. Retry setup.')
    # Data enters PowerShell through stdin JSON, never as executable text or command arguments.
    from .direct_https_windows import SCRIPT
    encoded=base64.b64encode(SCRIPT.encode('utf-16le')).decode()
    request=dict(payload,config=config)
    r=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',encoded],input=json.dumps(request),text=True,capture_output=True,timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if r.returncode:raise RuntimeError('The Windows HTTPS step stopped: '+r.stdout.strip()[-700:])
    return json.loads(r.stdout)
