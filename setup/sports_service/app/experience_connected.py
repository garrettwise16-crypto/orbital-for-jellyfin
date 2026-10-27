"""Connected, viewer-token-only experience endpoints; no acquisition sender.

Extends the tested state API. Every output goes through current authorization
and spoiler projection. Catalogue observations are bounded, coalesced, dated and
explicitly non-transactional; all page items are freshly hydrated.
"""
from __future__ import annotations
import contextvars,copy,json,re,time,hashlib
from collections import OrderedDict
from urllib.parse import urlencode,urlsplit
from experience import Fault,Pager,hidden,rule,matches,integer,item_id,keys,text,digest,episode_projection,recommendations
from experience_http import Service,PREFIX
from experience_catalog import CatalogCache

LIGHT_FIELDS='Genres,RecursiveItemCount,SortName,PlayAccess,ProviderIds,MediaSourceCount,Etag,ParentId,DateCreated'
FULL_FIELDS=LIGHT_FIELDS+',Overview,MediaSources'
BUDGET=contextvars.ContextVar('experience_deadline',default=None)

class ConnectedService(Service):
    def __init__(self,*args,sports_get=None,sports_origin=None,seerr_read=None,**kwargs):
        super().__init__(*args,**kwargs)
        self.seerr_read=seerr_read;self.catalog=CatalogCache();self.sports_get=sports_get;self.sports_origin=(sports_origin or '').rstrip('/')
    def _json(self,path,credential,params=None):
        url=self.base+path+('?' + urlencode(params) if params else '')
        end=BUDGET.get()
        if end is not None and time.monotonic()>=end:raise Fault(504,'request_deadline')
        from experience_transport import FixedJsonGet
        value=self.fetch(url,credential,deadline=end) if isinstance(self.fetch,FixedJsonGet) else self.fetch(url,credential)
        if end is not None and time.monotonic()>=end:raise Fault(504,'request_deadline')
        return value
    def request(self,method,path,headers,body=b''):
        budget=BUDGET.set(time.monotonic()+12)
        try:
            endpoint=urlsplit(path).path.removeprefix(PREFIX)
            if re.fullmatch(r'/mutations/[0-9a-f]{32}/cancel',endpoint):
                data,actor,credential,state=self.parse(method,path,headers,body)
                keys(data,set())
                return 200,self.store.cancel_mutation(actor,endpoint.split('/')[2])
            if endpoint in ('/query','/home','/history','/series','/recommendations','/search','/segments','/request-status','/title-request','/title-request-submit','/discover-search','/discover-plan','/discover-submit','/my-requests'):
                return self.connected(method,path,headers,body)
            result=super().request(method,path,headers,body)
            if endpoint=='/state' and method=='GET' and result[0]==200:
                result[1]['capabilities'].update({'connected':True,'cancel_mutation':True,'history':self.config.personal,'search':self.config.personal,'recommendations':self.config.personal})
            return result
        except Fault as e:return e.status,{'error':e.code}
        except Exception:return 503,{'error':'experience_unavailable'}
        finally:BUDGET.reset(budget)
    def _items(self,actor,credential,ids):
        if not ids:return []
        if len(ids)>2000:raise Fault(422,'item_batch_limit')
        wanted={item_id(i) for i in ids};result=[]
        for offset in range(0,len(ids),100):
            part=[item_id(i) for i in ids[offset:offset+100]]
            raw=self._json('/Users/'+actor.user+'/Items',credential,{'Ids':','.join(part),'Limit':len(part),'EnableUserData':'true','Fields':FULL_FIELDS,'EnableTotalRecordCount':'false','ImageTypeLimit':1})
            if not isinstance(raw,dict) or not isinstance(raw.get('Items'),list):raise Fault(502,'upstream_items_shape')
            for row in raw['Items']:
                if isinstance(row,dict) and item_id(row.get('Id')) in wanted:result.append(row)
        return result
    def _scan(self,actor,credential,types):
        rows=[];seen=set();total=None
        while total is None or len(rows)<total:
            raw=self._json('/Users/'+actor.user+'/Items',credential,{'Recursive':'true','IncludeItemTypes':','.join(types),
                'Limit':1000,'StartIndex':len(rows),'SortBy':'SortName','SortOrder':'Ascending','Fields':LIGHT_FIELDS,
                'EnableImages':'false','EnableUserData':'true','EnableTotalRecordCount':'true'})
            count=raw.get('TotalRecordCount')
            if type(count) is not int or not 0<=count<=100000:raise Fault(502,'catalogue_count_unavailable')
            if total is not None and count!=total:raise Fault(409,'catalogue_changed')
            total=count;page=raw.get('Items')
            if not isinstance(page,list) or len(page)>1000 or (not page and len(rows)<total):raise Fault(502,'catalogue_incomplete')
            for row in page:
                uid=item_id(row.get('Id'))
                if uid in seen:raise Fault(409,'catalogue_changed')
                seen.add(uid);rows.append(row)
            if len(rows)>total:raise Fault(409,'catalogue_changed')
        return rows
    def inventory(self,actor,credential,types=('Movie','Series'),force=False):
        key=(actor.key,actor.policy,hashlib.sha256(credential.encode()).hexdigest(),tuple(sorted(types)))
        return self.catalog.get(key,lambda:self._scan(actor,credential,types),force=force)
    def parse(self,method,path,headers,body):
        if not self.config.enabled or self.store is None:raise Fault(404,'not_enabled')
        if method!='POST' or urlsplit(path).query or not path.startswith(PREFIX+'/'):raise Fault(405,'post_json_required')
        h={k.lower():v for k,v in headers.items()}
        if h.get('origin') is not None and h['origin'] not in self.config.allowed_origins:raise Fault(403,'origin_not_allowed')
        if h.get('content-type','').split(';')[0].strip().lower()!='application/json':raise Fault(415,'json_required')
        if not 1<=len(body)<=65536:raise Fault(413,'body_size')
        try:data=json.loads(body,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError,UnicodeError):raise Fault(400,'invalid_json') from None
        if not isinstance(data,dict):raise Fault(400,'invalid_fields')
        actor,credential=self._actor(headers)
        return data,actor,credential,self.store.read(actor)
    def visible(self,rows,state,reveal=()):
        prefs=state['preferences'] if self.config.spoilers else {}
        return [episode_projection(row,prefs,item_id(row['Id']) in reveal) for row in rows]
    def provider(self,actor,credential,r):
        if not self.sports_get or not self.sports_origin:raise Fault(503,'provider_service_not_configured')
        discovery=copy.deepcopy(r.get('discovery',{}))
        if discovery.get('scope','library')!='library':raise Fault(422,'external_catalogue_requires_existing_discovery')
        query={'provider':r['provider'],'view':'discover',**discovery,'grid':'1','scope':'library','limit':60,'start':0}
        rows=[];seen=set();total=None
        while total is None or query['start']<total:
            from experience_transport import FixedJsonGet
            url=self.sports_origin+'/sports/api/catalogue?'+urlencode(query)
            raw=self.sports_get(url,credential,deadline=BUDGET.get()) if isinstance(self.sports_get,FixedJsonGet) else self.sports_get(url,credential)
            count=raw.get('total')
            if type(count) is not int or not 0<=count<=50000 or raw.get('scope')!='library' or raw.get('view')!='discover':raise Fault(502,'provider_contract_changed')
            if total is not None and total!=count:raise Fault(409,'provider_catalogue_changed')
            total=count;entries=raw.get('entries')
            if not isinstance(entries,list) or (not entries and query['start']<total):raise Fault(502,'provider_incomplete')
            for entry in entries:
                row=entry.get('item') if isinstance(entry,dict) else None
                if not isinstance(row,dict):raise Fault(502,'provider_library_item_missing')
                uid=item_id(row.get('Id'))
                if uid not in seen:rows.append(row);seen.add(uid)
            query['start']+=len(entries)
            if query['start']>total or len(entries)>60:raise Fault(409,'provider_catalogue_changed')
        return rows
    def query(self,data,actor,credential,state):
        if not self.config.shelves:raise Fault(403,'feature_not_enabled')
        keys(data,{'rule','cursor','limit','include_hidden','reveal','refresh'})
        limit=integer(data.get('limit',40),1,60)
        if type(data.get('refresh',False)) is not bool:raise Fault(400,'invalid_boolean')
        reveal=data.get('reveal',[])
        if not isinstance(reveal,list) or len(reveal)>60:raise Fault(400,'invalid_reveal')
        reveal={item_id(i) for i in reveal};cursor=data.get('cursor');meta={}
        if cursor is not None and any(k in data for k in ('rule','include_hidden','refresh')):raise Fault(400,'cursor_query_mismatch')
        if cursor is None:
            r=rule(data.get('rule',{}))
            if r.get('availability')=='verified':raise Fault(422,'verification_evidence_not_configured')
            if r.get('provider'):
                # Delegate the existing taxonomy rather than reimplementing it differently.
                rows=self.provider(actor,credential,r)
                r={k:v for k,v in r.items() if k not in ('provider','discovery')};r['sort']='source'
                rows=[{**row,'_source_order':n} for n,row in enumerate(rows)]
                meta={'consistency':'provider_dated_observation_not_transactional'}
            else:
                snapshot=self.inventory(actor,credential,r.get('types',('Movie','Series')),data.get('refresh',False))
                rows=snapshot['rows'];meta={'generation':snapshot['generation'],'observed_at':snapshot['observed_at'],'consistency':snapshot['consistency']}
            cursor=self.pager.open(actor,state,rows,r,data.get('include_hidden',False))
        page=self.pager.page(actor,state,cursor,lambda ids:self._items(actor,credential,ids),limit)
        page['items']=self.visible(page['items'],state,reveal)
        return {**page,**meta}
    def connected(self,method,path,headers,body):
        data,actor,credential,state=self.parse(method,path,headers,body)
        endpoint=path[len(PREFIX):]
        if endpoint=='/query':return 200,self.query(data,actor,credential,state)
        if endpoint=='/home':
            keys(data,{'limit'});limit=integer(data.get('limit',12),1,18)
            if not self.config.shelves:raise Fault(403,'feature_not_enabled')
            rows=[]
            for shelf in [s for s in state['shelves'] if s['pinned']][:8]:
                try:
                    result=self.query({'rule':shelf['rule'],'limit':limit},actor,credential,state)
                    rows.append({'id':shelf['id'],'name':shelf['name'],'items':result['items'],'open_with_fresh_query':True,'snapshot_count':result['snapshot_count'],'state':'ready'})
                except Fault as e:rows.append({'id':shelf['id'],'name':shelf['name'],'items':[],'state':'unavailable','reason':e.code})
            return 200,{'revision':state['revision'],'rows':rows,'truncated_shelves':max(0,sum(s['pinned'] for s in state['shelves'])-8),'all_shelves_available_in_management':True}
        if endpoint=='/history':
            if not self.config.personal:raise Fault(403,'feature_not_enabled')
            keys(data,{'start','limit'});start=integer(data.get('start',0),0,100000);limit=integer(data.get('limit',40),1,60)
            rows=self._json('/Users/'+actor.user+'/Items',credential,{'Recursive':'true','IncludeItemTypes':'Movie,Episode','Filters':'IsPlayed',
                'StartIndex':start,'Limit':limit,'SortBy':'DatePlayed','SortOrder':'Descending','Fields':FULL_FIELDS,'EnableUserData':'true','EnableTotalRecordCount':'true'})
            return 200,{'items':self.visible(rows.get('Items',[]),state),'total':rows.get('TotalRecordCount'),'start':start,'read_only':True,'history_semantics':'most_recent_played_items_not_every_playback_event'}
        if endpoint=='/series':
            if not self.config.personal:raise Fault(403,'feature_not_enabled')
            keys(data,{'id','start','limit'},{'id'});uid=item_id(data['id']);items=self._items(actor,credential,[uid])
            if not items or items[0].get('Type')!='Series':raise Fault(404,'series_unavailable')
            start=integer(data.get('start',0),0,100000);limit=integer(data.get('limit',40),1,60)
            rows=self._json('/Shows/'+uid+'/Episodes',credential,{'UserId':actor.user,'StartIndex':start,'Limit':limit,'Fields':FULL_FIELDS,'EnableUserData':'true','EnableTotalRecordCount':'true'})
            return 200,{'series':self.visible(items,state)[0],'items':self.visible(rows.get('Items',[]),state),'total':rows.get('TotalRecordCount'),'start':start,'read_only':True}
        if endpoint=='/recommendations':
            if not self.config.personal:raise Fault(403,'feature_not_enabled')
            keys(data,{'limit','refresh'});limit=integer(data.get('limit',18),1,40)
            if type(data.get('refresh',False)) is not bool:raise Fault(400,'invalid_boolean')
            snapshot=self.inventory(actor,credential,('Movie','Series'),data.get('refresh',False))
            # This endpoint advertises playable-attempt eligibility, NOT verified rendering.
            candidates=[r for r in snapshot['rows'] if r.get('PlayAccess')=='Full' and type(r.get('MediaSourceCount')) is int and r['MediaSourceCount']>0 and r.get('Type')=='Movie']
            ranked=recommendations(candidates,state,{r['Id'] for r in candidates},limit=min(60,limit+20))
            by_id={item_id(r['Id']):r for r in self._items(actor,credential,[v['id'] for v in ranked])}
            result=[]
            for candidate in ranked:
                row=by_id.get(candidate['id'])
                if row is None or hidden(row,state) or (row.get('UserData') or {}).get('Played') is not False or row.get('PlayAccess')!='Full' or row.get('MediaSourceCount',0)<=0:continue
                reason=[r.replace('verified library','available library') for r in candidate['reasons']]
                result.append({'item':self.visible([row],state)[0],'reasons':reason,'playability':'attempt_allowed_not_render_verified'})
            return 200,{'items':result[:limit],'method':'local_genre_feedback_and_diversity','generation':snapshot['generation'],'series_recommendations':'omitted_until_episode_coverage_adapter'}
        if endpoint=='/search':
            if not self.config.personal:raise Fault(403,'feature_not_enabled')
            keys(data,{'term','type','start','limit'});term=text(data.get('term'),100)
            kind=data.get('type','Movie,Series,Episode')
            if kind not in ('Movie','Series','Episode','Movie,Series,Episode','Person'):raise Fault(400,'invalid_search_type')
            start=integer(data.get('start',0),0,100000);limit=integer(data.get('limit',40),1,60)
            args={'SearchTerm':term,'StartIndex':start,'Limit':limit,'EnableUserData':'true','EnableTotalRecordCount':'true','Fields':FULL_FIELDS}
            # /Persons bypasses Jellyfin's ISearchProvider. The user-scoped Items
            # route applies the provider and the same permission filter for People.
            args.update({'IncludeItemTypes':kind,'Recursive':'true'})
            raw=self._json('/Users/'+actor.user+'/Items',credential,args)
            # Preserve upstream search-provider behavior. Do not build another competing indexer.
            got=raw.get('Items',[]);visible=[r for r in got if not hidden(r,state)]
            return 200,{'items':self.visible(visible,state),'next_start':start+len(got) if raw.get('TotalRecordCount',0)>start+len(got) else None,
                        'counts':'post_hide_total_unknown','engine':'jellyfin_configured_search_provider','external_requests_separate':True}
        if endpoint=='/segments':
            if not self.config.playback_preferences:raise Fault(403,'feature_not_enabled')
            keys(data,{'id'},{'id'});uid=item_id(data['id']);rows=self._items(actor,credential,[uid])
            if not rows or rows[0].get('Type') not in ('Movie','Episode'):raise Fault(404,'item_unavailable')
            raw=self._json('/MediaSegments/'+uid,credential)
            segments=raw.get('Items',[])
            if not isinstance(segments,list) or len(segments)>256:raise Fault(502,'segment_shape')
            duration=rows[0].get('RunTimeTicks');safe=[]
            for s in segments:
                if not isinstance(s,dict):continue
                a,b=s.get('StartTicks'),s.get('EndTicks')
                if s.get('Type') in ('Intro','Outro') and type(a) is int and type(b) is int and type(duration) is int and 0<=a<b<=duration:
                    safe.append({'Type':s['Type'],'StartTicks':a,'EndTicks':b})
            return 200,{'item_id':uid,'duration_ticks':duration,'segments':safe,'auto_intro':state['preferences']['auto_intro'],
                        'copy_binding':'item_level_segments_only_do_not_auto_apply_to_alternate_editions'}
        if endpoint in ('/title-request','/title-request-submit'):
            if not self.config.personal or not self.seerr_read:raise Fault(403,'request_feature_unavailable')
            from title_requests import handle
            return 200,handle(self,endpoint,data,actor,credential,BUDGET.get())
        if endpoint=='/request-status':
            if not self.config.personal:raise Fault(403,'feature_not_enabled')
            # Preserve the existing same-origin Seerr handoff, never invent a sender.
            keys(data,{'id','seasons'},{'id'});uid=item_id(data['id'])
            seasons=data.get('seasons',[])
            if not isinstance(seasons,list) or len(seasons)>100:raise Fault(400,'invalid_seasons')
            seasons=[integer(n,0,1000) for n in seasons]
            rows=self._items(actor,credential,[uid])
            if not rows:raise Fault(404,'item_unavailable')
            row=rows[0];tmdb=(row.get('ProviderIds') or {}).get('Tmdb');kind=row.get('Type')
            if kind not in ('Movie','Series') or not isinstance(tmdb,str) or not re.fullmatch(r'[1-9][0-9]{0,11}',tmdb):raise Fault(422,'title_identity_unavailable')
            # Authenticate the current role rather than deriving it from a client claim.
            user=self._json('/Users/Me',credential)
            admin=(user.get('Policy') or {}).get('IsAdministrator') is True
            status=None
            if self.seerr_read:
                from integration_contracts import AuthorizedCopy
                copies=[]
                if kind=='Movie':
                    copies=[AuthorizedCopy(uid,digest([uid,row.get('Etag')]),row.get('PlayAccess')=='Full',row.get('LocationType')!='Virtual' and bool(row.get('MediaSources')))]
                else:
                    eps=self._json('/Shows/'+uid+'/Episodes',credential,{'UserId':actor.user,'Limit':600,'IsMissing':'false','Fields':'Etag,PlayAccess,MediaSources','EnableImages':'false','EnableTotalRecordCount':'true'})
                    for ep in eps.get('Items',[]):
                        copies.append(AuthorizedCopy(item_id(ep['Id']),digest([ep['Id'],ep.get('Etag')]),ep.get('PlayAccess')=='Full',ep.get('LocationType')!='Virtual' and not ep.get('IsMissing') and bool(ep.get('MediaSources')),ep.get('ParentIndexNumber'),ep.get('IndexNumber')))
                status=self.seerr_read.title(actor,'movie' if kind=='Movie' else 'tv',int(tmdb),copies,seasons=seasons,deadline=BUDGET.get())
                if kind=='Series' and status.get('availability')=='in_library':status['availability']='partial_or_unconfirmed'
            # A verified linked viewer may open their own authenticated Seerr
            # title page. Seerr still enforces its own request permissions;
            # opening this link does not submit or approve a request.
            handoff=admin or status is not None
            return 200,{'status':status,'item_id':uid,'identity':{'type':'movie' if kind=='Movie' else 'tv','tmdb':int(tmdb)},
                'request_handoff_allowed':handoff,'request_path':('/movie/' if kind=='Movie' else '/tv/')+tmdb if handoff else None,
                'acquisition_sender':False,'upstream_status':'read_only_verified_binding' if status is not None else 'use_existing_authenticated_request_screen'}
        if endpoint in ('/discover-search','/discover-plan','/discover-submit','/my-requests'):
            # Oct 20 (Claude): in-app Requests screen; same linked-account Seerr rules as title requests.
            if not self.config.personal or not self.seerr_read:raise Fault(403,'request_feature_unavailable')
            from discover_requests import handle as discover
            return 200,discover(self,endpoint,data,actor,credential,BUDGET.get())
        raise Fault(404,'not_found')
