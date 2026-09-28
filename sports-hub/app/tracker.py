"""Bounded public ESPN metadata normalization. No media, paid source or viewer state."""
import copy
import json
import math
import re
import threading
import time
import urllib.request
from datetime import datetime
import os
from zoneinfo import ZoneInfo

# Calendar day used to match an event to the date a client asked for.
ZONE = ZoneInfo(os.environ.get('SPORTS_TIMEZONE', 'America/New_York'))

LEAGUES = {'MLB': ('baseball/mlb','baseball'), 'NBA': ('basketball/nba','basketball'),
    'WNBA': ('basketball/wnba','basketball'), 'NHL': ('hockey/nhl','hockey'),
    'NFL': ('football/nfl','football'), 'College football': ('football/college-football','football')}
# Enable a transform only after an inspectable ESPN Gamecast calibration receipt.
CALIBRATION = {
    # 'display' is what viewers read; 'note' keeps the calibration method for the audit trail.
    'baseball': {'verified':True,'display':'Approximate strike zone · not adjusted for batter height','note':'ESPN pitch view: x increases right, y increases down. Approximate strike zone, not adjusted for batter height.',
        'source':'https://www.espn.com/mlb/playbyplay/_/gameId/401817038','receipt':'root rendered DOM six pitches atBatId 4018170382206; September 23, 2026'},
    'basketball': {'verified':True,'display':'Shot locations from ESPN · half-court view','note':'Schematic half-court: x across court, y away from hoop. Official ESPN Gamecast shot orientation checked; physical hoop baseline offset 5.25 feet.', 'source':'https://www.espn.com/wnba/game/_/gameId/401857211'},
    'hockey': {'verified':False,'raw_axes_verified':True,'display':'Shot locations from ESPN · attacking ends estimated from the shots','note':'ESPN raw axes verified. Attacking ends normalized using bounded inference from reported shots; ambiguous periods omitted.', 'source':'https://www.espn.com/nhl/game/_/gameId/401879366'},
    'football': {'verified':True,'display':'Each line is one play, oldest at top · the offense drives toward the right end zone','note':'Possession team attacks right, using explicit yardsToEndzone and matching possession IDs. Official ESPN drive text calibrated; unknown turnover ends omitted.', 'source':'https://www.espn.com/nfl/playbyplay/_/gameId/401872933'},
}
MAX_BYTES=2*1024*1024
MAX_PLAYS=2000
MAX_POINTS=300
MAX_TEXT_PLAYS=80
MAX_RESPONSE_BYTES=192*1024

def number(value,low=None,high=None):
    if isinstance(value,bool):return None
    try: value=float(value)
    except (TypeError,ValueError,OverflowError):return None
    if not math.isfinite(value) or low is not None and value<low or high is not None and value>high:return None
    return int(value) if value.is_integer() else value

def text(value,limit=400):
    if value is None:return None
    value=re.sub(r'[\x00-\x1f\x7f]',' ',str(value)).strip()
    # The payload allowlist contains labels only, never raw ESPN/provider locations.
    return value[:limit] if value and not re.search(r'https?://',value,re.I) else None

def identity(value):
    value=str(value or '')
    return value if re.fullmatch(r'[A-Za-z0-9_-]{1,64}',value) else None

def plays(raw):
    source=raw.get('plays') or []
    if not isinstance(source,list) or len(source)>MAX_PLAYS:raise ValueError('Tracker play limit exceeded')
    seen=set();result=[]
    for p in source:
        if not isinstance(p,dict):continue
        ident=identity(p.get('id'))
        if not ident or ident in seen:continue
        seen.add(ident);result.append(p)
    return result

def base_play(p):
    return {'id':identity(p.get('id')), 'text':text(p.get('text')), 'type':text((p.get('type') or {}).get('text'),80),
        'team_id':identity((p.get('team') or {}).get('id')), 'period':number((p.get('period') or {}).get('number'),1,30),
        'clock':text((p.get('clock') or {}).get('displayValue'),30)}

