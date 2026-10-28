"""Server care uses Jellyfin APIs; no guessed database paths or live file copies."""
import json
import os
import shutil
import subprocess
import re
from pathlib import Path, PureWindowsPath
from .netio import HttpError
from .remote_access import local_target


def idle(jf):
    if any(s.get('NowPlayingItem') for s in jf.call('GET','/Sessions') or []):
        raise ValueError('Someone is watching. Wait until playback finishes before this operation.')
    if any(t.get('State') in ('Running','Cancelling') for t in jf.call('GET','/ScheduledTasks') or []):
        raise ValueError('Jellyfin is busy with a scheduled task. Wait for it to finish and retry.')


def local(jf):
    try: local_target(jf);return True
    except (ValueError,HttpError):return False


def inspect(jf,progress):
    progress('Checking server paths, library access and playback configuration…')
    info=jf.call('GET','/System/Info');same=local(jf)
    # Loopback can also forward to Linux in Docker/WSL. Never measure a similarly named host path.
    native_local=same and os.name=='nt' and PureWindowsPath(info.get('ProgramDataPath') or '').is_absolute() and Path(info['ProgramDataPath']).is_dir()
    storage=[]
    for name in ('ProgramDataPath','CachePath','TranscodingTempPath'):
        path=info.get(name)
        row={'kind':name,'path':path,'freeGiB':None,'access':'not_checked'}
        if path:
            try:
                jf.call('POST','/Environment/ValidatePath',body={'Path':path,'ValidateWritable':True,'IsFile':False},retries=0)
                row['access']='writable_by_server'
            except HttpError:row['access']='needs_attention'
            if native_local and PureWindowsPath(path).is_absolute() and Path(path).is_dir():row['freeGiB']=round(shutil.disk_usage(path).free/1024**3,1)
        storage.append(row)
    libraries=[]
    for folder in jf.virtual_folders():
        for path in folder.get('Locations',[]):
            libraries.append({'name':folder['Name'],'path':path,'readable':jf.validate_path(path),
                'help':'For network folders, give the Jellyfin service account access. A mapped drive in your desktop session may be unavailable after reboot.'})
    encoding=jf.call('GET','/System/Configuration/encoding')
    cards=[]
    if native_local:
        try:
            r=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',
                'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'],capture_output=True,text=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if r.returncode==0:
                value=json.loads(r.stdout or '[]');cards=value if isinstance(value,list) else [value]
        except (ValueError,OSError,subprocess.TimeoutExpired):pass
    return {'serverVersion':info.get('Version'),'localServer':same,'storage':storage,'libraries':libraries,'graphics':cards,
            'hardwareMode':encoding.get('HardwareAccelerationType') or 'software','toneMapping':bool(encoding.get('EnableTonemapping') or encoding.get('EnableVppTonemapping')),
            'checksStillNeeded':['Play and seek a movie on each intended device.','Check subtitles, audio and an HDR title if you use HDR.','After a convenient reboot, confirm Jellyfin and network libraries return.','Confirm away-from-home playback on another connection.'],
            'message':'Configuration checked. This is not playback, HDR, reboot or outside-home proof. Free space is measured only when this is the same local server.'}


def backups(jf):
    rows=jf.call('GET','/Backup') or []
    return [{'path':r['Path'],'created':r.get('DateCreated'),'serverVersion':r.get('ServerVersion'),'options':r.get('Options',{})} for r in rows]


def create_backup(jf,body,progress):
    idle(jf);progress('Creating a Jellyfin database backup. Keep this window open; media files are not included…')
    created=jf.call('POST','/Backup/Create',body={'Database':True,'Metadata':body.get('metadata') is True,'Subtitles':False,'Trickplay':False},timeout=600,retries=0)
    if not isinstance(created,dict) or not created.get('Path'):raise RuntimeError('No backup receipt returned. Check existing backups before retrying; do not assume it failed.')
    found=next((r for r in backups(jf) if r['path']==created['Path']),None)
    if not found:raise RuntimeError('Backup creation returned, but it is not listed yet. Refresh before creating another.')
    manifest=jf.call('GET','/Backup/Manifest',params={'path':found['path']})
    if not isinstance(manifest,dict) or not manifest.get('Options',{}).get('Database'):raise RuntimeError('The backup database manifest could not be verified.')
    return {'backup':found,'message':'Backup created and its database manifest verified. This is not a restore test. Keep an additional protected copy off this server; archives contain private server data. Media and external services need separate backups.'}


def restore_backup(jf,body,progress):
    if body.get('confirmation')!='RESTORE':raise ValueError('Type RESTORE to confirm replacing current server data and restarting Jellyfin.')
    info=jf.public_info()
    if body.get('serverId')!=info.get('Id'):raise ValueError('The connected server changed. Refresh the backup list before restoring.')
    selected=next((r for r in backups(jf) if r['path']==body.get('path')),None)
    if not selected:raise ValueError('Choose a backup currently listed by this server.')
    if not same_version(selected['serverVersion'],info.get('Version')):raise ValueError('Restore using the same Jellyfin version as the backup. No restore was requested.')
    idle(jf)
    # Preserve the current database before requesting the destructive restore.
    recovery=create_backup(jf,{},progress)['backup']
    progress('A current recovery backup is saved. Requesting restore; Jellyfin will restart…')
    try:
        jf.call('POST','/Backup/Restore',body={'ArchiveFileName':selected['path']},timeout=20,retries=0)
    except HttpError as exc:
        if exc.unreachable:
            return {'requested':None,'recoveryBackup':recovery,'message':'The connection closed during the restore request. Jellyfin may be restarting; the outcome is not yet known. Reopen Setup and sign in to check the server before requesting another restore. Your current recovery backup was saved.'}
        raise
    return {'requested':True,'recoveryBackup':recovery,'message':'Restore requested. Jellyfin will restart. Close and reopen Setup, sign in again, and check users, libraries and playback. A successful request is not proof that restoration finished.'}


def same_version(left,right):
    # Assembly versions include an extra zero revision; never ignore nonzero revisions or prerelease labels.
    if not left or not right:return False
    if not re.fullmatch(r'\d+(?:\.\d+){1,3}',left) or not re.fullmatch(r'\d+(?:\.\d+){1,3}',right):return left==right
    def parts(value):
        result=[int(x) for x in value.split('.')]
        while len(result)>2 and result[-1]==0:result.pop()
        return result
    return parts(left)==parts(right)


def check_release():
    from urllib.request import Request,urlopen
    url='https://api.github.com/repos/garrettwise16-crypto/orbital-for-jellyfin/releases?per_page=30'
    with urlopen(Request(url,headers={'User-Agent':'Orbital-Setup','Accept':'application/vnd.github+json'}),timeout=15) as response:rows=json.load(response)
    for row in rows:
        if row.get('draft') or not str(row.get('tag_name','')).startswith('setup-v'):continue
        asset=next((a for a in row.get('assets',[]) if a.get('name')=='OrbitalSetup.exe'),None)
        link=row.get('html_url','')
        if asset and link.startswith('https://github.com/garrettwise16-crypto/orbital-for-jellyfin/releases/tag/'):
            return {'tag':row['tag_name'],'url':link,'sha256':asset.get('digest'), 'message':'Published setup preview found. Review its release notes and checksum before downloading. This executable is unsigned; this check does not install or upgrade Jellyfin.'}
    raise RuntimeError('No published setup download was found. Your installation was not changed.')
