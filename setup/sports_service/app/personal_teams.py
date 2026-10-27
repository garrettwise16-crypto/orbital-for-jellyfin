"""Public team data for account-scoped client selections; no favorite mutations."""
import threading, time, re
from concurrent.futures import ThreadPoolExecutor

LEAGUES={'MLB':'baseball/mlb','NFL':'football/nfl','College football':'football/college-football','NBA':'basketball/nba','WNBA':'basketball/wnba','NHL':'hockey/nhl'}
_cache={}
_lock=threading.Lock()
_ready=threading.Condition(_lock)
_refreshing={}
_MAX_REFRESHES=2

def cached(key, ttl, load):
    # Metadata only under the shared lock; at most two distinct public-data refreshes.
    with _ready:
        while True:
            old=_cache.get(key)
            if old and time.time()-old['fetched_at']<ttl:return old
            pending=_refreshing.get(key)
            if pending is not None:
                while not pending['done']:_ready.wait()
                if pending['error'] is not None:raise pending['error']
                return pending['result']
            if len(_refreshing)<_MAX_REFRESHES:
                pending={'done':False,'result':None,'error':None}
                _refreshing[key]=pending
                break
            _ready.wait()
    result=None;error=None
    try: result={**load(),'fetched_at':time.time(),'stale':False}
    except Exception as exc:
        if old:result={**old,'stale':True}
        else:error=exc
    except BaseException as exc:error=exc
    with _ready:
        try:
            if error is None and not result['stale']:
                if len(_cache)>=128:_cache.pop(next(iter(_cache)))
                _cache[key]=result
        except BaseException as exc:error=exc
        finally:
            pending.update(done=True,result=result,error=error)
            del _refreshing[key]
            _ready.notify_all()
    if error is not None:raise error
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

def _num(v):
    if isinstance(v,dict):v=v.get('displayValue',v.get('value'))
    if v is None or str(v).strip()=='':return None
    try:f=float(v);return int(f) if f.is_integer() else f
    except (TypeError,ValueError):return None

def _logo(team):
    logos=team.get('logos') or []
    ok=lambda x:str(x.get('href','')).startswith('https://a.espncdn.com/')
    return next((x.get('href') for x in logos if 'default' in x.get('rel',[]) and ok(x)),next((x.get('href') for x in logos if ok(x)),None))

import datetime,re
def _explicit_schedule_day(event):
    try:
        competition=event['competitions'][0]
        status=(competition.get('status') or event.get('status') or {})['type']
        if competition.get('timeValid') is not False or status.get('state')!='pre':return None
        match=re.fullmatch(r'(\d{1,2})/(\d{1,2})\s*-\s*TBD',status.get('detail',''))
        if not match:return None
        stamp=datetime.datetime.fromisoformat(event['date'].replace('Z','+00:00'))
        if stamp.tzinfo is None:return None
        month,day=map(int,match.groups());candidates=[]
        for year in (stamp.year-1,stamp.year,stamp.year+1):
            try:value=datetime.date(year,month,day)
            except ValueError:continue
            if abs((value-stamp.date()).days)<=1:candidates.append(value)
        return candidates[0].isoformat() if len(candidates)==1 else None
    except (KeyError,TypeError,ValueError,IndexError,AttributeError):return None


