"""Optional owner-run Rebel container. No bundled sources, relays or streams."""
import json
import shutil
import subprocess
from .remote_access import local_target

NAME = 'orbital-personal-rebel'
LABEL = 'org.orbital.setup=personal-rebel'
HOME = 'http://127.0.0.1:18808'


def command(args, timeout=20):
    try:
        result = subprocess.run([shutil.which('docker') or 'docker', *args],
            capture_output=True, text=True, timeout=timeout,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('Docker is not ready. Open Docker Desktop, wait until it is running, then try again.') from None
    if result.returncode:
        raise ValueError('Docker could not finish this step. Check Docker Desktop and available disk space, then try again. Your existing containers were not replaced.')
    return result.stdout


def inspect_owned():
    ids = command(['ps', '-a', '--filter', 'name=^/' + NAME + '$', '--format', '{{.ID}}']).strip()
    if not ids:
        return None
    row = json.loads(command(['inspect', NAME]))[0]
    if (row.get('Config', {}).get('Labels') or {}).get('org.orbital.setup') != 'personal-rebel':
        raise ValueError('A different installation already uses this name. Use its playlist in Connect an existing source below; we will not replace it.')
    return row


def ready(jf):
    local_target(jf)
    if not shutil.which('docker'):
        return {'phase': 'docker', 'message': 'Install Docker Desktop using the official installer. Restart if asked, open Docker Desktop, then return here and choose Check again.'}
    contexts = json.loads(command(['context', 'inspect']))
    host = contexts[0]['Endpoints']['docker']['Host']
    if not host.startswith(('npipe://', 'unix://')):
        raise ValueError('Docker is connected to a remote machine. Select your local Docker Desktop context first, or connect an existing Rebel playlist below.')
    if command(['info', '--format', '{{.OSType}}']).strip() != 'linux':
        raise ValueError('Switch Docker Desktop to Linux containers, then choose Check again.')
    row = inspect_owned()
    return {'phase': 'configure' if row and row.get('State', {}).get('Running') else 'install',
            'dashboard': HOME, 'playlist': HOME + '/playlist', 'guide': HOME + '/epg',
            'message': 'Rebel is running. Open its dashboard to choose your sources, then return here to test and save your channels.' if row and row.get('State', {}).get('Running') else 'Docker is ready. Install Rebel here to continue. Existing containers will be kept.'}


def install(jf, body, progress=lambda text: None):
    if body.get('personal_use') is not True:
        raise ValueError('Confirm personal use and review Rebel’s terms before installing.')
    state = ready(jf)
    if state['phase'] != 'install':
        return state
    row = inspect_owned()
    if row:
        progress('Starting your existing Rebel installation…')
        command(['start', NAME], timeout=60)
    else:
        progress('Downloading Rebel’s official container. This can take several minutes…')
        command(['pull', 'rebeliptv/iptv:latest'], timeout=600)
        progress('Starting Rebel locally and keeping its settings in a dedicated data volume…')
        command(['run', '-d', '--name', NAME, '--label', LABEL,
                 '--restart', 'unless-stopped', '--publish', '127.0.0.1:18808:8080',
                 '--volume', 'orbital-personal-rebel-data:/app/data',
                 '--env', 'TZ=Etc/UTC', 'rebeliptv/iptv:latest'], timeout=90)
    return ready(jf)