def xy(p,key,xbounds,ybounds):
    c=p.get(key)
    if not isinstance(c,dict):return None
    x=number(c.get('x'),*xbounds);y=number(c.get('y'),*ybounds)
    return None if x is None or y is None else (x,y)

def baseball(raw,calibration,event_id,at_bat_id=None):
    rows=plays(raw)
    actual=[p for p in rows if p.get('summaryType')=='P' and number(p.get('atBatPitchNumber'),1,100) is not None]
    current_records=[p for p in rows if identity(p.get('atBatId')) and (p.get('summaryType')=='P' or (p.get('type') or {}).get('type') in ('start-batterpitcher','end-batterpitcher','play-result'))]
    selected=at_bat_id or (str(current_records[-1].get('atBatId')) if current_records else None)
    # A new batter's start record arrives before his first pitch. Keep the latest at-bat that has pitches (with its
    # own coordinates and result) until then, so the deciding pitch stays visible; flagged, never relabelled current.
    previous=False
    if not at_bat_id and selected and actual and not any(str(p.get('atBatId'))==selected for p in actual):
        selected=str(actual[-1].get('atBatId'));previous=True
    current=[p for p in actual if str(p.get('atBatId'))==selected]
    points=[];descriptions=[];seen=set()
    coords=[c for p in current if (c:=xy(p,'pitchCoordinate',(0,300),(0,300))) is not None]
    left=min([40]+[c[0]-12 for c in coords]);right=max([210]+[c[0]+12 for c in coords])
    top=min([105]+[c[1]-12 for c in coords]);bottom=max([245]+[c[1]+12 for c in coords])
    width=right-left;height=bottom-top
    for p in current:
        n=number(p.get('atBatPitchNumber'),1,100)
        if n in seen:continue
        seen.add(n);row=base_play(p);counts=p.get('resultCount') or {}
        row.update(number=n,pitch_type=text((p.get('pitchType') or {}).get('text'),80),mph=number(p.get('pitchVelocity'),1,120),
            balls=number(counts.get('balls'),0,4),strikes=number(counts.get('strikes'),0,3),result=text((p.get('type') or {}).get('type'),60))
        descriptions.append(row);coordinate=xy(p,'pitchCoordinate',(0,300),(0,300))
        if coordinate and calibration['verified']:points.append({**row,'x':(coordinate[0]-left)/width,'y':(coordinate[1]-top)/height})
    last=descriptions[-1] if descriptions else {}
    result_rows=[p for p in rows if str(p.get('atBatId'))==selected and (p.get('type') or {}).get('type')=='play-result']
    summary={'at_bat_id':identity(selected),'pitch_count':len(descriptions),'balls':last.get('balls'),'strikes':last.get('strikes'),
        'outcome':text(result_rows[-1].get('text')) if result_rows else None,'completed':bool(result_rows),
        'scope':'previous_at_bat' if previous else 'current_or_latest_at_bat'}
    field={'width':1,'height':1,'physical_width':width,'physical_height':height,'units':'ESPN pitch units',
        'viewport':{'x_min':left,'x_max':right,'y_min':top,'y_max':bottom},
        'zone':{'x':(88-left)/width,'y':(149-top)/height,'width':56/width,'height':44/height,'approximate':True}}
    return field,points,descriptions,summary,bool(calibration['verified'])

def basketball(raw,calibration,event_id):
    points=[];descriptions=[];counts={}
    for p in plays(raw):
        attempted=number(p.get('pointsAttempted'),2,3)
        if p.get('shootingPlay') is not True or attempted not in (2,3):continue
        row=base_play(p);made=p.get('scoringPlay') is True
        row.update(made=made,value=number(p.get('scoreValue'),0,3),points_attempted=attempted)
        descriptions.append(row)
        if row['team_id']:
            count=counts.setdefault(row['team_id'],{'team_id':row['team_id'],'fg_made':0,'fg_attempts':0,'three_made':0,'three_attempts':0})
            count['fg_attempts']+=1;count['fg_made']+=int(made)
            if attempted==3:count['three_attempts']+=1;count['three_made']+=int(made)
        coordinate=xy(p,'coordinate',(0,50),(-5.25,41.75))
        if coordinate and calibration['verified']:points.append({**row,'x':coordinate[0]/50,'y':(coordinate[1]+5.25)/47})
    field={'width':1,'height':1,'physical_width':50,'physical_height':47,'units':'feet','hoop':{'x':.5,'y':5.25/47}}
    return field,points,descriptions,{'teams':list(counts.values()),'scope':'reported_field_goal_plays'},bool(calibration['verified'])