def full_schedule(events,tid,now=None):
    """Sept 28: the whole season (bounded for long seasons), each game from this team's point of view."""
    from datetime import datetime, timezone
    now=now or datetime.now(timezone.utc).isoformat()
    ordered=sorted(events,key=lambda e:e.get('date',''))
    if len(ordered)>40:
        ordered=[e for e in ordered if e.get('date','')<now][-15:]+[e for e in ordered if e.get('date','')>=now][:15]
    out=[]
    for e in ordered:
        c=(e.get('competitions') or [{}])[0];st=(c.get('status') or e.get('status') or {}).get('type',{})
        comps=c.get('competitors',[])
        me=next((x for x in comps if str(x.get('id') or x.get('team',{}).get('id'))==tid),None)
        opp=next((x for x in comps if x is not me),None)
        if not me or not opp:continue
        name=st.get('name','')
        if name in ('STATUS_CANCELED','STATUS_CANCELLED'):state='canceled'
        elif name=='STATUS_POSTPONED':state='postponed'
        elif st.get('state')=='in':state='live'
        elif st.get('completed'):state='final'
        else:state='scheduled'
        us,them=_num(me.get('score')),_num(opp.get('score'))
        result=None
        if state=='final' and us is not None and them is not None:
            if me.get('winner') is True or (me.get('winner') is None and us>them):result='W'
            elif opp.get('winner') is True or us<them:result='L'
            else:result='T'
        rank=(opp.get('curatedRank') or {}).get('current');ot=opp.get('team',{})
        out.append({'id':e.get('id'),'date':e.get('date'),'week':(e.get('week') or {}).get('text'),
                    'season_type':(e.get('seasonType') or {}).get('abbreviation'),
                    'time_tbd':c.get('timeValid') is False or st.get('shortDetail')=='TBD',
                    'schedule_date':_explicit_schedule_day(e),
                    'state':state,'detail':st.get('shortDetail') or st.get('description'),
                    'home':me.get('homeAway')=='home','neutral':bool(c.get('neutralSite')),
                    'opponent':{'id':str(ot.get('id') or opp.get('id') or ''),'name':ot.get('displayName'),
                                'short':ot.get('shortDisplayName') or ot.get('location'),'abbr':ot.get('abbreviation'),
                                'logo':_logo(ot),'rank':rank if isinstance(rank,int) and 0<rank<=25 else None},
                    'score':us,'opponent_score':them,'result':result,
                    'broadcast':next((b.get('media',{}).get('shortName') for b in c.get('broadcasts',[]) if b.get('media',{}).get('shortName')),None),
                    'venue':(c.get('venue') or {}).get('fullName')})
    return out

BETTING=re.compile(r'\b(bet|bets|betting|odds|line|lines|spread|parlay|props?|picks?|fantasy|dfs|sportsbook|wager)\b',re.I)

def team_news(raw,tid,limit=6):
    """Stories about this team first, then league stories that mention it (ESPN's team feed mixes both)."""
    rows=[]
    for i,a in enumerate(raw.get('articles',[])):
        teams={str(x.get('teamId')) for x in a.get('categories',[]) if x.get('type')=='team' and x.get('teamId') is not None}
        url=(a.get('links') or {}).get('web',{}).get('href')
        if not (isinstance(url,str) and url.startswith('https://www.espn.com/')):url=None
        image=next((m.get('url') for m in a.get('images',[]) if str(m.get('url','')).startswith('https://a.espncdn.com/')),None)
        focus=tid in teams and len(teams)<=2
        if BETTING.search((a.get('headline') or '')+' '+(a.get('description') or '')):continue   # Sept 28: same rule as preview.py
        rows.append((0 if focus else 1,i,{'headline':a.get('headline'),'published':a.get('published'),
                                          'description':(a.get('description') or '')[:220] or None,'url':url,'image':image,
                                          'team_story':focus,'video':a.get('type')=='Media'}))
    return [r for _,_,r in sorted(rows,key=lambda r:(r[0],r[1]))[:limit]]

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
            schedule,news,stats=list(pool.map(optional,['/teams/'+tid+'/schedule','/news?team='+tid+'&limit=12','/teams/'+tid+'/statistics']))
        events=schedule.get('events',[])
        from datetime import datetime, timezone
        if not any(e.get('date','')>=datetime.now(timezone.utc).isoformat() for e in events):
            post=optional('/teams/'+tid+'/schedule?seasontype=3').get('events',[])   # playoffs live in a separate ESPN schedule
            seen={e.get('id') for e in events};events=events+[e for e in post if e.get('id') not in seen]
        statistics=compact_statistics(stats)
        hexcolor=lambda c:c if isinstance(c,str) and re.fullmatch(r'[0-9a-fA-F]{6}',c) else None
        rank=t.get('rank')
        return {'id':tid,'league':league,'name':t['displayName'],
                'short':t.get('shortDisplayName') or t.get('location'),'abbr':t.get('abbreviation'),'location':t.get('location'),'nickname':t.get('name'),
                'color':hexcolor(t.get('color')),'alt_color':hexcolor(t.get('alternateColor')),
                'rank':rank if isinstance(rank,int) and 0<rank<=25 else None,
                'logos':[x['href'] for x in t.get('logos',[]) if x.get('href','').startswith('https://a.espncdn.com/')][:1],
                'record':[{'name':r.get('description') or r.get('name'),'type':r.get('type'),'summary':r.get('summary')} for r in t.get('record',{}).get('items',[])],
                'standing':t.get('standingSummary'),'events':compact_events(schedule.get('events',[])),
                'schedule':full_schedule(events,tid),
                'statistics':statistics,'statistics_fetched_at':time.time() if statistics else None,
                'statistics_unavailable':not statistics,'statistics_stale':False,
                'news':team_news(news,tid),'source':'ESPN'}
    return cached('team:'+key,900,load)
