"""Caller-scoped library queries and recommendations with bounded paging."""
from __future__ import annotations
import contextvars,secrets,threading,time
from collections import Counter,OrderedDict
from concurrent.futures import ThreadPoolExecutor
from experience import Fault,hidden,rule,matches,integer,item_id,keys,recommendations
from experience_connected import ConnectedService,BUDGET
from urllib.parse import urlsplit,parse_qs

PAGE_FIELDS='Genres,SortName,PlayAccess,ProviderIds,Etag,ParentId,RecursiveItemCount,Overview,DateCreated'
THIN_RATING=9.0   # Rating policy: community ratings >= 9.0 are thin samples
SORTS={'name':('SortName','Ascending'),'year':('ProductionYear,SortName','Descending,Ascending'),
       'runtime':('Runtime,SortName','Ascending,Ascending'),'rating':('CommunityRating,SortName','Descending,Ascending'),
       'added':('DateCreated,SortName','Descending,Ascending')}

class LiveCursors:
    def __init__(self,ttl=900,maximum=64):
        self.ttl=ttl;self.maximum=maximum;self.lock=threading.Lock();self.items=OrderedDict()
    def open(self,actor,state,r,include_hidden):
        sid=secrets.token_urlsafe(24)
        with self.lock:
            self._expire()
            self.items[sid]={'owner':actor.key,'policy':actor.policy,'revision':state['revision'],'rule':r,
                             'include_hidden':include_hidden,'expires':time.monotonic()+self.ttl}
            while len(self.items)>self.maximum:self.items.popitem(last=False)
        return sid
    def get(self,actor,state,sid):
        with self.lock:
            self._expire();c=self.items.get(sid)
        if not c or c['owner']!=actor.key or c['policy']!=actor.policy:raise Fault(410,'cursor_expired')
        if c['revision']!=state['revision']:raise Fault(409,'cursor_revision_changed')
        return c
    def _expire(self):
        now=time.monotonic()
        for k in [k for k,v in self.items.items() if v['expires']<=now]:self.items.pop(k)

def jellyfin_params(r):
    types=r.get('types') or ['Movie','Series']
    p={'Recursive':'true','IncludeItemTypes':','.join(types),'IsMissing':'false','EnableUserData':'true',
       'EnableImages':'true','ImageTypeLimit':1,'EnableTotalRecordCount':'true','Fields':PAGE_FIELDS}
    if r.get('genres'):p['Genres']='|'.join(r['genres']) if len(r['genres'])==1 else '|'.join(r['genres'])
    if r.get('parent_id'):p['ParentId']=r['parent_id']
    lo,hi=r.get('year_min'),r.get('year_max')
    if lo is not None or hi is not None:
        lo=lo or 1880;hi=hi or time.gmtime().tm_year+2
        if hi-lo<=200:p['Years']=','.join(str(y) for y in range(lo,hi+1))
    w=r.get('watched','all')
    if w=='watched':p['Filters']='IsPlayed'
    elif w=='unwatched':p['Filters']='IsUnplayed'
    elif w=='unfinished':p['Filters']='IsResumable' if types==['Movie'] else 'IsUnplayed'
    if r.get('favorites_only'):p['IsFavorite']='true'
    if r.get('min_rating'):p['MinCommunityRating']=r['min_rating']
    sort,order=SORTS.get(r.get('sort','name'),SORTS['name']);p['SortBy']=sort;p['SortOrder']=order
    return p

