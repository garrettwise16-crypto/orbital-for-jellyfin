"""Small deployment planner and allowlisted, reviewable tester diagnostics."""
import json
import hashlib
import os
import platform
import re
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from . import __version__
from .netio import redact

MODES = ('windows', 'existing', 'docker', 'linux')

def preflight():
    free = shutil.disk_usage(Path.home()).free // (1024**3)
    return {'system': platform.system(), 'freeGiB': free, 'packageManager': bool(shutil.which('winget')),
            'recommended': 'windows' if os.name == 'nt' else 'existing',
            'checks': ['Plex remains available; media files stay in place.',
                       f'{free} GiB free on the setup profile drive. Media and transcode storage may be on another drive.',
                       'We check library folder access through Jellyfin before adding each library.'],
            'warning': 'Less than 10 GiB free. Make space before installing or scanning.' if free < 10 else None}

def deployment(body):
    mode=body.get('mode')
    if mode not in MODES: raise ValueError('Choose where Jellyfin will run.')
    if mode in ('windows','existing'):
        return {'mode':mode,'files':[], 'message':'Continue with the Windows installer below.' if mode=='windows' else 'Enter the existing Jellyfin address and choose Check server. No server installation is performed.'}
    if mode=='linux':
        script='''#!/usr/bin/env bash
set -euo pipefail
# Debian / Ubuntu only. Downloads and verifies the official Jellyfin installer.
work=$(mktemp -d)
cd "$work"
curl --fail --show-error --location --proto '=https' https://repo.jellyfin.org/install-debuntu.sh -o install-debuntu.sh
curl --fail --show-error --location --proto '=https' https://repo.jellyfin.org/install-debuntu.sh.sha256sum -o install-debuntu.sh.sha256sum
sha256sum -c install-debuntu.sh.sha256sum
printf 'Official installer verified. Review it before continuing.\\n'
less install-debuntu.sh
read -r -p 'Install Jellyfin on this computer? Type INSTALL: ' answer
[ "$answer" = INSTALL ] || exit 0
sudo bash install-debuntu.sh
printf 'Return to Orbital Setup and enter this server address on port 8096.\\n'
'''
        return {'mode':mode,'files':[{'name':'install-jellyfin.sh','content':script}], 'command':'bash install-jellyfin.sh',
                'message':'Download this file onto your Debian/Ubuntu server and run the command there. It verifies the official installer and asks before installation. Return here with the server address. Other distributions can use the Docker choice.',
                'limitations':'This installs upstream Jellyfin. Orbital feature compatibility is checked after connection; installing web/plugin files on another host is not automated by this Windows app.'}
    path=str(body.get('media','')).strip()
    if not path.startswith('/') or path=='/' or any(c in path for c in ('\n','\r','\x00','$')) or '..' in Path(path).parts:
        raise ValueError('Enter an absolute media folder on the Linux Docker host, such as /media/media. Dollar signs and parent traversal are not supported.')
    version=str(body.get('version','')).strip()
    if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?',version):raise ValueError('Choose an explicit Jellyfin image version, such as the version you have tested. Do not use latest.')
    port=int(body.get('port',8096))
    if not 1024<=port<=65535:raise ValueError('Choose a server port from 1024 to 65535.')
    uid=str(body.get('uid','1000'));gid=str(body.get('gid','1000'))
    if not re.fullmatch(r'\d{1,6}',uid) or not re.fullmatch(r'\d{1,6}',gid):raise ValueError('User and group IDs must be numbers.')
    compose={'name':'orbital-jellyfin','services':{'jellyfin':{'image':'jellyfin/jellyfin:'+version,'user':uid+':'+gid,'restart':'unless-stopped','ports':[f'{port}:8096'],
        'volumes':[{'type':'bind','source':'./config','target':'/config','bind':{'create_host_path':False}}, {'type':'bind','source':'./cache','target':'/cache','bind':{'create_host_path':False}}, {'type':'bind','source':path,'target':'/media','read_only':True,'bind':{'create_host_path':False}}]} }}
    script=f'''#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
[ "$(id -u)" = "{uid}" ] && [ "$(id -g)" = "{gid}" ] || {{ echo 'Run as the user/group chosen in Setup.'; exit 1; }}
[ ! -e config ] && [ ! -e cache ] || {{ echo 'Configuration already exists. Review before starting; nothing was changed.'; exit 1; }}
docker compose -f compose.yaml config --quiet
[ -z "$(docker compose -f compose.yaml ps -aq)" ] || {{ echo 'This Docker project already has containers. Nothing was changed.'; exit 1; }}
read -r -p 'Create this new Jellyfin server? Type CREATE: ' answer
[ "$answer" = CREATE ] || exit 0
mkdir config cache
docker compose -f compose.yaml up -d
printf 'Container requested. Return to Setup and check the server on port {port}. Media appears as /media in Jellyfin.\\n'
'''
    return {'mode':mode,'files':[{'name':'compose.yaml','content':json.dumps(compose,indent=2)+'\n'},{'name':'start-jellyfin.sh','content':script}], 'command':'bash start-jellyfin.sh',
            'message':'Save both files into a new folder on the Linux Docker host. Run the command there, then enter its address here. Media is mounted read-only at /media. The container starting does not prove Jellyfin is ready; Check server verifies it.',
            'limitations':'Requires Docker Compose on Linux. Hardware transcoding needs host-specific GPU configuration. Remote Orbital web/plugin file installation is not automated here. No router ports are opened.'}