def hockey_directions(raw, rows, calibration):
    """Conservative per-period end inference. Never assign a team to unlabelled shots."""
    competitors=((raw.get('header') or {}).get('competitions') or [{}])[0].get('competitors') or []
    sides={c.get('homeAway'):identity((c.get('team') or {}).get('id') or c.get('id')) for c in competitors}
    evidence={};directions={};diagnostics=[]
    for p in rows:
        if (p.get('type') or {}).get('text') not in ('Shot','Goal'):continue
        period=number((p.get('period') or {}).get('number'),1,3)
        tid=identity((p.get('team') or {}).get('id'));coord=xy(p,'coordinate',(-100,100),(-42.5,42.5))
        if period is None or tid not in sides.values() or not coord or abs(coord[0])<=20:continue
        bucket=evidence.setdefault(period,{}).setdefault(tid,[0,0]);bucket[int(coord[0]>0)]+=1
    # Optional explicit source mapping is internal validated metadata, never a client parameter.
    explicit=calibration.get('explicit_period_home_positive') or {}
    for period in (1,2,3):
        buckets=evidence.get(period,{});home=buckets.get(sides.get('home'),[0,0]);away=buckets.get(sides.get('away'),[0,0])
        detail={'period':period,'home_negative':home[0],'home_positive':home[1], 'away_negative':away[0],'away_positive':away[1]}
        supplied=explicit.get(period)
        if isinstance(supplied,bool):
            directions[period]=supplied;detail.update(status='explicit',reason=None);diagnostics.append(detail);continue
        candidates=[]
        for side,counts in [('home',home),('away',away)]:
            total=sum(counts)
            if total>=5 and max(counts)/total>=.8:
                positive=counts[1]>counts[0];candidates.append(positive if side=='home' else not positive)
        if not candidates:detail.update(status='omitted',reason='Insufficient or ambiguous shots: need at least five, 80% beyond center toward one end.')
        else:
            direction=candidates[0]
            consistent=all(c==direction for c in candidates)
            for counts,expected in [(home,direction),(away,not direction)]:
                if sum(counts) and counts[int(expected)]/sum(counts)<.8:consistent=False
            if consistent:directions[period]=direction;detail.update(status='inferred',reason=None)
            else:detail.update(status='omitted',reason='Opposing team shot locations conflict with inferred end.')
        diagnostics.append(detail)
    # Regulation teams switch ends. Contradictory independently inferred periods fail closed.
    initial={value if period%2 else not value for period,value in directions.items()}
    if len(initial)>1:
        directions.clear()
        for detail in diagnostics:detail.update(status='omitted',reason='Reported period ends conflict with regulation end switching.')
    return directions,diagnostics


def hockey(raw,calibration,event_id):
    points=[];descriptions=[];counts={};rows=plays(raw)
    directions,diagnostics=hockey_directions(raw,rows,calibration)
    raw_axes=calibration.get('raw_axes_verified') is True
    geometry=raw_axes and bool(directions)
    calibration['periods']=diagnostics
    calibration['direction_derived']=any(d.get('status')=='inferred' for d in diagnostics)
    calibration['geometry_available']=geometry
    calibration['orientation_method']='inferred_from_shot_locations' if calibration['direction_derived'] else 'explicit_source_ends' if directions else 'unavailable'
    for p in rows:
        kind=(p.get('type') or {}).get('text')
        if kind not in ('Shot','Goal'):continue
        row=base_play(p);row['made']=kind=='Goal';descriptions.append(row)
        if row['team_id']:
            count=counts.setdefault(row['team_id'],{'team_id':row['team_id'],'shots_on_goal':0,'goals':0})
            count['shots_on_goal']+=1;count['goals']+=int(kind=='Goal')
        coordinate=xy(p,'coordinate',(-100,100),(-42.5,42.5));period=row['period']
        if coordinate and geometry and period in directions:
            x,y=coordinate
            if not directions[period]:x,y=-x,-y
            points.append({**row,'x':(x+100)/200,'y':(42.5-y)/85})
    field={'width':1,'height':1,'physical_width':200,'physical_height':85,'units':'feet',
        'goals':[{'x':.055,'y':.5},{'x':.945,'y':.5}], 'orientation':'home attacks right; away attacks left; regulation only'}
    return field,points,descriptions,{'teams':list(counts.values()),'scope':'reported_shots_on_goal'},False