class LiveConnectedService(ConnectedService):
    def __init__(self,*a,**k):
        super().__init__(*a,**k);self.cursors=LiveCursors();self.rec_cache=OrderedDict();self.rec_lock=threading.Lock()
    def request(self,method,path,headers,body=b''):
        route=urlsplit(path)
        if path in ('/sports/api/experience/v1/player-context','/sports/api/experience/v1/player-bookmark'):
            budget=BUDGET.set(time.monotonic()+12)
            try:
                from experience_player import handle
                return handle(self,method,path,headers,body)
            except Fault as error:return error.status,{'error':error.code}
            except Exception:return 503,{'error':'experience_unavailable'}
            finally:BUDGET.reset(budget)
        return super().request(method,path,headers,body)
    def query(self,data,actor,credential,state):
        if not self.config.shelves:raise Fault(403,'feature_not_enabled')
        keys(data,{'rule','cursor','limit','include_hidden','reveal','refresh'})
        limit=integer(data.get('limit',40),1,60)
        reveal=data.get('reveal',[])
        if not isinstance(reveal,list) or len(reveal)>60:raise Fault(400,'invalid_reveal')
        reveal={item_id(i) for i in reveal};cursor=data.get('cursor')
        if cursor is None:
            r=rule(data.get('rule',{}))
            if r.get('availability')=='verified':raise Fault(422,'verification_evidence_not_configured')
            include_hidden=data.get('include_hidden',False)
            if type(include_hidden) is not bool:raise Fault(400,'invalid_boolean')
            sid=self.cursors.open(actor,state,r,include_hidden);start=0
            if r.get('sort')=='rating' and not r.get('provider'):
                # Household thin-rating rule: skip the >= 9.0 block that would otherwise lead the shelf.
                thin=self._json('/Users/'+actor.user+'/Items',credential,{**jellyfin_params(r),'MinCommunityRating':THIN_RATING,'Limit':0})
                start=thin.get('TotalRecordCount',0) if isinstance(thin,dict) and type(thin.get('TotalRecordCount')) is int else 0
        else:
            if any(k in data for k in ('rule','include_hidden','refresh')):raise Fault(400,'cursor_query_mismatch')
            if not isinstance(cursor,str) or len(cursor)>128 or cursor.count(':')!=1:raise Fault(400,'invalid_cursor')
            sid,raw=cursor.split(':')
            if not raw.isdigit() or len(raw)>6:raise Fault(400,'invalid_cursor')
            start=int(raw)
        c=self.cursors.get(actor,state,sid);r=c['rule'];params=jellyfin_params(r)
        items=[];total=None;pos=start
        # Hidden/local-only constraints may drop rows; read at most three upstream pages.
        for _ in range(3):
            if r.get('provider'):
                raw=self._provider_page(actor,credential,r,pos,limit)
            else:
                raw=self._json('/Users/'+actor.user+'/Items',credential,{**params,'StartIndex':pos,'Limit':limit})
            rows=raw.get('Items') if isinstance(raw,dict) else None
            if not isinstance(rows,list):raise Fault(502,'upstream_items_shape')
            total=raw.get('TotalRecordCount') if type(raw.get('TotalRecordCount')) is int else total
            for row in rows:
                pos+=1
                if row.get('Type')!='Unavailable' and (c['include_hidden'] or not hidden(row,state)) and matches(row,{k:v for k,v in r.items() if k not in ('provider','discovery')}):
                    items.append(row)
                    if len(items)>=limit:break
            if len(items)>=limit or not rows or (total is not None and pos>=total):break
        more=total is not None and pos<total
        return {'items':self.visible(items,state,reveal),'cursor':sid+':'+str(start),'next':sid+':'+str(pos) if more else None,'next_cursor':sid+':'+str(pos) if more else None,
                'snapshot_count':total,'count_semantics':'upstream_total_before_personal_filters','observed_at':time.time(),
                'consistency':'live_paged_query_not_snapshot'}
    def _provider_page(self,actor,credential,r,start,limit):
        """Reuse the catalogue owner's taxonomy and fetch just one bounded page."""
        from urllib.parse import urlencode
        from experience_transport import FixedJsonGet
        if not self.sports_get or not self.sports_origin:raise Fault(503,'provider_service_not_configured')
        d=dict(r.get('discovery',{}))
        if d.get('scope','library')!='library':raise Fault(422,'external_catalogue_requires_existing_discovery')
        q={'provider':r['provider'],'view':'discover',**d,'scope':'library','grid':'1','start':start,'limit':limit}
        url=self.sports_origin+'/sports/api/catalogue?'+urlencode(q)
        raw=self.sports_get(url,credential,deadline=BUDGET.get()) if isinstance(self.sports_get,FixedJsonGet) else self.sports_get(url,credential)
        if not isinstance(raw,dict) or raw.get('scope')!='library' or raw.get('view')!='discover' or type(raw.get('total')) is not int or not 0<=raw['total']<=50000:
            raise Fault(502,'provider_contract_changed')
        entries=raw.get('entries')
        if not isinstance(entries,list) or len(entries)>limit or (not entries and start<raw['total']):raise Fault(502,'provider_incomplete')
        ids=[]
        for entry in entries:
            row=entry.get('item') if isinstance(entry,dict) else None
            if not isinstance(row,dict):raise Fault(502,'provider_library_item_missing')
            ids.append(item_id(row.get('Id')))
        # Rehydrate with the caller credential; deleted/restricted rows still consume
        # their source offset, and must never enter the returned page.
        hydrated={item_id(i['Id']):i for i in self._items(actor,credential,ids)}
        return {'Items':[hydrated.get(i,{'Id':i,'Type':'Unavailable','LocationType':'Virtual'}) for i in ids],'TotalRecordCount':raw['total']}
    def connected(self,method,path,headers,body):
        from experience_http import PREFIX
        if path.split('?')[0]!=PREFIX+'/recommendations':return super().connected(method,path,headers,body)
        data,actor,credential,state=self.parse(method,path,headers,body)
        if not self.config.personal:raise Fault(403,'feature_not_enabled')
        keys(data,{'limit','refresh'});limit=integer(data.get('limit',18),1,40)
        if type(data.get('refresh',False)) is not bool:raise Fault(400,'invalid_boolean')
        key=(actor.key,actor.policy,state['revision'],limit,tuple(sorted(k for k,v in state.get('snoozed',{}).items() if v>time.time())))
        with self.rec_lock:
            hit=self.rec_cache.get(key)
        if hit and hit[0]>time.monotonic() and not data.get('refresh'):
            return 200,self._refresh_recommendations(actor,credential,state,hit[1])
        value=self._recommend(actor,credential,state,limit)
        with self.rec_lock:
            self.rec_cache[key]=(time.monotonic()+600,value);self.rec_cache.move_to_end(key)
            while len(self.rec_cache)>32:self.rec_cache.popitem(last=False)
        return 200,value
    def _refresh_recommendations(self,actor,credential,state,value):
        # Cache ranking only. Watch state, visibility and media presence can
        # change on another device without a personal-settings revision.
        ids=[r['item']['Id'] for r in value['items']]
        ids += [r['accessible_episode_id'] for r in value['items'] if r.get('accessible_episode_id')]
        fresh={r['Id']:r for r in self._items(actor,credential,ids)}
        rows=[]
        for rec in value['items']:
            row=fresh.get(rec['item']['Id'])
            if not row or hidden(row,state) or row.get('PlayAccess')!='Full' or row.get('LocationType')=='Virtual' or row.get('UserData',{}).get('Played') is not False:continue
            if row.get('Type')=='Movie' and not row.get('MediaSources'):continue
            if rec.get('accessible_episode_id'):
                ep=fresh.get(rec['accessible_episode_id'])
                if not ep or hidden(ep,state) or ep.get('PlayAccess')!='Full' or ep.get('LocationType')=='Virtual' or not ep.get('MediaSources'):continue
            rows.append({**rec,'item':self.visible([row],state)[0]})
        return {**value,'items':rows}
    def _parallel(self,calls):
        ctx=[contextvars.copy_context() for _ in calls]
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures=[pool.submit(c.run,f) for c,f in zip(ctx,calls)]
            out=[]
            for f in futures:
                try:out.append(f.result())
                except Fault:out.append({'Items':[]})
        return [v.get('Items',[]) if isinstance(v,dict) else [] for v in out]
    def _recommend(self,actor,credential,state,limit):
        base={'Recursive':'true','IncludeItemTypes':'Movie,Series','IsMissing':'false','EnableUserData':'true','EnableImages':'false',
              'EnableTotalRecordCount':'false','Fields':'Genres,ProviderIds,PlayAccess,SortName,RecursiveItemCount'}
        u='/Users/'+actor.user+'/Items'
        feedback=[k for k,v in state['feedback'].items()][:100]
        first=self._parallel([
            lambda:self._json(u,credential,{**base,'IsFavorite':'true','Limit':60}),
            lambda:self._json(u,credential,{**base,'Ids':','.join(feedback),'Limit':len(feedback)}) if feedback else {'Items':[]},
            lambda:self._json(u,credential,{**base,'Filters':'IsPlayed','SortBy':'DatePlayed','SortOrder':'Descending','Limit':40})])
        seeds=first[0]+first[1];recent=first[2]
        affinity=Counter()
        for row in seeds:
            if state['feedback'].get(item_id(row['Id']))!='less':affinity.update(row.get('Genres') or [])
        for row in recent:affinity.update(row.get('Genres') or [])
        top=[g for g,_ in affinity.most_common(3)]
        pool_q={**base,'Filters':'IsUnplayed','SortBy':'CommunityRating,SortName','SortOrder':'Descending,Ascending','Limit':80}
        def pool(extra):
            # Skip the thin-rating block (>= 9.0) the same way the web does: count it, start after it.
            thin=self._json(u,credential,{**pool_q,**extra,'MinCommunityRating':THIN_RATING,'Limit':0,'EnableTotalRecordCount':'true'})
            skip=thin.get('TotalRecordCount') if isinstance(thin,dict) and type(thin.get('TotalRecordCount')) is int else 0
            return self._json(u,credential,{**pool_q,**extra,'StartIndex':skip})
        # Give films and series their own candidate quota rather than letting one
        # media type monopolize the highest-rated pool.
        pools=self._parallel([lambda g=g:pool({'Genres':g}) for g in top]+[
            lambda:pool({'IncludeItemTypes':'Movie'}),lambda:pool({'IncludeItemTypes':'Series'})])
        seen=set();candidates=[]
        for row in [r for p in pools for r in p]:
            uid=item_id(row['Id'])
            if uid in seen:continue
            seen.add(uid)
            rating=row.get('CommunityRating')
            if isinstance(rating,(int,float)) and rating>=THIN_RATING:continue
            if row.get('PlayAccess')=='Full' and row.get('LocationType')!='Virtual':candidates.append(row)
        # Seeds give the reviewed ranker its genre preferences; they are played/favourite and never returned.
        pool=candidates+[s for s in seeds if item_id(s['Id']) not in seen]
        ranked=recommendations(pool,state,{item_id(r['Id']) for r in candidates},limit=min(60,limit+20),recent_genres=[g for r in recent for g in r.get('Genres',[])])
        by_id={item_id(r['Id']):r for r in self._items(actor,credential,[v['id'] for v in ranked])}
        selected=[by_id[c['id']] for c in ranked if c['id'] in by_id]
        series=[r for r in selected if r.get('Type')=='Series' and not hidden(r,state) and (r.get('UserData') or {}).get('Played') is False][:12]
        def episode_check(row):
            # Actual caller-scoped episode facts, not folder existence or a stale
            # series count. These are metadata checks, never playback requests.
            q={'UserId':actor.user,'Limit':12,'IsMissing':'false','Fields':'PlayAccess,MediaSources,ParentId','EnableUserData':'true','EnableImages':'false'}
            raw=self._json('/Shows/'+item_id(row['Id'])+'/Episodes',credential,q)
            episodes=raw.get('Items',[]) if isinstance(raw,dict) else []
            eligible=[e for e in episodes if e.get('PlayAccess')=='Full' and not e.get('IsMissing') and e.get('LocationType')!='Virtual' and e.get('MediaSources') and not hidden(e,state)]
            return {'Items':[{'Id':row['Id'],'episode_id':eligible[0]['Id']}] if eligible else []}
        checked=self._parallel([lambda row=row:episode_check(row) for row in series])
        ready_series={r['Id']:r['episode_id'] for batch in checked for r in batch}
        result=[]
        for cand in ranked:
            row=by_id.get(cand['id'])
            if row is None or hidden(row,state) or (row.get('UserData') or {}).get('Played') is not False or row.get('PlayAccess')!='Full' or row.get('LocationType')=='Virtual':continue
            if row.get('Type')=='Movie' and not row.get('MediaSources'):continue
            if row.get('Type')=='Series' and row['Id'] not in ready_series:continue
            reasons=[x.replace('verified library','available library') for x in cand['reasons']]
            if top and reasons and reasons[0].startswith('Explore') and set(row.get('Genres') or [])&set(top):
                reasons=['Because you watch '+', '.join(g for g in top if g in (row.get('Genres') or []))]
            result.append({'item':self.visible([row],state)[0],'reasons':reasons,'playability':'attempt_allowed_not_render_verified',
                **({'accessible_episode_id':ready_series[row['Id']]} if row.get('Type')=='Series' else {})})
        return {'items':result[:limit],'method':'bounded_pool_genre_feedback_and_diversity','preferred_genres':top,
                'series_recommendations':'caller_scoped_episode_sources_checked'}
