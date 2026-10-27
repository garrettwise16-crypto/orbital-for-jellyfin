"""Bounded four-sport reference fields from an already fetched source response.

No source acquisition or timing policy lives here. Existing three-sport
references are returned untouched. Current scores and aggregate state are
never exported as historical row facts.
"""
import copy,math,re

LEAGUES={'NBA':'basketball','WNBA':'basketball','NHL':'hockey','MLS':'soccer'}
MAX_ROWS=2000

def number(value,low=None,high=None):
    if type(value) not in (int,float) or not math.isfinite(value):return None
    return value if (low is None or value>=low) and (high is None or value<=high) else None
def identity(value):
    value=str(value) if value is not None else ''
    return value if re.fullmatch(r'[A-Za-z0-9_-]{1,64}',value) else None
def text(value,limit=400):
    if not isinstance(value,str) or re.search(r'https?://',value,re.I):return None
    value=re.sub(r'[\x00-\x1f\x7f]',' ',value).strip()
    return value[:limit] or None
def rows(value):
    if value is None:return []
    if not isinstance(value,list) or len(value)>MAX_ROWS:raise ValueError('generic reference row bound')
    return value

def _play(source):
    if not isinstance(source,dict) or identity(source.get('id')) is None:return None
    out={'id':identity(source['id'])}
    for key,limit in (('text',400),('wallclock',40)):
        value=text(source.get(key),limit)
        if value is not None:out[key]=value
    for key,low,high in (('awayScore',0,999),('homeScore',0,999),('pointsAttempted',2,3),('scoreValue',0,3)):
        value=number(source.get(key),low,high)
        if value is not None:out[key]=value
    for key in ('shootingPlay','scoringPlay'):
        if type(source.get(key)) is bool:out[key]=source[key]
    nested={
        'period':{'number':lambda v:number(v,1,30)},
        'clock':{'displayValue':lambda v:text(v,30),'value':lambda v:number(v,0,18000)},
        'type':{'text':lambda v:text(v,80)},
        'team':{'id':identity},
        'coordinate':{'x':lambda v:number(v,-100,100),'y':lambda v:number(v,-42.5,42.5)}}
    for key,fields in nested.items():
        source_nested=source.get(key)
        if not isinstance(source_nested,dict):continue
        accepted={field:convert(source_nested.get(field)) for field,convert in fields.items()}
        accepted={field:value for field,value in accepted.items() if value is not None}
        if accepted:out[key]=accepted
    return out

def extend(reference,raw,league):
    if league not in LEAGUES:return reference
    if not isinstance(reference,dict) or not isinstance(raw,dict) or (raw.get('header') or {}).get('id')!=(reference.get('header') or {}).get('id'):raise ValueError('generic reference event identity')
    out=copy.deepcopy(reference)
    if league=='MLS':
        commentary=[]
        for source in rows(raw.get('commentary')):
            if not isinstance(source,dict):continue
            sequence=source.get('sequence');play=_play(source.get('play'))
            if type(sequence) is not int or not 0<=sequence<=1_000_000 or play is None:continue
            value={'sequence':sequence,'play':play};label=text(source.get('text'))
            if label:value['text']=label
            commentary.append(value)
        out['commentary']=commentary
        out['keyEvents']=[p for source in rows(raw.get('keyEvents')) if (p:=_play(source)) is not None]
    else:
        out['plays']=[p for source in rows(raw.get('plays')) if (p:=_play(source)) is not None]
    return out

def metadata(value,league):
    if league not in LEAGUES:return None
    if not isinstance(value,dict) or value.get('league')!=league or value.get('kind')!=LEAGUES[league] or identity(value.get('event_id')) is None:raise ValueError('generic reference metadata identity')
    source=value.get('teams')
    if not isinstance(source,list) or len(source)!=2:raise ValueError('generic reference metadata teams')
    teams=[]
    for row in source:
        if not isinstance(row,dict) or identity(row.get('id')) is None or row.get('side') not in ('away','home'):raise ValueError('generic reference metadata team identity')
        item={'id':identity(row['id']),'side':row['side']}
        for key,limit in (('name',160),('abbreviation',12)):
            label=text(row.get(key),limit)
            if label:item[key]=label
        for key in ('color','alt_color'):
            if isinstance(row.get(key),str) and re.fullmatch(r'#[0-9a-fA-F]{6}',row[key]):item[key]=row[key]
        teams.append(item)
    if len({t['id'] for t in teams})!=2 or {t['side'] for t in teams}!={'away','home'}:raise ValueError('generic reference metadata team identity')
    return {'schema':1,'event':str(value['event_id']),'league':league,'kind':LEAGUES[league],'teams':teams,
            'source_state':value.get('state') if value.get('state') in ('live','final','scheduled','unavailable') else 'unavailable'}