def football(raw,calibration,event_id,drive_id=None):
    drives=raw.get('drives') or {};previous=drives.get('previous') or []
    if not isinstance(previous,list) or len(previous)>100:raise ValueError('Tracker drive limit exceeded')
    all_drives=previous+([drives['current']] if isinstance(drives.get('current'),dict) else [])
    drive=next((d for d in all_drives if str(d.get('id'))==str(drive_id)),{}) if drive_id else (all_drives[-1] if all_drives else {})
    rows=drive.get('plays') or []
    if not isinstance(rows,list) or len(rows)>MAX_PLAYS:raise ValueError('Tracker play limit exceeded')
    team=identity((drive.get('team') or {}).get('id'));descriptions=[];points=[];seen=set()
    for p in rows:
        row=base_play(p)
        if not row['id'] or row['id'] in seen:continue
        seen.add(row['id']);start=p.get('start') or {};end=p.get('end') or {}
        row.update(team_id=team,down_distance=text(start.get('downDistanceText'),100),yards=number(p.get('statYardage'),-100,100),
            down=number(start.get('down'),1,4),distance=number(start.get('distance'),0,100))
        # yardsToEndzone is explicitly possession-relative. Never infer direction from the event.
        a=number(start.get('yardsToEndzone'),0,100);b=number(end.get('yardsToEndzone'),0,100)
        same_team=team and identity((start.get('team') or {}).get('id'))==team and identity((end.get('team') or {}).get('id'))==team
        scrimmage=not re.search(r'timeout|end period|end of (half|game|quarter)|kickoff|coin toss|two-minute',row.get('type') or '',re.I)
        if calibration['verified'] and same_team and scrimmage and a is not None and b is not None:
            # yards = the ball's actual movement (a penalty-wiped 22-yd pass reported statYardage +10
            # while the ball went back 10); statYardage stays the fallback when spots are missing.
            row.update(start_x=(100-a)/100,end_x=(100-b)/100,yards=a-b)
        descriptions.append(row)
    summary={'drive_id':identity(drive.get('id')),'team_id':team,'result':text(drive.get('displayResult') or drive.get('result'),80),
        'description':text(drive.get('description'),160),'scope':'current_or_latest_drive'}
    field={'width':1,'height':1,'physical_width':100,'physical_height':53.333333,'units':'yards','orientation':'possession team attacks right'}
    # the current ball spot (end of the latest same-possession play) for a line-of-scrimmage marker.
    current=drives.get('current') if isinstance(drives.get('current'),dict) else {}
    ends=[r['end_x'] for r in descriptions if 'end_x' in r]
    if ends and current and str(current.get('id'))==str(drive.get('id')) and not drive_id:field['ball_x']=ends[-1]
    return field,points,descriptions,summary,bool(calibration['verified'])

def recent_results(raw,limit=6):
    """Completed MLB plate appearances (provider play-result records only), newest last, with the reported score."""
    rows=[p for p in plays(raw) if (p.get('type') or {}).get('type')=='play-result']
    out=[]
    for p in rows[-limit:]:
        per=p.get('period') or {}
        out.append({'id':identity(p.get('id')),'text':text(p.get('text'),200),'inning':text(per.get('displayValue'),20),
            'team_id':identity((p.get('team') or {}).get('id')),'away':number(p.get('awayScore'),0,99),'home':number(p.get('homeScore'),0,99)})
    return out

