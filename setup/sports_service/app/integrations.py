"""Administrator-owned optional services. Credentials stay in server storage."""
from pathlib import Path
from collections.abc import Mapping
from urllib.parse import urlsplit
import json, os, threading, time
from experience import Fault, item_id
from experience_transport import FixedJsonGet
from experience_requests import VerifiedSeerrRead

_lock=threading.RLock()
def path():
    root=os.environ.get('SPORTS_DATA_DIR')
    if not root:raise ValueError('Server storage is not configured')
    return Path(root)/'integrations.json'
def load():
    p=path()
    if not p.exists():return {'personal_library':True,'requests':{'enabled':False}}
    if p.is_symlink() or p.stat().st_size>16384:raise ValueError('Invalid integration settings')
    return json.loads(p.read_text(encoding='utf-8'))
def masked(config=None):
    cfg=config or load(); req=cfg.get('requests',{})
    return {'personal_library':cfg.get('personal_library',True),
            'requests':{'enabled':req.get('enabled',False),'url':req.get('url',''),
                        'key_saved':bool(req.get('key'))}}
def save(data):
    if not isinstance(data,dict) or set(data)-{'personal_library','requests'}:raise ValueError('Unknown integration setting')
    with _lock:
        old=load();personal=data.get('personal_library',old.get('personal_library',True))
        if type(personal) is not bool:raise ValueError('Choose whether personal library is enabled')
        req=data.get('requests',old.get('requests',{}))
        if not isinstance(req,dict) or set(req)-{'enabled','url','key'}:raise ValueError('Invalid request settings')
        enabled=req.get('enabled',False)
        if type(enabled) is not bool:raise ValueError('Choose whether Requests is enabled')
        url=str(req.get('url','')).rstrip('/');key=req.get('key')
        if key is None:key=old.get('requests',{}).get('key','')
        if not isinstance(key,str) or len(key)>512 or any(ord(c)<32 for c in key):raise ValueError('Invalid service key')
        if enabled:
            parsed=urlsplit(url)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                raise ValueError('Enter the Seerr server address, without a path or password')
            if not key:raise ValueError('Enter your Seerr API key')
            transport=FixedJsonGet(url,header='X-Api-Key',timeout=4)
            # A successful account-list call proves key permission before saving.
            result=transport(url+'/api/v1/user?take=1&skip=0',key)
            if not isinstance(result,dict) or not isinstance(result.get('results'),list):raise ValueError('The service did not return a Seerr account list')
        cfg={'personal_library':personal,'requests':{'enabled':enabled,'url':url,'key':key}}
        p=path();p.parent.mkdir(parents=True,exist_ok=True)
        tmp=p.with_suffix('.new')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as handle:
                json.dump(cfg,handle);handle.flush();os.fsync(handle.fileno())
            os.replace(tmp,p)
        finally:
            if tmp.exists():tmp.unlink()
        return masked(cfg)

class LinkedAccounts(Mapping):
    """Discover existing Jellyfin associations; never link accounts by display name."""
    def __init__(self,base,key,transport):
        self.base,self.key,self.transport=base,key,transport
        self.rows={};self.until=0;self.lock=threading.Lock()
    def refresh(self):
        with self.lock:
            if time.monotonic()<self.until:return
            rows={};duplicates=set()
            deadline=time.monotonic()+8
            for start in range(0,1000,100):
                if time.monotonic()>=deadline:raise Fault(504,'request_account_list_deadline')
                data=self.transport(self.base+f'/api/v1/user?take=100&skip={start}',self.key,deadline=deadline)
                page=data.get('results') if isinstance(data,dict) else None
                if not isinstance(page,list):raise Fault(502,'request_account_list_unavailable')
                for row in page:
                    uid=row.get('jellyfinUserId');number=row.get('id')
                    if not uid or type(number) is not int:continue
                    uid=item_id(uid)
                    if uid in rows:duplicates.add(uid)
                    rows[uid]=number
                if len(page)<100:break
            else:raise Fault(503,'request_account_list_limit')
            for uid in duplicates:rows.pop(uid,None)
            self.rows=rows;self.until=time.monotonic()+15
    def __getitem__(self,key):self.refresh();return self.rows[key]
    def __iter__(self):self.refresh();return iter(self.rows)
    def __len__(self):self.refresh();return len(self.rows)

def request_bridge(server,cfg):
    req=cfg.get('requests',{})
    if not req.get('enabled'):return None
    base=req['url'];key=req['key'];transport=FixedJsonGet(base,header='X-Api-Key',timeout=4)
    return VerifiedSeerrRead(server,base,key,LinkedAccounts(base,key,transport),transport)
