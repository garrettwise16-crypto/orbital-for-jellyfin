"""Current-viewer title requests through Seerr's normal permission/quota API.

No forced approval, new provider, or acquisition-service mutation. Exact accessible Jellyfin
identity and freshly verified Seerr binding supply all sender fields.
"""
import threading,re,time
from experience import Fault,integer,item_id,keys
from title_request_transport import FixedSeerrPost

_locks_guard=threading.Lock()
_locks={}

def verified(bridge,actor,deadline):
 if actor.server!=bridge.server or actor.user not in bridge.bindings:raise Fault(403,'seerr_account_not_linked')
 user=bridge.bindings[actor.user]
 remote=read(bridge,'/api/v1/user/'+str(user),deadline)
 if not isinstance(remote,dict) or remote.get('id')!=user or item_id(remote.get('jellyfinUserId'))!=actor.user:raise Fault(403,'seerr_account_binding_changed')
 return user,remote

def read(bridge,path,deadline):
 from experience_transport import FixedJsonGet
 return bridge.transport(bridge.base+path,bridge._key,deadline=deadline) if isinstance(bridge.transport,FixedJsonGet) else bridge.transport(bridge.base+path,bridge._key)

def plan(bridge,actor,kind,tmdb,deadline):
 user,remote=verified(bridge,actor,deadline)
 permissions=integer(remote.get('permissions'),0,2**53-1)
 allowed=bool(permissions & (2|32|(262144 if kind=='movie' else 524288)))
 raw=read(bridge,f'/api/v1/{kind}/{tmdb}',deadline)
 if not isinstance(raw,dict) or type(raw.get('id')) is not int or raw['id']!=tmdb:raise Fault(502,'seerr_title_identity_mismatch')
 info=raw.get('mediaInfo') or {};requests=info.get('requests') or []
 if not isinstance(info,dict) or not isinstance(requests,list) or len(requests)>200:raise Fault(502,'seerr_request_shape')
 own=[];covered=set();global_movie=False
 for r in requests:
  if not isinstance(r,dict) or r.get('is4k') is True:continue
  status=r.get('status')
  if status not in (1,2,5):continue
  if kind=='movie':global_movie=True
  seasons=r.get('seasons') or []
  for season in seasons:
   if isinstance(season,dict) and season.get('status') in (1,2,5):covered.add(season.get('seasonNumber'))
  if (r.get('requestedBy') or {}).get('id')==user:
   own.append({'id':integer(r.get('id'),1,2**53-1),'status':{1:'pending',2:'approved',5:'completed'}[status]})
 available=info.get('status')==5
 season_options=[]
 if kind=='tv':
  values=raw.get('seasons') or []
  if not isinstance(values,list) or len(values)>100:raise Fault(502,'seerr_season_shape')
  media_seasons=info.get('seasons') or []
  for ss in media_seasons:
   if isinstance(ss,dict) and ss.get('status') in (2,3,5):covered.add(ss.get('seasonNumber'))
  for ss in values:
   n=ss.get('seasonNumber');episodes=ss.get('episodeCount')
   if type(n) is int and 0<=n<=1000 and type(episodes) is int and episodes>0:
    season_options.append({'number':n,'name':'Specials' if n==0 else f'Season {n}','requestable':allowed and not available and n not in covered})
 can=allowed and not available and (not global_movie if kind=='movie' else any(s['requestable'] for s in season_options))
 state='available_in_seerr' if available else own[0]['status'] if own else 'already_requested' if global_movie else 'not_requested'
 return {'identity':{'type':kind,'tmdb':tmdb},'title':str(raw.get('title') or raw.get('name') or '')[:200],
  'can_request':can,'state':state,'own_requests':own,'seasons':season_options,'permission':allowed},user