def drive_flow(raw,calibration,limit=40):
    """Every drive's reported result and span. Span only from possession-relative yardsToEndzone of its own plays."""
    drives=raw.get('drives') or {};previous=drives.get('previous') or []
    if not isinstance(previous,list):return []
    all_drives=(previous+([drives['current']] if isinstance(drives.get('current'),dict) else []))[-limit:]
    out={}
    for d in all_drives:
        team=identity((d.get('team') or {}).get('id'));rows=[p for p in (d.get('plays') or []) if isinstance(p,dict)]
        row={'id':identity(d.get('id')),'team_id':team,'result':text(d.get('displayResult') or d.get('result'),60),
            'yards':number(d.get('yards'),-100,200),'plays':number(d.get('offensivePlays'),0,60),'description':text(d.get('description'),120)}
        if calibration.get('verified') and rows and team:
            # yardsToEndzone is relative to whoever has the ball at that moment; only use values
            # measured for the drive team (a punt/turnover's end belongs to the other team).
            mine=lambda side,p:identity(((p.get(side) or {}).get('team') or {}).get('id'))==team
            a=next((number((p.get('start') or {}).get('yardsToEndzone'),0,100) for p in rows if mine('start',p)),None)
            b=None
            for p in rows:
                if mine('end',p):b=number((p.get('end') or {}).get('yardsToEndzone'),0,100)
                elif mine('start',p):b=number((p.get('start') or {}).get('yardsToEndzone'),0,100)
            if a is not None and b is not None:row.update(start_x=(100-a)/100,end_x=(100-b)/100)
        # Reuse the existing possession-safe normalizer, with bounded sanitized details.
        selected={'drives':{'previous':[d]}}
        row['play_details']=football(selected,calibration,'drive-detail',row['id'])[2][-40:]
        out[row['id'] or '#'+str(len(out))]=row          # the in-progress drive appears in 'previous' and 'current'
    return list(out.values())

NORMALIZERS={'baseball':baseball,'basketball':basketball,'hockey':hockey,'football':football}

