"""Public team data for account-scoped client selections; no favorite mutations."""
import threading, time, re
from concurrent.futures import ThreadPoolExecutor

LEAGUES={'MLB':'baseball/mlb','NFL':'football/nfl','College football':'football/college-football','NBA':'basketball/nba','WNBA':'basketball/wnba','NHL':'hockey/nhl'}
_cache={}
_lock=threading.Lock()

def cached(key, ttl, load):
    # A single bounded refresh prevents duplicate requests on concurrent client loads.
    with _lock:
        old=_cache.get(key)
        if old and time.time()-old['fetched_at']<ttl:return old
        try: result={**load(),'fetched_at':time.time(),'stale':False}
        except Exception:
            if old:return {**old,'stale':True}
            raise
        if len(_cache)>=128:_cache.pop(next(iter(_cache)))
        _cache[key]=result
        return result

def directory(league,get):
    if league not in LEAGUES:raise ValueError('Unsupported league')
    def load():
        data=get('https://site.api.espn.com/apis/site/v2/sports/'+LEAGUES[league]+'/teams?limit=1000')
        teams=[]
        for sport in data.get('sports',[]):
            for group in sport.get('leagues',[]):
                for entry in group.get('teams',[]):
                    t=entry['team'];tid=str(t['id'])
                    if not re.fullmatch(r'[0-9]{1,9}',tid):continue
                    teams.append({'key':league+'~'+tid,'id':tid,'league':league,'name':t['displayName'],
                                  'logos':[x['href'] for x in t.get('logos',[]) if x.get('href','').startswith('https://a.espncdn.com/')][:1]})
        if not teams:raise ValueError('Empty provider directory')
        return {'teams':sorted(teams,key=lambda t:t['name']),'source':'ESPN'}
    return cached('directory:'+league,21600,load)

def context(key,get):
    league,tid=key.split('~',1)
    if league not in LEAGUES or not re.fullmatch(r'[0-9]{1,9}',tid):raise ValueError('Invalid team')
    if not any(t['id']==tid for t in directory(league,get)['teams']):raise ValueError('Unknown team')
    def load():
        from refresh_team_context import compact_events, compact_statistics
        base='https://site.api.espn.com/apis/site/v2/sports/'+LEAGUES[league]
        t=get(base+'/teams/'+tid)['team']
        def optional(path):
            try:return get(base+path)
            except Exception:return {}
        with ThreadPoolExecutor(max_workers=3) as pool:
            schedule,news,stats=list(pool.map(optional,['/teams/'+tid+'/schedule','/news?team='+tid+'&limit=4','/teams/'+tid+'/statistics']))
        statistics=compact_statistics(stats)
        return {'id':tid,'league':league,'name':t['displayName'],
                'logos':[x['href'] for x in t.get('logos',[]) if x.get('href','').startswith('https://a.espncdn.com/')][:1],
                'record':[{'name':r.get('description') or r.get('name'),'summary':r.get('summary')} for r in t.get('record',{}).get('items',[])],
                'standing':t.get('standingSummary'),'events':compact_events(schedule.get('events',[])),
                'statistics':statistics,'statistics_fetched_at':time.time() if statistics else None,
                'statistics_unavailable':not statistics,'statistics_stale':False,
                'news':[{'headline':a.get('headline'),'published':a.get('published')} for a in news.get('articles',[])[:4]],'source':'ESPN'}
    return cached('team:'+key,900,load)