def scrub(text, secrets=()):
    text=str(text)[:12000]
    for secret in secrets:
        if isinstance(secret,str) and len(secret)>3:text=text.replace(secret,'[redacted]')
    text=redact(text)
    text=re.sub(r'https?://[^\s<>"\']+','[address removed]',text,flags=re.I)
    text=re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b','[address removed]',text)
    text=re.sub(r'[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}','[email removed]',text)
    text=re.sub(r'(?i)\b(?:password|token|secret|api[_ -]?key)\s*[:=]\s*[^\s,;]+','[credential removed]',text)
    text=re.sub(r'(?i)\b[A-Z]:[\\/][^\n"<>]+','[path removed]',text)
    text=re.sub(r'(?<!\w)/(?:home|mnt|srv|media|Users|var)/[^\n"<>]+','[path removed]',text)
    return text

def findings(app, body):
    e=app.engine
    secrets=[getattr(e,'plex_account_token',None),getattr(e.plex,'token',None),getattr(e.jf,'token',None)]
    job=app.job.view()
    data={'format':'orbital-findings-v1','createdUtc':datetime.now(timezone.utc).isoformat(), 'setupVersion':__version__,
          'platform':platform.system(),'architecture':platform.machine(),
          'connected':{'plex':bool(e.plex),'jellyfin':bool(e.jf and e.jf.token)},
          'versions':{'plex':e.plex_identity.get('version'),'jellyfin':e.jf_info.get('Version')},
          'job':{'name':job['name'],'running':job['running'],'errorPresent':bool(job['error'])},
          'description':scrub(body.get('description',''),secrets),
          'playbackChecks':{key:body.get('checks',{}).get(key,'not_tested') for key in ('movie','resume','episodes','subtitles','remote')},
          'privacy':'No raw logs, account names, titles, media paths, server addresses or stored credentials are collected. Review your description and this preview before sharing. Nothing is uploaded.'}
    artifact=Path(sys.executable) if getattr(sys,'frozen',False) else Path(__file__)
    data['buildFingerprint']={'kind':'executable' if getattr(sys,'frozen',False) else 'source_module','sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}
    if any(value not in ('passed','failed','not_tested') for value in data['playbackChecks'].values()):raise ValueError('Invalid playback result.')
    run=app.last_run
    if run:
        report=e.report(run)
        data['migration']={'status':report['run']['status'],'writeStatus':report['writeStatus'],'exceptions':dict(Counter(x['kind'] for x in report['exceptions']))}
    result=job.get('result')
    if isinstance(result,dict) and isinstance(result.get('verify'),dict):data['migrationVerification']=result['verify']
    # Operation names and error categories only; never titles, paths or exception bodies.
    timeline=getattr(app.job,'timeline',None)
    events=timeline() if callable(timeline) else None
    if isinstance(events,list):data['operationTimeline']=events[-100:]
    return data