def normalize(raw,league,event_id,fetched_at=None,calibrations=None):
    if league not in LEAGUES:raise ValueError('Unsupported tracker league')
    header=raw.get('header') or {}
    if str(header.get('id'))!=str(event_id):raise ValueError('Tracker identity mismatch')
    competitions=header.get('competitions') or []
    comp=next((c for c in competitions if str(c.get('id'))==str(event_id)),None)
    if not comp:raise ValueError('Tracker competition missing')
    status=comp.get('status') or {};typ=status.get('type') or {}
    state='live' if typ.get('state')=='in' else 'final' if typ.get('completed') is True else 'scheduled'
    if typ.get('name') in ('STATUS_POSTPONED','STATUS_CANCELED','STATUS_CANCELLED'):state='unavailable'
    kind=LEAGUES[league][1];cal=copy.deepcopy((calibrations or CALIBRATION)[kind])
    field,points,descriptions,summary,verified=NORMALIZERS[kind](raw,cal,str(event_id))
    if state not in ('live','final'):points=[];descriptions=[];summary={}
    # Drop unknown/missing team IDs rather than assigning plays to an inferred team.
    teams=[]
    for c in comp.get('competitors') or []:
        t=c.get('team') or {};ident=identity(t.get('id') or c.get('id'))
        if ident:teams.append({'id':ident,'name':text(t.get('displayName'),100),'abbreviation':text(t.get('abbreviation'),12),
            'side':c.get('homeAway') if c.get('homeAway') in ('home','away') else None,'score':text(c.get('score'),20) if state in ('live','final') else None,
            'color':'#'+str(t.get('color')).lower() if re.fullmatch(r'[0-9a-fA-F]{6}',str(t.get('color') or '')) else None,
            'alt_color':'#'+str(t.get('alternateColor')).lower() if re.fullmatch(r'[0-9a-fA-F]{6}',str(t.get('alternateColor') or '')) else None})
    known={t['id'] for t in teams}
    points=[p for p in points if p.get('team_id') in known]
    if kind=='football':
        for p in descriptions:
            if p.get('team_id') not in known:p.pop('start_x',None);p.pop('end_x',None)
    geometry=bool(cal.get('geometry_available',verified))
    available=geometry and (bool(points) or kind=='football' and any('start_x' in p for p in descriptions))
    # right after a kickoff/turnover the new drive has no snap yet; that is not missing ESPN data
    # when earlier drives carried field positions.
    earlier=kind=='football' and any(number(((p.get('start') or {}).get('yardsToEndzone')),0,100) is not None
        for d in ((raw.get('drives') or {}).get('previous') or []) if isinstance(d,dict) for p in (d.get('plays') or []) if isinstance(p,dict))
    reason=(None if available else 'Play locations are not available for this game.' if not geometry else
            'Pitch and play locations appear once the game is under way.' if state=='scheduled' else
            'New drive — the chart starts with the first snap.' if state=='live' and earlier else
            'ESPN is not sending play locations for this game right now.')
    truncated=len(points)>MAX_POINTS or len(descriptions)>MAX_TEXT_PLAYS
    result={'schema_version':1,'event_id':str(event_id),'league':league,'kind':kind,'state':state,'status':text(typ.get('shortDetail') or typ.get('detail') or typ.get('description'),120),
        'start':text(comp.get('date'),40),'period':number(status.get('period'),0,30),'clock':text(status.get('displayClock'),30),'teams':teams,
        'fetched_at':fetched_at or time.time(),'source_updated_at':text((raw.get('meta') or {}).get('lastUpdatedAt'),40),'stale':False,
        'tracking_available':bool(available),'orientation_verified':bool(verified),'geometry_available':geometry,'raw_axes_verified':bool(cal.get('raw_axes_verified',verified)),
        'direction_derived':bool(cal.get('direction_derived',False)),'orientation_method':cal.get('orientation_method','official_gamecast' if verified else 'unavailable'),'unavailable_reason':reason,
        'calibration':{'status':'verified' if verified else 'derived' if geometry else 'unverified','periods':cal.get('periods',[]),'note':cal.get('display') or CALIBRATION.get(kind,{}).get('display') or cal.get('note'),'method':cal.get('note'),'source':cal.get('source'),'coordinate_system':'normalized-top-left'},
        'field':field,'points':points[-MAX_POINTS:],'plays':descriptions[-MAX_TEXT_PLAYS:],'summary':summary,'truncated':truncated,'poll_interval_seconds':10}
    # the current down & distance from the latest play's reported end state (ESPN's scoreboard
    # situation often omits fields between plays; the play-by-play keeps them).
    if kind=='football' and state=='live':
        current=((raw.get('drives') or {}).get('current') or {})
        for p in reversed([p for p in (current.get('plays') or []) if isinstance(p,dict)]):
            end=p.get('end') or {};down=number(end.get('down'),1,4);distance=number(end.get('distance'),0,100)
            spot=text(end.get('possessionText'),30)
            if down and distance is not None and spot:
                result['situation']={'down':down,'distance':distance,'spot':spot,'text':text(end.get('downDistanceText'),60),
                                     'team_id':identity(((end.get('team') or {}).get('id')))}
                break
    # live baseball situation (count, outs, runners) for the Sports board's compact card graphic.
    if kind=='baseball' and state=='live':
        sit=raw.get('situation') if isinstance(raw.get('situation'),dict) else {}
        if sit:
            def who(x):
                a=(x or {}).get('athlete') if isinstance(x,dict) else None
                return text((a or {}).get('shortName') or (a or {}).get('displayName'),40) if isinstance(a,dict) else None
            def count(key,high):
                v=number(sit.get(key),0,high)
                return int(v) if v is not None else None
            result['situation']={'balls':count('balls',4),'strikes':count('strikes',3),'outs':count('outs',3),
                                 'on_first':bool(sit.get('onFirst')),'on_second':bool(sit.get('onSecond')),'on_third':bool(sit.get('onThird')),
                                 'batter':who(sit.get('batter')),'pitcher':who(sit.get('pitcher'))}
    if state in ('live','final'):
        if kind=='baseball':result['recent']=recent_results(raw)
        if kind=='football':result['drives']=[d for d in drive_flow(raw,cal) if d.get('team_id') in known]
    if kind=='football':
        for drive in result.get('drives',[]):
            if len(json.dumps(result).encode())<=MAX_RESPONSE_BYTES:break
            drive.pop('play_details',None)
    if len(json.dumps(result).encode())>MAX_RESPONSE_BYTES:raise ValueError('Normalized tracker limit exceeded')
    return result

