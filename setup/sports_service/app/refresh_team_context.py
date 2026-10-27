"""Public ESPN team-page helpers (from the owner team-context job; household team list excluded)."""

def compact_events(events):
    """Keep recent results and upcoming games, not a season of duplicated logo sets."""
    from datetime import datetime, timezone
    now=datetime.now(timezone.utc).isoformat()
    ordered=sorted(events,key=lambda e:e.get('date',''))
    selected=[e for e in ordered if e.get('date','')<now][-3:]+[e for e in ordered if e.get('date','')>=now][:4]
    output=[]
    for event in selected:
        c=(event.get('competitions') or [{}])[0]
        output.append({'id':event.get('id'),'date':event.get('date'),'name':event.get('name'),
                       'status':c.get('status',event.get('status')),
                       'broadcasts':[b.get('media',{}).get('shortName') for b in c.get('broadcasts',[])],
                       'teams':[{'id':t.get('id'),'side':t.get('homeAway'),'name':t.get('team',{}).get('displayName'),
                                 'logo':next((x.get('href') for x in t.get('team',{}).get('logos',[]) if 'default' in x.get('rel',[])),None),
                                 'score':t.get('score')} for t in c.get('competitors',[])]})
    return output


def compact_statistics(raw):
    """Keep provider labels/categories; absent numeric facts are never zero-filled."""
    output=[]
    for category in raw.get('results',{}).get('stats',{}).get('categories',[])[:30]:
        for stat in category.get('stats',[])[:50]:
            value=stat.get('displayValue')
            label=stat.get('displayName') or stat.get('name')
            if value is not None and label:
                output.append({'label':str(label)[:160], 'value':str(value)[:80],
                               'category':str(category.get('displayName') or category.get('name') or '')[:100]})
    return output[:300]
