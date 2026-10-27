"""Validate an administrator-supplied catalogue before replacing its saved snapshot."""
import json, math, os, re, threading
from datetime import datetime, timezone
from pathlib import Path
PROVIDERS=('apple-tv','netflix','disney-plus','hulu','max','prime-video','peacock','paramount-plus')
_lock=threading.Lock()
def root():
 value=os.environ.get('SPORTS_DATA_DIR')
 if not value:raise ValueError('Server storage is not configured')
 return Path(value)/'catalogues'
def status():
 rows=[]
 for name in PROVIDERS:
  p=root()/(name+'.json')
  if p.is_file():
   d=json.loads(p.read_text());rows.append({'provider':name,'entries':len(d['entries']),'updated_at':d['updated_at']})
 return {'catalogues':rows}
def save(data):
 if not isinstance(data,dict) or data.get('provider') not in PROVIDERS:raise ValueError('Choose a supported service catalogue')
 if data.get('region','US') != 'US':raise ValueError('This catalogue view currently supports US listings only')
 stamp=data.get('updated_at');when=datetime.fromisoformat(str(stamp).replace('Z','+00:00'))
 if when.tzinfo is None or when.timestamp()>datetime.now(timezone.utc).timestamp()+300:raise ValueError('Catalogue date must be a real past observation with a timezone')
 values=data.get('entries')
 if not isinstance(values,list) or len(values)>100000:raise ValueError('Catalogue entry limit')
 clean=[];seen=set()
 for e in values:
  if not isinstance(e,dict) or e.get('type') not in ('Movie','Series') or type(e.get('tmdb')) is not int or not 0<e['tmdb']<2**53:raise ValueError('Each title needs its type and TMDB ID')
  identity=e['type']+':'+str(e['tmdb'])
  if identity in seen:raise ValueError('Duplicate catalogue title')
  seen.add(identity);title=e.get('title')
  if not isinstance(title,str) or not title.strip() or len(title)>400:raise ValueError('Invalid title')
  row={'id':identity,'tmdb':e['tmdb'],'type':e['type'],'title':title,'overview':str(e.get('overview') or '')[:500]}
  for key in ('year','votes'):
   v=e.get(key)
   if v is not None and (type(v) is not int or v<0 or v>2**31-1):raise ValueError('Invalid '+key)
   row[key]=v
  for key in ('rating','popularity'):
   v=e.get(key)
   if v is not None and (type(v) not in (int,float) or not math.isfinite(v) or v<0 or (key=='rating' and v>10)):raise ValueError('Invalid '+key)
   row[key]=v
  genres=e.get('genres',[])
  if not isinstance(genres,list) or len(genres)>50 or any(type(g) is not int for g in genres):raise ValueError('Invalid genres')
  row['genres']=genres
  for key in ('poster','backdrop'):
   v=e.get(key)
   if v is not None and (not isinstance(v,str) or not re.fullmatch(r'/[A-Za-z0-9_.-]{1,200}',v)):raise ValueError('Artwork must be a TMDB image path')
   row[key]=v
  clean.append(row)
 result={'provider':data['provider'],'updated_at':when.isoformat(),'region':'US','entries':clean}
 with _lock:
  folder=root();folder.mkdir(parents=True,exist_ok=True);p=folder/(data['provider']+'.json');tmp=p.with_suffix('.new')
  with tmp.open('x',encoding='utf-8') as f:json.dump(result,f);f.flush();os.fsync(f.fileno())
  try:os.replace(tmp,p)
  finally:tmp.unlink(missing_ok=True)
 return {'provider':data['provider'],'entries':len(clean),'updated_at':result['updated_at']}