def accessible(service,actor,credential,uid):
 rows=service._items(actor,credential,[uid])
 if not rows:raise Fault(404,'item_unavailable')
 row=rows[0]
 if not (row.get('ProviderIds') or {}).get('Tmdb'):
  # List projections omit ProviderIds on some Jellyfin versions. Retrieve the
  # same owner-scoped item; never perform an administrative catalogue lookup.
  full=service._json('/Users/'+actor.user+'/Items/'+uid,credential)
  if not isinstance(full,dict) or item_id(full.get('Id'))!=uid or full.get('Type')!=row.get('Type'):raise Fault(409,'title_identity_changed')
  row=full
 return row

def handle(service,endpoint,data,actor,credential,deadline):
 submit=endpoint=='/title-request-submit'
 keys(data,{'id','identity','seasons'} if submit else {'id'},{'id','identity','seasons'} if submit else {'id'})
 uid=item_id(data['id']);row=accessible(service,actor,credential,uid)
 kind={'Movie':'movie','Series':'tv'}.get(row.get('Type'));tmdb=(row.get('ProviderIds') or {}).get('Tmdb')
 if not kind or not isinstance(tmdb,str) or not re.fullmatch(r'[1-9][0-9]{0,11}',tmdb):raise Fault(422,'title_identity_unavailable')
 tmdb=int(tmdb);bridge=service.seerr_read
 if not submit:
  result,_=plan(bridge,actor,kind,tmdb,deadline);return dict(result,item_id=uid)
 if data['identity']!={'type':kind,'tmdb':tmdb}:raise Fault(409,'title_identity_changed')
 seasons=data['seasons']
 if not isinstance(seasons,list) or len(seasons)>100 or any(type(n) is not int or not 0<=n<=1000 for n in seasons) or len(set(seasons))!=len(seasons):raise Fault(400,'invalid_seasons')
 if (kind=='movie' and seasons) or (kind=='tv' and not seasons):raise Fault(400,'select_seasons')
 with _locks_guard:
  if actor.key not in _locks:
   if len(_locks)>=100:raise Fault(429,'request_busy')
   _locks[actor.key]=threading.Lock()
  lock=_locks[actor.key]
 if not lock.acquire(blocking=False):raise Fault(409,'request_in_progress')
 try:
  result,user=plan(bridge,actor,kind,tmdb,deadline)
  if not result['can_request']:return dict(result,item_id=uid,submitted=False)
  if kind=='tv' and not set(seasons)<=set(s['number'] for s in result['seasons'] if s['requestable']):raise Fault(409,'seasons_already_requested_or_unavailable')
  # Recheck current access/binding immediately before the single upstream send.
  fresh=accessible(service,actor,credential,uid)
  if fresh.get('Type')!=row.get('Type') or (fresh.get('ProviderIds') or {}).get('Tmdb')!=str(tmdb):raise Fault(409,'title_identity_changed')
  current,_=verified(bridge,actor,deadline)
  if current!=user:raise Fault(403,'seerr_account_binding_changed')
  if not hasattr(bridge,'title_sender'):bridge.title_sender=FixedSeerrPost(bridge.base,header='X-Api-Key',timeout=8,max_bytes=1000000)
  body={'mediaType':kind,'mediaId':tmdb,'is4k':False}
  if kind=='tv':body['seasons']=seasons
  try:reply=bridge.title_sender(bridge.base+'/api/v1/request',bridge._key,user=user,body=body,deadline=deadline)
  except Fault as e:
   if e.status==409:
    latest,_=plan(bridge,actor,kind,tmdb,deadline);return dict(latest,item_id=uid,submitted=False)
   raise
  if not isinstance(reply,dict) or type(reply.get('id')) is not int or (reply.get('requestedBy') or {}).get('id')!=user or (reply.get('media') or {}).get('tmdbId')!=tmdb or reply.get('type')!=kind:raise Fault(502,'request_result_unconfirmed')
  state={1:'pending',2:'approved',5:'completed'}.get(reply.get('status'))
  if state is None:raise Fault(502,'request_result_unconfirmed')
  return {'item_id':uid,'identity':result['identity'],'title':result['title'],'state':state,'request_id':reply['id'],'submitted':True,'selected_seasons':seasons}
 finally:lock.release()
