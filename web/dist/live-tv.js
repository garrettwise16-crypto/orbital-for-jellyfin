/* Orbital for Jellyfin, public web edition. Picture-timed sync is not included; trackers use the estimated delay and Sync. */
/* Initial Game Center reveal waits for both metadata and feed inventory. */
(function(root,install){if(typeof module==='object'&&module.exports)module.exports=install;else install(root);})(typeof window==='object'?window:globalThis,function(win){
 'use strict';if(win.OrbitalGameReady?.version===2)return win.OrbitalGameReady;
 const doc=win.document;let sequence=0;
 function attach(dialog,api,retry){
  if(new URLSearchParams(win.location.search).get('orbital')==='off'||win.location.pathname.startsWith('/simple/')||api.getCurrentUserId()===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'))return null;
  const user=api.getCurrentUserId(),server=api.serverId?.(),credential=api.accessToken?.(),route=win.location.hash,id=++sequence;
  let ended=false,phase='loading',work=0,observer,timer;const saved=new Map();
  function conceal(n){if(!saved.has(n))saved.set(n,{hidden:n.hidden,inert:n.inert,display:n.style.getPropertyValue('display'),priority:n.style.getPropertyPriority('display')});n.hidden=true;n.inert=true;n.style.setProperty('display','none','important');}
  function restore(n){const old=saved.get(n);if(!old)return;n.hidden=old.hidden;n.inert=old.inert;if(old.display)n.style.setProperty('display',old.display,old.priority);else n.style.removeProperty('display');saved.delete(n);}
  const current=()=>!ended&&dialog.isConnected&&dialog.open&&win.location.hash===route&&win.ApiClient===api&&api.getCurrentUserId()===user&&api.serverId?.()===server&&api.accessToken?.()===credential&&dialog.__gcPresentation===gate;
  const content=()=>[...dialog.children].filter(n=>!n.classList.contains('otv-game-topline')&&!n.classList.contains('ogc-initial-loading'));
  const panel=doc.createElement('section'),label=doc.createElement('p'),button=doc.createElement('button');
  panel.className='ogc-initial-loading';panel.setAttribute('role','status');label.className='otv-loading';label.textContent='Loading game and feeds…';
  button.className='otv-category';button.type='button';button.textContent='Retry';button.hidden=true;button.onclick=()=>{if(current())retry();};panel.append(label,button);
  content().forEach(conceal);dialog.append(panel);dialog.setAttribute('aria-busy','true');
  function commit(next){
   if(phase==='complete'||phase===next)return;phase=next;work++;dialog.dataset.gcPresentation=phase;
   if(next==='complete'){
    win.clearTimeout(timer);content().forEach(restore);panel.remove();dialog.setAttribute('aria-busy','false');
   }else if(next==='error'){
    win.clearTimeout(timer);label.className='';label.textContent='Game information could not finish loading.';button.hidden=false;dialog.setAttribute('aria-busy','false');
   }
  }
  function scan(){
   if(!current())return false;
   if(phase!=='complete')content().forEach(conceal);
   if(phase!=='loading')return true;
   if(dialog.dataset.gcContext==='error'||dialog.dataset.feedLookup==='error'){commit('error');return true;}
   if(dialog.dataset.gcContext==='complete'&&dialog.dataset.feedLookup==='ready'&&(dialog.classList.contains('otv-feed-picker')||dialog.dataset.gcTracker==='settled'))commit('complete');
   return true;
  }
  const fail=()=>{if(!current())return false;commit('error');return true;};
  const snapshot=()=>{scan();const ready=current()&&phase!=='loading';return {ready:!!ready,stamp:ready?'gc:'+id+':'+work+':'+phase:null,phase};};
  const gate={snapshot,fail,scan};dialog.__gcPresentation=gate;dialog.dataset.gcPresentation='loading';
  const changed=()=>{if(current())scan();};
  dialog.addEventListener('gc-context-error',changed);dialog.addEventListener('reconcile-feeds',changed);
  if(typeof win.MutationObserver==='function'){observer=new win.MutationObserver(changed);observer.observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['data-gc-context','data-feed-lookup','data-gc-tracker']});}
  timer=win.setTimeout(fail,12000);
  dialog.addEventListener('close',()=>{ended=true;win.clearTimeout(timer);observer?.disconnect();dialog.removeEventListener('gc-context-error',changed);dialog.removeEventListener('reconcile-feeds',changed);},{once:true});
  scan();return gate;
 }
 win.OrbitalGameReady={version:2,attach};return win.OrbitalGameReady;
});


/* Orbital television: permission-scoped presentation over native Jellyfin.
   No playback, recording, account, source or provider configuration changes. */
(()=>{
 'use strict';
 if(new URLSearchParams(location.search).get('orbital')==='off')return;
 const BATCH={channels:matchMedia('(max-width:420px)').matches?18:36,programs:matchMedia('(max-width:420px)').matches?12:24,guide:matchMedia('(max-width:700px)').matches?30:40};
 const S={user:null,channels:[],fetched:0,pending:null,group:'All channels',query:'',guideGroup:'All channels',guideQuery:'',channelLimit:BATCH.channels,programLimit:BATCH.programs,guideLimit:BATCH.guide,guideCache:new Map(),guidePending:null,empty:new Map()};
 const sports={day:new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),league:'All leagues',query:'',live:false,hasFeed:false,data:null,user:null,pending:false,serial:0,error:null,previous:null};
 const phone=()=>Boolean(window.OrbitalPhone?.active());
 const $=(s,n=document)=>n.querySelector(s);
 const make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!=null)n.textContent=text;return n;};
 const icon=name=>{const n=make('span','material-icons',name);n.setAttribute('aria-hidden','true');return n;};
 const route=(api,id)=>'#/details?id='+encodeURIComponent(id)+'&serverId='+encodeURIComponent(api.serverId());
 const playRoute=(api,id)=>route(api,id)+'&orbitalAutoplay=1';
 const link=(text,href,cls='otv-link')=>{const a=make('a',cls,text);a.href=href;return a;};
 const clock=d=>new Date(d).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const isSource=c=>{const n=Number(c.Number);return n>=2601&&n<=2999||n>=3101&&n<=3999;};
 const category=c=>{
  const n=Number(c.Number);if(isSource(c))return 'Sources';if(n>=2000&&n<2600)return 'Events';
  if(n>=1800&&n<1900||n>=1001&&n<=1018&&n!==1012||n===1103)return 'Sports';
  if(n>=1100&&n<1200)return 'News';if(n>=1300&&n<1400)return 'Movies';
  if(n>=1400&&n<1500)return 'Nature';if(n>=1500&&n<1600)return 'Kids';
  if(n>=1600&&n<1700)return 'Lifestyle';if(n>=1700&&n<1800)return 'Music';
  if(n>=5000&&n<6000)return 'Sports';if(n>=6000&&n<6500)return 'News';
  if(n>=6500&&n<7500)return 'Entertainment';if(n>=7500&&n<7700)return 'Movies';
  if(n>=7700&&n<7900)return 'Kids';if(n>=7900&&n<10000)return 'Local';return 'Entertainment';
 };
 const groups=['All channels','Favorites','Sports','News','Entertainment','Movies','Nature','Kids','Lifestyle','Music','Local','Events','Sources'];
 // Native API calls retain real results. Presentation ownership is DOM-only.
 function patchNativeChannelQuery(api) {}
 const GUIDE_SPAN=21600000;
 const timeX=(time,start)=>100*(time-start)/GUIDE_SPAN;
 const channelCache=new Map(),channelPending=new Map(),guideRequests=new Map();
 const sessionKey=(api,user=api.getCurrentUserId())=>JSON.stringify([api.serverId?.(),user,api.accessToken?.()]);
 const sessionCurrent=(api,key)=>api===window.ApiClient&&sessionKey(api)===key;
 const liveRoute=(tab,hash=location.hash)=>{const [p,q='']=hash.split('?'),s=new URLSearchParams(q);return p==='#/livetv'&&(tab==='guide'?s.get('tab')==='1':tab==='channels'?s.get('tab')==='2':tab==='sports'?(s.get('tab')||'0')==='0'&&s.get('sports')==='1':(s.get('tab')||'0')==='0'&&s.get('sports')!=='1');};
 function livePhase(root,phase,api,user,hash=location.hash,identity=sessionKey(api,user),extra=()=>true){
  if(user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')||!root?.isConnected||location.hash!==hash||!sessionCurrent(api,identity)||!extra())return;
  root.dataset.pageReadyRoute=hash;root.dataset.pageReadyUser=user;root.dataset.phase=phase;
  const host=root.parentElement,valid=()=>root.parentElement===host&&location.hash===hash&&sessionCurrent(api,identity)&&extra();
  if(phase==='complete')void window.OrbitalPageReady?.prepare(root,{api,user,server:api.serverId?.(),credential:api.accessToken?.(),host,valid});
  else if(phase==='error'&&window.OrbitalPageReady?.managed(hash))void window.OrbitalPageReady.fail('This page could not finish loading. Please retry.');
 }
 const channelScope=()=>((location.hash.includes('tab=1')?S.guideGroup:S.group)==='Favorites'?'favorites':'all');
 function restoreNative(tab){
  tab.classList.remove('otv-full-guide-ready','otv-channels-ready','otv-programs-ready');
  tab.querySelectorAll('.orbital-native-hidden').forEach(n=>{n.inert=false;n.hidden=false;n.removeAttribute('aria-hidden');n.classList.remove('orbital-native-hidden');});
 }
 const matches=(c,g,q)=>{
  if(g==='All channels'&&isSource(c))return false;
  if(g==='Favorites'&&(isSource(c)||!c.UserData?.IsFavorite))return false;
  if(!['All channels','Favorites'].includes(g)&&category(c)!==g)return false;
  return !q||[c.Name,c.Number,c.CurrentProgram?.Name].join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase());
 };
 function heading(tab,title,desc){if(phone())title=title==='Your TV guide'?'Guide':title==='A world of channels'?'Channels':title==='Find something worth watching'?'On now':title;
  let h=$('.otv-heading',tab);if(h)return h;
  h=make('header','otv-heading orbital-personal');const left=make('div','otv-heading-copy');
  left.append(make('p','otv-eyebrow','TELEVISION'),make('h1','',title),make('p','otv-description',desc));
  const date=make('div','otv-date');date.append(make('span','otv-date-day',new Date().toLocaleDateString([],{weekday:'long'})),make('span','',new Date().toLocaleDateString([],{month:'long',day:'numeric'})));
  h.append(left,date);const nav=$('.otv-sports-nav',tab);if(nav)nav.after(h);else tab.prepend(h);return h;
 }
 function isolateNative(tab){
  const keep=n=>n.matches('.otv-sports-nav,.otv-heading,.otv-controls,.otv-channel-grid,.otv-program-shelf,.otv-full-guide,.otv-load-more,.tvGuideHeader');
  for(const n of [...tab.children]){if(!keep(n)){n.inert=true;n.hidden=true;n.setAttribute('aria-hidden','true');n.classList.add('orbital-native-hidden');}}
  tab.querySelectorAll('.emby-scroller,.itemsContainer,.guideVerticalScroller,.programContainer').forEach(n=>{if(!n.closest('.orbital-personal,.otv-full-guide,.otv-program-shelf,.otv-channel-grid,.tvGuideHeader')){n.inert=true;n.hidden=true;n.setAttribute('aria-hidden','true');n.classList.add('orbital-native-hidden');}});
 }
 function controls(tab,guide=false,renderer=null){
  let node=$('.otv-controls',tab);if(node)return node;
  node=make('div','otv-controls orbital-personal');const row=make('div','otv-control-row');
  const label=make('label','otv-search');label.append(icon('search'));const input=make('input','');input.type='search';input.placeholder=guide?(phone()?'Search channels':'Find a channel in the guide'):(phone()?'Search channels & shows':'Search channels or programmes');input.setAttribute('aria-label',input.placeholder);input.value=guide?S.guideQuery:S.query;label.append(input);
  const count=make('span','otv-result-count');count.setAttribute('role','status');count.setAttribute('aria-live','polite');row.append(label,count);node.append(row);
  const chips=make('div','otv-categories');chips.setAttribute('aria-label','Channel categories');
  groups.forEach(g=>{const b=make('button','otv-category',g);b.type='button';b.setAttribute('aria-pressed',String(g===(guide?S.guideGroup:S.group)));b.addEventListener('click',()=>{if(guide){S.guideGroup=g;S.guideLimit=BATCH.guide;}else{S.group=g;if(renderer)S.programLimit=BATCH.programs;else S.channelLimit=BATCH.channels;}chips.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));if(guide)renderFullGuide(tab,window.ApiClient,S.user);else if(renderer)renderer();else load(window.ApiClient,S.user).then(()=>renderChannels(tab,window.ApiClient));});chips.append(b);});node.append(chips);
  if(guide){const select=make('select','otv-guide-category');select.setAttribute('aria-label','Guide category');for(const g of groups){const option=make('option','',g);option.value=g;select.append(option);}select.value=S.guideGroup;select.onchange=()=>{S.guideGroup=select.value;S.guideLimit=BATCH.guide;renderFullGuide(tab,window.ApiClient,S.user);};row.insertBefore(select,count);node.classList.add('otv-guide-controls');}
  const skip=link('Skip filters and browse results',guide?'#otv-guide-results':'#otv-channel-results','otv-skip');node.append(skip);
  input.addEventListener('input',()=>{if(guide){S.guideQuery=input.value;S.guideLimit=BATCH.guide;renderFullGuide(tab,window.ApiClient,S.user);}else{S.query=input.value;if(renderer){S.programLimit=BATCH.programs;renderer();}else{S.channelLimit=BATCH.channels;renderChannels(tab,window.ApiClient);}}});
  return node;
 }
 function loadingNote(tab,text){if(!tab)return;let n=tab.querySelector(':scope > .otv-loading');if(!n){n=make('p','otv-loading',text);n.setAttribute('role','status');(tab.querySelector('.otv-controls')||tab.firstElementChild)?.after(n);}else n.textContent=text;return n;}
 function clearLoading(tab){tab?.querySelectorAll(':scope > .otv-loading').forEach(n=>n.remove());}
 async function load(api,user){
  const scope=channelScope(),identity=sessionKey(api,user),key=identity+'|'+scope,hit=channelCache.get(key);
  if(!sessionCurrent(api,identity)||S.user!==user)return [];
  if(hit&&Date.now()-hit.at<120000){S.channels=hit.items;S.fetched=hit.at;return hit.items;}
  if(!channelPending.has(key))channelPending.set(key,(async()=>{
   const items=[],seen=new Set(),limit=500;
   const page=start=>api.getLiveTvChannels({UserId:user,EnableCurrentProgram:true,EnableUserData:true,StartIndex:start,Limit:limit,...(scope==='favorites'?{IsFavorite:true}:{})});
   const first=await page(0),total=Number(first.TotalRecordCount)||0;
   if(total>10000)throw Error('Channel catalog exceeds guarded limit');
   const append=(r,start)=>{
    if(!Array.isArray(r.Items))throw Error('Channels unavailable');
    if(!r.Items.length&&start<total||start+r.Items.length<total&&r.Items.length!==limit||r.Items.length>limit)throw Error('Incomplete channel inventory');
    if(r.TotalRecordCount!=null&&Number(r.TotalRecordCount)!==total)throw Error('Channel inventory changed');
    for(const item of r.Items){if(seen.has(item.Id))throw Error('Channel inventory changed');seen.add(item.Id);items.push(item);}
    if(items.length>10000)throw Error('Channel catalog exceeds guarded limit');
   };
   append(first,0);
   // Two independent metadata pages at a time; retain ordered, complete results.
   for(let start=limit;start<total;start+=limit*2){const offsets=[start,start+limit].filter(n=>n<total),pages=await Promise.all(offsets.map(page));for(let i=0;i<pages.length;i++)append(pages[i],offsets[i]);}
   if(!sessionCurrent(api,identity))throw Error('Session changed');
   const value={items,at:Date.now()};channelCache.set(key,value);while(channelCache.size>6)channelCache.delete(channelCache.keys().next().value);return value;
  })().finally(()=>channelPending.delete(key)));
  const value=await channelPending.get(key);
  if(!sessionCurrent(api,identity)||S.user!==user||channelScope()!==scope)return [];
  S.channels=value.items;S.fetched=value.at;return value.items;
 }
 function channelImage(c,api,width=420){if(phone())width=Math.min(width,180);return c?.ImageTags?.Primary?api.getImageUrl(c.Id,{type:'Primary',tag:c.ImageTags.Primary,maxWidth:width,quality:88}):'';}
 function programEvent(name=''){
  const match=name.match(/^\s*(MLB|NFL|NBA|WNBA|NHL|College football)\s*:\s*(.+?)\s+(?:@|at|vs\.?|versus)\s+(.+?)\s*$/i);if(!match)return null;
  const leagues={'mlb':'MLB','nfl':'NFL','nba':'NBA','wnba':'WNBA','nhl':'NHL','college football':'College football'},league=leagues[match[1].toLowerCase()];
  return {league,teams:[{name:match[2],side:'away'},{name:match[3],side:'home'}]};
 }
 function teamMarks(event){
  const group=make('div','otv-program-teams');
  for(const team of event.teams){const art=window.OrbitalArtwork.team(event,team),mark=make('span','otv-program-team-mark',art?.abbr||team.name.split(/\s+/).map(x=>x[0]).slice(0,3).join(''));
   if(window.OrbitalArtwork.url(art?.url)){const image=make('img','otv-program-team-logo');image.src=art.url;image.alt=team.name;image.loading='lazy';image.onerror=()=>image.replaceWith(mark);group.append(image);}else group.append(mark);
  }return group;
 }
 function channelCard(c,api){
  const card=make('article','otv-channel');card.dataset.category=category(c);
  const programme=c.CurrentProgram,programmeType=!phone()&&programme?.ImageTags?.Thumb?'Thumb':!phone()&&programme?.ImageTags?.Primary?'Primary':null;const art=make('div','otv-channel-art'+(programmeType?' has-programme-art':'')),imageUrl=programmeType?api.getImageUrl(programme.Id,{type:programmeType,tag:programme.ImageTags[programmeType],maxWidth:600}):channelImage(c,api);if(imageUrl){const image=make('img','');image.src=imageUrl;image.alt='';image.loading='lazy';image.onerror=()=>{if(art.classList.contains('has-programme-art')&&channelImage(c,api)){art.classList.remove('has-programme-art');image.src=channelImage(c,api);}else{image.remove();art.classList.add('otv-art-missing');}};art.append(image);}else art.classList.add('otv-art-missing');
  art.dataset.wordmark=String(c.Name||'').replace(/\s*[\[(].*?[\])]/g,'').trim().slice(0,22);art.style.setProperty('--wm-h',String([...String(c.Name||'')].reduce((h,ch)=>(h*31+ch.charCodeAt(0))%360,7)));
  const event=programEvent(c.CurrentProgram?.Name)||programEvent(c.Name);if(event)art.append(teamMarks(event));card.append(art);
  const top=make('div','otv-channel-top');const number=make('span','otv-number',c.Number||'TV');top.append(number,make('span','otv-genre',category(c)));
  if(c.UserData?.IsFavorite){const star=icon('favorite');star.title='Favorite channel';top.append(star);}card.append(top);
  const title=link(String(c.Name||'Channel').replace(/\s+/g,' ').trim(),route(api,c.Id),'otv-channel-title');title.title=c.Name;card.append(title);
  const p=c.CurrentProgram;const valid=p&&new Date(p.EndDate)>Date.now()&&new Date(p.StartDate)<=Date.now();
  const placeholder=!p||p.Name===c.Name||p.Name===c.Name.split(' [')[0]||/programme listings are unavailable|channel placeholder/i.test(p.Overview||'');
  const body=make('div','otv-now');body.append(make('span','otv-now-label',placeholder?'LIVE':valid?'ON NOW':'FROM THE GUIDE'),make('h3','',placeholder?'Live '+String(category(c)).toLowerCase()+' channel':p.Name));
  body.append(make('p','otv-airtime',placeholder?'Schedule unavailable':clock(p.StartDate)+' – '+clock(p.EndDate)));card.append(body);
  const bottom=make('div','otv-card-bottom');bottom.append(link('Watch now',playRoute(api,c.Id),'otv-open'));
  const parentName=c.Name.slice(0,170);const alternatives=S.channels.filter(x=>isSource(x)&&x.Name.startsWith(parentName+' ['));
  if(alternatives.length)bottom.append(make('span','otv-source-count',alternatives.length+' feeds'));
  card.append(bottom);
  if(api.getCurrentUserId()===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')){const b=make('button','simple-report','Not working? Tell the owner');b.type='button';b.dataset.channelId=c.Id;b.dataset.channelName=c.Name;b.dataset.program=c.CurrentProgram?.Name||'';card.append(b);}
  if(valid&&!placeholder){const progress=make('div','otv-progress');const fill=make('span','');fill.style.width=Math.max(0,Math.min(100,100*(Date.now()-new Date(p.StartDate))/(new Date(p.EndDate)-new Date(p.StartDate))))+'%';progress.append(fill);progress.setAttribute('aria-hidden','true');card.append(progress);}
  return card;
 }
 // Load more: focus the first new result (or the retained button / results region), unless the
 // user already moved focus somewhere real while the page grew.
 function keepFocus(target,button,region){const active=document.activeElement;if(active&&active!==document.body&&active.isConnected)return;const first=target?.matches?.('a,button,[tabindex]')?target:target?.querySelector?.('a,button,[tabindex]:not([tabindex="-1"])');(first||button||region)?.focus();}
 function programmeSignature(programmes){let h=5381;for(const p of programmes){const s=(p.Id||'')+'|'+(p.ChannelId||'')+'|'+(p.StartDate||'')+'|'+(p.EndDate||'')+'|'+(p.Name||'')+'|'+(p.EpisodeTitle||'');for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;}return programmes.length+':'+(h>>>0).toString(36);}
 function renderChannels(tab,api){
  if(!liveRoute('channels')||!sessionCurrent(api,S.identity))return;
  let grid=$('.otv-channel-grid',tab);if(!grid){grid=make('div','otv-channel-grid orbital-personal');grid.id='otv-channel-results';grid.tabIndex=-1;tab.append(grid);}
  const list=S.channels.filter(c=>matches(c,S.group,S.query)).sort((a,b)=>Number(a.Number)-Number(b.Number));
  const visible=list.slice(0,S.channelLimit),previous=grid.__cards||new Map(),next=new Map();
  const cards=visible.map(c=>{const signature=JSON.stringify([c,Math.floor(Date.now()/60000)]),old=previous.get(c.Id),entry=old?.signature===signature?old:{signature,node:channelCard(c,api)};next.set(c.Id,entry);return entry.node;});grid.replaceChildren(...cards);grid.__cards=next;
  $('.otv-result-count',tab).textContent=(visible.length<list.length?'Showing '+visible.length+' of ':'' )+list.length+' '+(S.group==='Sources'?(list.length===1?'source option':'source options'):(list.length===1?'channel':'channels'));
  let more=$('.otv-load-more',tab);if(more)more.remove();
  if(visible.length<list.length){more=make('button','otv-load-more orbital-personal','Load '+BATCH.channels+' more channels');more.type='button';more.addEventListener('click',()=>{const from=S.channelLimit;S.channelLimit+=BATCH.channels;renderChannels(tab,api);keepFocus($('.otv-channel-grid',tab)?.children[from],$('.otv-load-more',tab),$('.otv-channel-grid',tab));});grid.after(more);}
  if(!list.length){const e=make('div','otv-no-results');e.append(icon('search_off'),make('h2','','No matching channels'),make('p','','Try another category or a shorter search.'));grid.append(e);}
  isolateNative(tab);tab.classList.add('otv-channels-ready');tab.dataset.otvRendered=String(S.fetched);livePhase(grid,'complete',api,S.user);window.OrbitalSettle?.end();
 }
 function guideStart(tab){
  const active=$('.guide-date-tab-button.emby-tab-button-active,.guide-date-tab-button[aria-selected=true]',tab),chosen=Number(active?.dataset?.date);
  const now=new Date(),floor=new Date(now);floor.setMinutes(now.getMinutes()<30?0:30,0,0);
  if(!Number.isFinite(chosen)||chosen<1e12)return floor.getTime();
  const picked=new Date(chosen);return picked.toDateString()===now.toDateString()?floor.getTime():chosen;
 }
 async function guidePrograms(api,user,start){
  const ids=S.channels.filter(c=>matches(c,S.guideGroup,S.guideQuery)).sort((a,b)=>Number(a.Number)-Number(b.Number)).slice(0,S.guideLimit).map(c=>c.Id).sort();if(!ids.length)return [];const identity=sessionKey(api,user),key=identity+'|'+start+'|'+ids.join(','),cached=S.guideCache.get(key);if(!sessionCurrent(api,identity)||S.user!==user)return [];if(cached&&Date.now()-cached.at<120000)return cached.items;
  if(guideRequests.has(key))return guideRequests.get(key);
  const promise=api.ajax({type:'GET',url:api.getUrl('LiveTv/Programs',{UserId:user,ChannelIds:ids.join(','),MinEndDate:new Date(start).toISOString(),MaxStartDate:new Date(start+GUIDE_SPAN).toISOString(),Limit:2000,EnableImages:true}),dataType:'json',timeout:10000}).then(result=>{const items=Array.isArray(result.Items)?result.Items:[];if(!sessionCurrent(api,identity))throw Error('Session changed');if(items.length<(result.TotalRecordCount||0))throw new Error('Incomplete programme window');S.guideCache.set(key,{at:Date.now(),items});if(S.guideCache.size>16)S.guideCache.delete(S.guideCache.keys().next().value);return items;}).finally(()=>{if(guideRequests.get(key)===promise)guideRequests.delete(key);});
  guideRequests.set(key,promise);while(guideRequests.size>16)guideRequests.delete(guideRequests.keys().next().value);return promise;
 }
 // GUIDE_SCHEDULE_LAYOUT_START
 // Preserve every programme entry. Conflicting intervals share the same time
 // coordinates but get separate lines instead of covering one another's links.
 function guideScheduleLayout(programs,channelId,start,end,minHitDuration=0){
  const entries=programs.map((program,index)=>({program,index,start:Math.max(start,Date.parse(program.StartDate)),end:Math.min(end,Date.parse(program.EndDate))}))
   .filter(entry=>entry.program.ChannelId===channelId&&entry.end>entry.start)
   .sort((a,b)=>a.start-b.start||a.end-b.end||a.index-b.index);
  const laneEnds=[];let furthestEnd=start,temporalOverlap=false;
  for(const entry of entries){if(entry.start<furthestEnd)temporalOverlap=true;furthestEnd=Math.max(furthestEnd,entry.end);entry.hitEnd=Math.max(entry.end,entry.start+minHitDuration);let lane=laneEnds.findIndex(lastEnd=>lastEnd<=entry.start);if(lane<0)lane=laneEnds.length;entry.lane=lane;laneEnds[lane]=entry.hitEnd;}
  return {entries,laneCount:laneEnds.length,temporalOverlap};
 }
 // GUIDE_SCHEDULE_LAYOUT_END
 function guideChannel(c,programs,api,start){
  const row=make('div','otv-full-guide-row'),channel=link('',playRoute(api,c.Id),'otv-full-guide-channel');
  row.dataset.channelId=c.Id;
  const logo=channelImage(c,api,160);if(logo){const image=make('img','');image.src=logo;image.alt='';image.loading='lazy';image.onerror=()=>image.remove();channel.append(image);}
  const copy=make('span','otv-full-guide-channel-copy');copy.append(make('small','',c.Number||'TV'),make('strong','',c.Name));channel.append(copy);row.append(channel);
  const track=make('div','otv-full-guide-track'),layout=guideScheduleLayout(programs,c.Id,start,start+GUIDE_SPAN),end=start+GUIDE_SPAN;
  const note=make('span','otv-guide-overlap-note');note.hidden=true;copy.append(note);const cells=new Map();
  track.style.height=Math.max(1,layout.laneCount)*76+'px';
  if(!layout.entries.length)track.append(link('▶ Watch '+c.Name+' live',playRoute(api,c.Id),'otv-guide-unavailable'));
  for(const entry of layout.entries){const p=entry.program,left=timeX(entry.start,start),width=timeX(entry.end,start)-left;
   const cell=link('',route(api,p.Id),'otv-full-guide-program');cell.dataset.programId=p.Id;cell.style.left=left+'%';cell.style.width=width+'%';cell.style.height='66px';cell.style.bottom='auto';cell.title=p.Name+' · '+clock(p.StartDate)+' – '+clock(p.EndDate);cell.append(make('strong','',p.Name),make('span','',clock(p.StartDate)+' – '+clock(p.EndDate)));cells.set(entry.index,cell);track.append(cell);
  }
  row.otvGuideReflow=()=>{if(!track.isConnected)return;const width=track.getBoundingClientRect().width;if(!width)return;const measured=guideScheduleLayout(programs,c.Id,start,end,GUIDE_SPAN*46/width);track.style.height=Math.max(1,measured.laneCount)*76+'px';const context=measured.temporalOverlap?'Overlapping schedule entries':measured.laneCount>1?'Short schedule entries shown separately':'';note.textContent=context;note.hidden=!context;row.classList.toggle('otv-guide-overlap',measured.temporalOverlap);for(const entry of measured.entries){const p=entry.program,cell=cells.get(entry.index);cell.style.top=(5+entry.lane*76)+'px';cell.setAttribute('aria-label',p.Name+' · '+c.Name+' · '+clock(p.StartDate)+' – '+clock(p.EndDate)+(context?' · '+context:''));}};
  const now=Date.now();if(now>=start&&now<=end){const marker=make('span','otv-now-marker');marker.style.left=timeX(now,start)+'%';marker.dataset.start=String(start);marker.setAttribute('aria-hidden','true');track.append(marker);}row.append(track);return row;
 }
 const guideLayoutObservers=new WeakMap();
 function observeGuideLayout(guide,body){guideLayoutObservers.get(guide)?.disconnect();const reflow=()=>{if(body.isConnected)body.querySelectorAll('.otv-full-guide-row').forEach(row=>row.otvGuideReflow?.());};reflow();const observer=new ResizeObserver(reflow);observer.observe(body);guideLayoutObservers.set(guide,observer);}
 function orderBySchedule(rows,programmes){const now=Date.now(),live=new Set(),any=new Set();for(const p of programmes||[]){any.add(p.ChannelId);if(Date.parse(p.StartDate)<=now&&Date.parse(p.EndDate)>now)live.add(p.ChannelId);}
  const rank=c=>live.has(c.Id)?0:any.has(c.Id)?1:2;return rows.map((c,i)=>[c,i]).sort((a,b)=>rank(a[0])-rank(b[0])||a[1]-b[1]).map(([c])=>{c.__noSchedule=rank(c)===2;return c;});}
 async function renderFullGuide(tab,api,user){
  if(!api||!user||!tab?.isConnected||!liveRoute('guide'))return;const pageRoute=location.hash,identity=sessionKey(api,user),phoneNow=phone()&&S.phoneGuideMode!=='grid',start=phoneNow?Math.floor(Date.now()/1800000)*1800000:guideStart(tab),serial=[user,start,S.guideGroup,S.guideQuery,S.guideLimit,phoneNow?'now:'+Math.floor(Date.now()/60000):'grid'].join('|');tab.dataset.otvGuideRequest=serial;
  let programmes;try{await load(api,user);if(location.hash!==pageRoute||tab.dataset.otvGuideRequest!==serial||!sessionCurrent(api,identity))return;programmes=await guidePrograms(api,user,start);}catch{if(location.hash===pageRoute&&sessionCurrent(api,identity)&&tab.dataset.otvGuideRequest===serial){if(window.OrbitalPageReady?.managed())void window.OrbitalPageReady.fail('Your guide could not finish loading. Please retry.');tab.querySelector('.otv-full-guide')?.remove();restoreNative(tab);loadingNote(tab,'Guide unavailable. The standard guide remains available below.');}return;}
  if(location.hash!==pageRoute||!tab.isConnected||tab.dataset.otvGuideRequest!==serial||!sessionCurrent(api,identity))return;
  const list=S.channels.filter(c=>matches(c,S.guideGroup,S.guideQuery)).sort((a,b)=>Number(a.Number)-Number(b.Number)),visible=orderBySchedule(list.slice(0,S.guideLimit),programmes),renderKey=[serial,S.guideGroup,S.guideQuery,S.guideLimit,programmeSignature(programmes)].join('|');
  let guide=$('.otv-full-guide',tab);if(!guide){guide=make('section','otv-full-guide orbital-personal');const native=$('.guideVerticalScroller,.programContainer',tab);if(native)native.before(guide);else tab.append(guide);}
  if(guide.dataset.renderKey===renderKey){guide.querySelectorAll('.otv-now-marker').forEach(n=>{n.style.left=timeX(Date.now(),Number(n.dataset.start))+'%';});isolateNative(tab);livePhase(guide,'complete',api,user,pageRoute,identity,()=>tab.dataset.otvGuideRequest===serial);return;}guide.dataset.renderKey=renderKey;
  if(phoneNow){guideLayoutObservers.get(guide)?.disconnect();guideLayoutObservers.delete(guide);guide.replaceChildren(window.OrbitalPhone.nowNext(visible,programmes,api));}else{
  const scroll=make('div','otv-full-guide-scroll'),body=make('div','otv-full-guide-body'),timeline=make('div','otv-full-guide-times');scroll.id='otv-guide-results';scroll.tabIndex=-1;scroll.setAttribute('aria-label','Channel guide results. Scroll horizontally for later times.');timeline.append(make('span','otv-full-guide-corner','Channel'));
  const ticks=make('div','otv-full-guide-ticks');for(let i=0;i<=6;i++){const tick=make('span','',clock(start+i*3600000));tick.style.left=timeX(start+i*3600000,start)+'%';ticks.append(tick);}timeline.append(ticks);const rowsOut=[];let divided=false;for(const c of visible){if(c.__noSchedule&&!divided&&rowsOut.length){divided=true;rowsOut.push(make('div','otv-guide-divider','Live channels without a schedule'));}rowsOut.push(guideChannel(c,programmes,api,start));}body.append(timeline,...rowsOut);scroll.append(body);guide.replaceChildren(scroll);observeGuideLayout(guide,body);
  }
  if(phone()){const modes=make('nav','of7-guide-modes');modes.setAttribute('aria-label','Guide view');for(const [mode,label] of [['now','Now / Next'],['grid','Full guide']]){const b=make('button','of7-action',label);b.type='button';b.setAttribute('aria-pressed',String((phoneNow?'now':'grid')===mode));b.onclick=async()=>{S.phoneGuideMode=mode;await renderFullGuide(tab,api,user);guide.querySelector('.of7-guide-modes [aria-pressed=true]')?.focus({preventScroll:true});};modes.append(b);}guide.prepend(modes);tab.classList.toggle('of7-guide-now',phoneNow);}

  if(visible.length<list.length){const more=make('button','otv-load-more','Load '+BATCH.guide+' more guide channels');more.type='button';more.onclick=async()=>{const from=S.guideLimit;S.guideLimit+=BATCH.guide;await renderFullGuide(tab,api,user);const rows=$(phoneNow?'.of7-now-next':'.otv-full-guide-body',tab)?.children;keepFocus(rows?.[from+(phoneNow?0:1)],$('.otv-load-more',tab),$('#otv-guide-results',tab));};guide.append(more);}
  if(!list.length)guide.append(make('p','otv-no-results','No channels match these filters.'));
  const mapped=new Set(programmes.map(p=>p.ChannelId)).size,counter=$('.otv-result-count',tab);if(counter)counter.textContent=(visible.length<list.length?'Showing '+visible.length+' of ':'')+list.length+' channels · '+mapped+' with schedules';
  isolateNative(tab);tab.querySelectorAll('.guide-headerTimeslots').forEach(n=>{n.hidden=true;n.inert=true;n.classList.add('orbital-native-hidden');});clearLoading(tab);if(!tab.dataset.usableMs)tab.dataset.usableMs=String(Math.round(performance.now()));tab.classList.add('otv-full-guide-ready');livePhase(guide,'complete',api,user,pageRoute,identity,()=>tab.dataset.otvGuideRequest===serial);window.OrbitalSettle?.end();
 }
 function enhanceGuide(tab,api,user){
  const header=$('.tvGuideHeader',tab);if(!header)return;heading(header,'Your TV guide','Every available channel stays visible, even when schedule data is missing.');
  if(!$('.otv-controls',header))$('.otv-heading',header).after(controls(tab,true));
  if(!header.dataset.otvGuideDates){header.dataset.otvGuideDates='1';header.addEventListener('click',event=>{if(event.target.closest('.guide-date-tab-button')){if(phone())S.phoneGuideMode='grid';S.guideLimit=BATCH.guide;setTimeout(()=>renderFullGuide(tab,api,user),120);}});}
  renderFullGuide(tab,api,user);
 }
 function enhancePrograms(tab){
   heading(tab,'Find something worth watching','Live programmes, films, and shows from your channel guide.');
   for(const card of tab.querySelectorAll('.card[data-channelid]')){
    if(card.dataset.otvDecorated)continue;const c=S.channels.find(x=>x.Id===card.dataset.channelid);card.dataset.otvDecorated='1';
    const box=$('.cardBox',card);if(box&&c){const label=make('div','otv-program-channel',c.Name.split(' [')[0]);label.title=c.Name;box.prepend(label);}
    const image=$('.cardImageContainer.defaultCardBackground,.defaultCardBackground .cardImageContainer',card),title=$('.cardText-first',card)?.textContent||c?.Name||'Live TV',event=programEvent(title)||programEvent(c?.CurrentProgram?.Name)||programEvent(c?.Name);
    const art=c?channelImage(c,window.ApiClient,640):window.ApiClient.getImageUrl(card.dataset.channelid,{type:'Primary',maxWidth:640,quality:88});
    if(image&&!image.style.backgroundImage){image.classList.add('otv-program-fallback');if(art){const channelArt=make('img','otv-program-channel-art');channelArt.src=art;channelArt.alt='';channelArt.loading='lazy';channelArt.onerror=()=>{channelArt.remove();if(!event&&!$('.otv-fallback-channel',image))image.append(make('span','otv-fallback-channel',c?.Name?.split(' [')[0]||title));};image.append(channelArt);}else if(!event)image.append(make('span','otv-fallback-channel',c?.Name?.split(' [')[0]||title));if(event)image.append(teamMarks(event));}
   }
  // Keep an alternate's programme when the native discovery list has no
  // primary copy. Only suppress actual duplicates within that section.
  for(const container of tab.querySelectorAll('.itemsContainer')){
   const seen=new Set();const cards=[...container.querySelectorAll('.card[data-channelid]')];
   cards.sort((a,b)=>Number(isSource(S.channels.find(c=>c.Id===a.dataset.channelid)||{}))-Number(isSource(S.channels.find(c=>c.Id===b.dataset.channelid)||{})));
   for(const card of cards){const c=S.channels.find(x=>x.Id===card.dataset.channelid);const parent=c&&isSource(c)?S.channels.find(p=>!isSource(p)&&c.Name.startsWith(p.Name.slice(0,170)+' [')):c;const key=(parent?.Id||card.dataset.channelid)+'|'+($('.cardText-first',card)?.textContent||card.dataset.id)+'|'+card.dataset.startdate;const duplicate=seen.has(key);card.classList.toggle('otv-duplicate-program',duplicate);seen.add(key);}
  }
 }
 const emptyInfo={
  recordingsTab:['Your recordings','Saved broadcasts, all in one place.','video_library','Nothing recorded yet','Recordings appear here once a broadcast has been saved. You can keep watching live without recording anything.','LiveTv/Recordings'],
  scheduleTab:['Recording schedule','See what is recording and what comes next.','event_note','Your schedule is clear','There are no upcoming recordings. Open the guide to explore what is airing.','LiveTv/Timers'],
  seriesTab:['Series recordings','Manage recurring recordings of your favourite shows.','repeat','No series recording rules','This page is for recurring TV recordings. Your on-demand series are still in your TV libraries.','LiveTv/SeriesTimers']
 };
 async function emptyState(tab,api,user){
  const info=emptyInfo[tab.id];heading(tab,info[0],info[1]);
  let state=S.empty.get(tab.id);if(state&&Date.now()-state.time<60000){show(state);return;}
  if(tab.dataset.otvChecking)return;tab.dataset.otvChecking='1';
  try{const r=await api.ajax({type:'GET',url:api.getUrl(info[5],{UserId:user,Limit:1}),dataType:'json'});
   if(S.user!==user||api.getCurrentUserId()!==user)return;
   state={time:Date.now(),empty:(r.TotalRecordCount??r.Items?.length??0)===0};S.empty.set(tab.id,state);show(state);
  }catch(error){let err=$('.otv-empty-error',tab);if(!err){err=make('p','otv-empty-error orbital-personal',error?.status===403?'Recording management is not available for this account. You can continue watching from Channels.':'This section could not be checked. Refresh to try again.');tab.append(err);}}
  finally{delete tab.dataset.otvChecking;}
  function show(value){
   tab.classList.toggle('otv-confirmed-empty',value.empty);
   $('.otv-empty-error',tab)?.remove();let box=$('.otv-empty',tab);
   if(!value.empty){box?.remove();return;}if(box)return;
   box=make('section','otv-empty orbital-personal');box.append(icon(info[2]),make('p','otv-eyebrow','READY WHEN YOU ARE'),make('h2','',info[3]),make('p','',info[4]));
   const actions=make('div','otv-empty-actions');actions.append(link('Explore the guide','#/livetv?tab=1','otv-primary'),link('Browse channels','#/livetv?tab=2'));box.append(actions);tab.append(box);
  }
 }
 const rankOf=team=>{const n=Number(team?.rank);return Number.isInteger(n)&&n>=1&&n<=25?n:0;};
 const rankedMatchup=event=>(event.teams||[]).length>=2&&event.teams.every(rankOf);
 // College recommended grouping: only source-backed classifications/ranks.
 const collegeTier=event=>rankedMatchup(event)?0:event.college_division==='division_i'?1:event.college_division==='division_ii_iii'?2:3;
 const collegeSections=(events,past)=>['Top matchups','Division I','Division II/III','Other college games'].map((label,tier)=>({title:label+(past?' · Not played / in progress':''),events:events.filter(e=>collegeTier(e)===tier).slice().sort((a,b)=>Number(b.state==='live')-Number(a.state==='live'))}));
 // End college recommended grouping.

 function sportsTeams(event){
  const group=make('div','otv-team-pair');
  for(const team of (event.teams||[]).slice().sort((a,b)=>Number(a.side==='home')-Number(b.side==='home'))){
   const row=make('div','otv-team-row'),art=window.OrbitalArtwork.team(event,team);
   const fallback=make('span','otv-team-monogram',art?.abbr||team.name.split(/\s+/).map(s=>s[0]).slice(0,3).join(''));row.append(fallback);
   if(window.OrbitalArtwork.url(art?.url)){const image=make('img','otv-team-logo');image.src=art.url;image.alt='';image.loading='lazy';image.onload=()=>fallback.hidden=true;image.onerror=()=>image.remove();row.prepend(image);}
   const label=make('span','otv-team-name',team.name);if(rankOf(team))label.prepend(make('span','otv-team-rank','#'+rankOf(team)));row.append(label);if(typeof team.record==='string'&&/^\d{1,3}(-\d{1,3}){1,2}$/.test(team.record))label.append(make('small','otv-team-record',team.record));const hasScore=(event.state==='live'||event.state==='final')&&team.score!=null&&String(team.score).trim()!=='';if(hasScore){const score=make('strong','otv-team-score',team.score);score.setAttribute('aria-label',team.name+' '+team.score);row.append(score);}group.append(row);
  }return group;
 }
 function renderProgramShelf(tab,api){
  if(!liveRoute('programs')||!sessionCurrent(api,S.identity))return;
  heading(tab,'Find something worth watching','Live programmes, films and sports from every mapped channel in your guide.');
  if(!$('.otv-controls',tab))$('.otv-heading',tab).after(controls(tab,false,()=>renderProgramShelf(tab,api)));
  const now=Date.now(),rows=S.channels.filter(c=>!isSource(c)&&c.CurrentProgram&&new Date(c.CurrentProgram.StartDate)<=now&&new Date(c.CurrentProgram.EndDate)>now&&matches(c,S.group,S.query));
  rows.sort((a,b)=>Number(Boolean(b.UserData?.IsFavorite))-Number(Boolean(a.UserData?.IsFavorite))||Number(category(a)!=='Sports')-Number(category(b)!=='Sports')||new Date(a.CurrentProgram.EndDate)-new Date(b.CurrentProgram.EndDate)||Number(a.Number)-Number(b.Number));
  let shelf=$('.otv-program-shelf',tab);if(!shelf){shelf=make('section','otv-program-shelf orbital-personal');tab.append(shelf);}
  const key=[S.fetched,S.group,S.query,S.programLimit,rows.length].join('|');if(shelf.dataset.renderKey===key){isolateNative(tab);tab.classList.add('otv-programs-ready');livePhase(shelf,'complete',api,S.user);return;}shelf.dataset.renderKey=key;
  const header=make('div','otv-program-shelf-header');header.append(make('h2','','On now'),make('p','otv-program-count',rows.length+(rows.length===1?' mapped channel':' mapped channels')));
  const grid=make('div','otv-channel-grid otv-program-grid');grid.id='otv-channel-results';grid.tabIndex=-1;grid.append(...rows.slice(0,S.programLimit).map(c=>channelCard(c,api)));shelf.replaceChildren(header,grid);
  if(S.programLimit<rows.length){const more=make('button','otv-load-more','Load '+BATCH.programs+' more programmes');more.type='button';more.onclick=()=>{S.programLimit+=BATCH.programs;renderProgramShelf(tab,api);};shelf.append(more);}
  if(!rows.length)shelf.append(make('p','otv-no-results','No current programmes match these filters. Browse Channels to tune any available station.'));
  isolateNative(tab);tab.classList.add('otv-programs-ready');livePhase(shelf,'complete',api,S.user);window.OrbitalSettle?.end();
 }
 // Geometry is illustrative. Only the explicitly marked live overlays carry game data.
 function sportsSurface(kind,g){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 380');svg.setAttribute('role','img');svg.setAttribute('aria-label',kind==='baseball'?g.bases.map((v,i)=>(i+1)+' base '+(v?'occupied':'empty')).join(', '):kind+' diagram; not player tracking');
  const uid='field'+Math.random().toString(36).slice(2);let shapes='';
  if(kind==='baseball'){
   shapes='<path d="M300 340 L55 95 Q300 -72 545 95 Z" fill="url(#'+uid+'grass)" stroke="#84b995" stroke-width="2"/><path d="M300 340 L182 222 A118 118 0 1 1 418 222 Z" fill="#a87b53"/><path d="M300 306 L384 222 L300 138 L216 222 Z" fill="url(#'+uid+'grass)"/><path d="M300 340 L55 95 M300 340 L545 95" fill="none" stroke="#ede6d5" stroke-width="2"/><circle cx="300" cy="225" r="18" fill="#bf9568"/><path d="M294 225h12" stroke="#f7eddd" stroke-width="3"/><path d="M294 334h12v6l-6 5-6-5Z" fill="#fff5df"/>';
   [[405,235],[300,130],[195,235]].forEach(([x,y],i)=>{shapes+='<rect class="otv-field-base" data-occupied="'+String(g.bases[i])+'" x="'+(x-7)+'" y="'+(y-7)+'" width="14" height="14" transform="rotate(45 '+x+' '+y+')" fill="'+(g.bases[i]?'#f4c46f':'#f4efe4')+'" stroke="'+(g.bases[i]?'#fff4c8':'#765c43')+'" stroke-width="2"/>';if(g.bases[i])shapes+='<circle cx="'+x+'" cy="'+y+'" r="20" fill="none" stroke="#f4c46f" stroke-width="3"/>';});
  }else if(kind==='football'){
   shapes='<rect x="28" y="42" width="544" height="296" rx="6" fill="url(#'+uid+'grass)" stroke="#e2e9dd" stroke-width="2"/><path d="M72 42v296M528 42v296" stroke="#e2e9dd" stroke-width="2"/>';
   for(let i=1;i<10;i++){const x=72+i*45.6;shapes+='<path d="M'+x+' 42v296" stroke="#dce8d8" opacity=".65"/><text x="'+x+'" y="76" text-anchor="middle" fill="#e8eee2" font-family="system-ui" font-size="16">'+(i<=5?i*10:(10-i)*10)+'</text>';}
   for(let i=1;i<50;i++){const x=72+i*9.12;shapes+='<path d="M'+x+' 150v8M'+x+' 222v8" stroke="#c9dfc8"/>';}
  }else if(kind==='basketball'){
   shapes='<rect x="28" y="38" width="544" height="304" rx="5" fill="url(#'+uid+'wood)" stroke="#ead6b6" stroke-width="3"/><path d="M300 38v304" stroke="#ead6b6" stroke-width="2"/><circle cx="300" cy="190" r="43" fill="none" stroke="#ead6b6" stroke-width="2"/><g fill="#304d54" stroke="#ead6b6" stroke-width="2"><path d="M28 125h105v130H28Z"/><path d="M572 125H467v130h105Z"/></g><g fill="none" stroke="#ead6b6" stroke-width="2"><circle cx="133" cy="190" r="38"/><circle cx="467" cy="190" r="38"/><path d="M28 70h32a120 120 0 0 1 0 240H28 M572 70h-32a120 120 0 0 0 0 240h32"/><path d="M52 171v38M548 171v38"/><circle cx="60" cy="190" r="8"/><circle cx="540" cy="190" r="8"/></g>';
  }else{
   shapes='<polygon points="212,25 388,25 465,102 465,278 388,355 212,355 135,278 135,102" fill="#101d2a" stroke="#678193" stroke-width="8"/><polygon points="220,46 380,46 444,110 444,270 380,334 220,334 156,270 156,110" fill="#405766" stroke="#a7bdc6" stroke-width="2"/><circle cx="300" cy="190" r="57" fill="none" stroke="#becfd1" opacity=".25" stroke-width="2"/><path d="M212 25L220 46M388 25L380 46M465 102L444 110M465 278L444 270M388 355L380 334M212 355L220 334M135 278L156 270M135 102L156 110" stroke="#d7e4e8" stroke-width="4"/>';
  }
  // Only constant geometry and validated booleans enter SVG markup; source text uses textContent.
  svg.innerHTML='<defs><pattern id="'+uid+'grass" width="56" height="56" patternUnits="userSpaceOnUse"><rect width="56" height="56" fill="#245943"/><rect width="28" height="56" fill="#2c654b"/></pattern><pattern id="'+uid+'wood" width="36" height="14" patternUnits="userSpaceOnUse"><rect width="36" height="14" fill="#a2774d"/><path d="M0 14h36M0 0v14" stroke="#815b3b" stroke-width=".7"/></pattern></defs>'+shapes;return svg;
 }
 function gameVisualization(data){
  const box=make('section','otv-game-context');box.setAttribute('aria-label','Game information');
  const meta=make('div','otv-game-meta');if(data.venue)meta.append(make('span','',data.venue));meta.append(make('span','otv-game-updated','Updated '+new Date(data.fetched_at*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+(data.stale?' · Saved data':'')));box.append(meta);
  if(data.broadcasts?.length)box.append(make('p','otv-game-broadcasts',data.broadcasts.join(' · ')));
  const layout=make('div','otv-context-layout'),insight=make('div','otv-game-insight'),g=data.graphics;
  if(g&&!data.stale&&data.state==='live'){
   const graphic=make('figure','otv-game-graphic otv-graphic-'+g.kind+(g.kind==='baseball'?'':' otv-numbers-only'));if(g.kind==='baseball')graphic.append(sportsSurface(g.kind,g));const caption=make('figcaption','otv-field-captionline');
   const metric=(label,value)=>{const n=make('div','otv-game-metric');n.append(make('span','',label),make('strong','',String(value)));return n;};
   if(g.kind==='baseball'){caption.append(metric('Balls',g.balls),metric('Strikes',g.strikes),metric('Outs',g.outs));graphic.append(caption,make('p','otv-field-legend','Gold ring · occupied base'));}
   if(g.kind==='football')caption.append(metric('Down',g.down),metric('To go',g.distance),metric('Ball spot',g.spot));
   if(g.kind==='basketball')caption.append(metric('Period',g.period),metric('Clock',g.clock));
   if(g.kind==='mma')caption.append(metric('Round',g.period),metric('Clock',g.clock));
   if(g.kind!=='baseball')graphic.append(caption);
   layout.append(graphic);
  }
  /* Sept 26: situation card: label + clock pill, then the headline situation (football: down & distance, ball spot). */
  const panel=make('section','otv-insight-panel otv-situation-card');panel.dataset.kind=g?.kind||'';const head=make('div','otv-situation-head');const clockText=String(data.status||'Status unavailable').replace(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/,'$2 · $1');head.append(make('h3','otv-panel-label',g?.kind==='baseball'?'At the plate':'Game situation'),make('span','otv-situation otv-situation-clock',clockText));panel.append(head);const ordinal=n=>{n=Number(n);return n>0?n+(['th','st','nd','rd'][(n%100-20)%10]||['th','st','nd','rd'][n%100]||'th'):'';};if(g?.kind==='football'&&!data.stale&&(g.down||g.spot)){const big=make('div','otv-situation-big');big.append(make('strong','otv-situation-down',g.down?ordinal(g.down)+' & '+(Number(g.distance)===0?'Goal':g.distance??'—'):'Kickoff'));if(g.spot)big.append(make('span','otv-situation-spot','at '+g.spot));panel.append(big);}
  if(data.stale)panel.append(make('p','','Saved information · live position unavailable'));
  else if(!g)panel.append(make('p','otv-situation-note',data.state==='final'?'This game has finished.':data.state==='live'?'Live field information is unavailable.':'Live information appears when the game starts.'));
  for(const person of data.participants||[]){const row=make('div','otv-participant otv-person');if(typeof person.headshot==='string'&&person.headshot.startsWith('https://a.espncdn.com/i/headshots/')){const img=make('img','otv-person-shot');img.src=person.headshot;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();row.append(img);}const text=make('div','otv-person-text');text.append(make('span','otv-person-role',person.role==='Batter'?'At bat':person.role==='Pitcher'?'Pitching':person.role),make('strong','',person.name));const meta=[person.jersey?'#'+person.jersey:null,person.position].filter(Boolean).join(' · ');if(meta)text.append(make('small','',meta));if(person.today)text.append(make('small','otv-person-today','Today: '+person.today));row.append(text);panel.append(row);}
  if(g?.kind==='mma'&&g.fighters?.length)panel.append(make('p','',g.fighters.filter(Boolean).join(' vs ')));
  if(g?.kind==='football'&&g.description&&!panel.querySelector('.otv-situation-big'))panel.append(make('p','otv-situation-sub',g.description));
  insight.append(panel);if(data.last_play){const last=make('section','otv-insight-panel otv-last-play');last.append(make('h3','otv-panel-label','Last play'),make('p','',data.last_play));insight.append(last);}layout.append(insight);box.append(layout);
  // Competitor values may be season aggregates; only explicit game linescores belong here.
  const statistics=['live','final'].includes(data.state)?(data.statistics||[]).filter(r=>r.periods?.length):[];
  if(statistics.length){const label=g?.kind==='baseball'?'Score by inning':'Score by period',wrap=make('div','otv-score-table-wrap'),table=make('table','otv-score-table'),caption=make('caption','',label);table.append(caption);const head=make('thead'),hr=make('tr');hr.append(make('th','','Team'));const nperiod=Math.max(...statistics.map(r=>r.periods.length));for(let i=0;i<nperiod;i++)hr.append(make('th','',String(i+1)));hr.append(make('th','otv-total','Total'));head.append(hr);table.append(head);const body=make('tbody');for(const row of statistics){const tr=make('tr'),name=make('th','',row.name);name.scope='row';tr.append(name);for(let i=0;i<nperiod;i++)tr.append(make('td','',row.periods?.[i]??'—'));const total=row.periods.every(v=>v!==null&&v!==''&&Number.isFinite(Number(v)))?row.periods.reduce((a,v)=>a+Number(v),0):'—';tr.append(make('td','otv-total',String(total)));body.append(tr);}table.append(body);wrap.tabIndex=0;wrap.setAttribute('aria-label',label+'. Scroll for more columns.');wrap.append(table);box.append(wrap);}
  if(data.bouts?.length){const list=make('div','otv-fight-card');list.append(make('h3','otv-panel-label','Fight card'));for(const bout of data.bouts){const row=make('article','otv-bout');row.append(make('strong','',bout.fighters.map(f=>f.name+(f.winner?' · Winner':'')).join(' vs ')),make('span','',bout.status||'Status unavailable'));list.append(row);}box.append(list);}
  return box;
 }

 const teamTone=t=>{const ok=c=>/^#[0-9a-f]{6}$/i.test(String(c||''))?c:null,lum=c=>{const n=parseInt(c.slice(1),16);return (0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))/255;};const a=ok(t?.color),b=ok(t?.alt_color);const lift=c=>{let n=parseInt(c.slice(1),16),r=n>>16&255,g=n>>8&255,bl=n&255;for(let k=0;k<8&&(0.299*r+0.587*g+0.114*bl)/255<.3;k++){r+=(255-r)*.25;g+=(255-g)*.25;bl+=(255-bl)*.25;}return '#'+[r,g,bl].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');};return a&&lum(a)>.22?a:b&&lum(b)>.22?b:a?lift(a):null;};
 // Page trackers always read latest official reports, independently of video.
  /* Oct 5 drive chart. Every drive is one short bar on a shared field: the away team attacks right,
     the home team left. Rows are grouped by the quarter the drive began in; the selected drive's
     plays show beside the chart (wide screens) or under its row (narrow). Spots are the reported
     start/end in the possession-attacks-right frame, mirrored for the home team. */
  const DRIVE_TAG={'touchdown':'TD','field goal':'FG','missed fg':'Missed FG','missed field goal':'Missed FG','blocked fg':'Blocked FG','punt':'Punt','blocked punt':'Blocked punt','interception':'INT','fumble':'Fumble','downs':'Downs','turnover on downs':'Downs','end of half':'Half','end of game':'End','end of 4th quarter':'End','safety':'Safety'};
  const driveTag=r=>{const k=String(r||'').toLowerCase().replace(/\s+td$/,'');return DRIVE_TAG[k]||(/touchdown/.test(k)?'TD':String(r||'Drive').slice(0,12));};
  const driveTone=d=>d.scoring?'score':/fumble|interception|downs|safety|blocked|missed/i.test(d.result||'')?'loss':'';
  function renderDriveChart(pane,d,dialog){
   const away=(d.teams||[]).find(t=>t.side==='away'),home=(d.teams||[]).find(t=>t.side==='home'),teamOf=id=>(d.teams||[]).find(t=>String(t.id)===String(id));
   const wide=!!dialog&&dialog.getBoundingClientRect().width>=760,drives=d.drives.slice();
   const root=make('div','odc'+(wide?' is-wide':''));const chart=make('div','odc-chart'),detail=make('section','odc-detail');detail.setAttribute('aria-live','polite');
   const zone=(t,side)=>{const z=make('span','odc-zone is-'+side,t?.abbreviation||'');z.style.setProperty('--team',teamTone(t)||'#2b3f55');return z;};
   const head=make('div','odc-row odc-head');head.setAttribute('aria-hidden','true');const scale=make('span','odc-track odc-scale');for(const n of ['10','20','30','40','50','40','30','20','10'])scale.append(make('i','',n));head.append(make('span','odc-team'),zone(away,'left'),scale,zone(home,'right'),make('span','odc-tag'));chart.append(head);
   const pct=v=>(Math.min(1,Math.max(0,v))*100).toFixed(2)+'%';let period=null;const selected=pane.__driveSelected,buttons=[];
   const show=(drive,btn)=>{pane.__driveSelected=drive.id;for(const b of buttons)b.setAttribute('aria-pressed',String(b===btn));const team=teamOf(drive.team_id);detail.replaceChildren();
    const h=make('div','odc-detail-head');const chip=make('span','odc-chip',team?.abbreviation||'');chip.style.setProperty('--team',teamTone(team)||'#2b3f55');h.append(chip,make('strong','',drive.result||'Drive'));if(drive.scoring&&drive.away!=null)h.append(make('span','odc-detail-score',(away?.abbreviation||'')+' '+drive.away+'–'+drive.home+' '+(home?.abbreviation||'')));detail.append(h,make('p','odc-detail-sub',drive.description||''));
    const plays=drive.play_details||[];if(!plays.length)detail.append(make('p','otv-gc-empty','Individual plays are not available for this drive.'));
    else{const ol=make('ol','odc-plays');for(const p of plays){const li=make('li','');const yd=Number(p.yards);li.append(make('span','odc-dd',p.down_distance||p.type||''),make('span','odc-yd'+(yd>0?' is-gain':yd<0?' is-loss':''),Number.isFinite(yd)&&p.type!=='Kickoff'&&p.down_distance?(yd>0?'+':'')+yd:''),make('span','odc-text',String(p.text||p.type||'Play')));ol.append(li);}detail.append(ol);}
    if(!wide)btn.after(detail);};
   drives.forEach(drive=>{const q=drive.play_details?.[0]?.period;if(q&&q!==period){period=q;chart.append(make('div','odc-period',q>4?'Overtime':['','1st','2nd','3rd','4th'][q]+' quarter'));}
    const team=teamOf(drive.team_id),isHome=team?.side==='home',X=v=>isHome?1-v:v,sx=Number(drive.start_x),ex=Number(drive.end_x),ok=Number.isFinite(sx)&&Number.isFinite(ex),a=ok?X(sx):0,b=ok?X(ex):0,tone=driveTone(drive);
    const btn=make('button','odc-row odc-drive'+(tone?' is-'+tone:''));btn.type='button';btn.dataset.driveId=drive.id;btn.setAttribute('aria-pressed','false');btn.style.setProperty('--team',teamTone(team)||'#9fe3c1');
    btn.setAttribute('aria-label',(team?.name||team?.abbreviation||'Drive')+': '+(drive.result||'drive')+', '+(drive.description||'')+(drive.scoring&&drive.away!=null?', score '+drive.away+' to '+drive.home:''));
    const track=make('span','odc-track');if(ok){const run=make('span','odc-run');run.style.left=pct(Math.min(a,b));run.style.width='max(3px,'+pct(Math.abs(b-a))+')';const end=make('span','odc-end');end.style.left=pct(b);track.append(run,end);}
    btn.append(make('span','odc-team',team?.abbreviation||''),make('span','odc-zone-gap'),track,make('span','odc-zone-gap'),make('span','odc-tag',driveTag(drive.result)+(drive.scoring&&drive.away!=null?' · '+drive.away+'–'+drive.home:'')));
    btn.onclick=()=>{if(!wide&&btn.getAttribute('aria-pressed')==='true'){btn.setAttribute('aria-pressed','false');detail.remove();pane.__driveSelected=null;return;}show(drive,btn);};
    btn.onkeydown=e=>{const k=buttons.indexOf(btn),n=e.key==='ArrowDown'?k+1:e.key==='ArrowUp'?k-1:-1;if(n>=0&&n<buttons.length){e.preventDefault();buttons[n].focus();if(wide)buttons[n].click();}};
    buttons.push(btn);chart.append(btn);});
   const legend=make('p','odc-legend');legend.append(make('strong','',(away?.abbreviation||'Away')+' →'),document.createTextNode(' attacks right · '),make('strong','','← '+(home?.abbreviation||'Home')),document.createTextNode(' attacks left · '),make('span','odc-dot is-score'),document.createTextNode(' score · '),make('span','odc-dot is-loss'),document.createTextNode(' turnover or missed kick'));
   root.append(chart);if(wide)root.append(detail);pane.append(legend,root);
   const pick=buttons.find(b=>b.dataset.driveId===String(selected))||(wide?buttons.at(-1):null);if(pick)pick.click();
  }
 async function fillPlays(pane,event){if(pane.dataset.loading)return;pane.dataset.loading='1';const dialog=pane.closest('dialog'),scroll=dialog?.scrollTop||0,signature=pane.dataset.playsSignature;if(!pane.childElementCount)pane.append(make('p','otv-gc-empty','Loading plays…'));
  try{if(event.league==='MLB'&&window.OrbitalGameCenterPlus&&(event.state==='live'||event.state==='final')){const keep=dialog?.scrollTop;try{if(await window.OrbitalGameCenterPlus.innings(pane,event,window.ApiClient)){if(dialog&&keep!=null)dialog.scrollTop=keep;return;}}catch{}}const d=await window.TelevisionTrackers?.fetchTracker(event);const rows=[];if(d?.recent?.length)for(const r of d.recent.slice().reverse())rows.push([r.inning||'',r.text,(r.away!=null&&r.home!=null)?r.away+'–'+r.home:'']);else if(d?.drives?.length)for(const r of d.drives.slice().reverse()){const team=(d.teams||[]).find(t=>t.id===r.team_id);rows.push([team?.abbreviation||'',(r.result||'Drive')+(r.description?' · '+r.description:''),r.scoring&&r.away!=null&&r.home!=null?((d.teams||[]).find(t=>t.side==='away')?.abbreviation||'')+' '+r.away+'–'+r.home+' '+((d.teams||[]).find(t=>t.side==='home')?.abbreviation||''):'',window.TelevisionTrackers?.driveSpan(d,r)?{drive:r}:null,{color:teamTone(team),scoring:!!r.scoring}])}else for(const p of (d?.plays||[]).slice().reverse())rows.push([p.clock||p.down_distance||'',p.text||p.type||'Play','']);
   const nextSignature=JSON.stringify([rows,d?.plays?.at(-1)?.id]);if(nextSignature===signature)return;if(signature&&dialog&&scroll>pane.offsetTop+120&&!pane.__showNew){let notice=pane.querySelector('.otv-new-plays');if(!notice){notice=make('button','otv-category otv-new-plays','New plays available · Show latest');notice.type='button';notice.onclick=()=>{pane.__showNew=true;fillPlays(pane,event);};pane.prepend(notice);}return;}const showNew=pane.__showNew;pane.__showNew=false;pane.dataset.playsSignature=nextSignature;pane.replaceChildren();if(d?.drives?.length&&d.kind==='football'){renderDriveChart(pane,d,dialog);if(dialog)dialog.scrollTop=showNew?pane.offsetTop:scroll;return;}pane.append(make('p','otv-gc-note','Latest first · '+rows.length+' reported entries available from the feed.'));if(!rows.length){pane.append(make('p','otv-gc-empty','No plays reported yet.'));return;}const list=make('ol','otv-gc-plays');for(const [a,b,c,f,m] of rows){const li=make('li','');if(m?.color)li.style.setProperty('--team',m.color);if(m?.scoring)li.classList.add('is-scoring');const body=make('span','otv-gc-play-text',b);if(f){const field=window.TelevisionTrackers?.driveField(d,f.drive);if(field){field.style.cssText='display:block;width:100%;height:auto;max-height:60px;margin-top:8px';body.append(field);li.classList.add('otv-drive');}}li.append(make('span','otv-gc-play-when',a),body,make('span','otv-gc-play-score',c));list.append(li);}if(rows.some(r=>r[3])){const key=make('p','otv-gc-note','Each field uses the reported start and end spots · offense attacks right · select a drive for every play.');pane.append(key);}if(dialog?.classList.contains('otv-desktop-sports')&&d?.drives?.length){const drives=d.drives.slice().reverse();[...list.children].forEach((li,i)=>{const drive=drives[i];if(!drive)return;li.classList.add('otv-drive');const button=make('button','otv-drive-select');button.type='button';button.setAttribute('aria-expanded','false');button.title='Show every play in this drive';button.append(...li.childNodes,make('span','otv-drive-open','›'));li.append(button);button.onclick=()=>{pane.__expandedDrives??=new Set();const existing=li.querySelector('.otv-drive-detail');if(existing){pane.__expandedDrives.delete(drive.id);existing.remove();button.setAttribute('aria-expanded','false');return;}pane.__expandedDrives.add(drive.id);button.setAttribute('aria-expanded','true');const detail=make('div','otv-drive-detail');const plays=drive.play_details||(drive.id===d.summary?.drive_id?d.plays:[]);if(!plays?.length)detail.append(make('p','otv-gc-empty','Individual plays are not available for this drive.'));else{const view={...d,state:'final',situation:null,field:{...d.field,ball_x:null},plays,summary:{team_id:drive.team_id,description:drive.description},tracking_available:plays.some(p=>typeof p.start_x==='number'),calibration:{...d.calibration,note:'Each arrow is a reported play · offense moves right'}};detail.append(window.TelevisionTrackers.render(view,{desktop:true}));}li.append(detail);};if(pane.__expandedDrives?.has(drive.id))button.click();});}pane.append(list);if(dialog)dialog.scrollTop=showNew?pane.offsetTop:scroll;}
  catch{if(!pane.childElementCount)pane.replaceChildren(make('p','otv-gc-empty','Plays are temporarily unavailable.'));}finally{delete pane.dataset.loading;}}
/* Pregame preview in the game center (Sept 24, 2026). Before first pitch/puck/kickoff the Live
 * tab shows real ESPN context from /sports/api/preview instead of "Tracking unavailable":
 * venue + photo + weather, ESPN Matchup Predictor, probable starters, form (last five),
 * series, season leaders, injuries and news about the two teams. Missing parts are omitted. */
 function pregame(slot,event,api){
  const dialog=slot.closest('dialog');if(!dialog)return;
  let box=dialog.__otvPregame;
  const layout=slot.querySelector('.otv-context-layout')||slot;
  if(box){layout.prepend(box);return;}
  box=make('section','otv-pregame');box.setAttribute('aria-busy','true');dialog.__otvPregame=box;dialog.classList.add('otv-pregame-mode');
  const skel=make('div','otv-pregame-skeleton');for(let i=0;i<4;i++)skel.append(make('div','otv-pregame-bar'));box.append(make('h3','otv-panel-label','Before the game'),skel);
  layout.prepend(box);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.start));
  api.ajax({type:'GET',url:api.getUrl('sports/api/preview',{league:event.league,event:event.id,date}),dataType:'json'}).then(p=>{
   if(!box.isConnected&&!dialog.isConnected)return;box.replaceChildren();box.removeAttribute('aria-busy');
   const teams={};for(const t of p.teams||[])teams[t.side]=t;
   const name=side=>teams[side]?.short||teams[side]?.name||side;
   /* A team colour too dark to read on the panel falls back to its alternate colour. */
   const lum=h=>{const n=parseInt(h,16);return (0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))/255;};
   const visible=t=>[t?.color,t?.alt].find(h=>h&&/^[0-9a-f]{6}$/i.test(h)&&lum(h)>0.16)?.replace(/^/,'#')||null;
   const img=(src,cls,alt)=>{const i=make('img',cls);i.src=src;i.alt=alt||'';i.loading='lazy';i.onerror=()=>i.remove();return i;};
   const section=(title)=>{const s=make('div','otv-pregame-block');s.append(make('h4','otv-pregame-title',title));box.append(s);return s;};
   /* Hero: venue photo, time, broadcast, weather. */
   const hero=make('div','otv-pregame-hero');if(p.venue?.image){hero.style.backgroundImage='linear-gradient(90deg,rgba(8,14,22,.92) 30%,rgba(8,14,22,.35)),url("'+p.venue.image+'")';}
   const when=new Date(event.start).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'});
   hero.append(make('p','otv-pregame-kicker','Starts '+when+(p.broadcasts?.length?' · '+p.broadcasts.join(', '):'')));
   if(p.venue)hero.append(make('p','otv-pregame-venue',p.venue.name+(p.venue.city?' · '+p.venue.city:'')));
   const weather=window.OrbitalWeatherText?.(p.weather);if(weather)hero.append(make('p','otv-pregame-weather',weather));
   if(p.series?.summary)hero.append(make('p','otv-pregame-series',p.series.summary));
   box.append(hero);
   /* ESPN Matchup Predictor (ESPN projection, not odds). */
   if(p.predictor){const s=section(p.predictor.label);const bar=make('div','otv-pregame-predictor');
    for(const side of ['away','home']){const pct=p.predictor[side];const seg=make('div','otv-pregame-seg');seg.style.flex=String(Math.max(pct,4));const col=visible(teams[side]);if(col)seg.style.background=col;seg.append(make('span','',name(side)+' '+pct+'%'));bar.append(seg);}
    s.append(bar);}
   /* Probable starters. */
   if(p.starters?.length){const s=section(p.starters[0].role==='Probable pitcher'?'Probable pitchers':'Probable starters');const row=make('div','otv-pregame-people');
    for(const st of p.starters){const c=make('div','otv-person');if(st.headshot)c.append(img(st.headshot,'otv-person-shot',st.name));const t=make('div','otv-person-text');t.append(make('span','otv-person-role',name(st.side)),make('strong','',st.name));if(st.line)t.append(make('span','otv-person-line',st.line));c.append(t);row.append(c);}
    s.append(row);}
   /* Form: record + last five. */
   if(p.teams?.length){const s=section('Form');const grid=make('div','otv-pregame-form');
    for(const t of p.teams){const r=make('div','otv-pregame-team');if(t.logo)r.append(img(t.logo,'otv-pregame-logo'));const txt=make('div','');txt.append(make('strong','',t.short||t.name));const rec=[t.record,t.split&&(t.side==='home'?'home ':'road ')+t.split].filter(Boolean).join(' · ');if(rec)txt.append(make('span','otv-pregame-muted',rec));r.append(txt);
     const five=(p.last_five||[]).find(x=>x.side===t.side);if(five){const chips=make('div','otv-pregame-five');for(const g of five.games){const c=make('span','otv-pregame-result is-'+String(g.result).toLowerCase(),g.result);c.title=(g.at==='@'?'at ':'vs ')+(g.opponent||'')+' '+(g.score||'');chips.append(c);}r.append(chips);}
     grid.append(r);}
    s.append(grid);}
   /* Season leaders. */
   if(p.leaders?.length){const s=section('Season leaders');const cols=make('div','otv-pregame-cols');
    for(const team of p.leaders){const col=make('div','');col.append(make('p','otv-pregame-muted',name(team.side)));for(const r of team.rows){const line=make('p','otv-pregame-leader');line.append(make('span','otv-pregame-muted',r.category+' '),make('strong','',r.name+' '),document.createTextNode(r.value));col.append(line);}cols.append(col);}
    s.append(cols);}
   /* Injuries. */
   if(p.injuries?.length){const s=section('Injuries');const cols=make('div','otv-pregame-cols');
    for(const team of p.injuries){const col=make('div','');col.append(make('p','otv-pregame-muted',name(team.side)));for(const r of team.rows)col.append(make('p','otv-pregame-leader',r.name+' · '+[r.status,r.detail].filter(Boolean).join(', ')));cols.append(col);}
    s.append(cols);}
   /* News about these teams. */
   if(p.news?.length){const s=section('News');const list=make('div','otv-pregame-news');
    for(const n of p.news){const a=make('article','otv-pregame-story');if(n.image)a.append(img(n.image,'otv-pregame-story-img'));const t=make('div','');t.append(make('strong','',n.headline));if(n.description)t.append(make('p','otv-pregame-muted',n.description));a.append(t);list.append(a);}
    s.append(list);}
   box.append(make('p','otv-tracker-calibration','Pregame information from ESPN. The live tracker starts with the game.'));const side=dialog.querySelector('.otv-gc-watch');if(side&&!side.querySelector('.otv-pregame-countdown')){const card=make('section','otv-pregame-countdown');const start=new Date(event.start);const left=()=>{const ms=start-Date.now();if(ms<=0)return 'Starting now';const d=Math.floor(ms/864e5),h=Math.floor(ms%864e5/36e5),m=Math.floor(ms%36e5/6e4);return 'Starts in '+(d?d+' d '+h+' h':h?h+' h '+m+' min':m+' min');};const big=make('strong','',left());card.append(make('h3','otv-panel-label','Coming up'),big,make('p','',start.toLocaleString([], {weekday:'long',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})));if(p.broadcasts?.length)card.append(make('p','otv-pregame-networks',p.broadcasts.join(' · ')));if(p.predictor){const fav=p.predictor.home>=p.predictor.away?'home':'away';card.append(make('p','otv-pregame-muted','ESPN projection: '+name(fav)+' '+p.predictor[fav]+'%'));}side.prepend(card);const tick=setInterval(()=>{if(!card.isConnected)return clearInterval(tick);big.textContent=left();},30000);}
  }).catch(()=>{delete dialog.__otvPregame;box.replaceChildren(make('h3','otv-panel-label','Before the game'),make('p','otv-pregame-muted','Starts '+new Date(event.start).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'})+'. The live tracker starts with the game.'));box.removeAttribute('aria-busy');});
 }
 const gameContextCache=new Map();
 // Actor artwork reuses existing same-game enrichment. This getter never fetches.
 function retainedActorMetadata(api,event,now=Date.now()){
  if(window.ApiClient!==api||event?.league!=='MLB'||event.stale===true||typeof event.id!=='string'||!/^\d{1,12}$/.test(event.id)||!Number.isFinite(Date.parse(event.start)))return null;
  const credential=api.accessToken?.(),server=api.serverId?.(),user=api.getCurrentUserId?.();
  if(!credential||!server||!user)return null;
  const key=[server,user,event.league,event.id,event.start].join('|'),entry=gameContextCache.get(key),data=entry?.data;
  if(!entry||entry.credential!==credential||!Number.isFinite(entry.at)||!Number.isFinite(now)||now<entry.at||now-entry.at>=30000||data?.stale===true||String(data?.id)!==event.id||data?.league!==event.league||Date.parse(data?.start)!==Date.parse(event.start)||!Array.isArray(data.participants)||data.participants.length>256)return null;
  return {event_id:event.id,league:event.league,start:event.start,participants:data.participants.map(p=>({id:typeof p?.id==='string'?p.id:null,name:typeof p?.name==='string'?p.name:'',headshot:typeof p?.headshot==='string'?p.headshot:''}))};
 }
 // An acquired portrait identity is immutable enrichment, not a live-game receipt.
 // Existing owner lifecycle supplies invalidation; this helper adds no listener/timer.
 function retainActorMetadata({api,event,owns}={}){
  if(window.ApiClient!==api||event?.league!=='MLB'||typeof owns!=='function')return null;
  const scope={server:api.serverId?.(),user:api.getCurrentUserId?.(),credential:api.accessToken?.(),id:String(event.id||''),league:event.league,start:event.start,route:window.location?.hash};
  if(!scope.server||!scope.user||!scope.credential||!/^\d{1,12}$/.test(scope.id)||!Number.isFinite(Date.parse(scope.start))||!/^#\/video(?:[?&]|$)/.test(scope.route||''))return null;
  let snapshot=null,retired=false;
  const dispose=()=>{retired=true;snapshot=null;};
  const current=()=>!retired&&window.ApiClient===api&&api.serverId?.()===scope.server&&api.getCurrentUserId?.()===scope.user&&api.accessToken?.()===scope.credential&&window.location?.hash===scope.route&&String(event.id||'')===scope.id&&event.league===scope.league&&event.start===scope.start&&owns()===true;
  function get(model){
   let valid=false;try{valid=current()&&model?.kind==='baseball'&&model.league===scope.league&&model.event_id===scope.id;}catch{}
   if(!valid){dispose();return null;}
   let fresh=null;try{fresh=retainedActorMetadata(api,event);}catch{}
   if(fresh&&fresh.event_id===scope.id&&fresh.league===scope.league&&fresh.start===scope.start){
    const participants=Object.freeze(fresh.participants.map(p=>Object.freeze({...p})));
    snapshot=Object.freeze({...fresh,participants});
   }
   return snapshot;
  }
  return Object.freeze({get,dispose});
 }
 window.OrbitalRetainedActorMetadata=Object.freeze({get:retainedActorMetadata,retain:retainActorMetadata});
 function loadGameContext(dialog,event,api){
  const contextKey=[api.serverId(),api.getCurrentUserId(),event.league,event.id].join('|');const saved=gameContextCache.get(contextKey),cached=saved&&Date.now()-saved.at<30000?saved.data:null;
  const slot=make('div','otv-game-context-slot');slot.dataset.contextLoading=String(!cached);if(cached){slot.append(gameVisualization(cached));const table=slot.querySelector('.otv-score-table-wrap');if(table)dialog.querySelector('.otv-gc-pane-box')?.replaceChildren(table);}else slot.append(make('p','otv-context-loading','Loading game information…'));(dialog.querySelector('.otv-gc-pane-live')||dialog.querySelector('.otv-gc-situation')||dialog).append(slot);if(event.state==='live')window.TelevisionTrackers?.mountGame(slot,event);const user=api.getCurrentUserId();let timer,pending=false,pollState=event.state;const initialDeadline=setTimeout(()=>{if(slot.dataset.contextLoading==='true'&&dialog.isConnected&&api.getCurrentUserId()===user){delete slot.dataset.contextLoading;const message=slot.querySelector('.otv-context-loading');if(message)message.textContent='Game details delayed · tracker updates continue';window.TelevisionTrackers?.mountGame(slot,event);}},4000);dialog.addEventListener('close',()=>clearTimeout(initialDeadline),{once:true});
  const load=async()=>{if(pending)return;pending=true;try{const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.start));const raw=await api.ajax({type:'GET',url:api.getUrl('sports/api/game/'+event.id+'/state',{league:event.league,date}),dataType:'json'});if(!dialog.isConnected||api.getCurrentUserId()!==user)return;const data=window.TelevisionFeedUi.withFreshness(raw,raw);if(!dialog.isConnected||api.getCurrentUserId()!==user)return;/* Linescore rows in header order (away first). */if(Array.isArray(data.statistics)){const away=(event.teams||[]).find(t=>t.side==='away')?.name;if(away)data.statistics.sort((a,b)=>Number(b.name===away)-Number(a.name===away));}delete slot.dataset.contextLoading;gameContextCache.set(contextKey,{at:Date.now(),data});while(gameContextCache.size>6)gameContextCache.delete(gameContextCache.keys().next().value);pollState=data.state;const records=Object.fromEntries((event.teams||[]).map(t=>[t.side,t.record]));Object.assign(event,data);for(const t of event.teams||[])if(!t.record&&records[t.side])t.record=records[t.side];dialog.__event=event;dialog.dataset.gameState=data.state;const liveTab=dialog.querySelector('[data-tab=live]');if(liveTab)liveTab.textContent=data.state==='final'?'Summary':data.state==='scheduled'||data.state==='unavailable'?'Preview':'Live';const retainedFocus=slot.contains(document.activeElement)?document.activeElement:null;slot.replaceChildren(gameVisualization(data));const boxPane=dialog.querySelector('.otv-gc-pane-box');if(boxPane){const table=slot.querySelector('.otv-score-table-wrap');boxPane.replaceChildren(...(table?[table]:[make('p','otv-gc-empty','Box score appears once the game starts.')]));for(const row of data.statistics||[]){const vals=(row.values||[]).filter(v=>v.value!=null);/* Only MLB values are server-filtered to this game (hits/runs/errors); others can be season totals. */if(vals.length&&event.league==='MLB'){const p=make('p','otv-gc-stat');p.append(make('strong','',row.name+' '),document.createTextNode(vals.map(v=>v.label+' '+v.value).join(' · ')));boxPane.append(p);}}window.OrbitalGameCenterPlus?.box(boxPane,event,api,data);}if(data.state==='scheduled')pregame(slot,event,api);else if(data.state==='final'&&(data.final_summary?.scoring?.length||data.final_summary?.decisions?.length))slot.prepend(finalSummary(data));else window.TelevisionTrackers?.mountGame(slot,event);if(data.state==='final'){window.TelevisionTrackers?.mountGame(slot,event);window.OrbitalRecap?.mount(dialog,event,api);window.OrbitalSportsExplore?.explorer(dialog,event,api);}if(retainedFocus?.isConnected)retainedFocus.focus({preventScroll:true});const state=dialog.querySelector('.otv-game-state');if(state){state.textContent=event.league+' · '+data.status+(data.stale?' · Saved data':'');state.dataset.state=data.stale?'stale':data.state;}const header=dialog.querySelector('.otv-game-header .otv-team-pair');if(header&&data.teams?.length)header.replaceWith(sportsTeams({...event,...data}));const playable=(data.state==='live'||data.watchable===true)&&!data.stale;for(const row of dialog.querySelectorAll('.otv-feed-choice')){const source=window.TelevisionFeedUi.sources(event).find(s=>s.id===row.dataset.feedId);row.disabled=!window.TelevisionFeedUi.manualAllowed(user)||!window.TelevisionFeedUi.manualAvailable(source);}dialog.dispatchEvent(new Event('reconcile-feeds'));const plays=dialog.querySelector('.otv-gc-pane-plays');if(plays&&!plays.hidden)fillPlays(plays,event);}catch{if(dialog.isConnected){delete slot.dataset.contextLoading;slot.querySelector('.otv-context-loading')?.remove();window.TelevisionTrackers?.mountGame(slot,event);event.stale=true;dialog.dispatchEvent(new Event('reconcile-feeds'));const status=dialog.querySelector('.otv-game-state');if(status)status.textContent='Saved game information · Retrying automatically';}}finally{pending=false;if(dialog.isConnected&&api.getCurrentUserId()===user&&pollState!=='final')timer=setTimeout(load,pollState==='scheduled'?30000:15000);}};
  const resume=()=>{if(!document.hidden&&dialog.isConnected){clearTimeout(timer);load();}};document.addEventListener('visibilitychange',resume);dialog.addEventListener('refresh-game',()=>{clearTimeout(timer);load();});dialog.addEventListener('close',()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',resume);},{once:true});load();
 }

 function finalSummary(data){
  const s=data.final_summary,box=make('section','otv-final-summary');box.append(make('h3','otv-panel-label','Scoring summary'));
  if(s.decisions?.length){const d=make('p','otv-final-decisions');for(const x of s.decisions){const c=make('span','otv-final-decision');c.append(make('small','',x.role),document.createTextNode(' '+x.name));d.append(c);}box.append(d);}
  const list=make('ol','otv-final-scoring');let period='';
  for(const p of s.scoring||[]){if(p.period&&p.period!==period){period=p.period;list.append(make('li','otv-final-period',p.period));}
   const li=make('li','otv-final-play');li.append(make('span','otv-final-meta',[p.clock,p.team].filter(Boolean).join(' · ')),make('span','otv-final-text',p.text),make('strong','otv-final-score',p.away!=null&&p.home!=null?p.away+'–'+p.home:''));list.append(li);}
  if(list.childElementCount)box.append(list);
  
  return box;
 }
 // Single-page consumer of the shared game repository. Context is enrichment only.
 function onePageGame(dialog,event,api,{feedsOnly=false}={}){
  const slot=dialog.querySelector('.otv-gc-pane-live'),user=api.getCurrentUserId(),server=api.serverId();
  const pageRoute=location.hash;dialog.dataset.gcContext='loading';dialog.dataset.feedLookup='pending';
  const credential=api.accessToken?.(),contextKey=[server,user,event.league,event.id,event.start].join('|'),savedContext=gameContextCache.get(contextKey);
  // Retain display-only enrichment across a short revisit. Feed authority and
  // freshness still come from the new responses, never from this receipt time.
  const retainedContext=savedContext&&savedContext.credential===credential&&Date.now()-savedContext.at<30000?savedContext:null;
  let ended=false,context=retainedContext?.context||{},last=null,pending=false,timer,signature='',stop,inventory=event.__otvFeedInventory||{fetched_at:event.fetched_at,stale:!!event.stale,warnings:event.warnings||[]};event.__otvFeedInventory=inventory;
  const current=()=>!ended&&dialog.isConnected&&location.hash===pageRoute&&api===window.ApiClient&&user===api.getCurrentUserId()&&server===api.serverId()&&credential===api.accessToken?.();
  const root=make('section','ogp-game'),hero=make('div','ogp-hero'),big=make('div','ogp-headline'),status=make('small','ogp-period'),headline=make('strong','ogp-down'),spot=make('span','ogp-spot');
  big.append(status,headline,spot);const tiles=make('div','ogp-tiles');hero.append(big,tiles);
  const visual=make('div','ogp-visual'),key=make('div','ogp-field-key'),lower=make('div','ogp-lower'),latest=make('section','ogp-latest'),recent=make('section','ogp-recent'),line=make('div','ogp-line'),info=make('p','ogp-info');
  latest.append(make('h3','','Latest play'),make('div','ogp-latest-body'));recent.append(make('h3','','Recent plays'),make('ol','ogp-recent-list'));lower.append(latest,recent);root.append(hero,visual,key,lower,line,info);slot.replaceChildren(root);
  const tile=(label,value,team)=>{const n=make('div','ogp-tile'),v=make('strong','',value);n.append(make('small','',label));const meta=team?(event.teams||[]).find(t=>t.id===team.id||t.side===team.side):null,url=team?.logo||meta?.logo||window.OrbitalTeamArt?.[event.league+'|'+(meta?.name||team?.name)]?.url;if(window.OrbitalArtwork.url(url)){const img=make('img','');img.src=url;img.alt='';v.prepend(img);}n.append(v);return n;};
  const summaryText=p=>String(p?.text||p?.result||p?.description||'').trim(),actorName=v=>typeof v==='string'?v:v?.name||'';
  const rowsOf=d=>d.kind==='baseball'?(d.recent?.length?d.recent:d.plays||[]):(d.plays||[]).filter(p=>!/^\s*(?:end (?:of )?(?:game|period|quarter|half|regulation)|time[ -]?out|two[ -]minute|coin toss)\b/i.test(p.type||p.text||''));
  function paint(d){
   if(!current())return;if(d)dialog.dataset.gcTracker='settled';if(!d||d.kind==='unknown'){
    const unavailable=!!d,notice=unavailable?'Updates unavailable · Retrying automatically':'Loading game updates…';
    signature='';status.textContent=last?'Updates delayed · Showing last received report':notice;status.dataset.health=unavailable?'delayed':'loading';
    const state=dialog.querySelector('.otv-game-state');if(state){state.textContent=event.league+' · '+status.textContent;state.dataset.state=unavailable?'stale':'loading';}
    if(last)return;
    headline.textContent=event.state==='scheduled'?'Coming up':event.state==='final'?'Final':unavailable?'Updates unavailable':'Loading updates…';spot.textContent=event.state==='scheduled'?clock(event.start):'';
    latest.querySelector('.ogp-latest-body').textContent=unavailable?'Play information is unavailable. Retrying automatically.':'Waiting for reported plays…';recent.querySelector('ol').replaceChildren(make('li','ogp-empty',unavailable?'Recent plays unavailable':'Waiting for reported plays…'));
    return;
   }
   last=d;const data=d,s=data.situation||{},T=window.TelevisionTrackers;
   const next=JSON.stringify([data.game_revision,data.timeline_epoch,data.source_health,data.state,data.status,data.teams,s,data.summary,data.plays,data.recent,data.points,data.field,context]);if(next===signature)return;signature=next;
   dialog.dataset.gameRevision=String(data.game_revision??'');dialog.dataset.reachedEventId=String(data.reached_event_id??data.timeline?.at(-1)?.id??'');dialog.dataset.gameState=data.state||event.state;root.dataset.kind=data.kind;
   const teams=(data.teams||event.teams||[]).map(t=>({...((event.teams||[]).find(m=>m.side===t.side)||{}),...t}));
   const header=dialog.querySelector('.otv-game-header .otv-team-pair');if(header)header.replaceWith(sportsTeams({...event,...data,teams}));
   const h=dialog.querySelector('.otv-game-header');h.querySelector('.ogp-score-context')?.remove();const hc=make('div','ogp-score-context');hc.append(make('small','',data.state==='final'?'FINAL':event.league),make('strong','',data.status||event.status||''));h.querySelector('.otv-team-pair')?.append(hc);
   const st=dialog.querySelector('.otv-game-state');if(st){st.textContent=event.league+' · '+(data.status||event.status||'');st.dataset.state=data.state||event.state;}
   if(data.latest_reported&&data.state!==event.state){event.state=data.state;event.status=data.status;event.teams=teams;dialog.dispatchEvent(new Event('reconcile-feeds'));}
   if(data.state==='scheduled')return;
   if(root.dataset.preview){root.replaceChildren(hero,visual,key,lower,line,info);delete root.dataset.preview;}
   status.textContent=(data.status||event.status||'')+(data.source_health&&data.source_health!=='fresh'?' · Updates delayed':'');status.dataset.health=data.source_health||'';tiles.replaceChildren();const rows=rowsOf(data).filter(p=>summaryText(p)),p=rows.at(-1),text=summaryText(p)||data.summary?.outcome||data.summary?.description||'';
   root.classList.toggle('ogp-football-v2',data.kind==='football');
   if(data.kind==='football'){
    const nextCard=window.OrbitalFootballPresentation.gameCenter(data),oldField=visual.querySelector('svg.ofb-field'),newField=nextCard.querySelector('svg.ofb-field');if(oldField&&newField&&T.reconcileField)newField.replaceWith(T.reconcileField(oldField,newField));visual.replaceChildren(nextCard);key.replaceChildren();
   }else if(data.kind==='baseball'){
    headline.textContent=data.state==='final'?'Final':s.balls!=null&&s.strikes!=null?s.balls+' – '+s.strikes:data.summary?.outcome||'At the plate';spot.textContent=s.outs!=null?s.outs+' '+(s.outs===1?'out':'outs'):'';
    if(['on_first','on_second','on_third'].every(k=>typeof s[k]==='boolean')){const occupied=['first','second','third'].filter(k=>s['on_'+k]),bases=svgNode('svg',{viewBox:'0 0 30 22',role:'img','aria-label':'Runners: '+(occupied.join(', ')||'none'),class:'ogp-bases'});for(const [x,y,k] of [[15,6,'second'],[7,14,'third'],[23,14,'first']])bases.append(svgNode('rect',{x:x-4,y:y-4,width:8,height:8,transform:`rotate(45 ${x} ${y})`,fill:s['on_'+k]?'#ffd166':'#788391',stroke:'#c1cad3','stroke-width':.6}));spot.append(bases);}
    if(actorName(s.batter))tiles.append(tile('At bat',actorName(s.batter)));if(actorName(s.pitcher))tiles.append(tile('Pitching',actorName(s.pitcher)));const pitch=data.plays?.at(-1);if(pitch)tiles.append(tile('Last pitch',[pitch.pitch_type||pitch.type,pitch.speed!=null?pitch.speed+' mph':null,pitch.call].filter(Boolean).join(' · ')||summaryText(pitch)));
    visual.replaceChildren();const card=make('div','ogp-baseball-visual'),zone=make('div','ogp-pitch-zone'),detail=make('div','ogp-pitch-detail');
    if(data.points?.length&&data.field?.zone){const chart=T.cardField({...data,reference_estimated:true}),z=data.field.zone,ps=data.points,w=600,h=600*(data.field.physical_height||1)/(data.field.physical_width||1),pad=38,xs=[z.x*w,(z.x+z.width)*w,...ps.map(p=>p.x*w)],ys=[z.y*h,(z.y+z.height)*h,...ps.map(p=>p.y*h)],x=Math.min(...xs)-pad,y=Math.min(...ys)-pad;chart.setAttribute('viewBox',[x,y,Math.max(...xs)-x+pad,Math.max(...ys)-y+pad].join(' '));zone.append(chart);}else zone.append(make('p','ogp-empty','Pitch location unavailable'));
    detail.append(make('small','',pitch?'Pitch '+(pitch.pitch_number||pitch.number||data.plays.length):'Current matchup'),make('strong','obc-pitch-type',pitch?.pitch_type||pitch?.type||''));const mph=pitch?.mph??pitch?.speed;if(Number.isFinite(mph))detail.append(make('strong','ogp-pitch-speed',Math.round(mph)+' MPH'));const outcome=data.timeline?.findLast(p=>p.result===true&&p.at_bat===data.summary?.at_bat_id);if(data.summary?.outcome)detail.append(make('strong','ogp-pitch-outcome',outcome?.type||'At-bat complete'));else if(pitch)detail.append(make('p','',pitch.text||pitch.call||''));
    const resultNode=detail.querySelector('.ogp-pitch-outcome');if(resultNode&&/out|double play|triple play/i.test(outcome?.type||''))resultNode.dataset.tone='out';const chips=make('div','ogp-pitch-chips');for(const p of (data.plays||[]).slice(-5)){const chip=make('span','ogp-pitch-chip');chip.append(make('strong','','#'+(p.pitch_number||p.number||'')+' '+(p.pitch_type||p.type||'Pitch')),make('small','',[Number.isFinite(p.mph)?Math.round(p.mph)+' mph':null,p.call||p.text].filter(Boolean).join(' · ')));chips.append(chip);}card.append(zone,detail);visual.append(card,chips);key.replaceChildren();
   }else{headline.textContent=data.status||'';spot.textContent='';visual.replaceChildren(T.render(data));key.replaceChildren();}
   const lb=latest.querySelector('.ogp-latest-body');lb.replaceChildren();if(p&&data.kind==='football'){const label=make('strong','ogp-play-result',T.footballLabel(p));label.style.color=T.footballColor(T.footballYards(p),T.footballKind(p));lb.append(label);}else if(typeof p?.type==='string')lb.append(make('strong','ogp-play-result',p.type));lb.append(make('p','',text||'No plays reported yet.'));
   const list=recent.querySelector('ol');list.replaceChildren();for(const row of rows.slice(-3).reverse()){const li=make('li','');li.dataset.eventId=row.id||'';li.append(make('small','',row.down_distance||row.inning||row.clock||row.type||''),make('span','',summaryText(row)));if(data.kind==='football'){const yards=T.footballYards(row),tag=make('strong','',T.footballKind(row)+(Number.isFinite(yards)?' '+(yards>0?'+':'')+yards:''));tag.style.color=T.footballColor(yards,T.footballKind(row));li.append(tag);}list.append(li);}if(!rows.length)list.append(make('li','ogp-empty','No plays reported yet.'));
   line.replaceChildren();if(context.statistics?.some(r=>r.periods?.length)){const view=gameVisualization({...context,state:data.state||event.state,graphics:null,participants:[],last_play:null});const table=view.querySelector('.otv-score-table-wrap');if(table){table.querySelector('caption').textContent=data.kind==='baseball'?'Score by inning':'Score by period';line.append(table);}}
   info.textContent=[context.venue,(context.broadcasts||event.networks||[]).join(' · ')].filter(Boolean).join(' · ');
  }
  let feedProgressAttempts=0,feedProgressPending=false,feedRetryAfter=2000,feedAuthDenied=false;
  const feedNote=()=>{let n=dialog.querySelector('.otv-feed-refresh-status');if(!n){n=make('p','otv-gc-note otv-feed-refresh-status');n.setAttribute('role','status');dialog.querySelector('.otv-gc-watch')?.append(n);}return n;};
  const feedAuthError=error=>[error?.status,error?.statusCode,error?.response?.status].some(value=>value===401||value==='401'||value===403||value==='403');
  const readGameState=(date)=>new Promise((resolve,reject)=>{let settled=false;const deadline=setTimeout(()=>{if(!settled){settled=true;reject(Error('GameMetadataTimeout'));}},12000);Promise.resolve().then(()=>api.ajax({type:'GET',url:api.getUrl('sports/api/game/'+event.id+'/state',{league:event.league,date}),dataType:'json',timeout:10000})).then(value=>{if(!settled){settled=true;clearTimeout(deadline);resolve(value);}},error=>{if(!settled){settled=true;clearTimeout(deadline);reject(error);}});});
  const withdrawFeeds=()=>{if(!current())return;feedAuthDenied=true;feedProgressPending=false;clearTimeout(timer);event.sources=[];inventory={fetched_at:null,stale:true,warnings:[]};event.__otvFeedInventory=inventory;dialog.__event=event;dialog.dispatchEvent(new Event('reconcile-feeds'));feedNote().textContent='Feed access could not be confirmed. Sign in again or refresh this game.';};
  async function enrich(){
   if(pending||feedAuthDenied||!current())return;clearTimeout(timer);pending=true;
   // Optional inventory is bounded independently and cannot withdraw a known
   // mapped manual channel merely because its cold metadata is still loading.
   const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(event.start));
   const boardRequest=requestGameFeedsData(api,event,date).then(board=>({board}),error=>{if(feedAuthError(error))withdrawFeeds();return{failed:true};});
   const refreshControl=dialog.querySelector('.otv-gc-refresh');refreshControl?.setAttribute('aria-busy','true');
   try{
    const feedResponse=feedsOnly?(await boardRequest).board:null;const selectedRows=feedsOnly?(feedResponse?.events||[]).filter(row=>String(row.id)===String(event.id)&&row.league===event.league):[];if(feedsOnly&&selectedRows.length!==1)throw Error('Unmatched feed response');const d=feedsOnly?window.TelevisionFeedUi.withFreshness(selectedRows[0],feedResponse):await readGameState(date);
    if(!current()||feedAuthDenied)return;
    if(String(d?.id)!==String(event.id)||d?.league!==event.league||!Number.isFinite(Date.parse(d?.start))||Date.parse(d.start)!==Date.parse(event.start))throw Error('Unmatched game response');
    const away=(event.teams||[]).find(t=>t.side==='away')?.name,statistics=away&&Array.isArray(d.statistics)?[...d.statistics].sort((a,b)=>Number(b.name===away)-Number(a.name===away)):d.statistics;
    const applyFeeds=(incoming,authoritative=false,metadata=null)=>{
     const ui=window.TelevisionFeedUi,fresh=ui.withFreshness(d,d),validSources=Array.isArray(incoming.sources)&&incoming.sources.length<=2048&&incoming.sources.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.id==='string'&&s.id.trim()),source_policy=['mixed','national_only'].includes(incoming.source_policy)?incoming.source_policy:['mixed','national_only'].includes(d.source_policy)?d.source_policy:event.source_policy,postseason=event.postseason===true||d.postseason===true||incoming.postseason===true,loading=authoritative&&sportsMetadataPending(metadata);
     let rows=validSources?incoming.sources:event.sources;
     if(loading){
      const canonical=s=>String(s?.id||'').replace(/-/g,'').toLowerCase(),mapped=s=>!s.automatic&&/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(s.id),denied=new Set([...event.sources,...(validSources?incoming.sources:[])].filter(s=>s&&!ui.manualAvailable(s)).map(canonical));
      const retained=event.sources.filter(s=>mapped(s)&&!denied.has(canonical(s))).map(s=>({...s,eligible:false,automatic_eligible:false}));
      rows=[...retained,...(validSources?incoming.sources:[])].filter(s=>!denied.has(canonical(s)));
      // Preserve the original source observation time; pending is not freshness.
      inventory={...inventory,metadata_pending:true,channel_inventory_pending:metadata?.channel_inventory_pending===true};
     }else if(authoritative&&validSources)inventory={fetched_at:incoming.fetched_at,stale:!!incoming.stale,warnings:incoming.warnings||[]};
     const sources=ui.sources({...d,source_policy,postseason,sources:rows});
     if(ui.withFreshness({},inventory).stale)fresh.stale=true;
     Object.assign(event,fresh,{sources,source_policy,postseason,__otvFeedInventory:inventory});if(authoritative&&validSources&&!loading)delete event.source_projection;dialog.__event=event;dialog.dispatchEvent(new Event('reconcile-feeds'));return authoritative&&validSources&&!loading&&!ui.withFreshness({},inventory).stale;
    };
    applyFeeds({});
    context={venue:d.venue,broadcasts:d.broadcasts,statistics,participants:d.participants};dialog.dataset.gcContext='complete';
    gameContextCache.set(contextKey,{at:Date.now(),credential,context,data:d});while(gameContextCache.size>6)gameContextCache.delete(gameContextCache.keys().next().value);
    if((last?.state||event.state)==='scheduled'){root.replaceChildren(gameVisualization({...d,statistics:[],last_play:null}));root.dataset.preview='true';}else if(last)paint(last);
    const {board}=await boardRequest;if(!current()||feedAuthDenied)return;
    const matches=Array.isArray(board?.events)&&board.events.length<=1024?board.events.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&String(row.id)===String(event.id)&&row.league===event.league&&Number.isFinite(Date.parse(row.start))&&Date.parse(row.start)===Date.parse(event.start)):[];
    feedProgressPending=sportsMetadataPending(board);
    if(feedProgressPending){const seconds=typeof board.retry_after_seconds==='number'&&Number.isFinite(board.retry_after_seconds)?board.retry_after_seconds:2;feedRetryAfter=Math.max(2000,Math.min(10000,seconds*1000));}
    else feedProgressAttempts=0;
    dialog.dataset.feedLookup=feedProgressPending?'pending':matches.length===1?'ready':'error';if(matches.length!==1)dialog.dispatchEvent(new Event('reconcile-feeds'));if(matches.length===1){const ready=applyFeeds(window.TelevisionFeedUi.withFreshness(matches[0],board),true,board);if(ready)dialog.querySelector('.otv-feed-refresh-status')?.remove();else feedNote().textContent=feedProgressPending?'Updating feed choices… Known mapped feeds can still be opened.':'Feed choices could not be refreshed · Refresh to retry.';}
    else feedNote().textContent=feedProgressPending?'Loading game and feed information… Known mapped feeds can still be opened.':'Feed choices could not be refreshed · Refresh to retry.';
   }catch(error){if(current()){if(feedAuthError(error))withdrawFeeds();else{feedNote().textContent='Game update unavailable · Refresh to retry.';dialog.dataset.gcContext='error';dialog.dispatchEvent(new Event('gc-context-error'));}}}finally{
    pending=false;refreshControl?.removeAttribute('aria-busy');
    if(current()&&!feedAuthDenied){if(feedProgressPending){if(feedProgressAttempts<20){feedProgressAttempts++;timer=setTimeout(enrich,feedRetryAfter);}else feedNote().textContent='Feed information is still updating. Select Refresh to retry. Known mapped feeds can still be opened.';}else if(event.state!=='final')timer=setTimeout(enrich,30000);}
   }
  }
  if(!feedsOnly&&retainedContext&&event.state==='scheduled'){root.replaceChildren(gameVisualization({...retainedContext.data,statistics:[],last_play:null}));root.dataset.preview='true';}
  if(!feedsOnly){const cached=window.OrbitalGameStore?.latest?.(event);paint(cached);stop=window.TelevisionTrackers?.watch(event,slot,paint,1500,{maxAgeMs:1000,initialRequest:true});}enrich();const refresh=()=>{clearTimeout(timer);feedProgressAttempts=0;feedAuthDenied=false;enrich();if(last)paint(last);};dialog.addEventListener('refresh-game',refresh);
  dialog.addEventListener('close',()=>{ended=true;stop?.();clearTimeout(timer);dialog.removeEventListener('refresh-game',refresh);},{once:true});
 }
 const gameReturnState=new Map();
 let gameReturnCleanup=null;
 function paintGameFeedFeedback(dialog){
  if(!dialog?.isConnected)return;const pending=dialog.__otvFeedPending;
  const controls=dialog.querySelector('.otv-game-feed-controls');if(!controls)return;
  if(pending)controls.setAttribute('aria-busy','true');else controls.removeAttribute('aria-busy');
  for(const button of controls.querySelectorAll('.otv-sports-auto,.otv-feed-choice')){
   const label=button.querySelector(button.classList.contains('otv-sports-auto')?'strong':'.otv-feed-action');
   if(pending){
    if(!button.__otvFeedIdle)button.__otvFeedIdle={disabled:button.disabled,text:label?.textContent};
    button.disabled=true;button.setAttribute('aria-disabled','true');
    const opening=button.classList.contains('otv-sports-auto')?(!pending.sourceId||pending.sourceId===button.dataset.playFeedId):pending.sourceId===button.dataset.feedId;
    button.classList.toggle('is-opening',opening);if(opening){button.setAttribute('aria-busy','true');if(label)label.textContent='Opening…';}
   }else{
    const idle=button.__otvFeedIdle;if(idle){button.disabled=idle.disabled;if(label)label.textContent=idle.text;delete button.__otvFeedIdle;}
    button.removeAttribute('aria-disabled');button.removeAttribute('aria-busy');button.classList.remove('is-opening');
    if(!button.disabled&&button.classList.contains('otv-feed-choice')&&button.getAttribute('aria-current')==='true'&&label)label.textContent='Selected';
   }
  }
 }
 function showGamePlaybackFailure(dialog,event,sourceId,watch){
  if(!dialog?.isConnected)return;dialog.querySelector('.otv-playback-retry')?.remove();
  const box=make('div','otv-playback-retry'),message=make('p','otv-gc-note','Could not start this feed. Try again or choose another feed.');message.setAttribute('role','alert');
  const api=window.ApiClient,user=api?.getCurrentUserId(),server=api?.serverId(),credential=api?.accessToken?.(),retry=make('button','otv-category','Retry playback');retry.type='button';retry.onclick=()=>{if(api!==window.ApiClient||user!==api?.getCurrentUserId()||server!==api?.serverId()||credential!==api?.accessToken?.()){dialog.close();return;}const ui=window.TelevisionFeedUi,current=ui.withFreshness(dialog.__event||event,dialog.__event||event),source=current.sources?.find(s=>s.id===sourceId),allowed=sourceId?ui?.manualAllowed(user)&&source&&ui.manualAvailable(source):ui?.eligible(current)?.length;if(!allowed){message.textContent='This feed is no longer available. Choose another feed or refresh the game.';return;}box.remove();playGameFeed(current,sourceId,dialog,watch);};box.append(message,retry);const side=dialog.querySelector('.otv-gc-watch');side?.classList.add('has-feed-feedback');side?.prepend(box);retry.focus({preventScroll:true});
 }
 function playGameFeed(event,sourceId,dialog,watch){
  if(dialog.__otvFeedPending)return;gameReturnCleanup?.();const api=window.ApiClient,key=[api?.serverId(),api?.getCurrentUserId(),event.league,event.id].join('|');
  if(window.OrbitalPhoneGamePlayback?.isNative?.()){window.OrbitalPhoneGamePlayback.play(event,sourceId,{dialog,returnToGame:()=>{if(dialog.isConnected){if(!dialog.open)dialog.showModal();(dialog.querySelector('[data-feed-id="'+CSS.escape(sourceId||'')+'"]')||watch)?.focus({preventScroll:true});}}});return;}
  const control=window.TelevisionPlayback;if(typeof(sourceId?control?.select:control?.start)!=='function'){showGamePlaybackFailure(dialog,event,sourceId,watch);return;}const user=api?.getCurrentUserId(),server=api?.serverId(),credential=api?.accessToken?.(),route=window.location.hash,feedback={sourceId};dialog.__otvFeedPending=feedback;paintGameFeedFeedback(dialog);dialog.close();let done=false,initial=true,requestId,unsubscribe,returnPending=false,returnTimer=null,expiryTimer=null,playbackRoute=null,playbackFailed=false,lastPhase='',confirmedStart=false;
  const current=()=>control===window.TelevisionPlayback&&api===window.ApiClient&&user===api?.getCurrentUserId()&&server===api?.serverId()&&credential===api?.accessToken?.();
  // Last request only, 64 closed-field records. No source IDs, URLs or credentials.
  const diagnosticRows=[];let diagnosticSequence=0;
  const routeKind=value=>{const path=value.split('?')[0];if(path==='#/home')return 'home';if(/^#\/video$/.test(path))return 'video';if(path==='#/livetv'){const p=new URLSearchParams(value.split('?')[1]||'');return p.get('sports')==='1'&&(p.get('tab')||'0')==='0'?'sports_hub':'live_tv';}return 'other';};
  const routeKey=value=>{const i=value.indexOf('?'),path=i<0?value:value.slice(0,i),p=new URLSearchParams(i<0?'':value.slice(i+1));return JSON.stringify([path,[...new Set(p.keys())].sort().map(k=>[k,p.getAll(k)])]);};
  const record=(phase,reason='',nav)=>{try{const now=window.location.hash,row=Object.freeze({sequence:++diagnosticSequence,phase,reason,routeKind:routeKind(now),capturedHub:routeKind(route)==='sports_hub',sameRoute:now===route,queryEquivalent:routeKey(now)===routeKey(route),returnPending,initial,requestBound:requestId!=null,dialogHistoryMarked:nav?.type==='popstate'?!!nav.state?.otvDialog:null});if(diagnosticRows.length===64)diagnosticRows.shift();diagnosticRows.push(row);if(diagnosticSequence<=64||phase!=='view')console.info('OrbitalGameReturn',JSON.stringify(row));}catch{}};
  try{window.OrbitalGameReturnDiagnostics=Object.freeze({snapshot:()=>Object.freeze([...diagnosticRows])});}catch{}
  record('begin');
  const clear=(reason='cleared')=>{if(done)return;record('clear',typeof reason==='string'?reason:reason?.type==='pagehide'?'pagehide':'cleared');done=true;if(dialog.__otvFeedPending===feedback){delete dialog.__otvFeedPending;paintGameFeedFeedback(dialog);}clearTimeout(returnTimer);clearTimeout(expiryTimer);window.removeEventListener('popstate',navigation);window.removeEventListener('hashchange',navigation);window.removeEventListener('pagehide',pagehide);unsubscribe?.();if(gameReturnCleanup===clear)gameReturnCleanup=null;};gameReturnCleanup=clear;
  function pagehide(event){if(event instanceof PageTransitionEvent)clear(event);}
  // Playback end can be delivered before the browser's Back route settles.
  // Keep this exact request pending briefly; unrelated routes or a new request
  // still withdraw it. No transport timeout, history route or feed is changed.
  const settle=()=>{returnTimer=null;if(done)return;record('settle');if(!current()){clear('identity_changed');return;}if(window.location.hash!==route){record('settle','route_pending');return;}if(control?.snapshot?.()){clear('snapshot_active');return;}if(document.querySelector('.otv-sports-dialog[open]')){clear('other_dialog');return;}clear('return_admitted');const restored=sportsChooser(event,api,null,{feedsOnly:dialog.__feedsOnly===true});if(playbackFailed)showGamePlaybackFailure(restored,event,sourceId,restored?.querySelector('.otv-gc-primary'));record('opened');};
  const queueReturn=()=>{if(returnTimer===null)returnTimer=setTimeout(settle,0);};
  function navigation(nav){if(done)return;record('navigation',nav?.type==='popstate'?'popstate':'hashchange',nav);if(!current()){clear('identity_changed');return;}const now=window.location.hash;let arrived=now;if(nav?.type==='hashchange'&&typeof nav.newURL==='string'){try{arrived=new URL(nav.newURL).hash;}catch{clear('invalid_route');return;}}if(arrived===route){if(now===route&&returnPending)queueReturn();return;}if(playbackRoute===null&&/^#\/video(?:[?&]|$)/.test(arrived)){playbackRoute=arrived;record('navigation','video_bound');if(now!==route&&now!==playbackRoute){clear('superseded_video_route');return;}if(returnPending)queueReturn();return;}if(arrived!==playbackRoute||now!==route&&now!==playbackRoute)clear('unrelated_route');}
  const back=()=>{if(done)return;record('back');if(!current()){clear('identity_changed');return;}const now=window.location.hash;if(now!==route&&now!==playbackRoute&&!(requestId!=null&&playbackRoute===null&&/^#\/video(?:[?&]|$)/.test(now))){clear('unrelated_route');return;}if(!returnPending){returnPending=true;record('back','pending');expiryTimer=setTimeout(()=>clear('expired'),2000);}queueReturn();};
  const changed=view=>{if(done)return;record('view',view?'present':'null');if(!current()){clear('identity_changed');return;}if(view){const now=window.location.hash;if(now!==route&&now!==playbackRoute&&!(playbackRoute===null&&/^#\/video(?:[?&]|$)/.test(now))){clear('unrelated_route');return;}if(returnPending||String(view.event?.id)!==String(event.id)||view.event?.league!==event.league||requestId!=null&&view.requestId!==requestId){clear(returnPending?'new_view_while_pending':String(view.event?.id)!==String(event.id)||view.event?.league!==event.league?'other_event':'other_request');return;}requestId=view.requestId;initial=false;lastPhase=view.phase||'';if(['playing','native-started'].includes(lastPhase)){confirmedStart=true;if(view.source?.id){gameReturnState.set(key,{sourceId:view.source.id});dialog.dataset.selectedFeed=view.source.id;}}record('view','request_bound');}else if(initial){initial=false;record('view','initial_null');}else{if(requestId!=null&&(!confirmedStart||lastPhase==='recovering')){playbackFailed=true;record('view','terminal_before_picture');}back();}};
  window.addEventListener('popstate',navigation);window.addEventListener('hashchange',navigation);window.addEventListener('pagehide',pagehide);
  try{const action=sourceId?control?.select(event,sourceId):control?.start(event);unsubscribe=control?.subscribe?.(changed);record('subscribe');if(done)unsubscribe?.();Promise.resolve(action).catch(()=>{playbackFailed=true;back();});}catch{playbackFailed=true;back();}
 }


 function sportsChooser(event,api,trigger,{feedsOnly=false}={}){
  cancelSportsFilter();
  const ui=window.TelevisionFeedUi,ownerUser=api.getCurrentUserId(),ownerServer=api.serverId(),ownerCredential=api.accessToken?.(),ownsDialog=()=>api===window.ApiClient&&ownerUser===api.getCurrentUserId()&&ownerServer===api.serverId()&&ownerCredential===api.accessToken?.();event={...event,sources:ui.sources(event),__otvFeedInventory:event.__otvFeedInventory||{fetched_at:event.fetched_at,stale:!!event.stale,warnings:event.warnings||[]}};const canTune=()=>{const facts=ui.withFreshness(event,event);return !facts.stale&&!ui.withFreshness({},event.__otvFeedInventory).stale&&(facts.state==='live'||facts.watchable===true);};
  document.querySelector('.otv-sports-dialog')?.remove();
  const dialog=make('dialog','otv-sports-dialog otv-game-center otv-gc-page otv-v2');dialog.setAttribute('aria-label',feedsOnly?'Choose a feed · '+event.name:event.name);dialog.__feedsOnly=feedsOnly;if(feedsOnly)dialog.classList.add('otv-feed-picker');dialog.dataset.gameState=event.state;dialog.dataset.feedLookup=event.source_projection==='deferred'?'pending':'ready';const close=make('button','otv-category otv-game-close','‹ Back');close.type='button';
  close.onclick=()=>dialog.close();const top=make('div','otv-game-topline'),state=make('p','otv-game-state',event.league+' · '+ui.truth(event));state.dataset.state=event.stale?'stale':event.state;const heading=make('div','otv-gc-title');heading.append(make('h1','',event.name),make('p','',event.league+(feedsOnly?' · Choose a feed':' · Game center')));top.append(close,heading,state);const header=make('header','otv-game-header');header.append(make('h2','otv-matchup-title',event.name),sportsTeams(event));dialog.append(top,header);
  // Game first: situation (tracker / field) on the left, how to watch on the right.
  const body=make('div','otv-gc-body'),situation=make('div','otv-gc-situation'),side=make('div','otv-gc-watch');body.append(situation,side);if(feedsOnly)situation.hidden=true;dialog.append(body);
  dialog.classList.add('ogp-page');const panes={live:make('div','otv-gc-pane otv-gc-pane-live')};situation.append(panes.live);if(!phone()&&innerWidth>=1000){dialog.classList.add('otv-desktop-sports');heading.remove();}
  const controls=make('div','otv-game-feed-controls');side.append(controls);let watch,feedSignature='',feedExpiry;dialog.addEventListener('close',()=>clearTimeout(feedExpiry),{once:true});
  const paintFeeds=()=>{const playable=canTune();clearTimeout(feedExpiry);if(playable){const stamps=[event,event.__otvFeedInventory].map(value=>typeof value.fetched_at==='number'?value.fetched_at*1000:Date.parse(value.fetched_at)),delay=Math.min(...stamps)+120001-Date.now();if(Number.isFinite(delay)&&delay>0)feedExpiry=setTimeout(paintFeeds,delay);}const next=JSON.stringify([playable,dialog.dataset.feedLookup,event.source_projection,event.name,event.league,event.state,event.status,event.stale,event.watchable,event.teams,event.sources,event.source_policy,event.postseason,window.OrbitalPhoneGamePlayback?.selected?.(event)||dialog.dataset.selectedFeed||gameReturnState.get([api.serverId(),api.getCurrentUserId(),event.league,event.id].join('|'))?.sourceId]);if(next===feedSignature)return;feedSignature=next;const active=document.activeElement,feed=active?.dataset.feedId,wasWatch=active?.classList.contains('otv-sports-auto'),opened=controls.querySelector('.otv-specific-feeds')?.open,allOpen=controls.querySelector('.otv-feed-all')?.open,query=controls.querySelector('.otv-feed-search')?.value||'',wasSearch=active?.classList.contains('otv-feed-search');controls.replaceChildren();const actions=make('div','otv-game-actions');controls.append(actions);const automatic=ui.eligible(event)[0],remembered=window.OrbitalPhoneGamePlayback?.selected?.(event)||dialog.dataset.selectedFeed||gameReturnState.get([api.serverId(),api.getCurrentUserId(),event.league,event.id].join('|'))?.sourceId,selected=ui.manualAllowed(api.getCurrentUserId())?event.sources.find(s=>!s.automatic&&ui.manualAvailable(s)&&s.id===remembered):null,manualFallback=ui.manualAllowed(api.getCurrentUserId())?(automatic&&ui.manualAvailable(automatic)?automatic:event.sources.find(s=>!s.automatic&&ui.manualAvailable(s))):null,manualWatch=selected||manualFallback,watchSource=manualWatch||(playable&&automatic);watch=null;
  if(watchSource){watch=make('button','otv-sports-source otv-sports-auto otv-gc-primary');watch.type='button';watch.dataset.playFeedId=watchSource.id;const artwork=window.OrbitalSportsGlass?.watchArt(event);if(artwork)watch.append(artwork);watch.append(make('strong','',event.state==='live'?'Watch live':'Open feed'));const what=[ui.label(watchSource,event),ui.quality(watchSource)].filter(Boolean).join(' · ');if(what)watch.append(make('span','',what));watch.title=ui.raw(watchSource);watch.onclick=()=>{if(!ownsDialog()){dialog.close();return;}if(manualWatch?(!ui.manualAllowed(api.getCurrentUserId())||!ui.manualAvailable(manualWatch)):!canTune()){paintFeeds();return;}playGameFeed(event,manualWatch?.id||null,dialog,watch);};actions.append(watch);if(ui.manualAllowed(api.getCurrentUserId())){const why=make('details','otv-gc-reason');why.append(make('summary','','Why this feed?'),make('p','',manualWatch?(selected?'Your selected feed.':'Open this mapped feed. Game status does not restrict channel access.'):ui.reason(automatic)));controls.append(why);}}
  else actions.append(make('p','otv-unavailable',event.source_projection==='deferred'?(dialog.dataset.feedLookup==='error'?'Feed choices unavailable · Refresh to retry':'Checking feed choices…'):event.state!=='final'&&ui.withFreshness({},event.__otvFeedInventory).stale?'Saved feed choices · Refresh to retry.':event.state!=='final'&&ui.withFreshness(event,event).stale?'Saved game data · Refresh to retry.':event.state==='live'&&!event.stale?'Currently unavailable · feeds not confirmed yet':event.state==='final'?'This game has ended · highlights and the full box score are here':ui.truth(event)));
  if(ui.manualAllowed(api.getCurrentUserId())){
   const specific=event.sources.filter(source=>!source.automatic),section=make('details','otv-specific-feeds otv-feed-section');section.setAttribute('aria-label','Feeds');const head=make('summary','otv-feed-heading');head.append(make('h3','','Feeds · '+specific.length+' choices'));section.append(head);section.open=opened===undefined?(!phone()||feedsOnly):opened;
   const list=make('div','otv-feed-list'),more=make('details','otv-feed-all'),prominent=new Set(specific.filter(s=>ui.automaticEligible(s)).slice(0,3).map(s=>s.id)),others=[];if(selected)prominent.add(selected.id);
   for(const [index,source] of specific.entries()){const row=make('button','otv-sports-source otv-feed-choice');row.type='button';row.dataset.feedId=source.id;row.setAttribute('aria-current',String(source.id===(window.OrbitalPhoneGamePlayback?.selected?.(event)||dialog.dataset.selectedFeed||gameReturnState.get([api.serverId(),api.getCurrentUserId(),event.league,event.id].join('|'))?.sourceId)));row.title=ui.raw(source);row.disabled=!ui.manualAvailable(source);if(row.disabled)row.title='This feed is unavailable for this account or game policy';const text=make('span','otv-feed-description');text.append(make('strong','',ui.label(source,event)));const detail=ui.detail(source);if(detail)text.append(make('small','',detail));if(!ui.automaticEligible(source))text.append(make('small','otv-feed-proof','Not confirmed for automatic playback'));row.append(text);const e=ui.evidence(source);if(e){const chip=make('span','otv-feed-note',e.chip);chip.dataset.tone=e.tone;chip.title=e.text;row.append(chip);}row.append(make('span','otv-feed-action',row.disabled?'Unavailable':'Open feed'));row.onclick=()=>{if(!ownsDialog()){dialog.close();return;}if(!ui.manualAllowed(api.getCurrentUserId())||!ui.manualAvailable(source))return;playGameFeed(event,source.id,dialog,watch);};if(prominent.has(source.id))list.append(row);else others.push({source,row});}
   section.append(list);
   if(others.length){const summary=make('summary','otv-category',(prominent.size?'More feed choices':'Find a feed')+' ('+others.length+')'),search=make('input','otv-sports-search otv-feed-search'),results=make('div','otv-feed-list'),count=make('p','otv-gc-empty');search.type='search';search.placeholder='Search by channel or provider';search.setAttribute('aria-label','Search feed choices');search.value=query;
    const filter=()=>{const q=search.value.trim().toLowerCase(),matches=others.filter(({source})=>!q||[ui.label(source,event),ui.raw(source),ui.detail(source)].join(' ').toLowerCase().includes(q));results.replaceChildren(...matches.map(({row})=>row));count.textContent=q?matches.length+' of '+others.length+' feed choices':'';count.hidden=!q;};search.oninput=filter;filter();more.append(summary,search,count,results);more.open=allOpen===true;section.append(more);}
   if(!specific.length)section.append(make('p','otv-gc-empty',automatic?'This game has one feed.':'No individual links are available yet.'));if(specific.length)controls.append(section);
   if(automatic)controls.append(make('p','otv-gc-note',window.OrbitalPhoneGamePlayback?.isNative?.()?'Choose another feed above if the picture stalls.':'If the picture stalls, the next feed starts on its own. You can choose another feed above.'));
  }
  if(dialog.classList.contains('otv-desktop-sports')&&opened===undefined&&controls.querySelector('.otv-specific-feeds'))controls.querySelector('.otv-specific-feeds').open=true;if(opened&&controls.querySelector('.otv-specific-feeds'))controls.querySelector('.otv-specific-feeds').open=true;if(allOpen&&controls.querySelector('.otv-feed-all'))controls.querySelector('.otv-feed-all').open=true;
  if(feed){const retained=[...controls.querySelectorAll('[data-feed-id]')].find(n=>n.dataset.feedId===feed);if(retained){const more=retained.closest('.otv-feed-all');if(more)more.open=true;retained.focus({preventScroll:true});}}else if(wasSearch)controls.querySelector('.otv-feed-search')?.focus({preventScroll:true});else if(wasWatch)(watch||close).focus({preventScroll:true});
  };const markWatch=()=>side.classList.toggle('is-empty',!side.querySelector('button,a,select,input,img,video,.otv-unavailable'));paintFeeds();paintGameFeedFeedback(dialog);markWatch();dialog.addEventListener('reconcile-feeds',()=>{if(!ownsDialog()){dialog.close();return;}paintFeeds();paintGameFeedFeedback(dialog);markWatch();});
  const refresh=make('button','otv-category otv-gc-refresh','Refresh game');refresh.type='button';refresh.onclick=()=>dialog.dispatchEvent(new Event('refresh-game'));if(phone()){refresh.textContent='Refresh';top.append(refresh);}else side.append(refresh);
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();dialog.close();}});dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected&&!document.getElementById('television-play-status')?.contains(document.activeElement))trigger.focus({preventScroll:true});});document.body.append(dialog);dialog.showModal();paintGameFeedFeedback(dialog);window.OrbitalGameReady?.attach(dialog,api,()=>{dialog.close();sportsChooser(event,api,trigger,{feedsOnly});});onePageGame(dialog,event,api,{feedsOnly});if(!feedsOnly)window.OrbitalSportsExplore?.explorer(dialog,event,api);close.focus({preventScroll:true});return dialog;
 }
 window.TelevisionOtherWays=event=>sportsChooser(event,window.ApiClient,document.activeElement);
 // Sept 27 (web parity with Orbital TV .58): the board card's live situation, drawn for the card instead of a
 // shrunken full tracker map. Baseball: diamond with runners + outs, bold count headline. Football: field strip with
 // team end zones, ball spot, direction and first-down line, bold down & distance. Others: the latest play.
 const svgNS='http://www.w3.org/2000/svg',svgNode=(tag,attrs)=>{const n=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attrs||{}))n.setAttribute(k,String(v));return n;};
 function sitOffense(d){const s=d.situation||{},id=String(s.team_id||d.summary?.team_id||'');return {off:(d.teams||[]).find(t=>String(t.id)===id),def:(d.teams||[]).find(t=>String(t.id)!==id)};}
 function sitHeadline(d){const s=d.situation||{};
  if(d.kind==='baseball'&&s.outs!=null){const o=Number(s.outs)||0;return [(s.balls??0)+'-'+(s.strikes??0),o===1?'1 out':o+' outs',s.batter?(typeof s.batter==='string'?s.batter:s.batter.name)+' up':null].filter(Boolean).join('  ·  ');}
  if(d.kind==='football'&&(s.text||s.down)){const {off}=sitOffense(d),n=Number(s.down),ord=n===1?'1st':n===2?'2nd':n===3?'3rd':n+'th';
   return [off?.abbreviation?off.abbreviation+' ball':null,s.text||(ord+' & '+(s.distance??'?')+(s.spot?' at '+s.spot:''))].filter(Boolean).join('  ·  ');}
  return '';}
 function sitLast(d){return String(d.summary?.outcome||d.plays?.at(-1)?.text||d.summary?.description||'').trim();}
 function sitGraphic(d){const s=d.situation||{};
  if(d.kind==='baseball'&&s.outs!=null){const g=svgNode('svg',{viewBox:'0 0 60 60',class:'otv-sit-diamond','aria-hidden':'true'});
   for(const [x,y,on] of [[46,25,s.on_first],[30,9,s.on_second],[14,25,s.on_third]])g.append(svgNode('rect',{x:x-7,y:y-7,width:14,height:14,rx:1.5,transform:'rotate(45 '+x+' '+y+')',class:on?'on':''}));
   const outs=Number(s.outs)||0;for(let i=0;i<3;i++)g.append(svgNode('circle',{cx:20+i*10,cy:52,r:3.6,class:i<outs?'out':''}));return g;}
  if(d.kind==='football'){const {off,def}=sitOffense(d),spot=String(s.spot||'').trim(),m=spot.match(/(\d{1,2})$/);let x=null;
   if(m){const y=Number(m[1]);x=y>=50?.5:off?.abbreviation&&spot.split(' ')[0].toUpperCase()===String(off.abbreviation).toUpperCase()?y/100:1-y/100;}
   else if(d.field?.ball_x!=null)x=Number(d.field.ball_x);
   if(x==null||!Number.isFinite(x))return null;
   const W=300,H=16,Z=24,F=W-2*Z,px=v=>Z+F*Math.min(1,Math.max(0,v));
   const g=svgNode('svg',{viewBox:'0 0 '+W+' '+H,class:'otv-sit-field',preserveAspectRatio:'none','aria-hidden':'true'});
   g.append(svgNode('rect',{x:0,y:0,width:W,height:H,rx:7,fill:'#1d4a33'}),svgNode('rect',{x:0,y:0,width:Z,height:H,fill:off?.color||'#2f5d86'}),svgNode('rect',{x:W-Z,y:0,width:Z,height:H,fill:def?.color||'#7a3b3b'}));
   for(let i=1;i<10;i++)g.append(svgNode('rect',{x:Z+F*i/10-.6,y:3,width:1.2,height:H-6,fill:'rgba(255,255,255,.35)'}));
   const dist=Number(s.distance);if(dist>0&&dist<100)g.append(svgNode('rect',{x:px(x+dist/100)-1.2,y:0,width:2.4,height:H,fill:'#ffd54a'}));
   g.append(svgNode('rect',{x:px(x)-1.2,y:0,width:2.4,height:H,fill:'#7fb4ff'}),svgNode('ellipse',{cx:px(x),cy:H/2,rx:6,ry:4,fill:'#fff'}),svgNode('path',{d:'M'+(px(x)+8)+' '+(H/2-4)+' L'+(px(x)+13)+' '+(H/2)+' L'+(px(x)+8)+' '+(H/2+4)+' Z',fill:'#fff'}));return g;}
  return null;}
 // Only pending Sports metadata uses this short bounded retry sequence.
 function sportsMetadataPending(data){return data?.metadata_pending===true||data?.channel_inventory_pending===true;}
 function requestSportsCardsData(api,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Promise.reject(Error('Invalid game date'));
  return requestSportsData(api,{date,projection:'cards'});
 }
 function requestGameFeedsData(api,event,date){
  const id=String(event?.id||''),league=event?.league;
  if(!/^\d{1,12}$/.test(id)||typeof league!=='string'||!league.trim()||league.length>64||/[\x00-\x1f]/.test(league)||!/^\d{4}-\d{2}-\d{2}$/.test(date))return Promise.reject(Error('Invalid game identity'));
  return requestSportsData(api,{date,event:id,league});
 }
 function sportsFeedMatches(event,enabled,ui=window.TelevisionFeedUi){return !enabled||event.source_projection==='deferred'||ui.eligible(event).length>0;}
 function requestSportsData(api,query,owner){return new Promise((resolve,reject)=>{let settled=false,transport;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(owner)owner.cancel=null;error?reject(error):resolve(value);};const timer=setTimeout(()=>finish(Error('SportsRequestTimeout')),12000);if(owner)owner.cancel=()=>{try{transport?.abort?.();}catch{}finish(Error('SportsFilterCancelled'));};Promise.resolve().then(()=>{if(settled)return;transport=api.ajax({type:'GET',url:api.getUrl('sports/api/events',query),dataType:'json',timeout:12000});return transport;}).then(value=>finish(null,value),error=>finish(error));});}
 function cancelSportsFilter(state='paused'){
  const work=sports.filterWork;sports.filterWork=null;if(work){work.cancelled=true;work.cancel?.();}if(sports.filterStatus==='pending')sports.filterStatus=state;
 }
 function sportsFilterCaption(){return sports.filterStatus==='pending'?'Checking Watch available…':sports.filterStatus==='error'?'Watch filter unavailable · Refresh to retry':'Watch filter paused · Refresh to retry';}
 function sportsFilterScope(){return JSON.stringify([sports.identity,sports.day,location.hash]);}
 function evaluateSportsFilter(board,api){
  if(!sports.hasFeed||sports.data?.source_projection!=='deferred'||sportsMetadataPending(sports.data)||sports.filterWork||sports.filterAttempt===sportsFilterScope()||document.hidden||!liveRoute('sports')||document.querySelector('.otv-sports-dialog[open]'))return;
  const identity=sports.identity,day=sports.day,serial=sports.serial,route=location.hash,work={cancelled:false,cancel:null};sports.filterAttempt=sportsFilterScope();sports.filterWork=work;sports.filterStatus='pending';delete board.dataset.renderKey;renderSports(board,api);
  const current=()=>!work.cancelled&&sports.filterWork===work&&sports.hasFeed&&sports.day===day&&sports.serial===serial&&sports.identity===identity&&sessionCurrent(api,identity)&&location.hash===route&&!document.hidden&&board.isConnected&&!document.querySelector('.otv-sports-dialog[open]');
  requestSportsData(api,{date:day},work).then(data=>{
   if(!current())return;
   if(sportsMetadataPending(data)||data?.source_projection==='deferred'||!Array.isArray(data?.events)||data.events.some(e=>e.source_projection==='deferred')||window.TelevisionFeedUi.withFreshness({},data).stale){sports.filterStatus='error';return;}
   sports.data=data;sports.filterStatus='ready'; // Preserve the server's original freshness and eligibility provenance.
  }).catch(error=>{
   if(!current())return;sports.filterStatus='error';
   if(error?.status===401||error?.status===403){sports.data=null;sports.previous=null;sports.error={key:identity+'|cards|'+day,status:error.status,tries:1,retryAt:null};stopSportsProgress();for(const stop of sports.trackerStops||[])stop();sports.trackerStops=[];board.__sportsCards?.clear();$('.otv-sports-grid',board).replaceChildren();$('.otv-sports-status',board).textContent=error.status===401?'Your session expired. Sign in again.':'Live TV is not enabled for this account.';}
  }).finally(()=>{if(sports.filterWork!==work)return;sports.filterWork=null;if(currentAfter()){delete board.dataset.renderKey;renderSports(board,api);}function currentAfter(){return !work.cancelled&&sports.data&&sports.hasFeed&&sports.day===day&&sports.serial===serial&&sports.identity===identity&&sessionCurrent(api,identity)&&location.hash===route&&!document.hidden&&board.isConnected;}});
 }
 function stopSportsProgress(){const p=sports.progressive;if(p?.timer!=null)clearTimeout(p.timer);sports.progressive=null;sports.progressiveDue=false;}
 function scheduleSportsProgress(board,api,data,identity,key){
  if(!sportsMetadataPending(data)){stopSportsProgress();return;}
  let state=sports.progressive;
  if(!state||state.key!==key||state.api!==api||state.route!==location.hash){stopSportsProgress();state={key,api,identity,day:sports.day,route:location.hash,attempts:0,timer:null,exhausted:false};sports.progressive=state;}
  if(state.attempts>=20){state.exhausted=true;return;}
  if(state.timer!=null)return;
  const seconds=typeof data.retry_after_seconds==='number'&&Number.isFinite(data.retry_after_seconds)?data.retry_after_seconds:2;
  state.timer=setTimeout(()=>{state.timer=null;if(sports.progressive!==state||!board.isConnected||state.day!==sports.day||state.route!==location.hash||!sessionCurrent(api,identity)||!liveRoute('sports'))return;state.attempts++;sports.progressiveDue=true;queue();},Math.max(2000,Math.min(10000,seconds*1000)));
 }
 function sportsStatusLine(dayName,data,shown,loaded){
  const pending=sportsMetadataPending(data),total=data.pagination?.total??shown;
  let line=dayName+' · '+(pending&&!loaded?'Loading game and feed information…':total+(total===1?' game':' games')+(data.pagination?.remaining_bands?.length?' · '+loaded+' loaded':'')+(pending?' · Updating feed choices…':''));
  if(pending&&sports.progressive?.exhausted)line=dayName+' · Game and feed information is still updating. Select Refresh to retry.';
  const stamp=data.fetched_at;if(typeof stamp==='number'&&Number.isFinite(stamp)&&stamp>0)line+=' · updated '+new Date(stamp*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  return line;
 }

 async function loadNextSportsBand(board,api){
  const data=sports.data,band=data?.pagination?.remaining_bands?.[0];if(!band||sports.bandPending?.data===data)return;
  const serial=sports.serial,user=api.getCurrentUserId(),identity=sessionKey(api,user),day=sports.day,request={data};sports.bandPending=request;
  try{const next=await requestSportsData(api,{date:day,band});
   if(serial!==sports.serial||!sessionCurrent(api,identity)||data!==sports.data||day!==sports.day)return;
   const merged=new Map(data.events.map(e=>[e.league+'|'+e.id,e]));for(const e of next.events||[])merged.set(e.league+'|'+e.id,e);
   data.events=[...merged.values()];data.pagination.remaining_bands.shift();delete board.dataset.renderKey;
   renderSports(board,api);
  }catch{if(data===sports.data){const button=board.querySelector('.otv-fetch-band');if(button){button.textContent='Retry later kickoff times';button.disabled=false;}}}
  finally{if(sports.bandPending===request)sports.bandPending=null;}
 }
 function openSportsFilters(board,api,trigger,all,leagues,conferences){
  const route=location.hash,identity=sessionKey(api,api.getCurrentUserId());
  const d=make('dialog','otv-sports-dialog otv-all-filters');d.setAttribute('aria-label','All Sports filters');
  const head=make('header','otv-af-head'),close=make('button','otv-af-close','×');close.type='button';close.setAttribute('aria-label','Close filters');close.onclick=()=>d.close();head.append(make('h2','','All filters'),close);
  const form=make('form','otv-af-form'),grid=make('div','otv-af-grid'),fields={};
  const field=(key,label,values,value)=>{const wrap=make('label','otv-af-field'),caption=make('span','',label),input=make(values?'select':'input','');input.name=key;input.setAttribute('aria-label',label);if(values)for(const [v,t]of values){const o=make('option','',t);o.value=v;input.append(o);}input.value=value||'';wrap.append(caption,input);grid.append(wrap);fields[key]=input;return input;};
  field('query','Find a team',null,sports.query).type='search';fields.query.parentElement.classList.add('otv-af-wide');
  const date=field('day','Day',null,sports.day);date.type='date';date.required=true;const sourceDate=board.querySelector('.otv-game-date');date.min=sourceDate?.min||'';date.max=sourceDate?.max||'';
  field('view','Show',[['all','All games'],['live','Live'],['upcoming','Upcoming'],['final','Final']],sports.view||'all');
  field('league','Sport',[['All leagues','All sports'],...leagues.map(v=>[v,v])],sports.league);
  field('network','Network',[['','All networks'],...[...new Set(all.flatMap(e=>e.networks||[]))].sort().map(v=>[v,v])],sports.network);
  const conf=field('conf','Conference',[],sports.conf);
  const paintConf=()=>{const current=conf.value||sports.conf||'',ids=[...new Set(all.filter(e=>fields.league.value==='All leagues'||e.league===fields.league.value).flatMap(e=>(e.teams||[]).map(t=>t.conference_id).filter(Boolean)))];conf.replaceChildren();for(const [v,t]of [['','All conferences'],...ids.map(id=>[id,conferences[id]||'Conference '+id])]){const o=make('option','',t);o.value=v;conf.append(o);}conf.value=ids.includes(current)?current:'';};paintConf();fields.league.onchange=paintConf;
  field('order','Game order',[['','Recommended'],['time','Start time'],['az','Matchup A–Z']],sports.order);
  const toggles=make('div','otv-af-toggles');for(const [key,label]of [['mine','Your teams'],['onTv','On TV'],['hasFeed','Watch available'],['ranked','Ranked teams']]){const wrap=make('label','otv-af-toggle'),input=make('input','');input.type='checkbox';input.checked=!!sports[key];input.name=key;fields[key]=input;wrap.append(input,make('span','',label));toggles.append(wrap);}
  const foot=make('footer','otv-af-footer'),reset=make('button','','Reset'),apply=make('button','otv-af-apply','Show games');reset.type='button';apply.type='submit';reset.onclick=()=>{fields.query.value='';fields.day.value=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});fields.view.value='all';fields.league.value='All leagues';fields.network.value='';fields.order.value='';paintConf();conf.value='';for(const k of ['mine','onTv','hasFeed','ranked'])fields[k].checked=false;};foot.append(reset,apply);form.append(grid,toggles,foot);d.append(head,form);
  form.onsubmit=e=>{e.preventDefault();if(location.hash!==route||!sessionCurrent(api,identity)||!board.isConnected){d.close();return;}cancelSportsFilter();for(const k of ['query','view','league','network','order'])sports[k]=fields[k].value;sports.conf=fields.conf.value||null;for(const k of ['mine','onTv','hasFeed','ranked'])sports[k]=fields[k].checked;sports.filterAttempt=null;sports.filterStatus='idle';const search=board.querySelector('.otv-board-actions .otv-sports-search');if(search)search.value=sports.query;const day=fields.day.value;d.close();if(day!==sports.day)board.__setDay(day);else{renderSports(board,api);if(sports.hasFeed)evaluateSportsFilter(board,api);}};
  const leave=()=>d.close();window.addEventListener('hashchange',leave);d.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();d.close();}});d.addEventListener('close',()=>{window.removeEventListener('hashchange',leave);d.remove();const next=board.querySelector('.otv-all-filters-open');if(next?.isConnected)next.focus({preventScroll:true});},{once:true});document.body.append(d);d.showModal();close.focus({preventScroll:true});
 }

 function renderSports(board,api){
  const presentation=board.__pageReadyOwner;if(!presentation||location.hash!==presentation.route||!sessionCurrent(api,presentation.identity)||!liveRoute('sports'))return;
  const grid=$('.otv-sports-grid',board),data=sports.data;if(!data)return;const focus=document.activeElement,focusId=focus?.dataset.eventId,focusChip=focus?.dataset.chipKey,focusBand=focus?.dataset.band,focusIndex=[...grid.querySelectorAll('button')].indexOf(focus);
  sports.view=sports.view||(sports.live?'live':'all');sports.expanded=sports.expanded||new Set();
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),past=sports.day<today;if(past&&['live','upcoming'].includes(sports.view))sports.view='all';
  const trackerOwner=window.OrbitalTrackerOwnership;const trackerScope=trackerOwner?.key(trackerOwner.capture());
  const renderKey=JSON.stringify([trackerScope,data.fetched_at,data.source_projection,data.metadata_pending,data.channel_inventory_pending,sports.progressive?.exhausted,sports.day,sports.league,sports.query,sports.view,sports.hasFeed,sports.filterStatus,sports.mine,sports.conf,sports.onTv,sports.ranked,sports.network,sports.order,[...sports.expanded]]);if(board.dataset.renderKey===renderKey){livePhase(board,'complete',api,presentation.user,presentation.route,presentation.identity);return;}board.dataset.renderKey=renderKey;
  const ui=window.TelevisionFeedUi,followed=window.OrbitalFollowed?.list()||[];
  const mine=e=>followed.some(t=>e.league===t.league&&(e.teams||[]).some(team=>String(team.espn_id)===String(t.id||t.key?.split('~')[1])));
  const all=data.events.map(e=>({...ui.withFreshness(e,data),source_projection:e.source_projection||data.source_projection,mine:false})).map(e=>({...e,mine:mine(e)}));
  const CONF={'1':'ACC','4':'Big 12','5':'Big Ten','8':'SEC','9':'Pac-12','12':'C-USA','15':'MAC','17':'Mountain West','151':'American','37':'Sun Belt','18':'Independents','176':'MVFC','29':'CAA','20':'Big Sky','40':'Ivy'};
  const q=(sports.query||'').toLowerCase(),match=e=>!q||e.name.toLowerCase().includes(q)||(e.teams||[]).some(t=>[t.name,t.short,t.abbr].some(v=>v&&String(v).toLowerCase().includes(q)));
  const rows=all.sort((a,b)=>{const rank=e=>e.state==='final'?5:e.source_projection==='deferred'?(e.state==='live'?0:1):e.sources.some(s=>s.eligible===true)?(e.state==='live'?0:1):e.sources.length?2:3;if(sports.order==='time')return new Date(a.start)-new Date(b.start);if(sports.order==='az')return a.name.localeCompare(b.name);return rank(a)-rank(b)||Number(rankedMatchup(b))-Number(rankedMatchup(a))||new Date(a.start)-new Date(b.start);})
   .filter(e=>(sports.league==='All leagues'||e.league===sports.league)&&(sports.view==='all'||sports.view==='live'&&e.state==='live'||sports.view==='final'&&e.state==='final'||sports.view==='upcoming'&&!['live','final'].includes(e.state))
    &&(!sports.network||(e.networks||[]).includes(sports.network))&&sportsFeedMatches(e,sports.hasFeed,ui)&&match(e)&&(!sports.mine||e.mine)&&(!sports.conf||(e.teams||[]).some(t=>t.conference_id===sports.conf))&&(!sports.onTv||e.networks?.length)&&(!sports.ranked||(e.teams||[]).some(rankOf)));
  const dayName=sports.day===today?'Today':new Date(sports.day+'T12:00:00').toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});
  const st=$('.otv-sports-status',board);st.replaceChildren(document.createTextNode(sportsStatusLine(dayName,data,rows.length,all.length)));if(sports.hasFeed&&data.source_projection==='deferred')st.append(document.createTextNode(' · '+sportsFilterCaption()));if(data.poll&&['All leagues','College football'].includes(sports.league))st.append(make('span','otv-status-poll',' · '+data.poll.name+' week '+data.poll.week));
  $('.otv-sports-warning',board).textContent=(data.warnings||[]).length?'Some game information is updating. Last available details are shown.':'';
  // Chips: game state (only the states this day can have), your teams, leagues present, conferences (college), On TV, Watch available, and Clear only when something is set.
  const chips=$('.otv-sports-chips',board);if(chips){const chip=(text,on,fn,key)=>{const b=make('button','otv-chip',text);b.type='button';b.dataset.chipKey=key||text.replace(/\s*\(\d+\)/,'').replace(/\s*·\s*\d+$/,'');b.setAttribute('aria-pressed',String(on));b.onclick=fn;return b;};
   const totals=data.pagination?.facets?.states,liveCount=totals?.live??all.filter(e=>e.state==='live').length,finals=totals?.final??all.filter(e=>e.state==='final').length,later=totals?Object.entries(totals).reduce((n,[k,v])=>n+(!['live','final','unavailable'].includes(k)?Number(v)||0:0),0):all.filter(e=>!['live','final','unavailable'].includes(e.state)).length,leagues=data.pagination?.facets?.leagues||[...new Set(all.map(e=>e.league))];
   const states=[['all','All · '+(data.pagination?.total??all.length)]];if(liveCount||sports.view==='live')states.push(['live','Live ('+liveCount+')']);if(later||sports.view==='upcoming')states.push(['upcoming','Upcoming']);if(finals||sports.view==='final')states.push(['final','Final']);
   /* one state only (e.g. every game still to come): the state chips would all say the same thing */
   if(states.length===2&&sports.view==='all')states.splice(1);
   const set=[...states.map(([k,t])=>chip(t,sports.view===k,()=>{sports.view=k;renderSports(board,api);},k==='all'?'All':undefined))];
   if(followed.length)set.push(chip('Your teams',!!sports.mine,()=>{sports.mine=!sports.mine;renderSports(board,api);}));
   set.push(make('span','otv-chip-gap'),...leagues.map(name=>chip(name,sports.league===name,()=>{sports.league=sports.league===name?'All leagues':name;sports.conf=null;renderSports(board,api);})));
   if(sports.league==='College football'){const counts={};for(const e of all)if(e.league==='College football')for(const id of new Set((e.teams||[]).map(t=>t.conference_id).filter(Boolean)))counts[id]=(counts[id]||0)+1;
    for(const [id] of Object.entries(counts).filter(([id])=>CONF[id]).sort((a,b)=>b[1]-a[1]).slice(0,8))set.push(chip(CONF[id],sports.conf===id,()=>{sports.conf=sports.conf===id?null:id;renderSports(board,api);}));}
   if(all.some(e=>(e.teams||[]).some(rankOf)))set.push(chip('Ranked teams',!!sports.ranked,()=>{sports.ranked=!sports.ranked;renderSports(board,api);}));
   if(all.some(e=>e.networks?.length))set.push(chip('On TV',!!sports.onTv,()=>{sports.onTv=!sports.onTv;renderSports(board,api);}));
   if(!past)set.push(chip('Watch available',!!sports.hasFeed,()=>{cancelSportsFilter();sports.hasFeed=!sports.hasFeed;sports.filterAttempt=null;sports.filterStatus='idle';renderSports(board,api);if(sports.hasFeed)evaluateSportsFilter(board,api);}));
   if(sports.view!=='all'||sports.league!=='All leagues'||sports.hasFeed||sports.mine||sports.conf||sports.onTv||sports.ranked||sports.query||sports.network||sports.order)set.push(chip('Clear filters',false,()=>{sports.query='';const s=$('.otv-sports-search',board);if(s)s.value='';sports.league='All leagues';sports.view='all';cancelSportsFilter();sports.hasFeed=false;sports.mine=false;sports.conf=null;sports.onTv=false;sports.ranked=false;sports.network='';sports.order='';renderSports(board,api);}));
   const group=(label,items)=>{const row=make('div','otv-filter-group');row.setAttribute('role','group');row.setAttribute('aria-label',label);row.append(make('span','otv-filter-label',label),...items);return row;};
   const stateKeys=new Set(['All','Live','Upcoming','Final','Your teams']),leagueKeys=new Set(leagues),statusItems=[],sportItems=[],otherItems=[];
   for(const item of set){if(item.tagName!=='BUTTON')continue;const key=item.dataset.chipKey;if(stateKeys.has(key))statusItems.push(item);else if(leagueKeys.has(key))sportItems.push(item);else otherItems.push(item);}
   const previousLeft=chips.querySelector('.otv-filter-scroll')?.scrollLeft||0;
   chips.replaceChildren(group('Show',statusItems),group('Sport',sportItems));if(otherItems.length)chips.append(group('Refine',otherItems));
   if(matchMedia('(max-width:900px)').matches){
    const strip=make('div','otv-filter-scroll');strip.tabIndex=0;strip.setAttribute('role','group');strip.setAttribute('aria-label','Game filters. Scroll horizontally for more filters.');strip.append(...statusItems,...sportItems,...otherItems);
    const hint=make('span','otv-filter-scroll-hint','Swipe filters →');chips.replaceChildren(hint,strip);strip.scrollLeft=previousLeft;
   }
   const allFilters=make('button','otv-category otv-all-filters-open','All filters');allFilters.type='button';allFilters.setAttribute('aria-haspopup','dialog');allFilters.onclick=()=>openSportsFilters(board,api,allFilters,all,leagues,CONF);chips.prepend(allFilters);
   const advanced=make('details','oe-sports-refine'),summary=make('summary','','More filters & sorting');advanced.open=!!sports.refineOpen;advanced.ontoggle=()=>sports.refineOpen=advanced.open;advanced.append(summary);const bar=make('div','oe-bar');
   const select=(label,values,value,change)=>{const wrap=make('label','oe-select',label),sel=make('select');sel.setAttribute('aria-label',label);for(const [v,t] of values){const o=make('option','',t);o.value=v;sel.append(o);}sel.value=value||'';sel.onchange=()=>{change(sel.value);renderSports(board,api);};wrap.append(sel);bar.append(wrap);};
   select('Network',[['','All networks'],...[...new Set(all.flatMap(e=>e.networks||[]))].sort().map(n=>[n,n])],sports.network,v=>sports.network=v);
   const ids=[...new Set(all.filter(e=>sports.league==='All leagues'||e.league===sports.league).flatMap(e=>(e.teams||[]).map(t=>t.conference_id).filter(Boolean)))];
   select('Conference',[['','All conferences'],...ids.map(id=>[id,CONF[id]||'Conference '+id])],sports.conf,v=>sports.conf=v||null);
   select('Game order',[['','Recommended'],['time','Start time'],['az','Matchup A–Z']],sports.order,v=>sports.order=v);advanced.append(bar);chips.append(advanced);}


  const oldCards=board.__sportsCards||new Map(),nextCards=new Map();let trackerCount=0;
  const cardFor=e=>{
   const key=e.league+'|'+e.id,track=true,signature=JSON.stringify([trackerScope,e.id,e.league,e.name,e.state,e.status,e.start,e.stale,e.watchable,e.source_projection,e.feed_status,e.networks,e.teams,e.sources,e.postseason,e.source_policy,track]),saved=oldCards.get(key);
   let entry=saved;if(!entry||entry.signature!==signature){const stops=[],oldField=saved?.node.querySelector('svg.otv-card-field'),oldKind=saved?.node.querySelector('.otv-board-tracker')?.dataset.kind;entry={signature,node:desktopCard(e,api,stops,track),stops};const freshField=entry.node.querySelector('svg.otv-card-field');if(oldField&&freshField&&window.TelevisionTrackers?.reconcileField){if(freshField.dataset.previewKind){freshField.replaceWith(oldField);if(oldKind)entry.node.querySelector('.otv-board-tracker').dataset.kind=oldKind;}else freshField.replaceWith(window.TelevisionTrackers.reconcileField(oldField,freshField));}}
   entry.node.__sportsEvent=e;trackerCount+=entry.stops.length;nextCards.set(key,entry);return entry.node;
  };
  board.__bandsObserver?.disconnect();grid.replaceChildren();grid.removeAttribute('aria-busy');
  const college=sports.league==='College football'&&!sports.order?rows.filter(e=>e.league==='College football'&&!['final','unavailable'].includes(e.state)):[],collegeKeys=new Set(college.map(e=>e.league+'|'+e.id)),remaining=rows.filter(e=>!collegeKeys.has(e.league+'|'+e.id));
  const pinned=remaining.filter(e=>e.mine&&!['final','unavailable'].includes(e.state)),pinnedKeys=new Set(pinned.map(e=>e.league+'|'+e.id)),rest=remaining.filter(e=>!pinnedKeys.has(e.league+'|'+e.id)),per=phone()?4:8;
  const sectionLinks=[];
  const section=(title,list,opts={})=>{if(!list.length)return;const h=make('h2','otv-sports-section',title);h.tabIndex=-1;h.id='sports-section-'+sectionLinks.length;sectionLinks.push({title,node:h});if(opts.count)h.append(make('span','otv-sports-count',' · '+list.length));grid.append(h);
   const cap=opts.limit||per,shown=opts.band&&!sports.expanded.has(opts.band)?list.slice(0,cap):list;for(const e of shown)grid.append(cardFor(e));
   if(opts.band&&list.length>cap){const open=sports.expanded.has(opts.band);const more=make('button','otv-category otv-band-more',open?'Show fewer':'+ '+(list.length-cap)+' more · '+title);more.type='button';more.dataset.band=opts.band;more.setAttribute('aria-expanded',String(open));more.onclick=()=>{open?sports.expanded.delete(opts.band):sports.expanded.add(opts.band);renderSports(board,api);};grid.append(more);}};
  for(const [i,group] of collegeSections(college,past).entries())section(group.title,group.events,{count:true,band:group.events.length>per?'college:'+i:null});
  section('Your teams',pinned);
  // Source-supported prominence, never a fabricated audience/popularity score.
  const featured=sports.league==='All leagues'&&!sports.query&&!sports.mine&&!sports.conf?rest.filter(e=>e.state==='live'&&(e.postseason===true||rankedMatchup(e))).slice(0,4):[];
  section('Featured live games',featured);const featuredKeys=new Set(featured.map(e=>e.league+'|'+e.id));
  // Keep each sport understandable while preserving the existing evidence-based ordering.
  const liveGroups=new Map();for(const event of rest.filter(e=>e.state==='live'&&!featuredKeys.has(e.league+'|'+e.id))){const key=event.league||'Other sports';if(!liveGroups.has(key))liveGroups.set(key,[]);liveGroups.get(key).push(event);}
  for(const [league,games] of liveGroups)section(league+' · Live now',games,{count:true,band:games.length>per?'live:'+league:null});
  const upcoming=rest.filter(e=>!['live','final','unavailable'].includes(e.state));
  const grouped=(events)=>{const groups=new Map();for(const event of events){const league=event.league||'Other sports';if(!groups.has(league))groups.set(league,[]);groups.get(league).push(event);}return groups;};
  for(const [league,games] of grouped(upcoming.slice().sort((a,b)=>new Date(a.start)-new Date(b.start))))section(league+' · '+(past?'Not played':'Upcoming'),games,{count:true,band:games.length>per?'upcoming:'+league:null});
  for(const [league,games] of grouped(rest.filter(e=>e.state==='final')))section(league+' · Final',games,{count:true,band:games.length>per?'final:'+league:null});
  section('Canceled or postponed',rest.filter(e=>e.state==='unavailable'));
  let jump=board.querySelector('.otv-section-jump');if(!jump){jump=make('label','otv-section-jump');jump.append(make('span','','Jump to section'));const select=make('select','otv-category');select.setAttribute('aria-label','Jump to sports section');jump.append(select);grid.before(jump);}jump.hidden=sectionLinks.length<2;const select=jump.querySelector('select'),selected=select.value,signature=JSON.stringify(sectionLinks.map(x=>x.title));if(select.dataset.sections!==signature){const prompt=make('option','','Choose a section');prompt.value='';select.replaceChildren(prompt);sectionLinks.forEach(({title})=>{const option=make('option','',title);option.value=title;select.append(option);});select.value=sectionLinks.some(x=>x.title===selected)?selected:'';select.dataset.sections=signature;}select.onchange=()=>{const target=sectionLinks.find(x=>x.title===select.value)?.node;if(target){target.scrollIntoView({block:'start',behavior:'instant'});target.focus({preventScroll:true});}};
  if(!rows.length)grid.append(make('p','otv-no-results',sportsMetadataPending(data)?(sports.progressive?.exhausted?'Game and feed information is still updating. Select Refresh to retry.':'Loading game and feed information…'):data.pagination?.remaining_bands?.length?'More games are available below. Load them to check these filters.':all.length?'No games match these filters. Clear them or try another day.':'No games on this day.'));
  if(data.pagination?.remaining_bands?.length){
   const more=make('button','otv-category otv-fetch-band',past?'Show more games':'Show later kickoff times');more.type='button';grid.append(more);
   more.onclick=()=>{more.disabled=true;more.textContent='Loading later games…';loadNextSportsBand(board,api);};
   if(window.IntersectionObserver){board.__bandsObserver?.disconnect();board.__bandsObserver=new IntersectionObserver(entries=>{
    if(entries.some(e=>e.isIntersecting)&&more.isConnected){board.__bandsObserver.disconnect();more.click();}
   },{rootMargin:'120px'});board.__bandsObserver.observe(more);}
  }
  // A quiet day points at what's next.
  if(!sportsMetadataPending(data)&&sports.day===today&&rows.length<=2&&sports.view==='all'&&!q){const next=new Date(sports.day+'T12:00:00');next.setDate(next.getDate()+1);const nd=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-'+String(next.getDate()).padStart(2,'0');
   const card=make('button','otv-coming-up');card.type='button';card.append(make('span','otv-panel-label','Coming up'),make('strong','','Tomorrow'),make('span','','Loading…'));card.onclick=()=>board.__setDay?.(nd);grid.append(card);
   const paint=d=>{if(sportsMetadataPending(d)){card.lastChild.textContent='Schedule is updating…';return;}const evs=(d.events||[]).slice().sort((a,b)=>new Date(a.start)-new Date(b.start));const mineNext=evs.filter(mine);card.lastChild.textContent=evs.length?evs.length+(evs.length===1?' game':' games')+' · first at '+clock(evs[0].start)+(mineNext.length?' · '+mineNext.map(e=>e.name).slice(0,2).join(', '):''):'No games scheduled';(sports.counts=sports.counts||{})[nd]=evs.length;board.__paintDay?.();};
   if(sports.nextDay?.day===nd&&Date.now()-sports.nextDay.at<600000)paint(sports.nextDay.data);else requestSportsCardsData(api,nd).then(d=>{sports.nextDay={day:nd,at:Date.now(),data:d};if(card.isConnected)paint(d);}).catch(()=>card.remove());}
  for(const [key,entry] of oldCards)if(nextCards.get(key)!==entry)for(const stop of entry.stops)stop();
  board.__sportsCards=nextCards;sports.trackerStops=[...nextCards.values()].flatMap(entry=>entry.stops);
  if(focusId){const cards=[...grid.querySelectorAll('button')];(cards.find(n=>n.dataset.eventId===focusId)||cards[Math.min(Math.max(0,focusIndex),cards.length-1)])?.focus({preventScroll:true});}
  else if(focusBand)grid.querySelector(`[data-band="${CSS.escape(focusBand)}"]`)?.focus({preventScroll:true});
  else if(focusChip)[...board.querySelectorAll('[data-chip-key]')].find(n=>n.dataset.chipKey===focusChip)?.focus({preventScroll:true});
  livePhase(board,'complete',api,presentation.user,presentation.route,presentation.identity);window.OrbitalSettle?.end();
 }
 async function rankingsDialog(api,trigger,search,board){
  cancelSportsFilter();
  // FBS Top 25 (AP + Coaches; CFP from late October). The server caches for six hours; one request per page visit.
  if(!sports.rankings||Date.now()-(sports.rankingsAt||0)>6*3600*1000){
   trigger.disabled=true;try{sports.rankings=await api.ajax({type:'GET',url:api.getUrl('sports/api/rankings'),dataType:'json'});sports.rankingsAt=Date.now();}
   catch{sports.rankings=null;$('.otv-sports-warning',board).textContent='Rankings are unavailable right now. Try again shortly.';}finally{trigger.disabled=false;}
  }
  const data=sports.rankings;if(!data?.polls?.length)return;
  document.querySelector('.otv-sports-dialog')?.remove();
  const dialog=make('dialog','otv-sports-dialog otv-rankings');dialog.setAttribute('aria-label','College football Top 25');
  const close=make('button','otv-category','Close');close.type='button';close.onclick=()=>dialog.close();
  const title=make('h2','',''),note=make('p','otv-description',''),chips=make('div','otv-control-row otv-poll-chips'),list=make('ol','otv-rankings-list');
  let index=Math.min(sports.pollIndex||0,data.polls.length-1);
  const paint=()=>{const poll=data.polls[index];title.textContent=(poll.short||poll.name)+' · Week '+poll.week;
   const released=poll.date?new Date(poll.date).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}):'';
   note.textContent=['FBS'+(released?' · released '+released:''),data.stale?'Older copy: ESPN did not answer':'','Select a team to find its games'].filter(Boolean).join(' · ');
   chips.replaceChildren(...data.polls.map((p,i)=>{const b=make('button','otv-category',p.short||p.name);b.type='button';b.setAttribute('aria-pressed',String(i===index));b.onclick=()=>{index=i;sports.pollIndex=i;paint();};return b;}));
   list.replaceChildren(...poll.teams.map(team=>{const item=make('li','');const row=make('button','otv-ranking-row');row.type='button';
    const trend=String(team.trend||'-'),up=trend.startsWith('+'),down=trend.startsWith('-')&&trend.length>1;
    row.append(make('span','otv-ranking-rank',String(team.rank)));
    if(window.OrbitalArtwork.url(team.logo)){const img=make('img','otv-team-logo');img.src=team.logo;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();row.append(img);}else row.append(make('span','otv-team-monogram',(team.abbreviation||team.short||'').slice(0,3)));
    row.append(make('span','otv-ranking-name',team.name),make('span','otv-ranking-record',team.record||''));
    const move=make('span','otv-ranking-trend',up?'▲ '+trend.slice(1):down?'▼ '+trend.slice(1):'–');move.dataset.dir=up?'up':down?'down':'flat';row.append(move);
    row.setAttribute('aria-label','Number '+team.rank+', '+team.name+', '+(team.record||'')+', '+(trend==='-'?'unchanged':'moved '+trend));
    row.onclick=()=>{search.value=team.name;sports.query=team.name;dialog.close();renderSports(board,api);};item.append(row);return item;}));
  };
  paint();dialog.append(close,make('p','otv-eyebrow','COLLEGE FOOTBALL'),title,note,chips,list);
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();dialog.close();}});dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus();});document.body.append(dialog);dialog.showModal();$('.otv-ranking-row',list)?.focus();
 }

 function desktopCard(e,api,stops,track=true){const ui=window.TelevisionFeedUi,art=(e,t)=>window.OrbitalArtwork.team(e,t),hex=c=>/^[0-9a-f]{6}$/i.test(String(c||''))?'#'+c:null;const card=make('button','otv-sports-game otv-card2');card.type='button';card.dataset.eventId=e.league+'|'+e.id;card.dataset.state=e.state;if(e.source_projection==='deferred')card.dataset.feeds='unknown';else card.dataset.feeds=String(e.sources.length);
   const scoreLabel=(e.state==='live'||e.state==='final')?(e.teams||[]).filter(t=>t.score!=null&&String(t.score).trim()!=='').map(t=>t.name+' '+t.score).join(', '):'';card.setAttribute('aria-label',e.name+' · '+e.status+(scoreLabel?' · '+scoreLabel:''));
   const teams=(e.teams||[]).slice().sort((a,b)=>Number(a.side==='home')-Number(b.side==='home'));const [away,home]=[teams[0]||{},teams[1]||{}];
   const ca=hex(art(e,away).color),cb=hex(art(e,home).color);if(ca)card.style.setProperty('--team-a',ca);if(cb)card.style.setProperty('--team-b',cb);
   const top=make('div','otv-card2-top');if(e.state==='live')top.append(make('span','otv-live-pill','LIVE'));const truthText=e.state==='final'?(e.status&&/final/i.test(e.status)?e.status:'Final'):ui.truth(e);top.append(make('span','otv-card2-league',e.league),make('span','otv-card2-status'+(truthText==='Scheduled'?' is-redundant':''),truthText==='Scheduled'?'':truthText));if(rankedMatchup(e))top.append(make('span','otv-top25','Top 25'));
   const side=t=>{const s=make('span','otv-card2-side'),a={...art(e,t)};if(!a.url&&e.league==='MLS'&&/^[0-9]{1,9}$/.test(String(t.espn_id||'')))a.url='https://a.espncdn.com/i/teamlogos/soccer/500/'+t.espn_id+'.png';if(window.OrbitalArtwork.url(a.url)){const img=make('img','otv-team-logo');img.src=a.url;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();s.append(img);}else s.append(make('span','otv-team-monogram',(a.abbr||String(t.name||'').slice(0,3)).toUpperCase()));const n=make('span','otv-card2-name',(rankOf(t)?'#'+rankOf(t)+' ':'')+(t.name||t.short||''));n.title=t.name||'';s.append(n);if(typeof t.record==='string'&&/^\d{1,3}(-\d{1,3}){1,2}$/.test(t.record))s.append(make('small','otv-card2-rec',t.record));return s;};
   const has=(e.state==='live'||e.state==='final')&&teams.every(t=>t.score!=null&&String(t.score).trim()!=='');
   const row=(t,o)=>{const r=make('div','otv-card2-row');r.append(side(t),make('span','otv-card2-pts',has?String(t.score):''));if(has&&Number(t.score)<Number(o.score))r.classList.add('trail');return r;};const mid=make('div','otv-card2-rows');mid.append(row(away,home),row(home,away));if(!has&&e.state!=='final')top.append(make('span','otv-card2-clock',clock(e.start)));if(e.networks?.length&&e.state!=='final')top.append(make('span','otv-card2-net',e.networks[0]));
   const first=ui.eligible(e)[0]||ui.sources(e).find(s=>!s.automatic),choices=ui.sources(e).filter(s=>!s.automatic);
   const far=e.state==='scheduled'&&Date.parse(e.start)-Date.now()>3*3600e3&&!first;const feed=e.state==='final'?'Highlights & recap · box score · plays':e.source_projection==='deferred'?'Feeds in Game Center':e.state==='unavailable'?'':far?(e.networks?.length?'On '+e.networks.join(' · ')+' · feeds are checked closer to game time':'Feeds are checked closer to game time'):e.stale?'Saved game data':first?(ui.eligible(e).length?'▶ Watch · ':'')+(ui.eligible(e).length?(choices.length===1?'1 feed':choices.length+' feeds'):(choices.length===1?'1 feed choice':choices.length+' feed choices')):e.feed_status==='preparing'?'Feed found · getting ready':'No feed found yet';if(first&&e.state!=='final')card.title=ui.label(first,e)+' first';
   card.append(top,mid,make('span','otv-sports-feed-count',feed));card.__sportsEvent=e;card.onclick=()=>sportsChooser(card.__sportsEvent||e,api,card);
   if(e.state==='live'&&track&&window.TelevisionTrackers){const slot=make('div','otv-board-tracker otv-sit');const prepared=window.TelevisionTrackers.previewField(e);if(prepared){slot.dataset.preparedKind=prepared.dataset.previewKind;slot.append(prepared);}slot.append(make('span','otv-board-context',e.status||'Live'));card.insertBefore(slot,card.lastChild);const statusNode=top.querySelector('.otv-card2-status'),points=[...mid.querySelectorAll('.otv-card2-pts')];stops.push(window.TelevisionTrackers.watch(e,slot,d=>{if(d.kind==='unknown'&&/temporarily/i.test(d.unavailable_reason||'')){if(!slot.dataset.kind)slot.replaceChildren(make('span','otv-board-context','Situation update unavailable · retrying · Open game'));return;}const retainedField=slot.querySelector('svg.otv-card-field');if((d.latest_reported||!d.stale)&&['live','final'].includes(d.state)){const stateChanged=e.state!==d.state;e.state=d.state;e.status=d.status;e.teams=d.teams||e.teams;
 if(stateChanged){const owner=card.closest('.otv-sports'),original=sports.data?.events?.find(row=>String(row.id)===String(e.id)&&row.league===e.league&&row.start===e.start);if(owner&&original){Object.assign(original,{state:e.state,status:e.status,teams:e.teams});delete owner.dataset.renderKey;requestAnimationFrame(()=>{if(owner.isConnected)renderSports(owner,api);});}}if(card.__sportsEvent&&card.__sportsEvent!==e)Object.assign(card.__sportsEvent,{state:e.state,status:e.status,teams:e.teams});card.setAttribute('aria-label',e.name+' · '+d.status+' · '+e.teams.map(t=>t.name+' '+(t.score??'')).join(', '));card.dataset.state=d.state;if(d.state==='final'){top.querySelector('.otv-live-pill')?.remove();card.querySelector('.otv-sports-feed-count').textContent='Final · Game details';}}if((d.latest_reported||!d.stale)&&['live','final'].includes(d.state)){if(d.status&&statusNode)statusNode.textContent=d.status;const bySide={};for(const t of d.teams||[])if(t.score!=null&&String(t.score).trim()!=='')bySide[t.side]=String(t.score);if(bySide.away!=null&&points[0])points[0].textContent=bySide.away;if(bySide.home!=null&&points[1])points[1].textContent=bySide.home;}if(!d.kind||d.kind==='unknown'){slot.classList.add('is-unavailable');slot.removeAttribute('data-kind');slot.replaceChildren(make('span','otv-board-context','Live situation unavailable · Open game for details'));return;}slot.classList.remove('is-unavailable');slot.dataset.kind=d.kind;const reported=d.stale?{...d,reference_estimated:true,estimated:true,exact:false}:d;const graphic=['football','baseball','basketball','hockey','soccer'].includes(reported.kind)?window.TelevisionTrackers.updateCardField(retainedField,reported):sitGraphic(reported);const contents=[];if(graphic)contents.push(graphic);const text=make('div','otv-sit-text'),head=sitHeadline(d),last=sitLast(d);if(head)text.append(make('strong','otv-sit-head',head));if(last)text.append(make('span','otv-sit-last',last));if(!head&&!last)text.append(make('span','otv-sit-last',d.status||'Live'));if(d.stale)text.append(make('small','otv-sit-last','Saved reported situation · retrying'));if(reported.kind==='football'){const plays=window.TelevisionTrackers.footballRows(reported),earlier=plays.slice(0,-8);if(earlier.length){text.append(make('small','otv-drive-earlier',earlier.length+' earlier '+(earlier.length===1?'play':'plays')+' · Showing the latest 8'));}}contents.push(text);for(const old of [...slot.children])if(!contents.includes(old))old.remove();for(const child of contents)if(child.parentNode!==slot)slot.append(child);},1500,{maxAgeMs:1000}));}return card;}
 window.OrbitalSportsCards={teams:sportsTeams,open:sportsChooser,feeds:(event,api,trigger)=>sportsChooser(event,api,trigger,{feedsOnly:true}),card:desktopCard};
 async function sportsBoard(tab,api,user){
  if(!liveRoute('sports'))return;const pageRoute=location.hash,identity=sessionKey(api,user);let board=$('.otv-sports',tab);
  if(!board){board=make('section','otv-sports otv-v2 orbital-personal otv-board3');
   const head=make('header','otv-board-head'),title=make('div','otv-board-title');title.append(make('p','otv-eyebrow','SPORTS'),make('h1','','Sports'),make('p','otv-description','Live games first. Choose a game to watch or follow every play.'));
   const actions=make('div','otv-board-actions');
   const search=make('input','otv-sports-search');search.type='search';search.placeholder='Find a team';search.setAttribute('aria-label','Find a team');search.value=sports.query;search.oninput=()=>{sports.query=search.value;renderSports(board,api);};
   const top25=make('button','otv-category','Top 25');top25.type='button';top25.setAttribute('aria-haspopup','dialog');top25.onclick=()=>rankingsDialog(api,top25,search,board);
   const refresh=make('button','otv-category otv-board-refresh','Refresh');refresh.type='button';refresh.title='Refresh now · the board also refreshes on its own';refresh.setAttribute('aria-label','Refresh scores');refresh.onclick=()=>{cancelSportsFilter();sports.filterAttempt=null;sports.filterStatus='idle';stopSportsProgress();sports.refreshRequested=true;sports.error=null;queue();};
   const teams=make('button','otv-category','Teams');teams.type='button';teams.onclick=()=>window.OrbitalSportsExplore.teams(api,teams);actions.append(search,teams,top25,refresh);head.append(title,actions);
   /* The day is part of the filters. Today is the resting state; ‹ › step a day; the selected date opens a date picker. */
   const bar=make('div','otv-board-bar'),day=make('div','otv-day');day.setAttribute('role','group');day.setAttribute('aria-label','Game day');
   const prev=make('button','otv-day-step','‹'),pick=make('button','otv-day-pick'),next=make('button','otv-day-step','›');for(const b of [prev,pick,next])b.type='button';
   prev.setAttribute('aria-label','Previous day');next.setAttribute('aria-label','Next day');pick.setAttribute('aria-expanded','false');pick.setAttribute('aria-controls','otv-day-ribbon');
   const ribbon=make('div','otv-day-ribbon');ribbon.id='otv-day-ribbon';ribbon.hidden=true;ribbon.setAttribute('aria-label','Choose a day');const calendar=make('input','otv-sports-search otv-game-date');calendar.type='date';calendar.setAttribute('aria-label','Game date');ribbon.append(calendar);
   const base=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})+'T12:00:00'),iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
   const days=[];for(let i=-7;i<7;i++){const d=new Date(base);d.setDate(d.getDate()+i);days.push({i,value:iso(d),d});}
   const nameOf=x=>x.i===0?'Today':x.i===-1?'Yesterday':x.i===1?'Tomorrow':x.d.toLocaleDateString([], {weekday:'long'});
   const paintDay=()=>{const k=Math.max(0,days.findIndex(x=>x.value===sports.day)),x=days[k];pick.replaceChildren(make('strong','',nameOf(x)),make('span','',x.d.toLocaleDateString([], {month:'short',day:'numeric'})));
    pick.setAttribute('aria-label','Game day: '+nameOf(x)+', '+x.d.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})+'. Open the date picker');prev.disabled=k===0;next.disabled=k===days.length-1;
    calendar.value=sports.day;calendar.min=days[0].value;calendar.max=days.at(-1).value;};
   const setDay=v=>{if(v===sports.day)return;cancelSportsFilter();sports.day=v;stopSportsProgress();board.__bandCount=3;sports.data=null;{const g=$('.otv-sports-grid',board);if(g){for(const stop of sports.trackerStops||[])stop();sports.trackerStops=[];board.__sportsCards?.clear();board.__bandsObserver?.disconnect();delete board.dataset.renderKey;const sk=[];for(let i=0;i<(phone()?3:8);i++)sk.push(make('div','otv-card-skeleton'));g.replaceChildren(...sk);g.setAttribute('aria-busy','true');}}sports.serial++;delete board.dataset.renderKey;paintDay();queue();};
   calendar.onchange=()=>{if(days.some(x=>x.value===calendar.value))setDay(calendar.value);ribbon.hidden=true;pick.setAttribute('aria-expanded','false');pick.focus();};
   ribbon.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();ribbon.hidden=true;pick.setAttribute('aria-expanded','false');pick.focus();}});
   pick.onclick=()=>{ribbon.hidden=!ribbon.hidden;pick.setAttribute('aria-expanded',String(!ribbon.hidden));if(!ribbon.hidden){calendar.focus();try{calendar.showPicker?.();}catch(_){}}};
   prev.onclick=()=>{const k=days.findIndex(x=>x.value===sports.day);if(k>0)setDay(days[k-1].value);};next.onclick=()=>{const k=days.findIndex(x=>x.value===sports.day);if(k<days.length-1)setDay(days[k+1].value);};
   day.append(prev,pick,next);bar.append(day,make('div','otv-sports-chips'));board.__paintDay=paintDay;board.__setDay=setDay;paintDay();
   board.append(head,bar,ribbon);window.OrbitalFollowed?.load().then(list=>{if(list.length&&board.isConnected){delete board.dataset.renderKey;renderSports(board,api);}});
   const status=make('p','otv-sports-status','Loading games…');status.setAttribute('role','status');board.append(status,make('p','otv-sports-warning'),make('div','otv-sports-grid'));tab.append(board);
  }
  board.__pageReadyOwner={api,user,identity,route:pageRoute};
  const dayKey=identity+'|cards|'+sports.day,retryDue=sports.error?.key===dayKey&&sports.error.retryAt!==null&&Date.now()>=sports.error.retryAt;
  const refreshDue=sports.refreshRequested||sports.progressiveDue||retryDue||!sports.data||Date.now()-(sports.loadedAt||0)>60000;
  if(sports.data){renderSports(board,api);if(!refreshDue){evaluateSportsFilter(board,api);if(sportsMetadataPending(sports.data))scheduleSportsProgress(board,api,sports.data,identity,dayKey);return;}}
  if(sports.error&&sports.error.key===dayKey&&(sports.error.retryAt===null||Date.now()<sports.error.retryAt))return;
  if(sports.pending?.key===dayKey)return;
  cancelSportsFilter();if(sports.filterStatus==='ready')sports.filterStatus='paused';const serial=++sports.serial,request={key:dayKey,serial};sports.pending=request;sports.refreshRequested=false;sports.progressiveDue=false;delete board.dataset.renderKey;$('.otv-sports-status',board).textContent=sports.data?'Updating game and feed information…':'Loading games…';if(!sports.data&&sports.previous?.key!==dayKey)$('.otv-sports-grid',board).replaceChildren();
  try{const data=await requestSportsCardsData(api,sports.day);
   if(location.hash!==pageRoute||serial!==sports.serial||!sessionCurrent(api,identity))return;
   const saved=sports.previous?.key===dayKey?sports.previous.data:null;const prior=data.source_projection==='deferred'&&saved?{...saved,source_projection:'deferred',events:saved.events.map(e=>({...e,source_projection:'deferred',sources:[],watchable:undefined,feed_status:undefined}))}:saved;
   sports.data=sportsMetadataPending(data)&&prior?.events?.length?{...prior,metadata_pending:true,channel_inventory_pending:data.channel_inventory_pending===true,retry_after_seconds:data.retry_after_seconds,warnings:[...(prior.warnings||[]),'Game and feed information is updating; earlier results retained']}:data;
   sports.loadedAt=Date.now();if(!sportsMetadataPending(data)){(sports.counts=sports.counts||{})[sports.day]=(data.pagination?.total??data.events?.length??0);sports.previous={key:dayKey,data};}board.__paintDay?.();sports.error=null;scheduleSportsProgress(board,api,data,identity,dayKey);renderSports(board,api);evaluateSportsFilter(board,api);
  }catch(error){if(location.hash===pageRoute&&sessionCurrent(api,identity)&&serial===sports.serial){const status=error?.status,terminal=status===401||status===403,tries=sports.error?.key===dayKey?sports.error.tries+1:1;sports.error={key:dayKey,status,tries,retryAt:terminal?null:Date.now()+Math.min(300000,15000*2**(tries-1))};if(!terminal)setTimeout(queue,sports.error.retryAt-Date.now()+50);const message=status===401?'Your session expired. Sign in again.':status===403?'Live TV is not enabled for this account.':'Could not load sports. Select Refresh to retry.';if(!terminal&&sports.previous?.key===dayKey){sports.data=sports.previous.data;delete board.dataset.renderKey;renderSports(board,api);$('.otv-sports-status',board).textContent='Showing earlier results · '+message;}else {if(terminal){stopSportsProgress();sports.data=null;sports.previous=null;for(const stop of sports.trackerStops||[])stop();sports.trackerStops=[];board.__sportsCards?.clear();$('.otv-sports-grid',board).replaceChildren();}$('.otv-sports-status',board).textContent=message;livePhase(board,'error',api,user,pageRoute,identity,()=>serial===sports.serial);}}}
  finally{if(sports.pending===request)sports.pending=null;if(serial!==sports.serial)queue();}
 }
 function tabReset(page){page.querySelectorAll('[data-otv-rendered]').forEach(n=>n.removeAttribute('data-otv-rendered'));}
 async function update(){
  const api=window.ApiClient,user=api?.getCurrentUserId?.(),identity=user?sessionKey(api,user):null,page=$('#liveTvSuggestedPage:not(.hide)')||$('#liveTvPage'),pageRoute=location.hash;
  if(api)patchNativeChannelQuery(api);
  if(sports.user!==user||sports.identity!==identity){cancelSportsFilter();stopSportsProgress();sports.user=user;sports.identity=identity;sports.data=null;sports.previous=null;sports.error=null;sports.nextDay=null;sports.serial++;for(const stop of sports.trackerStops||[])stop();sports.trackerStops=[];document.querySelectorAll('.otv-sports-dialog').forEach(n=>{n.dispatchEvent(new Event('close'));n.remove();});document.querySelectorAll('.otv-sports').forEach(n=>n.remove());}
  document.documentElement.classList.toggle('otv-active',Boolean(user&&page&&/^#\/livetv(?:[?&]|$)/.test(location.hash)));
  if(S.user!==user||S.identity!==identity){S.user=user;S.identity=identity;S.channels=[];S.fetched=0;S.empty.clear();S.guideCache.clear();channelCache.clear();S.channelLimit=BATCH.channels;S.guideLimit=BATCH.guide;S.programLimit=BATCH.programs;S.group=user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')?'Favorites':'All channels';S.query='';S.guideGroup=S.group;S.guideQuery='';document.querySelectorAll('.otv-heading,.otv-controls,.otv-channel-grid,.otv-program-shelf,.otv-full-guide,.otv-empty,.otv-empty-error').forEach(n=>n.remove());document.querySelectorAll('.otv-channels-ready,.otv-programs-ready,.otv-full-guide-ready').forEach(n=>n.classList.remove('otv-channels-ready','otv-programs-ready','otv-full-guide-ready'));document.querySelectorAll('.orbital-native-hidden').forEach(n=>{n.inert=false;n.hidden=false;n.removeAttribute('aria-hidden');n.classList.remove('orbital-native-hidden');});}
  if(!user||!page||!/^#\/livetv(?:[?&]|$)/.test(location.hash))return;
  {const params=new URLSearchParams(location.hash.split('?')[1]||'');if(params.has('phoneQuery')&&S.phoneSearchRoute!==location.hash){S.phoneSearchRoute=location.hash;const text=params.get('phoneQuery').slice(0,120);if(params.get('sports')==='1'){sports.query=text;const input=$('.otv-sports-search',page);if(input)input.value=text;}else{S.query=text;S.group='All channels';S.channelLimit=BATCH.channels;S.fetched=0;const input=$('.otv-search input',page);if(input)input.value=text;tabReset(page);}}else if(!params.has('phoneQuery'))S.phoneSearchRoute='';}

  page.classList.add('otv-page');let tab=$('.pageTabContent.is-active',page);
  if(!tab&&page.id==='liveTvPage'){
   tab=page.firstElementChild;
   const index=Number(new URLSearchParams(location.hash.split('?')[1]||'').get('tab')||0);
   // Pinned v12 wrapper contract. Unknown layouts retain native content.
   if(!Number.isInteger(index)||index<0||index>5||!tab||!tab.matches('.MuiBox-root,.pageTabContent,.verticalSection'))return;
   if(tab)tab.id=['suggestionsTab','guideTab','channelsTab','recordingsTab','scheduleTab','seriesTab'][index]||'suggestionsTab';
  }
  if(!tab)return;
  if(sports.user!==user||sports.identity!==identity){cancelSportsFilter();stopSportsProgress();sports.user=user;sports.identity=identity;sports.data=null;sports.previous=null;sports.error=null;sports.nextDay=null;sports.serial++;for(const stop of sports.trackerStops||[])stop();sports.trackerStops=[];document.querySelectorAll('.otv-sports-dialog').forEach(n=>{n.dispatchEvent(new Event('close'));n.remove();});document.querySelectorAll('.otv-sports').forEach(n=>n.remove());}
  if(!$('.otv-sports-nav',tab)){const nav=make('nav','otv-sports-nav orbital-personal');nav.setAttribute('aria-label','Live TV sections');nav.append(link('Sports','#/livetv?tab=0&sports=1','otv-category'),link('Channel guide','#/livetv?tab=1','otv-category'),link('Channels','#/livetv?tab=2','otv-category'));tab.prepend(nav);}
  const sectionNav=$('.otv-sports-nav',tab);
  if(!$('.otv-more-sections',sectionNav)){const more=make('details','otv-more-sections');more.append(make('summary','otv-category','More'));const list=make('div','otv-more-menu');for(const [label,index] of [['Programs',0],['Recordings',3],['Schedule',4],['Series recordings',5]]){const a=link(label,'#/livetv?tab='+index);a.onclick=()=>{more.open=false;};list.append(a);}more.append(list);sectionNav.append(more);}
  if(matchMedia('(max-width:900px)').matches)requestAnimationFrame(()=>{if(tab.isConnected&&tab.lastElementChild!==sectionNav)tab.append(sectionNav);});
  page.classList.add('otv-navigation-ready');
  for(const a of tab.querySelectorAll('.otv-sports-nav a')){const current=a.hash===location.hash;if(current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  const showSports=tab.id==='suggestionsTab'&&new URLSearchParams(location.hash.split('?')[1]||'').get('sports')==='1';tab.classList.toggle('otv-sports-mode',showSports);
  page.classList.toggle('otv-sports-page',showSports);
  if(showSports){sportsBoard(tab,api,user);return;}
  if(emptyInfo[tab.id]){emptyState(tab,api,user);window.OrbitalSettle?.end();return;}
  const cold=!S.channels.length&&['channelsTab','guideTab','suggestionsTab'].includes(tab.id);
  if(cold)loadingNote(tab,tab.id==='guideTab'?'Loading your guide…':'Loading your channels…');
  try{await load(api,user);}catch{if(location.hash!==pageRoute||!sessionCurrent(api,identity))return;clearLoading(tab);if(window.OrbitalPageReady?.managed())void window.OrbitalPageReady.fail('Channels could not finish loading. Please retry.');window.OrbitalSettle?.end();if(tab.id==='channelsTab'){tab.classList.remove('otv-channels-ready');loadingNote(tab,'Channels could not be loaded right now. The standard guide below stays available.');}return;}
  clearLoading(tab);
  if(location.hash!==pageRoute||!sessionCurrent(api,identity)||S.user!==user||!tab.isConnected)return;
  if(tab.id==='channelsTab'){
   heading(tab,'A world of channels','Find a favourite. Try something new. Your whole lineup, in one place.');
   if(!$('.otv-controls',tab))$('.otv-heading',tab).after(controls(tab));
   if(tab.dataset.otvRendered!==String(S.fetched)||!$('.otv-channel-grid',tab))renderChannels(tab,api);else {isolateNative(tab);livePhase($('.otv-channel-grid',tab),'complete',api,user,pageRoute,identity);}
  }else if(tab.id==='guideTab')enhanceGuide(tab,api,user);else if(tab.id==='suggestionsTab')renderProgramShelf(tab,api);
 }
 window.addEventListener('orbital:page-retry',event=>{if(event.detail?.route===location.hash&&/^#\/livetv(?:[?&]|$)/.test(location.hash)&&window.OrbitalPageReady?.managed())location.reload();});
 let timer;const queue=()=>{if(!timer)timer=setTimeout(()=>{timer=null;update();},180);};
 new MutationObserver(records=>{if(records.some(r=>r.addedNodes.length)){for(const record of records){const tab=record.target.nodeType===1?record.target.closest?.('.otv-channels-ready,.otv-programs-ready,.otv-full-guide-ready'):null;if(tab)isolateNative(tab);}queue();}}).observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('hashchange',()=>{cancelSportsFilter();if(timer){clearTimeout(timer);timer=null;}requestAnimationFrame(()=>{if(!timer)update();});});document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelSportsFilter();queue();});
 // Jellyfin emits pagehide for SPA views; only a browser transition suspends the board clock.
 let refresh=null;
 const resumeSportsRefresh=()=>{if(refresh===null)refresh=setInterval(()=>{if(!document.hidden&&!$('.otv-channel-grid')?.contains(document.activeElement))queue();},60000);};
 window.addEventListener('pagehide',event=>{if(!(event instanceof PageTransitionEvent)){queue();return;}cancelSportsFilter();clearInterval(refresh);refresh=null;});
 window.addEventListener('pageshow',()=>{resumeSportsRefresh();sports.refreshRequested=true;queue();});
 resumeSportsRefresh();queue();
})();

/* Sept 28 (Claude): highlight reels + finished-game recap. Shared by the Game center and the team page.
   window.OrbitalReels: card(video), row(videos), open(video, opener)   window.OrbitalRecap.mount(dialog, event, api) */
(()=>{
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const safeYt=id=>/^[A-Za-z0-9_-]{11}$/.test(String(id||''));
 const okImg=u=>typeof u==='string'&&/^https:\/\/(a\.espncdn\.com|espnmedia-cdn\.akamaized\.net|i\.ytimg\.com)\//.test(u);
 const okMp4=u=>typeof u==='string'&&/^https:\/\/espnmedia-cdn\.akamaized\.net\/.+\.mp4$/.test(u);
 const dur=v=>typeof v.duration==='number'?Math.floor(v.duration/60)+':'+String(v.duration%60).padStart(2,'0'):v.duration||'';
 const who=v=>v.kind==='espn'?'ESPN':v.channel||'YouTube';
 /* Android apps (official + Orbital Phone) host the web client in a WebView without fullscreen support:
    hide the dead fullscreen buttons there; turning the phone sideways fills the screen instead (CSS). */
 const inApp=()=>!!window.NativeInterface||/OrbitalPhone|; wv\)/.test(navigator.userAgent);
 function thumb(v,big){const i=el('img','orv-thumb');i.alt='';i.loading='lazy';i.decoding='async';
   if(v.kind==='youtube'&&safeYt(v.id)){const tries=[big?'maxresdefault':'hq720','mqdefault','hqdefault'];let k=0;i.src='https://i.ytimg.com/vi/'+v.id+'/'+tries[0]+'.jpg';
     i.onerror=()=>{k++;if(k<tries.length)i.src='https://i.ytimg.com/vi/'+v.id+'/'+tries[k]+'.jpg';else i.remove();};
     i.onload=()=>{if(i.naturalWidth<=120&&k<tries.length-1){k++;i.src='https://i.ytimg.com/vi/'+v.id+'/'+tries[k]+'.jpg';}};}
   else if(okImg(v.thumb))i.src=v.thumb;else return el('span','orv-thumb orv-thumb-blank');
   return i;}
 function card(v,opts={}){
   const b=el('button','orv-card'+(opts.big?' orv-card-big':''));b.type='button';b.dataset.videoId=v.id||v.src||'';
   const art=el('span','orv-art');art.append(thumb(v,opts.big),el('span','orv-play'));const d=dur(v);if(d)art.append(el('span','orv-dur',d));
   if(opts.badge){const x=el('span','orv-badge',opts.badge);if(opts.tone)x.dataset.tone=opts.tone;art.append(x);}
   const meta=el('span','orv-meta');meta.append(el('strong','',opts.title||v.title||'Video'),el('small','',[opts.sub,who(v),v.official==='league'?'Official':v.official==='team'?'Team channel':''].filter(Boolean).join(' · ')));
   b.append(art,meta);b.setAttribute('aria-label','Play video: '+(opts.title||v.title||'')+' · '+who(v));
   b.onclick=()=>open(v,b);return b;}
 function row(videos,opts={}){const r=el('div','orv-row');for(const v of videos)r.append(card(v,opts.map?opts.map(v):{}));return r;}
 function open(v,opener){
   document.querySelector('dialog.orv-lightbox')?.remove();
   const d=el('dialog','orv-lightbox');if(inApp())d.classList.add('orv-in-app');d.setAttribute('aria-label',v.title||'Video');
   const box=el('div','orv-frame');
   if(v.kind==='youtube'&&safeYt(v.id)){const f=el('iframe');
     f.setAttribute('referrerpolicy','strict-origin-when-cross-origin');   /* set before src: the page sends no referrer and YouTube's player refuses to play without one */
     f.title=v.title||'Video';f.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');f.setAttribute('allowfullscreen','');
     f.src='https://www.youtube-nocookie.com/embed/'+v.id+'?autoplay=1&rel=0&playsinline=1&modestbranding=1'+(inApp()?'&fs=0':'')+'&origin='+encodeURIComponent(location.origin);
     box.append(f);}
   else if(v.kind==='espn'&&okMp4(v.src)){const m=el('video');m.src=v.src;m.controls=true;m.autoplay=true;m.playsInline=true;if(inApp())m.setAttribute('controlslist','nofullscreen');if(okImg(v.thumb))m.poster=v.thumb;box.append(m);}
   else box.append(el('p','orv-missing','This video is unavailable.'));
   const head=el('div','orv-head'),title=el('div','orv-title');title.append(el('strong','',v.title||'Video'),el('small','',[who(v),dur(v)].filter(Boolean).join(' · ')));
   const close=el('button','orv-close','×');close.type='button';close.setAttribute('aria-label','Close video');close.onclick=()=>d.close();
   head.append(title);
   if(v.kind==='youtube'&&safeYt(v.id)){const ext=el('a','orv-ext','Open on YouTube ↗');ext.href='https://www.youtube.com/watch?v='+v.id;ext.target='_blank';ext.rel='noopener noreferrer';head.append(ext);}
   head.append(close);d.append(head,box);
   d.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();d.close();}});
   d.addEventListener('click',e=>{if(e.target===d)d.close();});
   d.addEventListener('close',()=>{box.replaceChildren();d.remove();if(opener?.isConnected)opener.focus({preventScroll:true});});
   document.body.append(d);d.showModal();close.focus({preventScroll:true});
 }
 window.OrbitalReels={card,row,open,thumb};

 /* ---------- Finished-game recap ---------- */
 const num=v=>{if(v==null)return null;const s=String(v);let m;if((m=s.match(/^(\d+)[-/](\d+)$/)))return +m[2]?+m[1]/+m[2]:0;if((m=s.match(/^(\d+):(\d\d)$/)))return +m[1]*60+ +m[2];const n=parseFloat(s.replace(/[,%]/g,''));return Number.isFinite(n)?n:null;};
 const hex=c=>/^[0-9a-f]{6}$/i.test(String(c||''))?'#'+c:null;
 function logo(t,cls){if(okImg(t.logo)){const i=el('img',cls);i.src=t.logo;i.alt='';i.loading='lazy';i.onerror=()=>i.remove();return i;}return el('span',cls+' orc-logo-blank');}
 function section(title,cls){const s=el('section','orc-sec '+(cls||''));if(title)s.append(el('h3','orc-h',title));return s;}
 function highlights(r){const vids=r.videos||[];if(!vids.length)return null;const s=section('Highlights','orc-highlights');
   const [first,...rest]=vids;const hero=card(first,{big:true});s.append(hero);if(rest.length)s.append(row(rest.slice(0,8)));return s;}
 function story(r){if(!(r.story?.length||r.article))return null;const s=section('Game story','orc-story');
   if(r.story?.length)s.append(el('p','orc-story-text',r.story.join(' ')));
   if(r.article){const a=r.article,box=el(a.url?'a':'div','orc-article');if(a.url){box.href=a.url;box.target='_blank';box.rel='noopener noreferrer';}
     if(okImg(a.image)){const i=el('img','orc-article-img');i.src=a.image;i.alt='';i.loading='lazy';i.onerror=()=>i.remove();box.append(i);}
     const t=el('span','orc-article-text');t.append(el('small','',(a.source?a.source+' recap':'Recap')+(a.url?' · ESPN ↗':'')),el('strong','',a.headline));if(a.description)t.append(el('span','',a.description));box.append(t);s.append(box);}
   return s;}
 function linescore(r){const t=r.teams||[];if(t.length!==2||!t.every(x=>x.linescores?.length))return null;const n=Math.max(...t.map(x=>x.linescores.length));
   const s=section('','orc-lines'),tab=el('table','orc-linescore'),head=el('tr');head.append(el('th',''));for(let i=0;i<n;i++)head.append(el('th','',String(i+1)));head.append(el('th','orc-total','T'));tab.append(head);
   for(const x of t){const tr=el('tr');const nm=el('th','orc-line-team');nm.append(logo(x,'orc-mini-logo'),document.createTextNode(x.abbr||x.short));tr.append(nm);for(let i=0;i<n;i++)tr.append(el('td','',x.linescores[i]??'–'));tr.append(el('td','orc-total',String(x.score??'')));if(x.winner)tr.classList.add('orc-win');tab.append(tr);}
   const wrap=el('div','orc-line-wrap');wrap.append(tab);s.append(wrap);return s;}
 function performers(r){const t=r.teams||[];if(!t.some(x=>x.leaders?.length))return null;const s=section('Top performers','orc-perf'),grid=el('div','orc-perf-grid');
   for(const x of t){const col=el('div','orc-perf-col');const h=el('div','orc-perf-team');h.append(logo(x,'orc-mini-logo'),el('strong','',x.short));col.append(h);
     for(const p of (x.leaders||[]).slice(0,3)){const rw=el('div','orc-player');if(okImg(p.headshot)){const i=el('img','orc-head');i.src=p.headshot;i.alt='';i.loading='lazy';i.onerror=()=>i.replaceWith(el('span','orc-head orc-head-blank'));rw.append(i);}else rw.append(el('span','orc-head orc-head-blank'));
       const tx=el('span','orc-player-text');tx.append(el('small','',p.category),el('strong','',p.name),el('span','',p.value));rw.append(tx);col.append(rw);}
     grid.append(col);}
   s.append(grid);return s;}
 function teamStats(r){const rows=r.team_stats||[],t=r.teams||[];if(!rows.length||t.length!==2)return null;const s=section('Team stats','orc-stats');
   const legend=el('div','orc-stat-legend');for(const x of t){const k=el('span','');k.append(logo(x,'orc-mini-logo'),document.createTextNode(x.abbr||x.short));legend.append(k);}s.append(legend);
   const ca=hex(t[0].color)||'#6b8aa6',cb=hex(t[1].color)||'#a2e2c9';
   for(const x of rows){const a=num(x.away),b=num(x.home),tot=(a||0)+(b||0);const rw=el('div','orc-stat');const top=el('div','orc-stat-top');top.append(el('strong','',x.away),el('span','',x.label),el('strong','',x.home));
     const bar=el('div','orc-bar');const pa=tot?Math.round(100*(a||0)/tot):50;const l=el('i','');l.style.width=pa+'%';l.style.background=ca;const rr=el('i','');rr.style.width=(100-pa)+'%';rr.style.background=cb;bar.append(l,rr);rw.append(top,bar);s.append(rw);}
   return s;}
 function winProb(r){
  const tracker=window.TelevisionTrackers,m=tracker?.probabilityModel(r);if(!m)return null;
  const s=section('Win probability','orc-wp'),svg=tracker.probabilityField(r),name=t=>t.abbr||t.short||t.name||'',label=p=>r.league==='MLB'?String(p):r.league==='NHL'?'P'+p:p>4?'OT'+(p-4):'Q'+p;
  const mk=(tag,a={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(a))n.setAttribute(k,String(v));return n;};
  const cursor=mk('g',{class:'orc-wp-cursor'}),line=mk('line',{y1:m.T,y2:m.H-m.B}),dot=mk('circle',{r:5});cursor.append(line,dot);svg.append(cursor);
  const readout=el('div','orc-wp-readout');readout.setAttribute('aria-live','polite');let selected=m.samples.length-1;
  const show=i=>{selected=Math.max(0,Math.min(m.samples.length-1,i));const p=m.samples[selected],pct=Math.round(p.home*100),per=[...m.periods].reverse().find(v=>v.index<=p.index),key=m.keys.find(v=>v.index===p.index);line.setAttribute('x1',m.x(p.index));line.setAttribute('x2',m.x(p.index));dot.setAttribute('cx',m.x(p.index));dot.setAttribute('cy',m.y(p.home));readout.textContent=(per?label(per.period)+' · ':'')+name(m.home)+' '+pct+'% · '+name(m.away)+' '+(100-pct)+'%'+(key?.text?' · '+key.text:'');};
  const wrap=el('div','orc-wp-wrap');wrap.tabIndex=0;wrap.setAttribute('aria-label','Win probability chart. Left and right explore each reported play.');
  const fromEvent=e=>{const b=svg.getBoundingClientRect(),index=Math.round((((e.clientX-b.left)/b.width)*m.W-m.L)/(m.W-m.L-m.R)*m.last);return m.samples.reduce((best,p,i)=>Math.abs(p.index-index)<Math.abs(m.samples[best].index-index)?i:best,0);};
  for(const event of ['pointermove','pointerdown'])wrap.addEventListener(event,e=>show(fromEvent(e)));
  wrap.addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();e.stopPropagation();show(selected+(e.key==='ArrowRight'?1:-1));});
  show(selected);wrap.append(svg);s.append(wrap,readout);return s;
 }
 function news(r){if(!r.news?.length)return null;const s=section('More on this game','orc-news'),list=el('div','orc-news-list');
   for(const n of r.news){const c=el(n.url?'a':'div','orc-news-item');if(n.url){c.href=n.url;c.target='_blank';c.rel='noopener noreferrer';}if(okImg(n.image)){const i=el('img','');i.src=n.image;i.alt='';i.loading='lazy';i.onerror=()=>i.remove();c.append(i);}const tx=el('span','');tx.append(el('strong','',n.headline));if(n.description)tx.append(el('small','',n.description));c.append(tx);list.append(c);}
   s.append(list);return s;}
 function info(r){const i=r.info||{};const bits=[i.venue,i.place,i.attendance?'Attendance '+i.attendance.toLocaleString():null].filter(Boolean);return bits.length?el('p','orc-info',bits.join(' · ')):null;}
 const cache=new Map();
 function load(api,event){const k=event.league+'|'+event.id,hit=cache.get(k);if(hit&&Date.now()-hit.at<10*60e3)return hit.p;
   const p=api.ajax({type:'GET',url:api.getUrl('sports/api/recap',{league:event.league,event:event.id}),dataType:'json'});cache.set(k,{at:Date.now(),p});p.catch?.(()=>cache.delete(k));return p;}
 function mount(dialog,event,api){
   if(!dialog||dialog.__orcMounted)return;const pane=dialog.querySelector('.otv-gc-pane-live')||dialog.querySelector('.otv-gc-situation');if(!pane)return;dialog.__orcMounted=true;
   const box=el('div','orc-recap'),tail=el('div','orc-recap orc-recap-tail');box.setAttribute('aria-busy','true');box.append(el('div','orc-skel'),el('div','orc-skel orc-skel-short'));pane.prepend(box);
   Promise.resolve(load(api,event)).then(r=>{if(!box.isConnected)return;box.removeAttribute('aria-busy');
     const top=[highlights(r),story(r),linescore(r),performers(r)].filter(Boolean),bottom=[teamStats(r),winProb(r),news(r),info(r)].filter(Boolean);
     if(!top.length&&!bottom.length){box.remove();return;}box.replaceChildren(...top);if(!top.length)box.remove();
     if(bottom.length){tail.append(...bottom);pane.append(tail);}
     /* Scoring plays (existing Summary) sit between the story and the stats; the refresh loop re-renders only that slot. */
     const place=()=>{const slot=pane.querySelector('.otv-game-context-slot');if(slot&&box.isConnected&&slot.previousElementSibling!==box)box.after(slot);if(tail.isConnected&&pane.lastElementChild!==tail)pane.append(tail);};place();
     new MutationObserver(place).observe(pane,{childList:true});
   },()=>{box.remove();dialog.__orcMounted=false;});
 }
 window.OrbitalRecap={mount,load};
})();

/* Sept 29 polish: game center additions (G2 box score, G3 MLB R/H/E, G4 plays by half-inning). Data: /sports/api/boxscore.
   Everything here adds to the existing tabs; when the box score is unavailable the tabs keep their previous content. */
(()=>{'use strict';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const cache=new Map();
function fetchBox(api,event){const k=[api.serverId(),api.getCurrentUserId(),event.league,event.id].join('|'),hit=cache.get(k);const ttl=event.state==='final'?600000:15000;
 if(hit&&Date.now()-hit.at<ttl)return hit.p;const p=api.ajax({type:'GET',url:api.getUrl('sports/api/boxscore',{league:event.league,event:event.id}),dataType:'json'});
 cache.set(k,{at:Date.now(),p});p.catch(()=>cache.delete(k));while(cache.size>8)cache.delete(cache.keys().next().value);return p;}
const art=(event,name)=>window.OrbitalArtwork.team(event,(event.teams||[]).find(t=>t.name===name)||{name});
function teamChip(event,t){const c=el('span','ogc-team-chip');const a=art(event,t.name);if(window.OrbitalArtwork.url(a.url)){const i=el('img');i.src=a.url;i.alt='';i.loading='lazy';c.append(i);}c.append(el('span','',t.abbreviation||a.abbr||t.name));return c;}

/* ---------- G3: baseball line score gets H and E columns; loose text lines become table columns ---------- */
function rhe(pane,event,box,data){if(event.league!=='MLB')return;const table=pane.querySelector('.otv-score-table');if(!table||table.dataset.rhe)return;
 const body=[...table.tBodies[0]?.rows||[]];if(body.length!==2)return;
 const hitsOf=name=>{const t=(box.teams||[]).find(x=>x.name===name||name?.includes(x.name)||x.name?.includes(name));const p=(box.players||[]).find(x=>x.team_id===t?.id);const g=p?.groups.find(x=>x.key==='batting');const i=g?.labels.indexOf('H');return i>=0?g.totals[i]:null;};
 const errOf=name=>{const row=(data.statistics||[]).find(r=>r.name===name);const v=(row?.values||[]).find(v=>/^(e|errors)$/i.test(String(v.label||'')));return v?.value??null;};
 const values=body.map(tr=>{const name=tr.cells[0].textContent;return {h:hitsOf(name),e:errOf(name)};});
 if(values.some(v=>v.h==null))return;
 const head=table.tHead.rows[0];head.cells[head.cells.length-1].textContent='R';head.append(el('th','otv-total','H'));if(values.every(v=>v.e!=null))head.append(el('th','otv-total','E'));
 body.forEach((tr,i)=>{tr.append(el('td','otv-total',String(values[i].h)));if(values.every(v=>v.e!=null))tr.append(el('td','otv-total',String(values[i].e)));});
 table.dataset.rhe='1';pane.querySelectorAll(':scope>.otv-gc-stat').forEach(n=>n.remove());}

/* ---------- G2: player stats per team ---------- */
function groupTable(g,{moreId}={}){const wrap=el('div','ogc-box-table-wrap');wrap.tabIndex=0;const t=el('table','ogc-box-table');const cap=el('caption','',g.title);t.append(cap);
 const hr=el('tr');hr.append(el('th','ogc-box-player','Player'));g.labels.forEach((l,i)=>{const th=el('th','',l);if(g.descriptions[i])th.title=g.descriptions[i];th.scope='col';hr.append(th);});const thead=el('thead');thead.append(hr);t.append(thead);
 const tb=el('tbody');for(const a of g.athletes){const tr=el('tr');if(g.key==='batting'&&!a.starter)tr.classList.add('is-sub');const th=el('th','ogc-box-player');th.scope='row';const nm=el('span','ogc-box-name',a.short||a.name);if(a.name&&a.short!==a.name)nm.title=a.name;th.append(nm);if(a.pos)th.append(el('small','ogc-box-pos',a.pos));tr.append(th);
  a.stats.forEach(v=>tr.append(el('td','',v)));tb.append(tr);}t.append(tb);
 if(g.totals?.some(Boolean)){const tf=el('tfoot'),tr=el('tr');const th=el('th','ogc-box-player','Team');th.scope='row';tr.append(th);g.totals.forEach(v=>tr.append(el('td','',v)));tf.append(tr);t.append(tf);}
 wrap.setAttribute('aria-label',g.title+'. Scroll sideways for more columns.');wrap.append(t);return wrap;}
function box(pane,event,api,data){if(!pane||!['live','final'].includes(data?.state||event.state))return;
 fetchBox(api,event).then(b=>{if(!pane.isConnected)return;rhe(pane,event,b,data);
  if(!(b.players||[]).some(p=>p.groups.some(g=>g.athletes.length)))return;
  const sig=JSON.stringify(b.players);let host=pane.querySelector(':scope>.ogc-box');if(host&&host.dataset.sig===sig)return;
  const chosen=host?.dataset.team,openMore=host?.querySelector('.ogc-box-more')?.open,focus=host?.contains(document.activeElement)?document.activeElement.dataset.team:null;
  const fresh=el('section','ogc-box');fresh.dataset.sig=sig;fresh.setAttribute('aria-label','Player statistics');
  const teams=(b.teams||[]).slice().sort((x,y)=>Number(x.side==='home')-Number(y.side==='home'));
  const tabs=el('div','ogc-box-teams');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Choose team');const body=el('div','ogc-box-body');
  const show=id=>{fresh.dataset.team=id;for(const b2 of tabs.children){const on=b2.dataset.team===id;b2.setAttribute('aria-selected',String(on));b2.tabIndex=on?0:-1;}
   const p=(b.players||[]).find(x=>x.team_id===id);body.replaceChildren();if(!p){body.append(el('p','otv-gc-empty','No player statistics reported yet.'));return;}
   const main=p.groups.filter(g=>g.main&&g.athletes.length),more=p.groups.filter(g=>!g.main&&g.athletes.length);
   for(const g of main)body.append(groupTable(g));
   if(more.length){const d=el('details','ogc-box-more');d.open=!!openMore;d.append(el('summary','otv-category','More stats · '+more.map(g=>g.title).join(', ')));for(const g of more)d.append(groupTable(g));body.append(d);}};
  for(const t of teams){const b2=el('button','ogc-box-team');b2.type='button';b2.setAttribute('role','tab');b2.dataset.team=t.id;b2.append(teamChip(event,t));if(t.record)b2.append(el('small','',t.record));b2.onclick=()=>show(t.id);
   b2.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const all=[...tabs.children],i=all.indexOf(b2),n=all[(i+(e.key==='ArrowRight'?1:all.length-1))%all.length];n.focus();n.click();};tabs.append(b2);}
  fresh.append(el('h3','otv-panel-label','Box score'),tabs,body);show(chosen&&teams.some(t=>t.id===chosen)?chosen:teams[0]?.id);
  if(host)host.replaceWith(fresh);else pane.append(fresh);if(focus)tabs.querySelector(`[data-team="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
 }).catch(()=>{/* keep the line score; player stats are optional */});}

/* ---------- G4: baseball plays grouped by half-inning, every play, scoring plays marked ---------- */
async function innings(pane,event,api){const b=await fetchBox(api,event);const halves=(b.innings||[]).slice().reverse();if(!halves.length)return false;
 const teams=Object.fromEntries((b.teams||[]).map(t=>[t.id,t]));const sig=JSON.stringify(halves.map(h=>[h.label,h.plays.length,h.away,h.home]));
 if(pane.dataset.inningsSig===sig)return true;const open=new Set([...pane.querySelectorAll('details.ogc-half[open]')].map(d=>d.dataset.key));const first=!pane.dataset.inningsSig;pane.dataset.inningsSig=sig;
 const away=(b.teams||[]).find(t=>t.side==='away'),home=(b.teams||[]).find(t=>t.side==='home');
 const list=el('div','ogc-innings');list.append(el('p','otv-gc-note','Latest first · every play, grouped by half-inning'));
 halves.forEach((h,i)=>{const d=el('details','ogc-half');d.dataset.key=h.label;d.open=first?i<2:open.has(h.label)||i===0&&!open.size;const t=h.half==='top'?away:h.half==='bottom'?home:teams[h.team_id];/* batting team: visitors bat in the top half */
  const s=el('summary','ogc-half-head');s.append(el('span','ogc-half-label',(h.half==='top'?'▲ ':h.half==='bottom'?'▼ ':'')+h.label));if(t)s.append(teamChip(event,t));
  s.append(el('span','ogc-half-runs',h.runs?h.runs+' run'+(h.runs===1?'':'s'):'No runs'),el('span','ogc-half-score',`${away?.abbreviation||'Away'} ${h.away} · ${home?.abbreviation||'Home'} ${h.home}`));d.append(s);
  const ol=el('ol','ogc-half-plays');let outsSeen=0;for(const p of h.plays){const li=el('li',''),change=/\b(?:in (?:left|right|center) field|(?:at|to|in) (?:first|second|third) base|at (?:shortstop|catcher|pitcher)|hit for|ran for|relieved|replaced|pinch[- ](?:hit|ran)|defensive (?:switch|substitution)|now (?:playing|pitching)|stays in the game)\b|^(?:pitching|pitcher) change/i.test(p.text||'')&&!p.scoring;if(p.scoring)li.classList.add('is-scoring');if(change)li.classList.add('is-change');li.append(el('span','ogc-play-text',p.text||'Play'));if(p.scoring&&p.away!=null)li.append(el('strong','ogc-play-score',p.away+'–'+p.home));else if(p.outs!=null&&!change&&Number(p.outs)!==outsSeen){const o=el('span','ogc-play-outs'+(Number(p.outs)===3?' is-third':''),p.outs+' out'+(p.outs===1?'':'s'));li.append(o);}if(p.outs!=null&&!change)outsSeen=Number(p.outs);ol.append(li);}
  d.append(ol);list.append(d);});
 pane.replaceChildren(list);return true;}
window.OrbitalGameCenterPlus={box,innings,fetchBox};
})();

/* Sept 29 polish: the account's followed teams (server list; the browser copy is only a fallback). Shared by the board
   (Your teams pinned first) and the player trackers (your teams first in the picker). */
(()=>{'use strict';
const state={at:0,user:'',list:[],p:null};
window.OrbitalFollowed={
 list(){const a=window.ApiClient;if(!a)return [];const u=a.getCurrentUserId();if(state.user===u&&state.list.length)return state.list;try{return JSON.parse(localStorage.getItem('home-teams-v1:'+u)||'[]');}catch{return [];}},
 load(){const a=window.ApiClient;if(!a)return Promise.resolve([]);const u=a.getCurrentUserId();if(state.user===u&&state.p&&Date.now()-state.at<600000)return state.p;
  state.user=u;state.at=Date.now();state.p=a.ajax({type:'GET',url:a.getUrl('sports/api/team-preferences'),dataType:'json'}).then(d=>{if(a.getCurrentUserId()!==u)return [];state.list=(d?.teams||[]).filter(t=>t&&t.league&&t.id).map(t=>({league:t.league,id:String(t.id),key:t.key,name:t.name}));return state.list;}).catch(()=>{state.at=0;return [];});return state.p;}};
})();


/* Oct 6 (Claude, the owner: feeds must name their source; catcher's-view pitch flight with a hot/cold glow replaces the
 * batter's box; thin trail; clean data beside it). Self-contained: wraps TelevisionFeedUi labels and mounts beside the
 * existing one-page Game Center. Draws only pitches the page already shows (TelevisionTrackers released data). */
(()=>{
 'use strict';
 const REGION={US:'US',USA:'US',UK:'UK',GB:'UK',CA:'Canada',NO:'Norway',SE:'Sweden',DK:'Denmark',FI:'Finland',DE:'Germany',FR:'France',ES:'Spain',IT:'Italy',PT:'Portugal',NL:'Netherlands',PL:'Poland',AU:'Australia',NZ:'New Zealand',MENA:'Middle East',AR:'Arabic',LATAM:'Latin America',MX:'Mexico',BR:'Brazil',JP:'Japan',KR:'Korea',IE:'Ireland',BE:'Belgium',CH:'Switzerland',AT:'Austria',IN:'India'};
 const LANG=/\b(English|French|Spanish|Portuguese|German|Italian|Arabic|Dutch|Polish|Swedish|Norwegian|Danish|Japanese|Korean)\b/i;
 const KEEP=new Set(['ESPN','TNT','TBS','FS1','FS2','NBC','CBS','ABC','FOX','MLB','NFL','NBA','NHL','SN','TSN','BT','DAZN']);
 const cap=w=>String(w||'').toLowerCase().split(' ').filter(Boolean).map(x=>x.length<=4&&KEEP.has(x.toUpperCase())?x.toUpperCase():x[0].toUpperCase()+x.slice(1)).join(' ');
 const txt=v=>typeof v==='string'?v.trim():'';
 function provider(s){const p=txt(s?.provider_label);if(/iptv/i.test(p))return 'IPTV';if(/relay/i.test(p))return 'Web relay';if(/automatic/i.test(p))return '';return p.replace(/\bprimary\b/i,'').trim();}
 function quality(s){const q=s?.quality;return q&&q.height>0?q.height+'p':'';}
 /** {title, detail, badge}: where the feed comes from, short. Mirrors the Shield's GcFeed.label. */
 function feed(s){
  const channel=txt(s?.channel_label)||txt(s?.label_short),name=txt(s?.display_name)||txt(s?.name),segs=channel.split('|').map(x=>x.trim()).filter(Boolean);
  const prov=provider(s),lang=(channel.match(LANG)||[])[0],q=quality(s),detail=(...p)=>[...new Set(p.filter(Boolean))].join(' · ');
  if(s?.kind==='team')return {title:name||'Team channel',detail:detail('Team broadcast',prov),badge:(name.split(' ')[0]||'Team').slice(0,8)};
  const tail=segs.at(-1)||'',m=tail.match(/^([A-Z]{2,5})\s*:\s*(.+)$/);
  if(segs.length>=3&&m){const region=REGION[m[1]]||m[1],net=m[2].replace(/\b(PPV|EXCLUSIVE|HD|FHD|UHD|4K|8K)\b|\b\d+\b/gi,' ').replace(/\s+/g,' ').trim(),generic=net.length<=3||REGION[net.toUpperCase()];
   const title=generic?'International feed':cap(net);return {title,detail:detail(region,lang&&cap(lang),prov,q),badge:(generic?region:title).slice(0,8)};}
  if(/\[game feed\]/i.test(channel)||/^(MLB|NFL|NBA|NHL|MLS|WNBA|NCAAF|CFB)\s*:/i.test(channel))return {title:'Game feed',detail:detail((prov||'IPTV')+' game stream',lang&&cap(lang),q),badge:'Game'};
  const linear=(segs.at(-1)||name).replace(/\s*\b(HD|FHD|UHD|4K|8K|RAW|60FPS)\b/gi,'').trim()||name;
  const title=linear.length>name.length&&name.length>=2&&name.length<=6?linear:name&&name!=='Automatic selection'?name:linear;
  const region=segs.length>1&&segs[0].length<=5?REGION[segs[0].toUpperCase()]:null;
  const badge=name.length>=2&&name.length<=6&&name!=='Automatic selection'?name:title.split(' ').length>1?title.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,5):title.slice(0,6);
  const BRAND={trutv:'truTV',espnu:'ESPNU',espnews:'ESPNews',fs1:'FS1',fs2:'FS2',tnt:'TNT',tbs:'TBS',mlbn:'MLB Network',sny:'SNY',yes:'YES'};
  const shown=title===title.toUpperCase()&&title.length<=5?title:cap(title);
  return {title:BRAND[String(title).toLowerCase().replace(/\s+/g,'')]||shown,detail:detail('TV channel',region,lang&&cap(lang),prov,q),badge};
 }
 // 1. Feed names everywhere the web/Phone lists them.
 const ui=window.TelevisionFeedUi;
 if(ui&&!ui.__gc2){
  const label0=ui.label,detail0=ui.detail;
  ui.label=(s,e)=>{try{if(s?.automatic){const first=(s.source_labels||[])[0];return first?'Best feed · '+feed(first).title:'Best available feed';}return feed(s).title||label0(s,e);}catch{return label0(s,e);}};
  ui.detail=s=>{try{if(s?.automatic){const r=[...new Set((s.source_labels||[]).map(x=>feed(x).title))];return ['Starts automatically',r.length>1?'then '+r.slice(1,4).join(', '):null].filter(Boolean).join(' · ');}return [feed(s).detail,s?.language==='es'?'Español':null].filter(Boolean).join(' · ');}catch{return detail0(s);}};
  ui.badge=s=>{try{return feed(s).badge;}catch{return '';}};ui.__gc2=true;
 }

 // 2. Catcher's-view pitch flight.
 const NS='http://www.w3.org/2000/svg',node=(t,a)=>{const n=document.createElementNS(NS,t);for(const [k,v] of Object.entries(a||{}))n.setAttribute(k,String(v));return n;};
 const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;};
 const pos=(f,t)=>[f[0]+f[3]*t+.5*f[6]*t*t,f[1]+f[4]*t+.5*f[7]*t*t,f[2]+f[5]*t+.5*f[8]*t*t];
 const tAtY=(f,y)=>{const a=.5*f[7],b=f[4],c=f[1]-y,d=b*b-4*a*c;if(d<0)return NaN;if(Math.abs(a)<1e-12)return -c/b;const q=-.5*(b+Math.sign(b)*Math.sqrt(d));return [q/a,c/q].filter(t=>Number.isFinite(t)&&b+2*a*t<0).sort((x,z)=>Math.abs(x)-Math.abs(z))[0]??NaN;};
 // World feet: MLB2026 rules2.02/3.01 and Appendix2. Display styling never changes these sizes.
 const C=[0,-3.2,2.55],T=[0,40,2.75],MID=8.5/12,FRONT=17/12,HW=17/24;
 const BALL_CIRCUMFERENCE_IN=9.125,BALL_RADIUS_FT=BALL_CIRCUMFERENCE_IN/(24*Math.PI);
 const HOME=[[-HW,17/12,0],[HW,17/12,0],[HW,MID,0],[0,0,0],[-HW,MID,0]];
 const BOXES=[-1,1].map(side=>{const inner=side*(HW+.5),outer=side*(HW+.5+4);return [[inner,MID-3,0],[outer,MID-3,0],[outer,MID+3,0],[inner,MID+3,0]];});
 const F=(()=>{const v=T.map((x,i)=>x-C[i]),l=Math.hypot(...v);return v.map(x=>x/l);})(),R=(()=>{const v=[F[1],-F[0],0],l=Math.hypot(v[0],v[1]);return [v[0]/l,v[1]/l,0];})(),U=[R[1]*F[2]-R[2]*F[1],R[2]*F[0]-R[0]*F[2],R[0]*F[1]-R[1]*F[0]];
 const raw=w=>{const d=w.map((x,i)=>x-C[i]),z=d[0]*F[0]+d[1]*F[1]+d[2]*F[2];return [(d[0]*R[0]+d[1]*R[1]+d[2]*R[2])/z,-(d[0]*U[0]+d[1]*U[1]+d[2]*U[2])/z,z];};
 const typeColor=t=>/fastball|sinker|cutter/i.test(t)?'#ff8a3d':/slider|sweeper|curve|slurve|knuckle/i.test(t)?'#4cc9f0':/change|split|fork|screw/i.test(t)?'#b48cff':'#c8d2de';
 const callColor=q=>{const c=String(q?.call||'');const foul=/foul/i.test(c);if(q?.twoStrikeFoul===true||/^two-strike foul/i.test(c))return '#c39aff';if(foul)return '#ffcd57';if(/in play|hit into/i.test(c))return '#3d9bff';if(/strike|swinging|whiff/i.test(c))return '#ff5867';if(/ball/i.test(c))return '#79dd9e';return '#edf3f9';};
 function heatColor(r){const t=Math.min(1,Math.max(0,(r-.15)/.35)),s=[[64,140,230],[120,110,170],[255,122,60]],[a,b,k]=t<.5?[s[0],s[1],t*2]:[s[1],s[2],(t-.5)*2];return {rgb:a.map((v,i)=>Math.round(v+(b[i]-v)*k)).join(','),a:.30+.40*Math.abs(t-.5)*2};}
 let gid=0;
 const started=new Map(),clock=()=>performance.now();
 function animationStart(scope,id){const key=scope+'|'+id;if(!started.has(key)){started.set(key,clock());while(started.size>96)started.delete(started.keys().next().value);}return started.get(key);}
 // Native GcPitchFlight choreography: one second, smoothstep, 80% screen distance / 20% source time.
 // This clock draws an already admitted pitch; it never schedules or delays a server fact.
 function twoStrikeFoul(p,rows){const i=rows.findIndex(q=>q.id===p.id),row=i>=0?rows[i]:p,prior=i>0?rows[i-1]:null;return row.pitch===true&&/foul/i.test(row.call||row.text||'')&&!/tip/i.test(row.call||row.text||'')&&row.strikes===2&&prior?.strikes===2&&!!row.at_bat&&row.at_bat===prior.at_bat;}
 const FLIGHT_MS=1000,IMPACT_MS=450;
 // ZONE_MICRO_PURE_BEGIN
 // Presentation-only qualification against the admitted StatsAPI front-plane contract.
 function zoneMicroGeometry(q,row,zone){
  const f=row?.flight,finite=Number.isFinite,FRONT_PLANE=17/12,HALF_WIDTH=17/24,RADIUS=9.125/(24*Math.PI),EPS=.05/12;
  if(row?.pitch!==true||row.result!==false||typeof row.in_play!=='boolean')return null;
  if(!q?.current||q.measured!==true||q.pathSource!=='server'||!f||f.schema!==1||f.source!=='MLB_STATSAPI'||f.frame!=='mlb-statsapi-v1'||q.frame!==f.frame||q.plate_y_ft!==f.plate_y_ft||f.path_kind!=='measured_fit')return null;
  // This versioned frame defines feet/catcher coordinates. Contradictory or alternate contracts fail closed.
  if(['unit','units'].some(k=>f[k]!==undefined&&f[k]!=='ft')||f.coordinate_frame!==undefined||f.measurement_plane!==undefined||f.zone_plane_y_ft!==undefined&&f.zone_plane_y_ft!==FRONT_PLANE)return null;
  if(!Number.isInteger(f.game_pk)||f.game_pk<=0||q.game_pk!==f.game_pk||typeof f.play_id!=='string'||!f.play_id||q.playId!==f.play_id||row.play_id!==f.play_id||q.id!==row.id||!([f.play_id,`mlb-${f.game_pk}-p-${f.play_id}`].includes(row.id)))return null;
  if(!Number.isInteger(f.at_bat_index)||f.at_bat_index<0||q.at_bat_index!==f.at_bat_index||row.at_bat!==`mlb-${f.game_pk}-ab-${f.at_bat_index}`)return null;
  const fitBounds=[[-6,6],[40,65],[0,12],[-100,100],[-220,-10],[-100,100],[-200,200],[-200,200],[-200,200]];
  if(!Array.isArray(f.fit)||f.fit.length!==9||!f.fit.every((v,i)=>finite(v)&&v>=fitBounds[i][0]&&v<=fitBounds[i][1])||!finite(f.path_duration_s)||f.path_duration_s<=0||f.path_duration_s>=2)return null;
  if(!finite(f.zone_top_ft)||!finite(f.zone_bottom_ft)||f.zone_top_ft<1||f.zone_top_ft>6||f.zone_bottom_ft<.1||f.zone_bottom_ft>4||f.zone_top_ft<=f.zone_bottom_ft||zone?.top!==f.zone_top_ft||zone?.bottom!==f.zone_bottom_ft||zone?.plane!==FRONT_PLANE||zone?.frame!==f.frame||f.plate_y_ft!==FRONT_PLANE)return null;
  const validPath=path=>Array.isArray(path)&&path.length>=2&&path.length<=96&&path.every(p=>Array.isArray(p)&&p.length===3&&p.every(finite)&&Math.abs(p[0])<=30&&p[1]>=0&&p[1]<=70&&p[2]>=-20&&p[2]<=30);
  if(!validPath(q.path)||!validPath(f.path)||JSON.stringify(q.path)!==JSON.stringify(f.path)||!Array.isArray(f.plate)||f.plate.length!==2||!f.plate.every(finite)||Math.abs(f.plate[0])>8||f.plate[1]<-5||f.plate[1]>12)return null;
  const end=q.path.at(-1),[x,,z]=end;
  // These tolerances test ingestion consistency, not tracking accuracy. Producer paths round to5decimals.
  if(Math.abs(end[1]-FRONT_PLANE)>1e-5||Math.abs(x-f.plate[0])>.001||Math.abs(z-f.plate[1])>.001)return null;
  const closestX=Math.max(-HALF_WIDTH,Math.min(HALF_WIDTH,x)),closestZ=Math.max(zone.bottom,Math.min(zone.top,z)),dx=x-closestX,dz=z-closestZ,d=Math.hypot(dx,dz);
  const signed=d||-Math.min(x+HALF_WIDTH,HALF_WIDTH-x,z-zone.bottom,zone.top-z),gap=signed-RADIUS;
  if(Math.abs(signed)<=EPS||Math.abs(Math.abs(signed)-RADIUS)<=EPS)return null;
  const kind=signed<-RADIUS-EPS?'hit':Math.abs(signed)<RADIUS-EPS?'edge':gap>EPS&&gap<=2/12?'near':null;
  if(!kind)return null;
  return {kind,signedCenterFt:signed,gapInches:gap*12,nearest:[closestX,FRONT_PLANE,closestZ],surface:d?[x-RADIUS*dx/d,FRONT_PLANE,z-RADIUS*dz/d]:null,nominalRadiusFt:RADIUS,plane:FRONT_PLANE,basis:'approximate nominal ball edge to drawn front-plane zone'};
 }
 function zoneMicroEnvelope(kind,elapsedMs,inPlay){
  if(!Number.isFinite(elapsedMs)||!['hit','edge','near'].includes(kind))return {flash:0,zoom:1,active:false};
  const start=inPlay?900:1000,duration=inPlay?140:kind==='hit'?300:560,t=elapsedMs-start;
  if(t<0||t>=duration)return {flash:0,zoom:1,active:false};
  const ease=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);},scaled=inPlay?t*(kind==='hit'?300:560)/140:t;
  return {flash:kind==='hit'?(scaled<100?ease(scaled/100):1-ease((scaled-100)/200)):0,zoom:kind==='hit'?1:scaled<160?1+.35*ease(scaled/160):scaled<340?1.35:1+.35*(1-ease((scaled-340)/220)),active:true};
 }
 // ZONE_MICRO_PURE_END
 function motionFraction(cumulative,elapsedMs){
  const n=cumulative.length-1,u=Math.max(0,Math.min(1,elapsedMs/FLIGHT_MS));if(n<1||u===0||u===1)return u;
  const total=Math.max(.001,cumulative[n]),goal=u*u*(3-2*u),at=k=>.8*cumulative[k]/total+.2*k/n;
  let k=1;while(k<n&&at(k)<goal)k++;return ((k-1)+Math.max(0,Math.min(1,(goal-at(k-1))/Math.max(.0001,at(k)-at(k-1)))))/n;
 }
 function pitchMotionProgress(points,elapsedMs){const d=[0];for(let i=1;i<points.length;i++)d.push(d.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));return motionFraction(d,elapsedMs);}
 function pathAt(path,fraction){const x=Math.max(0,Math.min(1,fraction))*(path.length-1),i=Math.min(path.length-2,Math.floor(x)),u=x-i;return path[i].map((v,k)=>v+(path[i+1][k]-v)*u);}
 // ANIMATION_V2_BEGIN (Oct 12 2026, Claude): presentation-only successor helpers.
 // No fact, call, admission, scene clock or camera selection is read or changed here.
 // Pitch pacing successor over the SAME 1000 ms clock: 0 at elapsed<=0, 1 at elapsed>=FLIGHT_MS, monotonic.
 // A blend of physical time (path samples are equal-time) and on-screen distance with a short ease-in, so the
 // ball keeps accelerating into the zone instead of easing out. motionFraction above stays as provenance.
 const PACING_V2_PHYSICAL=.65,PACING_V2_RAMP=.06;
 function pitchPacingV2(cumulative,elapsedMs){
  const n=cumulative.length-1,u=Math.max(0,Math.min(1,elapsedMs/FLIGHT_MS));if(n<1||u===0||u===1)return u;
  const r=PACING_V2_RAMP,g=u<r?u*u/(2*r)/(1-r/2):(u-r/2)/(1-r/2),total=Math.max(.001,cumulative[n]);
  let k=1;while(k<n&&cumulative[k]/total<g)k++;
  const lo=cumulative[k-1]/total,hi=cumulative[k]/total,screen=((k-1)+Math.max(0,Math.min(1,(g-lo)/Math.max(.0001,hi-lo))))/n;
  return Math.max(0,Math.min(1,PACING_V2_PHYSICAL*g+(1-PACING_V2_PHYSICAL)*screen));
 }
 // Illustrated baseball: the classic two-lobe seam curve on a unit sphere (a+b=1 keeps |p|=1) with chevron stitches.
 const SEAM_V2=(()=>{const a=.75,b=.25,c=2*Math.sqrt(a*b),N=96,p=[];for(let i=0;i<N;i++){const t=2*Math.PI*i/N;p.push([a*Math.cos(t)+b*Math.cos(3*t),a*Math.sin(t)-b*Math.sin(3*t),c*Math.sin(2*t)]);}
  return p.map((q,i)=>{const s=p[(i+1)%N],r=p[(i+N-1)%N],t=s.map((v,k)=>v-r[k]),l=Math.hypot(...t),T=t.map(v=>v/l);return {p:q,T,B:[q[1]*T[2]-q[2]*T[1],q[2]*T[0]-q[0]*T[2],q[0]*T[1]-q[1]*T[0]]};});})();
 // Axis perpendicular to the measured break and a display rate scaled from measured rpm. Illustrative, not an observed spin axis.
 function ballSpinV2(q){const ivb=Number.isFinite(q?.ivb_in)?q.ivb_in:12,hb=Number.isFinite(q?.hb_in)?q.hb_in:0,l=Math.hypot(hb,ivb),rpm=Number.isFinite(q?.spin_rpm)&&q.spin_rpm>0?q.spin_rpm:2200;
  // Zero measured break has no defined direction: use a deterministic unit backspin axis, never a zero axis.
  return {axis:l>1e-9?[-ivb/l,hb/l,0]:[-1,0,0],rate:Math.max(1.2,Math.min(3.2,rpm/900))};}
 function rotV2(axis,angle){const [x,y,z]=axis,c=Math.cos(angle),s=Math.sin(angle),C=1-c;return [[c+x*x*C,x*y*C-z*s,x*z*C+y*s],[y*x*C+z*s,c+y*y*C,y*z*C-x*s],[z*x*C-y*s,z*y*C+x*s,c+z*z*C]];}
 const mulV2=(A,B)=>A.map(r=>[0,1,2].map(j=>r[0]*B[0][j]+r[1]*B[1][j]+r[2]*B[2][j])),appV2=(M,v)=>M.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
 const SEAM_REST_V2=mulV2(rotV2([0,1,0],.55),rotV2([1,0,0],1.05));
 // Unit-circle SVG paths (x right, y down) for the visible hemisphere; stitches nearer the rim are drawn lighter.
 function seamPathsV2(M){
  const P=v=>v[0].toFixed(3)+' '+(-v[1]).toFixed(3),add=(a,b,k)=>a.map((v,i)=>v+b[i]*k);
  let seam='',front='',edge='',open=false;
  for(const s of SEAM_V2){const q=appV2(M,s.p);
   if(q[2]>0){seam+=(open?'L':'M')+P(q);open=true;}else open=false;
   if(q[2]<=.05)continue;const T=appV2(M,s.T),B=appV2(M,s.B),w=.085,l=.055,chevron='M'+P(add(q,B,w))+'L'+P(add(q,T,l))+'L'+P(add(q,B,-w));
   if(q[2]>.35)front+=chevron;else edge+=chevron;}
  return {seam,front,edge};
 }
 // Illustrative batted-ball shape between home and the EXISTING reported target. reach, direction, target and
 // sector policy stay caller-owned. Air: drag/lift-shaped carry whose drag is solved so it lands at reach.
 // Ground: first bounce from the reported launch angle, decaying hops, then a roll to the reported point.
 // at(u) returns [horizontal ft along the spray line, height ft]; u is the caller's existing scene fraction.
 const battedShapeCacheV2=new Map();
 function battedShapeV2(reach,launchAngle,launchSpeed,ground){
  const key=[reach,launchAngle,launchSpeed,ground].join('|');const hit=battedShapeCacheV2.get(key);if(hit)return hit;
  const la=Number.isFinite(launchAngle)?launchAngle:ground?-8:25,ev=Number.isFinite(launchSpeed)&&launchSpeed>0?launchSpeed:ground?85:95;let shape;
  if(ground){
   const z0=2.5,d1=Math.max(1,Math.min(reach*.3,la<0?z0/Math.tan(Math.min(89,-la)*Math.PI/180):reach*.15)),rest=Math.max(0,reach-d1);
   const L=[.38,.22,.12].map(k=>k*rest),energy=Math.max(.6,Math.min(1.25,ev/90)),hop=L.map((x,i)=>Math.min(4.5-i,x*.11*energy)),edges=[d1];L.forEach(x=>edges.push(edges.at(-1)+x));
   const K=.45,dist=u=>reach*(u*(1+K)-K*u*u),uAt=d=>{const v=Math.max(0,Math.min(1,d/reach));return (1+K-Math.sqrt(Math.max(0,(1+K)*(1+K)-4*K*v)))/(2*K);};
   const lift=la>0?Math.min(6,d1*Math.tan(Math.min(30,la)*Math.PI/180)*.5):0;
   const height=d=>{if(d<=d1){const q=d/d1;return z0*(1-q)+4*lift*q*(1-q);}for(let i=0;i<L.length;i++)if(d<=edges[i+1]){const q=(d-edges[i])/Math.max(.001,L[i]);return 4*hop[i]*q*(1-q);}return 0;};
   shape={ground:true,hang:null,at:u=>{const d=dist(Math.max(0,Math.min(1,u)));return [d,height(d)];},bounces:edges.map(uAt),fractionAt:uAt};
  }else{
   const g=32.174,v0=ev*1.4667,a0=Math.max(6,Math.min(75,la))*Math.PI/180,z0=3;
   const sim=(kd,keep)=>{const kl=.45*kd,dt=1/200,out=keep?[[0,0,z0]]:null;let x=0,z=z0,vx=v0*Math.cos(a0),vz=v0*Math.sin(a0),t=0;
    for(let i=0;i<6000;i++){const v=Math.hypot(vx,vz),ax=-kd*v*vx-kl*v*vz,az=-g-kd*v*vz+kl*v*vx,nx=x+vx*dt,nz=z+vz*dt;vx+=ax*dt;vz+=az*dt;
     if(nz<=0&&vz<0){const w=z/Math.max(1e-9,z-nz);x+=(nx-x)*w;t+=dt*w;if(keep)out.push([t,x,0]);return {range:x,time:t,out};}
     x=nx;z=nz;t+=dt;if(keep)out.push([t,x,z]);}
    return {range:x,time:t,out};};
   let kd=0;if(sim(0,false).range>reach){let lo=0,hi=.012;for(let i=0;i<26;i++){const mid=(lo+hi)/2;if(sim(mid,false).range>reach)lo=mid;else hi=mid;}kd=(lo+hi)/2;}
   const run=sim(kd,true),s=run.out,T=Math.max(.05,run.time),scale=reach/Math.max(1,run.range);
   const at=u=>{const t=Math.max(0,Math.min(1,u))*T;let i=1;while(i<s.length-1&&s[i][0]<t)i++;const a=s[i-1],b=s[i],w=b[0]>a[0]?Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0]))):1;return [(a[1]+(b[1]-a[1])*w)*scale,Math.max(0,a[2]+(b[2]-a[2])*w)];};
   const fractionAt=d=>{const x=Math.max(0,Math.min(reach,d))/scale;let i=1;while(i<s.length-1&&s[i][1]<x)i++;const a=s[i-1],b=s[i],w=b[1]>a[1]?Math.max(0,Math.min(1,(x-a[1])/(b[1]-a[1]))):1;return Math.max(0,Math.min(1,(a[0]+(b[0]-a[0])*w)/T));};
   shape={ground:false,hang:T,at,bounces:[],fractionAt};
  }
  battedShapeCacheV2.set(key,shape);while(battedShapeCacheV2.size>48)battedShapeCacheV2.delete(battedShapeCacheV2.keys().next().value);return shape;
 }
 // Close inspection successor for NON-in-play near/edge pitches (the owner, Oct 12: closer, slower, more animated; the
 // gap between pitches allows it). Starts after the pitch has landed, so it never delays a result or contact; a new
 // pitch, review, camera change or reduced motion cancels it. In-play pitches keep the existing brief, no-crop path.
 const REVIEW_V2=Object.freeze({start:120,inMs:700,hold:2800,outMs:600,creep:.08,maxZoom:28,ballWidth:.26});
 function zoneReviewV2(elapsedMs){
  const {start,inMs,hold,outMs}=REVIEW_V2,t=elapsedMs-FLIGHT_MS-start;
  if(!Number.isFinite(t)||t<0||t>=inMs+hold+outMs)return {active:false,amount:0,creep:1,draw:0};
  const s=v=>{v=Math.max(0,Math.min(1,v));return v*v*v*(v*(v*6-15)+10);};
  return {active:true,amount:t<inMs?s(t/inMs):t<inMs+hold?1:1-s((t-inMs-hold)/outMs),
   creep:1+REVIEW_V2.creep*s((t-inMs*.6)/(inMs*.4+hold)),draw:t<inMs+hold?s((t-inMs*.7)/320):1};
 }
 // r3 (the owner, Shield, Oct 12): strike zone very slightly larger on screen. The whole pitch stage scales about the zone
 // centre, so ball, plate and zone keep their physical proportions; camera presets and world feet are unchanged.
 const ZONE_STAGE_SCALE_V2=1.06;
 // Optional patch B flips this: the same modelled hang time then drives the scene AND its landing/fence endpoints.
 const FIELD_MODEL_DURATION_V2=false;
 // ANIMATION_V2_END
 // FIELD_DIRECTION_POLICY_BEGIN
 // Port of retained Shield224 BaseballFieldDirection.kt f00ca9c8d75f1720d0236af46cb263cd91ed49f6dc59c4c68d25355c69cafa0c.
 // This changes an illustrative destination only; MLB's reported hit object stays untouched.
 function fieldDirectionSector(data){
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),text=v=>typeof v==='string'?v:'',
   rawText=v=>typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):'',nativeText=v=>rawText(v).slice(0,350),
   nativeTrue=v=>v===true||v==='true',number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
  const same=(a,b)=>{if(a===b)return true;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
   if(!object(a)||!object(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));};
  const sameGame=(pitch,ab)=>{const p=/^mlb-([0-9]+)-p-[A-Za-z0-9_-]{1,80}$/.exec(pitch),a=/^mlb-([0-9]+)-ab-[0-9]+$/.exec(ab);return !!p&&!!a&&p[0]===pitch&&a[0]===ab&&p[1]===a[1];};
  const sectors={'1':'P','3':'1B','4':'2B','5':'3B','6':'SS','7':'LF','8':'CF','9':'RF'};
  const conflict=hit=>{if(!object(hit))return null;const x=number(hit.coord_x),y=number(hit.coord_y);
   return x!==null&&y!==null&&x>=0&&x<=260&&y>=-20&&y<=260&&y>198.27&&text(hit.trajectory)==='ground_ball'
    &&Object.hasOwn(sectors,text(hit.location))?sectors[hit.location]:null;};
  const validContact=c=>{
   if(!object(c)||!object(c.hit)||!object(c.reported_location))return false;
   const h=c.hit,p=c.reported_location;
   if(!sameGame(text(c.event_id),text(c.at_bat_id))||c.completed!==false||number(c.schema)!==1||text(c.kind)!=='ground_ball'
    ||text(c.measurement_basis)!=='reported_contact'||text(c.source_row_revision).length!==64||!/^[a-f0-9]{64}$/.test(text(c.source_row_revision))
    ||text(p.frame)!=='mlb-hit-chart'||text(p.basis)!=='reported_field_point'||number(p.x)!==number(h.coord_x)||number(p.y)!==number(h.coord_y))return false;
   if(Object.hasOwn(c,'field_direction')){
    const d=c.field_direction;if(!object(d)||!object(d.projection_home)||!object(d.reported_fielder_sector))return false;
    const home=d.projection_home,s=d.reported_fielder_sector;
    if(d.usable!==false||text(d.reason)!=='behind_projection_home_conflicts_with_reported_fielder'||number(home.x)!==125.42||number(home.y)!==198.27
     ||text(home.basis)!=='current_native_field_projection'||text(s.source)!=='MLB.hitData.location'||text(s.position)!==conflict(h)||s.illustrative_only!==true)return false;
   }
   return conflict(h)!==null;
  };
  if(!object(data)||nativeText(data.kind)!=='baseball'||nativeText(data.league)!=='MLB')return null;
  const summary=object(data.summary)?data.summary:{},completed=nativeTrue(summary.completed)||nativeText(summary.scope)==='previous_at_bat',
   rows=(Array.isArray(data.timeline)?data.timeline:[]).slice(0,800).filter(object);
  // Native's timeline parser drops absent/nonfinite/out-of-range timestamps before granting ownership.
  const validAt=v=>{const n=typeof v==='number'?v:typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)?Number(v):NaN;
   return Number.isFinite(n)&&n>=1&&n<9223372036854775807;};
  const timeline=rows.slice(-200).filter(r=>validAt(r.at)).map(r=>({id:nativeText(r.id),atBat:nativeText(r.at_bat),
   pitch:nativeTrue(r.pitch),result:nativeTrue(r.result),inPlay:r.pitch===true&&r.in_play===true&&r.result===false,hit:object(r.hit)?r.hit:null}));
  if(!completed){
   const c=data.contact;if(!validContact(c))return null;const owners=timeline.filter(r=>r.id===text(c.event_id));if(owners.length!==1)return null;
   const owner=owners[0],last=timeline.filter(r=>r.pitch||r.result).at(-1);
   if(!owner.pitch||owner.result||!owner.inPlay||owner.atBat!==text(c.at_bat_id)||last!==owner||!owner.hit
    ||!Object.entries(c.hit).every(([k,v])=>Object.hasOwn(owner.hit,k)&&same(owner.hit[k],v)))return null;
   return conflict(c.hit);
  }
  // Exact ReleasedHitPresentation contract, including strict completion and one selected result owner.
  if(summary.completed!==true||rawText(summary.phase)!=='outcome'||!rawText(summary.outcome).trim()||!object(summary.hit))return null;
  const selected=rawText(data.last_play_event_id);if(!selected.trim())return null;
  const selectedRows=rows.filter(r=>rawText(r.id)===selected);if(selectedRows.length!==1)return null;
  const source=selectedRows[0];if(source.result!==true&&!['result','outcome'].includes(rawText(source.phase))||!same(source.hit,summary.hit))return null;
  const atBat=nativeText(source.at_bat);if(!atBat.trim())return null;
  const results=timeline.filter(r=>r.result&&r.atBat===atBat&&same(r.hit,summary.hit));if(results.length!==1)return null;
  const result=results[0];if(result.pitch||timeline.filter(r=>r.id===result.id).length!==1)return null;
  const index=timeline.indexOf(result),pitch=timeline.slice(0,index).filter(r=>r.pitch&&r.atBat===result.atBat).at(-1),game=/^mlb-([0-9]+)-r-[0-9]+$/.exec(result.id);
  if(!pitch||!game||game[0]!==result.id||!sameGame(pitch.id,result.atBat)||!result.atBat.startsWith('mlb-'+game[1]+'-ab-')||!pitch.inPlay||pitch.result||!same(pitch.hit,result.hit))return null;
  return conflict(result.hit);
 }
 function fieldTarget(m,illustrativeSector){
  const sectors={P:[0,60.5],'1B':[35,120],'2B':[20,140],'3B':[-35,120],SS:[-20,140],LF:[-30,260],CF:[0,280],RF:[30,260]},
   sector=typeof illustrativeSector==='string'&&Object.hasOwn(sectors,illustrativeSector)?illustrativeSector:null;
  if(sector){const [degrees,reach]=sectors[sector],sp=degrees*Math.PI/180;return {tx:reach*Math.sin(sp),ty:reach*Math.cos(sp),sp,reach,illustrativeSector:sector};}
  const dx=m.coord_x-125.42,dy=198.27-m.coord_y,sp=Math.atan2(dx,dy),rep=2.495*Math.hypot(dx,dy),
   reach=Math.min(520,Math.max(4,Number.isFinite(m.distance)&&m.distance>rep*.8&&m.distance<520?m.distance:rep));
  return {tx:reach*Math.sin(sp),ty:reach*Math.cos(sp),sp,reach,illustrativeSector:null};
 }
 // FIELD_DIRECTION_POLICY_END
 // Field view of a released batted ball (same camera/park as native GcFieldPlay). Path illustrative; point reported.
 function fieldSvg(m,color,W,H,illustrativeSector=null,still=false){
  const x0=m?.coord_x,y0=m?.coord_y;if(!Number.isFinite(x0)||!Number.isFinite(y0))return null;
  const cam=[0,-150,260],look=[0,170,0],nrm=v=>{const l=Math.hypot(...v);return v.map(a=>a/l);};
  const f=nrm(look.map((v,i)=>v-cam[i])),r=nrm([f[1],-f[0],0]),u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]];
  const raw=(x,y,z)=>{const d=[x-cam[0],y-cam[1],z-cam[2]],dep=d[0]*f[0]+d[1]*f[1]+d[2]*f[2];return [(d[0]*r[0]+d[1]*r[1])/dep,-(d[0]*u[0]+d[1]*u[1]+d[2]*u[2])/dep];};
  const fence=t=>{const k=Math.abs(t)/(Math.PI/4);return 400-70*k*k;};
  const wall=[];for(let d=-45;d<=45;d+=5){const t=d*Math.PI/180,rr=fence(t);wall.push([rr*Math.sin(t),rr*Math.cos(t)]);}
  const b=[...wall.map(q=>raw(q[0],q[1],0)),raw(0,0,0),raw(-20,-12,0),raw(20,-12,0),...wall.map(q=>raw(q[0],q[1],14))];
  const mnx=Math.min(...b.map(q=>q[0])),mxx=Math.max(...b.map(q=>q[0])),mny=Math.min(...b.map(q=>q[1])),mxy=Math.max(...b.map(q=>q[1]));
  const F=Math.min(W*1.22/(mxx-mnx),H*.88/(mxy-mny)),ox=W/2-F*(mnx+mxx)/2,oy=H*.54-F*(mny+mxy)/2;
  const pt=(x,y,z=0)=>{const a=raw(x,y,z);return [ox+F*a[0],oy+F*a[1]];},P=a=>a.map(q=>q.map(v=>v.toFixed(1)).join(',')).join(' ');
  const svg=node('svg',{viewBox:`0 0 ${W} ${H}`,width:W,height:H,class:'gc2-field',role:'img','aria-label':'Batted ball to its reported location; path illustrated'});
  const defs=node('defs');defs.innerHTML='<linearGradient id="gcfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7a45"/><stop offset="1" stop-color="#1d5232"/></linearGradient><radialGradient id="gcfs" cx=".5" cy="0" r=".7"><stop offset="0" stop-color="#a8d4ff" stop-opacity=".35"/><stop offset="1" stop-color="#a8d4ff" stop-opacity="0"/></radialGradient><clipPath id="gcfc"><polygon points="'+P([pt(0,-12),pt(-300,288),pt(300,288)])+'"/></clipPath>';
  svg.append(defs,node('rect',{width:W,height:H,fill:'#0d1f33'}),node('rect',{width:W,height:H*.5,fill:'url(#gcfs)'}));
  svg.append(node('polygon',{points:P([pt(0,0),...wall.map(q=>pt(q[0],q[1]))]),fill:'url(#gcfg)'}));
  svg.append(node('polygon',{points:P([...wall.map(q=>pt(q[0],q[1])),...wall.map(q=>pt(q[0]*.955,q[1]*.955)).reverse()]),fill:'#8a5a3c'}));
  svg.append(node('polygon',{points:P([...wall.map(q=>pt(q[0],q[1])),...wall.map(q=>pt(q[0],q[1],14)).reverse()]),fill:'#0f2d1f'}));
  svg.append(node('polyline',{points:P(wall.map(q=>pt(q[0],q[1],14))),fill:'none',stroke:'#ffcd57','stroke-width':1.2}));
  const dirt=[pt(0,-8)];for(let a=-75;a<=75;a+=5){const t=a*Math.PI/180;dirt.push(pt(95*Math.sin(t),60.5+95*Math.cos(t)));}
  svg.append(node('polygon',{points:P(dirt),fill:'#a9744f','clip-path':'url(#gcfc)'}));
  const bb=90/Math.SQRT2;svg.append(node('polygon',{points:P([pt(0,8),pt(bb-8,bb),pt(0,2*bb-8),pt(-(bb-8),bb)]),fill:'#2a6e3f'}));
  for(const s of [-1,1]){const e=fence(s*Math.PI/4)/Math.SQRT2,a=pt(0,0),q=pt(s*e,e);svg.append(node('line',{x1:a[0],y1:a[1],x2:q[0],y2:q[1],stroke:'#fff','stroke-opacity':.9,'stroke-width':1.2}));}
  for(const q of [[bb,bb],[0,2*bb],[-bb,bb],[0,0]])svg.append(node('polygon',{points:P([pt(q[0],q[1]-2.2),pt(q[0]+2.2,q[1]),pt(q[0],q[1]+2.2),pt(q[0]-2.2,q[1])]),fill:'#fff'}));
  const target=fieldTarget(m,illustrativeSector),{tx,ty,sp,reach}=target,sector=target.illustrativeSector;
  const ground=/ground/i.test(m.trajectory||'')||(Number.isFinite(m.launch_angle)?m.launch_angle:20)<6;
  const apex=ground?0:reach*Math.tan(Math.min(70,Math.max(6,Number.isFinite(m.launch_angle)?m.launch_angle:25))*Math.PI/180)/4;
  const shapeV2=battedShapeV2(reach,m.launch_angle,m.launch_speed,ground),at=q=>{const v=shapeV2.at(q);return [tx*v[0]/reach,ty*v[0]/reach,v[1]];};
  const shadow=[],path=[];for(let k=0;k<=40;k++){const a=at(k/40);shadow.push(pt(a[0],a[1]));path.push(pt(a[0],a[1],a[2]));}
  svg.append(node('polyline',{points:P(shadow),fill:'none',stroke:'#000','stroke-opacity':.33,'stroke-width':1.5,'stroke-linecap':'round'}));
  svg.append(node('polyline',{points:P(path),fill:'none',stroke:color,'stroke-opacity':.85,'stroke-width':2,pathLength:1,'stroke-dasharray':1,'stroke-linecap':'round',class:still?'':'gc2-draw'}));
  if(!sector){const spot=pt(tx,ty);svg.append(node('circle',{cx:spot[0],cy:spot[1],r:9,fill:color,'fill-opacity':.28,class:still?'':'gc2-spot'}),node('circle',{cx:spot[0],cy:spot[1],r:4,fill:'none',stroke:color,'stroke-width':1.6,class:still?'':'gc2-spot'}));}
  if(sector){svg.setAttribute('data-field-position-basis','illustrative-fielder-sector');svg.setAttribute('data-field-sector',sector);svg.setAttribute('aria-label','Illustrative '+sector+' sector; reported coordinates retained');const label=node('text',{x:W/2,y:H-8,fill:'#fff',stroke:'#071c2b','stroke-width':3,'paint-order':'stroke','text-anchor':'middle','font-size':Math.min(11,Math.max(8,W/16)),class:'gc2-field-sector-label'});label.textContent='Illustrative · '+sector+' sector';svg.append(label);}
  return svg;
 }
 // Lit-park batted ball (native GcFieldPlay parity). Plate warped to regulation geometry; path illustrated.
 const PARK_P=[905.8547139706648,676.5762580806239,-260.0385648219294,74604.23158697743,-0.5649219716481465,181.73017743139593,-1040.9587285237692,95270.22371657364,-0.0009136086446978954,0.9334638810664879,-0.35867024976088235,103.32996064678325];
 const parkImg=(()=>{let im=null;return ()=>{if(!im){im=new Image();im.decoding='async';const base=(document.currentScript&&document.currentScript.src)||[...document.scripts].map(x=>x.src).find(x=>/live-tv[^/]*\.js/.test(x))||'';im.src=base?new URL('orbital-park-0f039cdbc820.jpg',base).href:'orbital-park-0f039cdbc820.jpg';}return im;};})();
 const fieldPlayed=new Set();
 function fieldCanvas(m,color,W,H,still,illustrativeSector=null,sceneStartedAt=null,retained=null){
  const x0=m?.coord_x,y0=m?.coord_y,img=parkImg();if(!Number.isFinite(x0)||!Number.isFinite(y0)||!img)return null;
  const pr=(x,y,z)=>{const q=PARK_P,w=q[8]*x+q[9]*y+q[10]*z+q[11];return [(q[0]*x+q[1]*y+q[2]*z+q[3])/w,(q[4]*x+q[5]*y+q[6]*z+q[7])/w];};
  const fence=t=>{const d=[-45,-22.5,0,22.5,45],f=[335,385,400,375,325];t=Math.max(-45,Math.min(45,t));let i=0;while(i<3&&t>d[i+1])i++;return f[i]+(f[i+1]-f[i])*(t-d[i])/(d[i+1]-d[i]);};
  const target=fieldTarget(m,illustrativeSector),{tx,ty,sp,reach}=target,sector=target.illustrativeSector;
  const ground=/ground/i.test(m.trajectory||'')||(Number.isFinite(m.launch_angle)?m.launch_angle:20)<6;
  const apex=ground?0:reach*Math.tan(Math.min(70,Math.max(6,Number.isFinite(m.launch_angle)?m.launch_angle:25))*Math.PI/180)/4;
  const shapeV2=battedShapeV2(reach,m.launch_angle,m.launch_speed,ground);
  const dur=ground?1.1:FIELD_MODEL_DURATION_V2&&Number.isFinite(shapeV2.hang)?Math.min(3.4,Math.max(1.3,shapeV2.hang*.5)):(Number.isFinite(m.launch_angle)&&Number.isFinite(m.launch_speed)&&m.launch_speed>0&&(m.launch_angle>=45||/pop/i.test(String(m.trajectory||'')))?Math.min(5.5,Math.max(2.5,2*m.launch_speed*1.4667*Math.sin(m.launch_angle*Math.PI/180)/32.17*.78)):Math.min(4,Math.max(1.3,reach/((Number.isFinite(m.launch_speed)?m.launch_speed:95)*1.2)))),lead=.35;
  const gone=!ground&&Math.abs(sp*180/Math.PI)<=45&&reach>fence(sp*180/Math.PI)+4;
  const at=u=>{const v=shapeV2.at(u);return [tx*v[0]/reach,ty*v[0]/reach,v[1]];};
  const cv=retained||document.createElement('canvas'),dpr=Math.min(2,window.devicePixelRatio||1);cv.__fieldResizeDispose?.();if(cv.__fieldFrame)cancelAnimationFrame(cv.__fieldFrame);if(cv.__fieldImageWake){img.removeEventListener('load',cv.__fieldImageWake);img.removeEventListener('error',cv.__fieldImageWake);}const generation=(cv.__fieldGeneration||0)+1;cv.__fieldGeneration=generation;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);cv.className='gc2-field';cv.setAttribute('role','img');cv.setAttribute('aria-label','Batted ball to its reported location; path illustrated, generic ballpark');
  const g=cv.getContext('2d'),VW=cv.width,VH=cv.height,PW=1448,PH=1086,cover=Math.max(VW/PW,VH/PH);
  // Retain the original logical camera and styling units; only the raster backing follows the rendered box.
  let surfaceX=1,surfaceY=1,sizeOwner=null,sizeObserver=null,ownerObserver=null,wasConnected=!!cv.isConnected;
  const setSurfaceTransform=(a,b,c,d,e,f)=>g.setTransform(a*surfaceX,b*surfaceY,c*surfaceX,d*surfaceY,e*surfaceX,f*surfaceY);
  const syncSurface=()=>{
   const rect=cv.isConnected?cv.getBoundingClientRect?.():null;
   const ratio=Math.min(2,Math.max(.1,Number(window.devicePixelRatio)||1));
   const wanted=rect&&Number.isFinite(rect.width)&&rect.width>0&&Number.isFinite(rect.height)&&rect.height>0?Math.max(1,rect.width*ratio/VW,rect.height*ratio/VH):1;
   const scale=Math.min(wanted,Math.max(1,2048/Math.max(VW,VH))),width=Math.round(VW*scale),height=Math.round(VH*scale);
   if(cv.width===width&&cv.height===height)return false;
   cv.width=width;cv.height=height;surfaceX=width/VW;surfaceY=height/VH;return true;
  };
  const watchSizeOwner=()=>{
   const owner=cv.closest?.('.otv-trk-col')||null;if(owner===sizeOwner)return;
   ownerObserver?.disconnect();ownerObserver=null;sizeOwner=owner;
   if(owner&&typeof MutationObserver==='function'){ownerObserver=new MutationObserver(resizeSurface);ownerObserver.observe(owner,{attributes:true,attributeFilter:['style','class']});}
  };
  const disposeSurface=()=>{sizeObserver?.disconnect();ownerObserver?.disconnect();sizeObserver=ownerObserver=null;sizeOwner=null;window.removeEventListener?.('resize',resizeSurface);};
  const resizeSurface=()=>{
   if(cv.__fieldGeneration!==generation)return;
   if(!cv.isConnected){if(wasConnected)disposeSurface();return;}
   wasConnected=true;watchSizeOwner();if(syncSurface()&&!cv.__fieldFrame)cv.__fieldFrame=requestAnimationFrame(frameAt);
  };
  cv.__fieldResizeDispose=disposeSurface;
  const pts=[pr(0,0,0),pr(tx,ty,0)];for(let k=0;k<=10;k++)pts.push(pr(...at(k/10)));
  const xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]),mnx=Math.min(...xs),mxx=Math.max(...xs),mny=Math.min(...ys),mxy=Math.max(...ys);
  const frame=Math.max(1,Math.min(2.4,Math.min(VW/cover/(mxx-mnx+260),VH/cover/(mxy-mny+230)))),home=pr(0,0,0);
  const ease=u=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0=Number.isFinite(sceneStartedAt)?sceneStartedAt:clock();let paintedAt=Math.max(t0,cv.__fieldPaintedAt||t0);cv.dataset.sceneClockMs=String(t0);
  // These are endpoints of this illustrative canvas, never measured play times.
  cv.__fieldEndpoints=Object.freeze({schema:1,basis:'illustrative-canvas',startedAt:t0,animated:!reduce&&!still,
   ground,sector:!!sector,landingAt:t0+(lead+dur)*1000,
   fenceCrossAt:gone?t0+(lead+dur*Math.min(shapeV2.fractionAt(fence(sp*180/Math.PI)),Math.max(0,Math.min(1,fence(sp*180/Math.PI)/reach))))*1000:null,
   throwAt:null,runnerAt:null,baseAt:null,scoredAt:null});
  // Perspective park uses the exact same camera, 90 ft bases, 60.5 ft mound and regulation home/boxes.
  // It remains useful while the decorative JPEG is loading or unavailable.
  function fallbackPark(){
   g.fillStyle='#102739';g.fillRect(0,0,PW,PH);
   const polygon=(world,fill)=>{g.beginPath();world.forEach((p,i)=>{const q=pr(...p);if(i)g.lineTo(...q);else g.moveTo(...q);});g.closePath();g.fillStyle=fill;g.fill();};
   const wall=[];for(let a=-45;a<=45;a+=3){const t=a*Math.PI/180,r=fence(a);wall.push([r*Math.sin(t),r*Math.cos(t),0]);}
   polygon([[0,0,0],...wall],'#1d5534');polygon([...wall,...wall.map(q=>[q[0],q[1],14]).reverse()],'#123c2c');
   const dirt=[[0,-8,0]];for(let a=-75;a<=75;a+=5){const t=a*Math.PI/180;dirt.push([95*Math.sin(t),60.5+95*Math.cos(t),0]);}polygon(dirt,'#966446');
   const b=90/Math.SQRT2;polygon([[0,8,0],[b-8,b,0],[0,2*b-8,0],[-b+8,b,0]],'#27633d');
   g.lineWidth=2;g.strokeStyle='rgba(255,255,255,.8)';for(const side of [-1,1]){const r=fence(side*45)/Math.SQRT2;g.beginPath();g.moveTo(...pr(0,0,0));g.lineTo(...pr(side*r,r,0));g.stroke();}
   for(const [x,y] of [[b,b],[0,2*b],[-b,b]])polygon([[x,y-1.25,0],[x+1.25,y,0],[x,y+1.25,0],[x-1.25,y,0]],'#f2efe3');
   polygon(HOME,'#f2efe3');for(const box of BOXES){g.beginPath();box.forEach((q,i)=>{const p=pr(...q);if(i)g.lineTo(...p);else g.moveTo(...p);});g.closePath();g.stroke();}
   const mound=[];for(let a=0;a<24;a++){const t=a*Math.PI/12;mound.push([9*Math.cos(t),60.5+9*Math.sin(t),0]);}polygon(mound,'#ad7855');
  }
  function frameAt(now,initial=false){
   if(cv.__fieldGeneration!==generation)return;if(!initial&&!cv.isConnected){disposeSurface();return;}if(cv.isConnected){wasConnected=true;watchSizeOwner();}syncSurface();paintedAt=Math.max(paintedAt,now);cv.__fieldPaintedAt=paintedAt;const el=reduce||still?99:Math.max(0,(paintedAt-t0)/1000),k=ease(Math.min(1,el/(lead+dur+.25)));cv.dataset.frameElapsedMs=(el*1000).toFixed(3);
   // V2 follow: lean toward the moving ball early, settle on the whole play by landing; the ball stays in view.
   const s=2.8+(frame-2.8)*k,z=cover*s,kc=k*k,follow=.55*Math.min(1,el/lead),bn=pr(...at(Math.max(0,Math.min(1,(el-lead)/dur))));
   let cx=home[0]+(bn[0]-home[0])*follow*(1-kc)+((mnx+mxx)/2-home[0])*kc,cy=home[1]+(bn[1]-home[1])*follow*(1-kc)+((mny+mxy)/2-home[1])*kc;
   {const hx=VW/z/2*.8,hy=VH/z/2*.8;cx=Math.max(bn[0]-hx,Math.min(bn[0]+hx,cx));cy=Math.max(bn[1]-hy,Math.min(bn[1]+hy,cy));}
   cx=Math.max(VW/z/2,Math.min(PW-VW/z/2,cx));cy=Math.max(VH/z/2,Math.min(PH-VH/z/2,cy));
   setSurfaceTransform(1,0,0,1,0,0);g.clearRect(0,0,VW,VH);
   setSurfaceTransform(z,0,0,z,VW/2-z*cx,VH/2-z*cy);if(img.complete&&img.naturalWidth){g.drawImage(img,0,0,PW,PH);cv.dataset.parkArt='loaded';}else{fallbackPark();cv.dataset.parkArt='perspective-geometry';}
   setSurfaceTransform(1,0,0,1,0,0);const vg=g.createRadialGradient(VW/2,VH*.55,0,VW/2,VH*.55,Math.max(VW,VH)*.8);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.33)');g.fillStyle=vg;g.fillRect(0,0,VW,VH);
   setSurfaceTransform(z,0,0,z,VW/2-z*cx,VH/2-z*cy);const px=1/z*dpr,u=Math.max(0,Math.min(1,(el-lead)/dur)),N=60,upto=Math.ceil(N*u);cv.dataset.motionFraction=u.toFixed(6);g.lineCap='round';
   g.strokeStyle='rgba(0,0,0,.18)';g.lineWidth=1.6*px;for(let i=1;i<=upto;i++){const a=at((i-1)/N),b=at(Math.min(i/N,u)),e=pr(a[0],a[1],0),f=pr(b[0],b[1],0);g.beginPath();g.moveTo(...e);g.lineTo(...f);g.stroke();}
   for(const pass of [0,1])for(let i=1;i<=upto;i++){const a=pr(...at((i-1)/N)),b=pr(...at(Math.min(i/N,u))),fd=Math.pow(Math.min(i/N,u)/Math.max(.001,u),1.6);
    if(pass===0){g.strokeStyle=color;g.globalAlpha=.10+.40*fd;g.lineWidth=(4+7*fd)*px;}else{g.strokeStyle='#fff';g.globalAlpha=.25+.70*fd;g.lineWidth=(1+1.8*fd)*px;}
    g.beginPath();g.moveTo(...a);g.lineTo(...b);g.stroke();}
   g.globalAlpha=1;const cur=at(u),bp=pr(...cur),sh=pr(cur[0],cur[1],0),r=3.2*px;
   const hz=Math.max(0,cur[2]),ss=1+Math.min(1.4,hz/90);g.fillStyle=`rgba(0,0,0,${(.45*(1-Math.min(.75,hz/140))).toFixed(3)})`;g.beginPath();g.ellipse(sh[0],sh[1],r*1.3*ss,r*.5*ss,0,0,7);g.fill();
   const gl=g.createRadialGradient(bp[0],bp[1],0,bp[0],bp[1],r*5);gl.addColorStop(0,'rgba(255,255,255,.75)');gl.addColorStop(.25,'rgba(255,240,210,.35)');gl.addColorStop(1,'rgba(255,240,210,0)');g.fillStyle=gl;g.beginPath();g.arc(bp[0],bp[1],r*5,0,7);g.fill();
   g.fillStyle='#fff';g.beginPath();g.arc(bp[0],bp[1],r,0,7);g.fill();
   for(const hop of shapeV2.bounces){const since=el-lead-hop*dur;if(since<0||since>.7)continue;const kk=since/.7,a=at(hop);
    for(let i=0;i<12;i++){const ang=i*2.4,d=2.5+i%4,q=pr(a[0]+Math.cos(ang)*d*kk,a[1]+Math.sin(ang)*d*kk,(i%3+1)*kk*(1-kk)*4);g.fillStyle=`rgba(196,140,96,${.55*(1-kk)})`;g.beginPath();g.arc(q[0],q[1],(1.2+2.5*kk)*px*1.4,0,7);g.fill();}}
   if(gone){const fd=fence(sp*180/Math.PI),uc=Math.min(shapeV2.fractionAt(fd),Math.max(0,Math.min(1,fd/reach))),since=el-lead-uc*dur;if(since>=0&&since<.6){const kk=since/.6,q=pr(fd*Math.sin(sp),fd*Math.cos(sp),Math.max(at(uc)[2],8));g.strokeStyle=`rgba(255,236,170,${(.9*(1-kk)).toFixed(3)})`;g.lineWidth=2*px;for(let i=0;i<8;i++){const a=i*Math.PI/4,r0=(3+6*kk)*px*1.4,r1=(7+16*kk)*px*1.4;g.beginPath();g.moveTo(q[0]+Math.cos(a)*r0,q[1]+Math.sin(a)*r0);g.lineTo(q[0]+Math.cos(a)*r1,q[1]+Math.sin(a)*r1);g.stroke();}}}
   if(u>=1&&!gone&&!sector){const kk=Math.max(0,Math.min(1,(el-lead-dur)/.5)),q=pr(tx,ty,0);g.strokeStyle=color;g.globalAlpha=1-.4*kk;g.lineWidth=2*px;g.beginPath();g.ellipse(q[0],q[1],(8+18*kk)*px*1.4,(3.2+7*kk)*px*1.4,0,0,7);g.stroke();g.globalAlpha=1;}
   if(sector){setSurfaceTransform(1,0,0,1,0,0);g.globalAlpha=1;g.font=(Math.min(11,Math.max(8,W/16))*dpr)+'px sans-serif';g.textAlign='center';g.textBaseline='middle';const text='Illustrative · '+sector+' sector',box=Math.min(VW,g.measureText(text).width+12*dpr),y=VH-12*dpr;g.fillStyle='rgba(7,28,43,.92)';g.fillRect((VW-box)/2,y-8*dpr,box,16*dpr);g.fillStyle='#fff';g.fillText(text,VW/2,y);}
   if(el<lead+dur+1.2)cv.__fieldFrame=requestAnimationFrame(frameAt);else cv.__fieldFrame=0;
  }
  if(sector){cv.setAttribute('data-field-position-basis','illustrative-fielder-sector');cv.setAttribute('data-field-sector',sector);cv.setAttribute('aria-label','Illustrative '+sector+' sector; reported coordinates retained');}
  const wake=()=>{img.removeEventListener('load',wake);img.removeEventListener('error',wake);if(cv.__fieldGeneration===generation&&cv.isConnected&&!cv.__fieldFrame)cv.__fieldFrame=requestAnimationFrame(frameAt);};cv.__fieldImageWake=wake;if(!img.complete){img.addEventListener('load',wake,{once:true});img.addEventListener('error',wake,{once:true});}
  cv.__disposeFieldScene=()=>{disposeSurface();if(cv.__fieldFrame)cancelAnimationFrame(cv.__fieldFrame);cv.__fieldFrame=0;cv.__fieldGeneration++;img.removeEventListener('load',wake);img.removeEventListener('error',wake);};
  frameAt(clock(),true);cv.style.width=W+'px';cv.style.height=H+'px';
  if(typeof ResizeObserver==='function'){sizeObserver=new ResizeObserver(resizeSurface);sizeObserver.observe(cv);}window.addEventListener?.('resize',resizeSurface);watchSizeOwner();
  return cv;
 }
 function flightSvg(list,zone,heat,W,H,hit){
// Pure presentation camera. Feet, pitch parameterization, and scene clocks remain caller-owned.
function pitchCameraCore(){
 const RAD=Math.PI/180,FRONT=17/12,HW=17/24,RADIUS=9.125/(24*Math.PI),DURATION=180;
 const presets=Object.freeze(['catcher-close','catcher','wide-catcher','umpire','side','pitcher','free']);
 // r4 close framing: front-plane box from just below the plate's front edge to above the tallest zone.
 const CLOSE=Object.freeze([-1.75,1.75].flatMap(x=>[-.02,4.05].map(z=>Object.freeze([x,FRONT,z]))));
 // Fixed presentation corridor: plate approach and release/rubber context, never a measured zone or per-pitch extent.
 const SCENE=Object.freeze([...[FRONT,FRONT+.65].flatMap(y=>[-2,2].flatMap(x=>[-.25,4.5].map(z=>Object.freeze([x,y,z])))),...[50,60.5].flatMap(y=>[-2,2].flatMap(x=>[3.5,8].map(z=>Object.freeze([x,y,z]))))]);
 const wrap=n=>((n+180)%360+360)%360-180,clamp=n=>Math.max(-15,Math.min(65,n));
 const pose=(eye,target)=>{const d=eye.map((v,i)=>v-target[i]),radius=Math.hypot(...d);return {target:[...target],radius,yaw:Math.atan2(d[0],-d[1])/RAD,pitch:Math.asin(d[2]/radius)/RAD};};
 const catalog={'catcher-close':pose([0,-3.2,2.55],[0,40,2.75]),catcher:pose([0,-3.2,2.55],[0,40,2.75]),'wide-catcher':pose([0,-14,4.2],[0,28,3]),umpire:pose([0,-6.8,6.3],[0,27,2.8]),side:pose([72,18,11],[0,30,2.8]),pitcher:pose([0,84,7],[0,FRONT,2.5])};
 for(const [name,p]of Object.entries(catalog)){p.nominalWeight=name==='catcher'||name==='catcher-close'?1:0;p.paddingFraction=name==='wide-catcher'?.16:.08;p.closeWeight=name==='catcher-close'?1:0;}
 function create(){
  let chosen='catcher',to={...catalog.catcher,target:[...catalog.catcher.target]},from=to,born=0,active=false;
  function sample(now){if(!active)return {...to,target:[...to.target],preset:chosen,animating:false};const t=Math.max(0,Math.min(1,(now-born)/DURATION)),e=t*t*(3-2*t);if(t>=1)active=false;return {target:to.target.map((v,i)=>from.target[i]+(v-from.target[i])*e),radius:from.radius+(to.radius-from.radius)*e,yaw:wrap(from.yaw+wrap(to.yaw-from.yaw)*e),pitch:from.pitch+(to.pitch-from.pitch)*e,nominalWeight:from.nominalWeight+(to.nominalWeight-from.nominalWeight)*e,paddingFraction:from.paddingFraction+(to.paddingFraction-from.paddingFraction)*e,closeWeight:(from.closeWeight||0)+((to.closeWeight||0)-(from.closeWeight||0))*e,preset:chosen,animating:active};}
  function assign(next,name,now,immediate){from=sample(now);to={...next,target:[...next.target],yaw:wrap(next.yaw),pitch:clamp(next.pitch)};chosen=name;born=now;active=!immediate&&(Math.abs(wrap(to.yaw-from.yaw))+Math.abs(to.pitch-from.pitch)+Math.abs(to.radius-from.radius)+Math.hypot(...to.target.map((v,i)=>v-from.target[i]))+Math.abs((to.closeWeight||0)-(from.closeWeight||0))>1e-9);return state();}
  function state(){return {preset:chosen,yaw:wrap(to.yaw),pitch:to.pitch,animating:active};}
  const free=p=>({...p,target:[0,30,2.8],radius:70,nominalWeight:0,paddingFraction:.08,closeWeight:0});
  return {sample,state,set(name,now=0,immediate=false){if(!presets.includes(name))return state();return assign(name==='free'?free(sample(now)):catalog[name],name,now,immediate);},rotate(dx,dy,now=0,immediate=false){if(!Number.isFinite(dx)||!Number.isFinite(dy))return state();const next=free({...to,yaw:wrap(to.yaw+dx),pitch:clamp(to.pitch+dy)});return assign(next,'free',now,immediate);},snap(){from=to;active=false;return state();}};
 }
 function basis(p){
  const y=p.yaw*RAD,e=p.pitch*RAD,out=[Math.sin(y)*Math.cos(e),-Math.cos(y)*Math.cos(e),Math.sin(e)],F=out.map(v=>-v),R=[Math.cos(y),Math.sin(y),0],U=[R[1]*F[2],-R[0]*F[2],R[0]*F[1]-R[1]*F[0]];
  // Eye safety depends only on the fixed corridor and selected pose, never the current pitch or reported zone.
  let radius=p.radius;for(const w of SCENE){const dot=w.reduce((n,v,i)=>n+(v-p.target[i])*F[i],0);radius=Math.max(radius,2+RADIUS-dot);}
  const eye=p.target.map((v,i)=>v+out[i]*radius);
  const raw=w=>{const d=w.map((v,i)=>v-eye[i]),z=d.reduce((n,v,i)=>n+v*F[i],0);return [d.reduce((n,v,i)=>n+v*R[i],0)/z,-d.reduce((n,v,i)=>n+v*U[i],0)/z,z];};
  return {raw,eye,forward:F,right:R,up:U,radius};
 }
 function project(p,W,H,paths,top=3.4,bottom=1.6){
  const face=[[-HW,FRONT,top],[HW,FRONT,top],[HW,FRONT,bottom],[-HW,FRONT,bottom]],rear=face.map(w=>[w[0],FRONT+.65,w[2]]),b=basis(p),raw=b.raw;
  // A fixed frustum per pose: neither source paths nor player-specific bounds determine camera scale/translation.
  const rows=SCENE.map(w=>{const r=raw(w),m=RADIUS/r[2];return [r[0]-m,r[0]+m,r[1]-m,r[1]+m];}),xmin=Math.min(...rows.map(r=>r[0])),xmax=Math.max(...rows.map(r=>r[1])),ymin=Math.min(...rows.map(r=>r[2])),ymax=Math.max(...rows.map(r=>r[3]));
  const pad=W*p.paddingFraction,bounds={left:pad,right:W-pad,top:H*.06,bottom:H*.76};
  let f=Math.min((bounds.right-bounds.left)/(xmax-xmin),(bounds.bottom-bounds.top)/(ymax-ymin)),ox=(bounds.left+bounds.right)/2-f*(xmin+xmax)/2,oy=(bounds.top+bounds.bottom)/2-f*(ymin+ymax)/2;
  const k=p.closeWeight||0;
  if(k>0){const c=CLOSE.map(w=>{const r=raw(w),m=RADIUS/r[2];return [r[0]-m,r[0]+m,r[1]-m,r[1]+m];}),cx0=Math.min(...c.map(r=>r[0])),cx1=Math.max(...c.map(r=>r[1])),cy0=Math.min(...c.map(r=>r[2])),cy1=Math.max(...c.map(r=>r[3]));
   const cl=W*.06,cr=W-W*.06,ct=H*.03,cb=H*.97,cf=Math.min((cr-cl)/(cx1-cx0),(cb-ct)/(cy1-cy0)),cox=(cl+cr)/2-cf*(cx0+cx1)/2,coy=(ct+cb)/2-cf*(cy0+cy1)/2;
   f=f+(cf-f)*k;ox=ox+(cox-ox)*k;oy=oy+(coy-oy)*k;}

  return {...b,f,ox,oy,project(w){const r=raw(w);return [ox+f*r[0],oy+f*r[1],r[2]];},face,rear,padding:pad,bounds};
 }
 return Object.freeze({presets,create,project,wrap,clamp,framingBasis:'fixed-presentation-corridor',canonicalScene:SCENE,durationMs:DURATION,rotationForKey(key,shift=false){const n=shift?15:5;return ({ArrowLeft:[-n,0],ArrowRight:[n,0],ArrowUp:[0,n],ArrowDown:[0,-n]})[key]||null;},rotationForDrag(dx,dy,width,height){return [dx/Math.max(1,width)*180,-dy/Math.max(1,height)*90];}});
}
  const cameraKit=pitchCameraCore(),camera=cameraKit.create();
  let latest=[list,zone,heat],disposed=false;
  const svg=node('svg',{viewBox:`0 0 ${W} ${H}`,class:'gc2-flight-svg',role:'img','aria-label':'Pitch flight, catcher view','data-world-unit':'ft','data-ball-circumference-in':BALL_CIRCUMFERENCE_IN});
  // Presentation pixels use a320px compact reference; world geometry/ball radius are unchanged.
  const flightStyleUnit=W/320;
  let frame=0,signature='',paintedAt=0,microReset=()=>{},currentMicroKey='';
  const originalOverflow=svg.style.overflow,microSuppressed=new Set(),motionPreference=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  const cancelMicro=()=>{if(currentMicroKey)microSuppressed.add(currentMicroKey);while(microSuppressed.size>16)microSuppressed.delete(microSuppressed.values().next().value);microReset();};
  const motionChanged=()=>{cancelMicro();if(motionPreference?.matches){camera.snap();if(!disposed)update(...latest,true);}};
  motionPreference?.addEventListener?.('change',motionChanged);
  function update(list,zone,heat,force=false,at=clock()){
   if(disposed)return svg;latest=[list,zone,heat];
   const next=JSON.stringify([list.map(q=>[q.id,q.playId,q.path,q.current,q.measured,q.startedAt,q.color,q.n,q.zoneMicro]),zone,heat]);
   if(next===signature&&!force)return svg;signature=next;if(frame)cancelAnimationFrame(frame);frame=0;microReset();svg.replaceChildren();
   const hasZone=Number.isFinite(zone?.top)&&Number.isFinite(zone?.bottom)&&zone.top>zone.bottom&&zone.bottom>=0&&zone.top<=12;
   svg.dataset.zoneSource=hasZone?'reported':'schematic';
   const pose=camera.sample(at),viewName=pose.preset.replaceAll('-',' ');
   svg.dataset.pitchCamera=pose.preset;svg.dataset.cameraYaw=String(pose.yaw);svg.dataset.cameraPitch=String(pose.pitch);
   svg.setAttribute('aria-label','Pitch flight, '+viewName+' view'+(hasZone?'':'; zone bounds unavailable, nominal schematic reference'));
   const top=hasZone?zone.top:3.4,bot=hasZone?zone.bottom:1.6;
   const projection=cameraKit.project(pose,W,H,list.map(q=>q.path),top,bot),{f,ox,oy}=projection,pr=projection.project;
   const P=w=>pr(w).slice(0,2).map(v=>v.toFixed(1)).join(','),poly=(a,attr)=>node('polygon',{points:a.map(P).join(' '),'data-world-points':JSON.stringify(a),...attr});
   // r3: the whole pitch stage (scene + inspection UI) scales about the zone centre; proportions and world feet are unchanged.
   const zoneCentre=pr([0,FRONT,(top+bot)/2]),stage=node('g',{'data-zone-stage-scale':ZONE_STAGE_SCALE_V2,transform:`translate(${zoneCentre[0]} ${zoneCentre[1]}) scale(${ZONE_STAGE_SCALE_V2}) translate(${-zoneCentre[0]} ${-zoneCentre[1]})`});
   const defs=node('defs'),scene=node('g',{'data-zone-micro-camera':'presentation'});stage.append(scene);svg.append(defs,stage);
   BOXES.forEach((box,i)=>scene.append(poly(box,{fill:'none',stroke:'rgba(233,238,245,.16)','stroke-width':1,'data-world-shape':'batters-box','data-world-points':JSON.stringify(box),'data-side':i?'right':'left'})));
   scene.append(poly(HOME,{fill:'rgba(233,238,245,.16)','data-world-shape':'home-plate','data-world-points':JSON.stringify(HOME)}));
   const face=projection.face;
   if(heat&&hasZone){const g=node('g',{'clip-path':`url(#gc2c${gid})`}),clip=node('clipPath',{id:'gc2c'+gid});clip.append(poly(face,{}));defs.append(clip);
    heat.forEach((r,i)=>{if(r==null||i>8)return;const c=heatColor(r),id='gc2h'+gid+'_'+i,rg=node('radialGradient',{id});rg.append(node('stop',{offset:0,'stop-color':`rgb(${c.rgb})`,'stop-opacity':c.a}),node('stop',{offset:.55,'stop-color':`rgb(${c.rgb})`,'stop-opacity':c.a*.45}),node('stop',{offset:1,'stop-color':`rgb(${c.rgb})`,'stop-opacity':0}));defs.append(rg);
     const x0=-HW+2*HW*(i%3)/3,x1=x0+2*HW/3,z0=top-(top-bot)*Math.floor(i/3)/3,z1=z0-(top-bot)/3;
     g.append(poly([[x0,FRONT,z0],[x1,FRONT,z0],[x1,FRONT,z1],[x0,FRONT,z1]],{fill:`url(#${id})`,'data-world-shape':'zone-heat-cell'}));});scene.append(g);gid++;}
   if(hasZone){
    // A shallow visual return behind the reported face, never a reported zone-depth measurement.
    const rear=FRONT+.65,depth={'data-zone-depth-basis':'schematic-presentation',stroke:'none'};
    scene.append(poly([[-HW,rear,top],[HW,rear,top],[HW,rear,bot],[-HW,rear,bot]],{...depth,fill:'rgba(223,228,234,.025)','data-world-shape':'zone-rear-reference'}));
    for(const side of [-HW,HW])scene.append(poly([[side,FRONT,top],[side,rear,top],[side,rear,bot],[side,FRONT,bot]],{...depth,fill:'rgba(225,230,236,.045)','data-world-shape':'zone-side-reference'}));
    scene.append(poly([[-HW,FRONT,top],[HW,FRONT,top],[HW,rear,top],[-HW,rear,top]],{...depth,fill:'rgba(237,240,244,.06)','data-world-shape':'zone-top-reference'}));
    const faceId='gc2frost'+gid++,faceRamp=node('linearGradient',{id:faceId,x1:0,y1:0,x2:0,y2:1});faceRamp.append(node('stop',{offset:0,'stop-color':'#3c4651','stop-opacity':194/255}),node('stop',{offset:1,'stop-color':'#343c46','stop-opacity':184/255}));defs.append(faceRamp);
    scene.append(poly(face,{fill:`url(#${faceId})`,stroke:'none','stroke-width':0,'data-world-shape':'strike-zone','data-surface-finish':'soft-grey','data-zone-top-ft':top,'data-zone-bottom-ft':bot,'data-zone-plane-y-ft':FRONT}));
    for(const k of [1,2]){const x=-HW+2*HW*k/3,z=top-(top-bot)*k/3;scene.append(node('path',{d:`M${P([x,FRONT,top])}L${P([x,FRONT,bot])}M${P([-HW,FRONT,z])}L${P([HW,FRONT,z])}`,stroke:'none','stroke-width':0,'data-world-shape':'zone-grid'}));}}
   else{const nominalId='gc2nominal'+gid++,nominalRamp=node('linearGradient',{id:nominalId,x1:0,y1:0,x2:0,y2:1});nominalRamp.append(node('stop',{offset:0,'stop-color':'#3c4651','stop-opacity':154/255}),node('stop',{offset:1,'stop-color':'#343c46','stop-opacity':144/255}));defs.append(nominalRamp);scene.append(poly(face,{fill:`url(#${nominalId})`,stroke:'none','stroke-width':0,'data-world-shape':'catcher-reference','data-zone-basis':'schematic'}));const label=node('text',{x:W/2,y:H-4,'text-anchor':'middle',fill:'rgba(220,224,229,.5)','font-size':Math.max(7,Math.min(9,W*.06)),'data-zone-reference-label':'unknown'});label.textContent='Zone bounds unavailable';scene.append(label);}
   // ZONE_MICRO_SCENE_BEGIN
   const microOwner=list.find(q=>q.current),micro=microOwner?.zoneMicro,geometry=hasZone?micro?.geometry:null;
   const microKey=microOwner?microOwner.id+'|'+microOwner.startedAt:'';
   let flash=null,leader=null,gapLine=null,gapCaption=null,gapConnector=null,reviewFrame=null,edgeLine=null,vignette=null;
   const microTrails=[];
   if(micro?.enabled&&geometry&&!microSuppressed.has(microKey)){
    svg.style.overflow='hidden';
    if(geometry.kind==='hit'){
     flash=poly(face,{fill:micro.color||'#ff637b','fill-opacity':0,stroke:'none','data-zone-micro':'entry-flash'});scene.append(flash);
    }
    if((geometry.kind==='near'||geometry.kind==='edge')&&micro.inPlay!==true){
     const near=geometry.kind==='near',center=pr(microOwner.path.at(-1)),a=pr(geometry.nearest),b=near&&geometry.surface?pr(geometry.surface):center,r=geometry.nominalRadiusFt*f/center[2],u=flightStyleUnit;
     const extent={left:Math.min(a[0],center[0]-r)-r*.45,right:Math.max(a[0],center[0]+r)+r*.45,top:Math.min(a[1],center[1]-r)-r*.45,bottom:Math.max(a[1],center[1]+r)+r*.45};
     const fit=Math.min(W*.86/(extent.right-extent.left),H*.56/(extent.bottom-extent.top));
     const zoom=Math.max(1,Math.min(REVIEW_V2.maxZoom,W*REVIEW_V2.ballWidth/r,fit));
     if([r,zoom,...a,...b,...center].every(Number.isFinite)&&r>0&&(!near||Math.hypot(b[0]-a[0],b[1]-a[1])>1e-6)){
      reviewFrame={a,b,center,r,zoom,near,cx:(extent.left+extent.right)/2,cy:(extent.top+extent.bottom)/2,tx:W*.5,ty:H*.42};
      // Measurement UI stays in screen units. Only the scene/physical sphere is uniformly enlarged.
      // V2: an edge (overlapping) pitch gets the same close camera but no measurement; the call stays the feed's.
      if(near){
      leader=node('g',{'data-zone-micro':'approximate-gap',opacity:0,'data-gap-basis':'estimated-nominal-surface-front-plane','aria-label':'Estimated nominal ball-surface gap '+geometry.gapInches.toFixed(1)+' inches to the drawn zone at the StatsAPI front-of-plate plane; not an ABS or ball/strike ruling.'});
      gapLine=node('path',{fill:'none',stroke:'#f5f8fc','stroke-width':1.35*u,'stroke-linecap':'round','stroke-linejoin':'round','data-gap-bracket':'true-endpoints'});
      gapConnector=node('path',{fill:'none',stroke:'rgba(244,248,252,.72)','stroke-width':.8*u,'stroke-linecap':'round'});
      gapCaption=node('g',{'data-gap-caption':'screen-space','data-caption-style':'inline-v2'});
      const value=node('text',{x:0,y:0,fill:'#fff',stroke:'rgba(5,10,18,.78)','stroke-width':3.2*u,'paint-order':'stroke','stroke-linejoin':'round','font-size':22*u,'font-weight':850,'text-anchor':'middle','dominant-baseline':'central','font-family':'system-ui,sans-serif','data-gap-value':'inches'});value.textContent=geometry.gapInches.toFixed(1)+'″';
      const estimate=node('text',{x:0,y:15*u,fill:'#e6edf5',stroke:'rgba(5,10,18,.7)','stroke-width':2.2*u,'paint-order':'stroke','stroke-linejoin':'round','font-size':7*u,'font-weight':800,'letter-spacing':1.3*u,'text-anchor':'middle','dominant-baseline':'central','font-family':'system-ui,sans-serif','data-gap-status':'estimate'});estimate.textContent='EST.';
      gapCaption.append(value,estimate);
      }
      // V2 focus: the drawn zone edge nearest the ball as one crisp line, plus a soft vignette. Presentation only.
      const centre=microOwner.path.at(-1),outX=Math.abs(centre[0])-HW,outZ=Math.max(centre[2]-zone.top,zone.bottom-centre[2]);
      const edgeWorld=outX>=outZ?[[Math.sign(centre[0])*HW,FRONT,zone.bottom-.45],[Math.sign(centre[0])*HW,FRONT,zone.top+.45]]:(z=>[[-HW-.45,FRONT,z],[HW+.45,FRONT,z]])(Math.abs(centre[2]-zone.top)<Math.abs(centre[2]-zone.bottom)?zone.top:zone.bottom);
      edgeLine=node('path',{d:`M${P(edgeWorld[0])}L${P(edgeWorld[1])}`,fill:'none',stroke:'#fff','stroke-width':1.5*u,'stroke-linecap':'round',pathLength:1,'stroke-dasharray':1,'stroke-dashoffset':1,opacity:0,'data-zone-micro':'zone-edge','data-world-points':JSON.stringify(edgeWorld)});scene.append(edgeLine);
      const vignetteId='gc2vig'+gid++,vg=node('radialGradient',{id:vignetteId,cx:.5,cy:.45,r:.75});vg.append(node('stop',{offset:0,'stop-color':'#03070c','stop-opacity':0}),node('stop',{offset:.55,'stop-color':'#03070c','stop-opacity':0}),node('stop',{offset:1,'stop-color':'#03070c','stop-opacity':.7}));defs.append(vg);
      vignette=node('rect',{x:0,y:0,width:W,height:H,fill:`url(#${vignetteId})`,opacity:0,'pointer-events':'none','data-zone-micro':'focus-vignette'});
      if(leader){leader.append(gapConnector,gapLine,gapCaption);stage.append(vignette,leader);}else stage.append(vignette);
     }
    }
   }
   microReset=()=>{scene.removeAttribute('transform');scene.removeAttribute('data-gap-review-zoom');flash?.setAttribute('fill-opacity',0);leader?.setAttribute('opacity',0);edgeLine?.setAttribute('opacity',0);vignette?.setAttribute('opacity',0);svg.style.overflow=originalOverflow;};
   function gapReviewEffect(elapsed){
    // V2: slower dolly in, held creeping close-up, smooth return to the locked camera (zoneReviewV2).
    return zoneReviewV2(elapsed);
   }
   function paintMicro(now){
    const preference=!!motionPreference?.matches;
    if(!micro?.enabled||!geometry||microSuppressed.has(microKey)||preference){microReset();return false;}
    const elapsed=now-microOwner.startedAt,review=reviewFrame?gapReviewEffect(elapsed):null,effect=review?{active:review.active,zoom:1+.35*review.amount,flash:0}:zoneMicroEnvelope(geometry.kind,elapsed,micro.inPlay===true);
    if(effect.active){
     svg.style.overflow='hidden';
     // In-play reviews never crop an unfinished flight or defer the contact scene.
     const amount=micro.inPlay===true?0:Math.max(0,Math.min(1,(effect.zoom-1)/.35));
     if(reviewFrame&&amount>0){
      const v=reviewFrame,s=1+(v.zoom*(review?.creep||1)-1)*amount,tx=(v.tx-v.cx*s)*amount+(1-amount)*v.cx*(1-s),ty=(v.ty-v.cy*s)*amount+(1-amount)*v.cy*(1-s);
      scene.setAttribute('transform',`translate(${tx} ${ty}) scale(${s})`);scene.setAttribute('data-gap-review-zoom',s);
      const draw=review?.draw??1;
      if(gapLine){
      const a=v.a.map((n,i)=>n*s+(i?ty:tx)),bFull=v.b.map((n,i)=>n*s+(i?ty:tx)),b=a.map((n,i)=>n+(bFull[i]-n)*Math.max(.001,draw)),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,ux=dx/length,uy=dy/length,u=flightStyleUnit,tick=4*u,head=Math.min(4.5*u,length*.28);
      gapLine.setAttribute('d',`M${a[0]-nx*tick} ${a[1]-ny*tick}L${a[0]+nx*tick} ${a[1]+ny*tick}M${a[0]} ${a[1]}L${b[0]} ${b[1]}M${b[0]-nx*tick} ${b[1]-ny*tick}L${b[0]+nx*tick} ${b[1]+ny*tick}M${a[0]+ux*head+nx*head*.55} ${a[1]+uy*head+ny*head*.55}L${a[0]} ${a[1]}L${a[0]+ux*head-nx*head*.55} ${a[1]+uy*head-ny*head*.55}M${b[0]-ux*head+nx*head*.55} ${b[1]-uy*head+ny*head*.55}L${b[0]} ${b[1]}L${b[0]-ux*head-nx*head*.55} ${b[1]-uy*head-ny*head*.55}`);
      gapLine.setAttribute('data-projected-nearest',JSON.stringify(a.slice(0,2)));gapLine.setAttribute('data-projected-surface',JSON.stringify(bFull.slice(0,2)));
      const mx=(a[0]+bFull[0])/2,my=(a[1]+bFull[1])/2,flat=Math.abs(bFull[0]-a[0])>=Math.abs(bFull[1]-a[1]),cx=Math.max(30*u,Math.min(W-30*u,mx+(flat?0:(mx>W/2?-1:1)*32*u))),cy=Math.max(18*u,Math.min(H*.82,my-(flat?17*u:0)));
      gapCaption.setAttribute('transform',`translate(${cx} ${cy})`);gapCaption.setAttribute('opacity',draw.toFixed(3));gapConnector.setAttribute('d','');leader.setAttribute('opacity',Math.min(1,amount*2.5));
      }
      edgeLine?.setAttribute('opacity',(.95*Math.min(1,amount*2)).toFixed(3));edgeLine?.setAttribute('stroke-dashoffset',(1-draw).toFixed(4));edgeLine?.setAttribute('stroke-width',(1.5*flightStyleUnit/s).toFixed(5));vignette?.setAttribute('opacity',(.85*amount).toFixed(3));
      // A uniform camera crop must not turn the retained thin pitch trail into a broad ribbon.
      for(const line of microTrails)line.setAttribute('vector-effect','non-scaling-stroke');
     }else{
      leader?.setAttribute('opacity',0);edgeLine?.setAttribute('opacity',0);vignette?.setAttribute('opacity',0);
      if(micro.inPlay!==true&&effect.zoom>1){const end=pr(microOwner.path.at(-1));scene.setAttribute('transform',`translate(${end[0]} ${end[1]}) scale(${effect.zoom}) translate(${-end[0]} ${-end[1]})`);}else scene.removeAttribute('transform');
     }
     flash?.setAttribute('fill-opacity',(.24*effect.flash).toFixed(4));
    }else microReset();
    return effect.active;
   }
   // ZONE_MICRO_SCENE_END
   currentMicroKey=microKey;
   const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,paints=[];
   for(const q of [...list].sort((a,b)=>a.current-b.current)){
    const rt=raw([0,FRONT,3.4]),rb=raw([0,FRONT,1.6]),rw=raw([HW,FRONT,2.5])[0]-raw([-HW,FRONT,2.5])[0],referenceF=Math.min(H*.50/(rb[1]-rt[1]),W*.62/rw);
    const pts=q.path.map(pr),reference=q.path.map(w=>{const r=raw(w);return [referenceF*r[0],referenceF*r[1]];}),N=pts.length-1,d=[0];for(let k=1;k<=N;k++)d.push(d.at(-1)+Math.hypot(reference[k][0]-reference[k-1][0],reference[k][1]-reference[k-1][1]));
    const g=node('g',{class:q.current?'gc2-cur':'gc2-old','data-point-id':q.id,'data-pitch-id':q.playId,'data-geometry':q.measured?'measured':'plate-guide','data-path-source':q.pathSource,'data-started-at':q.startedAt,'aria-pressed':'false'});
    const lines=[];for(let k=1;k<=N;k++){const line=node('line',{x1:pts[k-1][0].toFixed(4),y1:pts[k-1][1].toFixed(4),stroke:q.color,'stroke-linecap':'round','data-trail-segment':k,...(q.measured?{}:{'stroke-dasharray':'5 6'})});lines.push(line);microTrails.push(line);g.append(line);}
    const end=pts.at(-1),endRad=BALL_RADIUS_FT*f/end[2],animated=q.current&&(q.measured||q.animateGuide===true)&&Number.isFinite(q.startedAt)&&q.startedAt>=0&&!reduce;
    const glowId='gc2b'+gid++,glow=node('radialGradient',{id:glowId});glow.append(node('stop',{offset:0,'stop-color':'#fff','stop-opacity':.8}),node('stop',{offset:.3,'stop-color':q.color,'stop-opacity':.35}),node('stop',{offset:1,'stop-color':q.color,'stop-opacity':0}));defs.append(glow);
    // Optional cosmetic light only: the existing projected circle clips this surface; leather tone, rim shade and a soft highlight.
    const surfaceId=glowId+'-surface',surface=node('radialGradient',{id:surfaceId,cx:.34,cy:.30,r:.80,fx:.27,fy:.22,'data-ball-surface':'illustrated-leather-light'});
    surface.append(node('stop',{offset:0,'stop-color':'#ffffff'}),node('stop',{offset:.30,'stop-color':'#f8f6f0'}),node('stop',{offset:.68,'stop-color':'#e3ded3'}),node('stop',{offset:.9,'stop-color':'#b9b3a7'}),node('stop',{offset:1,'stop-color':'#8a857c'}));defs.append(surface);
    const rimId=surfaceId+'-rim',rim=node('radialGradient',{id:rimId,cx:.5,cy:.5,r:.5});rim.append(node('stop',{offset:0,'stop-color':'#0a1420','stop-opacity':0}),node('stop',{offset:.74,'stop-color':'#0a1420','stop-opacity':0}),node('stop',{offset:1,'stop-color':'#0a1420','stop-opacity':.34}));defs.append(rim);
    const specId=surfaceId+'-spec',spec=node('radialGradient',{id:specId,cx:.5,cy:.5,r:.5});spec.append(node('stop',{offset:0,'stop-color':'#fff','stop-opacity':.85}),node('stop',{offset:1,'stop-color':'#fff','stop-opacity':0}));defs.append(spec);
    // Illustrated seams rotate about an axis inferred from measured break, at a display rate scaled from measured rpm.
    // Never an observed spin axis or seam orientation.
    const seamClipId=surfaceId+'-clip',seamClip=node('clipPath',{id:seamClipId});seamClip.append(node('circle',{cx:0,cy:0,r:1}));defs.append(seamClip);
    const seams=node('g',{'clip-path':`url(#${seamClipId})`,'data-ball-surface':'illustrated-rotating-seams','data-spin-basis':'illustrative-from-break',visibility:'hidden'});
    const seamLine=node('path',{fill:'none',stroke:'#a81d2b','stroke-width':.026,'stroke-linecap':'round','stroke-linejoin':'round'}),stitchFront=node('path',{fill:'none',stroke:'#df2f40','stroke-width':.036,'stroke-linecap':'round','stroke-linejoin':'round'}),stitchEdge=node('path',{fill:'none',stroke:'#c42838','stroke-width':.028,'stroke-linecap':'round','stroke-linejoin':'round','stroke-opacity':.55});
    seams.append(seamLine,stitchEdge,stitchFront,node('circle',{cx:0,cy:0,r:1,fill:`url(#${rimId})`}),node('ellipse',{cx:-.36,cy:-.42,rx:.30,ry:.22,fill:`url(#${specId})`,transform:'rotate(-28 -.36 -.42)'}));
    const aura=node('circle',{fill:`url(#${glowId})`,'data-annotation':'motion-glow'}),ball=node('circle',{fill:q.color,'data-world-radius-ft':BALL_RADIUS_FT,'data-projection-scale':f,'data-flight-motion':q.playId});
    const impact=node('circle',{cx:end[0],cy:end[1],fill:'none',stroke:q.color,'stroke-width':2.5*flightStyleUnit,'data-annotation':'impact-ring'});
    const ring=node('circle',{cx:end[0],cy:end[1],fill:'none',stroke:'#fff','data-annotation':'selection-ring'});
    const label=node('text',{x:end[0],y:end[1]+Math.min(14,endRad)*.36,fill:'#06101c','font-size':Math.max(9,Math.min(14,endRad*1.05)).toFixed(0),'font-weight':800,'text-anchor':'middle','data-annotation':'pitch-number'});if(q.n!=null)label.textContent=q.n;
    // V2 cues (presentation only): ground shadow, release glow and a short plate pop.
    const shadow=q.current?node('polygon',{fill:'#02060b',opacity:0,'data-annotation':'ground-shadow','data-shadow-basis':'illustrative-ground-projection'}):null;
    const release=node('circle',{cx:pts[0][0],cy:pts[0][1],fill:`url(#${glowId})`,opacity:0,'data-annotation':'release-glow'}),pop=node('circle',{cx:end[0],cy:end[1],fill:'none',stroke:'#fff',opacity:0,'data-annotation':'impact-pop'});
    if(shadow)g.prepend(shadow);
    g.append(release,aura,ball,seams,impact,pop);if(q.current)g.append(ring);g.append(label);scene.append(g);
    const refEnd=Math.max(1e-6,endRad),spin=ballSpinV2(q),taper=pts.map(p=>.45+.55*Math.min(1,(BALL_RADIUS_FT*f/p[2])/refEnd));
    paints.push(now=>{
     const elapsed=animated?Math.max(0,now-q.startedAt):FLIGHT_MS+IMPACT_MS,flying=elapsed<FLIGHT_MS,fraction=flying?pitchPacingV2(d,elapsed):1,world=pathAt(q.path,fraction),bp=flying?pr(world):end,rad=BALL_RADIUS_FT*f/bp[2];
     if(q.current){svg.dataset.sceneClockMs=String(q.startedAt);svg.dataset.frameElapsedMs=elapsed.toFixed(3);}
     for(let k=1;k<=N;k++){
      const line=lines[k-1],visible=!flying||(k-1)/N<fraction,to=flying&&k/N>fraction?bp:pts[k],tail=flying?Math.max(0,Math.min(1,(Math.min(k/N,fraction)-(fraction-.32))/.32)):0;
      line.setAttribute('visibility',visible?'visible':'hidden');line.setAttribute('x2',to[0].toFixed(4));line.setAttribute('y2',to[1].toFixed(4));
      line.setAttribute('stroke-width',flightStyleUnit*(q.measured?(q.current?3.6*(1+.6*tail)*taper[k]:1.3):1.3));line.setAttribute('opacity',q.measured?(flying?.22+.70*tail:q.current?.16+.72*k/N:.08+.24*k/N):.45);
     }
     for(const n of [ball,aura]){n.setAttribute('cx',bp[0].toFixed(4));n.setAttribute('cy',bp[1].toFixed(4));}
     const closeup=q===microOwner&&!!reviewFrame&&elapsed>=FLIGHT_MS&&gapReviewEffect(elapsed).active&&!microSuppressed.has(microKey)&&!reduce;
     const surfaceOn=q.current&&(flying||closeup);seams.setAttribute('transform',`translate(${bp[0]} ${bp[1]}) scale(${rad})`);seams.setAttribute('visibility',surfaceOn?'visible':'hidden');
     if(surfaceOn){const spun=seamPathsV2(mulV2(rotV2(spin.axis,2*Math.PI*spin.rate*(Math.min(elapsed,FLIGHT_MS)+Math.max(0,elapsed-FLIGHT_MS)*.12)/1000),SEAM_REST_V2));seamLine.setAttribute('d',spun.seam);stitchFront.setAttribute('d',spun.front);stitchEdge.setAttribute('d',spun.edge);}
     ball.setAttribute('r',rad.toFixed(6));ball.setAttribute('fill',flying||closeup?`url(#${surfaceId})`:q.color);ball.setAttribute('fill-opacity',q.current?1:.55);ball.setAttribute('data-camera-depth-ft',bp[2]);ball.setAttribute('data-motion-fraction',fraction.toFixed(6));ball.setAttribute('data-world-center-ft',JSON.stringify(world));
     aura.setAttribute('r',Math.max(rad*4,7*flightStyleUnit));aura.setAttribute('opacity',flying?1:0);
     const t=Math.max(0,Math.min(1,(elapsed-FLIGHT_MS)/IMPACT_MS));impact.setAttribute('r',endRad+(3+20*t)*flightStyleUnit);impact.setAttribute('opacity',animated&&!flying&&!closeup?.85*(1-t):0);
     ring.setAttribute('r',Math.max(0,endRad-Math.min(flightStyleUnit,endRad*.16)/2));ring.setAttribute('stroke-width',Math.min(flightStyleUnit,endRad*.16));ring.setAttribute('visibility',flying||closeup?'hidden':'visible');
     label.setAttribute('visibility',!flying&&!closeup&&q.n!=null&&endRad>=7?'visible':'hidden');
     if(shadow){const h=Math.max(0,world[2]),fade=flying?1:1-t,on=animated&&fade>0&&!closeup;
      if(on){const sr=BALL_RADIUS_FT*(1.25+.1*h),ring2=[];for(let i=0;i<14;i++){const a=i/14*2*Math.PI,p=pr([world[0]+Math.cos(a)*sr,world[1]+Math.sin(a)*sr,0]);ring2.push(p[0].toFixed(2)+','+p[1].toFixed(2));}shadow.setAttribute('points',ring2.join(' '));}
      shadow.setAttribute('opacity',on?((.30*(1-Math.min(1,h/9))+.06)*fade).toFixed(3):0);}
     const rt=elapsed/220;release.setAttribute('r',((5+9*Math.min(1,rt))*flightStyleUnit).toFixed(3));release.setAttribute('opacity',animated&&q.current&&rt<1?(.55*(1-rt)).toFixed(3):0);
     const pt=Math.max(0,Math.min(1,(elapsed-FLIGHT_MS)/180));pop.setAttribute('r',(endRad+(1+10*pt)*flightStyleUnit).toFixed(3));pop.setAttribute('stroke-width',(1.4*flightStyleUnit*(1-pt)+.01).toFixed(3));pop.setAttribute('opacity',animated&&q.current&&!flying&&!closeup&&pt<1?(.9*(1-pt)).toFixed(3):0);
     return animated&&elapsed<FLIGHT_MS+IMPACT_MS;
    });
   }
   function paint(now){paintedAt=Math.max(paintedAt,now);let running=false;for(const draw of paints)running=draw(paintedAt)||running;return paintMicro(paintedAt)||running;}
   function tick(now){frame=0;if(disposed||!svg.isConnected){cancelMicro();return;}if(camera.state().animating){update(...latest,true,now);return;}if(paint(now))frame=requestAnimationFrame(tick);}
   if(paint(at)||camera.state().animating)frame=requestAnimationFrame(tick);
   return svg;
  }
  svg.__updatePitchScene=update;svg.__cancelZoneMicro=cancelMicro;
  svg.__getPitchCameraState=()=>camera.state();
  svg.__setPitchCamera=(name,options={})=>{if(disposed||!cameraKit.presets.includes(name))return camera.state();cancelMicro();camera.set(name,clock(),options?.immediate===true||motionPreference?.matches===true);update(...latest,true);return camera.state();};
  svg.__rotatePitchCamera=(dx,dy,options={})=>{if(disposed||!Number.isFinite(dx)||!Number.isFinite(dy))return camera.state();cancelMicro();camera.rotate(dx,dy,clock(),options?.immediate===true||motionPreference?.matches===true);update(...latest,true);return camera.state();};
  svg.__disposePitchScene=()=>{disposed=true;camera.snap();cancelMicro();motionPreference?.removeEventListener?.('change',motionChanged);if(frame)cancelAnimationFrame(frame);frame=0;};
  return update(list,zone,heat);
 }

 // Contact belongs to one exact released completed result. An old timeline hit
 // never supplies metrics to a new pitch or a pending ball-in-play.
 // Oct 7: released contact (current at-bat's in-play pitch, before its result). Illustrative motion; same scene id as the result.
 function releasedContact(data){
  const c=data?.contact,s=data?.summary;
  if(data?.kind!=='baseball'||s?.completed===true||!c||typeof c!=='object'||Array.isArray(c)||c.completed===true||!c.hit||typeof c.hit!=='object')return null;
  const out={},bounds={launch_speed:[0,150],launch_angle:[-90,90],distance:[0,700],coord_x:[-1000,1000],coord_y:[-1000,1000]};
  for(const [key,[low,high]] of Object.entries(bounds))if(Number.isFinite(c.hit[key])&&c.hit[key]>=low&&c.hit[key]<=high)out[key]=c.hit[key];
  for(const key of ['trajectory','hardness','location'])if(typeof c.hit[key]==='string'&&c.hit[key].length<=60&&!/[<>\x00-\x1f]/.test(c.hit[key]))out[key]=c.hit[key];
  const ab=typeof c.at_bat_id==='string'&&c.at_bat_id?c.at_bat_id:(typeof c.event_id==='string'?c.event_id:'');
  const kinds={ground_ball:'Ground ball',line_drive:'Line drive',fly_ball:'Fly ball',popup:'Pop up'};
  return Object.keys(out).length&&ab?{id:'ab:'+ab,measurements:out,outcome:kinds[c.kind]||'Ball in play',contact:true,illustrativeSector:fieldDirectionSector(data)}:null;
 }
 function releasedHit(data){
  const live=releasedContact(data);if(live)return live;
  const s=data?.summary,id=data?.last_play_event_id;
  if(data?.kind!=='baseball'||s?.completed!==true||s.phase!=='outcome'||!['current_at_bat','previous_at_bat'].includes(s.scope)||typeof id!=='string'||!id)return null;
  const rows=(Array.isArray(data.timeline)?data.timeline:[]).filter(r=>r?.id===id&&(r.result===true||r.phase==='result'||r.phase==='outcome'));
  if(rows.length!==1||!s.hit||typeof s.hit!=='object'||Array.isArray(s.hit)||!rows[0].hit||typeof rows[0].hit!=='object')return null;
  const out={},bounds={launch_speed:[0,150],launch_angle:[-90,90],distance:[0,700],coord_x:[-1000,1000],coord_y:[-1000,1000]};
  for(const [key,[low,high]] of Object.entries(bounds))if(Object.hasOwn(s.hit,key)){
   const value=s.hit[key];if(!Number.isFinite(value)||value<low||value>high||rows[0].hit[key]!==value)return null;out[key]=value;
  }
  for(const key of ['trajectory','hardness','location'])if(Object.hasOwn(s.hit,key)){
   const value=s.hit[key];if(typeof value!=='string'||value.length>60||/[<>\x00-\x1f]/.test(value)||rows[0].hit[key]!==value)return null;out[key]=value;
  }
  const ab=typeof rows[0].at_bat==='string'&&rows[0].at_bat?'ab:'+rows[0].at_bat:id;
  return Object.keys(out).length?{id:ab,measurements:out,outcome:typeof s.outcome==='string'?s.outcome.slice(0,240):'',illustrativeSector:fieldDirectionSector(data)}:null;
 }
 // Canonical scoring facts for the exact completed outcome (server formatter). Counts stay unknown when missing.
 function resultSummary(data){
  const s=data?.summary,r=s?.result_summary;
  if(data?.kind!=='baseball'||s?.completed!==true||!r||typeof r!=='object'||Array.isArray(r))return null;
  const str=v=>typeof v==='string'&&v.length<=240&&!/[<>\x00-\x1f]/.test(v)?v:'';
  const head=str(r.headline);if(!head)return null;
  const desc=str(r.description),outcome=typeof s.outcome==='string'?s.outcome.trim():'';
  if(desc&&desc.trim()!==outcome)return null;
  const n=v=>Number.isInteger(v)&&v>=0&&v<=10?v:null,rbi=n(r.rbi),runs=n(r.runs_scored);
  const last=x=>{const w=String(x).trim().split(/\s+/);return w.length>=3&&/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w[w.length-1])?w[w.length-2]+' '+w[w.length-1]:w[w.length-1];};
  const names=(Array.isArray(r.scorers)?r.scorers:[]).slice(0,4).map(x=>str(x?.name)).filter(Boolean).map(last);
  const scored=names.length?(names.length===1?names[0]:names.slice(0,-1).join(', ')+' and '+names[names.length-1])+' scored':'';
  const [big,...rest]=head.split(' · ');
  return {big:big.trim(),support:rest.join(' · ').trim(),scored,productive:(rbi||0)>0||(runs||0)>0,rbi,runs};
 }
 function hitMetrics(contact){const h=contact?.measurements;return h?[Number.isFinite(h.launch_speed)?h.launch_speed.toFixed(1)+' mph EV':null,Number.isFinite(h.launch_angle)?h.launch_angle.toFixed(1)+'° launch':null,Number.isFinite(h.distance)?Math.round(h.distance)+' ft':null].filter(Boolean):[];}
 const lastName=n=>{const w=String(n||'').trim().split(/\s+/);return w.length>=3&&/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w.at(-1))?w.at(-2):w.at(-1)||'';};
 function join(data,scope=''){
  const plays=(Array.isArray(data?.plays)?data.plays:[]).filter(p=>p&&(p.pitch_number!=null||p.number!=null)),list=[],last=plays.at(-1),seen=new Set();
  for(const p of plays){
   const f=p.flight,id=String(p.id||''),pid=String(p.play_id||f?.play_id||'');
   if(!f||f.schema!==1||f.source!=='MLB_STATSAPI'||!Number.isInteger(f.game_pk)||!pid||pid!==f.play_id||seen.has(pid))continue;
   if(p.play_id&&p.play_id!==f.play_id||id!==pid&&id!==`mlb-${f.game_pk}-p-${pid}`)continue;
   if(Number.isInteger(data?.game_pk)&&data.game_pk!==f.game_pk)continue;
   const bounds=[[-6,6],[40,65],[0,12],[-100,100],[-220,-10],[-100,100],[-200,200],[-200,200],[-200,200]];
   seen.add(pid);const fit=Array.isArray(f.fit)&&f.fit.length===9&&f.fit.every((v,i)=>Number.isFinite(v)&&v>=bounds[i][0]&&v<=bounds[i][1])?f.fit:null;
   const plate=Array.isArray(f.plate)&&f.plate.length===2&&f.plate.every(Number.isFinite)&&f.plate[0]>=-8&&f.plate[0]<=8&&f.plate[1]>=-5&&f.plate[1]<=12?f.plate:null;
   const sourcePath=['measured_fit','plate_guideline'].includes(f.path_kind)&&Array.isArray(f.path)&&f.path.length>=2&&f.path.length<=96&&f.path.every(point=>Array.isArray(point)&&point.length===3&&point.every(Number.isFinite)&&Math.abs(point[0])<=30&&point[1]>=0&&point[1]<=70&&point[2]>=-20&&point[2]<=30)?f.path:null;
   const t0=fit&&!sourcePath?(Number.isFinite(f.ext_ft)&&f.ext_ft>=0&&f.ext_ft<=12?tAtY(fit,60.5-f.ext_ft):0):null,t1=fit&&!sourcePath?tAtY(fit,17/12):null;
   const usable=fit&&!sourcePath&&Number.isFinite(t0)&&Number.isFinite(t1)&&t1>t0&&t1-t0<2;
   const path=sourcePath||(usable?Array.from({length:37},(_,i)=>pos(fit,t0+(t1-t0)*i/36)):plate?[[plate[0],50,plate[1]],[plate[0],17/12,plate[1]]]:null);
   if(!path)continue;
   const measured=sourcePath?f.path_kind==='measured_fit':!!usable,duration=sourcePath?(Number.isFinite(f.path_duration_s)&&f.path_duration_s>0&&f.path_duration_s<2?f.path_duration_s:null):usable?t1-t0:null;
   list.push({...f,zoneMicro:null,id,playId:pid,n:p.pitch_number??p.number,fit,plate,t0,t1,path,measured,duration,pathSource:sourcePath?'server':usable?'legacy-fit':'plate-guide',
              color:callColor({call:p.call||p.text,twoStrikeFoul:twoStrikeFoul(p,data.timeline||plays)}),current:p===last,
              startedAt:animationStart(scope||String(data?.event_id||'')+'|'+String(data?.timeline_epoch||''),pid),pitch:p});
  }
  return {list,row:last||null,geometry:list.find(q=>q.current)||null,plays};
 }
 function diagnosticText(d){const s=d?.sync_diagnostics;if(!s||typeof s!=='object')return '';return [typeof s.mode==='string'?s.mode.slice(0,40):typeof s.status==='string'?s.status.slice(0,40):null,Number.isFinite(s.offset_s)?'offset '+s.offset_s.toFixed(1)+'s':null,Number.isFinite(s.bound_width_s)?'±'+(s.bound_width_s/2).toFixed(1)+'s':null].filter(Boolean).join(' · ');}
 function cells(profile){const c=profile?.cells;if(!Array.isArray(c)||c.length!==9)return null;const min=profile.minimum_color_sample||20;return c.map(x=>{const h=x?.hits;return h&&h.sample>=min?h.success/h.sample:null;});}
 const dateOf=e=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.start));

 // Approved Game Center header (all leagues): big logos, nicknames, records, score or start time.
 function heroOf(dialog){let h=dialog.querySelector('.gc2-hero');if(!h){h=el('section','gc2-hero');const header=dialog.querySelector('.otv-game-header');if(!header)return null;header.after(h);dialog.classList.add('gc2-hero-on');}return h;}
 const nick=t=>t.short||String(t.name||'').split(' ').slice(-1)[0];
 function paintHero(dialog,ev,d){
  const h=heroOf(dialog);if(!h)return;const keep=o=>Object.fromEntries(Object.entries(o||{}).filter(([,v])=>v!=null&&v!==''));const teams=(d?.teams||ev.teams||[]).map(t=>({...((ev.teams||[]).find(m=>m.side===t.side)||{}),...keep(t)}));
  const away=teams.find(t=>t.side==='away')||teams[0]||{},home=teams.find(t=>t.side==='home')||teams[1]||{};
  const start=Date.parse(ev.start),noPitches=!(d?.plays||[]).some(p=>Number.isFinite(p.mph??p.speed)||/ball|strike|foul|in play/i.test(p.call||p.text||''));
  // A tracker model can claim "live" before first pitch; the clock and an empty play list say otherwise.
  const raw=d?.state||ev.state,state=raw==='live'&&noPitches&&Number.isFinite(start)&&Date.now()<start-60000?'scheduled':raw;
  const art=t=>window.OrbitalArtwork.team(ev,t);
  // Records: the page's own team rows carry them even when the tracker model does not.
  const rows=[...dialog.querySelectorAll('.otv-game-header .otv-team-row')];for(const [k,t] of [[0,away],[1,home]])if(!t.record){const r=rows[k]?.querySelector('.otv-team-record')?.textContent?.trim();if(r)t.record=r;}
  const fix=()=>{const top=dialog.querySelector('.otv-game-state'),reported=String(d?.status||ev.status||''),label=/postpon|cancel|suspend|delay/i.test(reported)?reported:'Starts '+(Number.isFinite(start)?new Date(start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'soon');if(top&&state==='scheduled'){const next=ev.league+' · '+label;if(top.textContent!==next)top.textContent=next;top.dataset.state='scheduled';}};fix();
  // The one-page view repaints the top line after this; keep it truthful.
  if(!dialog.__gc2top){dialog.__gc2top=new MutationObserver(()=>dialog.__gc2fix?.());const t=dialog.querySelector('.otv-game-state');if(t)dialog.__gc2top.observe(t,{childList:true,characterData:true,subtree:true});}dialog.__gc2fix=fix;
  const ca=art(away).color,chh=art(home).color;
  h.style.background=`linear-gradient(90deg,${ca?'#'+ca+'cc':'#182a40'} 0%,rgba(9,14,24,.92) 42%,rgba(9,14,24,.92) 58%,${chh?'#'+chh+'cc':'#182a40'} 100%)`;
  const side=(t,cls)=>{const n=el('div','gc2-team '+cls),a=art(t),plate=el('div','gc2-plate');if(window.OrbitalArtwork.url(a.url)){const i=el('img','');i.src=a.url;i.alt='';plate.append(i);}else plate.textContent=a.abbr||t.abbreviation||'';
   n.append(plate,el('strong','gc2-nick',nick(t)));if(/^\d{1,3}(-\d{1,3}){1,2}$/.test(t.record||''))n.append(el('small','gc2-rec',t.record));return n;};
  const mid=el('div','gc2-mid');mid.append(el('small','gc2-league',[ev.league,d?.series?.summary].filter(Boolean).join(' · ').toUpperCase()));
  if(state==='scheduled'){const when=Number.isFinite(start)?new Date(start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';const mins=Math.round((start-Date.now())/60000);
   mid.append(el('strong','gc2-time',when),el('span','gc2-status',mins>0&&mins<180?'in '+mins+' min':ev.status||'Upcoming'));}
  else{const sc=el('strong','gc2-score');sc.append(el('span','',String(away.score??'')),el('i','','–'),el('span','',String(home.score??'')));mid.append(sc);const st=el('span','gc2-status',state==='final'?'Final':(d?.status||ev.status||'Live'));st.dataset.state=state;mid.append(st);}
  h.replaceChildren(side(away,'away'),mid,side(home,'home'));
  if(state==='final')pullFinal(dialog,ev);
  if(state==='scheduled')pullPre(dialog,ev);else if(dialog.classList.contains('gc2-pre-on')){dialog.classList.remove('gc2-pre-on');dialog.querySelector('.gc2-pre')?.remove();}
 }
 // Approved pregame (all leagues): predictor + last 5, leaders (regular season in a series), probable pitchers.
 function paintPre(dialog,ev,pv){
  const host=dialog.querySelector('.otv-gc-pane-live');if(!host||!pv)return;
  let box=dialog.querySelector('.gc2-pre');if(!box){box=el('section','gc2-pre');host.prepend(box);}dialog.classList.add('gc2-pre-on');
  const post=!!pv.series,side=k=>(ev.teams||[]).find(t=>t.side===k)||{},A=side('away'),Hm=side('home'),ab=t=>window.OrbitalTeamArt?.[ev.league+'|'+t.name]?.abbr||t.abbreviation||nick(t);
  const cards=[];
  const m=el('div','gc2-card');m.append(el('h4','','Matchup'));
  if(pv.predictor&&Number.isFinite(pv.predictor.away)){const pct=el('div','gc2-pred');pct.append(el('strong','',Math.round(pv.predictor.away)+'%'),el('small','',ab(A)+' · win chance · '+ab(Hm)),el('strong','',Math.round(pv.predictor.home)+'%'));const bar=el('div','gc2-bar');const fill=el('i','');fill.style.width=pv.predictor.away+'%';bar.append(fill);m.append(pct,bar);}
  for(const r of pv.last_five||[]){const t=side(r.side),row=el('div','gc2-form');row.append(el('span','gc2-ab',ab(t)));for(const g of (r.games||[]).slice(-5)){const c=el('b','',g.result||'');c.dataset.r=g.result||'';c.title=[g.at,g.opponent,g.score].filter(Boolean).join(' ');row.append(c);}m.append(row);}
  cards.push(m);
  const lead=el('div','gc2-card');lead.append(el('h4','',post?'Regular season leaders':'Season leaders'));
  const aRows=(pv.leaders||[]).find(x=>x.side==='away')?.rows||[],hRows=(pv.leaders||[]).find(x=>x.side==='home')?.rows||[];
  const cats=[...new Set([...aRows,...hRows].map(x=>x.category))].slice(0,4);
  const face=(x,left)=>{const n=el('div','gc2-who'+(left?'':' r'));const img=el('img','');if(/^https:\/\/a\.espncdn\.com\//.test(x?.headshot||'')){img.src=x.headshot;img.alt='';}else img.hidden=true;const t=el('div','');const nm=String(x?.name||'–').split(' ');t.append(el('strong','',nm.length>1?nm[0][0]+'. '+nm.slice(1).join(' '):nm[0]),el('b','',x?.value||''));if(left)n.append(img,t);else n.append(t,img);return n;};
  for(const c of cats){const row=el('div','gc2-lrow');row.append(face(aRows.find(x=>x.category===c),true),el('small','',c),face(hRows.find(x=>x.category===c),false));lead.append(row);}
  if(cats.length)cards.push(lead);
  const st=pv.starters||[];if(st.length){const s=el('div','gc2-card');s.append(el('h4','','Probable pitchers'));for(const x of st){const t=side(x.side),row=el('div','gc2-start');const img=el('img','');if(/^https:\/\/a\.espncdn\.com\//.test(x.headshot||'')){img.src=x.headshot;img.alt='';}else img.hidden=true;const d=el('div','');d.append(el('strong','',x.name||''),el('small','',ab(t)+' · '+(x.line&&x.line!=='null'?(post?'Postseason · ':'')+x.line:(post?'Postseason line not posted':'Season line not posted'))));row.append(img,d);s.append(row);}cards.push(s);}
  box.replaceChildren(...cards);
 }
 async function pullPre(dialog,ev){
  if(dialog.__gc2pre&&Date.now()-dialog.__gc2pre<300000)return;dialog.__gc2pre=Date.now();const api=window.ApiClient;
  try{const pv=await api.ajax({type:'GET',url:api.getUrl('sports/api/preview',{event:ev.id,league:ev.league,date:dateOf(ev)}),dataType:'json'});if(dialog.isConnected)paintPre(dialog,ev,pv);}catch{dialog.__gc2pre=Date.now()-240000;}
 }
 // Approved final (all leagues): key stats + win probability, game story, highlights. Recap is ESPN's public data.
 function spark(vals,away,home){const w=320,h=64,n=vals.length,svg=node('svg',{viewBox:`0 0 ${w} ${h}`,class:'gc2-wp',preserveAspectRatio:'none'});if(n<2)return svg;
  svg.append(node('line',{x1:0,y1:h/2,x2:w,y2:h/2,stroke:'rgba(255,255,255,.18)','stroke-dasharray':'4 5'}));
  const d=vals.map((v,i)=>(i?'L':'M')+(i*w/(n-1)).toFixed(1)+' '+((1-v)*h).toFixed(1)).join(' ');
  svg.append(node('path',{d,fill:'none',stroke:'#fff','stroke-width':2.2,'stroke-linejoin':'round'}));return svg;}
 function paintFinal(dialog,ev,rc){
  const host=dialog.querySelector('.otv-gc-pane-live');if(!host||!rc)return;
  let box=dialog.querySelector('.gc2-final');if(!box){box=el('section','gc2-final');host.prepend(box);}dialog.classList.add('gc2-final-on');
  const cards=[],abbr=s=>(rc.teams||[]).find(t=>s==='away'?!t.home:t.home)?.abbr||'';
  const k=el('div','gc2-card');k.append(el('h4','','Final'));
  const stats=(rc.team_stats||[]).slice(0,5);if(stats.length){const t=el('table','gc2-stats');const hr=el('tr','');hr.append(el('th',''));for(const x of stats)hr.append(el('th','',x.label));t.append(hr);
   for(const sd of ['away','home']){const r=el('tr','');r.append(el('td','gc2-sab',abbr(sd)));for(const x of stats)r.append(el('td','',String(x[sd]??'')));t.append(r);}k.append(t);}
  const wp=(rc.win_probability||[]).filter(Number.isFinite);if(wp.length>1){
   const end=Math.round(wp[wp.length-1]*100),head=el('div','gc2-wph');head.append(el('small','gc2-wpl',abbr('home')+' · last reported win chance'),el('strong','gc2-wpv',end+'%'));
   const box=el('div','gc2-wpbox');const axis=el('div','gc2-wpaxis');axis.append(el('span','','100'),el('span','','50'),el('span','','0'));box.append(axis,spark(wp));
   const ends=el('div','gc2-wpends');ends.append(el('span','','First report'),el('span','','Last report'));k.append(head,box,ends);}
  cards.push(k);
  // The score by inning / period belongs at the top of a final, not under the plays.
  const lineScore=()=>{const t=dialog.querySelector('.otv-score-table-wrap:not(.gc2-linescore)');if(!t)return false;if(!k.querySelector('.gc2-linescore')){const c=t.cloneNode(true);c.classList.add('gc2-linescore');k.insertBefore(c,k.children[1]||null);}return true;};
  if(!lineScore()){let tries=0;const iv=setInterval(()=>{if(!dialog.isConnected||lineScore()||++tries>12)clearInterval(iv);},1000);}
  if((rc.story||[]).length){const st=el('div','gc2-card');st.append(el('h4','','Game story'));const ul=el('ul','gc2-story');for(const line of rc.story.slice(0,5))ul.append(el('li','',line));st.append(ul);if(rc.article?.headline)st.append(el('p','gc2-head',rc.article.headline));cards.push(st);}
  const vids=(rc.videos||[]).filter(v=>v.kind==='youtube'&&/^[\w-]{6,20}$/.test(v.id||'')).slice(0,3);
  if(vids.length){const hv=el('div','gc2-card');hv.append(el('h4','','Highlights'));for(const v of vids){const a=el('a','gc2-vid');a.href='https://www.youtube.com/watch?v='+v.id;a.target='_blank';a.rel='noopener';const im=el('img','');im.src='https://i.ytimg.com/vi/'+v.id+'/mqdefault.jpg';im.alt='';const tx=el('div','');tx.append(el('strong','',v.title||'Highlights'),el('small','',[v.channel,v.duration].filter(Boolean).join(' · ')));a.append(im,tx);hv.append(a);}cards.push(hv);}
  box.replaceChildren(...cards);
 }
 async function pullFinal(dialog,ev){
  if(dialog.__gc2fin)return;dialog.__gc2fin=Date.now();const api=window.ApiClient;
  try{const rc=await api.ajax({type:'GET',url:api.getUrl('sports/api/recap',{event:ev.id,league:ev.league}),dataType:'json'});if(dialog.isConnected)paintFinal(dialog,ev,rc);}catch{setTimeout(()=>{dialog.__gc2fin=0;},30000);}
 }

 function attach(dialog,event){
  if(dialog.__gc2)return dialog.__gc2;
  let lastData=null,ended=false;
  const ev=event,card=el('section','gc2-pitch'),left=el('div','gc2-now'),stage=el('div','gc2-stage'),right=el('div','gc2-seq'),cap=el('p','gc2-cap');
  card.hidden=true;card.append(left,stage,right,cap);
  if(ev?.league==='MLB')dialog.classList.add('gc2-on');
  const place=()=>{const v=dialog.querySelector('.ogp-game .ogp-visual');if(v&&card.nextSibling!==v)v.before(card);};
  function paint(d){
   if(ended||!d||d.kind!=='baseball')return;
   const s=d.situation||{},batter=typeof s.batter==='string'?s.batter:s.batter?.name||'',j=join(d,String(ev.id)+'|'+String(d.timeline_epoch||'')),plays=j.plays,p=j.row,g=j.geometry;
   place();card.hidden=false;dialog.classList.add('gc2-on');
   const contact=releasedHit(d),heat=cells(d.batter_history?.profile||d.batter_profile),w=Math.max(220,Math.round(stage.clientWidth||300)),h=Math.round(w*1.1);
   const fieldKey=contact?contact.id+'|field-direction:'+(contact.illustrativeSector||'reported'):null,sameScene=!!contact&&stage.__fieldId===contact.id;
   const field=contact&&stage.__field!==fieldKey?(fieldCanvas(contact.measurements,'#ffb547',w,h,sameScene,contact.illustrativeSector)||fieldSvg(contact.measurements,'#ffb547',w,h,contact.illustrativeSector,sameScene)):(contact&&stage.__field===fieldKey?stage.firstChild:null);
   // Replay the batted-ball path once per released result, not on every refresh.
   if(field){if(stage.__field!==fieldKey){stage.__field=fieldKey;stage.__fieldId=contact.id;stage.replaceChildren(field);}}
   else{stage.__field=null;stage.__fieldId=null;stage.replaceChildren(flightSvg(j.list,{top:g?.zone_top_ft,bottom:g?.zone_bottom_ft},heat,w,h));}
   left.replaceChildren();const mph=p?.mph??p?.speed,call=el('span','gc2-call',contact?(contact.contact?contact.outcome:(resultSummary(d)?.big||contact.outcome)):p?.call||p?.text||'');
   const big=el('div','gc2-big');big.append(el('strong','gc2-mph',Number.isFinite(mph)?Number(mph).toFixed(1):'–'),el('small','gc2-unit','mph'));
   const rs=resultSummary(d);if(rs){call.textContent=rs.big;if(rs.productive)call.dataset.run='1';}
   left.append(big,el('span','gc2-type',p?.pitch_type||p?.type||''),call);
   if(rs&&(rs.support||rs.scored))left.append(el('span','gc2-run',[rs.support,rs.scored].filter(Boolean).join(' · ')));
   left.append(el('span','gc2-count',[s.balls!=null&&s.strikes!=null?s.balls+'–'+s.strikes:null,s.outs!=null?s.outs+(s.outs===1?' out':' outs'):null].filter(Boolean).join(' · ')));
   const metrics=[Number.isFinite(g?.spin_rpm)?Number(g.spin_rpm).toLocaleString()+' rpm':null,Number.isFinite(g?.ivb_in)?Math.round(g.ivb_in)+'″ rise':null,Number.isFinite(g?.hb_in)?Math.abs(Math.round(g.hb_in))+'″ run':null,Number.isFinite(g?.ext_ft)?g.ext_ft.toFixed(1)+' ft ext':null].filter(Boolean);
   metrics.push(...hitMetrics(contact));
   if(metrics.length){const ul=el('ul','gc2-metrics');for(const value of metrics)ul.append(el('li','',value));left.append(ul);}
   const absRow=[...j.list].reverse().find(q=>q.abs);if(absRow)left.append(el('span','gc2-abs',absRow.abs.in_progress?'ABS challenge in progress':'ABS · #'+absRow.n+' '+(absRow.abs.overturned?'overturned':'upheld')));
   right.replaceChildren(el('h4','','This at-bat'));const ol=el('ol','gc2-list');
   for(const q of plays.slice(-6).reverse()){const li=el('li',''),dot=el('span','gc2-dot',String(q.pitch_number??q.number??''));dot.style.background=callColor({call:q.call||q.text,twoStrikeFoul:twoStrikeFoul(q,plays)});const sp=q.mph??q.speed,t=el('div','');t.append(el('strong','',q.call||q.text||''),el('small','',[Number.isFinite(sp)?Number(sp).toFixed(1):null,String(q.pitch_type||q.type||'').replace('Four-Seam Fastball','4-Seam')].filter(Boolean).join(' · ')));li.append(dot,t);ol.append(li);}
   right.append(ol);cap.replaceChildren();const leg=el('span','gc2-legend');for(const [t,c] of [['Ball','#79dd9e'],['Strike','#ff5867'],['Foul','#ffcd57'],['2-strike foul','#c39aff'],['In play','#3d9bff']]){const i=el('i','');i.style.background=c;leg.append(i,el('span','',t));}
   cap.append(leg,el('span','',["Catcher's view",heat?lastName(batter)+"'s hot & cold zones":null,j.list.some(q=>!q.measured)?'Measured plate point · provisional depth guide':j.list.length?'Measured MLB pitch flight':'Pitch geometry pending'].filter(Boolean).join(' · ')));
   const diag=diagnosticText(d);if(diag)cap.append(el('small','gc2-sync',diag));
  }
  dialog.addEventListener('close',()=>{ended=true;},{once:true});
  try{paintHero(dialog,ev,null);}catch{}
  return dialog.__gc2={paint:d=>{lastData=d;try{paintHero(dialog,ev,d);}catch{}if(ev?.league==='MLB')paint(d);}};
 }
 // The one-page Game Center already watches the released tracker data; share that exact stream.
 function wrap(){const T=window.TelevisionTrackers;if(!T||typeof T.watch!=='function'||T.watch.__gc2)return !!T?.watch?.__gc2;
  const w0=T.watch;T.watch=function(event,slot,cb,...rest){const dialog=slot?.closest?.('dialog.otv-sports-dialog');if(!dialog)return w0.call(this,event,slot,cb,...rest);
   const api=window.ApiClient,user=api?.getCurrentUserId?.(),server=api?.serverId?.(),current=()=>dialog.isConnected&&api===window.ApiClient&&user===api?.getCurrentUserId?.()&&server===api?.serverId?.();const g=attach(dialog,event);return w0.call(this,event,slot,(...args)=>{if(!current())return;const r=cb(...args);if(current())try{g.paint(args[0]);}catch{}return r;},...rest);};T.watch.__gc2=true;return true;}
 if(!wrap()){const t=setInterval(()=>{if(wrap())clearInterval(t);},250);setTimeout(()=>clearInterval(t),20000);}


 // 3. In-player card: released geometry always replaces the 2D slot, including pending/summary states.
 function wrapCard(){const B=window.TelevisionBaseballCard;if(!B||typeof B.create!=='function')return false;if(B.create.__gc2)return true;
  const c0=B.create;B.create=function(data,opts){const card=c0.call(this,data,opts),zone=card?.querySelector('.obc-zone');
   if(zone){zone.replaceChildren();zone.classList.add('gc2-zone');card.classList.add('gc2-card');
    const contact=releasedHit(data),j=join(data),g=j.geometry,w=Math.max(150,Math.round(zone.clientWidth||170)),h=Math.round(w*1.1);
    const park=contact?fieldCanvas(contact.measurements,'#ffb547',w,h,fieldPlayed.has(contact.id),contact.illustrativeSector):null;if(park){fieldPlayed.add(contact.id);if(fieldPlayed.size>40)fieldPlayed.delete(fieldPlayed.values().next().value);}
    zone.append(park||flightSvg(j.list,{top:g?.zone_top_ft,bottom:g?.zone_bottom_ft},cells(data?.batter_history?.profile||data?.batter_profile),w,h));
    if(contact&&hitMetrics(contact).length)zone.append(el('small','gc2-guide-label',hitMetrics(contact).join(' · ')));
    if(j.list.some(q=>!q.measured))zone.append(el('small','gc2-guide-label','Measured plate point · provisional depth guide'));
    else if(!j.list.length)zone.append(el('small','gc2-guide-label','Pitch geometry pending'));
    zone.addEventListener('click',e=>{const id=e.target.closest?.('[data-point-id]')?.dataset.pointId;if(id)[...card.querySelectorAll('[data-tracker-play]')].find(n=>n.dataset.trackerPlay===id)?.click();});
    const diag=diagnosticText(data);if(diag)zone.append(el('small','gc2-sync',diag));
   }return card;};B.create.__gc2=true;return true;}
 if(!wrapCard()){const t2=setInterval(()=>{if(wrapCard())clearInterval(t2);},250);setTimeout(()=>clearInterval(t2),20000);}
 window.OrbitalGc2={feed,flightSvg,fieldSvg,fieldCanvas,join,releasedHit,releasedContact,hitMetrics,resultSummary,pitchMotionProgress,zoneMicroGeometry};
})();


/* Isolated schema2 module: client.js */
/* Generic schema 2 transport and admission. The server supplies every render fact. */
/* public build: a private provider module is not included here. */


/* Isolated schema2 module: api-client-transport.js */
/* Caller-bound ApiClient JSON transport. No capture, presentation or source policy. */
/* public build: a private provider module is not included here. */


/* Isolated schema2 module: capture-gate.js */
/* Execute server-supplied resource directives. Pixel changes are not game evidence. */
/* public build: a private provider module is not included here. */


/* Viewer-only black-picture suggestion from the existing owned canvas.
 * No transport, canonical evidence, content verdict, rank write or auto switch.
 */
/* public build: a private provider module is not included here. */

/* Isolated schema2 module: frame-capture.js */
/* One HTML frame to bounded JPEG transport. No picture interpretation or timing map. */
/* public build: a private provider module is not included here. */


/* Isolated schema2 module: player-integration.js */
/* Opt-in player lifecycle/session glue. Presentation and capture directives come from HTTP. */
/* public build: a private provider module is not included here. */


/* FOOTBALL_VALUE_CARD_BEGIN */
(function(root){
'use strict';
const CSS=".ofv .quiet-rail{grid-template-columns:minmax(0,1fr)}.ofv .setup{min-width:0}.ofv .quiet-rail[data-last-play=true] .setup strong{display:block;flex:1;min-width:0;font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ofv .rail-context,.ofv .spotlight-kicker{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"+".ofv{box-sizing:border-box;--muted:#aabcc4;--mint:#8fe2bb;--gold:#dfcf9b;--line:#c5d7e525;container-type:inline-size;position:relative;padding:0!important;min-width:0;max-width:100%;color:#edf3f5;background:#071c24f5!important;border:1px solid #c5d7e53b!important;border-radius:13px!important;overflow:hidden;font:14px/1.4 Inter,Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 8px 25px #0004}\n.ofv *{box-sizing:border-box}.ofv button{font:inherit;color:inherit;cursor:pointer}.ofv button:focus-visible,.ofv summary:focus-visible{outline:2px solid #8fe2bb;outline-offset:3px}.ofv [hidden]{display:none!important}\n.ofv .quiet-rail{padding:13px 14px 12px;display:grid;gap:5px}.ofv .rail-top,.ofv .spotlight-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.ofv .team-label{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.08em;font-weight:650;color:var(--muted);text-transform:uppercase}.ofv .team-dot{width:6px;height:6px;border-radius:50%;background:var(--gold);flex:none}.ofv .rail-button{padding:0;border:0;background:none!important;color:#adc5ce;font-size:11px;line-height:1.4;min-height:0!important}.ofv .rail-button:hover{color:#edf3f5}.ofv .setup{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.ofv .setup strong{font-size:24px;font-weight:750;letter-spacing:-.02em;line-height:1.2;white-space:nowrap}.ofv .setup span{font-size:12px;color:var(--muted);white-space:nowrap}.ofv .rail-context{font-size:11px;color:#c1d1d7;line-height:15px;min-height:15px}.ofv .rail-context .stake{color:var(--gold)}\n.ofv .spotlight{padding:12px 13px 11px;animation:ofv-arrive .24s ease-out}.ofv .spotlight-kicker{font-size:10px;color:var(--muted);font-weight:500}.ofv .actors{display:flex;align-items:center;gap:5px;margin:7px 0 8px;min-height:24px}.ofv .actor{flex:1;min-width:0}.ofv .actor b{font-size:14px;font-weight:650;line-height:1.2;overflow-wrap:normal;word-break:normal;hyphens:none}.ofv .actor-arrow{font-size:18px;color:var(--gold);margin:0 1px;flex:none}.ofv .gain{font-size:19px;font-weight:750;line-height:1;color:var(--mint);white-space:nowrap;margin-left:auto;flex:none}.ofv .gain.negative{color:#ffac9e}.ofv .gain small{font-size:10px;font-weight:550;color:var(--muted);margin-left:2px}.ofv .single-action{font-size:17px;font-weight:700}.ofv .mini-field{display:block;width:100%;height:78px;border-radius:7px;margin:0 0 4px;background:#14352d}.ofv .mini-field text{font-family:Inter,Roboto,Arial,sans-serif}.ofv .schematic-label{display:flex;justify-content:space-between;gap:8px;font-size:9px;line-height:11px;color:#9fb5bd}.ofv .consequence{font-size:13px;line-height:17px;color:var(--gold);font-weight:650;margin:8px 0 0}.ofv .next-footer{display:flex;align-items:baseline;gap:6px;border-top:1px solid var(--line);margin-top:9px;padding-top:7px;font-size:10px;color:var(--muted);white-space:nowrap}.ofv .next-footer b{font-size:12px;font-weight:600;color:#edf3f5}.ofv .spotlight-clock{position:absolute;height:2px;bottom:0;left:0;width:100%;background:#b5d9c9;opacity:.65;transform-origin:left;animation:ofv-settle 7s linear forwards}.ofv .otc-sync-status{display:none}\n.ofv .drive-panel{max-height:var(--ofv-detail-height,400px);overflow:auto;overscroll-behavior:contain;padding:13px 14px;scrollbar-width:thin}.ofv .drive-head{display:flex;justify-content:space-between;gap:10px}.ofv .drive-head b{font-size:15px}.ofv .drive-basis{font-size:10px;color:var(--muted);margin:5px 0 12px}.ofv .drive-stats{display:flex;gap:17px;padding-bottom:10px;border-bottom:1px solid var(--line)}.ofv .drive-stats b{font-size:19px}.ofv .drive-stats small{display:block;font-size:10px;color:var(--muted)}.ofv .drive-list{list-style:none;padding:0;margin:0}.ofv .drive-list li{display:grid;grid-template-columns:42px minmax(0,1fr) 30px;gap:7px;padding:10px 0;border-bottom:1px solid var(--line);align-items:start}.ofv .drive-list li>small{font-size:9px;color:var(--muted);padding-top:2px}.ofv .drive-list summary{font-size:12px;line-height:1.35;cursor:pointer}.ofv .drive-list p{font-size:12px;color:var(--muted);line-height:1.4;margin:8px 0 0}.ofv .drive-list em{font-size:12px;font-style:normal;color:var(--mint);text-align:right}.ofv .field-basis{font-size:10px;color:var(--muted);margin:7px 0}.ofv .path-motion{stroke-dasharray:1;stroke-dashoffset:1;animation:ofv-draw .85s .2s cubic-bezier(.3,.1,.3,1) forwards}.ofv .gain-motion{transform:scaleX(0);transform-origin:left;animation:ofv-reveal .5s .9s ease-out forwards}.ofv .end-pop{transform-box:fill-box;transform-origin:center;animation:ofv-pop .45s 1s both}\n.otv-trk[data-server-presentation=schema2] .otv-trk-col:has(>.otv-trk-stack>.ofv){width:var(--ofv-width,304px)!important;min-width:0}.otv-trk[data-server-presentation=schema2] .otv-trk-stack:has(>.ofv){overflow:visible!important;max-height:none!important}.ofv[data-layout=below]{width:100%!important}.ofv[data-layout=below] .mini-field{height:78px}\n@container(max-width:240px){.ofv .quiet-rail{padding:10px 12px}.ofv .setup strong{font-size:20px}.ofv .setup span{font-size:11px}.ofv .spotlight{padding:9px 11px}.ofv .actors:has(.actor-arrow){display:grid;grid-template-columns:14px minmax(0,1fr) auto;column-gap:6px;row-gap:3px;min-height:27px;margin:5px 0 6px}.ofv .actors .actor:first-child{grid-column:2;grid-row:1}.ofv .actors .actor:nth-of-type(2){grid-column:2;grid-row:2}.ofv .actors .actor-arrow{grid-column:1;grid-row:1 / 3;align-self:center;transform:rotate(90deg);margin:0}.ofv .actors .gain{grid-column:3;grid-row:1 / 3;align-self:start}.ofv .actor b{font-size:13px}.ofv .gain{font-size:18px}.ofv .mini-field{height:70px}.ofv .schematic-label{font-size:8.5px}.ofv .consequence{font-size:12px;line-height:15px;margin-top:6px}.ofv .next-footer{margin-top:7px;padding-top:5px}.ofv .team-label{font-size:9px;letter-spacing:.04em}}\n.ofv[data-reduced-motion=true] *{animation:none!important;transition:none!important}@media(prefers-reduced-motion:reduce){.ofv *{animation:none!important;transition:none!important}}\n@keyframes ofv-draw{to{stroke-dashoffset:0}}@keyframes ofv-reveal{to{transform:scaleX(1)}}@keyframes ofv-settle{to{transform:scaleX(0)}}@keyframes ofv-arrive{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}@keyframes ofv-pop{0%{opacity:0;transform:scale(.3)}60%{opacity:1;transform:scale(1.2)}100%{opacity:1;transform:scale(1)}}\n.ofv .quiet-rail[data-provisional=true] .setup strong,.ofv[data-phase=waiting] .setup strong{font-size:18px;white-space:normal;line-height:1.25}\n.ofv .schematic-label{font-size:9px}.ofv .mini-field[hidden]{display:none!important}\n";
 const SPOTLIGHT_MS=7000;
 class SpotlightLease {
  constructor(){this.identity='';this.revision='';this.until=0;this.scope='';}
  bind(scope,value,now,force=false){
   if(!value||value.status!=='ready'){this.clear();return 'waiting';}
   const identity=String(value.last_event_id||value.play?.id||'');
   const revision=String(value.revision_key||value.play?.revision_key||'');
   const fresh=this.scope===scope&&identity!==this.identity;
   const changed=this.scope===scope&&identity===this.identity&&revision&&revision!==this.revision;
   if(force||fresh)this.until=now+SPOTLIGHT_MS;
   else if(changed)this.until=0; // A correction replaces the old story without replaying obsolete motion.
   else if(this.scope!==scope)this.until=0;
   this.scope=scope;this.identity=identity;this.revision=revision;
   return this.phase(now);
  }
  phase(now){return now<this.until?'spotlight':'quiet';}
  clear(){this.identity='';this.revision='';this.until=0;this.scope='';}
  withdraw(){this.until=0;}
 }
 function diagramPlan(play,row={}){
  const a=play?.animation,finite=v=>typeof v==='number'&&Number.isFinite(v),fraction=v=>finite(v)&&v>=0&&v<=1;
  if(a?.schematic!==true)return null;
  const targetOnly=play.kind==='incomplete',end=targetOnly?a.target_x:a.end_x;
  if(fraction(a.start_x)&&fraction(end))return {space:'possession_fraction',start:a.start_x,end,targetOnly,toGain:finite(row.start_distance)&&row.start_distance>0?row.start_distance/100:null};
  if(targetOnly)return null; // A zero-gain ball spot is never a caught/target endpoint for an incompletion.
  const r=a.relative;
  if(r?.line_of_scrimmage===0&&finite(r.net_gain_yards)&&r.net_gain_yards>=-100&&r.net_gain_yards<=110)return {space:'relative_yards',start:0,end:r.net_gain_yards,targetOnly:false,toGain:finite(r.to_gain_yards)&&r.to_gain_yards>0&&r.to_gain_yards<=100?r.to_gain_yards:null};
  return null;
 }
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),str=(v,n=160)=>typeof v==='string'?v.slice(0,n):'',int=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
 const kinds=new Set(['pass','rush','pass_td','rush_td','incomplete','sack','turnover','touchdown','field_goal','field_goal_missed','safety','penalty','review','punt','kickoff','timeout','break','other']);
 function released(model){
  if(model?.kind!=='football'||!Array.isArray(model.timeline)||model.timeline.length>4096||typeof model.last_play_event_id!=='string')return [];
  const matches=model.timeline.filter(r=>object(r)&&r.id===model.last_play_event_id);if(matches.length!==1)return [];
  const at=model.timeline.indexOf(matches[0]),rows=model.timeline.slice(0,at+1),ids=new Set();
  for(const row of rows){if(!object(row)||typeof row.id!=='string'||!row.id||row.id.length>160||ids.has(row.id))return [];ids.add(row.id);}return rows;
 }
 function admittedValue(model){
  const rows=released(model),v=model?.football_value,last=rows.at(-1);if(!last||!object(v)||v.schema!==1||v.status!=='ready'||v.event_id!==model.event_id||v.last_event_id!==model.last_play_event_id||!object(v.play)||v.play.id!==v.last_event_id)return null;
  const ids=new Set(rows.map(r=>r.id)),p=v.play,d=v.drive,n=v.next;
  const validPlay=p=>object(p)&&ids.has(p.id)&&kinds.has(p.kind)&&typeof p.revision_key==='string'&&p.revision_key.length>0&&p.revision_key.length<=4096&&p.revision_basis==='released_detail_semantic_signature'&&typeof p.no_play==='boolean'&&object(p.actors)&&Object.values(p.actors).every(a=>object(a)&&typeof a.name==='string'&&a.name.length>0&&a.name.length<=65&&a.source==='released_play_text'&&(!('number'in a)||int(a.number,0,99)))&&(!('gain_yards'in p)||typeof p.gain_yards==='number'&&Number.isFinite(p.gain_yards)&&p.gain_yards>=-100&&p.gain_yards<=110)&&(!p.no_play||(!('gain_yards'in p)&&!p.animation))&&(!p.primary_consequence||typeof p.primary_consequence==='string'&&p.primary_consequence.length<=180)&&(!p.animation||object(p.animation)&&p.animation.schematic===true);
  if(!validPlay(p)||!object(d)||!Array.isArray(d.entries)||d.entries.length>40||!d.entries.every(validPlay)||!int(d.plays_seen,0,d.entries.length)||!int(d.first_downs_seen,0,d.plays_seen)||!['partial','complete'].includes(d.completeness)||!object(n)||!Array.isArray(n.stakes)||n.stakes.length>6||!n.stakes.every(s=>typeof s==='string'&&s.length<=180))return null;
  if(('down'in n)&&(!int(n.down,1,4)||n.down!==last.down)||('distance'in n)&&(!int(n.distance,0,100)||n.distance!==last.distance)||('goal_to_go'in n)&&(n.goal_to_go!==true||last.goal_to_go!==true)||('spot'in n)&&(typeof n.spot!=='string'||n.spot.length>30||n.spot!==last.spot))return null;
  if(n.provisional===true&&(n.stakes.length||['down','distance','goal_to_go','spot','team_id'].some(k=>k in n)))return null;
  if((p.review?.status==='pending'||p.penalty?.status==='pending')&&n.provisional!==true)return null;
  if('net_yards_seen'in d&&(!Number.isFinite(d.net_yards_seen)||Math.abs(d.net_yards_seen)>4400))return null;
  if(d.third_down&&(!int(d.third_down.attempts,1,d.plays_seen)||!int(d.third_down.converted,0,d.third_down.attempts)))return null;
  return v;
 }
  function timingCaption(model,envelope){
   const raw=str(envelope?.label||model?.label||model?.display_label||model?.card?.label||model?.unavailable_reason,100).trim(),label=raw==='Approximate · your picture'?'Approximate':raw;
   return [label,(envelope?.source_health??model?.source_health)==='delayed'?'Reports delayed':''].filter(Boolean).join(' · ');
  }
  function quietPlan(value,model,envelope,picture,updated=false){
   const next=value?.next||{},caption=timingCaption(model,envelope),delayed=(envelope?.source_health??model?.source_health)==='delayed',status=updated?[caption,delayed?'':'Updated report'].filter(Boolean).join(' · '):caption;
   if(picture)return{kind:'broadcast',caption,context:delayed?'Reports delayed · details pending':'Play details pending'};
   if(value?.status!=='ready')return{kind:'waiting',caption,context:caption||'Play details pending'};
   if(next.provisional===true)return{kind:'provisional',caption,context:status||'Reported information'};
   const drive=value.drive||{},seen=typeof drive.plays_seen==='number'?drive.plays_seen+' play'+(drive.plays_seen===1?'':'s')+' seen':'';
   const yards=typeof drive.net_yards_seen==='number'?(drive.net_yards_seen>0?'+':'')+drive.net_yards_seen+' yd seen':'';
   const lastPlay=!int(next.down,1,4)&&['','Waiting for next situation'].includes(str(next.label,60).trim()),play=value.play||{},headline=lastPlay?(play.no_play?'No play':str(play.primary_consequence||play.consequence?.[0]||play.headline||play.action||'Next play pending',200)):'';
   const detail=lastPlay?[seen,yards].filter(Boolean).join(' · '):next.primary_stake||next.stakes?.[0]||seen;
   return{kind:lastPlay?'last_play':'setup',headline,caption,context:[status,updated||delayed?'':detail].filter(Boolean).join(' · ')||'Play details pending'};
  }
  function entryLabel(entry){let label=str(entry.headline||entry.action||entry.kind,200);if(entry.kind==='incomplete'&&!/incomplete/i.test(label))label+=' · Incomplete';return label;}
 function entryGain(entry){return entry.kind==='incomplete'?'INC':typeof entry.gain_yards==='number'?gainText(entry.gain_yards):'';}
 const gainText=n=>typeof n==='number'?(n>0?'+':'')+n:'';
 const compactAction=p=>str(p?.action||p?.headline||'Reported play');
 const E=(tag,cls,value)=>{const e=root.document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=String(value);return e;};
 const S=(tag,attrs,value)=>{const e=root.document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs||{}))e.setAttribute(k,String(v));if(value!==undefined)e.textContent=String(value);return e;};
 const setHidden=(element,hidden)=>{if(!element)return;element.hidden=hidden;if(hidden)element.setAttribute('hidden','');else element.removeAttribute('hidden');};
 function contentRect(video,width=root.innerWidth,height=root.innerHeight){
  try{let r=video?.getBoundingClientRect?.();if(!r||![r.left,r.top,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)return null;const api=root.OrbitalVideoGeometry;if(api?.resolveVideoContentRect&&root.getComputedStyle){const style=root.getComputedStyle(video),transforms=[];for(let n=video;n;n=n.parentElement){const s=root.getComputedStyle(n);transforms.push({transform:s.transform||'none',rotate:s.rotate||'none',scale:s.scale||'none',perspective:s.perspective||'none'});}const result=api.resolveVideoContentRect({rect:r,videoWidth:video.videoWidth,videoHeight:video.videoHeight,style,transforms,rectangularClipping:true,clipRects:[{left:0,top:0,width,height}]});if(result.ok)r=result.visibleRect;}return{left:r.left,top:r.top,width:r.width,height:r.height,right:r.left+r.width,bottom:r.top+r.height};}catch{return null;}
 }
 function portraitDecision({width,height,rect}){if(!(width<700&&height>width)||!rect)return{mode:'panel'};const top=rect.bottom+8;return height-top>=110?{mode:'below',top}:{mode:'panel'};}
 function placePortrait(surface,video,{league,width=root.innerWidth,height=root.innerHeight}={}){if(!surface||!['NFL','NCAAF','College football'].includes(league)||!(width<700&&height>width))return;const decision=portraitDecision({width,height,rect:contentRect(video,width,height)});surface.dataset.mode=decision.mode;if(decision.mode==='below')surface.style.setProperty('--below',Math.round(decision.top)+'px');return decision;}
 function mount(container,{legacy={},onClose,onManual,getVideo=()=>root.OrbitalServerPlayerIntegration?.resolveVideo?.(),getViewerState=null,clock=()=>performance.now()}={}){
  if(!container?.replaceChildren)throw TypeError('Football presentation container required');
  if(!root.document.getElementById('orbital-football-value-style')){const style=E('style');style.id='orbital-football-value-style';style.textContent=CSS;root.document.head.append(style);}
  const lease=new SpotlightLease();let model=null,envelope=null,value=null,card=null,disposed=false,details=false,resetNext=false,timer=null,signature='',footerIdentity='',updateUntil=0,withdrawnPicture=null,video=null,offVideo=()=>{};
  const fitObserver=typeof root.ResizeObserver==='function'?new root.ResizeObserver(()=>fit()):null;
  const col=container.closest?.('.otv-trk-col'),priorWidth=col?.style.getPropertyValue('--ofv-width');
  const now=()=>clock(),team=id=>model?.teams?.find(t=>String(t.id)===String(id)),abbr=id=>str(team(id)?.abbreviation||team(id)?.name,16);
  const scope=()=>JSON.stringify([model?.event_id,...['event','channel','session','play_session','scope_sha256','media_epoch','presentation_instance','football_timeline_epoch','football_publisher_instance'].map(k=>envelope?.[k]??'')]);
  const last=()=>released(model).at(-1)||{};
  const down=n=>int(n?.down,1,4)?n.down+(['','st','nd','rd','th'][n.down])+' & '+(n.goal_to_go?'Goal':n.distance===0?'inches':n.distance??'—'):str(n?.label||'Situation pending');
  const viewer=()=>{try{if(getViewerState)return getViewerState();const v=getVideo();return {blocked:!v||v.paused!==false||v.seeking===true||v.readyState<2||root.document.hidden===true};}catch{return{blocked:true};}};
  const picture=()=>{if(viewer().blocked||envelope?.football_picture_receipt?.identity===withdrawnPicture)return null;return legacy.picture?.(model,envelope?.football_picture_receipt,now())||null;};
  function fallback(){const rows=released(model),r=rows.at(-1);if(!r)return{status:'waiting'};const d=legacy.drive?.(rows,r);return{status:'ready',fallback:true,last_event_id:r.id,play:{id:r.id,revision_key:JSON.stringify([r.id,r.text,r.down,r.distance,r.spot]),actors:{}},next:{down:int(r.down,1,4)?r.down:undefined,distance:int(r.distance,0,100)?r.distance:undefined,goal_to_go:r.goal_to_go===true,spot:str(r.spot,30),team_id:r.possession,stakes:[]},drive:{plays_seen:d?.plays||0,first_downs_seen:d?.firsts||0,entries:[]}};}
  function bindVideo(){const next=getVideo();if(next===video)return;offVideo();fitObserver?.disconnect();video=next;if(!video?.addEventListener){offVideo=()=>{};return;}const observed=video,quietEvent=()=>quiet('playback');const names=['pause','waiting','seeking','seeked','loadstart','emptied','playing'];names.forEach(n=>observed.addEventListener(n,quietEvent));observed.addEventListener('loadedmetadata',fit);observed.addEventListener('resize',fit);fitObserver?.observe(observed);fitObserver?.observe(container);offVideo=()=>{names.forEach(n=>observed.removeEventListener?.(n,quietEvent));observed.removeEventListener?.('loadedmetadata',fit);observed.removeEventListener?.('resize',fit);};}
  function quiet(){if(disposed)return;withdrawnPicture=envelope?.football_picture_receipt?.identity||withdrawnPicture;lease.withdraw();resetNext=true;details=false;paint();}
  function button(label,action,aria){const b=E('button','rail-button',label);b.type='button';if(aria)b.setAttribute('aria-label',aria);b.onclick=e=>{e.stopPropagation();if(!disposed)action();};return b;}
  const driveButton=()=>{const b=button(details?'Close ↗':'Drive ↗',()=>{details=!details;signature='';paint();card?.querySelector('button')?.focus?.({preventScroll:true});},details?'Close reported drive details':'Open reported drive details');b.setAttribute('aria-expanded',String(details));return b;};
  function nextFooter(){const next=E('div','next-footer'),pic=picture();next.append(E('span','',pic?'Picture':'Next'),E('b','',pic?down(pic):down(value?.next)),E('span','',pic?'From broadcast':value?.next?.spot?'at '+value.next.spot:''));return next;}
   function rail(){const box=E('div','quiet-rail'),top=E('div','rail-top'),label=E('span','team-label'),p=picture(),r=last(),next=value?.next||{},plan=quietPlan(value,model,envelope,p,now()<updateUntil);box.dataset.provisional=String(next.provisional===true);box.dataset.lastPlay=String(plan.kind==='last_play');label.append(E('i','team-dot'),E('span','',p?'FROM BROADCAST':value?.status!=='ready'?'FOOTBALL TRACKER':next.provisional?'REPORTED UPDATE':plan.kind==='last_play'?'LAST REPORTED PLAY':(abbr(next.team_id||r.possession)?abbr(next.team_id||r.possession)+' · ':'')+'REPORTED SETUP'));top.append(label,driveButton());const setup=E('div','setup'),headline=E('strong','',p?down(p):value?.status==='ready'?plan.kind==='last_play'?plan.headline:down(next):'Waiting for a released play');headline.title=headline.textContent;setup.append(headline,E('span','',p?legacy.clock?.(p)||'':plan.kind==='setup'&&next.spot?'at '+next.spot:''));
    const line=E('div','rail-context',plan.context);line.title=plan.context;box.append(top,setup,line);return box;}
  function story(animate){const p=value.play,box=E('div','spotlight'),head=E('div','spotlight-heading');head.append(E('span','spotlight-kicker',timingCaption(model,envelope)|| (p.review?.status==='pending'?'Play under review':p.penalty?.status==='pending'?'Flag · details pending':'Last play')),driveButton());box.append(head);const actors=p.actors||{},from=actors.passer||actors.runner,to=actors.target,line=E('div','actors');
   if(from&&!p.no_play){const a=E('div','actor');a.append(E('b','',from.name));a.title=from.name;line.append(a);if(to){const b=E('div','actor');b.append(E('b','',to.name));b.title=to.name;line.append(E('span','actor-arrow','→'),b);}}
   else line.append(E('div','single-action',str(p.headline||p.action||'Reported play',100)));
   if(typeof p.gain_yards==='number'&&!p.no_play&&p.kind!=='incomplete'){const gain=E('div','gain'+(p.gain_yards<0?' negative':''),gainText(p.gain_yards));gain.append(E('small','','yd'));line.append(gain);}box.append(line);
   const field=drawField(p,last(),animate);if(field){box.append(field);const key=E('div','schematic-label');key.append(E('span','estimate-basis','SCHEMATIC · EST.'),E('span','field-key','| SNAP   ┆ TO GAIN'));box.append(key);}
   box.append(E('p','consequence',str(p.primary_consequence||p.consequence?.[0]||p.action||'Reported play',180)));
   box.append(nextFooter());const bar=E('div','spotlight-clock');bar.style.animationDuration=Math.max(1,lease.until-now())+'ms';box.append(bar);return box;}
  function drive(){const box=E('div','drive-panel'),head=E('div','drive-head'),actions=E('span');actions.append(driveButton());if(typeof onClose==='function')actions.append(button('Hide',()=>{lease.withdraw();onClose();},'Hide tracker'));head.append(E('b','','Reported drive'),actions);box.append(head,E('p','drive-basis','Released plays seen so far'));
   if(value?.fallback){if(typeof legacy.expanded==='function')box.append(legacy.expanded(model,{expanded:true,reported:true}));return box;}
   const d=value?.drive||{},stats=E('div','drive-stats');for(const[n,label]of [[d.plays_seen,'plays seen'],[d.net_yards_seen,'net yards seen'],[d.first_downs_seen,'first downs']]){if(typeof n!=='number')continue;const s=E('span');s.append(E('b','',n),E('small','',label));stats.append(s);}box.append(stats);
   const list=E('ol','drive-list'),safeRows=released(model);for(const entry of (d.entries||[]).slice(-8)){const row=safeRows.find(r=>r.id===entry.id);if(!row)continue;const li=E('li'),more=E('details');li.dataset.eventId=entry.id;more.append(E('summary','',entryLabel(entry)),E('p','',str(row.text,400).split(/\(\s*Original Play\s*:/i)[0]));li.append(E('small','',legacy.clock?.(row)||''),more,E('em','',entryGain(entry)));list.append(li);}if(typeof d.plays_seen==='number'&&d.plays_seen>list.children.length)box.append(E('p','drive-basis',(d.plays_seen-list.children.length)+' earlier released plays · totals above'));box.append(list,E('p','field-basis','Schematic estimates and reported plays. No player tracking.'));if(typeof onManual==='function'){const adjust=E('div','drive-head');for(const[label,nudge]of [['Earlier',-1],['Later',1]])adjust.append(button(label,()=>{quiet();onManual({nudge_s:nudge});},label+' game information by one second'));box.append(adjust);}return box;}
  function bounds(){return contentRect(getVideo())||{left:0,top:0,width:root.innerWidth||1200,height:root.innerHeight||675,right:root.innerWidth||1200,bottom:root.innerHeight||675};}
  function fit(){if(!card||disposed)return;const r=bounds(),host=card.closest?.('.otv-trk'),below=host?.dataset.mode==='below',hostWidth=host?.getBoundingClientRect?.().width||r.width,width=below?Math.min(420,root.innerWidth-24,r.width,hostWidth):Math.max(220,Math.min(details?340:lease.phase(now())==='spotlight'?280:304,r.width*.255)),height=below?Math.max(120,(root.innerHeight||800)-card.getBoundingClientRect().top-16):Math.max(120,Math.min(details?400:236,r.height*(details ? .7 : .35)));
   col?.style.setProperty('--ofv-width',width+'px');card.style.width=width+'px';card.style.maxHeight=details?'none':height+'px';card.style.setProperty('--ofv-detail-height',height+'px');card.dataset.layout=below?'below':'overlay';
   if(!details&&lease.phase(now())==='spotlight'){
    const field=card.querySelector('.mini-field'),basis=card.querySelector('.schematic-label');
    for(const selector of ['.next-footer','.field-key','.mini-field','.schematic-label'])setHidden(card.querySelector(selector),false);if(field)field.style.height='';
    for(const selector of ['.next-footer','.field-key']){if(card.scrollHeight<=card.clientHeight+1)break;setHidden(card.querySelector(selector),true);}
    if(card.scrollHeight>card.clientHeight+1&&field)field.style.height='70px';
    if(card.scrollHeight>card.clientHeight+1&&field){setHidden(field,true);setHidden(basis,true);}
   }
   const c=card.getBoundingClientRect(),w=Math.max(0,Math.min(c.right,r.right??r.left+r.width)-Math.max(c.left,r.left)),h=Math.max(0,Math.min(c.bottom,r.bottom??r.top+r.height)-Math.max(c.top,r.top));card.dataset.footprint=JSON.stringify({video:{width:r.width,height:r.height},width:c.width,height:c.height,coverage:w*h/(r.width*r.height),overflow:card.scrollHeight>card.clientHeight+1});}
  function arm(){if(timer!==null)clearTimeout(timer);timer=null;const deadlines=[lease.until,updateUntil,envelope?.football_picture_receipt?.deadline].filter(t=>Number.isFinite(t)&&t>now());if(deadlines.length)timer=setTimeout(()=>{timer=null;paint();},Math.max(1,Math.min(...deadlines)-now()+2));}
  function paint(){if(disposed)return;const p=picture(),phase=value?.status==='ready'?lease.phase(now()):'waiting',pictureIdentity=p?envelope.football_picture_receipt.identity:'',nextSignature=JSON.stringify([phase,details,value?.last_event_id,value?.play?.revision_key,lease.until,phase==='spotlight'?'':pictureIdentity,now()<updateUntil,phase==='quiet'?timingCaption(model,envelope):'',details?value?.drive:null]);
   if(!card||nextSignature!==signature){signature=nextSignature;footerIdentity=pictureIdentity;const focused=card?.contains?.(root.document.activeElement)?root.document.activeElement?.getAttribute('aria-label'):null;card=E('section','otc-card otc-glass ofv');card.dataset.phase=phase;card.dataset.releaseId=value?.last_event_id||'';card.dataset.reducedMotion=String(root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true);card.append(details?drive():phase==='spotlight'?story(card.dataset.reducedMotion!=='true'):rail());const status=E('small','otc-sync-status',timingCaption(model,envelope)||'Reported game information');card.append(status);container.replaceChildren(card);if(focused){[...card.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===focused)?.focus?.({preventScroll:true});}}
    if(phase==='spotlight'&&!details){const cue=card.querySelector('.spotlight-kicker'),status=card.querySelector('.otc-sync-status'),caption=timingCaption(model,envelope);if(cue)cue.textContent=caption||(value?.play?.review?.status==='pending'?'Play under review':value?.play?.penalty?.status==='pending'?'Flag · details pending':'Last play');if(status)status.textContent=caption||'Reported game information';}
    if(phase==='spotlight'&&!details&&pictureIdentity!==footerIdentity){card.querySelector('.next-footer')?.replaceWith(nextFooter());footerIdentity=pictureIdentity;}
   arm();if(typeof root.requestAnimationFrame==='function')root.requestAnimationFrame(fit);else fit();}
  function render(next,nextEnvelope){if(disposed)return;model=next;envelope=nextEnvelope;bindVideo();const old=value;value=admittedValue(model);if(!value)value=Object.prototype.hasOwnProperty.call(model||{},'football_value')?{status:'waiting'}:fallback();const blocked=viewer().blocked;if(resetNext||value?.fallback){lease.clear();resetNext=false;}if(old?.play?.id===value?.play?.id&&old?.play?.revision_key!==value?.play?.revision_key)updateUntil=now()+3000;lease.bind(scope(),value,now());if(blocked){lease.withdraw();resetNext=true;}paint();}
  const onVisibility=()=>quiet(),onResize=()=>fit();root.document.addEventListener('visibilitychange',onVisibility);root.addEventListener?.('resize',onResize);
  return Object.freeze({render,quiet,dispose(){if(disposed)return;disposed=true;if(timer!==null)clearTimeout(timer);offVideo();fitObserver?.disconnect();root.document.removeEventListener('visibilitychange',onVisibility);root.removeEventListener?.('resize',onResize);lease.clear();container.replaceChildren();if(col){if(priorWidth)col.style.setProperty('--ofv-width',priorWidth);else col.style.removeProperty('--ofv-width');}card=null;}});
 }

 function drawField(p,row,animate){
  const plan=diagramPlan(p,row);if(!plan)return null;
  const incomplete=plan.targetOnly,start=plan.start,end=plan.end,relative=plan.space==='relative_yards';
  const W=276,H=86,pad=18;
  const lo=relative?Math.min(start,end)-5:Math.max(0,Math.min(start,end)-.10),hi=relative?Math.max(start,end)+10:Math.min(1,Math.max(start,end)+.10),range=Math.max(relative?20:.2,hi-lo);
  const x=n=>pad+(n-lo)/range*(W-2*pad),sx=x(start),ex=x(end);
  const svg=S('svg',{viewBox:`0 0 ${W} ${H}`,class:'mini-field',role:'img','aria-label':'Schematic estimated diagram of reported '+compactAction(p)+', '+(p.gain_yards??'unreported')+' yards. Player positions and route are not observed.'});
  svg.append(S('rect',{width:W,height:H,fill:'#14352d',rx:7}));
  const unit=relative?1:100;
  for(let yard=Math.ceil(lo*unit/5)*5;yard<=hi*unit;yard+=5){const px=x(yard/unit);svg.append(S('line',{x1:px,y1:15,x2:px,y2:76,stroke:'#c1ddce',opacity:yard%10===0?.22:.10}));if(yard%10===0)svg.append(S('text',{x:px,y:11,fill:'#adc7bd','text-anchor':'middle','font-size':8},relative?(yard>0?'+':'')+yard+' yd':yard===50?'50':String(yard<50?yard:100-yard)));}
  svg.append(S('line',{x1:sx,y1:19,x2:sx,y2:76,stroke:'#cce8ff','stroke-width':1.5,opacity:.9}));
  if(plan.toGain!==null){const fx=x(start+plan.toGain);if(fx>10&&fx<W-10)svg.append(S('line',{x1:fx,y1:19,x2:fx,y2:76,stroke:'#dfcf9b','stroke-width':1.5,'stroke-dasharray':'3 3'}));}
  const path=['pass','pass_td','completion','incomplete'].includes(p.kind)?`M ${sx} 59 Q ${(sx+ex)/2} 22 ${ex} 49`:`M ${sx} 59 Q ${(sx+ex)/2} 65 ${ex} 49`;
  const tone=p.gain_yards<0?'#ffac9e':'#8fe2bb';
  if(!incomplete)svg.append(S('line',{x1:Math.min(sx,ex),y1:71,x2:Math.max(sx,ex),y2:71,stroke:tone,'stroke-width':4,'stroke-linecap':'round',class:animate?'gain-motion':''}));
  svg.append(S('path',{d:path,fill:'none',stroke:tone,'stroke-width':2.2,'stroke-linecap':'round',pathLength:1,class:animate?'path-motion':''}));
  svg.append(S('circle',{cx:sx,cy:59,r:3.5,fill:'#dceaf0'}));
  if(incomplete)svg.append(S('path',{d:`M ${ex-4} 45 L ${ex+4} 53 M ${ex+4} 45 L ${ex-4} 53`,fill:'none',stroke:'#c7d7df','stroke-width':1.7,class:animate?'end-pop':''}));
  else svg.append(S('circle',{cx:ex,cy:49,r:5,fill:tone,class:animate?'end-pop':''}));
  if(animate){const ball=S('g',{'data-animation':'schematic-ball',opacity:0});ball.append(S('ellipse',{cx:0,cy:0,rx:4,ry:2.5,fill:'#e5d3a1',stroke:'#0b211b','stroke-width':.6}));ball.append(S('set',{attributeName:'opacity',to:1,begin:'.2s',fill:'freeze'}));ball.append(S('animateMotion',{dur:'.85s',begin:'.2s',path,rotate:'auto',fill:'freeze'}));svg.append(ball);}
  svg.append(S('text',{x:sx,y:83,fill:'#c0d4cc','text-anchor':'middle','font-size':8},'SNAP'));
  svg.append(S('text',{x:ex,y:35,fill:incomplete?'#c7d7df':tone,'text-anchor':'middle','font-size':9,'font-weight':700},incomplete?'TARGET':gainText(p.gain_yards)+(p.gain_yards!=null?' yd':'')));
  return svg;
 }

const api=Object.freeze({mount,admittedValue,released,entryLabel,entryGain,timingCaption,quietPlan,SpotlightLease,diagramPlan,contentRect,portraitDecision,placePortrait});if(typeof module==='object'&&module.exports)module.exports=api;root.OrbitalFootballValueCard=api;
})(typeof window==='object'?window:globalThis);
/* FOOTBALL_VALUE_CARD_END */

/* Isolated schema2 module: approved-renderer.js */
/* Approved player card styles; facts come only from an admitted schema-2 model. */
(function (root) {
 'use strict';
 const text = (v, limit = 240) => typeof v === 'string' ? v.slice(0, limit) : '';
 const finite = (v, low, high) => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
 const integer = (v, low, high) => Number.isInteger(v) && v >= low && v <= high;
 const node = (tag, cls, value) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value !== undefined) n.textContent = String(value);
  return n;
 };
 const svgNode = (tag, attrs) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs || {})) n.setAttribute(key, String(value));
  return n;
 };
 const actor = v => typeof v === 'string' ? text(v, 100) : text(v?.name, 100);
 // Optional same-game metadata supplies artwork only. Released names stay authoritative.
 function retainedActorHeadshot(model,value,metadata,role){
  // A typed actor comes from the same released row as the displayed legacy name.
  // Presence is authoritative: missing or invalid typed data never falls back to a name join.
  if(model?.situation&&Object.prototype.hasOwnProperty.call(model.situation,'actors')){
   const actors=model.situation.actors,person=actors&&typeof actors==='object'&&!Array.isArray(actors)?actors[role]:null;
   if(model.kind!=='baseball'||model.league!=='MLB'||model.stale===true||!['pitcher','batter'].includes(role)||!person||person.source!=='MLB'||typeof person.id!=='string'||!/^[1-9][0-9]{0,8}$/.test(person.id)||typeof value!=='string'||value.length>100||!value||person.name!==value)return null;
   const expected='https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/'+person.id+'/headshot/67/current';
   return person.headshot===expected?expected:null;
  }
  const original=typeof value==='string'?value:value?.name;
  if(typeof original!=='string'||original.length>100)return null;
  const name=actor(value).trim();
  if(!name||name.length>100||model?.kind!=='baseball'||model.league!=='MLB'||model.stale===true||metadata?.league!=='MLB'||metadata.event_id!==model.event_id||!Array.isArray(metadata.participants)||metadata.participants.length>256)return null;
  const matches=metadata.participants.filter(p=>typeof p?.name==='string'&&p.name.trim().toLowerCase()===name.toLowerCase());
  if(matches.length!==1)return null;
  const person=matches[0];
  if(value&&typeof value==='object'&&typeof value.id==='string'&&value.id!==person.id)return null;
  if(typeof person.headshot!=='string'||person.headshot.length>240)return null;
  try{
   const url=new URL(person.headshot);
   if(url.protocol!=='https:'||url.hostname!=='a.espncdn.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/i\/headshots\/mlb\/players\/full\/\d{1,12}\.png$/.test(url.pathname)||url.href!==person.headshot)return null;
   return url.href;
  }catch{return null;}
 }
 function appendRetainedActorPhoto(person,model,value,metadata,role){
  const url=retainedActorHeadshot(model,value,metadata,role);if(!url)return;
  const photo=node('img','obc-photo');photo.alt='';photo.decoding='async';photo.referrerPolicy='no-referrer';
  photo.onerror=()=>photo.remove();photo.src=url;person.append(photo);
 }
 const pitchNumber = p => integer(p?.pitch_number, 1, 1000) ? p.pitch_number : integer(p?.number, 1, 1000) ? p.number : null;
 const pitchSpeed = p => finite(p?.mph, 0, 150) ? p.mph : finite(p?.speed, 0, 150) ? p.speed : null;
 // Presentation taxonomy only: never infer a pitch type from its call, speed or flight.
 const PITCH_CHIP_TYPES = Object.freeze([
  {key:'four-seam',name:'Four-Seam Fastball',lines:['4-Seam','Fastball'],color:'#ef8795',aliases:['Four-Seam Fastball','4-Seam Fastball','Four Seam Fastball','4 Seam Fastball','Four-Seam','4-Seam','FF']},
  {key:'two-seam',name:'Two-Seam Fastball',lines:['2-Seam','Fastball'],color:'#f4aa71',aliases:['Two-Seam Fastball','2-Seam Fastball','Two Seam Fastball','2 Seam Fastball','Two-Seam','2-Seam','FT']},
  {key:'fastball',name:'Fastball',lines:['Fastball'],color:'#edc878',aliases:['Fastball','FA']},
  {key:'cutter',name:'Cutter',lines:['Cutter'],color:'#e9bd72',aliases:['Cutter','Cut Fastball','FC']},
  {key:'sinker',name:'Sinker',lines:['Sinker'],color:'#cda16f',aliases:['Sinker','SI']},
  {key:'slider',name:'Slider',lines:['Slider'],color:'#84b9ef',aliases:['Slider','SL']},
  {key:'sweeper',name:'Sweeper',lines:['Sweeper'],color:'#a09cea',aliases:['Sweeper','ST']},
  {key:'slurve',name:'Slurve',lines:['Slurve'],color:'#b4a4e2',aliases:['Slurve','SV']},
  {key:'curveball',name:'Curveball',lines:['Curveball'],color:'#b391db',aliases:['Curveball','Curve Ball','CU']},
  {key:'knuckle-curve',name:'Knuckle Curve',lines:['Knuckle','Curve'],color:'#d09ed7',aliases:['Knuckle Curve','Knuckle Curveball','Knuckle-Curve','KC']},
  {key:'slow-curve',name:'Slow Curve',lines:['Slow','Curve'],color:'#cca8ed',aliases:['Slow Curve','Slow Curveball','CS']},
  {key:'changeup',name:'Changeup',lines:['Changeup'],color:'#8ed5b1',aliases:['Changeup','Change Up','Change-Up','CH']},
  {key:'splitter',name:'Splitter',lines:['Splitter'],color:'#7fcfda',aliases:['Splitter','Split-Finger Fastball','Split Finger Fastball','FS']},
  {key:'forkball',name:'Forkball',lines:['Forkball'],color:'#8cc5cc',aliases:['Forkball','Fork Ball','FO']},
  {key:'knuckleball',name:'Knuckleball',lines:['Knuckleball'],color:'#c5cc9d',aliases:['Knuckleball','Knuckle Ball','KN']},
  {key:'screwball',name:'Screwball',lines:['Screwball'],color:'#dfb6d3',aliases:['Screwball','Screw Ball','SC']},
  {key:'eephus',name:'Eephus',lines:['Eephus'],color:'#b6c2d4',aliases:['Eephus','EP']},
  {key:'pitchout',name:'Pitchout',lines:['Pitchout'],color:'#b5b9c1',aliases:['Pitchout','Pitch Out','PO']}
 ]);
 const pitchChipKey = value => value.trim().toLowerCase().replace(/[\s\u2010-\u2015-]+/g,' ');
 function pitchChipIdentity(value){
  const reported=typeof value==='string'?value.trim():'',key=pitchChipKey(reported);
  const type=PITCH_CHIP_TYPES.find(t=>t.aliases.some(alias=>pitchChipKey(alias)===key));
  if(!type)return {key:'unknown',lines:reported?['Unknown',reported]:['Unknown'],full:reported?'Unknown pitch type: '+reported:'Pitch type unavailable',color:'#c8d0d8'};
  const full=pitchChipKey(type.name)===key?type.name:type.name+' (reported as '+reported+')';
  return {key:type.key,lines:type.lines,full,color:type.color};
 }
 const serverPath = f => f && ['measured_fit', 'plate_guideline'].includes(f.path_kind)
  && Array.isArray(f.path) && f.path.length >= 2 && f.path.length <= 96
  && f.path.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
   && Math.abs(p[0]) <= 30 && p[1] >= 0 && p[1] <= 70 && p[2] >= -20 && p[2] <= 30);

 function bases(situation) {
  const keys = ['on_first', 'on_second', 'on_third'];
  const known = situation?.bases_known === true && keys.every(key => typeof situation[key] === 'boolean');
  const names = ['first', 'second', 'third'];
  const svg = svgNode('svg', {viewBox: '0 0 48 34', role: 'img', 'aria-label': known ? 'Reported bases' : 'Bases unknown', 'data-bases-known': known});
  const points = ['36,12 43,19 36,26 29,19', '24,0 31,7 24,14 17,7', '12,12 19,19 12,26 5,19'];
  keys.forEach((key, i) => svg.append(svgNode('polygon', {
   points: points[i], fill: known && situation[key] ? '#ffda69' : 'none',
   stroke: '#bfd3df', 'stroke-width': 1.6, 'data-base': names[i],
   'data-occupied': known ? situation[key] : 'unknown'
  })));
  if (!known) {
   const mark = svgNode('text', {x: 24, y: 30, fill: '#edf5fc', 'font-size': 13, 'text-anchor': 'middle'});
   mark.textContent = '?'; svg.append(mark);
  }
  return svg;
 }

 // Field cache belongs to one mounted presentation owner.
 function releasedSubstitution(model) {
  if (typeof model.selected_event_id !== 'string' || !model.selected_event_id || !Array.isArray(model.timeline)) return null;
  const selected = model.timeline.filter(r => r && typeof r === 'object' && !Array.isArray(r) && r.id === model.selected_event_id);
  if (selected.length !== 1 || selected[0].phase !== 'action' || selected[0].action?.kind !== 'substitution') return null;
  const s = selected[0].action.substitution;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const labels = {pinch_hitter: 'Pinch hitter', pinch_runner: 'Pinch runner', defensive: 'Defensive substitution', pitching_change: 'Pitching change'};
  if (typeof s.kind !== 'string' || !Object.hasOwn(labels, s.kind)) return null;
  const incoming = text(s.in, 100).trim(), outgoing = text(s.out, 100).trim();
  const copy = incoming && outgoing ? incoming + ' for ' + outgoing : incoming ? 'Entering · ' + incoming : outgoing ? 'Leaving · ' + outgoing : 'Player information unavailable';
  const base = s.kind === 'pinch_runner' && integer(s.base, 1, 3) ? ['First base', 'Second base', 'Third base'][s.base - 1] : null;
  return {label: labels[s.kind], copy, base};
 }

 // A completed same-update result may extend only this already admitted in-play pitch.
function sameUpdateResultContact(model,pitch,current,hit,formatted,localReview=false) {
 const knownFalse=v=>v===undefined||v===null||v===false,nonblank=v=>typeof v==='string'&&v.trim().length>0;
 const summary=model?.summary,rows=Array.isArray(model?.timeline)?model.timeline:[],plays=Array.isArray(model?.plays)?model.plays:[];
 if(model?.kind!=='baseball'||!nonblank(model.event_id)||localReview||!knownFalse(model.stale)||!knownFalse(model.situation?.review_pending)
  ||summary?.completed!==true||summary.scope!=='current_at_bat'||summary.phase!=='outcome'
  ||!nonblank(summary.outcome)||!nonblank(model.selected_event_id)||model.selected_event_id!==model.last_play_event_id
  ||!pitch||!current||pitch.id!==current.id||!Number.isFinite(pitch.startedAt)||!Number.isFinite(pitch.landsAt)||pitch.startedAt<0||pitch.landsAt<=pitch.startedAt)return null;
 const selected=rows.filter(r=>r?.id===model.selected_event_id),pitches=rows.filter(r=>r?.id===current.id),currentRows=plays.filter(r=>r?.id===current.id);
 const row=selected.length===1?selected[0]:null,prior=pitches.length===1?pitches[0]:null,identity=promotionPitchIdentity(prior);
 if(!row||!prior||!identity||currentRows.length!==1||currentRows[0]!==current||plays.at(-1)!==current||rows.at(-1)!==row
  ||current.pitch!==true||current.in_play!==true||current.result!==false||current.pitch_number!==prior.pitch_number||current.pitch_type!==prior.pitch_type||current.mph!==prior.mph
  ||!nonblank(row.at_bat)||row.at_bat!==prior.at_bat||(current.at_bat!==undefined&&current.at_bat!==prior.at_bat)
  ||row.result!==true||row.pitch!==false||!['result','outcome'].includes(row.phase)||row.revision!=null||prior.revision!=null||current.revision!=null
  ||!knownFalse(row.review_pending)||!knownFalse(prior.review_pending)||!knownFalse(current.review_pending)
  ||rows.indexOf(prior)>=rows.indexOf(row)||rows.filter(r=>r?.result===true&&r.at_bat===row.at_bat).length!==1)return null;
 const canonical=summary.result_summary,official=canonical?.official_type;
 if(!formatted||!nonblank(official)||row.type!==official||row.result_summary?.official_type!==official
  ||row.text!==summary.outcome||canonical.description!==row.text||row.result_summary?.description!==row.text
  ||!hit||hit.contact===true||hit.id!=='ab:'+row.at_bat||hit.illustrativeSector!=null||!summary.hit||!row.hit
  ||!finite(hit.measurements?.coord_x,-1000,1000)||!finite(hit.measurements?.coord_y,-1000,1000)
  ||summary.hit.coord_x!==hit.measurements.coord_x||summary.hit.coord_y!==hit.measurements.coord_y
  ||row.hit.coord_x!==hit.measurements.coord_x||row.hit.coord_y!==hit.measurements.coord_y)return null;
 return {identity:JSON.stringify([model.event_id,current.id,row.at_bat,row.id,identity]),pitchId:current.id,atBat:row.at_bat,resultId:row.id};
}

 // Confirmed result facts select an already drawn endpoint; wording never creates an outcome.
 function confirmedResultTiming(model,pitch,contact,park,formatted,reduce,localReview=false) {
  const pitchEnd=!reduce&&Number.isFinite(pitch?.landsAt)?pitch.landsAt:0;
  const fallback=reason=>({revealAt:pitchEnd,basis:'static-fallback',reason,supported:false});
  const summary=model.summary,rows=Array.isArray(model.timeline)?model.timeline:[];
  const selected=rows.filter(r=>r&&r.id===model.last_play_event_id);
  if(summary?.completed!==true||summary.scope!=='current_at_bat'||summary.phase!=='outcome'
   ||selected.length!==1||model.selected_event_id!==model.last_play_event_id)return fallback('unowned-result');
  const row=selected[0],canonical=summary.result_summary,official=typeof canonical?.official_type==='string'?canonical.official_type:'';
  if(!formatted||row.result!==true||!['result','outcome'].includes(row.phase)||!official
   ||row.type!==official||row.result_summary?.official_type!==official
   ||canonical.description!==row.text||summary.outcome!==row.text)return fallback('unconfirmed-type');
  if(model.situation?.review_pending===true||row.review_pending===true)return fallback('review-pending');
  if(['Strikeout','Walk','Intent Walk','Hit By Pitch'].includes(official))
   return {revealAt:pitchEnd,basis:'pitch-end',reason:pitch?'drawn-pitch-end':'no-live-pitch-static',supported:!!pitch};
  const endpoints=park?.node?.__fieldEndpoints;
  if(reduce||!pitch||!contact?.directional||contact.pitchId!==pitch.id||park?.id!=='ab:'+row.at_bat
   ||!endpoints?.animated||endpoints.basis!=='illustrative-canvas'||endpoints.sector)
   return fallback('no-owned-airborne-endpoint');
  const landing=!endpoints.ground&&['Flyout','Pop Out','Popout','Lineout'].includes(official),homeRun=official==='Home Run'&&!endpoints.ground;
  const groundLanding=official==='Groundout'&&endpoints.ground===true;
  const endpoint=landing||groundLanding?endpoints.landingAt:homeRun?endpoints.fenceCrossAt:null;
  if(!Number.isFinite(endpoint)){
   // Hold only this already running reported ball, never an inferred runner/throw/out deadline.
   const knownFalse=v=>v===undefined||v===null||v===false;
   const pitches=rows.filter(r=>r&&r.id===pitch.id),prior=pitches.length===1?pitches[0]:null;
   const current=Array.isArray(model.plays)?model.plays.at(-1):null,hit=summary.hit;
   if(localReview||model.kind!=='baseball'||!knownFalse(model.stale)||!knownFalse(model.situation?.review_pending)
    ||!knownFalse(row.review_pending)||row.revision!=null||!prior||prior.pitch!==true||prior.result!==false
    ||prior.phase!=='pitch'||prior.at_bat!==row.at_bat||prior.revision!=null||!knownFalse(prior.review_pending)
    ||!current||current.id!==pitch.id||current.pitch!==true||current.in_play!==true||current.result!==false
    ||rows.filter(r=>r&&r.result===true&&r.at_bat===row.at_bat&&r.text===row.text).length!==1
    ||row.result_summary?.description!==row.text||!hit||!row.hit
    ||!Number.isFinite(hit.coord_x)||hit.coord_x<0||hit.coord_x>260||!Number.isFinite(hit.coord_y)||hit.coord_y< -20||hit.coord_y>260
    ||row.hit.coord_x!==hit.coord_x||row.hit.coord_y!==hit.coord_y
    ||endpoints.schema!==1||!Number.isFinite(endpoints.startedAt)||park.startedAt!==endpoints.startedAt
    ||!Number.isFinite(endpoints.landingAt)||endpoints.landingAt<endpoints.startedAt)return fallback('no-owned-reported-ball-landing');
   return {revealAt:Math.max(pitchEnd,endpoints.landingAt),basis:'animated-reported-ball-landing',reason:'confirmed-ball-only-'+official,supported:true};
  }
  return {revealAt:Math.max(pitchEnd,endpoint),basis:groundLanding?'animated-ground-landing-no-throw':landing?'animated-landing':'animated-fence-crossing',
   reason:'confirmed-'+official,supported:true};
 }

 // Promotion can use only a previously admitted neutral same-pitch contact.
 function promotionPitchIdentity(row) {
  if(!row||row.phase!=='pitch'||row.pitch!==true||row.in_play!==true||row.result!==false||typeof row.id!=='string'||!row.id
   ||typeof row.at_bat!=='string'||!row.at_bat||!integer(row.pitch_number,1,1000)
   ||typeof row.pitch_type!=='string'||!row.pitch_type||!finite(row.mph,0,150)||row.revision)return null;
  return JSON.stringify([row.id,row.at_bat,row.pitch_number,row.pitch_type,row.mph,true,true,false]);
 }
 function neutralContactAdmission(model,pitchId,now,modelOrder) {
  if(model.kind!=='baseball'||model.summary?.completed!==false||model.summary?.phase!=='contact'||model.summary?.scope!=='current_at_bat'
   ||model.selected_event_id!==pitchId||model.last_play_event_id!==pitchId||!Array.isArray(model.timeline)
   ||model.situation?.review_pending===true)return null;
  const rows=model.timeline.filter(r=>r&&r.id===pitchId),row=rows.length===1?rows[0]:null;
  const currentRows=Array.isArray(model.plays)?model.plays.filter(r=>r&&r.id===pitchId):[],current=currentRows.length===1?currentRows[0]:null;
  const identity=promotionPitchIdentity(row),contact=model.contact;
  if(!identity||model.timeline.at(-1)!==row||!contact||contact.event_id!==pitchId||contact.at_bat_id!==row.at_bat
   ||!current||model.plays.at(-1)!==current||current.pitch!==true||current.in_play!==true||current.result!==false||current.pitch_number!==row.pitch_number
   ||current.pitch_type!==row.pitch_type||current.mph!==row.mph
   ||contact.completed!==false||contact.hit&&Number.isFinite(contact.hit.coord_x)&&Number.isFinite(contact.hit.coord_y))return null;
  return {validated:true,eventId:model.event_id,pitchId,atBat:row.at_bat,identity,admittedAt:now,modelOrder};
 }
 function releasedLaterGeometry(model,pitchId,hit,formatted,now,modelOrder) {
  if(model.kind!=='baseball'||model.summary?.completed!==true||model.summary?.scope!=='current_at_bat'
   ||model.summary?.phase!=='outcome'||model.selected_event_id!==model.last_play_event_id
   ||!Array.isArray(model.timeline)||!formatted||model.situation?.review_pending===true)return null;
  const all=model.timeline,results=all.filter(r=>r&&r.id===model.selected_event_id),pitches=all.filter(r=>r&&r.id===pitchId);
  const row=results.length===1?results[0]:null,prior=pitches.length===1?pitches[0]:null;
  const terminalRows=all.filter(r=>r&&r.at_bat===prior?.at_bat&&r.result===true&&['result','outcome'].includes(r.phase));
  const currentRows=Array.isArray(model.plays)?model.plays.filter(r=>r&&r.id===pitchId):[],current=currentRows.length===1?currentRows[0]:null;
  const identity=promotionPitchIdentity(prior),canonical=model.summary.result_summary;
  if(!row||!identity||terminalRows.length!==1||all.at(-1)!==row||all.indexOf(prior)>=all.indexOf(row)||row.result!==true||row.pitch!==false
   ||!current||model.plays.at(-1)!==current||current.pitch!==true||current.in_play!==true||current.result!==false||current.pitch_number!==prior.pitch_number
   ||current.pitch_type!==prior.pitch_type||current.mph!==prior.mph
   ||!['result','outcome'].includes(row.phase)||row.at_bat!==prior.at_bat||row.review_pending===true||row.revision
   ||!canonical||typeof canonical.official_type!=='string'||!canonical.official_type||row.type!==canonical.official_type
   ||row.result_summary?.official_type!==canonical.official_type||row.result_summary?.description!==row.text
   ||canonical.description!==row.text||model.summary.outcome!==row.text
   ||!hit||hit.contact===true||hit.id!=='ab:'+row.at_bat||!row.hit||!model.summary.hit
   ||!finite(hit.measurements?.coord_x,-1000,1000)||!finite(hit.measurements?.coord_y,-1000,1000)
   ||row.hit.coord_x!==hit.measurements.coord_x||row.hit.coord_y!==hit.measurements.coord_y
   ||model.summary.hit.coord_x!==hit.measurements.coord_x||model.summary.hit.coord_y!==hit.measurements.coord_y)return null;
  return {validated:true,eventId:model.event_id,pitchId,atBat:row.at_bat,identity,resultId:row.id,hitId:hit.id,
   x:hit.measurements.coord_x,y:hit.measurements.coord_y,observedAt:now,modelOrder};
 }
 function canPromoteLaterGeometry(neutral,terminal,live) {
  if(!neutral||!terminal||!live)return false;
  if(neutral.validated!==true||terminal.validated!==true||live.resultRevealed!==false||live.priorPark!==false||live.alreadyPlayed!==false||live.localReview!==false)return false;
  if(!Number.isFinite(neutral.admittedAt)||!Number.isFinite(terminal.observedAt)||!Number.isFinite(live.now)
   ||!Number.isFinite(live.pitchEndsAt)||neutral.admittedAt < 0||terminal.observedAt < 0||live.pitchEndsAt < 0
   ||neutral.admittedAt>=terminal.observedAt||terminal.observedAt!==live.now)return false;
  if(!Number.isInteger(neutral.modelOrder)||!Number.isInteger(terminal.modelOrder)||neutral.modelOrder < 1||terminal.modelOrder < 1||neutral.modelOrder>=terminal.modelOrder)return false;
  if(typeof neutral.eventId!=='string'||!neutral.eventId||typeof neutral.pitchId!=='string'||!neutral.pitchId
   ||typeof neutral.atBat!=='string'||!neutral.atBat||typeof neutral.identity!=='string'||!neutral.identity)return false;
  if(neutral.eventId!==terminal.eventId||neutral.eventId!==live.eventId||neutral.pitchId!==terminal.pitchId||neutral.pitchId!==live.pitchId
   ||neutral.atBat!==terminal.atBat||neutral.atBat!==live.atBat||neutral.identity!==terminal.identity)return false;
  if(terminal.hitId!=='ab:'+neutral.atBat||typeof terminal.resultId!=='string'||!terminal.resultId
   ||!Number.isFinite(terminal.x)||!Number.isFinite(terminal.y)||terminal.x < -1000||terminal.x > 1000||terminal.y < -1000||terminal.y > 1000)return false;
  return true;
 }

 // Oct 15 (r3): picture-safe context. Attack zones follow Statcast's published bands; measured location only.
 function attackZoneV3(p){const g=p?.physical;if(!g||![g.x_ft,g.z_ft,g.top_ft,g.bottom_ft].every(Number.isFinite)||g.top_ft<=g.bottom_ft)return null;
  const hz=(g.top_ft-g.bottom_ft)/2+0.121,cz=(g.top_ft+g.bottom_ft)/2,r=Math.max(Math.abs(g.x_ft)/0.83,Math.abs(g.z_ft-cz)/hz);
  return r<0.67?'heart':r<=1.33?'edge':r<=2?'chase':'waste';}
 function callKindV3(p){const t=String(p?.type||p?.text||'').toLowerCase();
  if(p?.in_play===true||/in play/.test(t))return 'contact';if(/foul/.test(t))return 'foul';if(/swinging|missed bunt/.test(t))return 'whiff';
  if(/called/.test(t))return 'called';if(/\bball\b|pitchout/.test(t))return 'ball';return null;}
 const INSIGHT_V3={heart:{called:'Heart · taken',whiff:'Heart · blew it by him',foul:'Heart · fouled off',contact:'Heart · put in play'},
  edge:{called:'Edge · painted',ball:'Edge · just missed',whiff:'Edge · got him',foul:'Edge · spoiled',contact:'Edge · put in play'},
  chase:{called:'Chase · generous call',ball:'Chase · laid off',whiff:'Chase · got him chasing',foul:'Chase · fouled off',contact:'Chase · chased it'},
  waste:{ball:'Waste',whiff:'Waste · chased it',foul:'Waste · fouled off',contact:'Waste · reached for it'}};
 const INSIGHT_TONE_V3={heart:'#ff7a6b',edge:'#ffc857',chase:'#b49cff',waste:'#8fa3b4'};
 function pitchInsightV3(p){const z=attackZoneV3(p),c=callKindV3(p),label=z&&c?INSIGHT_V3[z][c]:null;return label?{zone:z,label}:null;}
 function speedChangeV3(rows,current){const i=rows.indexOf(current),now=pitchSpeed(current);if(i<1||now===null)return null;
  const prev=rows[i-1],then=pitchSpeed(prev),a=text(current.pitch_type,60),b=text(prev?.pitch_type,60);
  if(then===null||!a||!b||a===b)return null;const d=now-then;if(Math.abs(d)<4)return null;
  return (d>0?'+':'−')+Math.abs(d).toFixed(1)+' mph off the '+b.toLowerCase().replace(/^four-seam /,'').replace(/^4-seam /,'');}
 const lerpV3=(x,pts)=>{for(let i=1;i<pts.length;i++)if(x<=pts[i][0]){const [a,b]=[pts[i-1],pts[i]];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);}return pts.at(-1)[1];};
 function contactVerdictV3(p){const h=p?.hit,ev=h?.launch_speed,la=h?.launch_angle;if(!Number.isFinite(ev)||!Number.isFinite(la))return null;
  const barrel=ev>=98&&la>=lerpV3(Math.min(ev,116),[[98,26],[116,8]])&&la<=lerpV3(Math.min(ev,116),[[98,30],[99,31],[100,33],[116,50]]);
  const words=[barrel?'Barrel':ev>=95?'Hard-hit':null,!barrel&&la>=8&&la<=32?'Sweet spot':null].filter(Boolean);
  return words.length?words.join(' · ')+' · '+ev.toFixed(1)+' mph':null;}
 function boxSnapshotV3(model,state){const ring=Array.isArray(state.boxes)?state.boxes:[],tl=Array.isArray(model.timeline)?model.timeline:[];
  const last=tl.at(-1),start=last&&typeof last.at_bat==='string'?tl.findLast(r=>r?.phase==='at_bat_start'&&r.at_bat===last.at_bat):null;
  if(!start||!Number.isFinite(start.at))return null;
  const snap=ring.filter(b=>b.fetched_at<start.at).at(-1);return snap&&start.at-snap.fetched_at<=300?snap:null;}
 function boxAthleteV3(box,name,key){const norm=v=>String(v||'').normalize('NFD').replace(/\p{M}+/gu,'').toLowerCase().replace(/[^a-z ]/g,'').trim(),want=norm(name);
  if(!want)return null;for(const t of Array.isArray(box?.players)?box.players:[])for(const g of Array.isArray(t?.groups)?t.groups:[]){
   if(g?.key!==key||!Array.isArray(g.labels))continue;const a=(g.athletes||[]).find(x=>norm(x?.name)===want);
   if(a&&Array.isArray(a.stats)){const v={};g.labels.forEach((l,i)=>{v[l]=a.stats[i];});return v;}}return null;}
 // Pitcher count = pitches this card presented. Exact when the outing started on screen; otherwise from a settled
 // baseline (snapshot >= 90 s into the other team's half, while this pitcher cannot be throwing) plus every pitch
 // presented after that half. ESPN's box score alone lags too much for a live count.
 function tonightLineV3(model,state,value,role,current){const box=boxSnapshotV3(model,state),name=actor(value);if(!name)return null;
  const num=x=>{const n=Number.parseFloat(x);return Number.isFinite(n)?n:null;};
  if(role==='pitcher'){const L=state.pitchLedger||(state.pitchLedger={event:'',abs:{},abHalf:{},halves:[],clean:{},first:{},base:{},owner:{},offset:{}});
   if(L.event!==String(model.event_id))Object.assign(L,{event:String(model.event_id),abs:{},abHalf:{},halves:[],clean:{},first:{},base:{},owner:{},offset:{}});
   const pcOf=b=>{const v=b?boxAthleteV3(b,name,'pitching'):null;return v?num(v.PC??String(v['PC-ST']||'').split('-')[0]):null;};
   const row=(model.timeline||[]).at(-1),ab=current?(model.timeline||[]).findLast(r=>r?.id===current.id)?.at_bat:null,half=row?(row.period??'')+'-'+(row.half??''):'',at=row?.at;
   if(half&&Number.isFinite(at)){let h=L.halves.find(x=>x.key===half);if(!h)L.halves.push(h={key:half,lo:at,hi:at});h.lo=Math.min(h.lo,at);h.hi=Math.max(h.hi,at);}
   const key=String(name).normalize('NFD').replace(/\p{M}+/gu,'').toLowerCase().replace(/[^a-z ]/g,'').trim();let count=null;const thrown=m=>Object.entries(m).reduce((a,[k,v])=>a+Math.max(0,v-(L.offset[key+'|'+k]||0)),0);
   if(key&&typeof ab==='string'&&ab){if(!(ab in L.abHalf))L.abHalf[ab]=half;const first=L.first[key]??(L.first[key]=ab);
    if(!(key in L.clean)){if(ab!==first)L.clean[key]=false;else if(box)L.clean[key]=!pcOf(box);}
    const m=L.abs[key]||(L.abs[key]={}),abMax=(model.timeline||[]).filter(r=>r?.pitch===true&&r?.result!==true&&r?.at_bat===ab).map(r=>Number(r.pitch_number)).filter(Number.isFinite).reduce((a,b)=>Math.max(a,b),0),n=Math.max((current?pitchNumber(current):0)||0,abMax)||null;
    if(n){const o=L.owner[ab];if(o&&o.who!==key&&!((key+'|'+ab) in L.offset))L.offset[key+'|'+ab]=o.last;L.owner[ab]={who:key,last:Math.max(n,o&&o.who===key?o.last:0)};m[ab]=Math.max(m[ab]||0,n);}
    // Only reconcile known, still-owned at-bats from this already released model.
    for(const r of model.timeline||[]){const prior=r?.at_bat,n=r?.pitch_number;
     if(r?.pitch===true&&r?.result!==true&&Object.hasOwn(m,prior)&&L.owner[prior]?.who===key&&Number.isInteger(n)&&n>=1&&n<=1000){
      m[prior]=Math.max(m[prior],n);L.owner[prior].last=Math.max(L.owner[prior].last,n);}}
    if(L.clean[key]===true)count=thrown(m);
    else{const order=L.halves.map(x=>x.key),cur=order.indexOf(half);
     if(!(key in L.base)&&cur>0){const w=L.halves[cur-1];if(w.hi-w.lo>=90){const snap=(state.boxes||[]).filter(b=>b.fetched_at>=w.lo+90&&b.fetched_at<=w.hi).at(-1),pc=snap?pcOf(snap):null;if(pc!==null)L.base[key]={half:w.key,pc};}}
     const bs=L.base[key];if(bs){const after=order.indexOf(bs.half);count=bs.pc+thrown(Object.fromEntries(Object.entries(m).filter(([k])=>order.indexOf(L.abHalf[k])>after)));}}}
   const k=box?num(boxAthleteV3(box,name,'pitching')?.K):null;
   const parts=[count!==null?(count===1?'1 pitch':count+' pitches'):null,k?k+' K':null].filter(Boolean);return parts.length?parts.join(' · '):null;}
  if(!box)return null;const v=boxAthleteV3(box,name,'batting');if(!v)return null;const [h,ab]=String(v['H-AB']||'').split('-').map(num);if(h===null||ab===null)return null;
  const hr=num(v.HR),rbi=num(v.RBI),bb=num(v.BB);
  const head=ab===0&&!bb?'1st PA tonight':h+'-for-'+ab+' tonight';
  return [head,hr?(hr>1?hr+' HR':'HR'):null,rbi?rbi+' RBI':null,bb?(bb>1?bb+' BB':'BB'):null].filter(Boolean).join(' · ');}

 function baseball(model, motion, state, presentation={}) {
  const cardPlayed=state.played,cardPark=state.park,now=performance.now(),modelOrder=++state.modelOrder;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  state.wakeAt=null;
  const card = node('section', 'otv-baseball-card otc-glass obc-compact obc-stage-layout');
  const header = node('div', 'obc-header');
  header.append(node('strong', '', 'Pitch tracker')); card.append(header);
  const s = model.situation || {}, substitution = releasedSubstitution(model);
  const people = node('div', 'obc-players'), peopleRoles = [];
  for (const [value, label, role] of [[s.pitcher, 'Pitching', 'pitcher'], [s.batter, 'At bat', 'batter']]) {
   const person = node('div', 'obc-person'), copy = node('div', 'obc-person-copy');
   copy.append(node('strong', '', actor(value) || '—'), node('span', '', label));
   people.append(person);peopleRoles.push([copy,value,role]);
   appendRetainedActorPhoto(person,model,value,state.actorMetadata,role);person.append(copy);
  }
  card.append(people);
  const sourceRows = Array.isArray(model.plays) ? model.plays : [];
  const rows = sourceRows.filter(p => p && typeof p === 'object' && !Array.isArray(p) && pitchNumber(p) !== null).slice(-3);
  const latest = sourceRows.at(-1), current = !substitution && rows.includes(latest) ? latest : null;
  card.dataset.hasRecent = rows.length ? 'true' : 'false';
  card.dataset.hasCurrent = current ? 'true' : 'false';
  card.dataset.substitution = substitution ? 'true' : 'false';
  for (const [copy,value,role] of peopleRoles) { let line=null; try { line=tonightLineV3(model,state,value,role,current); } catch { line=null; } if (line) { const t=node('span','obc-today',line); t.style.color='#dbe7f1'; copy.append(t); } }
  const main = node('div', 'obc-main'), zone = node('div', 'obc-zone');
  const gc = root.OrbitalGc2;
  if (gc && typeof gc.join === 'function' && typeof gc.flightSvg === 'function') {
   // Keep rows without a path: removing a new row would promote an older pitch.
   const safe = rows.map(p => ({...p, pitch_number: pitchNumber(p), flight: serverPath(p.flight) ? {...p.flight, fit: null, plate: null} : null}));
   const joined = gc.join({...model, plays: safe});
   const joinedList = joined.list.filter(q => q.pathSource === 'server').map(q => ({...q, current: !!current && q.pitch === safe.at(-1)}));
   const active=joinedList.find(q=>q.current);
   if(state.pitch&&state.pitch.id!==active?.id){state.pitch=null;state.contact=null;state.resultRevealed=null;state.resultRevealedPitch=null;}
   if(motion&&!motion.initialized){
    motion.pitchId=active&&active.id===motion.id&&(active.measured||active.path_kind==='plate_guideline')?active.id:'';
    if(motion.pitchId)state.pitch={id:motion.pitchId,startedAt:motion.startedAt,landsAt:motion.startedAt+1120,situation:{...s}};
   }
   // ZONE_MICRO_OWNER_BEGIN
   const activeGeometry=joinedList.find(q=>q.current),microFacts=activeGeometry?JSON.stringify([current?.flight,activeGeometry.path]):'';
   if(state.zoneMicro?.id!==activeGeometry?.id)state.zoneMicro=null;
   if(activeGeometry&&state.pitch?.id===activeGeometry.id){
    if(!state.zoneMicro)state.zoneMicro={id:activeGeometry.id,facts:microFacts,inPlay:current?.in_play===true,cancelled:false};
    const policy=state.zoneMicro;
    if(policy.facts!==microFacts||policy.inPlay!==(current?.in_play===true)||presentation.review||model.situation?.review_pending===true||current?.review_pending===true||current?.result===true||model.summary?.completed===true||model.stale===true)policy.cancelled=true;
   }
   // ZONE_MICRO_OWNER_END
   // The exact released pitch keeps its clock when the same row gains contact data or its result arrives.
   const list=joinedList.map(q=>({...q,animateGuide:state.pitch?.id===q.id&&!q.measured,startedAt:state.pitch?.id===q.id?state.pitch.startedAt:-86400000,zoneMicro:{enabled:q.current&&state.pitch?.id===q.id&&!!state.zoneMicro&&!state.zoneMicro.cancelled,inPlay:state.zoneMicro?.inPlay===true,color:'#ff637b',geometry:q.current?gc.zoneMicroGeometry(q,current,{top:q.zone_top_ft,bottom:q.zone_bottom_ft,plane:17/12,frame:'mlb-statsapi-v1'}):null}}));
   const geometry = list.find(q => q.current),limits={top:geometry?.zone_top_ft,bottom:geometry?.zone_bottom_ft};
   const svg=state.flight||gc.flightSvg(list,limits,null,126,126);
   if(state.flight&&typeof svg.__updatePitchScene==='function')svg.__updatePitchScene(list,limits,null);
   state.flight=svg;svg.classList.add('otv-card-field');zone.append(svg);
   if(list.some(q=>!q.measured))zone.append(node('small','','Reported plate guide'));
   else if(!list.length)zone.append(node('small','','Pitch geometry pending'));
  }
  let hitNow = !substitution && gc && typeof gc.releasedHit === 'function' ? gc.releasedHit(model) : null;
  const livePitch=state.pitch&&state.pitch.id===current?.id?state.pitch:null;
  const pitchPending=!reduce&&livePitch&&now<livePitch.landsAt;
  const ownedInPlay=model.summary?.completed!==true&&current?.pitch===true&&current.in_play===true&&current.result!==true&&livePitch;
  const liveLocation=hitNow?.contact&&model.contact?.event_id===current?.id&&(!current?.at_bat||model.contact?.at_bat_id===current.at_bat)&&Number.isFinite(hitNow.measurements.coord_x)&&Number.isFinite(hitNow.measurements.coord_y);
  if(hitNow?.contact&&!liveLocation)hitNow=null;
  const formattedResult=typeof gc?.resultSummary==='function'?gc.resultSummary(model):null;
  const resultContact=!reduce?sameUpdateResultContact(model,livePitch,current,hitNow,formattedResult,presentation.review||state.localReview===true):null;
  const rejectedResultContact=!!state.contact?.resultAdmission&&state.contact.resultAdmission!==resultContact?.identity;
  if(rejectedResultContact){cardPlayed.add('contact:'+state.contact.pitchId);state.contact=null;while(cardPlayed.size>40)cardPlayed.delete(cardPlayed.values().next().value);}
  const promotionPitchRows=Array.isArray(model.timeline)?model.timeline.filter(r=>r&&r.id===current?.id):[];
  const promotionCurrent=promotionPitchRows.length===1?promotionPitchRows[0]:null;
  if((ownedInPlay||(pitchPending&&resultContact&&state.resultRevealedPitch!==livePitch.id))&&!state.contact&&!cardPlayed.has('contact:'+current.id))
   state.contact={id:hitNow?.id||'pitch:'+current.id,pitchId:livePitch.id,startedAt:null,directional:!!(liveLocation||resultContact),situation:{...(resultContact?livePitch.situation:s)},admission:!liveLocation?neutralContactAdmission(model,current.id,now,modelOrder):null,admissionOwner:{eventId:model.event_id,identity:promotionPitchIdentity(promotionCurrent)},fieldStartedAt:null,resultAdmission:resultContact?.identity||null};
  if(pitchPending&&resultContact&&state.resultRevealedPitch!==livePitch.id&&!cardPlayed.has('contact:'+current.id)
   &&state.contact?.pitchId===livePitch.id&&state.contact.startedAt===null&&!state.contact.directional
   &&state.contact.admissionOwner?.eventId===model.event_id&&state.contact.admissionOwner.identity===promotionPitchIdentity(promotionCurrent)){
   state.contact.directional=true;state.contact.id=hitNow.id;state.contact.resultAdmission=resultContact.identity;
  }
  const contact=state.contact&&state.contact.pitchId===current?.id?state.contact:null;
  if(contact?.admission&&(contact.admission.eventId!==model.event_id||model.summary?.scope!=='current_at_bat'
   ||contact.admission.identity!==promotionPitchIdentity(promotionCurrent)||current?.pitch!==true||current.in_play!==true||current.result!==false
   ||current.pitch_number!==promotionCurrent.pitch_number||current.pitch_type!==promotionCurrent.pitch_type||current.mph!==promotionCurrent.mph))contact.admission=null;
  // A pitch-only in-play model may precede its neutral contact record. Retain this exact owner, not a new clock.
  if(contact?.admissionOwner&&(contact.admissionOwner.eventId!==model.event_id||contact.admissionOwner.identity!==promotionPitchIdentity(promotionCurrent)))contact.admissionOwner=null;
  if(ownedInPlay&&contact&&!contact.admission&&!contact.directional&&!liveLocation&&model.stale!==true&&!presentation.review&&state.localReview!==true
   &&contact.admissionOwner?.eventId===model.event_id&&contact.admissionOwner.identity&&contact.admissionOwner.identity===promotionPitchIdentity(promotionCurrent))
   contact.admission=neutralContactAdmission(model,current.id,now,modelOrder);
  const laterGeometry=contact&&!contact.directional&&livePitch?releasedLaterGeometry(model,current.id,hitNow,formattedResult,now,modelOrder):null;
  const promotionLive={eventId:model.event_id,pitchId:livePitch?.id,atBat:promotionCurrent?.at_bat,now,pitchEndsAt:livePitch?.landsAt,
   resultRevealed:state.resultRevealedPitch===livePitch?.id,priorPark:!!cardPark,alreadyPlayed:hitNow?cardPlayed.has(hitNow.id):true,localReview:state.localReview===true};
  if(!reduce&&canPromoteLaterGeometry(contact?.admission,laterGeometry,promotionLive)){
   contact.directional=true;contact.id=hitNow.id;
   // Geometry arrived later than neutral contact: start its own actual scene once, never the old pulse clock.
   if(contact.fieldStartedAt===null)contact.fieldStartedAt=Math.max(now,livePitch.landsAt);
  }
  if(pitchPending&&(contact||hitNow||model.summary?.completed===true))state.wakeAt=livePitch.landsAt;
  if(!pitchPending&&contact&&contact.startedAt===null){contact.directional=!!(contact.directional||(ownedInPlay&&liveLocation));contact.startedAt=now;cardPlayed.add('contact:'+contact.pitchId);if(cardPlayed.size>40)cardPlayed.delete(cardPlayed.values().next().value);}
  const contactPending=!reduce&&contact&&contact.startedAt!==null&&now<contact.startedAt+600;
  let resultPending=model.summary?.completed===true&&pitchPending;
  if (!pitchPending && hitNow && (!resultPending||contact?.directional) && typeof gc.fieldCanvas === 'function' && Number.isFinite(hitNow.measurements.coord_x)&&Number.isFinite(hitNow.measurements.coord_y)) {
   const same=!rejectedResultContact&&cardPark&&cardPark.id===hitNow.id,geometry=JSON.stringify([hitNow.measurements,hitNow.illustrativeSector||null]);
   const reuse=same&&cardPark.geometry===geometry?cardPark.node:null;
   // Only a previously admitted contact phase may launch a live field scene. A late result is a static recap.
   if(contact&&contact.startedAt===null)contact.startedAt=now;
   if(cardPark&&!same)cardPark.node?.__disposeFieldScene?.();
   const startedAt=same?cardPark.startedAt:Number.isFinite(contact?.fieldStartedAt)?contact.fieldStartedAt:contact?.startedAt??now;
   const still=same?cardPark.still:reduce||!contact?.directional||cardPlayed.has(hitNow.id);
   const park=reuse||gc.fieldCanvas(hitNow.measurements,'#ffb547',132,132,still,hitNow.illustrativeSector,startedAt,same?cardPark.node:null);
   if(park){cardPlayed.add(hitNow.id);if(cardPlayed.size>40)cardPlayed.delete(cardPlayed.values().next().value);park.classList.add('otv-card-field');state.park={id:hitNow.id,node:park,geometry,startedAt,still};zone.replaceChildren(park);}
  }else if(cardPark){cardPark.node?.__disposeFieldScene?.();state.park=null;}
   const resultTiming=model.summary?.completed===true?confirmedResultTiming(model,livePitch,contact,state.park,formattedResult,reduce,presentation.review||state.localReview===true):null;
   const resultOwner=model.summary?.completed===true&&model.selected_event_id===model.last_play_event_id&&current?.id
    ?JSON.stringify([model.event_id,model.selected_event_id,current.id]):null;
   if(state.resultRevealed!==resultOwner)state.resultRevealed=null;
   const alreadyRevealed=!!resultOwner&&state.resultRevealed===resultOwner;
   resultPending=!!resultTiming&&!alreadyRevealed&&now<resultTiming.revealAt;
   if(resultOwner&&!resultPending&&state.localReview!==true)state.resultRevealed=resultOwner;
   if(model.summary?.completed===true&&!resultPending&&current?.id&&state.localReview!==true)state.resultRevealedPitch=current.id;
   if(resultTiming){card.dataset.resultTimingBasis=resultTiming.basis;card.dataset.resultTimingReason=resultTiming.reason;card.dataset.resultTimingSupported=String(resultTiming.supported);}
   if(resultPending)state.wakeAt=resultTiming.revealAt;
   if(!pitchPending&&contact&&!contact.directional&&(model.summary?.completed!==true||resultPending)){
   // Neutral activity at this pitch endpoint; no hit destination is invented.
   const svg=state.flight,ball=[...(svg?.querySelectorAll('circle')||[])].find(n=>n.getAttribute('data-flight-motion')!==null);
   for(const n of [...(svg?.querySelectorAll('.obc-neutral-contact')||[])])n.remove();
   if(ball&&svg){const ring=root.document.createElementNS('http://www.w3.org/2000/svg','circle');
    for(const [key,value] of Object.entries({class:'obc-neutral-contact',cx:ball.getAttribute('cx'),cy:ball.getAttribute('cy'),r:7,fill:'none',stroke:'#ffb547','stroke-width':2,'data-neutral-contact':'plate-pulse','data-contact-clock-ms':contact.startedAt}))ring.setAttribute(key,value);
    if(!reduce)for(const [attribute,values] of [['r','7;27'],['opacity','.7;0']]){const a=root.document.createElementNS('http://www.w3.org/2000/svg','animate');for(const [key,value] of Object.entries({attributeName:attribute,values,dur:'1.2s',repeatCount:'indefinite',begin:'-'+(((now-contact.startedAt)%1200)/1000).toFixed(3)+'s'}))a.setAttribute(key,value);ring.append(a);}
    svg.append(ring);svg.setAttribute('aria-label','Ball in play; neutral contact pulse at the pitch endpoint');
   }
  }else for(const n of [...(state.flight?.querySelectorAll('.obc-neutral-contact')||[])])n.remove();
  
  card.dataset.animationPhase=pitchPending?'pitch':resultPending?'contact':model.summary?.completed===true?'result':contactPending?'contact':contact?'contact':'pitch';
  // One active exact pitch and one latest model: full pitch, admitted contact, confirmed result.
  // Confirmed text follows an existing supported scene endpoint; new pitches cancel their old owner.
  const scene=zone.querySelector('.otv-card-field'),kind=scene?.tagName?.toLowerCase()==='canvas'?'field':'pitch';
  if(scene){scene.style.position='';scene.style.pointerEvents='';scene.dataset.sceneKind=kind;
   const previous=state.visual;if(previous&&previous.node!==scene&&previous.kind!==kind&&typeof scene.animate==='function'){
    zone.style.position='relative';previous.node.style.position='absolute';previous.node.style.left='0';previous.node.style.top='0';previous.node.style.pointerEvents='none';zone.prepend(previous.node);
    const blend=scene.animate([{opacity:0},{opacity:1}],{duration:160,easing:'ease-out'});
    blend.finished.then(()=>{if(previous.node.parentNode===zone)previous.node.remove();}).catch(()=>{});
   }state.visual={node:scene,kind};
  }
  if (!zone.children.length) zone.append(node('small', '', 'Pitch flight unavailable'));
  // Oct 26: a released pickoff/caught-stealing play replaces the last pitch until the next pitch or at-bat.
  const baseRunning=root.OrbitalBaseRunning,baseRun=!substitution&&baseRunning?baseRunning.play(model.timeline):null,halfEnded=baseRunning?baseRunning.inningEnd(model):null;
  if(baseRun){for(const n of zone.querySelectorAll('.otv-card-field'))n.__disposeFieldScene?.();if(state.park){state.park=null;}zone.replaceChildren(baseRunning.graphic(baseRun,{reduce}));card.dataset.basePlay=baseRun.kind;}
  if(halfEnded)card.dataset.halfInning='ended';
  const pitch = node('div', 'obc-pitch');
  // r9 (TV257 parity): location first; a released ruling waits for the next released row.
  const heldRv = (() => { const tl = Array.isArray(model.timeline) ? model.timeline : [], last = tl.at(-1), v = last?.revision;
   if (substitution || !current || !last || last.pitch !== true || last.result === true || String(last.id) !== String(current.id) || !v || typeof v !== 'object' ||
    !['challenge', 'review'].includes(v.kind) || !['overturned', 'upheld', 'changed'].includes(v.outcome)) return null;
   const t = String(last.text || '').toLowerCase(), b = Number.isInteger(last.balls) ? last.balls : null, k = Number.isInteger(last.strikes) ? last.strikes : null, ch = v.outcome !== 'upheld';
   let call = text(last.text), hb = b, hk = k;
   if (ch && /strike/.test(t)) { call = 'Ball'; hb = b === null ? null : b + 1; hk = k === null ? null : k - 1; }
   else if (ch && /\bball\b/.test(t)) { call = 'Called Strike'; hb = b === null ? null : b - 1; hk = k === null ? null : k + 1; }
   const ok = hb !== null && hk !== null && hb >= 0 && hb <= 3 && hk >= 0 && hk <= 2;
   return {call, balls: ok ? hb : null, strikes: ok ? hk : null, line: v.kind === 'challenge' ? 'Challenge · under review' : 'Under review'}; })();
  pitch.append(node('small', 'obc-label', substitution ? 'Game update' : current ? 'Pitch ' + pitchNumber(current) : 'Pitch information'));
  pitch.append(node('strong', substitution ? 'obc-headline obc-administration' : 'obc-pitch-type', substitution ? substitution.label : text(current?.pitch_type, 80) || '—'));
  if (substitution) { pitch.append(node('span', 'obc-result', substitution.copy)); if (substitution.base) pitch.append(node('span', 'obc-context', substitution.base)); }
  const speed = pitchSpeed(current);
  if (speed !== null) {
   const row = node('div', 'obc-speed'); row.append(node('strong', '', speed.toFixed(1)), node('span', '', 'mph')); pitch.append(row);
   const change = speedChangeV3(rows, current); if (change) pitch.append(node('span', 'obc-speed-change', change));
  }
  if (text(current?.text)) pitch.append(node('span', 'obc-current-call', current.in_play===true?'In play':heldRv?.call||text(current.text)));
  const insight = !substitution && current ? pitchInsightV3(current) : null;
  if (insight) { const chip = node('span', 'obc-insight', heldRv ? insight.zone.charAt(0).toUpperCase() + insight.zone.slice(1) : insight.label); chip.dataset.zone = insight.zone;
   Object.assign(chip.style,{alignSelf:'flex-start',width:'fit-content',display:'inline-flex',textShadow:'none',padding:'2px 9px',borderRadius:'999px',fontWeight:'650',color:'#0b1622',background:INSIGHT_TONE_V3[insight.zone],minHeight:'0'}); pitch.append(chip); }
  const verdict = !substitution && current?.in_play === true ? contactVerdictV3(current) : null;
  if (verdict) { const chip = node('span', 'obc-contact-verdict', verdict); Object.assign(chip.style,{alignSelf:'flex-start',width:'fit-content',display:'inline-flex',textShadow:'none',padding:'2px 9px',borderRadius:'999px',fontWeight:'700',color:'#1a1200',background:/^Barrel/.test(verdict)?'#ffb020':'#ffd98a',minHeight:'0'}); pitch.append(chip); }
  const summary = model.summary || {};
  const rs = !substitution && !resultPending && typeof gc?.resultSummary === 'function' ? gc.resultSummary(model) : null;
  if (rs) {
   const head = node('strong', 'obc-headline', rs.big); if (rs.productive) head.dataset.run = '1'; pitch.append(head);
   if (rs.support || rs.scored) pitch.append(node('span', 'obc-run', [rs.support, rs.scored].filter(Boolean).join(' · ')));
  }
  if (!rs && !pitchPending && (summary.completed !== true || resultPending) && contact) pitch.append(node('strong', 'obc-headline', (hitNow?.contact?hitNow.outcome:'Ball in play').toUpperCase()));
  if (!substitution && !resultPending && !rs && summary.completed === true && text(summary.outcome)) {
   const parts = String(summary.outcome).split(/\.\s{2,}|(?<!\b(?:Jr|Sr|St|[A-Z]))\.\s+/), scorers = parts.slice(1).filter(x => /\bscores?\b/i.test(x));
   const hitWord = /\b(singles|doubles|triples|homers|home run|grand slam)\b/i.test(parts[0] || '');
   if (scorers.length && !hitWord) {
    const sac = /sacrifice|sac fly|sac bunt/i.test(parts[0] || ''), head = node('strong', 'obc-headline', (sac ? 'RBI ' : '') + (/fly/i.test(parts[0]) && sac ? 'SAC FLY' : sac ? 'SACRIFICE' : 'RUN SCORES'));
    head.dataset.run = '1'; pitch.append(head, node('span', 'obc-run', '+' + scorers.length + ' run' + (scorers.length === 1 ? '' : 's') + ' · ' + scorers.map(x => x.replace(/\.$/, '')).join(' · ')));
   }
  }
  if (!substitution && !resultPending && summary.completed === true && text(summary.outcome)) { const first = String(summary.outcome).split(/\.\s{2,}|(?<!\b(?:Jr|Sr|St|[A-Z]))\.\s+/)[0].trim().replace(/\.$/, ''); pitch.append(node('span', 'obc-result', first ? first + '.' : text(summary.outcome))); }
  // Oct 8 (scenario coverage): released corrections, reviews and game status; facts only, nothing parsed from text.
  const tagLine = (() => {
   if (s.review_pending === true) return [s.review_kind === 'challenge' ? 'Challenge · under review' : 'Under review', 'alert'];
   if (heldRv) return [heldRv.line, 'alert'];
   const provenance = model.status_provenance;
   const suspended = model.state === 'suspended' && text(model.status, 100) && provenance && typeof provenance === 'object' && !Array.isArray(provenance) && ((provenance.source === 'MLB' && provenance.basis === 'typed_game_advisory') || (provenance.source === 'ESPN' && provenance.basis === 'typed_provider_status'));
   const st = suspended ? 'Game suspended' : {delayed: 'Game delayed', suspended: 'Game suspended'}[String(s.game_status || '').toLowerCase()];
   if (st) return [[st, text(s.status_reason).slice(0, 40)].filter(Boolean).join(' · '), 'alert'];
   if (substitution) return null;
   const all = [...(Array.isArray(model.timeline) ? model.timeline : []), ...(Array.isArray(model.plays) ? model.plays : [])].filter(r => r && typeof r === 'object');
   const done = summary.completed === true && !resultPending, row = done ? all.filter(r => r.result === true).at(-1) : all.filter(r => r.pitch === true).at(-1);
   const v = row?.revision, kinds = {challenge: 'Challenge', review: 'Review', scoring_change: 'Scoring change', reclassified: 'Pitch updated'};
   if (v && typeof v === 'object' && kinds[v.kind]) {
    const by = typeof v.by === 'string' && /^[A-Za-z .'-]{1,24}$/.test(v.by) ? v.by.trim().slice(0, 8).toUpperCase() : '';
    const changed = v.outcome === 'overturned' || v.outcome === 'changed' || v.kind === 'scoring_change' || v.kind === 'reclassified';
    return [[kinds[v.kind], {overturned: 'overturned', upheld: 'call stands'}[v.outcome], by].filter(Boolean).join(' · '), changed ? 'changed' : ''];
   }
   if (done && typeof row?.fielders === 'string' && /^[0-9EU-]{1,20}$/.test(row.fielders)) return ['Scoring · '+row.fielders, ''];
   return null;
  })();
  if (tagLine) { const t = node('span', 'obc-tag', tagLine[0]); if (tagLine[1]) t.dataset.tone = tagLine[1]; pitch.append(t); }
  const contactMetrics = !pitchPending&&!resultPending?hitNow:null;
  if (contactMetrics) {
   const h = contactMetrics.measurements, metrics = [];
   if (finite(h.launch_speed, 0, 150)) metrics.push(h.launch_speed.toFixed(1) + ' mph EV');
   if (finite(h.launch_angle, -90, 90)) metrics.push(h.launch_angle.toFixed(1) + '° launch');
   if (finite(h.distance, 0, 700)) metrics.push(Math.round(h.distance) + ' ft');
   if (metrics.length) pitch.append(node('span', 'obc-context', metrics.join(' · ')));
  }
  card.dataset.resultFocus=String(!substitution&&!resultPending&&summary.completed===true&&!!text(summary.outcome));
  main.append(zone); card.append(main);
  const band = node('div', 'obc-count-band'), count = node('div', 'obc-count-copy');
  const visibleSituation=(v=>halfEnded?{...v,outs:3}:baseRun&&baseRun.outs!==null?{...v,outs:baseRun.outs}:v)(heldRv&&heldRv.balls!==null?{...s,balls:heldRv.balls,strikes:heldRv.strikes}:resultPending&&contact?contact.situation:s);
  const balls = integer(visibleSituation.balls, 0, 4) ? visibleSituation.balls : '—', strikes = integer(visibleSituation.strikes, 0, 3) ? visibleSituation.strikes : '—';
  count.append(node('small', halfEnded ? 'obr-last' : '', halfEnded ? 'Last count' : 'Count'), node('strong', '', balls + ' - ' + strikes));
  band.append(count, bases(visibleSituation), node('span', 'obc-outs', integer(visibleSituation.outs, 0, 3) ? visibleSituation.outs + (visibleSituation.outs === 1 ? ' out' : ' outs') : 'Outs —'));
  if (rows.length) {
   const recent = node('div', 'obc-recent'), chips = node('div', 'obc-chips');
   recent.append(node('small', 'obc-label', 'Recent pitches'));
   for (const p of rows) {
    const chip = node('div', 'obc-chip'), head = node('div', 'obc-chip-head');
    if (p === current) chip.dataset.current = 'true';
    const dot = node('span', 'obc-pitch-dot', pitchNumber(p)); dot.style.backgroundColor = '#c8d7e1';
    head.append(dot, node('b', '', text(p.pitch_type, 80) || '—')); chip.append(head);
    const mph = pitchSpeed(p);
    if (mph !== null) chip.append(node('span', 'obc-chip-speed', mph.toFixed(1) + ' mph'));
    if (text(p.text)) chip.append(node('span', 'obc-chip-detail', text(p.text)));
    chips.append(chip);
   }
   recent.append(chips); // Retained UI models; no lower recent-pitch strip.
  }
  if (baseRun) { const head = node('strong', 'obc-headline', baseRun.title); head.dataset.tone = baseRun.out === true ? 'out' : baseRun.out === false ? 'safe' : 'unknown';
   pitch.replaceChildren(node('small', 'obc-label obr-kicker', halfEnded ? halfEnded.label : 'Baserunning'), head, node('span', 'obc-result', baseRun.copy), node('span', 'obc-context', baseRunning.caption)); }
  else if (halfEnded) pitch.prepend(node('small', 'obc-label obr-kicker obc-half-end', halfEnded.label));
  const result = node('div', 'obc-result-area');
  result.append(pitch); main.append(result, band);
  return card;
 }

 // Football successor: preserve approved A Drive Focus + B Game Explainer.
 // Play, drive, field, possession, timeout and ruling facts use only the released row prefix.
 // An optional separately labelled Current picture header shows only a locally bound, server-confirmed
 // scorebar observation during its nonrenewing lease. It never advances the play, field or ruling.
 // Play paths remain schematic estimates from reported spots/text and are labelled EST.
 const FB_CSS = `
.ofb{display:flex;flex-direction:column;gap:7px;padding:11px 13px 9px;container-type:inline-size;min-width:0}
.ofb-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}
.ofb-team{display:flex;flex-direction:column;gap:3px;min-width:0}
.ofb-team.home{align-items:flex-end;text-align:right}
.ofb-name{display:flex;align-items:center;gap:6px;font-weight:700;font-size:15px;letter-spacing:.02em}
.ofb-team.home .ofb-name{flex-direction:row-reverse}
.ofb-stripe{width:4px;height:16px;border-radius:2px;flex:none}
.ofb-score{font-size:19px;font-weight:800}
.ofb-ball{width:7px;height:7px;border-radius:50%;background:#f3d27a;box-shadow:0 0 0 2px #0006;flex:none}
.ofb-to{display:flex;gap:3px}.ofb-to i{display:block;width:12px;height:3px;border-radius:2px;background:currentColor}.ofb-to i.used{opacity:.22}
.ofb-clock{font-size:12px;font-weight:700;color:#cfe9dd;text-align:center;white-space:nowrap}
.ofb-clock small{display:block;font-weight:600;color:var(--tracker-muted);font-size:10.5px}
.ofb-situ{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ofb-down{font-size:27px;font-weight:800;line-height:1.1;letter-spacing:-.01em;white-space:nowrap}
.ofb-spot{font-size:12px;color:var(--tracker-muted);white-space:nowrap}
.ofb-situ{flex-wrap:wrap;row-gap:3px}
.ofb-field{display:block;width:100%;height:auto;border-radius:7px}
.ofb-last{display:flex;justify-content:space-between;gap:8px;align-items:baseline;font-size:13.5px;line-height:1.25}
.ofb-last strong{font-weight:650;min-width:0;line-height:1.3;overflow-wrap:anywhere}
.ofb-yds{font-weight:800;white-space:nowrap}
.ofb-est{font-size:10px;color:var(--tracker-muted);margin-top:-4px}
.ofb-field-key{display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--tracker-muted);margin-top:-4px}.ofb-field-key span{display:flex;gap:4px;align-items:center}.ofb-field-key i{width:10px;height:2px;background:#fff}.ofb-field-key span:nth-child(2) i{background:#ffd44f}
.ofb-timeout-label{font-size:10px;color:var(--tracker-muted)}
.ofb-slot{border-top:1px solid #bfd7e826;padding-top:7px;display:flex;flex-direction:column;gap:3px;font-size:12.5px}
.ofb-slot-head{display:flex;gap:8px;align-items:baseline}
.ofb-tag{font-size:11px;font-weight:800;letter-spacing:.08em;color:var(--tracker-muted)}
.ofb-slot[data-kind=flag]{border-left:3px solid #ffd44f;padding-left:8px}.ofb-slot[data-kind=flag] .ofb-tag{color:#ffd44f}
.ofb-slot[data-kind=review]{border-left:3px solid #ffd44f;padding-left:8px}.ofb-slot[data-kind=review] .ofb-tag{color:#ffd44f}
.ofb-slot[data-kind=score] .ofb-tag{color:#f3c94f}.ofb-slot[data-kind=turnover] .ofb-tag{color:#ff8f7a}
.ofb-big{font-size:17px;font-weight:800}
.ofb-muted{color:var(--tracker-muted)}
.ofb-chips{display:flex;gap:5px;flex-wrap:nowrap;overflow:hidden}
.ofb-chip{display:flex;gap:4px;align-items:center;font-size:11px;white-space:nowrap;background:#ffffff0d;border-radius:6px;padding:2px 6px}
.ofb-chip b{width:6px;height:6px;border-radius:50%;flex:none}
.ofb-foot{display:flex;justify-content:space-between;font-size:10.5px;color:var(--tracker-muted)}
.ofb-trust{display:flex;gap:5px;align-items:center;font-size:10.5px;color:var(--tracker-muted)}.ofb-trust::before{content:'';width:5px;height:5px;flex:none;background:currentColor;border-radius:50%}.ofb-trust[data-state=picture]{color:#a4e3c6}
.ofb-expanded-body{display:flex;flex-direction:column;gap:18px}.ofb-overview{display:flex;flex-direction:column;gap:9px}.ofb-history{border-top:1px solid #bfd7e826;padding-top:12px;display:flex;flex-direction:column;gap:9px}.ofb-history h3{font-size:13px;margin:0}.ofb-history>p{font-size:12px;margin:0}.ofb-ledger{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}.ofb-ledger li{display:grid;grid-template-columns:65px minmax(0,1fr) auto;gap:10px;align-items:start;padding:9px 0;border-top:1px solid #ffffff10;font-size:13px;line-height:1.35}.ofb-ledger li small{font-size:11px;color:var(--tracker-muted)}.ofb-ledger li strong{font-size:13px}.ofb-ledger p{margin:6px 0 0;color:var(--tracker-muted);font-size:12px}.ofb-play-detail summary{cursor:pointer;font-weight:650}.ofb-play-detail summary:focus-visible{outline:2px solid #6fe4c4;outline-offset:3px;border-radius:3px}.ofb-page{max-width:none!important}.ofb-page .ofb-field{height:120px;max-height:120px}.ofb-page .ofb-est{font-size:11px}
.ofb-picture{border-bottom:1px solid #bfd7e826;padding-bottom:8px;display:flex;flex-direction:column;gap:6px}.ofb-picture-label{font-size:10px;color:#a4e3c6;text-transform:uppercase;letter-spacing:.08em}.ofb-confirmed-label{font-size:10px;color:var(--tracker-muted);text-transform:uppercase;letter-spacing:.06em}.ofb-picture-down{font-size:21px;font-weight:800;white-space:nowrap}.ofb-picture-note{font-size:10px;color:var(--tracker-muted)}
.ogp-football-v2>.ogp-hero,.ogp-football-v2>.ogp-field-key,.ogp-football-v2>.ogp-lower{display:none}.ogp-football-v2>.ogp-visual{padding:0;background:none;border:0;min-height:0}
@container(max-width:280px){.ofb-top{gap:4px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.ofb-name{font-size:12px;gap:4px;flex-wrap:nowrap}.ofb-score{font-size:19px}.ofb-stripe{height:13px;width:3px}.ofb-clock{grid-column:1 / -1;grid-row:2;font-size:12px;padding-top:2px}.ofb-team.home{grid-column:2;grid-row:1}.ofb-team.home .ofb-name{justify-content:flex-start}.ofb-down{font-size:23px}.ofb-spot{font-size:11px}.ofb-last{font-size:12px}.ofb-slot{font-size:11.5px}.ofb-big{font-size:14px}.ofb-timeout-label{font-size:9px}.ofb-ledger li{grid-template-columns:48px minmax(0,1fr) auto;gap:6px}.ofb-field-key{display:none}}
@container(min-width:600px){.ofb-expanded-body{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:20px}.ofb-page .ofb-down{font-size:30px}.ofb-page .ofb-history{padding-top:0;border-top:0;border-left:1px solid #bfd7e826;padding-left:18px}}
`;
 function fbStyle() {
  if (document.getElementById('otc-fb-style')) return;
  const s = document.createElement('style'); s.id = 'otc-fb-style'; s.textContent = FB_CSS; document.head.append(s);
 }
 const FB_GAIN = '#5fd39a', FB_LOSS = '#ff7a6b', FB_NONE = '#9fb2c2', FB_SCORE = '#f3c94f', FB_FLAG = '#ffd44f';
 function fbNum(v) { return (typeof v === 'number' || typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) ? Number(v) : null; }
 function fbCurrentText(r) { return String(r?.text || '').split(/\(Original Play:/i)[0]; }
 function fbNoPlay(r) { return /\bNO PLAY\b|\bplay (?:is )?nullified\b/i.test(fbCurrentText(r)); }
 function fbReleased(model) {
  const all = Array.isArray(model.timeline) ? model.timeline.filter(r => r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string') : [];
  const id = typeof model.last_play_event_id === 'string' ? model.last_play_event_id : '';
  const at = id ? all.findIndex(r => r.id === id) : -1;
  if (at >= 0) return all.slice(0, at + 1);
  return []; // An unknown release ID is never permission to disclose the latest rows.
 }
 function fbTeam(model, id) { return (model.teams || []).find(t => t && String(t.id) === String(id)) || null; }
 function fbAbbr(t) { return text(t?.abbreviation, 8) || text(t?.name, 20) || ''; }
 let fbAlias = new Map();
 // Play text may name a team differently from the spot field (ESPN: "UW 24" in text, "WASH 24" as spot). Learn
 // aliases from released rows whose reported end spot also appears in the text ("to the UW 24" with end_x 0.76).
 function fbLearnAliases(rows, model) {
  const map = new Map();
  for (const t of model.teams || []) if (t?.abbreviation) map.set(String(t.abbreviation).toUpperCase(), String(t.id));
  for (const r of rows) {
   const ex = fbNum(r.end_x), m = fbCurrentText(r).match(/\bto the ([A-Z]{2,5})\s?(\d{1,2})\b/);
   if (!m || ex == null || map.has(m[1])) continue;
   const sx=fbNum(r.start_x),yards=fbNum(r.yards);if(sx!=null&&yards!=null&&Math.abs((ex-sx)*100-yards)>2)continue;
   const n = Number(m[2]), other = (model.teams || []).find(t => String(t.id) !== String(r.team_id));
   if (Math.round(ex * 100) === n && n !== 50) map.set(m[1], String(r.team_id));
   else if (Math.round(100 - ex * 100) === n && other && n !== 50) map.set(m[1], String(other.id));
  }
  fbAlias = map;
 }
 function fbSpotX(spot, offense, model) {
  const s = String(spot || '').trim(); if (!s || !offense) return null;
  if (/^50$/.test(s)) return 0.5;
  const m = s.match(/^([A-Z]{2,5})\s*(\d{1,2})$/); if (!m) return null;
  const n = Number(m[2]), owner = fbAlias.get(m[1]); if (!(n >= 0 && n <= 50) || !owner) return null;
  return owner === String(offense.id) ? n / 100 : (100 - n) / 100;
 }
 function fbKind(r) {
  const t = String(r?.type || ''), x = fbCurrentText(r);
  if (fbNoPlay(r)) return /\bPENALTY\b/i.test(x) ? 'penalty' : 'noplay';
  if (/review|challenge/i.test(t)) return 'review';
  if (/touchdown/i.test(t) || /\bTOUCHDOWN\b/.test(x)) return 'td';
  if (/field goal good/i.test(t)) return 'fg';
  if (/field goal|missed fg|blocked fg/i.test(t)) return 'fgmiss';
  if (/safety/i.test(t)) return 'safety';
  if (/interception|fumble recovery \(opponent\)|fumble return/i.test(t) || /TURNOVER ON DOWNS/.test(x)) return 'turnover';
  if (/^penalty$/i.test(t)) return 'penalty';
  if (/\bsacked\b/i.test(x)) return 'sack';
  if (/punt/i.test(t)) return 'punt';
  if (/kickoff/i.test(t)) return 'kickoff';
  if (/timeout/i.test(t)) return 'timeout';
  if (/end (period|of half|of game|quarter)|end period/i.test(t)) return 'end';
  if (/sack/i.test(t)) return 'sack';
  if (/pass incompletion/i.test(t) || /pass incomplete/.test(x)) return 'inc';
  if (/pass|reception/i.test(t)) return 'pass';
  if (/rush|run/i.test(t)) return 'rush';
  return 'other';
 }
 function fbDir(x) { const m = String(x || '').match(/\b(short|deep)?\s*(left|middle|right)\b|\bup the middle\b|\b(left|right) end\b/i); return m ? m[0].toLowerCase().replace('up the middle', 'middle') : ''; }
 function fbPerson(x, re) { const m = String(x || '').match(re); return m ? ('#' + m[1] + ' ' + m[2]).trim() : ''; }
 function fbLabel(r) {
  const k = fbKind(r), x = fbCurrentText(r);
  if (k === 'noplay') return 'No play';
  const target = fbPerson(x, /\bto #(\d+)\s+([A-Z][\w.'-]*(?:\s[A-Z][\w'-]+)?)/), runner = fbPerson(x, /#(\d+)\s+([A-Z]\.[\w'-]+)\s+(?:rush|run)/i);
  if (k === 'pass' || (k === 'td' && /pass/i.test(x))) return ('Pass ' + (fbDir(x) || '') + (target ? ' to ' + target : '')).replace(/\s+/g, ' ').trim();
  if (k === 'inc') return ('Incomplete ' + (fbDir(x) || '')).trim();
  if (k === 'rush' || (k === 'td' && /rush|run/i.test(x))) return ('Run ' + (fbDir(x) || '') + (runner ? ' · ' + runner : '')).replace(/\s+/g, ' ').trim();
  if (k === 'sack') return 'Sack';
  if (k === 'punt') { const m = x.match(/punt (\d+) yards?/i); return 'Punt' + (m ? ' ' + m[1] + ' yds' : ''); }
  if (k === 'kickoff') return /touchback/i.test(x) ? 'Kickoff · touchback' : 'Kickoff';
  if (k === 'fg' || k === 'fgmiss') { const m = x.match(/from (\d+) yards?/i); return 'Field goal' + (m ? ' ' + m[1] + ' yds' : '') + (k === 'fg' ? ' · good' : /block/i.test(x) ? ' · blocked' : ' · missed'); }
  if (k === 'turnover') { if (/TURNOVER ON DOWNS/.test(x)) return 'Turnover on downs'; const m = x.match(/intercepted by #(\d+)\s+([A-Z][\w.'-]*)/i); return m ? 'Intercepted by #' + m[1] + ' ' + m[2] : 'Fumble lost'; }
  if (k === 'timeout') { const m = x.match(/timeout\s+([^,]+)/i); return 'Timeout' + (m ? ' · ' + m[1].trim() : ''); }
  if (k === 'end') return text(x, 60).replace(/\.$/, '') || 'End of period';
  if (k === 'penalty') return 'Penalty';
  return text(r?.type, 40) || 'Play';
 }
 function fbYards(r) {
  const k = fbKind(r), y = fbNum(r?.yards);
  if (k === 'noplay') return {t:'No play',c:FB_NONE};
  if (['inc'].includes(k)) return {t: 'Inc', c: FB_NONE};
  if (['punt', 'kickoff', 'timeout', 'end', 'turnover', 'fg', 'fgmiss'].includes(k)) return {t: '', c: k === 'fg' ? FB_SCORE : k === 'turnover' ? FB_LOSS : FB_NONE};
  if (k === 'penalty') return {t: y != null && y ? Math.abs(y) + ' yds' : '', c: FB_FLAG};
  if (k === 'td') return {t: 'TD', c: FB_SCORE};
  if (y == null) return {t: '', c: FB_NONE};
  return {t: y > 0 ? '+' + y : y < 0 ? '−' + Math.abs(y) : 'No gain', c: y > 0 ? FB_GAIN : y < 0 ? FB_LOSS : FB_NONE};
 }
 function fbPenalty(x) {
  const s = String(x || ''); const at = s.search(/\bPENALTY\b/); if (at < 0) return null;
  const p = s.slice(at + 7).trim();
  const m = p.match(/^([A-Z]{2,5})\s+(.+?)(?:\s*\((#\d+)\s*([^)]*)\))?(?:\s+(\d+)\s+yards?)?(?:\s+from\b|\.|,|\s+declined|\s+offsetting|$)/i);
  const decision = /\bdeclined\b/i.test(p) ? 'Declined' : /\boffsetting\b/i.test(p) ? 'Offsetting' : /\bNO PLAY\b/.test(p) ? 'Accepted · no play' : m && m[5] ? 'Accepted' : '';
  if (!m) return {team: '', foul: '', who: '', yards: '', decision, pending: !decision};
  const foul = m[2].replace(/\s+declined$/i, '').replace(/\s+offsetting$/i, '').trim();
  return {team: m[1], foul, who: [m[3], m[4]].filter(Boolean).join(' ').trim(), yards: m[5] || '', decision, pending: !decision && !m[5]};
 }
 function fbOrdinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }
 function fbDownText(r) {
  const d = fbNum(r?.down), dist = fbNum(r?.distance);
  if (!(d >= 1 && d <= 4)) return '';
  return fbOrdinal(d) + ' & ' + (r.goal_to_go === true ? 'Goal' : dist != null ? (dist === 0 ? 'inches' : dist) : '—');
 }
 function fbClock(r) {
  const p = Number(r?.period), c = text(r?.clock, 8);
  const q = p >= 1 && p <= 4 ? 'Q' + p : p > 4 ? 'OT' + (p > 5 ? p - 4 : '') : '';
  return [q, c].filter(Boolean).join(' ');
 }
 function fbTimeouts(rows, last, team, teams) {
  const p = Number(last?.period); if (!(p >= 1 && p <= 4) || !team) return null;
  const half = p <= 2 ? [1, 2] : [3, 4];
  const first = rows.find(r => Number(r.period) === half[0]);
  if (!first || fbKind(first)!=='kickoff' || !(/^(?:15:00|20:00)$/.test(String(first.clock || '')) || /^\((?:15:00|20:00)\)/.test(fbCurrentText(first)))) return null;
  // Same rule as TV259: every timeout row in the half must name exactly one team, otherwise the count is unknown.
  const keys = (teams || []).map(t => [t, [String(t.name || '').split(' ')[0], String(t.abbreviation || '').slice(0, 4)].map(k => k.toLowerCase()).filter(Boolean)]);
  const owner = r => keys.filter(([, ks]) => ks.some(k => String(r.text || '').toLowerCase().includes('timeout ' + k))).map(([t]) => t);
  const outs = rows.filter(r => half.includes(Number(r.period)) && fbKind(r) === 'timeout');
  if (outs.some(r => owner(r).length !== 1)) return null;
  return Math.max(0, 3 - outs.filter(r => String(owner(r)[0].id) === String(team.id)).length);
 }
 function fbDrive(rows, last) {
  const did = last?.drive_id; if (!did || fbKind(last) === 'kickoff') return null;
  const reset = rows.findLastIndex(r => fbKind(r) === 'kickoff');
  const plays = rows.slice(reset + 1).filter(r => r.drive_id === did && !['kickoff', 'timeout', 'end', 'review'].includes(fbKind(r)));
  if (!plays.length) return null;
  const scrim = plays.filter(r => !fbNoPlay(r) && fbKind(r) !== 'penalty' && fbKind(r) !== 'noplay');
  const firsts = scrim.filter(r => /\b1ST DOWN\b/i.test(fbCurrentText(r))).length;
  const third = scrim.filter(r => fbNum(r.start_down) === 3);
  const conv = third.filter(r => /\b1ST DOWN\b/i.test(fbCurrentText(r)) || fbKind(r) === 'td').length;
  const thirdComplete=third.every(r=>/\b1ST DOWN\b|short of (?:the )?first down|turnover on downs/i.test(fbCurrentText(r))||['td','inc'].includes(fbKind(r)));
  const t0 = plays[0], sameP = Number(t0.period) === Number(last.period);
  const sec = c => { const m = String(c || '').match(/^(\d+):(\d\d)$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const a = sec(t0.text?.match(/^\((\d+:\d\d)\)/)?.[1] || t0.clock), b = sec(last.clock);
  const dur = sameP && a != null && b != null && a >= b ? Math.floor((a - b) / 60) + ':' + String((a - b) % 60).padStart(2, '0') : '';
  return {plays: scrim.length, yds:null, firsts, third: third.length, conv, thirdComplete, dur, team: plays[0].team_id, rows:plays};
 }
 function fbField(model, last, offense, defense) {
  const W = 600, H = 118, L = 46, R = 554, Y0 = 4, Y1 = 92, px = x => L + x * (R - L);
  const svg = svgNode('svg', {viewBox: '0 0 ' + W + ' ' + H, class: 'ofb-field', role: 'img', 'aria-label': 'Field position'});
  svg.append(svgNode('rect', {x: 0, y: Y0, width: W, height: Y1 - Y0, rx: 7, fill: '#173f31'}));
  const ez = (x, t) => { svg.append(svgNode('rect', {x, y: Y0, width: L, height: Y1 - Y0, fill: (t && /^#[0-9a-f]{6}$/i.test(t.color || '')) ? t.color : '#24564a', opacity: 0.85}));
   const lab = svgNode('text', {x: x + L / 2, y: (Y0 + Y1) / 2 + 4, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: '#fff', transform: 'rotate(-90 ' + (x + L / 2) + ' ' + ((Y0 + Y1) / 2) + ')'}); lab.textContent = fbAbbr(t); svg.append(lab); };
  ez(0, offense); ez(R, defense);
  const spotX = fbSpotX(last?.spot, offense, model);
  const red = spotX != null && spotX >= 0.8; if (red) svg.append(svgNode('rect', {x: px(0.8), y: Y0, width: px(1) - px(0.8), height: Y1 - Y0, fill: '#c0392b', opacity: 0.16}));
  for (let yd = 10; yd < 100; yd += 10) {
   svg.append(svgNode('line', {x1: px(yd / 100), x2: px(yd / 100), y1: Y0, y2: Y1, stroke: '#e9f3ee', opacity: yd === 50 ? 0.55 : 0.28}));
   const n = svgNode('text', {x: px(yd / 100), y: H - 4, 'text-anchor': 'middle', 'font-size': 19, 'font-weight': 700, fill: '#cfe0d8'}); n.textContent = String(yd <= 50 ? yd : 100 - yd); svg.append(n);
  }
  const dist = fbNum(last?.distance), fd = spotX == null || last?.goal_to_go === true ? null : dist != null && dist > 0 ? spotX + dist / 100 : null;
  if (fd != null && fd < 1) svg.append(svgNode('line', {x1: px(fd), x2: px(fd), y1: Y0, y2: Y1, stroke: '#ffd44f', 'stroke-width': 3}));
  // Last play path: only when this row's coordinates belong to the current offense (no punt/turnover/kick).
  const k = fbKind(last), sx = fbNum(last?.start_x), rawEnd = fbNum(last?.end_x), yards = fbNum(last?.yards);
  const textEnd = sx != null && yards != null ? sx + yards / 100 : null;
  const ex = rawEnd != null && textEnd != null && Math.abs((rawEnd - sx) * 100 - yards) > 2 ? textEnd : rawEnd;
  const drawable = ['pass', 'rush', 'sack', 'inc', 'td'].includes(k) && sx != null && ex != null && sx >= 0 && sx <= 1 && ex >= 0 && ex <= 1 && Math.abs(ex - sx) < 1 && String(last.team_id) === String(offense?.id);
  if (drawable) {
   const d = fbDir(last.text), lane = /left/.test(d) ? 24 : /right/.test(d) ? 72 : 48, mid = (Y0 + Y1) / 2;
   const c = fbYards(last).c, x0 = px(sx);
   if (k === 'pass' || k === 'inc' || (k === 'td' && /pass/i.test(last.text || ''))) {
    const caught = String(last.text || '').match(/(?:caught|thrown) (?:at|to) (?:the )?([A-Z]{2,5})\s?(\d{1,2})\b/), cx = caught ? fbSpotX(caught[1] + ' ' + caught[2], offense, model) : null;
    const tx = px(cx != null ? cx : k === 'inc' ? Math.min(1, sx + 0.1) : ex), peak = Math.min(lane, mid) - Math.min(26, Math.max(9, Math.abs(tx - x0) * 0.35));
    const arc = {d: 'M' + x0 + ' ' + mid + ' Q' + ((x0 + tx) / 2) + ' ' + peak + ' ' + tx + ' ' + lane, fill: 'none', stroke: c, 'stroke-width': 4, 'stroke-linecap': 'round'};
    if (k === 'inc') arc['stroke-dasharray'] = '6 5';
    svg.append(svgNode('path', arc));
    if (k !== 'inc' && cx != null && Math.abs(px(ex) - tx) > 2) svg.append(svgNode('line', {x1: tx, y1: lane, x2: px(ex), y2: lane, stroke: c, 'stroke-width': 3, 'stroke-linecap': 'round'}));
    if (k === 'inc') { const xm = svgNode('text', {x: tx, y: lane + 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: c}); xm.textContent = '×'; svg.append(xm); }
   } else svg.append(svgNode('path', {d: 'M' + x0 + ' ' + mid + ' L' + px(ex) + ' ' + lane, fill: 'none', stroke: c, 'stroke-width': 3, 'stroke-linecap': 'round'}));
   svg.append(svgNode('circle', {cx: x0, cy: mid, r: 5, fill: 'none', stroke: '#fff', 'stroke-width': 2}));
   const est = svgNode('text', {x: (x0 + px(ex)) / 2, y: Y0 + 11, 'text-anchor': 'middle', 'font-size': 15, fill: '#dfeee7', opacity: 0.85}); est.textContent = 'EST.'; svg.append(est);
  }
  if (spotX == null) return svg;
  svg.append(svgNode('line', {x1: px(spotX), x2: px(spotX), y1: Y0, y2: Y1, stroke: '#ffffff', 'stroke-width': 2.5}));
  svg.append(svgNode('circle', {cx: px(spotX), cy: (Y0 + Y1) / 2, r: 5, fill: '#f3d27a', stroke: '#3a2a10', 'stroke-width': 1.5}));
  return svg;
 }
 function fbSlot(model, rows, last, offense) {
  const slot = node('div', 'ofb-slot'), head = node('div', 'ofb-slot-head'), k = fbKind(last), x = fbCurrentText(last);
  const put = (kind, tag, big, ...lines) => { slot.dataset.kind = kind; head.append(node('span', 'ofb-tag', tag)); if (big) head.append(node('strong', 'ofb-big', big)); slot.append(head); for (const l of lines) if (l) slot.append(typeof l === 'string' ? node('span', 'ofb-muted', l) : l); return slot; };
  const scorer = fbTeam(model, last?.team_id);
  if (/\b(review|challenge|ruling on the field)\b/i.test(x)) {
   const out = /\boverturned|reversed\b/i.test(x) ? 'Overturned' : /\bupheld|confirmed|stands\b/i.test(x) ? 'Upheld' : '';
   return put('review', 'REPLAY REVIEW', out || 'Under review', out ? '' : 'Original call stands until the broadcast confirms the ruling.');
  }
  const pen = fbPenalty(x);
  if (pen) {
   const what = [pen.foul, [pen.team, pen.who].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
   if (pen.pending) return put('flag', 'FLAG', what || 'On the play', 'Enforcement details pending');
   const now = fbDownText(last);
   return put('flag', 'FLAG', what || 'Penalty', [pen.decision, pen.yards && !/Declined|Offsetting/.test(pen.decision) ? pen.yards + ' yds' : '', now ? 'now ' + now : ''].filter(Boolean).join(' · '));
  }
  if (k === 'td') return put('score', 'TOUCHDOWN', fbAbbr(scorer), /kick attempt good/i.test(x) ? 'Extra point good' : /kick attempt (failed|no good|blocked)/i.test(x) ? 'Extra point missed' : /two-point|2pt/i.test(x) ? (/(failed|no good)/i.test(x) ? 'Two-point try failed' : 'Two-point try') : '');
  if (k === 'fg') return put('score', 'FIELD GOAL', fbAbbr(scorer));
  if (k === 'safety') return put('score', 'SAFETY', '', '');
  if (k === 'turnover') { const now = fbTeam(model, last.possession); return put('turnover', 'TURNOVER', now ? fbAbbr(now) + ' ball' : '', fbLabel(last)); }
  if (k === 'end') return put('end', 'BREAK', fbLabel(last), '');
  if (k === 'timeout') return put('timeout', 'TIMEOUT', fbLabel(last).replace(/^Timeout\s*·?\s*/, ''), 'Play is stopped. Timeout marks stay unknown unless the released half is complete.');
  if (k === 'kickoff') return put('drive', 'NEW POSSESSION', offense ? fbAbbr(offense) + ' ball' : '', 'Drive context starts with the next reported play.');
  if (k === 'noplay') return put('flag', 'NO PLAY', '', 'The play does not count toward this drive.');
  if (Number(last?.down) === 4 && offense) {
   const sx = fbSpotX(last.spot, offense, model), fg = sx != null ? Math.round((1 - sx) * 100) + 17 : null;
   return put('fourth', '4TH DOWN', '', fg != null && fg <= 65 ? 'Field goal try would be ' + fg + ' yds' : 'Go for it, or punt');
  }
  const d = fbDrive(rows, last), team = fbTeam(model, d?.team);
  if (d) return put('drive', 'THIS DRIVE', '', [d.plays + ' reported play' + (d.plays === 1 ? '' : 's'), d.dur].filter(Boolean).join(' · '),
   [d.firsts ? d.firsts + ' reported first down' + (d.firsts === 1 ? '' : 's') : '', d.third&&d.thirdComplete ? 'Reported 3rd down ' + d.conv + '/' + d.third : '', team ? fbAbbr(team) + ' ball' : ''].filter(Boolean).join(' · '));
  return null;
 }
 function fbPictureVisible(model, receipt, now) {
  return receipt && receipt.context?.game_id === String(model.event_id) && fbNum(receipt.deadline) != null && now < receipt.deadline ? receipt.context : null;
 }
 function football(model, options = {}) {
  fbStyle();
  const card = node('section', 'otc-card otc-glass ofb' + (options.expanded ? ' ofb-page' : ''));
  card.setAttribute('aria-label', options.expanded ? 'Football game situation and reported drive' : 'Football tracker');
  const rows = fbReleased(model), last = rows.at(-1); fbLearnAliases(rows, model);
  const away = (model.teams || []).find(t => t?.side === 'away'), home = (model.teams || []).find(t => t?.side === 'home');
  if (!last || !away || !home) {
   card.append(node('strong', '', (text(model.league, 24) || 'Football') + ' tracker'), node('span', 'ofb-muted', model.held === true ? 'Waiting for the picture…' : 'Waiting for the first play…'));
   return card;
  }
  const offense = fbTeam(model, last.possession), defense = (model.teams || []).find(t => offense && String(t.id) !== String(offense.id));
  const final = model.state === 'final';
  const picture = !options.reported && !final ? fbPictureVisible(model, options.picture, typeof performance !== 'undefined' ? performance.now() : 0) : null;
  if (picture) {
   const current = node('section','ofb-picture');current.append(node('span','ofb-picture-label','Current picture'));
   current.append(node('strong','',fbAbbr(away)+' '+picture.away+' — '+picture.home+' '+fbAbbr(home)+' · '+fbClock(picture)));
   const observedDown=fbDownText(picture);if(observedDown)current.append(node('span','ofb-picture-down',observedDown));
   current.append(node('span','ofb-picture-note','From broadcast · play details pending'));card.append(current,node('span','ofb-confirmed-label','Last reported play · '+fbClock(last)));
  }
  const top = node('div', 'ofb-top');
  const side = (t, score, cls) => {
   const box = node('div', 'ofb-team ' + cls), name = node('div', 'ofb-name'), stripe = node('span', 'ofb-stripe');
   stripe.style.background = /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#7f93a6';
   name.append(stripe, node('span', '', fbAbbr(t)), node('span', 'ofb-score', fbNum(score) != null ? String(score) : '—'));
   if (!final && offense && String(offense.id) === String(t.id)) name.append(node('span', 'ofb-ball'));
   box.append(name);
   const left = fbTimeouts(rows, last, t, model.teams);
   if (!final) { const to = node('div', 'ofb-to');to.setAttribute('aria-label',fbAbbr(t)+': '+(left == null ? 'timeouts unknown' : left+' timeouts left'));to.title=left==null?'Timeouts unknown':left+' timeouts left';to.style.color=stripe.style.background;if(left==null)to.append(node('span','ofb-timeout-label','TO —'));else for(let i=0;i<3;i++)to.append(node('i',i<left?'':'used'));box.append(to); }
   return box;
  };
  const clock = node('div', 'ofb-clock', final ? 'Final' : fbClock(last));
  top.append(side(away, last.away, 'away'), clock, side(home, last.home, 'home')); if(!picture)card.append(top);
  if (!final) {
   const situ = node('div', 'ofb-situ'), down = fbDownText(last);
   const k0 = fbKind(last), big = k0 === 'td' ? 'Touchdown' : k0 === 'fg' ? 'Field goal' : k0 === 'safety' ? 'Safety' : k0 === 'end' ? fbLabel(last) : '';
   const bigNode = node('span', 'ofb-down', big || down || (offense ? fbAbbr(offense) + ' ball' : '')); if (k0 === 'td' || k0 === 'fg' || k0 === 'safety') bigNode.style.color = FB_SCORE;
   situ.append(bigNode, node('span', 'ofb-spot', last.spot ? (offense ? fbAbbr(offense) + ' ball · ' : '') + 'at ' + text(last.spot, 12) + ' →' : ''));
   card.append(situ, fbField(model, last, offense, defense));
   const key=node('div','ofb-field-key');for(const [label]of [['Current spot'],['First down']]){const item=node('span','');item.append(node('i',''),document.createTextNode(label));key.append(item);}card.append(key);
  }
  const lastPlay = [...rows].reverse().find(r => !['timeout', 'end', 'review'].includes(fbKind(r))) || last;
  const lp = node('div', 'ofb-last'), y = fbYards(lastPlay), yn = node('span', 'ofb-yds', y.t); yn.style.color = y.c;
  lp.append(node('strong', '', fbLabel(lastPlay)), yn); card.append(lp);
  if (!final && ['pass', 'rush', 'sack', 'inc', 'td'].includes(fbKind(last))) card.append(node('span', 'ofb-est', 'Play path estimated from text'));
  const slot = fbSlot(model, rows, last, offense); if (slot) card.append(slot);
  if (options.expanded) {
   const overview=node('div','ofb-overview');overview.append(...card.childNodes);card.replaceChildren();
   const drive=fbDrive(rows,last),history=node('section','ofb-history');history.append(node('h3','',drive?'Drive plays':'Recent reported plays'));
   const detail=node('p','ofb-muted',drive?drive.plays+' reported plays'+(drive.dur?' · '+drive.dur:''):'Current drive details are not available.');history.append(detail);
   const ledger=node('ol','ofb-ledger');const all=drive?.rows||rows.filter(r=>!['timeout','end','review'].includes(fbKind(r))),list=all.slice(-8);if(all.length>8)history.append(node('p','ofb-muted',(all.length-8)+' earlier reported plays · '+(drive?.firsts?drive.firsts+' first downs in this drive':'full drive totals above')));
   for(const r of list){const li=node('li',''),when=node('small','',fbClock(r)),body=node('details','ofb-play-detail'),y=fbYards(r),gain=node('strong','',y.t);li.dataset.eventId=r.id;gain.style.color=y.c;body.append(node('summary','',fbLabel(r)),node('p','',fbCurrentText(r)));li.append(when,body,gain);ledger.append(li);}history.append(ledger);const body=node('div','ofb-expanded-body');body.append(overview,history);card.append(body);
  }
  const trustText=options.reported?'Latest reported':picture?'Broadcast situation':text(model.label,40)||text(model.display_label,40),delayed=model.source_health&&model.source_health!=='fresh';
  if(trustText||delayed){const foot=node('div','ofb-foot'),trust=node('span','ofb-trust',trustText);trust.dataset.state=picture?'picture':'reported';if(trustText)foot.append(trust);if(delayed)foot.append(node('span','','Updates delayed'));card.append(foot);}
  return card;
 }
 function footballGameCenter(data) {
  // latest_page transport already unwraps the server model into the repository
  // DTO. Re-admit that reported DTO; never borrow a held player projection.
  const model=data?.latest_reported===true&&data?.held===false&&data?.kind==='football'
   ?root.OrbitalLatestPageModel?.present({id:data.event_id,league:data.league},{latest_render_model:data,game_snapshot:data.game_snapshot}):null;
  if (!model || model.kind !== 'football') {fbStyle();return node('section','otc-card otc-glass ofb','Reported football situation is unavailable.');}
  return football(model,{expanded:true,reported:true});
 }
 if(typeof window!=='undefined')window.OrbitalFootballPresentation=Object.freeze({gameCenter:footballGameCenter});

 function status(model) {
  return [text(model.status, 100), text(model.source, 60), text(model.source_health, 60)].filter(Boolean).join(' · ') || 'Server presentation';
 }
 // Local review uses only this admitted model's released pitch prefix. It owns
 // a separate scene and clock; live facts, animation state and transport stay live.
 function releasedPitchHistory(model) {
  const all=Array.isArray(model?.plays)?model.plays:[];
  return all.filter(p=>p&&typeof p==='object'&&!Array.isArray(p)&&p.pitch===true&&pitchNumber(p)!==null
   &&typeof p.id==='string'&&p.id.length>0&&p.id.length<=350&&all.filter(q=>q?.id===p.id).length===1).slice(-5);
 }
 function reviewGeometry(model,p) {
  const gc=root.OrbitalGc2;
  if(!serverPath(p?.flight)||typeof gc?.join!=='function'||typeof gc?.flightSvg!=='function')return null;
  const safe={...p,pitch_number:pitchNumber(p),flight:{...p.flight,fit:null,plate:null}};
  const list=gc.join({...model,plays:[safe]}).list.filter(q=>q.id===p.id&&q.pathSource==='server');
  return list.length===1?list[0]:null;
 }
 const reviewFact=p=>JSON.stringify([p.id,pitchNumber(p),p.pitch_type,pitchSpeed(p),p.text,p.flight]);
 // Inning recap is derived exclusively from the current released timeline prefix.
 const INNING_RECAP_AFTER_MS = 12000;
 function releasedRecapSelection(model) {
  if(model?.kind!=='baseball'||!Array.isArray(model.timeline)||typeof model.selected_event_id!=='string')return null;
  const matches=model.timeline.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)&&r.id===model.selected_event_id);
  return matches.length===1?matches[0]:null;
 }
 function releasedInningRecap(model) {
  const terminal=releasedRecapSelection(model);
  if(!terminal||model.timeline.at(-1)!==terminal||model.summary?.completed!==true||model.summary?.scope!=='current_at_bat'
   ||model.last_play_event_id!==terminal.id||terminal.result!==true||!['result','outcome'].includes(terminal.phase)
   ||terminal.outs!==3||model.situation?.outs!==3||model.situation?.review_pending===true||terminal.review_pending===true
   ||!integer(terminal.period,1,40)||!['top','bottom'].includes(terminal.half)
   ||typeof terminal.at_bat!=='string'||!terminal.at_bat)return null;
  const prefix=model.timeline.slice(0,model.timeline.indexOf(terminal)+1);
  const rows=prefix.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)&&r.result===true
   &&['result','outcome'].includes(r.phase)&&r.period===terminal.period&&r.half===terminal.half
   &&typeof r.id==='string'&&r.id&&prefix.filter(q=>q?.id===r.id).length===1&&text(r.text).trim())
   .slice(-5).map(r=>({id:r.id,text:text(r.text)}));
  if(!rows.length||rows.at(-1).id!==terminal.id)return null;
  const teams=Array.isArray(model.teams)?model.teams:[],away=teams.find(t=>t?.side==='away'),home=teams.find(t=>t?.side==='home');
  const score=integer(terminal.away,0,100)&&integer(terminal.home,0,100)
   ?[text(away?.abbreviation,12)||'Away',terminal.away,'–',terminal.home,text(home?.abbreviation,12)||'Home'].join(' '):null;
  return {key:JSON.stringify([model.event_id,terminal.period,terminal.half,terminal.at_bat,terminal.id,text(terminal.text)]),
   eventId:model.event_id,period:terminal.period,half:terminal.half,atBat:terminal.at_bat,terminalId:terminal.id,
   title:'End '+(terminal.half==='top'?'Top':'Bottom')+' '+terminal.period,rows,score};
 }
 function advanceInningRecap(model, retained, now) {
  const recap=releasedInningRecap(model);
  const proof=(m,r)=>JSON.stringify([m.timeline.at(-1),{...m.summary,scope:'current_at_bat'},r]);
  if(recap){
   const originalProof=proof(model,recap);
   return {...recap,originalProof,showAt:retained?.key===recap.key&&retained.originalProof===originalProof?retained.showAt:now+INNING_RECAP_AFTER_MS};
  }
  // Retention cannot create a recap. The mount resets it on every owner/epoch
  // boundary; only an unchanged, already qualified third out may survive here.
  const selected=releasedRecapSelection(model);
  if(!retained||!model||!Number.isFinite(retained.showAt)||typeof retained.originalProof!=='string'
   ||model.event_id!==retained.eventId||!selected||model.timeline.at(-1)!==selected
   ||model.summary?.completed!==true||!['current_at_bat','previous_at_bat'].includes(model.summary?.scope)
   ||model.last_play_event_id!==retained.terminalId||model.situation?.outs!==3||model.situation?.review_pending===true)return null;
  const matches=model.timeline.filter(r=>r?.id===retained.terminalId);
  if(matches.length!==1)return null;
  const terminal=matches[0],index=model.timeline.indexOf(terminal),suffix=model.timeline.slice(index+1);
  if(terminal.revision!=null||!suffix.length)return null;
  let sequence=terminal.sequence;
  for(const row of suffix){
   if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id
    ||model.timeline.filter(r=>r?.id===row.id).length!==1||row.pitch!==false||row.result!==false
    ||row.in_play===true||row.review_pending===true||row.revision!=null||row.outs!==3
    ||row.period!==retained.period||row.half!==retained.half||typeof row.at_bat!=='string'||!row.at_bat
    ||!Number.isSafeInteger(sequence)||!Number.isSafeInteger(row.sequence)||row.sequence<=sequence)return null;
   const admin=row.phase==='action'&&(row.type==='Mound Visit'||row.action?.kind==='substitution'
    &&['pinch_hitter','pinch_runner','defensive','pitching_change'].includes(row.action?.substitution?.kind));
   if(!admin&&!['inning_end','at_bat_start'].includes(row.phase))return null;
   sequence=row.sequence;
  }
  // Rebuild only the stored proof, never eligibility from a commercial or a
  // previous-at-bat summary alone. A correction/withdrawal clears the deadline.
  const prior={...model,selected_event_id:terminal.id,timeline:model.timeline.slice(0,index+1),summary:{...model.summary,scope:'current_at_bat'}};
  const confirmed=releasedInningRecap(prior);
  return confirmed&&proof(prior,confirmed)===retained.originalProof?retained:null;
 }
 // Oct 15 (TV248 parity): next three hitters for the team coming to bat. Slots come from the box score; the last
 // batter of that team comes from presented timeline rows only, so nothing beyond the viewer's picture is used.
 function recapLeadingName(value){const first=String(value||'').split(/(?<=[.!?])\s/)[0]||'';const out=[];
  for(const w of first.split(/\s+/)){if(!w)break;if(/^\p{Lu}/u.test(w)||/^(jr\.?|sr\.?|ii|iii|iv|de|la|del)$/i.test(w))out.push(w);else break;}return out.join(' ');}
 function dueUpFromBox(model,recap,box){
  if(!recap||!box||!Array.isArray(box.players)||!Array.isArray(model?.teams)||!Array.isArray(model?.timeline))return null;
  const endedTop=recap.half==='top',nextHalf=endedTop?'bottom':'top',nextInning=endedTop?recap.period:recap.period+1;
  const team=model.teams.find(t=>t?.side===(nextHalf==='top'?'away':'home'));if(!team||team.id==null)return null;
  const block=box.players.find(p=>String(p?.team_id)===String(team.id));if(!block)return null;
  const norm=v=>String(v||'').normalize('NFD').replace(/\p{M}+/gu,'').toLowerCase().replace(/[^a-z ]/g,'').trim();
  const bySlot=new Map(),slotOf=new Map();
  for(const g of Array.isArray(block.groups)?block.groups:[])for(const a of Array.isArray(g?.athletes)?g.athletes:[]){
   const o=a?.order;if(!Number.isInteger(o)||o<1||o>9||typeof a.name!=='string'||!a.name)continue;bySlot.set(o,a);slotOf.set(norm(a.name),o);}
  if(bySlot.size<9)return null;
  const rows=model.timeline.filter(r=>r&&r.half===nextHalf);
  let last=null;for(let i=rows.length-1;i>=0&&!last;i--){const t=String(rows[i].text||''),m=/^(.+?) pitches to (.+)$/.exec(t);last=m?m[2]:rows[i].result===true?recapLeadingName(t)||null:null;}
  let start;if(nextInning===1&&!rows.some(r=>typeof r.at_bat==='string'&&r.at_bat))start=1;else{const slot=last?slotOf.get(norm(last)):undefined;if(!slot)return null;start=slot%9+1;}
  const hitters=[0,1,2].map(i=>(start-1+i)%9+1).map(slot=>{const p=bySlot.get(slot);return p?{slot,name:p.name,headshot:typeof p.headshot==='string'&&p.headshot.startsWith('https://a.espncdn.com/')?p.headshot:null}:null;}).filter(Boolean);
  if(hitters.length<3)return null;
  const n=nextInning,ord=n+(n%100>=11&&n%100<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th');
  return {title:(nextHalf==='top'?'Top ':'Bottom ')+ord,team:String(team.name||''),hitters};
 }
 function inningRecapCard(recap,due) {
  const card=node('section','otv-baseball-card otc-glass obc-compact obc-stage-layout');
  card.dataset.inningRecap='true';card.setAttribute('aria-label',recap.title+' inning recap');
  const people=node('div','obc-players'),person=node('div','obc-person'),copy=node('div','obc-person-copy');
  copy.append(node('strong','',recap.title),node('span','',recap.score?'Reported score · '+recap.score:'Reported score unavailable'));
  person.append(copy);people.append(person);card.append(people);
  const main=node('div','obc-main'),results=node('div','obc-result-area');
  if(due){const box=node('div','obc-due-up');box.style.marginBottom='8px';
   box.append(node('small','obc-label','Due up · '+due.title));
   for(const h of due.hitters){const line=node('p','obc-result obc-due-row');line.style.display='flex';line.style.alignItems='center';line.style.gap='8px';
    const slot=node('span','obc-due-slot',String(h.slot));slot.style.minWidth='14px';slot.style.opacity='.7';line.append(slot);
    if(h.headshot){const img=document.createElement('img');img.className='obc-due-shot';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=h.headshot;
     Object.assign(img.style,{width:'26px',height:'26px',borderRadius:'50%',objectFit:'cover',background:'rgba(255,255,255,.18)'});line.append(img);}
    line.append(node('strong','',h.name));box.append(line);}
   results.append(box);}
  results.style.gridColumn='1 / -1';results.append(node('small','obc-label','Last released results'));
  for(const row of due?recap.rows.slice(-3):recap.rows){const line=node('p','obc-result',row.text);line.dataset.eventId=row.id;results.append(line);}
  main.append(results);card.append(main);return card;
 }

 function mount(container, {onManual, onClose, getActorMetadata, getBox} = {}) {
  let footballOwner=null;
  if (!container?.replaceChildren) throw TypeError('Presentation container required');
  let disposed = false, currentCard = null, controlsOpen = false, boundary = null, selection = null, motion = null;
  let wakeTimer=null,wakeFrame=null,wakeOwner=null,latest=null;
  let review=null,historyPitch=null;
  // r4: close-up catcher is the default view (the owner).
  let cameraPreference={preset:'catcher-close',yaw:0,pitch:0},cameraControlsOpen=false,detachCamera=()=>{};
  try{const saved=localStorage.getItem('orbital-pitch-camera-v1');if(['catcher-close','catcher','wide-catcher','umpire','side','pitcher','free'].includes(saved))cameraPreference.preset=saved;}catch{}
  function bindPitchCamera(card,scene){
   if(typeof scene?.__setPitchCamera!=='function')return;
   const presets=[['catcher-close','Close'],['catcher','Catcher'],['wide-catcher','Wide'],['umpire','Umpire'],['side','Side'],['pitcher','Pitcher'],['free','Rotate']];
   const controls=node('details','obc-camera-controls'),toggle=node('summary','obc-camera-toggle'),choices=node('div','obc-camera-choices'),help=node('small','obc-camera-help');
   toggle.setAttribute('aria-label','Pitch camera view');controls.open=cameraControlsOpen;
   const current=()=>!disposed&&currentCard===card;
   const buttons=[];
   const sync=()=>{
    const label=presets.find(([id])=>id===cameraPreference.preset)?.[1]||'Catcher';
    toggle.textContent='View · '+label;
    for(const [id,b] of buttons)b.setAttribute('aria-pressed',String(id===cameraPreference.preset));
    const free=cameraPreference.preset==='free';
    scene.dataset.cameraInteractive=String(free);scene.setAttribute('tabindex',free?'0':'-1');
    const shown=[...card.querySelector('.obc-main').querySelectorAll('.gc2-flight-svg')].includes(scene);
    help.textContent=!shown?'Selected pitch view applies to the next pitch':free?'Drag the pitch view · arrow keys rotate':'Camera changes preserve the reported pitch path';
   };
   const remember=()=>{const s=scene.__getPitchCameraState?.();if(s)cameraPreference={preset:s.preset,yaw:s.yaw,pitch:s.pitch};try{localStorage.setItem('orbital-pitch-camera-v1',cameraPreference.preset);}catch{}sync();};
   if(scene.__getPitchCameraState?.().preset!==cameraPreference.preset)scene.__setPitchCamera(cameraPreference.preset,{immediate:true});
   if(cameraPreference.preset==='free'){
    const s=scene.__getPitchCameraState(),dx=cameraPreference.yaw-s.yaw,dy=cameraPreference.pitch-s.pitch;if(Math.abs(dx)+Math.abs(dy)>1e-9)scene.__rotatePitchCamera(dx,dy,{immediate:true});
   }
   for(const [id,label] of presets){
    const b=node('button','obc-camera-choice',label);b.type='button';b.dataset.cameraPreset=id;
    b.setAttribute('aria-label',id==='catcher-close'?'Close-up catcher view':id==='wide-catcher'?'Wide catcher view':id==='umpire'?'Taller umpire view':id==='free'?'Rotate pitch view freely':label+' view');
    b.onclick=e=>{e?.stopPropagation?.();if(!current())return;stop();scene.__setPitchCamera(id);remember();};
    buttons.push([id,b]);choices.append(b);
   }
   controls.append(toggle,choices,help);card.querySelector('.obc-main').append(controls);
   controls.addEventListener?.('toggle',()=>{if(current())cameraControlsOpen=controls.open;});
   let drag=null;
   const stop=()=>{if(drag){const id=drag.id;drag=null;try{scene.releasePointerCapture?.(id);}catch{}}};
   const down=e=>{if(!current()||cameraPreference.preset!=='free'||e.button!==0||e.isPrimary===false)return;e.preventDefault();e.stopPropagation();stop();drag={id:e.pointerId,x:e.clientX,y:e.clientY};try{scene.setPointerCapture?.(e.pointerId);}catch{}scene.focus?.({preventScroll:true});};
   const move=e=>{if(!drag||e.pointerId!==drag.id||!current()||cameraPreference.preset!=='free')return;e.preventDefault();e.stopPropagation();const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;scene.__rotatePitchCamera(dx*.35,-dy*.35,{immediate:true});remember();};
   const up=e=>{if(drag&&e.pointerId===drag.id)stop();};
   const key=e=>{if(!current()||cameraPreference.preset!=='free')return;const n=e.shiftKey?15:5,d={ArrowLeft:[-n,0],ArrowRight:[n,0],ArrowUp:[0,n],ArrowDown:[0,-n]}[e.key];if(d){e.preventDefault();e.stopPropagation();scene.__rotatePitchCamera(...d,{immediate:true});remember();}else if(e.key==='Escape')stop();};
   for(const [name,handler] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['keydown',key]])scene.addEventListener?.(name,handler);
   const preferenceChanged=()=>{if(!current())return;try{const saved=localStorage.getItem('orbital-pitch-camera-v1');if(presets.some(([id])=>id===saved)){stop();scene.__setPitchCamera(saved);remember();}}catch{}};window.addEventListener('orbitalpitchcamera',preferenceChanged);
   detachCamera=()=>{window.removeEventListener('orbitalpitchcamera',preferenceChanged);stop();for(const [name,handler] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['keydown',key]])scene.removeEventListener?.(name,handler);};
   sync();
  }
  const stopReview=()=>{review?.node?.__disposePitchScene?.();review=null;};
  const state={played:new Set(),seen:new Set(),park:null,flight:null,visual:null,pitch:null,contact:null,wakeAt:null,recap:null,resultRevealed:null,resultRevealedPitch:null,modelOrder:0,localReview:false};
  const cancelWake=()=>{wakeOwner=null;if(wakeTimer!==null)clearTimeout(wakeTimer);if(wakeFrame!==null&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(wakeFrame);wakeTimer=null;wakeFrame=null;};
  const resetAnimation=()=>{cancelWake();stopReview();historyPitch=null;boundary=null;selection=null;motion=null;state.flight?.__disposePitchScene?.();state.park?.node?.__disposeFieldScene?.();state.flight=null;state.park=null;state.visual=null;state.pitch=null;state.contact=null;state.zoneMicro=null;state.wakeAt=null;state.recap=null;state.resultRevealed=null;state.resultRevealedPitch=null;state.modelOrder=0;state.played.clear();state.seen.clear();};
  const clear = () => { detachCamera();detachCamera=()=>{}; const cameraMenu=currentCard?.querySelector('.obc-camera-controls');if(cameraMenu)cameraControlsOpen=cameraMenu.open; if (currentCard) { const controls = currentCard.querySelector('.obc-compact-controls'); if (controls) controlsOpen = controls.open; currentCard.querySelectorAll('button').forEach(b => { b.onclick = null; }); } currentCard = null; container.replaceChildren(); };
  function render(model, envelope = null) {
   if (disposed) return;
   if(model?.kind==='football'){
    if(!footballOwner){resetAnimation();clear();footballOwner=root.OrbitalFootballValueCard.mount(container,{onClose,onManual,legacy:{drive:fbDrive,clock:fbClock,picture:fbPictureVisible,expanded:football}});}
    latest={model,envelope};footballOwner.render(model,envelope);return;
   }
   if(footballOwner){footballOwner.dispose();footballOwner=null;}

   const previousAdmin=currentCard?.querySelector('.obc-review-admin-pane');
   const adminScroll=review&&previousAdmin?.__orbitalReviewOwner===review?{review,event:latest?.model?.event_id,selected:selection,copy:previousAdmin.textContent,top:previousAdmin.scrollTop,left:previousAdmin.scrollLeft}:null;
   cancelWake();state.wakeAt=null;latest={model,envelope};
   const focused=currentCard?.contains?.(document.activeElement)?document.activeElement:null;
   const focusHint=focused?{tag:focused.tagName,label:focused.getAttribute('aria-label'),pitch:focused.dataset?.pitchId,live:focused.classList?.contains('obc-review-live'),admin:focused.classList?.contains('obc-review-admin-pane')}:null;
   clear();
   if (!model) {resetAnimation();return;}
   if (typeof model !== 'object' || !model.event_id) throw TypeError('Admitted server presentation model required');
   const nextBoundary=envelope?JSON.stringify(['event','channel','session','play_session','scope_sha256','media_epoch','presentation_instance'].map(k=>envelope[k])):null;
   const sameBoundary=boundary===nextBoundary&&boundary!==null;
   if(!sameBoundary){resetAnimation();boundary=nextBoundary;}
   const selected=typeof model.selected_event_id==='string'?model.selected_event_id:'';
   if(selected!==selection){selection=selected;motion=null;}
   const admissibleAnimation=(hint,selected,m)=>hint===selected||(!!m&&m.kind==='baseball'&&(m.summary?.completed===true||m.summary?.scope==='previous_at_bat')&&Array.isArray(m.plays)&&m.plays.at(-1)?.id===hint&&Array.isArray(m.timeline)&&m.timeline.some(r=>r&&r.id===hint&&r.pitch===true&&r.in_play===true&&r.result===false));
   const hint=typeof envelope?.animation_event_id==='string'&&envelope.animation_event_id.length<=160&&admissibleAnimation(envelope.animation_event_id,selected,model)?envelope.animation_event_id:'';
   if(sameBoundary&&hint&&!state.seen.has(hint))motion={id:hint,startedAt:performance.now(),pitchId:'',field:false,initialized:false};
   for(const id of [selected,...['plays','timeline','actions'].flatMap(k=>Array.isArray(model[k])?model[k].map(row=>row?.id):[])])if(typeof id==='string'&&id.length>0&&id.length<=350)state.seen.add(id);
   while(state.seen.size>4096)state.seen.delete(state.seen.values().next().value);
   const now=performance.now();state.recap=advanceInningRecap(model,state.recap,now);
   const showRecap=!!state.recap&&now>=state.recap.showAt;
   if(showRecap){stopReview();state.flight?.__disposePitchScene?.();state.park?.node?.__disposeFieldScene?.();state.flight=null;state.park=null;state.visual=null;state.wakeAt=null;}
   const pitches=model.kind==='baseball'&&!showRecap?releasedPitchHistory(model):[],last=pitches.at(-1)?.id||null;
   if(model.kind==='baseball'&&!showRecap){
    if(last!==historyPitch){stopReview();historyPitch=last;}
    if(review){const row=pitches.find(p=>p.id===review.id);if(!row||reviewFact(row)!==review.fact||!reviewGeometry(model,row))stopReview();}
   }else{stopReview();historyPitch=null;}
   state.localReview=!!review;
   state.actorMetadata=null;try{if(model.kind==='baseball'&&typeof getActorMetadata==='function')state.actorMetadata=getActorMetadata(model);}catch{}
   let due=null,boxNow=null;if(model.kind==='baseball'&&typeof getBox==='function'){try{boxNow=getBox();}catch{boxNow=null;}}
   if(boxNow&&Number.isFinite(boxNow.fetched_at)){const ring=state.boxes||(state.boxes=[]);if(!ring.some(b=>b.fetched_at===boxNow.fetched_at)){ring.push(boxNow);ring.sort((a,b)=>a.fetched_at-b.fetched_at);if(ring.length>40)ring.shift();}}
   if(showRecap&&boxNow){try{due=dueUpFromBox(model,state.recap,boxNow);}catch{due=null;}}
   const card = showRecap ? inningRecapCard(state.recap,due) : model.kind === 'baseball' ? baseball(model,motion,state,{review:!!review}) : model.kind === 'football' ? football(model,{picture:envelope?.football_picture_receipt}) : node('section', 'otc-card otc-glass', 'Game information unavailable');
   if(model.kind==='football'&&fbPictureVisible(model,envelope?.football_picture_receipt,performance.now()))state.wakeAt=envelope.football_picture_receipt.deadline;
   if(state.recap&&!showRecap)state.wakeAt=Number.isFinite(state.wakeAt)?Math.min(state.wakeAt,state.recap.showAt):state.recap.showAt;
   if(motion)motion.initialized=true;
   if(model.kind==='baseball'&&!showRecap){
    if(pitches.length){
     const history=node('div','obc-history');history.setAttribute('aria-label','Last released pitches');
     for(const p of pitches){
      const geometry=reviewGeometry(model,p),button=node('button','obc-history-pitch');button.type='button';
      button.dataset.pitchId=p.id;button.dataset.live=p.id===last?'true':'false';button.dataset.active=(review?review.id===p.id:p.id===last)?'true':'false';
      button.setAttribute('aria-pressed',button.dataset.active);button.disabled=!geometry;
      const identity=pitchChipIdentity(p.pitch_type),mph=pitchSpeed(p),name=node('span','obc-history-name');
      button.dataset.pitchType=identity.key;button.style.setProperty('--pitch-chip-color',identity.color);
      const label='Pitch '+pitchNumber(p)+', '+identity.full+(mph!==null?', '+mph.toFixed(1)+' mph':', speed unavailable');
      button.setAttribute('aria-label',label+(geometry?', replay retained pitch flight':', geometry unavailable'));button.setAttribute('title',label);
      for(const line of identity.lines)name.append(node('span','',line));
      button.append(node('b','obc-history-number',pitchNumber(p)),name,node('small','obc-history-speed',mph!==null?mph.toFixed(1):'—'));
      button.onclick=()=>{if(disposed||currentCard!==card||!latest||!geometry)return;stopReview();review={id:p.id,fact:reviewFact(p),startedAt:performance.now(),node:null};render(latest.model,latest.envelope);};
      history.append(button);
     }
     card.append(history);
    }
    if(review){
     const row=pitches.find(p=>p.id===review.id),q=reviewGeometry(model,row),main=card.querySelector('.obc-main');
     const limits={top:q.zone_top_ft,bottom:q.zone_bottom_ft};
     if(!review.node){review.node=root.OrbitalGc2.flightSvg([{...q,current:true,animateGuide:!q.measured,startedAt:review.startedAt}],limits,null,126,126);review.node.classList.add('otv-card-field');}
     const layer=node('div','obc-local-review'),caption=node('div','obc-review-caption'),live=node('button','obc-review-live','Live');live.type='button';
     layer.append(review.node);caption.append(node('strong','','Replay · Pitch '+pitchNumber(row)),node('span','',[(text(row.pitch_type,80)||''),pitchSpeed(row)!==null?pitchSpeed(row).toFixed(1)+' mph':''].filter(Boolean).join(' · ')),live);
     live.onclick=()=>{if(disposed||currentCard!==card||!latest)return;stopReview();render(latest.model,latest.envelope);};
     main.querySelector('.obc-zone').style.visibility='hidden';
     const resultArea=main.querySelector('.obc-result-area');
     if(releasedSubstitution(model)){
      resultArea.classList.add('obc-review-context-dock');
      const adminCopy=resultArea.querySelector('.obc-pitch');
      adminCopy.classList.add('obc-review-admin-pane');adminCopy.__orbitalReviewOwner=review;adminCopy.tabIndex=0;adminCopy.setAttribute('role','region');adminCopy.setAttribute('aria-label','Game update during replay');
      resultArea.prepend(caption);main.append(layer);
     }else{resultArea.style.visibility='hidden';main.append(layer,caption);}
     card.dataset.localReview='true';
    }
   }
   if(model.kind==='baseball'&&!showRecap)bindPitchCamera(card,review?.node||state.flight);
   const footer = node('div', 'otc-footer');
   const playerSettings=node('button','otc-action','Player settings');playerSettings.type='button';playerSettings.onclick=()=>window.TelevisionSportsPlayerUi?.openSettings?.();footer.append(playerSettings);
   if (typeof onManual === 'function') for (const [label, nudge] of [['Earlier', -1], ['Later', 1]]) {
    const button = node('button', 'otc-action', label); button.type = 'button';
    button.setAttribute('aria-label', label + ' game information by one second');
    button.onclick = () => { if (!disposed && currentCard === card) onManual({nudge_s: nudge}); }; footer.append(button);
   }
   if (typeof onClose === 'function') {
    const button = node('button', 'otc-action', 'Hide'); button.type = 'button';
    button.setAttribute('aria-label', 'Hide tracker'); button.onclick = () => { if (!disposed && currentCard === card) onClose(); }; footer.append(button);
   }
   const settingsButton=node('button','otc-action obc-settings-button','Settings');settingsButton.type='button';settingsButton.setAttribute('aria-label','Tracker settings');settingsButton.onclick=()=>window.TelevisionSportsPlayerUi?.openSettings?.();
   (card.querySelector('.obc-players')||card).append(settingsButton);
   const readout = node('div', 'otc-sync-status'); readout.append(node('small', '', status(model)));
   if (card.classList.contains('obc-stage-layout')) footer.append(readout); else card.append(readout);
   currentCard = card; container.append(card);
   const nextAdmin=card.querySelector('.obc-review-admin-pane');
   if(adminScroll&&review===adminScroll.review&&sameBoundary&&model.event_id===adminScroll.event&&selected===adminScroll.selected&&nextAdmin?.textContent===adminScroll.copy){nextAdmin.scrollTop=adminScroll.top;nextAdmin.scrollLeft=adminScroll.left;}
   if(focusHint){
    const restore=(final=false)=>{
     if(disposed||currentCard!==card||(document.activeElement!==document.body&&document.activeElement!==focused))return;
     const choices=[...card.querySelectorAll('button'),...card.querySelectorAll('summary'),...card.querySelectorAll('.obc-review-admin-pane')];
     const target=choices.find(n=>focusHint.pitch?n.dataset?.pitchId===focusHint.pitch:focusHint.live?n.classList.contains('obc-review-live'):focusHint.admin?n.classList.contains('obc-review-admin-pane'):focusHint.tag==='SUMMARY'?n.tagName==='SUMMARY':focusHint.label&&n.getAttribute('aria-label')===focusHint.label);
     if(!target&&!final&&!focusHint.pitch&&!focusHint.live&&focusHint.tag==='BUTTON'&&typeof requestAnimationFrame==='function'){
      requestAnimationFrame(()=>requestAnimationFrame(()=>restore(true)));return;
     }
     (target||card.querySelector('summary'))?.focus?.({preventScroll:true});
    };
    // The owner schedules placement controls from its observer on a later animation frame.
    if(typeof queueMicrotask==='function')queueMicrotask(()=>restore());else restore();
   }
   if(Number.isFinite(state.wakeAt)){
    const pending=latest,deadline=state.wakeAt,owner={};wakeOwner=owner;
    const owns=()=>!disposed&&latest===pending&&wakeOwner===owner;
    const settle=()=>{if(!owns()||performance.now()<deadline)return false;cancelWake();render(pending.model,pending.envelope);return true;};
    const onTimer=()=>{if(!owns())return;wakeTimer=null;if(!settle())armTimer();};
    const armTimer=()=>{wakeTimer=setTimeout(onTimer,Math.max(1,Math.ceil(state.wakeAt-performance.now())));};
    const onFrame=()=>{if(!owns())return;wakeFrame=null;if(!settle())wakeFrame=requestAnimationFrame(onFrame);};
    armTimer();if(typeof requestAnimationFrame==='function')wakeFrame=requestAnimationFrame(onFrame);
   }
  }
  return Object.freeze({render, quietFootball(reason){footballOwner?.quiet(reason);}, clear() { if (!disposed) {footballOwner?.dispose();footballOwner=null;latest=null;resetAnimation();clear();} }, dispose() { if (disposed) return; disposed = true; footballOwner?.dispose();footballOwner=null;latest=null;resetAnimation();clear(); }});
 }
 const api = Object.freeze({mount});
 if (typeof module !== 'undefined' && module.exports) module.exports = api;
 else root.OrbitalServerPresentationRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis);


/* Isolated schema2 module: bootstrap.js */
/* Explicit activation against the isolated neutral-HUD successor only. */
/* public build: a private provider module is not included here. */


/* Isolated schema2 module: auto-activate.js */
/* Current watched game, generic thin HTTP owner. No client game-time estimator. */
/* public build: a private provider module is not included here. */

/* Source-backed team directory and final-game exploration. No playback operations. */
(function(win){
'use strict';
const doc=win.document;
const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
const leagues=['College football','NFL','MLB','NBA','WNBA','NHL','MLS'];
function sheet(title,trigger){
 const d=el('dialog','oe-sheet');d.setAttribute('aria-label',title);
 const h=el('header'),heading=el('h2','',title),close=el('button','oe-chip','Close');close.type='button';close.onclick=()=>d.close();h.append(heading,close);d.append(h);
 d.addEventListener('close',()=>{d.remove();if(trigger?.isConnected)trigger.focus();});doc.body.append(d);d.showModal();close.focus();return d;
}
function select(label,values){const wrap=el('label','oe-select',label),s=el('select');s.setAttribute('aria-label',label);for(const [value,name] of values){const o=el('option','',name);o.value=value;s.append(o);}wrap.append(s);return [wrap,s];}
function teams(api,trigger){
 const owner=api.getCurrentUserId(),d=sheet('Teams',trigger),bar=el('div','oe-bar'),[lw,league]=select('League',leagues.map(x=>[x,x])),[gw,group]=select('Conference or division',[['','All groups']]),query=el('input'),status=el('p','oe-muted'),body=el('div','oe-teams');
 query.type='search';query.placeholder='Find any team';query.setAttribute('aria-label','Find any team');bar.append(lw,gw,query);d.append(bar,status,body);let serial=0,data=null;
 const current=()=>d.isConnected&&api.getCurrentUserId()===owner;
 function paint(){if(!current()||!data)return;body.replaceChildren();let count=0;for(const g of data.groups||[]){if(group.value&&group.value!==g.name)continue;const rows=(g.teams||[]).filter(t=>(t.name+' '+t.abbr).toLowerCase().includes(query.value.toLowerCase()));if(!rows.length)continue;body.append(el('h3','',g.name));const grid=el('div','oe-grid');for(const t of rows){const a=el('a','oe-team');a.href='#/movies?orbitalBrowse='+encodeURIComponent('team:'+t.key);a.onclick=e=>{e.preventDefault();const target=a.hash;d.close();win.location.hash=target;};if(window.OrbitalArtwork.url(t.logo)){const i=el('img');i.src=t.logo;i.alt='';i.loading='lazy';a.append(i);}const copy=el('div');copy.append(el('strong','',(t.rank?'#'+t.rank+' ':'')+t.name),el('p','oe-muted',[t.record,t.conference_record?'Conference '+t.conference_record:null,t.streak,t.points_for?'For '+t.points_for:null,t.points_against?'Against '+t.points_against:null].filter(Boolean).join(' · ')));a.append(copy);grid.append(a);count++;}body.append(grid);}status.textContent=count+' teams'+(data.scope==='FBS'?' · FBS standings':data.scope==='College directory'?' · College directory':'')+(data.directory_unavailable?' · Broader directory unavailable':'')+(data.stale?' · Saved standings':'');if(!count)body.append(el('p','','No teams match these filters.'));}
 async function load(){const n=++serial;data=null;body.replaceChildren();status.textContent='Loading teams…';try{const chosen=league.value;const [standing,directory]=await Promise.allSettled([api.getJSON(api.getUrl('sports/api/team-hub',{league:chosen})),chosen==='College football'?api.getJSON(api.getUrl('sports/api/team-directory',{league:chosen})):Promise.resolve(null)]);if(standing.status!=='fulfilled'&&directory.status!=='fulfilled')throw Error();const r=standing.status==='fulfilled'?{...standing.value,groups:[...(standing.value.groups||[])]}:{groups:[]};if(directory.status==='fulfilled'&&directory.value?.teams){const known=new Set(r.groups.flatMap(g=>g.teams||[]).map(t=>t.key));const extra=directory.value.teams.filter(t=>typeof t.key==='string'&&t.key.startsWith(chosen+'~')&&!known.has(t.key)).map(t=>({...t,logo:t.logos?.[0]}));if(extra.length)r.groups.push({name:'Other college teams',teams:extra});r.scope='College directory';}else if(chosen==='College football')r.directory_unavailable=true;if(!current()||n!==serial)return;data=r;group.replaceChildren();for(const name of ['',...(r.groups||[]).map(g=>g.name)]){const o=el('option','',name||'All groups');o.value=name;group.append(o);}paint();}catch{if(current()&&n===serial){status.textContent='Teams unavailable. Try again.';const retry=el('button','oe-chip','Retry');retry.onclick=load;body.append(retry);}}}
 league.onchange=load;group.onchange=paint;query.oninput=paint;load();
}
function explorer(dialog,event,api){
 if(event.state!=='final'||dialog.querySelector('.oe-explore'))return;
 const owner=api.getCurrentUserId(),button=el('button','oe-chip oe-explore','Explore periods and plays');button.type='button';
 button.onclick=async()=>{const d=sheet('Game breakdown',button),status=el('p','oe-muted','Loading game details…');d.append(status);const current=()=>d.isConnected&&api.getCurrentUserId()===owner;try{
 const data=await api.getJSON(api.getUrl('sports/api/game-explorer',{league:event.league,event:event.id}));if(!current())return;
 const [pw,period]=select(data.kind==='baseball'?'Inning':'Period',[['','Whole game'],...(data.periods||[]).map(p=>[String(p.n),p.label+' · '+(p.away??'—')+' – '+(p.home??'—')])]);const content=el('div');d.append(pw,content);status.textContent=[data.status,'Reported play-by-play'].filter(Boolean).join(' · ');
 function paint(){content.replaceChildren();const selected=period.value;const stats=selected?data.stats?.[selected]:null;if(stats){for(const [team,values] of Object.entries(stats)){const title=(data.teams||[]).find(t=>String(t.id)===team)?.name;if(!title)continue;const line=Object.entries(values).filter(([,v])=>v!=null).map(([k,v])=>k.replaceAll('_',' ')+': '+v).join(' · ');if(line)content.append(el('p','oe-muted',title+' · '+line));}}
 let count=0;for(const unit of data.units||[]){const plays=(unit.plays||[]).filter(p=>!selected||String(p.period)===selected);if(selected&&String(unit.period)!==selected&&!plays.length)continue;const detail=el('details','oe-unit'),summary=el('summary','',[unit.label,unit.result,unit.summary].filter(Boolean).join(' · '));detail.append(summary);for(const p of plays){const row=el('p','oe-play');row.append(el('strong','',[p.clock,p.situation].filter(Boolean).join(' · ')),el('span','',p.text));detail.append(row);}if(!plays.length)detail.append(el('p','oe-muted','No play details were supplied for this segment.'));content.append(detail);count++;}if(!count)content.append(el('p','oe-muted','No play-by-play details were supplied for this period.'));}period.onchange=paint;paint();
 }catch{if(current())status.textContent='Game details unavailable. Close and try again.';}};
 (dialog.querySelector('.otv-game-topline')||dialog).append(button);
}
const style=el('style');style.textContent=`.oe-sheet{width:min(1050px,92vw);max-height:88vh;overflow:auto;border:1px solid #33465b;border-radius:18px;background:#0b1422;color:#f1f5f9;padding:24px}.oe-sheet::backdrop{background:#000a}.oe-sheet header,.oe-bar{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.oe-sheet header{justify-content:space-between}.oe-chip,.oe-select select,.oe-bar input{font:inherit;min-height:44px;border:1px solid #40556b;border-radius:10px;padding:8px 14px;background:#17263a;color:inherit}.oe-chip{cursor:pointer}.oe-select{display:flex;flex-direction:column;gap:6px;margin:12px 0}.oe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.oe-team{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid #273b51;border-radius:12px;color:inherit;text-decoration:none;background:#112033}.oe-team img{width:52px;height:52px;object-fit:contain}.oe-muted{color:#aebed0;font-size:14px;line-height:1.5}.oe-unit{margin:10px 0;border:1px solid #31465b;border-radius:10px;padding:14px}.oe-unit summary{cursor:pointer;min-height:28px;font-weight:600}.oe-play{display:grid;gap:6px;border-top:1px solid #24364a;padding:12px 0;line-height:1.5}.oe-sheet :focus-visible{outline:3px solid #c6f576;outline-offset:3px}.otv-board-tracker svg.otv-card-field{width:100%!important;height:180px!important;max-height:none!important}.otv-board-tracker{display:flex!important;flex-direction:column!important;align-items:stretch!important}.oe-explore{margin:12px 0}`;doc.head.append(style);
style.textContent+=' .oe-sheet{box-sizing:border-box;font-family:Arial,sans-serif}';
win.OrbitalSportsExplore={teams,explorer};
})(window);

/* Expanded controls retain the existing eligibility and freshness rules. */
