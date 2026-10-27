"""Explicit copy-bound VOD controls; viewer authorization checked on every call."""
from experience import Fault, digest, item_id, integer, keys, text

def context(service, actor, credential, state, data):
    keys(data, {'id','source_id'}, {'id','source_id'})
    uid=item_id(data['id']);source_id=text(data['source_id'],128)
    rows=service._items(actor,credential,[uid])
    if not rows or rows[0].get('Type') not in ('Movie','Episode') or rows[0].get('PlayAccess')!='Full':
        raise Fault(404,'item_unavailable')
    item=rows[0];sources=item.get('MediaSources') or []
    sources=[s for s in sources if isinstance(s,dict)]
    source=next((s for s in sources if s.get('Id')==source_id),None)
    if source is None:raise Fault(409,'playback_copy_unavailable')
    duration=source.get('RunTimeTicks') or item.get('RunTimeTicks')
    if type(duration) is not int or duration<=0:raise Fault(422,'duration_unavailable')
    copy_key=digest([uid,source_id,duration,source.get('Path'),source.get('Container'),
                     source.get('ETag') or source.get('Etag') or item.get('Etag'),source.get('DateModified') or item.get('DateModified'),
                     [(s.get('Type'),s.get('Codec'),s.get('Index')) for s in source.get('MediaStreams',[]) if isinstance(s,dict)]])
    segments=[]
    # Jellyfin's item-level segments do not identify alternate-edition timing.
    # Consume them only when a single authorized copy has matching item duration.
    segment_binding=len(sources)==1 and item.get('RunTimeTicks')==duration
    segment_availability='unsupported_copy' if not segment_binding else 'disabled'
    if service.config.playback_preferences and segment_binding:
        try:
            raw=service._json('/MediaSegments/'+uid,credential)
            segment_availability='available'
        except Exception as error:
            if getattr(error,'code_http',getattr(error,'status',getattr(error,'code',None))) not in (404,405,501):raise
            raw={};segment_availability='unsupported_endpoint'
        raw_segments=raw.get('Items',[]) if isinstance(raw,dict) else []
        if not isinstance(raw_segments,list) or len(raw_segments)>256:raw_segments=[]
        for segment in raw_segments:
            if not isinstance(segment,dict):continue
            a,b=segment.get('StartTicks'),segment.get('EndTicks')
            if segment.get('Type') in ('Intro','Outro') and type(a) is int and type(b) is int and 0<=a<b<=duration and b-a>=10000000 and (segment['Type']=='Outro' or b<duration):
                segments.append({'type':segment['Type'],'start_ticks':a,'end_ticks':b})
    # Reject conflicts across each full valid interval, including a later-starting marker.
    segments=[s for i,s in enumerate(segments) if not any(i!=j and s['start_ticks']<other['end_ticks'] and other['start_ticks']<s['end_ticks'] for j,other in enumerate(segments))]
    bookmarks=[b for b in state['bookmarks'] if b['item_id']==uid and b.get('copy_key')==copy_key]
    return {'item_id':uid,'source_id':source_id,'copy_key':copy_key,'duration_ticks':duration,
            'copy_identity':'server_descriptor_and_available_version_not_media_content_hash',
            'segments':segments,'segment_availability':segment_availability,'segment_binding':'single_authorized_copy' if segment_binding else 'alternate_editions_unsupported',
            'bookmarks':bookmarks if service.config.bookmarks else [],
            'auto_intro':service.config.playback_preferences and state['preferences']['auto_intro'],
            'auto_credits':service.config.playback_preferences and state['preferences']['auto_credits'],
            'subtitle_language':state['preferences']['subtitle_language'] if service.config.playback_preferences else '',
            'capabilities':{'bookmarks':service.config.bookmarks,'playback_preferences':service.config.playback_preferences}}

def handle(service,method,path,headers,body):
    data,actor,credential,state=service.parse(method,path,headers,body)
    if path.endswith('/player-context'):
        if not(service.config.bookmarks or service.config.playback_preferences):raise Fault(403,'feature_not_enabled')
        return 200,context(service,actor,credential,state,data)
    if not service.config.bookmarks:raise Fault(403,'feature_not_enabled')
    keys(data,{'id','source_id','copy_key','ticks','label','revision','mutation_id'}, {'id','source_id','copy_key','ticks','label','revision','mutation_id'})
    current=context(service,actor,credential,state,{k:data[k] for k in ('id','source_id')})
    if data['copy_key']!=current['copy_key']:raise Fault(409,'playback_copy_changed')
    ticks=integer(data['ticks'],0,current['duration_ticks']-1)
    operation={'kind':'bookmark_put','value':{'item_id':current['item_id'],'source_id':current['source_id'],
        'copy_key':current['copy_key'],'ticks':ticks,'label':text(data['label'],120)}}
    return 200,service.store.mutate(actor,data['revision'],operation,item_id(data['mutation_id']))