class TrackerBusy(Exception):pass
class TrackerUnavailable(Exception):pass

def fetch_summary(league,event_id):
    route=LEAGUES[league][0]
    url='https://site.api.espn.com/apis/site/v2/sports/'+route+'/summary?event='+event_id
    # Same client header as server.get_json. ESPN's edge answers Access Denied (403) for
    # unrecognised agents such as 'Orbital sports metadata/1' while serving this one.
    request=urllib.request.Request(url,headers={'Accept':'application/json','User-Agent':'curl/8.7.1'})
    with urllib.request.urlopen(request,timeout=8) as response:
        data=response.read(MAX_BYTES+1)
    if len(data)>MAX_BYTES:raise TrackerUnavailable('Summary exceeds bounded size')
    result=json.loads(data)
    if not isinstance(result,dict):raise TrackerUnavailable('Summary unavailable')
    return result

class TrackerCache:
    """Bounded active keys, single flight, one full JSON decode at a time, normalized cache only.

    with background=True (production) a cached value younger than
    SERVE seconds is returned immediately and refreshed off the request path once it is older
    than FRESH, so only a cold key ever waits for ESPN. prefetch() warms live games while
    Sports is in use, so opening one is normally a cache hit. The catalogue work lock is no
    longer taken (it made trackers answer 'busy' during a 12 s library inventory); fetch_lock
    still bounds full summary decodes to one at a time.
    """
    FRESH=10;SERVE=120;IDLE=30;WARM=300
    # A game someone has open (web polls every ~4 s while visible) refreshes behind that viewer
    # at this age instead of FRESH, so new pitches/plays trail ESPN by seconds, not ~20 s.
    WATCHED=4
    def __init__(self,fetcher=fetch_summary,clock=time.monotonic,wall=time.time,background=False,max_active=6):
        self.fetcher=fetcher;self.clock=clock;self.wall=wall;self.lock=threading.Lock();self.fetch_lock=threading.Lock();self.entries={}
        self.background=background;self.max_active=max_active
    def _entry(self,key,now,warm=False):
        """Caller holds self.lock."""
        for old,e in list(self.entries.items()):
            if old!=key and not e['pending'] and now-e['touched']>self.IDLE and now>e.get('warm_until',-1e20):del self.entries[old]
        entry=self.entries.get(key)
        if entry is None:
            if len(self.entries)>=self.max_active:
                if warm:return None
                raise TrackerBusy('Six trackers are already active. Hide one and retry.' if self.max_active==6 else 'Too many trackers are active. Hide one and retry.')
            entry={'data':None,'updated':-1e20,'retry_after':-1e20,'touched':now,'pending':False,'done':threading.Event()};self.entries[key]=entry
        if warm:entry['warm_until']=now+self.WARM
        else:entry['touched']=now
        return entry
    def _load(self,league,event_id,day,work_lock):
        if not self.fetch_lock.acquire(timeout=8):raise TrackerBusy('Tracker refresh queue is busy.')
        try:
            held=work_lock is None or work_lock.acquire(timeout=1)
            if not held:raise TrackerBusy('Sports metadata work is busy. Retry shortly.')
            try:
                raw=self.fetcher(league,event_id);value=normalize(raw,league,event_id,self.wall())
                stamp=datetime.fromisoformat(value['start'].replace('Z','+00:00')).astimezone(ZONE).date().isoformat()
                if stamp!=day:raise ValueError('Tracker event date mismatch')
                return value
            finally:
                if work_lock is not None:work_lock.release()
        finally:self.fetch_lock.release()
    def _refresh(self,entry,league,event_id,day,work_lock):
        """Owner of entry['pending']; returns the new or stale value, or raises."""
        try:
            value=self._load(league,event_id,day,work_lock)
            with self.lock:entry['data']=value;entry['updated']=self.clock()
            return copy.deepcopy(value)
        except Exception as error:
            with self.lock:
                entry['retry_after']=self.clock()+10
                old=entry['data']
                if old is not None and self.clock()-entry['updated']<=120:
                    value=copy.deepcopy(old);value.update(stale=True,tracking_available=False,geometry_available=False,unavailable_reason='Saved tracker data; refresh unavailable.')
                    value['points']=[]
                    for p in value['plays']:p.pop('start_x',None);p.pop('end_x',None)
                    # Store the stale copy briefly to prevent a failing upstream request per caller.
                    entry['data']=value
                    return value
                entry['data']=None
            if isinstance(error,(TrackerBusy,ValueError)):raise
            raise TrackerUnavailable('Tracker metadata unavailable') from None
        finally:
            with self.lock:entry['pending']=False;entry['done'].set()
    def _spawn(self,entry,league,event_id,day):
        """Caller holds self.lock and has checked entry is not pending."""
        entry['pending']=True;entry['done'].clear()
        def run():
            try:self._refresh(entry,league,event_id,day,None)
            except Exception:pass
        threading.Thread(target=run,daemon=True,name='tracker-refresh').start()
    def get(self,league,event_id,day,work_lock=None):
        if league not in LEAGUES or not re.fullmatch(r'[0-9]{1,12}',event_id):raise ValueError('Invalid tracker identity')
        key=(league,event_id,day);now=self.clock()
        with self.lock:
            entry=self._entry(key,now)
            age=now-entry['updated']
            if entry['data'] is not None and age<(self.WATCHED if self.background else self.FRESH):return copy.deepcopy(entry['data'])
            if self.background and entry['data'] is not None and age<self.SERVE:
                # Serve the latest copy now; refresh behind it (never more than one at a time).
                if not entry['pending'] and now>=entry['retry_after']:self._spawn(entry,league,event_id,day)
                return copy.deepcopy(entry['data'])
        return self._get_slow(entry,league,event_id,day,work_lock)
    def _get_slow(self,entry,league,event_id,day,work_lock):
        now=self.clock()
        with self.lock:
            if now<entry['retry_after']:
                if entry['data'] is not None:return copy.deepcopy(entry['data'])
                raise TrackerUnavailable('Tracker metadata unavailable; retry shortly.')
            owner=not entry['pending']
            if owner:entry['pending']=True;entry['done'].clear()
            done=entry['done']
        if not owner:
            if not done.wait(9):raise TrackerBusy('Tracker refresh pending. Retry shortly.')
            with self.lock:
                if entry['data'] is None:raise TrackerUnavailable('Tracker metadata unavailable')
                return copy.deepcopy(entry['data'])
        return self._refresh(entry,league,event_id,day,None if self.background else work_lock)
    def prefetch(self,league,event_id,day,inline=False):
        """Warm a live game; never raises. inline=True refreshes in the caller's thread (the
        server's single pre-warm loop), otherwise in a new background thread."""
        if league not in LEAGUES or not re.fullmatch(r'[0-9]{1,12}',event_id):return False
        now=self.clock()
        with self.lock:
            entry=self._entry((league,event_id,day),now,warm=True)
            if entry is None or entry['pending'] or now<entry['retry_after'] or now-entry['updated']<self.FRESH:return False
            if not inline:
                self._spawn(entry,league,event_id,day)
                return True
            entry['pending']=True;entry['done'].clear()
        try:self._refresh(entry,league,event_id,day,None)
        except Exception:return False
        return True

CACHE=TrackerCache(background=True,max_active=24)
