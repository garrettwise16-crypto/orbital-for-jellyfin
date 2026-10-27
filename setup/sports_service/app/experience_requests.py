"""Read-only installed-Seerr bridge using a private host key and verified binding.

The key never enters a client response. Verify remote Jellyfin association on
EVERY read; an outdated mapping cannot reveal another household user's requests.
No request submission, polling scheduler, retry, or acquisition-service mutation exists here.
"""
from __future__ import annotations
import json,os,stat,time
from pathlib import Path
from urllib.parse import urlsplit
from experience import Actor,Fault,integer,item_id
from experience_transport import FixedJsonGet
from seerr_read_adapter import SeerrBinding,SeerrReadAdapter

def private_text(path,limit):
    p=Path(path);info=p.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size>limit or (os.name=='posix' and (info.st_mode & 0o077 or info.st_uid!=os.getuid())):raise ValueError('Private owned regular file required')
    flags=os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)
    fd=os.open(p,flags)
    try:
        opened=os.fstat(fd)
        if (opened.st_dev,opened.st_ino)!=(info.st_dev,info.st_ino):raise ValueError('File changed during open')
        with os.fdopen(fd,encoding='utf-8') as f:
            fd=None;data=f.read(limit+1)
        if len(data)>limit:raise ValueError('Private file too large')
        return data
    finally:
        if fd is not None:os.close(fd)

class VerifiedSeerrRead:
    def __init__(self,server,base,key,bindings,transport):
        self.server=server;self.base=base.rstrip('/');self._key=key;self.bindings=bindings;self.transport=transport
    @classmethod
    def from_files(cls,server,base,key_path,binding_path):
        key=private_text(key_path,512).strip();raw=json.loads(private_text(binding_path,16384))
        if not isinstance(raw,dict) or len(raw)>100:raise ValueError('Bindings must be a small object')
        bindings={item_id(k):integer(v,1,2**53-1) for k,v in raw.items()}
        if not key or any(ord(c)<32 for c in key):raise ValueError('Invalid private key')
        return cls(server,base,key,bindings,FixedJsonGet(base,header='X-Api-Key'))
    def title(self,actor,kind,tmdb,copies,*,seasons=(),deadline=None):
        if actor.server!=self.server or actor.user not in self.bindings:raise Fault(403,'seerr_account_not_linked')
        if not isinstance(seasons,(list,tuple)) or len(seasons)>100:raise Fault(400,'invalid_seasons')
        seasons=[integer(v,0,1000) for v in seasons];seerr_id=self.bindings[actor.user]
        def get(path):
            url=self.base+path
            return self.transport(url,self._key,deadline=deadline) if isinstance(self.transport,FixedJsonGet) else self.transport(url,self._key)
        remote=get('/api/v1/user/'+str(seerr_id))
        if not isinstance(remote,dict) or remote.get('id')!=seerr_id or item_id(remote.get('jellyfinUserId'))!=actor.user:raise Fault(403,'seerr_account_binding_changed')
        binding=SeerrBinding(actor.server,actor.user,seerr_id)
        return SeerrReadAdapter(get).title(actor,binding,kind,tmdb,copies,now=int(time.time()),requested_seasons=seasons)
