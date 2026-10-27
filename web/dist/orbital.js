/* Orbital for Jellyfin, public web edition. Picture-timed sync is not included; trackers use the estimated delay and Sync. */
/* Public tracker clock: estimated delay and user adjustments only. */
(function(root){
 'use strict';
 const noop=()=>{}, empty=()=>null;
 function create({safe=30}={}){
  let delay=safe,manual=false,last=null,source=null,pausedAt=null;
  return {
   reset(){delay=safe;manual=false;last=null;source=null;pausedAt=null;},
   setManual(seconds){if(Number.isFinite(seconds)){delay=Math.max(1,Math.min(600,seconds));manual=true;last=null;}},
   sample(input){
    if(!Number.isFinite(input.now))return {display_ready:false,mode:'estimated'};
    if(source!==input.source){if(source!==null){delay=safe;manual=false;}source=input.source;last=null;pausedAt=null;}
    if(input.paused&&pausedAt===null)pausedAt=input.now;
    if(!input.paused&&pausedAt!==null){delay+=Math.max(0,input.now-pausedAt);pausedAt=null;}
    const cutoff=input.paused&&last!==null?last:input.now-delay;last=cutoff;
    return {cutoff,hold:Math.max(0,input.now-cutoff),display_ready:Number.isFinite(cutoff),common_ready:false,
     reference_estimate:true,estimated:true,manual,mode:manual?'manual':'estimated',
     display_label:manual?'Manually adjusted · estimated timing':'Estimated timing',live_verified:false};
   }
  };
 }
 root.OrbitalTrackerLifecycle={create,soccerPeriodLabel:p=>({1:'First half',2:'Second half',3:'Extra time',4:'Extra time',5:'Penalties'}[p]||''),soccerSelection:empty};
 root.OrbitalViewerAlignment={
  create:()=>({reset:noop,suspend:noop,adjust:noop,automatic:noop,measurements:()=>({})}),
  createExposureSchedule:()=>({reset:noop,compile:()=>false,evaluate:empty,diagnostics:empty}),
  createDisplayContext:()=>({reset:noop,adjust:noop,automatic:noop,manualSelection:empty,match:()=>false,status:()=>({label:'Estimated timing'}),view:v=>v}),
  historicalSnapshot:v=>v
 };
 root.OrbitalFramePaint={attach:()=>({dispose:noop,snapshot:empty,coordinate:empty,history:()=>[],check:empty})};
})(window);

/* Passive current-content receipt for native document startup. Never a web navigation gate. */
(function(root,install){
  if(typeof module==='object'&&module.exports)module.exports=install;
  else install(root);
})(typeof window==='object'?window:globalThis,function installPageReadiness(win){
  'use strict';
  if(win.OrbitalPageReady?.version===1)return win.OrbitalPageReady;
  const doc=win.document,H=doc.documentElement,SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
  const now=()=>win.Date.now();
  let owner=null,epoch=0;
  const timers=new Set(),set=(fn,ms)=>{const id=win.setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;};
  const clear=id=>{win.clearTimeout(id);timers.delete(id);};
  const identity=()=>{const api=win.ApiClient;try{return {api,user:String(api?.getCurrentUserId?.()||''),server:api?.serverId?.(),credential:api?.accessToken?.()};}catch{return {api,user:'',server:null,credential:null};}};
  const managed=(hash=win.location.hash)=>{if(win.location.pathname.startsWith('/simple/')||identity().user===SIMPLE)return false;const [p,q='']=hash.split('?'),s=new URLSearchParams(q);if(['#/home','#/movies','#/tv','#/list','#/books','#/boxsets','#/music','#/homevideos','#/musicvideos','#/playlists','#/mixed','#/livetv','#/search','#/mypreferencesmenu','#/mypreferencesdisplay','#/mypreferencescontrols','#/mypreferenceshome','#/mypreferencesplayback','#/mypreferencessubtitles','#/userprofile','#/quickconnect','#/addserver','#/selectserver','#/forgotpassword','#/forgotpasswordpin','#/video','#/queue','#/lyrics'].includes(p))return true;return p==='#/details'&&!!s.get('id');};
  const same=(o,x=identity())=>!!o&&o.api===x.api&&o.user===x.user&&o.server===x.server&&o.credential===x.credential;
  const current=o=>!!o&&owner===o&&managed(o.route)&&win.location.hash===o.route&&same(o);
  const hostFor=hash=>doc.querySelector(hash.split('?')[0]==='#/home'?'#homeTab.is-active':hash.split('?')[0]==='#/movies'?'#moviesPage':'#tvshowsPage, #tvPage');
  const rect=n=>{try{return n?.getBoundingClientRect();}catch{return null;}};
  const laidOut=n=>{const r=rect(n);return !!n?.isConnected&&!!r&&r.width>0&&r.height>0&&win.getComputedStyle(n).display!=='none';};
  const attached=o=>o.host?o.host.isConnected&&o.root?.parentElement===o.host:hostFor(o.route)?.querySelector(':scope > .ob5-browse')===o.root;
  const contentCurrent=o=>current(o)&&o.root?.isConnected&&attached(o)&&useful(o.root,o.firstUseful)&&o.root.dataset.presentable==='true'&&laidOut(o.root)&&(!o.valid||o.valid());
  function useful(root,firstUseful){
    if(typeof firstUseful==='function'){try{return firstUseful()===true;}catch{return false;}}
    if(root?.dataset.phase==='complete')return true;
    if(root?.dataset.phase!=='preview')return false;
    const feature=root.querySelector('.ob5-feature-copy'),heading=feature?.querySelector('h1'),action=feature?.querySelector('a[href]');
    const card=[...root.querySelectorAll('.ob5-card')].find(n=>n.dataset.itemId&&n.querySelector('.ob5-card-title')?.textContent.trim());
    return !!((heading?.textContent.trim()||heading?.querySelector('img')?.alt)&&action||card);
  }
  // Legacy Phone/Orbital transition classes belong to their original fast
  // release handlers. This observer neither adds nor clears those classes.
  function release(){return snapshot().ready;}
  function cancel(){owner?.errorNode?.remove();owner=null;}
  function begin(hash=win.location.hash,force=false){
    if(!managed(hash)){cancel();return null;}
    if(!force&&owner?.route===hash&&same(owner))return owner;
    owner?.errorNode?.remove();
    owner={...identity(),route:hash,epoch:++epoch,phase:'loading',root:null,work:0,valid:null};
    return owner;
  }
  const frame=()=>new Promise(resolve=>win.requestAnimationFrame(resolve));
  async function settledFrames(valid){await frame();if(!valid())return false;await frame();return valid();}
  async function fail(message,ticket=owner){
    if(!current(ticket))return false;
    ticket.work++;ticket.preparing=false;ticket.phase='error';
    // No document-level overlay or timeout. Existing progressive content stays
    // usable. A known committed root may show an ordinary inline manual retry.
    if(ticket.root?.isConnected&&attached(ticket)&&laidOut(ticket.root)){
      ticket.errorNode?.remove();const note=doc.createElement('section');
      note.className='orbital-page-status';note.setAttribute('role','status');
      const text=doc.createElement('p');text.textContent=message||'This section could not finish loading. Please retry.';
      const retry=doc.createElement('button');retry.type='button';retry.textContent='Retry';
      retry.onclick=()=>{if(!current(ticket)||!note.isConnected||!attached(ticket))return;begin(ticket.route,true);win.dispatchEvent(new win.CustomEvent('orbital:page-retry',{detail:{route:ticket.route}}));};
      note.append(text,retry);ticket.root.append(note);ticket.errorNode=note;
    }
    return true;
  }
  function snapshot(){
    const route=win.location.hash,userId=identity().user,base={ready:false,route,userId,stamp:null,kind:managed(route)?'loading':'unmanaged'};
    if(!current(owner))return base;
    const ready=owner.phase==='content'?contentCurrent(owner):owner.phase==='error'&&owner.errorNode?.isConnected&&attached(owner)&&laidOut(owner.errorNode);
    // Cosmetic artwork changes do not revoke native initial readiness.
    // Actual committed owner/root generations rotate epoch/work instead.
    return ready?{...base,ready:true,stamp:owner.epoch+':'+owner.work+':'+owner.phase+':'+owner.route+':'+owner.user,kind:owner.phase}:base;
  }
  function fallbackImage(image){
    const parent=image?.parentElement;if(!parent)return false;
    const heading=image.classList.contains('ob5-title-logo')?parent:null;
    const art=image.closest('.ob5-art'),search=image.closest('.ob5-search-art'),hero=image.closest('.ob5-feature-art');
    const existing=parent.querySelector('.otv-logo-fallback,.otv-team-monogram');
    const label=heading?image.alt:art?.parentElement?.querySelector('.ob5-card-title')?.textContent||image.alt||'Artwork unavailable';
    image.onerror=null;image.onload=null;image.removeAttribute('srcset');image.removeAttribute('src');image.remove();
    if(search)search.classList.add('has-fallback');
    else if(heading)heading.textContent=label||'Featured title';
    else if(art&&!art.querySelector('.ob5-art-fallback')){const text=doc.createElement('span');text.className='ob5-art-fallback';text.textContent=label;art.prepend(text);}
    else if(hero){hero.style.background='linear-gradient(145deg,#243146,#111b29)';hero.setAttribute('aria-hidden','true');}
    else if(existing)existing.hidden=false;
    return true;
  }
  const visible=n=>{const r=rect(n);return !!r&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<win.innerHeight&&r.left<win.innerWidth;};
  // Artwork/fonts settle through the existing renderer and browser. They are
  // enrichment, never blockers for useful current content or tap handling.
  function surfaceCurrent(root,binding={}){
    return same(binding)&&root?.isConnected&&(!binding.host||root.parentElement===binding.host)&&(!binding.valid||binding.valid())&&laidOut(root);
  }
  async function settleSurface(root,binding={}){
    const route=win.location.hash,valid=()=>win.location.hash===route&&surfaceCurrent(root,binding);
    return settledFrames(valid);
  }
  async function prepare(root,binding={}){
    const ticket=begin();
    if(!ticket||!same(binding)||binding.api!==ticket.api||binding.user!==ticket.user||binding.server!==ticket.server||binding.credential!==ticket.credential||binding.route&&binding.route!==ticket.route||!useful(root,binding.firstUseful))return false;
    if(typeof binding.firstUseful==='function'&&ticket.phase==='content'&&ticket.root===root&&ticket.host===(binding.host||null)&&ticket.firstUseful===binding.firstUseful&&(!binding.valid||binding.valid())&&contentCurrent(ticket))return true;
    if(ticket.preparing&&typeof binding.firstUseful==='function'&&ticket.root===root&&ticket.host===(binding.host||null)&&ticket.firstUseful===binding.firstUseful&&(!binding.valid||binding.valid())&&(!ticket.valid||ticket.valid()))return false;
    if(ticket.preparing&&ticket.root===root&&ticket.valid===binding.valid)return false;
    const work=++ticket.work;ticket.phase='loading';ticket.root=root;ticket.host=binding.host||null;ticket.valid=binding.valid||null;ticket.firstUseful=binding.firstUseful||null;ticket.preparing=true;
    const valid=()=>current(ticket)&&ticket.work===work&&root.isConnected&&attached(ticket)&&useful(root,ticket.firstUseful)&&(!ticket.valid||ticket.valid());
    try{
      if(!await settledFrames(()=>valid()&&laidOut(root)))return false;
      ticket.errorNode?.remove();ticket.errorNode=null;root.dataset.presentable='true';root.dataset.usefulReady='true';ticket.phase='content';return true;
    }finally{if(ticket.work===work)ticket.preparing=false;}
  }
  win.OrbitalPageReady={version:1,snapshot,managed,begin,prepare,fail,release,fallbackImage,settleSurface,surfaceCurrent};
  win.addEventListener('hashchange',()=>begin());win.addEventListener('pageshow',()=>begin());
  // No body-wide MutationObserver. Actual renderer commits call prepare;
  // native initial polling observes snapshots without controlling SPA paint.
  doc.addEventListener('DOMContentLoaded',()=>begin());
  begin();return win.OrbitalPageReady;
});

/* Early, presentation-only adapters for pinned stock module contracts. */
(function () {
  'use strict';
  if (window.OrbitalStockHooks || location.pathname.startsWith('/simple/')) return;
  const callbacks = new Map(), wrapped = new WeakSet();
  const supported = [11732, 8463, 52197, 7703, 65126, 84595, 36934, 6062, 69002, 13034, 92202, 25235, 84192, 48955, 47490, 9273, 11873, 95491, 90566, 60728, 27, 42111, 14250, 29833];
  function instrument(entry) {
    const modules = Array.isArray(entry) && entry[1];
    if (!modules || typeof modules !== 'object') return;
    for (const id of supported) {
      const original = modules[id];
      if (typeof original !== 'function' || wrapped.has(original)) continue;
      const adapter = function (module, exports, require) {
        const rule = callbacks.get(id);
        let decorated = require, supportedRule = true;
        if (rule?.decorateRequire) {
          try {
            decorated = rule.decorateRequire(require);
            if (typeof decorated !== 'function') supportedRule = false;
          } catch (_) { supportedRule = false; }
        }
        const args = [...arguments];
        args[2] = supportedRule ? decorated : require;
        const value = original.apply(this, args);
        if (rule && supportedRule) {
          try {
            const replacement = rule.callback(module.exports, decorated);
            if (replacement) module.exports = replacement;
          } catch (_) { /* Unsupported adapter: original stock exports remain. */ }
        }
        return value;
      };
      wrapped.add(adapter);
      modules[id] = adapter;
    }
  }
  const queue = window.webpackChunk = window.webpackChunk || [];
  for (const entry of queue) instrument(entry);
  function wrapPush(target) {
    return function (...entries) {
      entries.forEach(instrument);
      return target.apply(this, entries);
    };
  }
  let push = wrapPush(queue.push);
  // Webpack replaces push during bootstrap. Each accessor returns a wrapper
  // bound to that generation's target, so Webpack's retained prior push cannot
  // recurse into its new runtime push implementation.
  Object.defineProperty(queue, 'push', {
    configurable: true,
    get() { return push; },
    set(target) { push = wrapPush(target); }
  });
  window.OrbitalStockHooks = {
    register(id, callback, decorateRequire) {
      if (!supported.includes(id) || typeof callback !== 'function' || callbacks.has(id) || (decorateRequire && typeof decorateRequire !== 'function')) return false;
      callbacks.set(id, { callback, decorateRequire });
      return true;
    }
  };
}());

/* Observe the stock Favorites renderer's actual commit, without changing its requests or layout. */
(function () {
  'use strict';
  if (window.OrbitalFavoritesReady || location.pathname.startsWith('/simple/')) return;
  const records = new WeakMap();
  const prepared = new WeakMap();
  const payloads = new WeakMap();
  const controllers = new WeakMap();
  const routeMatches = () => {
    const [path, query = ''] = location.hash.split('?');
    return path === '#/home' && new URLSearchParams(query).get('tab') === '1';
  };
  function capture(root) {
    const initial = controllers.get(root), api = window.ApiClient;
    if (!initial || api !== initial.api || !retained(initial) || !routeMatches()) return null;
    try {
      const user = api.getCurrentUserId(), server = api.serverId?.(), credential = api.accessToken?.();
      if (!user || user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')) return null;
      return { ...initial, route: location.hash };
    } catch (_) { return null; }
  }
  function retained(owner) {
    if (!owner || !owner.root.isConnected || owner.root.parentElement !== owner.host || window.ApiClient !== owner.api) return false;
    try { return owner.api.getCurrentUserId() === owner.user && owner.api.serverId?.() === owner.server && owner.api.accessToken?.() === owner.credential; } catch (_) { return false; }
  }
  const activeRoots = () => [...document.querySelectorAll('#favoritesTab')].filter(root => root.isConnected && !root.closest('.hide,[hidden]'));
  const current = owner => retained(owner) && routeMatches() && location.hash === owner.route && !owner.root.closest('.hide,[hidden]') && activeRoots().length === 1;
  const same = (a, b) => a && b && a.api === b.api && a.user === b.user && a.server === b.server && a.credential === b.credential && a.route === b.route && a.root === b.root && a.host === b.host;
  function finish(root, owner) {
    if (!current(owner)) return;
    const nodes = [...root.querySelectorAll('.sections .itemsContainer')];
    // The pinned stock Favorites constructor creates these 17 independently loaded sections.
    if (nodes.length !== 17 || nodes.some(node => { const r = records.get(node); return !r?.done || !same(r.owner, owner); })) return;
    const ticket = window.OrbitalPageReady?.begin(owner.route), previous = prepared.get(root);
    // A cancelled off-route visual preparation must be retried after returning;
    // only the same current shared ticket suppresses duplicate observer work.
    if (same(previous?.owner, owner) && previous.ticket === ticket) return;
    const empty = nodes.every(node => records.get(node).count === 0);
    root.querySelectorAll('.orbital-favorites-empty').forEach(node => node.remove());
    if (empty) {
      const note = document.createElement('p');
      note.className = 'orbital-favorites-empty';
      note.setAttribute('role', 'status');
      note.textContent = 'No favorites yet. Add a title to your favorites to see it here.';
      note.dataset.pageReadyRoute = owner.route;
      note.dataset.pageReadyUser = owner.user;
      root.append(note);
    }
    prepared.set(root, { owner, ticket });
    root.dataset.pageReadyRoute = owner.route;
    root.dataset.pageReadyUser = owner.user;
    root.dataset.phase = 'complete';
    void window.OrbitalPageReady?.prepare(root, { ...owner, valid: () => current(owner) });
  }
  function pending(owner) {
    if (!current(owner)) return;
    prepared.delete(owner.root);
    owner.root.querySelectorAll('.orbital-favorites-empty').forEach(node => node.remove());
    owner.root.dataset.phase = 'loading';
    owner.root.dataset.presentable = 'pending';
    window.OrbitalPageReady?.begin(owner.route);
  }
  function completed(node, record, owner, token, data) {
    if (records.get(node) !== record || record.token !== token || !retained(owner) || owner.api !== record.boundApi) return;
    const items = Array.isArray(data?.Items) ? data.Items : Array.isArray(data) ? data : null;
    if (!items) { fail(owner); return; }
    record.done = true;
    record.count = items.length;
    record.owner = owner;
    finish(owner.root, owner);
  }
  function attach(node, root) {
    if (records.has(node) || typeof node.refreshItems !== 'function' || typeof node.fetchData !== 'function') return;
    const initial = controllers.get(root), owner = capture(root);
    if (!initial) return;
    // Stock fetchData is bound to the Favorites controller's original apiClient.
    // A reused stock node cannot be rebound merely by replacing window.ApiClient.
    const record = { token: 0, done: false, owner, boundApi: initial.api, wrappedStarted: false, count: null };
    records.set(node, record);
    const afterRefresh = node.afterRefresh;
    node.afterRefresh = function (...args) {
      const value = typeof afterRefresh === 'function' ? afterRefresh.apply(this, args) : undefined;
      const data = args[0], proof = data && typeof data === 'object' ? payloads.get(data) : null;
      // The exact stock constructor adapter installs before Home calls onResume.
      // An unobserved payload cannot be attributed to this controller/session.
      if (proof && !proof.ambiguous && proof.record === record && proof.token === record.token && proof.owner?.api === record.boundApi && same(proof.owner, record.owner)) completed(node, record, proof.owner, proof.token, data);
      else {
        // Stock x has already written this obsolete/ambiguous payload into the DOM.
        // Revoke any newer receipt rather than certifying that overwritten display.
        record.done = false;
        pending(record.owner);
        fail(record.owner);
      }
      return value;
    };
    const fetchData = node.fetchData;
    node.fetchData = function (...args) {
      const captured = record.owner, token = record.token;
      const value = fetchData.apply(this, args);
      Promise.resolve(value).then(data => {
        if (!data || typeof data !== 'object') return;
        const old = payloads.get(data);
        if (old && (old.record !== record || old.token !== token || !same(old.owner, captured))) old.ambiguous = true;
        else if (!old) payloads.set(data, { record, token, owner: captured, ambiguous: false });
      }, () => {});
      return value;
    };
    const refreshItems = node.refreshItems;
    node.refreshItems = function (...args) {
      const next = capture(root), token = ++record.token;
      record.wrappedStarted = true;
      record.done = false;
      record.owner = next;
      pending(next);
      if (next && next.api !== record.boundApi) fail(next);
      let value;
      try { value = refreshItems.apply(this, args); }
      catch (error) { fail(next); throw error; }
      // afterRefresh(data) is the commit receipt; resolving without a fetch (paused
      // or missing fetchData) must never count as a completed empty section.
      Promise.resolve(value).then(() => {}, () => { if (record.token === token) fail(next); });
      return value;
    };
    pending(owner);
  }
  function fail(owner) {
    if (current(owner)) void window.OrbitalPageReady?.fail('Your favorites could not finish loading. Please retry.');
  }
  function scan() {
    if (!routeMatches()) return;
    const roots = activeRoots();
    if (roots.length !== 1) return;
    const root = roots[0];
    for (const node of root.querySelectorAll('.sections .itemsContainer')) attach(node, root);
    const owner = capture(root);
    if (owner) finish(root, owner);
  }
  let queued = false;
  function queue() { if (!queued) { queued = true; queueMicrotask(() => { queued = false; scan(); }); } }
  // Constructor capture installs before the first request; document mutations
  // only need a coalesced active-route scan for already committed cached nodes.
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', queue);
  document.addEventListener('viewshow', queue);
  window.addEventListener('orbital:page-retry', event => { if (routeMatches() && event.detail?.route === location.hash) location.reload(); });
  window.OrbitalStockHooks?.register(11732, exports => {
    const Original = exports.default;
    if (typeof Original !== 'function') return null;
    const Wrapped = new Proxy(Original, {
      construct(target, args, newTarget) {
        const controller = Reflect.construct(target, args, newTarget);
        const root = controller.view, api = controller.apiClient;
        try {
          const user = api?.getCurrentUserId(), server = api?.serverId?.(), credential = api?.accessToken?.();
          if (root && user && user !== (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-') && !controllers.has(root)) {
            // apiClient is the stock instance's actual bound API, including when
            // Favorites is constructed while a different Home tab is selected.
            controllers.set(root, { api, user, server, credential, root, host: root.parentElement });
            for (const node of root.querySelectorAll('.sections .itemsContainer')) attach(node, root);
          }
        } catch (_) { /* No receipt on an unsupported stock contract. */ }
        return controller;
      }
    });
    return new Proxy(exports, { get(target, key, receiver) { return key === 'default' ? Wrapped : Reflect.get(target, key, receiver); } });
  });
  window.OrbitalFavoritesReady = { scan };
  queue();
}());

/* Observe the stock List renderer's actual commit, without changing its requests or layout. */
(function () {
  'use strict';
  if (window.OrbitalListReady || location.pathname.startsWith('/simple/')) return;
  const records = new WeakMap();
  const prepared = new WeakMap();
  const payloads = new WeakMap();
  const initialized = new WeakMap();
  const routeMatches = () => {
    return location.hash.split('?')[0] === '#/list';
  };
  function initialOwner(root) {
    const api = window.ApiClient;
    if (!api || !routeMatches()) return null;
    try {
      const user = api.getCurrentUserId(), server = api.serverId?.(), credential = api.accessToken?.();
      if (!user || user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')) return null;
      const selectedServer = new URLSearchParams(location.hash.split('?')[1] || '').get('serverId');
      if (selectedServer && selectedServer !== server) return null;
      return { api, user, server, credential, route: location.hash, root, host: root.parentElement };
    } catch (_) { return null; }
  }
  function capture(root) {
    const owner = initialized.get(root);
    return retained(owner) && routeMatches() && location.hash === owner.route ? owner : null;
  }
  function retained(owner) {
    if (!owner || !owner.root.isConnected || owner.root.parentElement !== owner.host || window.ApiClient !== owner.api) return false;
    try { return owner.api.getCurrentUserId() === owner.user && owner.api.serverId?.() === owner.server && owner.api.accessToken?.() === owner.credential; } catch (_) { return false; }
  }
  const current = owner => retained(owner) && routeMatches() && location.hash === owner.route && !owner.root.classList.contains('hide') && activeRoots().length === 1 && activeRoots()[0] === owner.root;
  const same = (a, b) => a && b && a.api === b.api && a.user === b.user && a.server === b.server && a.credential === b.credential && a.route === b.route && a.root === b.root && a.host === b.host;
  function finish(root, owner) {
    if (!current(owner)) return;
    const nodes = [...root.querySelectorAll('.vertical-wrap.itemsContainer')];
    // The pinned stock List template has one actual item-rendering container.
    if (nodes.length !== 1 || nodes.some(node => { const r = records.get(node); return !r?.done || !same(r.owner, owner); })) return;
    const ticket = window.OrbitalPageReady?.begin(owner.route), previous = prepared.get(root);
    // A cancelled off-route visual preparation must be retried after returning;
    // only the same current shared ticket suppresses duplicate observer work.
    if (same(previous?.owner, owner) && previous.ticket === ticket) return;
    const empty = nodes.every(node => records.get(node).count === 0);
    root.querySelectorAll('.orbital-list-empty').forEach(node => node.remove());
    if (empty) {
      const note = document.createElement('p');
      note.className = 'orbital-list-empty';
      note.setAttribute('role', 'status');
      note.textContent = 'No items match these filters.';
      note.dataset.pageReadyRoute = owner.route;
      note.dataset.pageReadyUser = owner.user;
      root.append(note);
    }
    prepared.set(root, { owner, ticket });
    root.dataset.pageReadyRoute = owner.route;
    root.dataset.pageReadyUser = owner.user;
    root.dataset.phase = 'complete';
    void window.OrbitalPageReady?.prepare(root, { ...owner, valid: () => current(owner) });
  }
  function pending(owner) {
    if (!current(owner)) return;
    prepared.delete(owner.root);
    owner.root.querySelectorAll('.orbital-list-empty').forEach(node => node.remove());
    owner.root.dataset.phase = 'loading';
    owner.root.dataset.presentable = 'pending';
    window.OrbitalPageReady?.begin(owner.route);
  }
  function completed(node, record, owner, token, data) {
    if (records.get(node) !== record || record.token !== token || !retained(owner) || owner.api !== record.boundApi) return;
    const items = Array.isArray(data?.Items) ? data.Items : Array.isArray(data) ? data : null;
    if (!items) { fail(owner); return; }
    record.done = true;
    record.count = items.length;
    record.owner = owner;
    finish(owner.root, owner);
  }
  function attach(node, root) {
    if (records.has(node) || typeof node.refreshItems !== 'function' || typeof node.fetchData !== 'function') return;
    const owner = capture(root);
    if (!owner) return;
    // The actual List controller resolves its API by its captured serverId.
    // Conservatively refuse API-object replacement on a retained stock node.
    const record = { token: 0, done: false, owner, boundApi: owner.api, wrappedStarted: false, count: null };
    records.set(node, record);
    const afterRefresh = node.afterRefresh;
    node.afterRefresh = function (...args) {
      const value = typeof afterRefresh === 'function' ? afterRefresh.apply(this, args) : undefined;
      const data = args[0], proof = data && typeof data === 'object' ? payloads.get(data) : null;
      // viewinit installs this wrapper before the pinned controller's viewshow
      // starts a request. An unobserved payload has no ownership receipt.
      if (proof && !proof.ambiguous && proof.record === record && proof.token === record.token && proof.owner?.api === record.boundApi && same(proof.owner, record.owner)) completed(node, record, proof.owner, proof.token, data);
      else {
        // Stock x has already written this obsolete/ambiguous payload into the DOM.
        // Revoke any newer receipt rather than certifying that overwritten display.
        record.done = false;
        pending(record.owner);
        fail(record.owner);
      }
      return value;
    };
    const fetchData = node.fetchData;
    node.fetchData = function (...args) {
      const captured = record.owner, token = record.token;
      const value = fetchData.apply(this, args);
      Promise.resolve(value).then(data => {
        if (!data || typeof data !== 'object') return;
        const old = payloads.get(data);
        if (old && (old.record !== record || old.token !== token || !same(old.owner, captured))) old.ambiguous = true;
        else if (!old) payloads.set(data, { record, token, owner: captured, ambiguous: false });
      }, () => {});
      return value;
    };
    const refreshItems = node.refreshItems;
    node.refreshItems = function (...args) {
      const next = capture(root), token = ++record.token;
      record.wrappedStarted = true;
      record.done = false;
      record.owner = next;
      pending(next);
      if (next && next.api !== record.boundApi) fail(next);
      let value;
      try { value = refreshItems.apply(this, args); }
      catch (error) { fail(next); throw error; }
      // afterRefresh(data) is the commit receipt; resolving without a fetch (paused
      // or missing fetchData) must never count as a completed empty section.
      Promise.resolve(value).then(() => {}, () => { if (record.token === token) fail(next); });
      return value;
    };
    pending(owner);
  }
  function fail(owner) {
    if (current(owner)) void window.OrbitalPageReady?.fail('This list could not finish loading. Please retry.');
  }
  function activeRoots() {
    return [...document.querySelectorAll('.page.libraryPage.noSecondaryNavPage')].filter(root => !root.classList.contains('hide'));
  }
  function scan() {
    if (!routeMatches()) return;
    const roots = activeRoots();
    if (roots.length !== 1) return;
    const root = roots[0];
    for (const node of root.querySelectorAll('.vertical-wrap.itemsContainer')) attach(node, root);
    const owner = capture(root);
    if (owner) finish(root, owner);
  }
  let queued = false;
  function queue() { if (!queued) { queued = true; queueMicrotask(() => { queued = false; scan(); }); } }
  // Run in the observer callback itself, before already-resolved fetch handlers;
  // an additional microtask here could miss the first empty-result commit.
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  // Current core constructs the controller, dispatches viewinit synchronously,
  // then dispatches viewshow later. List fetches start only from viewshow.
  document.addEventListener('viewinit', event => {
    const root = event.target;
    if (!root?.matches?.('.page.libraryPage.noSecondaryNavPage') || initialized.has(root)) return;
    const owner = initialOwner(root);
    if (!owner) return;
    initialized.set(root, owner);
    for (const node of root.querySelectorAll('.vertical-wrap.itemsContainer')) attach(node, root);
  });
  window.addEventListener('hashchange', queue);
  document.addEventListener('viewshow', scan);
  window.addEventListener('orbital:page-retry', event => { if (routeMatches() && event.detail?.route === location.hash) location.reload(); });
  window.OrbitalListReady = { scan };
  queue();
}());

/* Exact stock LibraryContext success/commit receipts; stock rendering is unchanged. */
(function () {
  'use strict';
  if (window.OrbitalStockLibraryReady || location.pathname.startsWith('/simple/')) return;
  const itemViews = ['movies', 'favorites', 'collections', 'series', 'episodes', 'studios', 'albums', 'albumartists', 'artists', 'authors', 'playlists', 'songs', 'books', 'photoalbums', 'photos', 'videos', 'channels', 'seriestimers', 'musicvideos', 'folders', 'mixed'];
  function routeRoot() {
    const [path, query = ''] = location.hash.split('?');
    const params = new URLSearchParams(query), off = new URLSearchParams(location.search).get('orbital') === 'off';
    if ((path === '#/movies' || path === '#/tv') && !off && params.get('orbitalBrowse') !== 'all') return null;
    if (path === '#/livetv' && !off && !(Number(params.get('tab')) >= 3)) return null;
    return { '#/movies': '#moviesPage', '#/tv': '#tvshowsPage', '#/books': '#booksPage', '#/boxsets': '#boxsetsPage', '#/music': '#musicPage', '#/homevideos': '#homevideos', '#/musicvideos': '#musicvideos', '#/playlists': '#playlistsPage', '#/mixed': '#mixed', '#/livetv': '#liveTvPage' }[path] || null;
  }
  function capture(apiContext) {
    const selector = routeRoot(), api = apiContext?.__legacyApiClient__;
    if (!selector || !api || api !== window.ApiClient) return null;
    try {
      const user = api.getCurrentUserId(), server = api.serverId?.(), credential = api.accessToken?.();
      if (!user || user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-') || apiContext.user?.Id !== user) return null;
      const requestedServer = new URLSearchParams(location.hash.split('?')[1] || '').get('serverId');
      if (requestedServer && requestedServer !== server) return null;
      return { api, user, server, credential, selector, route: location.hash };
    } catch (_) { return null; }
  }
  function sameSession(a, b) {
    return a && b && a.api === b.api && a.user === b.user && a.server === b.server && a.credential === b.credential;
  }
  function current(owner) {
    if (!owner || owner.api !== window.ApiClient || owner.route !== location.hash || owner.selector !== routeRoot()) return false;
    try { return owner.api.getCurrentUserId() === owner.user && owner.api.serverId?.() === owner.server && owner.api.accessToken?.() === owner.credential; } catch (_) { return false; }
  }
  window.OrbitalStockHooks?.register(8463, (exports, require) => {
    const original = exports.tF, React = require(63696), apiProvider = require(69410);
    if (typeof original !== 'function' || typeof React.useRef !== 'function' || typeof React.useLayoutEffect !== 'function' || typeof apiProvider.gf !== 'function') return null;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      const owner = capture(apiProvider.gf()), initial = React.useRef(null);
      if (!initial.current && owner && result?.isLibraryPath) initial.current = owner;
      const query = result?.itemsResult, data = query?.data;
      const status = query?.status, success = query?.isSuccess === true, pending = query?.isPending === true, loading = query?.isLoading === true, error = query?.isError === true;
      React.useLayoutEffect(() => {
        let active = true;
        if (!sameSession(initial.current, owner) || !current(owner) || !result?.isLibraryPath || !itemViews.includes(result.content?.viewType)) return () => { active = false; };
        const root = document.querySelector(owner.selector);
        if (!root?.isConnected || root.classList.contains('hide')) return () => { active = false; };
        const host = root.parentElement;
        const valid = () => active && current(owner) && root.isConnected && root.parentElement === host && document.querySelector(owner.selector) === root && !root.classList.contains('hide');
        const parent = new URLSearchParams(owner.route.split('?')[1] || '').get('topParentId');
        if ((parent || undefined) !== (result.id || undefined)) return () => { active = false; };
        root.dataset.pageReadyRoute = owner.route;
        root.dataset.pageReadyUser = owner.user;
        if (status === 'error' || error) {
          root.dataset.phase = 'error';
          if (valid()) void window.OrbitalPageReady?.fail('This page could not finish loading. Please retry.');
        } else if (status === 'success' && success && !pending && !loading && Array.isArray(data?.Items)) {
          root.dataset.phase = 'complete';
          void window.OrbitalPageReady?.prepare(root, { ...owner, root, host, valid });
        } else {
          root.dataset.phase = 'loading';
          root.dataset.presentable = 'pending';
          window.OrbitalPageReady?.begin(owner.route);
        }
        return () => { active = false; };
      }, [result?.id, result?.isLibraryPath, result?.content?.viewType, data, status, success, pending, loading, error, owner?.api, owner?.user, owner?.server, owner?.credential, owner?.route]);
      return result;
    };
    return new Proxy(exports, { get(target, key, receiver) { return key === 'tF' ? wrapped : Reflect.get(target, key, receiver); } });
  });
  window.addEventListener('orbital:page-retry', event => {
    if (routeRoot() && event.detail?.route === location.hash) location.reload();
  });
  window.OrbitalStockLibraryReady = { supported: ['#/movies', '#/tv', '#/books', '#/boxsets', '#/music', '#/homevideos', '#/musicvideos', '#/playlists', '#/mixed', '#/livetv'] };
}());

/* Completion receipts for pinned stock LibraryPage section/query commits. */
(function () {
  'use strict';
  if (window.OrbitalStockLibrarySectionsReady || location.pathname.startsWith('/simple/')) return;
  const roots = { '#/movies': 'moviesPage', '#/tv': 'tvshowsPage', '#/books': 'booksPage', '#/boxsets': 'boxsetsPage', '#/music': 'musicPage', '#/homevideos': 'homevideos', '#/musicvideos': 'musicvideos', '#/playlists': 'playlistsPage', '#/mixed': 'mixed', '#/livetv': 'liveTvPage' };
  const sectionViews = ['suggestions', 'genres', 'upcoming', 'programs', 'recordings', 'schedule'];
  const pages = new Map();
  function rootId() {
    const [path, query = ''] = location.hash.split('?'), params = new URLSearchParams(query), off = new URLSearchParams(location.search).get('orbital') === 'off';
    if ((path === '#/movies' || path === '#/tv') && !off && params.get('orbitalBrowse') !== 'all') return null;
    if (path === '#/livetv' && !off && !(Number(params.get('tab')) >= 3)) return null;
    return roots[path] || null;
  }
  function capture(context) {
    const id = rootId(), api = context?.__legacyApiClient__;
    if (!id || !api || api !== window.ApiClient) return null;
    try {
      const user = api.getCurrentUserId(), server = api.serverId?.(), credential = api.accessToken?.();
      if (!user || user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-') || context.user?.Id !== user) return null;
      const requestedServer = new URLSearchParams(location.hash.split('?')[1] || '').get('serverId');
      if (requestedServer && requestedServer !== server) return null;
      return { api, user, server, credential, route: location.hash, id };
    } catch (_) { return null; }
  }
  const sameSession = (a, b) => !!a && !!b && a.api === b.api && a.user === b.user && a.server === b.server && a.credential === b.credential;
  function current(record) {
    if (!record || record.destroyed || record.route !== location.hash || record.id !== rootId() || record.api !== window.ApiClient) return false;
    try { return record.api.getCurrentUserId() === record.user && record.api.serverId?.() === record.server && record.api.accessToken?.() === record.credential; } catch (_) { return false; }
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pagesData = data => Array.isArray(data?.pages) && data.pages.every(page => Array.isArray(page?.Items));
  function state(proof, disabledAllowed, shape) {
    if (!proof || proof.error) return proof?.error ? 'error' : 'loading';
    if (proof.enabled === false) {
      if (!disabledAllowed) return 'loading';
      if (proof.status === 'pending' && proof.data === undefined && !proof.loading) return 'complete';
    }
    return proof.status === 'success' && proof.success && !proof.pending && !proof.loading && !proof.nextPage && shape(proof.data) ? 'complete' : 'loading';
  }
  function status(record) {
    const proofs = [...record.queries.values()], find = name => proofs.find(proof => proof.key[0] === name);
    const section = record.content.sectionsView || {}, parent = record.parent;
    if (record.content.viewType === 'suggestions') {
      return [state(find('SuggestionSectionWithItems'), !parent, Array.isArray), state(find('MovieRecommendations'), !section.isMovieRecommendations, Array.isArray)];
    }
    if (record.content.viewType === 'upcoming') return [state(find('UpcomingEpisodes'), !parent, pagesData)];
    if (['programs', 'recordings', 'schedule'].includes(record.content.viewType)) return [state(find('ProgramSectionWithItems'), false, Array.isArray), state(find('Timers'), !section.isLiveTvUpcomingRecordings, Array.isArray)];
    if (record.content.viewType === 'genres') {
      const main = find('Genres'), result = [state(main, !parent, pagesData)];
      if (result[0] !== 'complete') return result;
      if (main.data === undefined) return result;
      for (const genre of main.data.pages.flatMap(page => page.Items)) {
        if (!genre.Id) { result.push('loading');continue; }
        result.push(state(proofs.find(proof => proof.key[0] === 'Items' && proof.key[1]?.genreIds?.length === 1 && proof.key[1].genreIds[0] === genre.Id), false, data => Array.isArray(data?.Items)));
      }
      return result;
    }
    return ['loading'];
  }
  function schedule(record) {
    if (!record || record.queued) return;
    record.queued = true;
    queueMicrotask(() => {
      record.queued = false;
      if (!current(record) || !record.committed || !record.root?.isConnected || record.root.parentElement !== record.host || document.getElementById(record.id) !== record.root || record.root.classList.contains('hide')) return;
      const statuses = status(record), root = record.root;
      root.dataset.pageReadyRoute = record.route;root.dataset.pageReadyUser = record.user;
      if (statuses.includes('error')) { root.dataset.phase = 'error';void window.OrbitalPageReady?.fail('This library page could not finish loading. Please retry.');return; }
      if (statuses.some(value => value !== 'complete')) { root.dataset.phase = 'loading';root.dataset.presentable = 'pending';window.OrbitalPageReady?.begin(record.route);return; }
      const ticket = window.OrbitalPageReady?.begin(record.route);
      if (record.prepared === ticket) return;
      record.prepared = ticket;
      const generation = record.generation;
      root.dataset.phase = 'complete';
      void window.OrbitalPageReady?.prepare(root, { ...record, valid: () => current(record) && record.committed && record.generation === generation && record.root.isConnected && record.root.parentElement === record.host && document.getElementById(record.id) === record.root && !record.root.classList.contains('hide') && status(record).every(value => value === 'complete') });
    });
  }
  function matches(record, key) {
    const view = record.content.viewType, parent = record.parent, section = record.content.sectionsView || {};
    if (view === 'suggestions') return key[0] === 'SuggestionSectionWithItems' && key[1] === parent && equal(key[2]?.suggestionSectionType, section.suggestionSections || []) || key[0] === 'MovieRecommendations' && key[1] === parent;
    if (view === 'upcoming') return key[0] === 'UpcomingEpisodes' && key[1] === parent;
    if (view === 'genres') return key[0] === 'Genres' && key[1] === parent && equal(key[2], record.content.itemType || []) || key[0] === 'Items' && (key[1]?.parentId || undefined) === parent && key[1]?.genreIds?.length === 1;
    if (['programs', 'recordings', 'schedule'].includes(view)) return key[0] === 'ProgramSectionWithItems' && equal(key[1]?.programSectionType, section.programSections || []) || key[0] === 'Timers' && key[1]?.isUpcomingRecordingsEnabled === !!section.isLiveTvUpcomingRecordings;
    return false;
  }
  function decorateRequire(original) {
    const cache = new Map(), React = original(63696), provider = original(69410);
    return new Proxy(original, { apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args), id = args[0], method = id === 87395 ? 'I' : id === 82827 ? 'q' : null;
      if (!method || !value || typeof value[method] !== 'function') return value;
      if (cache.has(id)) return cache.get(id);
      const proxy = new Proxy(value, { get(object, name, receiver) {
        const fn = Reflect.get(object, name, receiver);
        if (name !== method) return fn;
        return function (...queryArgs) {
          const result = fn.apply(this, queryArgs), owner = capture(provider.gf()), initial = React.useRef(null), key = queryArgs[0]?.queryKey;
          if (!initial.current && owner) initial.current = owner;
          const record = owner && pages.get(owner.route), token = React.useRef({}).current;
          const status = result?.status, success = result?.isSuccess === true, pending = result?.isPending === true, error = result?.isError === true || status === 'error', loading = result?.isLoading === true, nextPage = result?.isFetchingNextPage === true, data = result?.data, enabled = queryArgs[0]?.enabled;
          const fingerprint = Array.isArray(key) ? JSON.stringify(key) : '';
          React.useLayoutEffect(() => {
            if (!sameSession(initial.current, owner) || !current(record) || !sameSession(record, owner) || !Array.isArray(key) || !matches(record, key)) return;
            const proof = { key, status, success, pending, error, loading, nextPage, data, enabled };
            record.queries.set(token, proof);record.generation++;record.prepared = null;schedule(record);
            return () => { if (record.queries.get(token) === proof) { record.queries.delete(token);record.generation++;record.prepared = null;schedule(record); } };
          }, [record, fingerprint, status, success, pending, error, loading, nextPage, data, enabled, owner?.api, owner?.user, owner?.server, owner?.credential, owner?.route]);
          return result;
        };
      } });
      cache.set(id, proxy);return proxy;
    } });
  }
  window.OrbitalStockHooks?.register(7703, () => null, decorateRequire);
  window.OrbitalStockHooks?.register(52197, (exports, require) => {
    const Original = exports.A, React = require(63696), provider = require(69410);
    if (typeof Original !== 'function' || typeof React.useLayoutEffect !== 'function') return null;
    function Page(...args) {
      const owner = capture(provider.gf()), initial = React.useRef(null), reference = React.useRef(null);
      if (!initial.current && owner) initial.current = owner;
      const result = Original.apply(this, args), child = result?.props?.children, content = child?.props?.currentTab, parent = child?.props?.parentId || undefined;
      const routeParent = owner && new URLSearchParams(owner.route.split('?')[1] || '').get('topParentId');
      if (owner && sameSession(initial.current, owner) && result?.props?.id === owner.id && content && sectionViews.includes(content.viewType) && (routeParent || undefined) === parent) {
        let record = reference.current;
        if (!record || record.route !== owner.route || record.content.viewType !== content.viewType || !equal(record.content, content)) {
          if (record) record.destroyed = true;
          record = { ...owner, content, parent, queries: new Map(), generation: 0, committed: false, destroyed: false, prepared: null };
          reference.current = record;pages.set(owner.route, record);
        }
      } else if (reference.current) { reference.current.destroyed = true;reference.current = null; }
      const record = reference.current;
      React.useLayoutEffect(() => {
        if (!current(record)) return;
        const root = document.getElementById(record.id);
        if (!root?.isConnected || root.classList.contains('hide')) return;
        record.root = root;record.host = root.parentElement;record.committed = true;schedule(record);
        return () => { record.destroyed = true;record.committed = false;if (pages.get(record.route) === record) pages.delete(record.route); };
      }, [record]);
      return result;
    }
    return new Proxy(exports, { get(target, key, receiver) { return key === 'A' ? Page : Reflect.get(target, key, receiver); } });
  }, decorateRequire);
  window.OrbitalStockLibrarySectionsReady = { supportedRoots: Object.keys(roots) };
}());

/* Public form/server-list presentation only. No account, password or connection actions. */
(function () {
  'use strict';
  if (window.OrbitalPublicReady || location.pathname.startsWith('/simple/')) return;
  const owners = new WeakMap();
  const paths = ['#/addserver', '#/selectserver', '#/forgotpassword', '#/forgotpasswordpin'];
  const route = () => location.hash.split('?')[0];
  function capture(root, path) {
    if (route() !== path || !root?.isConnected) return null;
    const api = window.ApiClient;
    try {
      const user = String(api?.getCurrentUserId?.() || '');
      if (user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')) return null;
      return {api, user, server:api?.serverId?.(), credential:api?.accessToken?.(), route:location.hash, root, host:root.parentElement, sequence:0, complete:false};
    } catch (_) { return null; }
  }
  function current(owner) {
    if (!owner || owner.api !== window.ApiClient || owner.route !== location.hash || !owner.root.isConnected || owner.root.parentElement !== owner.host || owner.root.classList.contains('hide')) return false;
    try { return String(owner.api?.getCurrentUserId?.() || '') === owner.user && owner.api?.serverId?.() === owner.server && owner.api?.accessToken?.() === owner.credential; } catch (_) { return false; }
  }
  function fail(owner) {
    if (!current(owner)) return;
    owner.complete = false;
    owner.root.dataset.phase = 'error';
    owner.root.dataset.presentable = 'pending';
    void window.OrbitalPageReady?.fail('This page could not finish loading. Please retry.');
  }
  function present(owner, valid = () => true) {
    if (!current(owner) || !valid()) return;
    owner.root.dataset.phase = 'complete';
    owner.root.dataset.pageReadyRoute = owner.route;
    owner.root.dataset.pageReadyUser = owner.user;
    void window.OrbitalPageReady?.prepare(owner.root, {...owner, valid:() => current(owner) && valid()});
  }
  function formValid(owner, path) {
    const root = owner.root;
    if (path === '#/addserver') return !!root.querySelector('.addServerForm #txtServerHost') && !!root.querySelector('.addServerForm button[type="submit"]') && !!root.querySelector('.btnCancel');
    if (path === '#/forgotpasswordpin') return !!root.querySelector('.forgotPasswordPinForm #txtPin') && !!root.querySelector('button[type="submit"]') && !!root.querySelector('.btnCancel');
    return false;
  }
  function wrapController(exports, path) {
    const Original = exports.default;
    if (typeof Original !== 'function') return null;
    function before(args) {
      const owner = capture(args[0], path);
      if (owner) owners.set(owner.root, owner);
      return owner;
    }
    function after(owner) {
      if (!owner) return;
      const commit = () => {
        if (path === '#/selectserver') { if (owner.complete) present(owner, () => owner.complete); }
        else if (formValid(owner,path)) present(owner, () => formValid(owner,path));
      };
      owner.root.addEventListener('viewshow', commit);
      queueMicrotask(commit);
    }
    const Wrapped = new Proxy(Original, {
      apply(target, thisArg, args) { const owner=before(args);const value=Reflect.apply(target,thisArg,args);after(owner);return value; },
      construct(target, args, newTarget) { const owner=before(args);const value=Reflect.construct(target,args,newTarget);after(owner);return value; }
    });
    return new Proxy(exports,{get(target,key,receiver){return key==='default'?Wrapped:Reflect.get(target,key,receiver);}});
  }
  window.OrbitalStockHooks?.register(11873, exports => wrapController(exports,'#/addserver'));
  window.OrbitalStockHooks?.register(95491, exports => wrapController(exports,'#/forgotpasswordpin'));
  function selectRequire(require) {
    let managerProxy, exportsProxy;
    return new Proxy(require, {apply(target,thisArg,args) {
      const exports=Reflect.apply(target,thisArg,args);
      if (args[0] !== 67430 || !exports?.tF || typeof exports.tF.getAvailableServers !== 'function') return exports;
      if (!exportsProxy) {
        const manager=exports.tF, original=manager.getAvailableServers;
        const observed=function (...params) {
          const root=document.querySelector('#selectServerPage:not(.hide)'), owner=owners.get(root);
          const sequence=owner ? ++owner.sequence : 0;
          if (current(owner)) { owner.complete=false;root.dataset.phase='loading';root.dataset.presentable='pending';window.OrbitalPageReady?.begin(owner.route); }
          const value=Reflect.apply(original,this===managerProxy?manager:this,params);
          Promise.resolve(value).then(data => queueMicrotask(() => {
            if (!current(owner)) return;
            // The stock promise continuation commits the server cards first.
            // A later obsolete write must revoke an already issued receipt.
            if (owner.sequence !== sequence || !Array.isArray(data)) { fail(owner);return; }
            const container=root.querySelector('.servers'), cards=container?[...container.querySelectorAll('button.card')]:[];
            const ids=data.map(server=>String(server.Id || ''));
            const committed=!!container && ids.every(Boolean) && new Set(ids).size===ids.length && cards.length===ids.length && cards.every((card,i)=>card.dataset.id===ids[i]);
            const empty=data.length===0 && !!container?.querySelector('p') && !!container.textContent.trim();
            if (!committed || (!data.length && !empty)) { fail(owner);return; }
            owner.complete=true;present(owner,()=>owner.complete && owner.sequence===sequence);
          }),()=>{if(current(owner)&&owner.sequence===sequence)fail(owner);});
          return value;
        };
        managerProxy=new Proxy(manager,{get(target,key,receiver){return key==='getAvailableServers'?observed:Reflect.get(target,key,receiver);}});
        exportsProxy=new Proxy(exports,{get(target,key,receiver){return key==='tF'?managerProxy:Reflect.get(target,key,receiver);}});
      }
      return exportsProxy;
    }});
  }
  window.OrbitalStockHooks?.register(60728,exports=>wrapController(exports,'#/selectserver'),selectRequire);
  window.OrbitalStockHooks?.register(90566,(exports,require)=>{
    const Original=exports.default, React=require(63696);
    if(typeof Original!=='function'||typeof React.useRef!=='function'||typeof React.useLayoutEffect!=='function')return null;
    const Wrapped=function(...args){
      const result=Reflect.apply(Original,this,args), initial=React.useRef(null);
      if(!initial.current && route()==='#/forgotpassword') {
        const api=window.ApiClient;
        try { initial.current={api,user:String(api?.getCurrentUserId?.()||''),server:api?.serverId?.(),credential:api?.accessToken?.(),route:location.hash}; } catch (_) {}
      }
      React.useLayoutEffect(()=>{
        const root=document.querySelector('#forgotPasswordPage'),owner=capture(root,'#/forgotpassword'), first=initial.current;
        if(!first || !owner || first.api!==owner.api || first.user!==owner.user || first.server!==owner.server || first.credential!==owner.credential || first.route!==owner.route)return;
        let active=true;
        const valid=()=>active&&!!root.querySelector('.forgotPasswordForm #txtName')&&!!root.querySelector('#btnSubmit[type="submit"]')&&!!root.querySelector('#btnCancel');
        present(owner,valid);
        return ()=>{active=false;};
      }, []);
      return result;
    };
    return new Proxy(exports,{get(target,key,receiver){return key==='default'||key==='ForgotPasswordPage'?Wrapped:Reflect.get(target,key,receiver);}});
  });
  window.addEventListener('orbital:page-retry',event=>{if(paths.includes(route())&&event.detail?.route===location.hash)location.reload();});
  window.OrbitalPublicReady={supported:paths};
}());

/* Exact stock OSD metadata commit; no playback, network or provider authority. */
(function () {
  'use strict';
  if (window.OrbitalVideoReady || location.pathname.startsWith('/simple/')) return;
  const owners=new WeakMap(),proofs=new WeakMap();let manager=null;
  const route=()=>location.hash.split('?')[0]==='#/video';
  function current(o){
    if(!o||!route()||o.route!==location.hash||o.api!==window.ApiClient||!o.root.isConnected||o.root.parentElement!==o.host||o.root.classList.contains('hide')||document.querySelector('#videoOsdPage:not(.hide)')!==o.root)return false;
    try{return o.api.getCurrentUserId()===o.user&&o.api.serverId?.()===o.server&&o.api.accessToken?.()===o.credential;}catch{return false;}
  }
  function active(){return owners.get(document.querySelector('#videoOsdPage:not(.hide)'));}
  function state(player){try{return manager?.getPlayerState?.(player);}catch{return null;}}
  function retained(p){
    if(!current(p?.owner)||p.owner.sequence!==p.sequence||manager?.getCurrentPlayer?.()!==p.player)return false;
    const s=state(p.player),item=s?.NowPlayingItem;
    return !!item&&item.Id===p.id&&(!item.ServerId||item.ServerId===p.owner.server)&&(!p.source||s.MediaSource?.Id===p.source);
  }
  function remember(value,p){
    if(!value||typeof value!=='object')return;
    const old=proofs.get(value);
    if(!old||!retained(old)||old.owner===p.owner&&old.sequence===p.sequence)proofs.set(value,p);
  }
  function readProof(owner,player,result){
    const item=result?.NowPlayingItem;
    if(!current(owner)||!player||manager?.getCurrentPlayer?.()!==player||!item?.Id||item.ServerId&&item.ServerId!==owner.server)return null;
    const source=result.MediaSource?.Id||null;
    if(owner.player!==player||owner.itemId!==item.Id||owner.source!==source){owner.sequence++;owner.player=player;owner.itemId=item.Id;owner.source=source;owner.complete=false;owner.root.dataset.phase='loading';owner.root.dataset.presentable='pending';window.OrbitalPageReady?.begin(owner.route);}
    return {owner,player,id:item.Id,source,sequence:owner.sequence};
  }
  function fail(owner){if(current(owner)){owner.complete=false;owner.root.dataset.phase='error';void window.OrbitalPageReady?.fail('The player could not finish loading. Please retry.');}}
  function decorateRequire(require){
    const decorated=new Map();
    return new Proxy(require,{apply(target,thisArg,args){
      const exports=Reflect.apply(target,thisArg,args),id=args[0];
      if(decorated.has(id))return decorated.get(id);
      if(id===68221&&exports?.f){
        manager=exports.f;const original=manager.getPlayerState;
        if(typeof original!=='function')return exports;
        let proxy;const observed=function(...params){const result=Reflect.apply(original,this===proxy?manager:this,params),proof=readProof(active(),params[0],result);if(proof&&result.NowPlayingItem.Type!=='TvChannel')remember(result.NowPlayingItem,proof);return result;};
        proxy=new Proxy(manager,{get(t,k,r){return k==='getPlayerState'?observed:Reflect.get(t,k,r);}});
        const out=new Proxy(exports,{get(t,k,r){return k==='f'?proxy:Reflect.get(t,k,r);}});decorated.set(id,out);return out;
      }
      if(id===67430&&exports?.tF&&typeof exports.tF.getApiClient==='function'){
        const connection=exports.tF,original=connection.getApiClient;let proxy;
        const getApi=function(...params){
          const api=Reflect.apply(original,this===proxy?connection:this,params);
          if(!api||typeof api.getItem!=='function')return api;
          let apiProxy;const getItem=function(...params){
            const owner=active(),player=manager?.getCurrentPlayer?.(),proof=readProof(owner,player,state(player));
            const matched=proof&&api===owner.api&&params[0]===owner.user&&params[1]===proof.id;
            const value=Reflect.apply(api.getItem,this===apiProxy?api:this,params);
            if(matched)Promise.resolve(value).then(item=>{if(!retained(proof)||item?.Id!==proof.id)return;remember(item,proof);remember(item.CurrentProgram,proof);},()=>{if(retained(proof))fail(owner);});
            return value;
          };
          apiProxy=new Proxy(api,{get(t,k,r){return k==='getItem'?getItem:Reflect.get(t,k,r);}});return apiProxy;
        };
        proxy=new Proxy(connection,{get(t,k,r){return k==='getApiClient'?getApi:Reflect.get(t,k,r);}});
        const out=new Proxy(exports,{get(t,k,r){return k==='tF'?proxy:Reflect.get(t,k,r);}});decorated.set(id,out);return out;
      }
      if(id===82180&&exports?.Ay&&typeof exports.Ay.getSecondaryMediaInfoHtml==='function'){
        const info=exports.Ay,original=info.getSecondaryMediaInfoHtml;let proxy;
        const format=function(...params){
          const value=Reflect.apply(original,this===proxy?info:this,params),proof=proofs.get(params[0]);
          const before=proof?.owner.metadataRevision;proof?.owner.metadataObserver?.takeRecords();
          queueMicrotask(()=>{
            if(!proof||!retained(proof))return;
            const mutations=proof.owner.metadataObserver?.takeRecords()||[];
            if(!mutations.length&&proof.owner.metadataRevision===before)return;
            const owner=proof.owner,root=owner.root,metadata=root.querySelector('.osdSecondaryMediaInfo');
            if(typeof value!=='string'||!metadata||metadata.innerHTML!==value||!root.querySelector('.btnPause')||!root.querySelector('.osdPositionSlider')||!document.title.trim()){fail(owner);return;}
            owner.complete=true;root.dataset.phase='complete';root.dataset.pageReadyRoute=owner.route;root.dataset.pageReadyUser=owner.user;
            void window.OrbitalPageReady?.prepare(root,{...owner,valid:()=>owner.complete&&retained(proof)&&metadata.innerHTML===value});
          });
          return value;
        };
        proxy=new Proxy(info,{get(t,k,r){return k==='getSecondaryMediaInfoHtml'?format:Reflect.get(t,k,r);}});
        const out=new Proxy(exports,{get(t,k,r){return k==='Ay'?proxy:Reflect.get(t,k,r);}});decorated.set(id,out);return out;
      }
      return exports;
    }});
  }
  window.OrbitalStockHooks?.register(27,(exports)=>{
    const Original=exports.default;if(typeof Original!=='function')return null;
    function before(args){
      const root=args[0],api=window.ApiClient;if(!route()||!root?.isConnected||root.id!=='videoOsdPage'||!api)return null;
      try{const user=api.getCurrentUserId();if(!user||user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'))return null;const owner={api,user,server:api.serverId?.(),credential:api.accessToken?.(),route:location.hash,root,host:root.parentElement,sequence:0,complete:false};owners.get(root)?.metadataObserver?.disconnect();
        const metadata=root.querySelector('.osdSecondaryMediaInfo');if(!metadata)return null;
        owner.metadataRevision=0;owner.metadataObserver=new MutationObserver(records=>{owner.metadataRevision+=records.length;});
        owner.metadataObserver.observe(metadata,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
        root.addEventListener('viewshow',()=>{if(current(owner))owner.metadataObserver.observe(metadata,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});});
        root.addEventListener('viewhide',()=>{owner.complete=false;owner.sequence++;root.dataset.phase='loading';root.dataset.presentable='pending';owner.metadataObserver.disconnect();});
        owners.set(root,owner);return owner;}catch{return null;}
    }
    const Wrapped=new Proxy(Original,{
      apply(target,thisArg,args){before(args);return Reflect.apply(target,thisArg,args);},
      construct(target,args,newTarget){before(args);return Reflect.construct(target,args,newTarget);}
    });
    return new Proxy(exports,{get(t,k,r){return k==='default'?Wrapped:Reflect.get(t,k,r);}});
  },decorateRequire);
  window.addEventListener('orbital:page-retry',event=>{const owner=active();if(event.detail?.route===location.hash&&current(owner))location.reload();});
  window.OrbitalVideoReady={supported:['#/video'],evidence:'OSD_METADATA_COMMIT_ONLY_NOT_FIRST_PICTURE_OR_PLAYBACK'};
}());

/* Stock Home completion, before its outer controller swallows load errors. */
(function () {
  'use strict';
  if (window.OrbitalStockHomeReady || location.pathname.startsWith('/simple/')) return;
  const records = new Set(), sections = new WeakMap(), payloads = new WeakMap(), apis = new WeakSet();
  let active = null;
  function routeMatches() {
    const [path, query = ''] = location.hash.split('?');
    const params = new URLSearchParams(query);
    return (new URLSearchParams(location.search).get('orbital') === 'off' || params.get('orbitalBrowse') === 'all') && path === '#/home' && Number(params.get('tab') || 0) === 0;
  }
  function retained(record) {
    if (!record || record.destroyed || record.api !== window.ApiClient || !record.root.isConnected || record.root.parentElement !== record.host || record.root.querySelector('.sections') !== record.sections) return false;
    try { return record.api.getCurrentUserId() === record.user && record.api.serverId?.() === record.server && record.api.accessToken?.() === record.credential; } catch (_) { return false; }
  }
  const current = op => !!op && retained(op.record) && routeMatches() && location.hash === op.owner.route && op.record.current === op;
  function fail(op) {
    op.failed = true;
    if (current(op)) { op.record.root.dataset.phase = 'error';void window.OrbitalPageReady?.fail('Home could not finish loading. Please retry.'); }
  }
  function finish(op) {
    if (!current(op) || !op.helperDone || op.pending || !op.metadata) return;
    if (op.failed) { fail(op);return; }
    const record = op.record, root = record.root;
    record.loaded = true;record.metadata = true;
    record.sections.querySelectorAll('.orbital-stock-home-empty').forEach(node => node.remove());
    if (![...record.sections.children].some(node => node.getBoundingClientRect().height > 0)) {
      const note = document.createElement('p');note.className = 'orbital-stock-home-empty';note.setAttribute('role', 'status');note.textContent = 'No Home content to display. Choose sections in your Home settings.';record.sections.append(note);
    }
    root.dataset.pageReadyRoute = op.owner.route;root.dataset.pageReadyUser = record.user;root.dataset.phase = 'complete';
    const ticket = window.OrbitalPageReady?.begin(op.owner.route);
    if (op.prepared === ticket) return;
    op.prepared = ticket;
    void window.OrbitalPageReady?.prepare(root, { ...op.owner, root, host: record.host, valid: () => current(op) && !op.failed && !op.pending && op.helperDone });
  }
  function observeApi(api) {
    if (apis.has(api) || typeof api.getCurrentUser !== 'function') return;
    apis.add(api);
    const original = api.getCurrentUser;
    api.getCurrentUser = function (...args) {
      const op = active?.record.api === api ? active : null, value = original.apply(this, args);
      if (op) Promise.resolve(value).then(user => {
        if (!user || typeof user !== 'object' || user.Id !== op.record.user) { fail(op);return; }
        const prior = payloads.get(user);
        if (prior && prior !== op && !prior.helperDone) { fail(prior);fail(op);return; }
        payloads.set(user, op);op.metadata = true;
      }, () => fail(op));
      return value;
    };
  }
  function within(op, fn, receiver, args) {
    const previous = active;active = op;
    try { return fn.apply(receiver, args); } finally { active = previous; }
  }
  function decorateControllerRequire(original) {
    let proxy;
    return new Proxy(original, { apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args);
      if (args[0] !== 65126) return value;
      if (proxy) return proxy;
      proxy = new Proxy(value, { get(object, name, receiver) {
        if (name !== 'Ay') return Reflect.get(object, name, receiver);
        return new Proxy(object.Ay, { get(helper, method, receiver) {
          const fn = Reflect.get(helper, method, receiver);
          if (!['loadSections', 'resume'].includes(method) || typeof fn !== 'function') return fn;
          return function (...args) {
            const record = sections.get(args[0]), op = method === 'loadSections' ? payloads.get(args[2]) : active;
            const owned = !!op && op.record === record && (method !== 'loadSections' || args[1] === record.api && op.metadata);
            if (!owned && record?.current) fail(record.current);
            const value = within(owned ? op : null, fn, helper, args);
            if (owned && (method === 'loadSections' || record.loaded)) Promise.resolve(value).then(() => {
              if (record.current !== op) { if (retained(record)) fail(record.current);return; }
              op.helperDone = true;
              if (retained(record) && op.metadata && !op.failed && !op.pending) { record.loaded = true;record.metadata = true; }
              finish(op);
            }, () => fail(op));
            return value;
          };
        } });
      } });
      return proxy;
    } });
  }
  function decorateSectionRequire(original) {
    let proxy;
    return new Proxy(original, { apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args);
      if (args[0] !== 53678) return value;
      if (proxy) return proxy;
      proxy = new Proxy(value, { get(object, name, receiver) {
        if (name !== 'q') return Reflect.get(object, name, receiver);
        return new Proxy(object.q, { get(client, method, receiver) {
          const fn = Reflect.get(client, method, receiver);
          if (method !== 'fetchQuery' || typeof fn !== 'function') return fn;
          return function (...args) {
            const key = args[0]?.queryKey, list = active ? [active] : [...records].map(record => record.current).filter(op => op && retained(op.record) && key?.[0] === 'User' && key[1] === op.record.user), value = fn.apply(client, args);
            if (list.length) {
              list.forEach(op => op.pending++);
              Promise.resolve(value).then(data => {
                for (const op of list) {
                  op.pending--;
                  if (key?.[0] !== 'User' || key[1] !== op.record.user || !(key[2] === 'LatestMedia' ? Array.isArray(data) : Array.isArray(data?.Items))) fail(op);
                  finish(op);
                }
              }, () => { for (const op of list) { op.pending--;fail(op); } });
            }
            return value;
          };
        } });
      } });
      return proxy;
    } });
  }
  window.OrbitalStockHooks?.register(65126, () => null, decorateSectionRequire);
  window.OrbitalStockHooks?.register(84595, exports => {
    const Original = exports.default;
    if (typeof Original !== 'function') return null;
    const Wrapped = new Proxy(Original, { construct(target, args, newTarget) {
      const controller = Reflect.construct(target, args, newTarget), root = controller.view, api = controller.apiClient;
      try {
        const user = api?.getCurrentUserId(), server = api?.serverId?.(), credential = api?.accessToken?.(), container = controller.sectionsContainer;
        if (!root || !container || !user || user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')) return controller;
        const record = { api, user, server, credential, root, host: root.parentElement, sections: container, current: null, loaded: false, metadata: false, destroyed: false };
        records.add(record);sections.set(container, record);observeApi(api);
        const onResume = controller.onResume, destroy = controller.destroy;
        controller.onResume = function (...args) {
          let op = record.current;
          if (retained(record) && routeMatches() && (!controller.sectionsRendered || record.loaded || !op)) {
            op = { record, owner: { api, user, server, credential, route: location.hash }, metadata: record.metadata, pending: 0, helperDone: false, failed: false };
            record.current = op;root.dataset.phase = 'loading';root.dataset.presentable = 'pending';window.OrbitalPageReady?.begin(op.owner.route);
          }
          return within(op, onResume, this, args);
        };
        controller.destroy = function (...args) { record.destroyed = true;records.delete(record);return destroy.apply(this, args); };
      } catch (_) { /* Unsupported controller: no receipt. */ }
      return controller;
    } });
    return new Proxy(exports, { get(target, name, receiver) { return name === 'default' ? Wrapped : Reflect.get(target, name, receiver); } });
  }, decorateControllerRequire);
  window.addEventListener('orbital:page-retry', event => {
    if (routeMatches() && event.detail?.route === location.hash && [...records].some(record => current(record.current))) location.reload();
  });
  window.OrbitalStockHomeReady = { route: '#/home', presentationOnly: true };
}());

/* Exact stock Guide read/DOM commit receipts; no requests or player changes. */
(function () {
  'use strict';
  if (window.OrbitalStockGuideReady || location.pathname.startsWith('/simple/')) return;
  const records = new Set();
  let active = null;
  function routeMatches() {
    const [path, query = ''] = location.hash.split('?');
    const tab = new URLSearchParams(query).get('tab');
    return new URLSearchParams(location.search).get('orbital') === 'off' && path === '#/livetv' && (tab === null || tab === '1');
  }
  function retained(record) {
    if (!record || record.destroyed || window.ApiClient !== record.api || !record.element.isConnected || record.element.parentElement !== record.host || !record.page.isConnected || record.page.parentElement !== record.pageHost || !record.page.contains(record.element)) return false;
    try { return record.api.getCurrentUserId() === record.user && record.api.serverId?.() === record.server && record.api.accessToken?.() === record.credential; } catch (_) { return false; }
  }
  const current = record => retained(record) && routeMatches() && location.hash === record.route && !record.page.classList.contains('hide') && [...record.pageHost.querySelectorAll('[id="liveTvPage"]')].filter(page => !page.classList.contains('hide')).length === 1;
  function fail(record, cycle) {
    cycle.failed = true;
    if (current(record)) { record.element.dataset.phase = 'error';void window.OrbitalPageReady?.fail('The Guide could not finish loading. Please retry.'); }
  }
  function begin(record, info) {
    const cycle = { info, pending: 0, channelsRequested: false, programsRequested: false, channels: null, programs: null, failed: record.poisoned, complete: false, ticket: null };
    record.cycle = cycle;
    if (current(record)) { record.element.dataset.phase = 'loading';record.element.dataset.presentable = 'pending';window.OrbitalPageReady?.begin(record.route); }
    return cycle;
  }
  function finish(record, cycle) {
    if (!current(record) || record.cycle !== cycle || cycle.failed || cycle.pending || !cycle.info || !cycle.channels || !cycle.programs) return;
    const element = record.element, channels = element.querySelector('.channelsContainer'), grid = element.querySelector('.programGrid'), headers = element.querySelector('.timeslotHeaders');
    if (!channels || !grid || !headers || channels.querySelectorAll('.guide-channelHeaderCell').length !== cycle.channels.Items.length || grid.querySelectorAll('.channelPrograms').length !== cycle.channels.Items.length || !headers.querySelectorAll('.timeslotHeader').length || !element.querySelectorAll('.guide-date-tab-button').length) return;
    grid.querySelectorAll('.orbital-stock-guide-empty').forEach(node => node.remove());
    if (!cycle.channels.Items.length) { const note = document.createElement('p');note.className = 'orbital-stock-guide-empty';note.setAttribute('role', 'status');note.textContent = 'No channels are available for this Guide view.';grid.append(note); }
    cycle.complete = true;
    const ticket = window.OrbitalPageReady?.begin(record.route);
    if (cycle.ticket === ticket) return;
    cycle.ticket = ticket;element.dataset.pageReadyRoute = record.route;element.dataset.pageReadyUser = record.user;element.dataset.phase = 'complete';
    void window.OrbitalPageReady?.prepare(element, { ...record, root: element, host: record.host, valid: () => current(record) && record.cycle === cycle && cycle.complete && !cycle.failed && !cycle.pending });
  }
  function read(record, method, fn, args) {
    let cycle = record.cycle;
    if (method === 'getLiveTvGuideInfo') {
      if (cycle && !cycle.complete) record.poisoned = true;
      cycle = begin(record, false);
    } else if (method === 'getLiveTvChannels') {
      if (!cycle || cycle.complete) cycle = begin(record, record.info);
      else if (cycle.channelsRequested || !cycle.info) { record.poisoned = true;cycle.failed = true; }
      cycle.channelsRequested = true;
      if (args[0]?.UserId !== record.user) cycle.failed = true;
    } else {
      if (!cycle) cycle = begin(record, false);
      if (!cycle.channels || cycle.programsRequested || args[0]?.UserId !== record.user || args[0]?.channelIds !== cycle.channels.Items.map(item => item.Id).join(',')) cycle.failed = true;
      cycle.programsRequested = true;
    }
    const value = fn.apply(record.api, args);
    cycle.pending++;
    Promise.resolve(value).then(data => {
      cycle.pending--;
      let valid;
      if (method === 'getLiveTvGuideInfo') {
        valid = !!data && Number.isFinite(Date.parse(data.StartDate)) && Number.isFinite(Date.parse(data.EndDate)) && Date.parse(data.EndDate) > Date.parse(data.StartDate);
        if (valid) { cycle.info = true;record.info = true; }
      } else if (method === 'getLiveTvChannels') {
        valid = Array.isArray(data?.Items) && data.Items.every(item => item?.Id && item.ImageTags && typeof item.ImageTags === 'object') && new Set(data.Items.map(item => item.Id)).size === data.Items.length;
        if (valid) cycle.channels = data;
      } else {
        valid = Array.isArray(data?.Items) && data.Items.every(item => item?.ChannelId && Number.isFinite(Date.parse(item.StartDate)) && Number.isFinite(Date.parse(item.EndDate)) && Date.parse(item.EndDate) > Date.parse(item.StartDate));
        if (valid) cycle.programs = data;
      }
      if (!valid || cycle.failed) fail(record, cycle);
      // This observer is registered before the pinned controller's consumer.
      // Its queued microtask runs after that consumer commits all three grids.
      queueMicrotask(() => finish(record, cycle));
    }, () => { cycle.pending--;fail(record, cycle); });
    return value;
  }
  function decorateRequire(original) {
    let proxy;
    return new Proxy(original, { apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args);
      if (args[0] !== 67430) return value;
      if (proxy) return proxy;
      proxy = new Proxy(value, { get(object, name, receiver) {
        if (name !== 'tF') return Reflect.get(object, name, receiver);
        return new Proxy(object.tF, { get(manager, method, receiver) {
          const fn = Reflect.get(manager, method, receiver);
          if (method !== 'getApiClient' || typeof fn !== 'function') return fn;
          return function (...args) {
            const api = fn.apply(manager, args), candidates = [...records].filter(record => retained(record) && record.server === args[0]), record = active || (candidates.length === 1 ? candidates[0] : null);
            if (!record || record.api !== api) return api;
            if (!record.proxy) record.proxy = new Proxy(api, { get(target, method, receiver) {
              const fn = Reflect.get(target, method, receiver);
              if (['getLiveTvGuideInfo', 'getLiveTvChannels', 'getLiveTvPrograms'].includes(method) && typeof fn === 'function') return function (...args) { return read(record, method, fn, args); };
              return typeof fn === 'function' ? fn.bind(target) : fn;
            } });
            return record.proxy;
          };
        } });
      } });
      return proxy;
    } });
  }
  window.OrbitalStockHooks?.register(36934, (exports, require) => {
    const Original = exports.A, manager = require(67430).tF;
    if (typeof Original !== 'function') return null;
    const Wrapped = new Proxy(Original, { construct(target, args, newTarget) {
      const options = args[0], api = manager.getApiClient(options?.serverId), element = options?.element, page = element?.closest('[id="liveTvPage"]');
      let record = null;
      try {
        const user = api?.getCurrentUserId(), server = api?.serverId?.(), credential = api?.accessToken?.();
        if (routeMatches() && api === window.ApiClient && user && user !== (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-') && server === options.serverId && element?.isConnected && page?.contains(element)) {
          record = { api, user, server, credential, route: location.hash, element, page, pageHost: page.parentElement, host: element.parentElement, destroyed: false, poisoned: false, info: false, cycle: null };
          for (const old of records) if (!old.element.isConnected || old.destroyed) records.delete(old);
          records.add(record);
        }
      } catch (_) { /* Unsupported ownership: stock remains unchanged. */ }
      const previous = active;active = record;
      let controller;
      try { controller = Reflect.construct(target, args, newTarget); } finally { active = previous; }
      if (record) {
        const resume = controller.resume, destroy = controller.destroy;
        controller.resume = function (...args) { const value = resume.apply(this, args);if (record.cycle) { const cycle = record.cycle;queueMicrotask(() => finish(record, cycle)); }return value; };
        controller.destroy = function (...args) { record.destroyed = true;records.delete(record);return destroy.apply(this, args); };
      }
      return controller;
    } });
    return new Proxy(exports, { get(target, name, receiver) { return name === 'A' ? Wrapped : Reflect.get(target, name, receiver); } });
  }, decorateRequire);
  window.OrbitalStockGuideReady = { route: '#/livetv?tab=1', presentationOnly: true };
}());

/* Pinned stock Queue/Lyrics data and DOM completion; no playback authority. */
(function () {
  'use strict';
  if(window.OrbitalQueueLyricsReady||location.pathname.startsWith('/simple/'))return;
  const owners=new WeakMap(),sdkOwners=new WeakMap();let manager=null;
  const routes={queue:'#/queue',lyrics:'#/lyrics'},selectors={queue:'#nowPlayingPage',lyrics:'#lyricPage'};
  const later=fn=>queueMicrotask(()=>queueMicrotask(()=>queueMicrotask(fn)));
  function active(kind){return owners.get(document.querySelector(selectors[kind]+':not(.hide)'));}
  function current(o){
    if(!o||!o.shown||location.hash!==o.route||location.hash.split('?')[0]!==routes[o.kind]||window.ApiClient!==o.api||!o.root.isConnected||o.root.parentElement!==o.host||o.root.classList.contains('hide')||document.querySelectorAll(selectors[o.kind]+':not(.hide)').length!==1||document.querySelector(selectors[o.kind]+':not(.hide)')!==o.root||owners.get(o.root)!==o)return false;
    try{return o.api.getCurrentUserId()===o.user&&o.api.serverId?.()===o.server&&o.api.accessToken?.()===o.credential;}catch{return false;}
  }
  function snapshot(o,player){
    try{const state=manager.getPlayerState(player),item=state?.NowPlayingItem;return player&&item?.Id&&item.ServerId===o.server?{player,id:item.Id,source:state.MediaSource?.Id||null,name:item.Name,item}:null;}catch{return null;}
  }
  function retained(p){
    if(!p||!current(p.owner)||p.owner.op!==p||manager?.getCurrentPlayer?.()!==p.player)return false;
    const s=snapshot(p.owner,p.player);return !!s&&s.id===p.id&&s.source===p.source;
  }
  function begin(o,proof){
    o.complete=false;o.root.dataset.phase='loading';o.root.dataset.presentable='pending';window.OrbitalPageReady?.begin(o.route);
    const p={...proof,owner:o,revision:++o.sequence,pending:0,itemReads:0,userRead:false,playlist:null,playlistRevision:0,failed:false,domRevision:o.domRevision};o.op=p;return p;
  }
  function fail(o,p){if(current(o)&&(!p||o.op===p)){o.complete=false;if(p)p.failed=true;o.root.dataset.phase='error';void window.OrbitalPageReady?.fail('This page could not finish loading. Please retry.');}}
  function obsoleteLyrics(p){later(()=>{const o=active('lyrics');if(current(o)&&o.op!==p)fail(o,o.op);});}
  function publish(o,p,valid){
    if(o.complete||!current(o)||p&&(!retained(p)||p.failed)||!valid())return;
    o.complete=true;o.root.dataset.phase='complete';o.root.dataset.pageReadyRoute=o.route;o.root.dataset.pageReadyUser=o.user;
    void window.OrbitalPageReady?.prepare(o.root,{api:o.api,user:o.user,server:o.server,credential:o.credential,route:o.route,root:o.root,host:o.host,valid:()=>o.complete&&current(o)&&(!p||retained(p)&&!p.failed)&&valid()});
  }
  function rowsMatch(p){
    const rows=[...p.owner.root.querySelectorAll('.playlist .listItem')];
    return Array.isArray(p.playlist)&&rows.length===p.playlist.length&&rows.every((r,i)=>r.getAttribute('data-id')===p.playlist[i].Id&&r.getAttribute('data-playlistitemid')===String(p.playlist[i].PlaylistItemId));
  }
  function queueDom(p){
    const root=p.owner.root,slots=[...root.querySelectorAll('.nowPlayingPageUserDataButtonsTitle,.nowPlayingPageUserDataButtons')];
    return slots.length===2&&slots.every(s=>s.querySelector('button[data-id]')?.getAttribute('data-id')===p.id)&&root.querySelector('.nowPlayingInfoContainerMedia')?.textContent.includes(p.name)&&rowsMatch(p)&&!!root.querySelector('.btnToggleContextMenu');
  }
  function finishQueue(p){
    if(!retained(p)||p.failed||p.pending||p.itemReads!==2||!p.userRead||p.playlist===null)return;
    if(!queueDom(p)){fail(p.owner,p);return;}
    publish(p.owner,p,()=>queueDom(p)&&manager.getCurrentPlaylistItemId(p.player)===p.playlistSelection);
  }
  function observed(value,p,success){
    p.pending++;
    Promise.resolve(value).then(result=>{p.pending--;if(!retained(p)){if(current(p.owner)&&p.owner.op!==p)later(()=>fail(p.owner,p.owner.op));return;}try{success(result);}catch{fail(p.owner,p);}later(()=>finishQueue(p));},()=>{p.pending--;if(retained(p))fail(p.owner,p);});
    return value;
  }
  function emptyQueue(o){
    later(()=>{if(o.complete||!current(o)||manager?.getCurrentPlayer?.())return;
      const box=o.root.querySelector('.playlist');if(!box){fail(o);return;}box.replaceChildren();const note=document.createElement('p');note.className='orbitalQueueEmpty';note.textContent='Nothing is playing. Start a title to see the queue.';box.append(note);box.classList.remove('hide');
      for(const node of o.root.querySelectorAll('.nowPlayingPageTitle,.nowPlayingSongName,.nowPlayingAlbum,.nowPlayingArtist,.nowPlayingEpisode,.nowPlayingSeason,.nowPlayingSerie,.nowPlayingPageUserDataButtonsTitle,.nowPlayingPageUserDataButtons,.nowPlayingPageImageContainer'))node.replaceChildren();
      publish(o,null,()=>!manager?.getCurrentPlayer?.()&&box.querySelector('.orbitalQueueEmpty')===note&&!o.root.querySelector('.nowPlayingInfoContainerMedia').textContent.trim()&&!o.root.querySelector('.nowPlayingPageUserDataButtonsTitle').children.length&&!o.root.querySelector('.nowPlayingPageUserDataButtons').children.length);
    });
  }
  function lyricsDom(p){
    const box=p.owner.root.querySelector('.lyricsContainer');if(!box||p.owner.domRevision<=p.domRevision)return false;
    if(p.lines.length===0)return box.children.length===1&&box.firstElementChild.tagName==='H1'&&!!box.firstElementChild.textContent.trim();
    const rows=[...box.querySelectorAll('.lyricsLine')];return rows.length===p.lines.length&&rows.every((r,i)=>r.id==='lyricPosition'+i&&r.textContent.trim()===p.lines[i].Text.trim()&&(p.lines[i].Start===undefined?r.getAttribute('data-lyrictime')===null:r.getAttribute('data-lyrictime')===String(p.lines[i].Start)));
  }
  function finishLyrics(p){if(retained(p)&&!p.failed&&Array.isArray(p.lines)&&lyricsDom(p))publish(p.owner,p,()=>lyricsDom(p));}
  function decorate(kind){return function(require){const cache=new Map();return new Proxy(require,{apply(target,thisArg,args){
    const exp=Reflect.apply(target,thisArg,args),id=args[0];if(cache.has(id))return cache.get(id);
    function namespace(key,value){const out=new Proxy(exp,{get:(t,k,r)=>k===key?value:Reflect.get(t,k,r)});cache.set(id,out);return out;}
    if(id===68221&&exp?.f){manager=exp.f;let proxy;proxy=new Proxy(manager,{get(t,k,r){
      if(k==='getCurrentPlayer')return function(...a){const result=Reflect.apply(t[k],this===proxy?t:this,a),o=active(kind);if(current(o)&&kind==='queue'&&!result)emptyQueue(o);return result;};
      if(k==='getPlayerState')return function(...a){const result=Reflect.apply(t[k],this===proxy?t:this,a),o=active(kind);if(current(o)&&a[0]&&result?.NowPlayingItem?.Id&&result.NowPlayingItem.ServerId===o.server){const s={player:a[0],id:result.NowPlayingItem.Id,source:result.MediaSource?.Id||null,name:result.NowPlayingItem.Name,item:result.NowPlayingItem};if(!o.op||o.op.player!==s.player||o.op.id!==s.id||o.op.source!==s.source)begin(o,s);}return result;};
      if(k==='getPlaylist'&&kind==='queue')return function(...a){const o=active(kind),p=o?.op,result=Reflect.apply(t[k],this===proxy?t:this,a);if(retained(p)&&(a[0]===undefined||a[0]===p.player)){const rev=++p.playlistRevision;p.playlist=null;o.complete=false;o.root.dataset.phase='loading';window.OrbitalPageReady?.begin(o.route);observed(result,p,items=>{
        if(rev!==p.playlistRevision){later(()=>fail(o,p));return;}
        if(!Array.isArray(items)||items.some(i=>!i?.Id||i.ServerId!==o.server||i.PlaylistItemId==null))throw Error('Queue schema');p.playlist=items.map(i=>({Id:i.Id,PlaylistItemId:i.PlaylistItemId}));p.playlistSelection=manager.getCurrentPlaylistItemId(p.player);
        if(!items.length)later(()=>{if(retained(p)&&rev===p.playlistRevision){const box=o.root.querySelector('.playlist');box.replaceChildren();const n=document.createElement('p');n.className='orbitalQueueEmpty';n.textContent='The queue is empty.';box.append(n);finishQueue(p);}});
      });}return result;};
      return Reflect.get(t,k,r);
    }});return namespace('f',proxy);}
    if(id===67430&&exp?.tF){const connection=exp.tF,key=kind==='queue'?'getApiClient':'getApi';let proxy;proxy=new Proxy(connection,{get(t,k,r){if(k!==key)return Reflect.get(t,k,r);return function(...a){
      const api=Reflect.apply(t[k],this===proxy?t:this,a),o=active(kind);if(!current(o)||a[0]!==o.server)return api;
      if(kind==='lyrics'){if(api&&o.op)sdkOwners.set(api,o.op);return api;}
      if(api!==o.api)return api;let p=o.op;const s=snapshot(o,manager.getCurrentPlayer());if(!s)return api;if(!retained(p)||p.itemReads||p.pending)p=begin(o,s);
      let apiProxy;apiProxy=new Proxy(api,{get(t,k,r){if(k!=='getItem'&&k!=='getCurrentUser')return Reflect.get(t,k,r);return function(...a){
        const result=Reflect.apply(t[k],this===apiProxy?t:this,a);if(!retained(p))return result;
        if(k==='getItem'&&a[0]===o.user&&a[1]===p.id)observed(result,p,item=>{if(item?.Id!==p.id||item.ServerId!==o.server)throw Error('Item identity');p.itemReads++;});
        if(k==='getCurrentUser')observed(result,p,user=>{if(user?.Id!==o.user)throw Error('User identity');p.userRead=true;});return result;
      };}});return apiProxy;
    };}});return namespace('tF',proxy);}
    if(kind==='lyrics'&&id===37257&&typeof exp?.e==='function'){const original=exp.e;return namespace('e',function(...a){const client=Reflect.apply(original,this,a),p=sdkOwners.get(a[0]);if(!p||typeof client?.getLyrics!=='function')return client;let proxy;proxy=new Proxy(client,{get(t,k,r){if(k!=='getLyrics')return Reflect.get(t,k,r);return function(...a){
      const value=Reflect.apply(t[k],this===proxy?t:this,a);if(a[0]?.itemId!==p.id||!retained(p))return value;
      Promise.resolve(value).then(result=>{if(!retained(p)){obsoleteLyrics(p);return;}const lines=result?.data?.Lyrics;if(!Array.isArray(lines)||lines.some(l=>typeof l?.Text!=='string'||l.Start!==undefined&&(!Number.isFinite(l.Start)||l.Start<0))){fail(p.owner,p);return;}p.lines=lines.map(l=>({Text:l.Text,Start:l.Start}));later(()=>finishLyrics(p));},error=>{if(!retained(p)){obsoleteLyrics(p);return;}if(error?.isAxiosError===true&&error.response?.status===404){p.lines=[];later(()=>finishLyrics(p));}else fail(p.owner,p);});return value;
    };}});return proxy;});}
    return exp;
  }});};}
  function register(id,kind){window.OrbitalStockHooks?.register(id,exp=>{const Original=exp.default;if(typeof Original!=='function')return null;
    function before(args){const root=args[0],api=window.ApiClient;if(location.hash.split('?')[0]!==routes[kind]||!root?.matches(selectors[kind])||!root.isConnected||!api)return;
      try{const user=api.getCurrentUserId();if(!user||user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'))return;owners.get(root)?.observer.disconnect();const o={kind,api,user,server:api.serverId?.(),credential:api.accessToken?.(),route:location.hash,root,host:root.parentElement,sequence:0,domRevision:0,shown:false,complete:false};
        o.observer=new MutationObserver(records=>{o.domRevision+=records.length;if(kind==='lyrics'&&o.op)finishLyrics(o.op);});o.observer.observe(root,{childList:true,subtree:true,characterData:true});owners.set(root,o);
        root.addEventListener('viewshow',()=>{o.shown=true;o.route=location.hash;o.op=null;o.complete=false;o.sequence++;if(current(o)){root.dataset.phase='loading';root.dataset.presentable='pending';window.OrbitalPageReady?.begin(o.route);}});
        root.addEventListener('viewbeforehide',()=>{o.shown=false;o.complete=false;o.op=null;o.sequence++;root.dataset.phase='loading';root.dataset.presentable='pending';});
      }catch{}
    }
    const Wrapped=new Proxy(Original,{apply(t,that,args){before(args);return Reflect.apply(t,that,args);},construct(t,args,newTarget){before(args);return Reflect.construct(t,args,newTarget);}});return new Proxy(exp,{get:(t,k,r)=>k==='default'?Wrapped:Reflect.get(t,k,r)});
  },decorate(kind));}
  register(14250,'queue');register(29833,'lyrics');
  window.addEventListener('orbital:page-retry',e=>{for(const kind of ['queue','lyrics']){const o=active(kind);if(e.detail?.route===location.hash&&current(o))location.reload();}});
  window.OrbitalQueueLyricsReady={supported:['#/queue','#/lyrics'],evidence:'PINNED_STOCK_DATA_AND_DOM_COMPLETION_ONLY'};
}());

/* Presentation receipts for pinned stock settings renderers. No account writes. */
(function () {
  'use strict';
  if (window.OrbitalSettingsReady || location.pathname.startsWith('/simple/')) return;
  const contracts = {
    6062: ['default', '#/mypreferencesmenu', 'myPreferencesMenuPage', 'react'],
    69002: ['default', '#/mypreferencesdisplay', 'displayPreferencesPage', 'react'],
    13034: ['default', '#/quickconnect', 'quickConnectPreferencesPage', 'react'],
    92202: ['default', '#/userprofile', 'userProfilePage', 'react'],
    25235: ['A', '#/userprofile', 'userProfilePage', 'react-child'],
    84192: ['default', '#/mypreferencescontrols', 'controlsPreferencesPage', 'legacy'],
    48955: ['default', '#/mypreferenceshome', 'homeScreenPreferencesPage', 'legacy'],
    47490: ['default', '#/mypreferencesplayback', 'languagePreferencesPage', 'legacy'],
    9273: ['default', '#/mypreferencessubtitles', 'homeScreenPreferencesPage', 'legacy']
  };
  const records = new Set(), apiObservers = new WeakMap(), promises = new WeakMap();
  let active = null, sequence = 0;
  const path = () => location.hash.split('?')[0];
  function identity() {
    const api = window.ApiClient;
    try { return { api, user: api?.getCurrentUserId?.(), server: api?.serverId?.(), credential: api?.accessToken?.(), route: location.hash }; }
    catch (_) { return null; }
  }
  function retained(record) {
    const who = identity();
    return !!who && !!record && !record.destroyed && who.api === record.api && who.user === record.user && who.server === record.server && who.credential === record.credential;
  }
  const current = record => retained(record) && location.hash === record.route && path() === record.contract[1] && (!record.root || record.root.isConnected && (!record.host || record.root.parentElement === record.host) && !record.root.classList.contains('hide'));
  function locate(record) {
    const root = document.getElementById(record.contract[2]);
    if (!root?.isConnected || root.classList.contains('hide')) return false;
    if (record.root && record.root !== root) return false;
    record.root = root;record.host ||= root.parentElement;
    return root.parentElement === record.host;
  }
  function capture(contract, root) {
    const who = identity();
    if (!who?.api || !who.user || who.user === (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-') || path() !== contract[1]) return null;
    const record = { ...who, contract, root: root || null, host: root?.parentElement || null, pending: 0, reads: Object.create(null), failed: false, destroyed: false, committed: false, generation: ++sequence, scheduled: false, prepared: null };
    records.add(record);observeApi(record.api);return record;
  }
  function matching() {
    if (active && current(active)) return [active];
    return [...records].filter(record => current(record) || retained(record) && !record.prepared && (!record.root || record.root.isConnected && record.root.parentElement === record.host));
  }
  function pending(record, label) {
    if (!record || record.destroyed) return;
    record.pending++;record.reads[label] = (record.reads[label] || 0) + 1;record.prepared = null;record.failedTicket = null;
    if (current(record) && record.root) { record.root.dataset.phase = 'loading';record.root.dataset.presentable = 'pending';window.OrbitalPageReady?.begin(record.route); }
  }
  function observe(value, label, list = matching(), validate) {
    if (!value || typeof value.then !== 'function') return value;
    let receipt = promises.get(value);
    if (!receipt) {
      receipt = { then: value.then, records: new Set() };promises.set(value, receipt);
      // Stock keeps the exact promise and chain result. Track its own continuations,
      // including nested initialization errors after the original read fulfills.
      try { const chained = function (...callbacks) {
        const owners = [...receipt.records].filter(retained);
        const wrapped = callbacks.map(callback => typeof callback !== 'function' ? callback : function (...args) {
          const previous = active;active = owners.find(current) || owners[0] || previous;
          try { return callback.apply(this, args); }
          catch (error) { owners.forEach(record => { record.failed = true;schedule(record); });throw error; }
          finally { active = previous;owners.forEach(schedule); }
        });
        return observe(receipt.then.apply(this, wrapped), 'continuation', owners);
      };value.then = chained;if (value.then !== chained) list.forEach(record => { record.failed = true; }); }
      catch (_) { list.forEach(record => { record.failed = true; }); }
    }
    list.forEach(record => { if (!receipt.records.has(record)) { receipt.records.add(record);pending(record, label); }else record.reads[label] = (record.reads[label] || 0) + 1; });
    const newly = list.filter(record => !receipt.observed?.has(record));receipt.observed ||= new Set();newly.forEach(record => receipt.observed.add(record));
    // Observe the same promise; the stock caller receives it unchanged.
    receipt.then.call(value, result => {
      for (const record of newly) { record.pending--;if (validate && !validate(result)) record.failed = true;schedule(record); }
    }, () => {
      for (const record of newly) { record.pending--;record.failed = true;schedule(record); }
    });
    return value;
  }
  function observeApi(api) {
    if (apiObservers.has(api)) return;
    const saved = new Map();apiObservers.set(api, saved);
    for (const name of ['getUser', 'getCurrentUser', 'getSystemInfo', 'getCultures', 'getEndpointInfo', 'getJSON', 'getDisplayPreferences']) {
      const original = api[name];if (typeof original !== 'function') continue;
      const wrapped = function (...args) {
        const list = matching().filter(record => record.api === api);
        return observe(original.apply(this, args), name, list, name === 'getUser' ? value => value?.Id === args[0] : undefined);
      };
      try { api[name] = wrapped;if (api[name] === wrapped) saved.set(name, original); } catch (_) { /* Unwritable reads cannot create a receipt; semantics still gate the page. */ }
    }
  }
  function semantic(record) {
    const root = record.root, kind = record.contract[1], q = selector => root.querySelector(selector);
    if (kind === '#/mypreferencesmenu') return !!q('.headerUsername')?.textContent.trim() && !!q('.lnkDisplayPreferences') && !!q('.lnkHomePreferences') && !!q('.btnLogout');
    if (kind === '#/mypreferencesdisplay') return !!q('form') && !!q('[name="libraryPageSize"]') && !!q('[name="enableLibraryBackdrops"]');
    if (kind === '#/quickconnect') return !!q('form') && (!!q('#txtQuickConnectCode') || !!q('a[href="#/home"]'));
    if (kind === '#/userprofile') return !!q('.username')?.textContent.trim() && !!q('#image')?.style.backgroundImage && !!q('.passwordSection') && !!q('#txtNewPasswordConfirm') && !!record.userMetadata && (record.reads.authCurrentUser || 0) >= 2;
    if (kind === '#/mypreferencescontrols') return record.shown && !!q('.btnSave:not(.hide)') && !!q('.chkEnableGamepad') && !!q('.chkSmoothScroll');
    if (kind === '#/mypreferenceshome') return !!q('.folderGroupList .checkboxList') && !!q('.viewOrderList') && !!q('.perLibrarySettings') && !!record.reads.fetchQuery && !!record.reads.getJSON && !!record.reads.setUserInfo;
    if (kind === '#/mypreferencesplayback') return !!q('#selectAudioLanguage option') && !!record.reads.getSystemInfo && !!record.reads.getCultures && !!record.reads.setUserInfo;
    if (kind === '#/mypreferencessubtitles') return !!q('#selectSubtitleLanguage option') && !!q('#selectSubtitleStyling') && !!record.reads.getCultures && !!record.reads.setUserInfo;
    return false;
  }
  async function finish(record) {
    record.scheduled = false;
    if (!current(record) || !locate(record)) return;
    if (record.failed) { const ticket = window.OrbitalPageReady?.begin(record.route);if (record.failedTicket === ticket) return;record.failedTicket = ticket;record.root.dataset.phase = 'error';void window.OrbitalPageReady?.fail('This settings page could not finish loading. Please retry.', ticket);return; }
    if (!record.committed || record.pending || contractContextPending(record) || !semantic(record)) return;
    const ticket = window.OrbitalPageReady?.begin(record.route);
    if (record.prepared === ticket) return;
    record.root.dataset.pageReadyRoute = record.route;record.root.dataset.pageReadyUser = record.user;record.root.dataset.phase = 'complete';record.prepared = ticket;
    void window.OrbitalPageReady?.prepare(record.root, { ...record, valid: () => current(record) && !record.pending && !record.failed && semantic(record) });
  }
  function schedule(record) {
    if (!record || record.scheduled || record.destroyed) return;
    record.scheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { void finish(record); }));
  }
  const contractContextPending = record => record.contract[3].startsWith('react') && (record.contextUser !== record.user || record.contextApi !== record.api);
  function contextIdentity(record, context) {
    if (!record) return;
    record.contextUser = context?.user?.Id;record.contextApi = context?.__legacyApiClient__;
    if (context?.user && context.user.Id !== record.user || record.contextApi && record.contextApi !== record.api) record.failed = true;
  }
  function within(record, fn, receiver, args) {
    const previous = active;active = record;
    try { return fn.apply(receiver, args); } finally { active = previous;schedule(record); }
  }
  function decorateRequire(original) {
    const cache = new Map();
    function decorate(id, value) {
      if (!value || typeof value !== 'object') return value;
      if (cache.has(id)) return cache.get(id);
      const methods = id === 89100 ? { Ay: ['getCurrentUser'] } : id === 53678 ? { q: ['fetchQuery'] } : null;
      let proxy = value;
      if (methods) proxy = new Proxy(value, { get(target, key) {
        const nested = target[key], names = methods[key];if (!names || !nested) return nested;
        return new Proxy(nested, { get(object, name) { const fn = object[name];return names.includes(name) && typeof fn === 'function' ? function (...args) { return observe(fn.apply(object, args), name === 'getCurrentUser' ? 'authCurrentUser' : name); } : typeof fn === 'function' ? fn.bind(object) : fn; } });
      } });
      else if (id === 95569) proxy = new Proxy(value, { get(target, key) {
        const fn = target[key];
        if (key === 'iA' && typeof fn === 'function') return function (...args) { return observe(fn.apply(this, args), 'setUserInfo'); };
        if (key === 'tl' && typeof fn === 'function') return new Proxy(fn, { construct(Type, args) { const object = Reflect.construct(Type, args);return new Proxy(object, { get(t, k) { const method = t[k];return k === 'setUserInfo' && typeof method === 'function' ? function (...a) { return observe(method.apply(t, a), 'setUserInfo'); } : typeof method === 'function' ? method.bind(t) : method; } }); } });
        return fn;
      } });
      else if (id === 63696) proxy = new Proxy(value, { get(target, key) {
        const fn = target[key];if (!['useEffect', 'useLayoutEffect'].includes(key) || typeof fn !== 'function') return fn;
        return function (callback, deps) { const record = active;return fn.call(target, () => within(record, callback, this, []), deps); };
      } });
      else if (id === 69410) proxy = new Proxy(value, { get(target, key) { const fn = target[key];if (key !== 'gf') return fn;return function (...args) { const context = fn.apply(this, args);contextIdentity(active, context);return context; }; } });
      else if (id === 32132) proxy = new Proxy(value, { get(target, key) { const fn = target[key];if (key !== 'Jd') return fn;return function (...args) { const result = fn.apply(this, args), record = active;if (record && result?.data) { const expected = new URLSearchParams(record.route.split('?')[1] || '').get('userId') || record.user;record.userMetadata = result.data.Id === expected && !!result.data.Policy && !!result.data.Configuration;if (!record.userMetadata) record.failed = true; }return result; }; } });
      else if (id === 9055) proxy = new Proxy(value, { get(target, key) { const fn = target[key];if (key !== 'ok') return fn;return function (...args) { const result = fn.apply(this, args), record = active;if (record && result?.[0]?.toString() !== new URLSearchParams(record.route.split('?')[1] || '').toString()) record.failed = true;return result; }; } });
      cache.set(id, proxy);return proxy;
    }
    return new Proxy(original, {
      apply(target, receiver, args) { return decorate(args[0], Reflect.apply(target, receiver, args)); },
      get(target, key) { const fn = target[key];return key === 'e' && typeof fn === 'function' ? function (...args) { return observe(fn.apply(target, args), 'chunk'); } : fn; }
    });
  }
  function wrap(exports, require, contract) {
    const original = exports[contract[0]], React = contract[3].startsWith('react') ? require(63696) : null;
    if (typeof original !== 'function') return exports;
    const replacement = function (...args) {
      if (contract[3].startsWith('react')) {
        const reference = React.useRef(null);
        if (!reference.current) reference.current = contract[3] === 'react-child' ? matching().find(record => record.contract[1] === contract[1]) || capture(contract) : capture(contract);
        const record = reference.current;contextIdentity(record, require(69410).gf?.());const result = within(record, original, this, args);
        React.useEffect(() => { if (record) { if (result?.props?.id === contract[2]) record.committed = true;schedule(record); } });
        React.useEffect(() => () => { if (record && contract[3] !== 'react-child') { record.destroyed = true;records.delete(record); } }, []);
        return result;
      }
      const root = args[0],record = capture(contract, root);
      if (record) {
        root.addEventListener('viewshow', () => { record.shown = true;record.committed = true;record.prepared = null;if (current(record)) { root.dataset.phase = 'loading';root.dataset.presentable = 'pending';window.OrbitalPageReady?.begin(record.route); }schedule(record); });
        root.addEventListener('viewdestroy', () => { record.destroyed = true;records.delete(record); }, { once: true });
      }
      return within(record, original, this, args);
    };
    return new Proxy(exports, { get(target, key) { return key === contract[0] ? replacement : target[key]; } });
  }
  for (const [id, contract] of Object.entries(contracts)) window.OrbitalStockHooks?.register(Number(id), (exports, require) => wrap(exports, require, contract), decorateRequire);
  new MutationObserver(() => records.forEach(schedule)).observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('hashchange', () => records.forEach(schedule));
  window.addEventListener('orbital:page-retry', event => { if (event.detail?.route === location.hash && Object.values(contracts).some(contract => contract[1] === path())) location.reload(); });
  window.OrbitalSettingsReady = { version: 1 };
}());

/* Stock Search presentation receipt: query success AND passive card DOM commit. */
(function(){
 'use strict';
 if(window.OrbitalStockSearchReady||location.pathname.startsWith('/simple/'))return;
 const SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'),records=new Map();let activeEffect=null;
 const route=()=>new URLSearchParams(location.search).get('orbital')==='off'&&location.hash.split('?')[0]==='#/search';
 function capture(context){
  const api=context?.__legacyApiClient__;if(!route()||!api||api!==window.ApiClient||!context.api)return null;
  try{const user=api.getCurrentUserId(),server=api.serverId?.(),credential=api.accessToken?.(),params=new URLSearchParams(location.hash.split('?')[1]||'');
   if(!user||user===SIMPLE||context.user?.Id!==user||params.get('serverId')&&params.get('serverId')!==server)return null;
   return {api,user,server,credential,modernApi:context.api,route:location.hash,parent:params.get('parentId')||undefined,collection:params.get('collectionType')||undefined,query:params.get('query')||''};
  }catch{return null;}
 }
 const same=(a,b)=>!!a&&!!b&&a.api===b.api&&a.modernApi===b.modernApi&&a.user===b.user&&a.server===b.server&&a.credential===b.credential;
 function current(r){if(!r||r.destroyed||!route()||r.route!==location.hash||r.api!==window.ApiClient)return false;try{return r.api.getCurrentUserId()===r.user&&r.api.serverId?.()===r.server&&r.api.accessToken?.()===r.credential;}catch{return false;}}
 const mounted=r=>current(r)&&r.root?.isConnected&&r.root.parentElement===r.host&&document.getElementById('searchPage')===r.root&&!r.root.classList.contains('hide');
 function matching(r,key){return Array.isArray(key)&&(r.query?key[0]==='Search'&&['Artists','People','Studios','Video','Programs','LiveTv','Items'].includes(key[1])&&key[2]===r.collection&&key[3]===r.parent&&key[4]===r.query.trim():key[0]==='SearchSuggestions'&&(key[1]?.parentId||undefined)===r.parent);}
 function queryState(r){
  const proofs=[...r.queries.values()];if(proofs.some(p=>p.enabled!==false&&p.error))return 'error';
  const primary=proofs.find(p=>r.query?p.key[0]==='Search'&&p.key[1]==='Items':p.key[0]==='SearchSuggestions');
  if(!primary||primary.enabled===false||!proofs.length||proofs.some(p=>p.enabled!==false&&(!p.success||p.pending||p.loading))||!Array.isArray(primary.data))return 'loading';
  if(r.query&&!primary.data.every(g=>typeof g?.title==='string'&&Array.isArray(g.items)&&g.items.length>0&&g.items.every(i=>typeof i?.Id==='string'&&!!i.Id)))return 'error';
  if(!r.query&&!primary.data.every(i=>typeof i?.Id==='string'&&!!i.Id&&typeof i.Name==='string'))return 'error';
  return 'complete';
 }
 const primary=r=>[...r.queries.values()].find(p=>r.query?p.key[0]==='Search'&&p.key[1]==='Items':p.key[0]==='SearchSuggestions');
 function cardsCurrent(r,group){
  return [...r.commits].some(([container,commit])=>commit.items===group.items&&container.isConnected&&r.root.contains(container)&&commit.nodes.length===group.items.length&&commit.nodes.every((node,index)=>node.isConnected&&container.contains(node)&&node.dataset.id===group.items[index].Id)&&container.querySelectorAll('.card[data-id]').length===group.items.length);
 }
 function rendered(r){
  if(!mounted(r)||queryState(r)!=='complete'||!r.root.querySelector('#searchTextInput'))return false;
  const data=primary(r).data;
  if(r.query)return data.length?data.every(group=>cardsCurrent(r,group)):!!r.root.querySelector('.noItemsMessage')?.textContent.trim();
  const list=r.root.querySelector('.searchSuggestionsList');return !!list&&!!r.root.querySelector('.searchSuggestions h2')?.textContent.trim()&&list.querySelectorAll('a').length===data.length&&data.every((item,index)=>list.querySelectorAll('a')[index].textContent===item.Name);
 }
 function fail(r){if(!mounted(r)||r.failedTicket===window.OrbitalPageReady?.begin(r.route))return;r.failed=true;r.root.dataset.phase='error';r.failedTicket=window.OrbitalPageReady?.begin(r.route);void window.OrbitalPageReady?.fail('Search could not finish loading. Please retry.');}
 function schedule(r){if(!r||r.queued)return;r.queued=true;queueMicrotask(()=>{
  r.queued=false;if(!mounted(r))return;
  r.root.dataset.pageReadyRoute=r.route;r.root.dataset.pageReadyUser=r.user;
  if(r.failed||queryState(r)==='error'){fail(r);return;}
  if(!rendered(r)){r.root.dataset.phase='loading';r.root.dataset.presentable='pending';window.OrbitalPageReady?.begin(r.route);return;}
  const ticket=window.OrbitalPageReady?.begin(r.route);if(r.prepared?.ticket===ticket&&r.prepared.generation===r.generation)return;
  const generation=r.generation;r.prepared={ticket,generation};r.root.dataset.phase='complete';
  void window.OrbitalPageReady?.prepare(r.root,{...r,valid:()=>mounted(r)&&!r.failed&&r.generation===generation&&rendered(r)});
 });}
 function decorateRequire(original){
  const cache=new Map(),React=original(63696),provider=original(69410);
  return new Proxy(original,{apply(target,receiver,args){const value=Reflect.apply(target,receiver,args),id=args[0];if(cache.has(id))return cache.get(id);
   if(id===63696&&typeof value.useEffect==='function'){
    const out=new Proxy(value,{get(object,key,receiver){const fn=Reflect.get(object,key,receiver);if(key!=='useEffect')return fn;
     return function(callback,deps){const owner=capture(provider.gf()),record=owner&&records.get(owner.route);return Reflect.apply(fn,this,[function(...args){const previous=activeEffect;activeEffect={owner,record};try{return Reflect.apply(callback,this,args);}finally{activeEffect=previous;}},deps]);};
    }});cache.set(id,out);return out;
   }
   if(id===87395&&typeof value.I==='function'){
    const out=new Proxy(value,{get(object,key,receiver){const fn=Reflect.get(object,key,receiver);if(key!=='I')return fn;
     return function(...args){const result=Reflect.apply(fn,this,args),owner=capture(provider.gf()),initial=React.useRef(null),token=React.useRef({}).current,key=args[0]?.queryKey;
      if(!initial.current&&owner)initial.current=owner;const r=owner&&records.get(owner.route),data=result?.data,success=result?.status==='success'&&result.isSuccess===true,pending=result?.isPending===true,loading=result?.isLoading===true,error=result?.status==='error'||result?.isError===true,enabled=args[0]?.enabled,fingerprint=JSON.stringify(key);
      React.useLayoutEffect(()=>{if(!same(initial.current,owner)||!current(r)||!same(r,owner)||!matching(r,key))return;const proof={key,data,success,pending,loading,error,enabled};r.queries.set(token,proof);r.generation++;r.prepared=null;schedule(r);return()=>{if(r.queries.get(token)===proof){r.queries.delete(token);r.generation++;r.prepared=null;schedule(r);}};},[r,fingerprint,data,success,pending,loading,error,enabled,owner?.api,owner?.modernApi,owner?.user,owner?.server,owner?.credential,owner?.route]);
      return result;
     };
    }});cache.set(id,out);return out;
   }
   if(id===24468&&typeof value.Ay?.buildCards==='function'){
    const cards=value.Ay;let cardProxy;cardProxy=new Proxy(cards,{get(object,name,receiver){const fn=Reflect.get(object,name,receiver);if(name!=='buildCards')return fn;
     return function(...args){const result=Reflect.apply(fn,this===cardProxy?cards:this,args),container=args[1]?.itemsContainer,record=[...records.values()].find(r=>mounted(r)&&container&&r.root.contains(container));
      if(record){const proof=activeEffect;if(!proof||proof.record!==record||!same(proof.owner,record)||!current(proof.record)){record.failed=true;fail(record);}else{record.commits.set(container,{items:args[0],nodes:[...container.querySelectorAll('.card[data-id]')]});record.generation++;record.prepared=null;schedule(record);}}
      return result;
     };
    }});const out=new Proxy(value,{get(object,key,receiver){return key==='Ay'?cardProxy:Reflect.get(object,key,receiver);}});cache.set(id,out);return out;
   }
   return value;
  }});
 }
 window.OrbitalStockHooks?.register(42111,(exports,require)=>{
  const Original=exports.default,React=require(63696),provider=require(69410);if(typeof Original!=='function')return null;
  function Page(...args){const owner=capture(provider.gf()),initial=React.useRef(null),reference=React.useRef(null);if(!initial.current&&owner)initial.current=owner;
   const result=Reflect.apply(Original,this,args),child=result?.props?.children?.[1],props=child?.props;
   if(owner&&same(initial.current,owner)&&result?.props?.id==='searchPage'&&props&&(props.query||'')===owner.query&&props.parentId===owner.parent&&(!owner.query||props.collectionType===owner.collection)){
    if(!reference.current||reference.current.route!==owner.route){const old=reference.current;if(old){old.destroyed=true;old.observer?.disconnect();records.delete(old.route);}reference.current={...owner,queries:new Map(),commits:new Map(),generation:0};records.set(owner.route,reference.current);}
   }else if(reference.current){reference.current.destroyed=true;reference.current.observer?.disconnect();records.delete(reference.current.route);reference.current=null;}
   const r=reference.current;
   React.useLayoutEffect(()=>{if(!current(r))return;const root=document.getElementById('searchPage');if(!root?.isConnected||root.classList.contains('hide'))return;r.root=root;r.host=root.parentElement;r.observer=new MutationObserver(()=>schedule(r));r.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-id','class']});schedule(r);return()=>{r.destroyed=true;r.observer.disconnect();if(records.get(r.route)===r)records.delete(r.route);};},[r]);
   return result;
  }
  return new Proxy(exports,{get(target,key,receiver){return key==='default'?Page:Reflect.get(target,key,receiver);}});
 },decorateRequire);
 window.addEventListener('orbital:page-retry',event=>{const r=records.get(location.hash);if(event.detail?.route===location.hash&&mounted(r))location.reload();});
 window.OrbitalStockSearchReady={supported:['#/search'],scope:'OFF_STOCK_QUERY_AND_PASSIVE_CARD_COMMIT_ONLY'};
}());

/* Geometry-only adapter. The existing owned model must release every row first. */
/* public build: a private provider module is not included here. */

/* Optional past-only history. It never establishes viewer or picture authority. */
/* public build: a private provider module is not included here. */

/* History consumes a released view. Its receipt never releases a play. */
/* public build: a private provider module is not included here. */

/* Viewer-local presentation estimate. Strict evidence remains a separate claim. */
/* public build: a private provider module is not included here. */

/* BEGIN ORBITAL CALIBRATION RECORDER */
/* public build: a private provider module is not included here. */
/* END ORBITAL CALIBRATION RECORDER */

/* BEGIN ORBITAL VIEWER MEDIA DIAGNOSTIC */
/* public build: a private provider module is not included here. */
/* END ORBITAL VIEWER MEDIA DIAGNOSTIC */

/* BEGIN ORBITAL HLS TRACE */
/* Frame cadence is software evidence, never physical display or ownership. */
/* public build: a private provider module is not included here. */

/* Browser-local receive -> remux sample -> completed append provenance.
 * Diagnostic only. No source ownership, semantic or physical-display authority.
 * Supported instrumentation: complete nonprogressive unencrypted AVC TS with
 * no carried video PES/NAL/sample data. Other paths explicitly remain unknown.
 */
/* public build: a private provider module is not included here. */

/* public build: a private provider module is not included here. */
/* END ORBITAL HLS TRACE */

/* BEGIN ORBITAL PRESENTATION TRACE */
(function(root){'use strict';
 function create(rendererId){
  let current=null,latest=null,sequence=0;
  const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
  return {
   activate(playSession,attempt,generation){latest=null;current=opaque(playSession)&&opaque(attempt)&&Number.isSafeInteger(generation)&&generation>=0?Object.freeze({rendererId,playSession,attempt,localGeneration:generation}):null;return current;},
   clear(){current=null;latest=null;},
   observe(scope,now,metadata,observedAtMs=now){
    if(!scope||scope!==current||!metadata)return false;
    const values=[now,observedAtMs,metadata.mediaTime,metadata.presentationTime,metadata.expectedDisplayTime,metadata.presentedFrames];
    if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||!Number.isSafeInteger(metadata.presentedFrames))return false;
    latest=Object.freeze({...scope,sequence:++sequence,callbackMs:now,observedAtMs,mediaTimeUs:Math.round(metadata.mediaTime*1e6),
     presentationMs:metadata.presentationTime,expectedDisplayMs:metadata.expectedDisplayTime,presentedFrames:metadata.presentedFrames,
     proof:'COMPOSITOR_SUBMISSION',deliveryMapping:null,physicalDisplayProven:false});return true;
   },
   snapshot(now){return latest&&current&&latest.localGeneration===current.localGeneration&&latest.playSession===current.playSession
    &&now>=latest.observedAtMs&&now-latest.observedAtMs<=1000?latest:null;}
  };
 }
 if(typeof module!=='undefined'&&module.exports)module.exports=create;
 else root.OrbitalPresentationTrace={create,latest:null};
})(typeof window!=='undefined'?window:globalThis);
/* END ORBITAL PRESENTATION TRACE */

/* Orbital experience v3: additive reviewed hooks; server flags remain separate. */
window.OrbitalExperienceConfig={enabled:!!(window.OrbitalConfig&&window.OrbitalConfig.experienceService)};
/* Original Orbital candidate renderer. No automatic startup work or global interception.
 * Host calls install only for the main profile, after its normal Home reveal.
 * The endpoint must already be explicitly enabled for the authenticated user.
 */
(function (root) {
  'use strict';
  const PREFIX = '/sports/api/experience/v1';
  const mounts = new WeakMap();
  const validId = value => typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  function element(tag, label, className) {
    const n = document.createElement(tag);
    if (label !== undefined) n.textContent = label;
    if (className) n.className = className;
    return n;
  }
  function button(label, action, focus) {
    const n = element('button', label); n.type = 'button';
    if (focus) n.dataset.oxFocus = focus;
    n.addEventListener('click', action); return n;
  }
  function field(label, input) {
    input.setAttribute('aria-label', label);
    const l = element('label', undefined, 'ox-field'); l.append(element('span', label), input); return l;
  }
  function select(options, value) {
    const n = element('select');
    for (const [v, label] of options) { const o = element('option', label); o.value = v; n.append(o); }
    n.value = value; return n;
  }
  function moveShelf(shelves, id, delta) {
    const ids = shelves.map(s => s.id), from = ids.indexOf(id), to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return ids;
    [ids[from], ids[to]] = [ids[to], ids[from]]; return ids;
  }
  class Client {
    constructor(api, transport = root.fetch.bind(root)) {
      this.api = api; this.transport = transport; this.pending = new Set(); this.epoch = 0;
    }
    identity() { return JSON.stringify([this.api.serverId?.() || '', this.api.getCurrentUserId() || '']); }
    reset() { this.epoch++; for (const c of this.pending) c.abort(); this.pending.clear(); }
    async request(route, data) {
      const user = this.api.getCurrentUserId(), identity = this.identity(), epoch = this.epoch, credential = this.api.accessToken();
      if (!user) throw new Error('Sign in to use personal library controls.');
      const controller = new AbortController(); this.pending.add(controller);
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await this.transport(this.api.getUrl(PREFIX.slice(1) + route), {
          method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: {'Authorization': 'MediaBrowser Token='+JSON.stringify(credential), ...(data === undefined ? {} : {'Content-Type': 'application/json'})},
          body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal,
        });
        const result = await response.json();
        if (epoch !== this.epoch || this.identity() !== identity || this.api.accessToken() !== credential) {
          const e = new Error('Account changed.'); e.code = 'account_changed'; throw e;
        }
        if (!response.ok) { const e = new Error(result.error || 'Request failed'); e.status = response.status; e.code = result.error; throw e; }
        return result;
      } catch (error) {
        if (epoch !== this.epoch) { const e = new Error('Request superseded.'); e.code = 'stale_request'; throw e; }
        if (this.identity() !== identity || this.api.accessToken() !== credential) { const e = new Error('Account changed.'); e.code = 'account_changed'; throw e; }
        throw error;
      } finally { clearTimeout(timeout); this.pending.delete(controller); }
    }
  }
  class Controller {
    constructor(api, opener, options = {}) {
      this.api = api; this.opener = opener; this.client = new Client(api, options.transport);
      this.dialog = null; this.state = null; this.tab = 'shelves'; this.busy = false; this.disposed = false;
      this.capabilities = {}; this.queryGeneration = 0; this.view = null; this.scroll = {}; this.modalGeneration = 0;
      this.openHandler = () => this.open(); if (!options.manual) opener.addEventListener('click', this.openHandler);
    }
    receiptOutcome(receipt,id) {
      if(receipt?.id!==id)return 'unknown';
      if(receipt.outcome==='committed' && Number.isSafeInteger(receipt.applied_revision) && receipt.applied_revision>=0)return 'committed';
      if(receipt.outcome==='cancelled' && receipt.applied_revision===null)return 'cancelled';
      return 'unknown';
    }
    valid(binding) {
      return !!binding && !this.disposed && binding.dialog === this.dialog && this.dialog?.open===true && this.dialog.isConnected &&
        binding.generation === this.modalGeneration && binding.scope === this.scope &&
        binding.credential === this.sessionCredential && this.client.identity() === binding.scope &&
        this.api.accessToken() === binding.credential && this.opener.isConnected &&
        (!root.ApiClient || root.ApiClient === this.api);
    }
    accept(binding) {
      if (this.valid(binding)) return true;
      // An old continuation cannot close or paint a replacement dialog.
      if (binding && binding.dialog === this.dialog && binding.generation === this.modalGeneration) this.close();
      return false;
    }
    binding() {
      const value = {dialog:this.dialog, generation:this.modalGeneration, scope:this.scope, credential:this.sessionCredential};
      return this.accept(value) ? value : null;
    }
    pendingKey() { return 'orbital-save-receipt:' + (this.scope || this.client.identity()); }
    rememberPending(id) {
      try { if(id) sessionStorage.setItem(this.pendingKey(),id); else sessionStorage.removeItem(this.pendingKey()); } catch {}
    }
    readPending() {
      try { const id=sessionStorage.getItem(this.pendingKey()); return validId(id) ? {id} : null; } catch { return null; }
    }
    clearPending() { this.pendingMutation=null;this.rememberPending(null); }
    async cancelPending() {
      const binding=this.binding();
      if(!binding || !this.pendingMutation || !this.capabilities.cancel_mutation)return;
      const pending=this.pendingMutation;
      try {
        const result=await this.client.request('/mutations/'+pending.id+'/cancel',{});
        if(!this.accept(binding) || this.pendingMutation!==pending)return;
        const outcome=this.receiptOutcome(result,pending.id);
        if(['cancelled','committed'].includes(outcome)) {this.clearPending();const refreshed=await this.refresh();if(!this.accept(binding))return;root.dispatchEvent?.(new Event('orbital:personal-changed'));this.status(outcome==='committed'?'The earlier save had already completed.':'The unresolved save was cancelled.');if(!refreshed)this.status('The save outcome is resolved, but current settings could not be refreshed.',true);}
        else {this.status('Save outcome is still unknown. Check its status before making another change.',true);this.pendingControls();}
      } catch(e) {if(this.accept(binding))this.status('Could not resolve the save yet. No new change was submitted.',true);}
    }
    pendingControls() {
      this.body.querySelectorAll('[data-ox-focus="check-save"],[data-ox-focus="cancel-save"]').forEach(n=>n.remove());
      this.body.prepend(button('Check save status',()=>this.reconcileMutation(),'check-save'));
      if(this.capabilities.cancel_mutation)this.body.prepend(button('Cancel unresolved save',()=>this.cancelPending(),'cancel-save'));
    }
    status(message, error = false) {
      if (!this.statusNode) return;
      this.statusNode.textContent = message; this.statusNode.dataset.error = String(error);
    }
    async open() {
      if (this.disposed) return;
      if(this.dialog){const current=this.binding();if(current)return current;}
      if(root.ApiClient && root.ApiClient!==this.api)return;
      this.user = this.api.getCurrentUserId(); this.scope = this.client.identity(); this.sessionCredential = this.api.accessToken(); if (!this.user) return;
      this.modalGeneration++;
      this.dialog = element('dialog', undefined, 'ox-panel'); this.dialog.setAttribute('aria-label', 'Personal library controls');
      const header = element('header'); header.append(element('h2', 'Personal library'), button('Close', () => this.close(), 'close'));
      this.statusNode = element('p', 'Loading your settingsâ€¦', 'ox-status'); this.statusNode.setAttribute('role', 'status'); this.statusNode.setAttribute('aria-live', 'polite');
      this.tabs = element('nav', undefined, 'ox-tabs'); this.tabs.setAttribute('aria-label', 'Personal library sections');
      this.body = element('section', undefined, 'ox-body');
      this.dialog.append(header, this.statusNode, this.tabs, this.body);
      this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
      const opened=this.dialog;opened.addEventListener('close',()=>{if(this.dialog===opened)this.close();});
      document.body.append(this.dialog); this.dialog.showModal();
      const binding=this.binding();if(!binding)return;
      this.accountTimer = setInterval(() => this.accept(binding), 250);
      this.pendingMutation=this.readPending();
      await this.refresh();
      if(!this.accept(binding))return;
      if(this.pendingMutation && this.dialog)await this.reconcileMutation();
      return this.accept(binding)?binding:null;
    }
    close() {
      if (!this.dialog) return;
      this.modalGeneration++; this.queryGeneration++; this.client.reset(); clearInterval(this.accountTimer);
      this.pendingMutation = null; this.dialog.close(); this.dialog.remove(); this.dialog = null; this.state = null; this.view = null; this.busy = false;
      this.statusNode = null; this.body = null; this.hiddenRows = null;
      if (this.opener.isConnected) this.opener.focus();
    }
    dispose() { this.close(); this.disposed = true; this.opener.removeEventListener('click', this.openHandler); }
    async refresh() {
      const binding=this.binding();if(!binding)return false;
      try {
        const state = await this.client.request('/state');
        if (!this.accept(binding)) return false;
        if (this.state && state.revision < this.state.revision) return;
        this.state = state; this.capabilities = state.capabilities || this.capabilities;
        this.paint(); this.status('Changes sync to your account. Favorites and viewing progress are unchanged.');return true;
      } catch (e) { if(this.accept(binding))this.error(e);return false; }
    }
    error(e) {
      if (e.code === 'stale_request') return;
      if (!this.dialog || e.code === 'account_changed') { if (e.code === 'account_changed') this.close(); return; }
      this.status(e.name === 'AbortError' ? 'The request timed out or was cancelled. Try again.' :
        e.status === 403 || e.status === 404 ? 'These controls are not enabled for this account.' :
        e.status === 422 ? 'This view needs an integration that is not enabled yet. Your saved filters are preserved.' :
        e.status === 429 ? 'Another library read is in progress. Try again shortly.' : 'Could not complete that action. Your saved settings are unchanged.', true);
      if (!this.state) this.body.replaceChildren(button('Retry', () => this.refresh(), 'retry'));
    }
    async reconcileMutation() {
      const binding=this.binding();
      if (!binding || !this.pendingMutation) return;
      const pending = this.pendingMutation, dialog = binding.dialog;
      try {
        const receipt = await this.client.request('/mutations/' + pending.id);
        if(!this.accept(binding) || this.pendingMutation!==pending)return;
        const latest = await this.client.request('/state');
        if (!this.accept(binding) || this.pendingMutation !== pending) return;
        if (!this.state || latest.revision >= this.state.revision) { this.state = latest; this.capabilities = latest.capabilities || {}; }
        const outcome=this.receiptOutcome(receipt,pending.id);
        if (outcome === 'committed') {
          this.clearPending(); this.paint(); this.status(this.state.revision>=receipt.applied_revision?'Saved. The server confirmed the earlier change.':'The server confirmed the earlier save. Refresh to load its latest settings.');root.dispatchEvent?.(new Event('orbital:personal-changed'));
        } else if(outcome==='cancelled') {
          this.clearPending();this.paint();this.status('The unresolved save was cancelled.');
        } else {
          // Absence is not proof of failure: the original operation may still be running.
          this.paint(); this.status('Save outcome is still unknown. Latest settings are loaded. Check again before making another change.', true);
          this.pendingControls();
        }
      } catch (e) {
        if (!this.accept(binding)) return;
        if (e.code === 'account_changed' || e.code === 'stale_request') return this.error(e);
        this.status('Save outcome is unknown. Reconnect and check its status; do not submit the change again.', true);
        this.pendingControls();
      }
    }
    async mutate(operation, after) {
      const binding=this.binding();
      if (!binding || this.busy || !this.state) return;
      if (this.pendingMutation) { this.paint(); this.status('Check the previous save status before making another change.', true); this.pendingControls(); return; }
      this.busy = true;
      const dialog = this.dialog, scrollTop = dialog.scrollTop;
      const focus = document.activeElement?.dataset.oxFocus;
      const focusOrder = [...dialog.querySelectorAll('[data-ox-focus]')].map(n => n.dataset.oxFocus);
      const supportsReceipts = this.capabilities.mutation_receipts === true;
      const id = supportsReceipts ? [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2,'0')).join('') : null;
      const disabled = [...dialog.querySelectorAll('.ox-body button, .ox-body input, .ox-body select')].map(n => [n, n.disabled]);
      disabled.forEach(([n]) => { n.disabled = true; });
      const revision = this.state.revision;
      if(id)this.rememberPending(id);
      try {
        const state = await this.client.request('/state', {revision, operation, ...(id ? {mutation_id:id} : {})});
        if (!this.accept(binding)) return;
        if (id && (this.receiptOutcome(state.mutation,id)!=='committed' || state.mutation.applied_revision>state.revision)) {
          this.pendingMutation={id};this.status('Checking whether the save reached the server…');await this.reconcileMutation();return;
        }
        this.clearPending();
        if (state.revision >= this.state.revision) this.state = {...state, capabilities: this.capabilities, templates: this.state.templates};
        this.view = null; this.queryGeneration++;
        this.paint(); this.status('Saved.'); root.dispatchEvent?.(new Event('orbital:personal-changed')); if (after) await after();
        if (!this.accept(binding)) return;
        const nodes = [...dialog.querySelectorAll('[data-ox-focus]')];
        const exact = nodes.find(n => n.dataset.oxFocus === focus && !n.disabled);
        const at = focusOrder.indexOf(focus);
        const neighbor = focusOrder.slice(at + 1).concat(focusOrder.slice(0, at).reverse()).map(k => nodes.find(n => n.dataset.oxFocus === k && !n.disabled)).find(Boolean);
        (exact || neighbor || nodes.find(n => !n.disabled))?.focus({preventScroll:true});
        dialog.scrollTop = scrollTop;
      } catch (e) {
        if (!this.accept(binding)) return;
        if (e.code === 'stale_request' || e.code === 'account_changed') return this.error(e);
        if (e.status === 409) {
          this.clearPending();
          await this.refresh(); if(!this.accept(binding))return;this.status('Settings changed on another device. The latest version is loaded; your action was not applied.', true);
        } else if ([400,401,403,404,410,413,415,422].includes(e.status)) {
          this.clearPending();
          this.paint(); this.error(e);  // Explicit adapter rejection: undo optimistic checkbox only.
        } else if (id) {
          this.pendingMutation = {id}; this.status('Checking whether the save reached the serverâ€¦');
          await this.reconcileMutation();
        } else {
          this.status('Save outcome is unknown. Reload current settings before submitting another change.', true);
          // Older servers lack receipts; do not pretend that absence proves failure.
        }
      } finally {
        if (this.dialog === dialog) this.busy = false;
        for (const [n, wasDisabled] of disabled) if (n.isConnected) n.disabled = wasDisabled;
      }
    }
    paint() {
      if (!this.dialog || !this.state) return;
      this.tabs.replaceChildren();
      const tabs = [['shelves', 'Saved shelves', this.capabilities.shelves], ['hidden', 'Hidden titles', this.capabilities.personal], ['watchlist', 'Watchlist', this.capabilities.personal],
                    ['spoilers', 'Spoilers', this.capabilities.spoilers], ['playback', 'Playback preferences', this.capabilities.playback_preferences],
                    ['bookmarks', 'Bookmarks', this.capabilities.bookmarks], ['history','Recently watched',this.capabilities.history], ['search','Search library',this.capabilities.search], ['recommendations','For you',this.capabilities.recommendations]];
      const available = tabs.filter(x => x[2]);
      if (!available.some(x => x[0] === this.tab)) this.tab = available[0]?.[0] || '';
      const choose=key=>{this.scroll[this.tab]=this.dialog.scrollTop;this.queryGeneration++;this.tab=key;this.paint();this.dialog.scrollTop=this.scroll[key]||0;};
      const picker=select(available.map(([key,label])=>[key,label]),this.tab);picker.setAttribute('aria-label','Personal library section');picker.className='ox-section-picker';picker.onchange=()=>choose(picker.value);this.tabs.append(picker);
      for (const [key, label] of available) {
        const n = button(label, () => choose(key), 'tab-' + key);
        n.setAttribute('aria-current', String(key === this.tab)); this.tabs.append(n);
      }
      this.body.replaceChildren();
      if (this.tab === 'shelves') this.shelves();
      else if (this.tab === 'hidden') this.hidden();
      else if (this.tab === 'watchlist') this.watchlist();
      else if (this.tab === 'spoilers' || this.tab === 'playback') this.preferences();
      else if (this.tab === 'bookmarks') this.bookmarks();
      else if (['history','search','recommendations'].includes(this.tab)) this.connectedPanel();
      else this.body.append(element('p', 'No personal features are enabled.'));
    }
    shelves() {
      this.body.append(element('p', 'Saved shelves are personal views, not new libraries. They do not change access or viewing progress.'));
      const toolbar = element('div', undefined, 'ox-actions');
      toolbar.append(button('New shelf', () => this.editShelf(), 'new-shelf'), button('Browse full library', () => this.browse({availability:'all'}, true), 'browse-all'));
      this.body.append(toolbar);
      if (!this.state.shelves.length) this.body.append(element('p', 'No saved shelves yet. Create one or start with a template.'));
      this.state.shelves.forEach((s, index) => {
        const row = element('article', undefined, 'ox-row'); row.append(element('h3', s.name));
        row.append(element('p', s.pinned ? 'Pinned to Home where the connected integration is enabled' : 'Not pinned'));
        const controls = element('div', undefined, 'ox-actions');
        const up = button('Move up', () => this.mutate({kind: 'shelf_order', order: moveShelf(this.state.shelves, s.id, -1)}), 'up-' + s.id); up.disabled = index === 0;
        const down = button('Move down', () => this.mutate({kind: 'shelf_order', order: moveShelf(this.state.shelves, s.id, 1)}), 'down-' + s.id); down.disabled = index === this.state.shelves.length - 1;
        for (const n of [up, down]) n.setAttribute('aria-label', n.textContent + ': ' + s.name);
        controls.append(button('Open', () => this.browse(s.rule), 'open-' + s.id), button('Edit', () => this.editShelf(s), 'edit-' + s.id),
          button(s.pinned ? 'Unpin' : 'Pin', () => this.mutate({kind: 'shelf_put', value: {...s, pinned: !s.pinned}}), 'pin-' + s.id), up, down,
          button('Remove', () => this.mutate({kind: 'shelf_delete', id: s.id}), 'remove-' + s.id));
        row.append(controls); this.body.append(row);
      });
      const templates = element('div', undefined, 'ox-actions');
      for (const t of this.state.templates || []) templates.append(button(t.name, () => this.editShelf({name: t.name, rule: t.rule, pinned: true}), 'template-' + t.name));
      this.body.append(templates);
    }
    editShelf(shelf = {name: '', rule: {}, pinned: true}) {
      this.queryGeneration++; this.body.replaceChildren();
      const form = element('form'), name = element('input'); name.required = true; name.maxLength = 80; name.value = shelf.name; name.dataset.oxFocus = 'shelf-name';
      const typeOptions = [['', 'Movies and series'], ['Movie', 'Movies'], ['Series', 'Series'], ['Episode', 'Episodes']];
      const keepTypes = shelf.rule.types?.length > 1;
      if (keepTypes) typeOptions.unshift(['__keep', 'Keep current: ' + shelf.rule.types.join(', ')]);
      const type = select(typeOptions, keepTypes ? '__keep' : shelf.rule.types?.[0] || '');
      const watch = select([['all', 'Any watched state'], ['unwatched', 'Unwatched'], ['watched', 'Watched'], ['unfinished', 'Started but unfinished']], shelf.rule.watched || 'all');
      const minutes = element('input'); minutes.type = 'number'; minutes.min = '1'; minutes.max = '1440'; minutes.value = shelf.rule.runtime_max_minutes || '';
      const genre = element('input'); genre.maxLength = 80; genre.value = shelf.rule.genres?.join(', ') || '';
      form.append(element('h3', shelf.id ? 'Edit shelf' : 'New shelf'), field('Name', name), field('Content', type), field('Watch state', watch), field('Maximum runtime in minutes (optional)', minutes), field('Genres, separated by commas (optional)', genre));
      if (shelf.rule.provider) form.append(element('p', 'Provider-specific filters will be retained. Opening them requires the provider adapter.'));
      const save = element('button', 'Save shelf'); save.type = 'submit'; save.dataset.oxFocus = 'save-shelf';
      form.append(save, button('Cancel', () => this.paint(), 'cancel-edit'));
      form.addEventListener('submit', e => {
        e.preventDefault(); if (!form.reportValidity()) return;
        const r = clone(shelf.rule); delete r.runtime_max_minutes; delete r.genres;
        if (type.value !== '__keep') { delete r.types; if (type.value) r.types = [type.value]; }
        r.watched = watch.value;
        if (minutes.value) r.runtime_max_minutes = Number(minutes.value);
        if (genre.value.trim()) r.genres = genre.value.split(',').map(s => s.trim()).filter(Boolean);
        const value = {...shelf, name: name.value, rule: r};
        this.mutate({kind: 'shelf_put', value});
      });
      this.body.append(form); name.focus();
    }
    async browse(r, includeHidden = false, cursor = null, revealed = []) {
      const binding=this.binding();if(!binding)return;
      const generation = ++this.queryGeneration;
      this.body.replaceChildren(element('p', 'Reading your libraryâ€¦'), button('Back to shelves', () => { this.queryGeneration++; this.paint(); }, 'back-shelves'));
      this.status('This library read does not run during Home startup.');
      try {
        const p = await this.client.request('/query', cursor ? {cursor, limit: 40, reveal:revealed} : {rule: r, include_hidden: includeHidden, limit: 40, reveal:revealed});
        if (!this.accept(binding) || generation !== this.queryGeneration) return;
        this.body.replaceChildren(button('Back to shelves', () => { this.queryGeneration++; this.paint(); }, 'back-shelves'));
        this.body.append(element('p', p.count_semantics?.startsWith('upstream_total') ? 'Browsing your accessible library. Personal filters are applied on each page.' : p.snapshot_count + ' titles in this snapshot. Access is checked again on each page.'));
        if (!p.items.length) this.body.append(element('p', p.next ? 'Titles on this page changed or are no longer accessible. Continue to the next page.' : 'No matching titles. Try different filters.'));
        for (const item of p.items) {
          if (!validId(item.Id)) continue;
          const card = element('article', undefined, 'ox-row');
          const link = element('a', item.Name || 'Title'); link.href = '#/details?id=' + item.Id;
          link.addEventListener('click', () => this.close()); card.append(link);
          if (item.spoiler_mask?.length) card.append(element('p', 'Spoiler-safe preview. Other clients need their own protection.'), button('Reveal this episode', () => this.browse(r, includeHidden, p.cursor, [...new Set([...revealed,item.Id])]), 'reveal-' + item.Id));
          if (this.capabilities.personal) {
            card.append(button('Hide', () => this.mutate({kind:'hide', id:item.Id}), 'hide-' + item.Id));
            const listed = this.state.watchlist.includes(item.Id);
            card.append(button(listed ? 'Remove from watchlist' : 'Add to watchlist', () => this.mutate({kind:listed ? 'watchlist_remove' : 'watchlist_add', id:item.Id}), 'watchlist-' + item.Id));
          }
          this.body.append(card);
        }
        if (p.next) this.body.append(button('Next page', () => this.browse(r, includeHidden, p.next), 'next-page'));
        this.status(p.removed_or_changed ? 'Some titles changed since this snapshot; none were replaced with unauthorized results.' : 'Library page loaded.');
      } catch (e) { if (this.accept(binding) && generation === this.queryGeneration) this.error(e); }
    }
    watchlist() {
      this.body.append(element('p', 'Your watchlist is separate from Jellyfin favorites (the existing My List) and Continue Watching. Adding a title does not request or acquire it.'));
      const list = element('div');
      const load = async () => {
        const binding=this.binding(), generation=++this.queryGeneration;
        if(!binding || this.tab!=='watchlist' || !list.isConnected)return;
        try {
          const data = await this.client.request('/watchlist');
          if (!this.accept(binding) || generation!==this.queryGeneration || this.tab !== 'watchlist' || data.revision < this.state.revision || !list.isConnected) return;
          const rows = [...data.items.map(i => [i.Id, i.Name || 'Saved title']), ...data.unavailable_ids.map(id => [id, 'No longer accessible or removed'])];
          list.replaceChildren();
          let shown=0;
          const more=button('Show more saved titles',()=>paint(),'more-watchlist');
          const paint=()=>{for(const [id,name] of rows.slice(shown,shown+60)) {const row=element('article',undefined,'ox-row');row.append(element('span',name),button('Remove from watchlist',()=>this.mutate({kind:'watchlist_remove',id},()=>this.body.querySelector('[data-ox-focus="load-watchlist"]')?.click()),'remove-watchlist-'+id));list.append(row);}shown+=60;more.hidden=shown>=rows.length;list.append(more);};
          if(!rows.length) list.append(element('p', 'Your watchlist is empty.'));
          paint(); this.status('Watchlist loaded. Favorites and viewing progress are unchanged.');
        } catch(e) { if(this.accept(binding) && generation===this.queryGeneration && this.tab==='watchlist' && list.isConnected)this.error(e); }
      };
      this.body.append(button('Load watchlist',load,'load-watchlist'),list);
    }
    hidden() {
      this.body.append(element('p', 'Hiding is personal and does not revoke access. Existing Home, search and third-party renderers need their own filtering hook.'));
      this.body.append(button('Load hidden titles', () => this.loadHidden(), 'load-hidden'));
      this.hiddenContainer = element('div'); this.body.append(this.hiddenContainer);
      if (this.hiddenRows) this.paintHidden();
    }
    async loadHidden() {
      const binding=this.binding(), generation=++this.queryGeneration, container=this.hiddenContainer;
      if(!binding || this.tab!=='hidden' || !container?.isConnected)return;
      try {
        const result = await this.client.request('/hidden');
        if (!this.accept(binding) || generation!==this.queryGeneration || container!==this.hiddenContainer || !container.isConnected || this.tab !== 'hidden' || result.revision < this.state.revision) return;
        this.hiddenRows = result; this.hiddenShown = 60; this.paintHidden(); this.status('Hidden titles loaded.');
      } catch (e) { if(this.accept(binding) && generation===this.queryGeneration && container===this.hiddenContainer && container.isConnected && this.tab==='hidden')this.error(e); }
    }
    paintHidden() {
      if (!this.hiddenContainer || !this.hiddenRows) return;
      this.hiddenContainer.replaceChildren();
      const values = [...this.hiddenRows.items.map(i => [i.Id, i.Name || 'Hidden title']), ...this.hiddenRows.unavailable_ids.map(id => [id, 'No longer accessible or removed'])];
      if (!values.length) this.hiddenContainer.append(element('p', 'You have no hidden titles.'));
      for (const [id, name] of values.slice(0, this.hiddenShown || 60)) {
        const row = element('article', undefined, 'ox-row'); row.append(element('span', name), button('Unhide', () => this.mutate({kind: 'unhide', id}, () => this.loadHidden()), 'unhide-' + id)); this.hiddenContainer.append(row);
      }
      if (values.length > (this.hiddenShown || 60)) this.hiddenContainer.append(button('Show more', () => { this.hiddenShown = (this.hiddenShown || 60) + 60; this.paintHidden(); }, 'more-hidden'));
    }
    preferences() {
      const labels = this.tab === 'spoilers' ? {
        episode_images: 'Hide unwatched episode images', episode_titles: 'Hide unwatched episode titles', episode_descriptions: 'Hide unwatched episode descriptions',
        sports_scores: 'Hide sports scores', sports_results: 'Hide sports results and recaps', sports_headlines: 'Hide sports headlines', sports_thumbnails: 'Hide sports thumbnails',
      } : {auto_intro: 'Automatically skip intros when the player supports it', auto_credits: 'Automatically skip credits when the player supports it'};
      this.body.append(element('p', this.tab === 'spoilers' ? 'Protect unwatched episode previews in Orbital. Reveal an episode explicitly to show its details for this signed-in visit. Other clients require their own protection.' : 'Choose automatic intro and credits skipping and subtitle defaults. Known credits end at their detected boundary, preserving any following scene.'));
      for (const [key, label] of Object.entries(labels)) {
        const input = element('input'); input.type = 'checkbox'; input.checked = this.state.preferences[key] === true; input.dataset.oxFocus = 'pref-' + key;
        input.addEventListener('change', () => this.mutate({kind: 'preferences', value: {[key]: input.checked}}));
        this.body.append(field(label, input));
      }
      if (this.tab === 'playback') {
        const input = element('input'); input.maxLength = 6; input.value = this.state.preferences.subtitle_language || ''; input.placeholder = 'en'; input.dataset.oxFocus = 'subtitle-language';
        this.body.append(field('Preferred subtitle language', input), button('Save subtitle preference', () => this.mutate({kind: 'preferences', value: {subtitle_language: input.value.trim()}}), 'save-subtitle'));
      }
    }
    bookmarks() {
      this.body.append(element('p', 'Save moments with Playback controls while watching, then return to them in the same version of the title. Bookmarks do not overwrite playback progress.'));
      if (!this.state.bookmarks.length) this.body.append(element('p', 'No timestamp bookmarks yet.'));
      const list=element('div');this.body.append(list);let shown=0;
      const more=button('Show more bookmarks',()=>paint(),'more-bookmarks');
      const paint=()=>{for (const b of this.state.bookmarks.slice(shown,shown+60)) {
        const row = element('article', undefined, 'ox-row'); row.append(element('span', b.label + ' Â· ' + Math.floor(b.ticks / 10000000) + ' seconds'),
          button('Remove', () => this.mutate({kind: 'bookmark_delete', value: {item_id: b.item_id, ticks: b.ticks}}), 'bookmark-' + b.item_id + '-' + b.ticks)); list.append(row);
      }shown+=60;more.hidden=shown>=this.state.bookmarks.length;list.append(more);};paint();
    }
    async itemPanel(endpoint,id,start=0) {
      const binding=this.binding();
      if(!binding || !['series','request-status','title-request'].includes(endpoint)||!validId(id))return;
      const generation=++this.queryGeneration,host=element('div');this.body.replaceChildren(host);this.status('Checking your libraryâ€¦');
      try {
        const result=await this.client.request('/'+endpoint,{id,...(endpoint==='series'?{start,limit:40}:{})});
        if(!this.accept(binding)||!host.isConnected||generation!==this.queryGeneration)return;
        if(endpoint==='title-request'){
          this.titleRequestPanel(result,id,binding,host,generation);
        }else if(endpoint==='series'){
          host.append(element('h3',result.series?.Name||'Series progress'));
          for(const item of result.items||[]){if(!validId(item.Id))continue;const row=element('article',undefined,'ox-row');const title=element('a',item.Name||'Episode');title.href='#/details?id='+item.Id;title.onclick=()=>this.close();row.append(title);
            const ud=item.UserData||{},position=ud.PlaybackPositionTicks,duration=item.RunTimeTicks;
            const label=ud.Played===true?'Watched':typeof position==='number'&&position>0?'In progress'+(typeof duration==='number'&&duration>position?' Â· '+Math.ceil((duration-position)/600000000)+' min left':''):'Not marked watched';row.append(element('span',label));host.append(row);}
          if(!(result.items||[]).length)host.append(element('p','No accessible episodes on this page.'));
          const next=start+(result.items||[]).length;if(next<result.total&&next>start)host.append(button('Next episodes',()=>this.itemPanel(endpoint,id,next),'next-episodes'));
          if(start)host.append(button('First episodes',()=>this.itemPanel(endpoint,id,0),'first-episodes'));
          this.status('Your progress is read-only here. Opening Details does not mark an episode watched.');
        }else {
          host.append(element('h3','Request status'));const state=result.status;
          const words=value=>String(value||'unknown').replace(/_/g,' ');
          if(state){const availability={in_library:'Available in your library',partial_or_unconfirmed:'Some episodes are available; the series may be incomplete',not_in_library:'No playable copy in your library yet'};const requests={none:'You haven’t requested this title',pending:'Your request is awaiting approval',approved:'Your request is approved',completed:'Your request is complete',failed:'Your request needs attention',declined:'Your request was declined'};host.append(element('p',availability[state.availability]||'Library availability is being checked'),element('p',requests[state.own_request]||'Request status is being checked'));if(['pending','processing','partially_available','blocklisted'].includes(state.upstream_media))host.append(element('p',{pending:'Waiting to be added',processing:'Being prepared',partially_available:'Some requested episodes are still being added',blocklisted:'This title is unavailable to request'}[state.upstream_media]));}
          else host.append(element('p','Open Requests to check this title’s availability and request status.'));
          if(result.request_link_allowed===true&&/^\/(movie|tv)\/[1-9][0-9]{0,11}$/.test(result.request_path||'')){
            const a=element('a','Open Requests');a.href=window.OrbitalParity?window.OrbitalParity.requestHref(result.request_path):(window.OrbitalAsset||'/web/orbital/')+'requests.html?path='+encodeURIComponent(result.request_path)+'&returnTo='+encodeURIComponent(location.pathname+location.hash);a.onclick=()=>this.close();host.append(a);}
          this.status('Requests and library availability update as titles are added.');
        }
      }catch(e){if(this.accept(binding)&&host.isConnected&&generation===this.queryGeneration){if(endpoint==='title-request')this.status('Couldn’t check your Seerr account. Make sure your account is linked, then reopen Request.');else this.error(e);}}
    }
    titleRequestPanel(result,id,binding,host,generation) {
      const current=()=>this.accept(binding)&&host.isConnected&&generation===this.queryGeneration;
      const words={pending:'Your request is awaiting approval.',approved:'Your request is approved and waiting to be added.',completed:'Seerr marks your request complete.',already_requested:'This title already has a Seerr request.',available_in_seerr:'Seerr marks this title available.',not_requested:'This title has not been requested in Seerr.'};
      host.append(element('h3',result.title||'Seerr requests'),element('p',words[result.state]||'Check your request status in Seerr.'),element('p','A request uses your linked Seerr account. Playback will be available after a working copy is added.'));
      if(!result.can_request){if(!result.permission)host.append(element('p','Your Seerr account cannot request this title.'));this.status('No duplicate request will be added.');return;}
      const selected=new Set();
      for(const s of result.identity?.type==='tv'?result.seasons||[]:[]){if(!s.requestable)continue;const input=element('input');input.type='checkbox';input.onchange=()=>input.checked?selected.add(s.number):selected.delete(s.number);host.append(field(s.name,input));}
      let sending=false;
      const send=button('Add to Seerr',async()=>{
        if(!current()||sending)return;
        if(result.identity?.type==='tv'&&!selected.size){this.status('Select at least one season.');return;}
        sending=true;send.disabled=true;this.status('Adding your request…');
        try{
          const reply=await this.client.request('/title-request-submit',{id,identity:result.identity,seasons:[...selected].sort((a,b)=>a-b)});
          if(!current())return;
          host.replaceChildren(element('h3',reply.title||result.title),element('p',words[reply.state]||'Check your request status in Seerr.'),element('p',reply.submitted?'Added to your Seerr requests. A working copy may take time to become available.':'No duplicate request was added.'));
          this.status('You can close this panel to return to the title.');
        }catch(e){if(current()){this.status('Couldn’t confirm the request. Check its status before trying again.');host.append(button('Check request status',()=>this.itemPanel('title-request',id),'check-request'));}}
      },'submit-title-request');host.append(send);this.status('Confirm to add this title to Seerr.');
    }
    connectedPanel() {
      const tab=this.tab;const host=element('div');this.body.append(host);
      const form=element('form');const input=element('input');input.type='search';input.maxLength=100;
      input.setAttribute('aria-label','Search library');
      const type=select([['Movie,Series,Episode','Movies, shows and episodes'],['Movie','Movies'],['Series','Shows'],['Episode','Episodes'],['Person','People']],'Movie,Series,Episode');
      type.setAttribute('aria-label','Result type');
      let generation=0;
      const load=async(start=0)=>{
        const binding=this.binding();if(!binding || !host.isConnected || this.tab!==tab)return;
        const g=++generation;this.status('Loadingâ€¦');
        const data=tab==='search'?{term:input.value.trim(),type:type.value,start,limit:40}:tab==='history'?{start,limit:40}:{limit:18};
        if(tab==='search'&&!data.term)return;
        try{
          const result=await this.client.request('/'+tab,data);
          if(!this.accept(binding)||!host.isConnected||g!==generation||this.tab!==tab)return;
          host.replaceChildren();const rows=result.items||[];
          for(const entry of rows){const item=entry.item||entry;if(!validId(item.Id))continue;
            const row=element('article',undefined,'ox-row');const link=element('a',item.Name||'Title');link.href='#/details?id='+item.Id;link.onclick=()=>this.close();row.append(link);
            for(const reason of entry.reasons||[])row.append(element('p',reason));
            if(tab==='recommendations')row.append(button('More like this',()=>this.mutate({kind:'feedback',id:item.Id,value:'more'})),button('Not for me',()=>this.mutate({kind:'feedback',id:item.Id,value:'less'})));
            host.append(row);
          }
          if(!rows.length)host.append(element('p','Nothing to show for this selection.'));
          const next=tab==='search'?result.next_start:tab==='history'&&start+rows.length<result.total?start+rows.length:null;
          if(next!=null)host.append(button('Next page',()=>load(next),'next-connected'));
          if(start)host.append(button('First page',()=>load(0),'first-connected'));
          this.status(tab==='history'?'Recently played titles. This does not change viewing progress.':tab==='recommendations'?'Based on your saved preferences; playback is not guaranteed.':'Library results. Requests remain separate.');
        }catch(e){if(this.accept(binding)&&host.isConnected&&g===generation&&this.tab===tab)this.error(e);}
      };
      if(tab==='search'){const submit=element('button','Search');submit.type='submit';form.append(field('Search library',input),field('Result type',type),submit);form.onsubmit=e=>{e.preventDefault();load();};this.body.prepend(form);}
      else{this.body.prepend(button('Load '+(tab==='history'?'recently watched':'recommendations'),()=>load(),'load-connected'));}
    }
    saveDiscovery(name, provider, discovery) {
      return this.mutate({kind: 'shelf_put', value: {name, rule: {provider, discovery}, pinned: true}});
    }
  }
  function install({api, container, enabled = false, profile = '', transport, opener: given = null} = {}) {
    if (!enabled || profile !== 'main' || !api || !container) return null;
    const current=mounts.get(container);
    if(current && current.controller.api===api)return current;
    if(current)current.dispose();
    // A caller-owned opener (e.g. the title's own 'My library' button) is neither appended nor removed here.
    const opener = given || button('Personal library', () => {}, 'personal-library'); if (!given) { opener.className = 'ox-open'; container.append(opener); }
    const controller = new Controller(api, opener, {transport, manual: !!given});
    const mounted = {controller, dispose() { controller.dispose(); if (!given) opener.remove(); mounts.delete(container); }};
    mounts.set(container, mounted); return mounted;
  }
  root.OrbitalExperience = {install, Client, Controller, moveShelf, validId};
  if (typeof module !== 'undefined') module.exports = root.OrbitalExperience;
})(typeof window === 'undefined' ? globalThis : window);

;
/* Explicit owned-renderer integration. Default off; no interception of fetch,
   Jellyfin authentication, playback reporting, sports timelines or Simple. */
(function(global){
'use strict';
const SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
let context=null, owner=null, state=null, home=null, preparedAt=0, pending=null, serial=0, homeLoading=null;
const waiting=new Set();
const revealedEpisodes=new Set();
const mounts=new WeakMap();
const normalId=value=>String(value||'').toLowerCase().replace(/-/g,'');
function enabled(api){return global.OrbitalExperienceConfig?.enabled===true && !!api?.getCurrentUserId?.() && normalId(api.getCurrentUserId())!==SIMPLE;}
function key(api){return JSON.stringify([api.serverId?.()||'',api.getCurrentUserId()||'']);}
function actionOwner(api,node){
 const scope=key(api),credential=api.accessToken();
 return ()=>enabled(api)&&node?.isConnected&&key(api)===scope&&api.accessToken()===credential&&(!global.ApiClient||global.ApiClient===api);
}
function reset(){serial++;context=null;owner=null;state=null;home=null;preparedAt=0;pending=null;homeLoading=null;waiting.clear();revealedEpisodes.clear();}
function scoped(api){return enabled(api)&&context===key(api)&&owner===api.accessToken();}
function el(tag,text){const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;}
function action(label,fn){const b=el('button',label);b.type='button';b.className='ob5-button';b.onclick=fn;return b;}
async function prepare(api,transport){
 if(!enabled(api))return;
 if(!scoped(api)){reset();context=key(api);owner=api.accessToken();}
 if(Date.now()-preparedAt<30000&&state)return;
 if(pending)return pending;
 const epoch=serial, scope=context, credential=owner;
 const current=()=>epoch===serial&&scope===key(api)&&credential===api.accessToken();
 pending=(async()=>{
   const client=new global.OrbitalExperience.Client(api,transport);
   const timer=setTimeout(()=>client.reset(),1600);
   try{
     const next=await client.request('/state');
     if(!current())return;
     state=next;home=null;homeLoading=null;
     // Claude (release): Home never waits for pinned shelves; they fill in when ready.
     if(next.capabilities?.connected && next.capabilities?.shelves && next.shelves.some(s=>s.pinned)){
       const later=new global.OrbitalExperience.Client(api,transport);
       homeLoading=later.request('/home',{limit:12}).catch(()=>({rows:next.shelves.filter(s=>s.pinned).slice(0,8).map(s=>({id:s.id,name:s.name,items:[],state:'unavailable'}))}))
         .then(value=>{if(!current())return;home=value;homeLoading=null;for(const w of [...waiting]){waiting.delete(w);if(w.section.isConnected)fillRows(api,w.section,w.card);}});
     }
     preparedAt=Date.now();
   }catch{
     if(!current())return;
     // Do not discard previously known protections during a same-account outage.
     state=state||{revision:null,hidden:[],preferences:{episode_titles:true,episode_images:true,episode_descriptions:true},capabilities:{},shelves:[]};
     preparedAt=Date.now();
   }finally{clearTimeout(timer);client.reset();if(epoch===serial)pending=null;}
 })();return pending;
}
function isHidden(api,item){return scoped(api)&&state?.capabilities?.personal===true && ['Id','SeriesId','SeasonId'].some(k=>(state.hidden||[]).includes(normalId(item[k])));}
function filter(api,items){return !enabled(api)?items:(items||[]).filter(i=>!isHidden(api,i));}
function project(api,item){
 if(!enabled(api)||!item||item.Type!=='Episode'||item.UserData?.Played===true||revealedEpisodes.has(normalId(item.Id)))return item;
 // Claude (release): spoiler projection only when this account's server state has spoilers enabled;
 // never blank titles/art before bootstrap while the feature is off.
 if(!scoped(api)||state?.capabilities?.spoilers!==true)return item;
 const p=state.preferences||{};const out={...item};out.oxSpoilerMask=[];
 if(p.episode_titles){out.oxSpoilerMask.push("title");out.Name=Number.isInteger(item.IndexNumber)?'Episode '+item.IndexNumber:'Unwatched episode';out.OriginalTitle=out.Name;out.SortName=out.Name;}
 if(p.episode_descriptions){out.oxSpoilerMask.push("description");out.Overview='';out.Taglines=[];out.ShortOverview='';}
 if(p.episode_images){out.oxSpoilerMask.push("image");out.ImageTags={};out.BackdropImageTags=[];delete out.ThumbImageTag;delete out.HeroArtId;delete out.ScreenshotImageTags;delete out.ParentThumbItemId;delete out.ParentThumbImageTag;delete out.ParentBackdropItemId;delete out.ParentBackdropImageTags;delete out.SeriesPrimaryImageTag;}
 return out;
}
function reveal(api,item){if(scoped(api))revealedEpisodes.add(normalId(item.Id));}
function revision(api){return scoped(api)&&state ? serial+':'+String(state.revision) : serial+':unavailable';}
function reusable(api,node){return !enabled(api)||!!node&&node.dataset.oxRevision===revision(api);}
function stamp(api,node){if(enabled(api))node.dataset.oxRevision=revision(api);return node;}
function omitted(item){const a=el('a');a.className='ob5-card ox-personal-hidden';a.hidden=true;a.inert=true;a.dataset.itemId=item.Id;a.setAttribute('aria-hidden','true');return a;}
function mount(api,container,transport){
 if(!enabled(api)||!container)return null;
 let current=mounts.get(container);
 if(current&&current.controller.api===api&&current.controller.opener.isConnected&&container.contains(current.controller.opener))return current;
 if(current){current.dispose();mounts.delete(container);}
 current=global.OrbitalExperience.install({api,container,enabled:true,profile:'main',transport});mounts.set(container,current);return current;
}
async function openShelf(api,container,shelf,current){if(!current())return;const m=mount(api,container);if(!m)return;const binding=await m.controller.open();if(current()&&m.controller.accept(binding))await m.controller.browse(shelf.rule);}
function homeRows(api,container,card){
 if(!scoped(api)||(!home&&!homeLoading)||container.querySelector(':scope > [data-ox-shelves]'))return;
 const section=el('section');section.dataset.oxShelves='true';section.setAttribute('aria-label','Your saved shelves');container.append(section);
 if(home)fillRows(api,section,card);else{section.dataset.oxShelves='pending';waiting.add({section,card});}
}
function fillRows(api,section,card){
 const container=section.parentElement,current=actionOwner(api,section);section.dataset.oxShelves='true';section.replaceChildren();
 for(const row of home?.rows||[]){
   const shelf=state.shelves.find(s=>s.id===row.id);if(!shelf)continue;
   const group=el('section');group.className='ob5-shelf';group.setAttribute('aria-label',row.name);
   const title=el('h2');title.append(action(row.name,()=>openShelf(api,container,shelf,current)));group.append(title);
   if(row.state==='ready'){
     const strip=el('div');strip.className='ob5-strip';strip.append(...filter(api,row.items).map(item=>card(project(api,item))));group.append(strip);
     if(!row.items.length)group.append(el('p','No matching titles in this snapshot.'));
   }else group.append(action('Open saved shelf',()=>openShelf(api,container,shelf,current)));
   section.append(group);
 }
 if(!section.childElementCount)section.remove();
}
function basicRule(mode,filters){
 const s=filters||{};
 if(String(s.genre||'').includes('|')||String(s.decade||'').includes('|'))return null;
 if(Object.keys(s).some(k=>!['genre','sub','co','rating','sort','decade','watch','favorite','grid','parent_id'].includes(k)))return null;
 // Unknown attributes must never be silently dropped when saving a view.
 const SORT={az:'name',new:'year',rated:'rating',added:'added','':'rating'};
 if(!(String(s.sort||'') in SORT))return null;
 const r={types:[mode==='tv'?'Series':'Movie'],sort:SORT[String(s.sort||'')]};
 if(s.rating){const n=Number(s.rating);if(![6,7,8].includes(n))return null;r.min_rating=n;}
 if(s.genre)r.genres=[s.genre];
 if(s.sub){if(!s.genre)return null;r.subgenre=s.sub;}
 if(s.co)r.co_genre=s.co;
 if(s.parent_id)r.parent_id=s.parent_id;
 if(s.decade){const year=Number(s.decade);if(!Number.isInteger(year)||year<1800||year>2500)return null;r.year_min=year;r.year_max=year===1900?1979:year+9;}
 if(s.watch&&!['yes','no'].includes(s.watch))return null;
 if(s.watch)r.watched=s.watch==='yes'?'watched':'unwatched';
 if(s.favorite)r.favorites_only=true;
 return r;
}
function providerRule(provider,filters){
 const ids=['apple-tv','netflix','disney-plus','hulu','max','prime-video','peacock','paramount-plus'];
 const s=filters||{};
 if(!ids.includes(provider)||s.scope!=='library'||!['All','Movie','Series'].includes(s.type))return null;
 const allowed=['genre','sub','co','decade','watch','favorite','rating','sort','type','scope','search','grid'];
 if(Object.keys(s).some(k=>!allowed.includes(k)))return null;
 return {types:s.type==='All'?['Movie','Series']:[s.type],provider,sort:'source',discovery:Object.fromEntries(Object.entries(s).filter(([k])=>k!=='grid').map(([k,v])=>[k,String(v)]))};
}
let unavailableSaveSequence=0;
function saveControl(api,container,mode,filters,provider=null){
 if(!enabled(api))return;
 const r=provider?providerRule(provider,filters):basicRule(mode,filters);
 if(!r){
   if(!provider&&(String(filters?.genre||'').includes('|')||String(filters?.decade||'').includes('|'))){
     const message='This selection cannot be saved yet. Choose one genre and one decade to save this library view. Your existing saved shelves are kept.';
     const note=el('p',message);note.className='ox-save-unavailable';note.id='ox-save-unavailable-'+(++unavailableSaveSequence);
     const unavailable=action('Save this view',()=>{});unavailable.disabled=true;unavailable.title=message;unavailable.setAttribute('aria-describedby',note.id);container.append(unavailable,note);
   }
   return;
 }
 const current=actionOwner(api,container);
 const b=action('Save this view',async()=>{
   if(!current())return;const m=mount(api,container);if(!m)return;const binding=await m.controller.open();
   if(current()&&m.controller.accept(binding)&&m.controller.capabilities.shelves)m.controller.editShelf({name:'My '+(mode==='tv'?'shows':'movies'),rule:r,pinned:true});
 });container.append(b);
}
function actionRow(scope,item){const show=scope.querySelector('.orbital-show .os-actions');return item?.Type==='Series'?show:show||scope.querySelector('.mainDetailButtons');}
function itemActions(api,item,container,tries=0,current=actionOwner(api,container)){
 if(!enabled(api)||!container||!current())return;
 // Claude (release): the button joins the title's own action row instead of a detached full-width bar.
 const row=actionRow(container,item);
 if(!row){if(tries<16&&container.isConnected)setTimeout(()=>itemActions(api,item,container,tries+1,current),250);return;}
 const binding=api.getCurrentUserId()+'|'+item.Id;
 const existing=row.querySelector('.ox-item-actions');
 if(existing?.dataset.oxItem===binding&&existing.__oxApi===api&&existing.__oxOwner?.())return;
 container.querySelectorAll('.ox-item-actions').forEach(b=>b.remove());
 const show=row.classList.contains('os-actions');
 const b=el('button');b.type='button';b.className=(show?'os-action':'orbital-chip')+' ox-item-actions';b.setAttribute('aria-label','My library: watchlist, hide, feedback'+(['Movie','Series'].includes(item.Type)?', request status':''));
 b.dataset.oxItem=binding;b.__oxApi=api;b.__oxOwner=current;
 if(show){const icon=el('span','bookmark_add');icon.className='material-icons';const label=el('span','My library');label.className='os-action-label';b.append(icon,label);}else b.textContent='My library';
 b.onclick=async()=>{
   if(!current())return;let m=mounts.get(b);if(m&&m.controller.api!==api){m.dispose();mounts.delete(b);m=null;}if(!m){m=global.OrbitalExperience.install({api,container:b,enabled:true,profile:'main',opener:b});mounts.set(b,m);}
   if(!m)return;const binding=await m.controller.open();const c=m.controller;if(!current()||!c.accept(binding))return;
   c.queryGeneration++;c.tab='title-actions';
   const picker=c.tabs.querySelector('.ox-section-picker');
   if(picker){const title=el('option','Title actions');title.value='title-actions';title.disabled=true;picker.prepend(title);picker.value='title-actions';}
   c.tabs.querySelectorAll('[aria-current]').forEach(n=>n.setAttribute('aria-current','false'));
   c.body.replaceChildren(el('h3',project(api,item).Name||'Title'));
   if(!c.capabilities.personal){c.body.append(el('p','Personal actions are not enabled for this account.'));return;}
   const listed=c.state.watchlist.includes(item.Id),hidden=c.state.hidden.includes(item.Id);
   c.body.append(action(hidden?'Unhide':'Hide from discovery',()=>c.mutate({kind:hidden?'unhide':'hide',id:item.Id})),
     action(listed?'Remove from watchlist':'Save to watchlist',()=>c.mutate({kind:listed?'watchlist_remove':'watchlist_add',id:item.Id})),
     action('More like this',()=>c.mutate({kind:'feedback',id:item.Id,value:'more'})),
     action('Not for me',()=>c.mutate({kind:'feedback',id:item.Id,value:'less'})));
   const snoozed=(c.state.snoozed?.[item.Id]||0)>Date.now()/1000;
   c.body.append(action(snoozed?'Recommend again now':'Not now · 7 days',()=>c.mutate({kind:snoozed?'unsnooze':'snooze',id:item.Id,...(snoozed?{}:{value:7})})));
   if(item.Type==='Series')c.body.append(action('Series progress',()=>c.itemPanel('series',item.Id)));
   if(['Movie','Series'].includes(item.Type))c.body.append(action('Request status',()=>c.itemPanel('request-status',item.Id)));
 };row.append(b);
}
function filterHome(api,data){
 if(!enabled(api))return data;
 const result={...data};
 for(const k of ['hero','feature','top','latest','continue','favorites','series'])if(Array.isArray(data[k]))result[k]=filter(api,data[k]).map(i=>project(api,i));
 for(const k of ['genres','decades'])if(Array.isArray(data[k]))result[k]=data[k].map(g=>({...g,items:filter(api,g.items)}));
 if(data.because)result.because={...data.because,items:filter(api,data.because.items)};
 return result;
}
global.addEventListener?.('orbital:personal-changed',()=>{preparedAt=0;home=null;global.dispatchEvent(new Event('orbital:refresh'));});
global.OrbitalPersonal={enabled,prepare,filter,project,reveal,isHidden,omitted,mount,homeRows,saveControl,itemActions,filterHome,reset,basicRule,providerRule,revision,reusable,stamp};
if(typeof module!=='undefined')module.exports=global.OrbitalPersonal;
})(typeof window==='undefined'?globalThis:window);



;
/* Rating trust (Claude, Sept 28 2026). Community ratings of 9.0 and above come from a handful of
   votes (no widely rated film or series scores that high), so they are treated as unrated: no star, never a
   hero, and sorted last. Rating-descending server queries list all of them first, in one block; offset()
   counts that block once per filter (a Limit=0 query, cached ten minutes) so callers can start after it. */
(() => {
  const FLOOR = {Movie: 9.0, Series: 9.0};
  const thin = i => {const r = Number(i?.CommunityRating); return r > 0 && r >= (i?.Type === 'Series' ? FLOOR.Series : FLOOR.Movie);};
  const counts = new Map();
  window.OrbitalRating = {
    thin,
    value: i => thin(i) ? 0 : (Number(i?.CommunityRating) || 0),
    label: i => Number(i?.CommunityRating) > 0 && !thin(i) ? '★ ' + Number(i.CommunityRating).toFixed(1) : null,
    async offset(api, user, q) {
      if (!/^CommunityRating/.test(String(q?.SortBy || '')) || /^Asc/i.test(String(q?.SortOrder || ''))) return 0;
      const floor = String(q.IncludeItemTypes || '') === 'Series' ? FLOOR.Series : FLOOR.Movie;
      const {StartIndex, Limit, Fields, EnableImageTypes, ImageTypeLimit, EnableTotalRecordCount, ...scope} = q;
      const key = user + '|' + JSON.stringify(scope), hit = counts.get(key);
      if (hit && Date.now() - hit.at < 600000) return hit.n;
      let n = 0;
      try {
        const r = await api.getItems(user, {...scope, Recursive: true, MinCommunityRating: Math.max(floor, Number(scope.MinCommunityRating) || 0),
          Limit: 0, EnableTotalRecordCount: true, EnableImages: false, EnableUserData: false});
        n = Number(r?.TotalRecordCount) || 0;
      } catch { return 0; }
      counts.set(key, {at: Date.now(), n});
      if (counts.size > 200) counts.delete(counts.keys().next().value);
      return n;
    }
  };
})();


(() => {
  const key=n=>n.nodeType===1?(n.dataset.refreshKey||n.dataset.eventId||n.dataset.feedId||n.getAttribute('href')||n.getAttribute('aria-label')||n.id||n.tagName+':'+n.className):'';
  function reconcile(host, fresh) {
    const old=[...host.children], nodes=[...fresh], focus=document.activeElement;
    const focused=old.findIndex(n=>n===focus||n.contains(focus)), scroll=host.scrollLeft;
    const used=new Set();
    for(let i=0;i<nodes.length;i++) {
      const next=nodes[i], identity=key(next);
      const kept=old.find(n=>!used.has(n)&&key(n)===identity&&n.tagName===next.tagName);
      let target=next;
      if(kept) {
        used.add(kept);target=kept;
        for(const a of [...kept.attributes])if(!next.hasAttribute(a.name))kept.removeAttribute(a.name);
        for(const a of next.attributes)if(kept.getAttribute(a.name)!==a.value)kept.setAttribute(a.name,a.value);
        if(kept.innerHTML!==next.innerHTML)kept.replaceChildren(...next.childNodes);
        if(next.onclick)kept.onclick=next.onclick;
      }
      if(host.children[i]!==target)host.insertBefore(target,host.children[i]||null);
    }
    for(const n of old)if(!used.has(n))n.remove();
    host.scrollLeft=scroll;
    if(focused>=0&&!focus.isConnected)host.children[Math.min(focused,host.children.length-1)]?.focus({preventScroll:true});
  }
  let cached=null,at=0,owner='',pending=null;
  async function events(api,force=false) {
    const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
    const who=api.getUrl('sports/api/events')+'|'+api.serverId?.()+'|'+api.getCurrentUserId()+'|'+api.accessToken?.()+'|'+day;
    if(who!==owner){owner=who;cached=null;at=0;pending=null;}
    if(!force&&cached&&Date.now()-at<30000)return cached.map(e=>window.TelevisionFeedUi.withFreshness(e,e));
    if(pending)return pending;
    const y=new Date(day+'T12:00:00Z');y.setUTCDate(y.getUTCDate()-1);
    const task=Promise.all([day,y.toISOString().slice(0,10)].map(date=>api.ajax({type:'GET',url:api.getUrl('sports/api/events',{date}),dataType:'json'}))).then(data=>{
      const all=data.flatMap(d=>(d.events||[]).map(e=>window.TelevisionFeedUi.withFreshness(e,d)));
      const result=[...new Map(all.slice().reverse().map(e=>[e.league+'|'+e.id,e])).values()];
      if(owner===who){cached=result;at=Date.now();}return result;
    });pending=task;try{return await task;}finally{if(pending===task)pending=null;}
  }
  window.OrbitalRefresh={reconcile,events};
})();
/* Orbital settle: one transition per page instead of native-then-overlay. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('orbital') === 'off') return;
  const H = document.documentElement, SIMPLE = (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
  let timer = null;
  const route = () => { const [p, q = ''] = location.hash.slice(1).split('?'); return { p, s: new URLSearchParams(q) }; };
  const enhanced = () => {
    const { p, s } = route();
    if (p === '/home') return s.get('tab') !== '1';
    if (p === '/movies' || p === '/tv') return s.get('orbitalBrowse') !== 'all';
    if (p === '/livetv') return ['0', '1', '2', null].includes(s.get('tab'));
    return false;
  };
  const currentRouteReady = () => {
    const { p } = route();
    if (p !== '/home') return true;
    const root = document.querySelector('#homeTab.is-active > .ob5-browse[data-mode="home"]');
    return Boolean(root?.getClientRects().length);
  };
  const end = (force = false) => {
    // A guide/channel request from the previous route can finish after the URL
    // has already changed. Do not let that stale callback reveal its old DOM
    // underneath the Home URL; Home's own mount closes the transition.
    if (!force && enhanced() && !currentRouteReady()) return;
    clearTimeout(timer); timer = null; H.classList.remove('orbital-settling'); H.removeAttribute('aria-busy');
  };
  const begin = () => {
    H.classList.toggle('orbital-home-route',route().p==='/home'&&route().s.get('tab')!=='1');
    if(window.OrbitalPhone?.active())window.OrbitalPhone.begin();
    clearTimeout(timer);
    if (!enhanced()) { end(); return; }
    H.classList.add('orbital-settling'); H.setAttribute('aria-busy','true');
    timer = setTimeout(() => end(true), route().p === '/livetv' && route().s.get('tab') === '1' ? 9000 : 6000);
  };
  // Stored credentials tell us before the first paint whether the sidebar shell will be used.
  try {
    const creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
    const server = (creds.Servers || []).find(x => x.AccessToken && x.UserId);
    if (server && server.UserId !== SIMPLE) H.classList.add('ob5-shell');
  } catch { /* native layout */ }
  window.OrbitalSettle = { begin, end };
  begin(); window.addEventListener('hashchange', begin);
})();
/* Orbital v1.0 -- progressive enhancement of the pinned Jellyfin web client.
 * No embedded credentials or player replacement. Explicit channel reports use authenticated user preferences.
 * Every catalog/guide query uses the signed-in client's permissions.
 */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('orbital') === 'off') return;
  document.documentElement.classList.add('orbital-enabled');
  const REQUESTS = (window.OrbitalConfig&&window.OrbitalConfig.requestsUrl)||'';
  // Mobile webviews can lose the Jellyfin history entry when navigating to
  // the separate request origin. Keep the request UI in a same-origin shell
  // with an explicit return action and the exact prior Jellyfin hash.
  const requestHref = path => window.OrbitalParity ? window.OrbitalParity.requestHref(path) : location.origin + (window.OrbitalAsset||'/web/orbital/')+'requests.html?path=' + encodeURIComponent(path || '/') + '&returnTo=' + encodeURIComponent(location.pathname + location.hash);
  const requestLink = (cls, label, path = '/', symbol) => {
    const n = link(cls, label, requestHref(path), symbol);
    if(window.ApiClient?.getCurrentUserId?.()===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'))n.style.setProperty('display','none','important');
    n.addEventListener('click', () => { n.href = requestHref(path); }, {capture:true});
    return n;
  };
  const state = { user: null, home: null, generation: 0, timer: null, refresh: null, busy: false, retryAt: 0, detailKey: null };
  const el = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const icon = name => { const n = el('span', 'material-icons', name); n.setAttribute('aria-hidden','true'); return n; };
  const link = (cls, label, href, symbol) => { const n = el('a',cls); n.href = href; if(symbol) n.append(icon(symbol)); n.append(document.createTextNode(label)); return n; };
  let requestModal=null,requestModalFocus=null;
  function closeRequestModal(fromRoute=false) {
    if(!requestModal)return;
    if(fromRoute)requestModal.__otvBack=true;
    requestModal.close();
  }
  window.addEventListener('hashchange',()=>closeRequestModal(true));
  function openRequestModal(path,returnFocus) {
    closeRequestModal(true);requestModalFocus=returnFocus?.isConnected?returnFocus:document.activeElement;
    const overlay=el('dialog','orbital-request-modal');overlay.setAttribute('aria-labelledby','orbital-request-title');
    const dialog=el('section','orbital-request-dialog'),heading=el('header','orbital-request-dialog-header');
    const title=el('h2','','Request another copy');title.id='orbital-request-title';
    const close=el('button','orbital-request-close','Close');close.type='button';close.onclick=()=>closeRequestModal();heading.append(title,close);
    const url=REQUESTS+'/'+String(path||'').replace(/^\/+/,'');
    const status=el('p','','Open this title in the request site and sign in to review available actions. No request has been submitted.');
    const outside=link('orbital-chip','Open request site in a new tab',url);outside.target='_blank';outside.rel='noopener noreferrer';outside.tabIndex=0;
    const inside=link('orbital-chip','Open here with Back to Jellyfin',requestHref('/'+String(path||'').replace(/^\/+/,'')));
    inside.tabIndex=0;
    const back=el('button','orbital-request-close','Back to title');back.type='button';back.onclick=()=>closeRequestModal();
    dialog.append(heading,status,outside,inside,back);overlay.append(dialog);document.body.append(overlay);requestModal=overlay;
    overlay.addEventListener('cancel',e=>{e.preventDefault();closeRequestModal();});
    overlay.addEventListener('close',()=>{overlay.remove();if(requestModal===overlay){requestModal=null;const focus=requestModalFocus;requestModalFocus=null;if(focus?.isConnected)focus.focus({preventScroll:true});}},{once:true});
    overlay.showModal();close.focus();
  }
  const detail = (api, id) => '#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(api.serverId());
  const activeHome = () => /^#\/home(?:[?&]|$)/.test(location.hash) && new URLSearchParams(location.hash.split('?')[1]||'').get('tab')!=='1';
  const short = (value, length=210) => { const d=new DOMParser().parseFromString(String(value||''),'text/html'); const t=(d.body.textContent||'').replace(/\s+/g,' ').trim(); if(t.length<=length) return t; return t.slice(0,length).replace(/\s+\S*$/,'')+'…'; };
  const time = value => new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  function image(api, item, type, width) {
    const tag = type==='Backdrop' ? item.BackdropImageTags?.[0] : item.ImageTags?.[type];
    if(!tag) return null;
    return api.getImageUrl(item.Id,{type,index:type==='Backdrop'?0:undefined,tag,maxWidth:width,quality:90});
  }
  function clear() {
    closeRequestModal();
    ++state.generation;
    if(state.refresh) clearInterval(state.refresh);
    state.refresh=null; state.home=null; state.busy=false; state.detailKey=null; cancelAutoplay(); state.channels=null; state.programs=[]; state.upcoming=null; state.liveMode=null;
    document.querySelectorAll('.orbital-detail-art').forEach(n=>n.remove());
    document.querySelectorAll('.orbital-personal').forEach(n=>n.remove());
    document.querySelectorAll('.orbital-library-original,.orbital-original-live').forEach(n=>n.classList.remove('orbital-library-original','orbital-original-live'));
  }
  function topNav(authenticated) {
    const appbar=document.querySelector('header.MuiAppBar-root');
    const toolbar=appbar?.querySelector('.MuiToolbar-root');
    const stack=toolbar?.querySelector(':scope > .MuiStack-root')||(toolbar?.querySelector(':scope > button[aria-label="Open Menu"]')?toolbar:null);
    // v12 adapter: only replace the library strip when its native destinations exist.
    if(authenticated&&stack&&stack.querySelector('a[href],button')){
      // React swaps the mobile toolbar for a desktop stack during resize.
      // Retire an overlay attached to the old host before enhancing the new one.
      appbar.querySelectorAll('.orbital-primary-nav').forEach(n=>{if(n.parentElement!==stack)n.remove();});
      let nav=stack.querySelector('.orbital-primary-nav');
      if(!nav){
        nav=el('nav','orbital-primary-nav orbital-personal');nav.setAttribute('aria-label','Main navigation');
        for(const [name,href] of (window.ApiClient?.getCurrentUserId()===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')?[['Guide','#/livetv?tab=1'],['Sports','#/livetv?tab=0&sports=1'],['Channels','#/livetv?tab=2']]:[['Home','#/home'],['My List','#/movies?orbitalBrowse=mylist'],['Live TV','#/livetv?tab=1']]))nav.append(link('orbital-nav-link',name,href));
        nav.append(requestLink('orbital-nav-link','Requests'));
        const menu=el('details','orbital-library-menu');const summary=el('summary','','Libraries');menu.append(summary);
        const choices=el('div','orbital-library-menu-items');
        for(const original of stack.querySelectorAll(':scope > a[href]')){
          const label=original.textContent.trim();if(!label||/favorites|request/i.test(label))continue;
          const a=link('orbital-nav-link',label,original.getAttribute('href'));a.onclick=()=>{menu.open=false;};choices.append(a);
        }
        const more=[...stack.querySelectorAll(':scope > button')].find(b=>/more/i.test(b.textContent))||(!choices.children.length?stack.querySelector('button'):null);
        if(more){const b=el('button','orbital-nav-link','All libraries…');b.type='button';b.onclick=()=>{menu.open=false;more.click();};choices.append(b);}
        menu.append(choices);nav.append(menu);stack.append(nav);
      }
      if(stack!==toolbar)stack.classList.add('orbital-app-navigation');appbar.classList.add('orbital-appbar');
      document.documentElement.classList.add('orbital-v12-ready');
      for(const a of nav.querySelectorAll(':scope > a')){const selected=a.hash.startsWith('#/livetv')?location.hash.startsWith('#/livetv'):a.hash==='#/home'?activeHome():a.hash==='#/movies?orbitalBrowse=mylist'&&location.hash.startsWith('#/home')&&!activeHome();if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
      document.querySelectorAll('.orbital-v12-nav').forEach(n=>n.remove());
      return;
    }
    document.documentElement.classList.remove('orbital-v12-ready');
    const slider=document.querySelector('.headerTabs .emby-tabs-slider');
    if(!authenticated || !slider) return;
    if(!activeHome()){slider.querySelectorAll('.orbital-top-link').forEach(n=>n.remove());return;}
    // v12's React app bar hides the legacy tabs; keep their native handlers.
    const page=document.querySelector('#indexPage');
    if(page&&!slider.getClientRects().length&&!page.querySelector('.orbital-v12-nav')){
      const nav=el('nav','orbital-v12-nav orbital-personal');nav.setAttribute('aria-label','Browse');
      slider.querySelectorAll('.emby-tab-button').forEach(original=>{const b=el('button','orbital-chip',original.textContent.trim());b.type='button';b.onclick=()=>original.click();nav.append(b);});
      nav.append(link('orbital-chip','Live TV','#/livetv?tab=1'),requestLink('orbital-chip','Requests'));page.prepend(nav);
    }
    if(slider.querySelector('.orbital-top-link')) return;
    slider.append(link('orbital-top-link','Live TV','#/livetv?tab=1','sensors'),requestLink('orbital-top-link','Requests','/','add_circle_outline'));
  }
  // Sept 27 (experience pass): Netflix-style episodes on series, season and episode pages. Season chips and full
  // episode rows (art, number, title, runtime, synopsis, progress, watched) replace the season-poster detour.
  const episodeCache=new Map();
  async function episodesPanel(api,user,item,page,owned=null){
    if(owned&&!owned())return;
    if(!['Series','Season','Episode'].includes(item.Type))return;
    const seriesId=item.Type==='Series'?item.Id:item.SeriesId;if(!seriesId)return;
    const key=user+'|'+item.Id;
    page.querySelectorAll('.orbital-episodes,.orbital-similar').forEach(n=>{if(n.dataset.key!==key)n.remove();});
    // Claim this item synchronously: enhanceDetail can run twice while the first call is still loading.
    if(page.dataset.orbitalEpisodes===key)return;page.dataset.orbitalEpisodes=key;
    const json=(path,params)=>api.getJSON(api.getUrl(path,params));
    const current=()=>(!owned||owned())&&api.getCurrentUserId()===user&&location.hash.includes('id='+item.Id)&&page.isConnected&&page.dataset.orbitalEpisodes===key;
    let seasons;try{seasons=((await json('Shows/'+seriesId+'/Seasons',{userId:user})).Items||[]).filter(s=>s.Type==='Season');}catch(error){if(owned&&owned())throw error;return;}
    if(!seasons.length||!current())return;
    let season=item.Type==='Episode'?item.SeasonId:item.Type==='Season'?item.Id:null,highlight=item.Type==='Episode'?item.Id:null;
    if(!season){try{const next=(await json('Shows/NextUp',{userId:user,seriesId,Limit:1})).Items?.[0];if(next){season=next.SeasonId;highlight=next.Id;}}catch{}}
    if(!seasons.some(s=>s.Id===season))season=(seasons.find(s=>s.IndexNumber>0)||seasons[0]).Id;
    if(!current())return;
    const box=el('section','orbital-episodes');box.dataset.key=key;box.setAttribute('aria-label','Episodes');
    const head=el('div','orbital-episodes-head'),chips=el('div','orbital-season-chips'),list=el('ol','orbital-episode-list');
    chips.setAttribute('role','tablist');chips.setAttribute('aria-label','Seasons');
    head.append(el('h2','orbital-episodes-title','Episodes'),chips);box.append(head,list);
    for(const s of seasons){const b=el('button','orbital-season-chip',s.Name||('Season '+s.IndexNumber));b.type='button';b.dataset.id=s.Id;b.setAttribute('role','tab');
      b.onclick=()=>show(s.Id);b.onkeydown=e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const all=[...chips.children],i=all.indexOf(b)+(e.key==='ArrowRight'?1:-1);if(all[i]){e.preventDefault();all[i].focus();all[i].click();}};chips.append(b);}
    const minutes=t=>t?Math.max(1,Math.round(t/6e8))+'m':null;
    const row=raw=>{
      if(window.OrbitalPersonal?.isHidden(api,raw)){const omitted=el('li');omitted.hidden=true;return omitted;}
      const ep=window.OrbitalPersonal?.project(api,raw)||raw;
      const li=el('li'),a=el('a','orbital-episode'+(ep.Id===highlight?' is-current':''));a.href='#/details?id='+ep.Id+'&serverId='+api.serverId();a.dataset.id=ep.Id;
      const art=el('div','orbital-episode-art'),src=ep.ImageTags?.Primary?api.getImageUrl(ep.Id,{type:'Primary',tag:ep.ImageTags.Primary,maxWidth:520,quality:80}):null;
      if(src){const img=el('img');img.src=src;img.alt='';img.loading='lazy';img.onerror=()=>img.remove();art.append(img);}else art.append(el('span','orbital-episode-number',String(ep.IndexNumber??'')));
      const ud=ep.UserData||{},pct=Number(ud.PlayedPercentage)||0;
      if(pct>0&&pct<100){const bar=el('span','orbital-episode-progress');bar.style.setProperty('--p',pct.toFixed(1)+'%');art.append(bar);}
      if(ud.Played){const done=el('span','orbital-episode-watched material-icons','check_circle');done.setAttribute('aria-label','Watched');art.append(done);}
      const body=el('div','orbital-episode-body');
      if(ep.Id===highlight)body.append(el('span','orbital-episode-badge',item.Type==='Episode'?'This episode':pct>0?'Continue':'Up next'));
      {const t=OT.episode(ep);body.append(el('strong','orbital-episode-title',(ep.IndexNumber!=null&&!/^Episode \d/.test(t)?ep.IndexNumber+'. ':'')+t));}
      const meta=[minutes(ep.RunTimeTicks),ep.PremiereDate?new Date(ep.PremiereDate).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}):null,pct>0&&pct<100&&ep.RunTimeTicks?Math.max(1,Math.round(ep.RunTimeTicks*(1-pct/100)/6e8))+'m left':null].filter(Boolean).join(' · ');
      if(meta)body.append(el('span','orbital-episode-meta',meta));
      {const ov=OT.overview(ep.Overview);if(ov)body.append(el('p','orbital-episode-overview',ov));}
      a.append(art,body);li.append(a);if(ep.oxSpoilerMask?.length){const reveal=el("button","orbital-chip","Reveal episode");reveal.onclick=()=>{window.OrbitalPersonal.reveal(api,raw);li.replaceWith(row(raw));};li.append(reveal);}return li;};
    async function show(id,initial=false){
      if(!current())return;
      season=id;for(const b of chips.children)b.setAttribute('aria-selected',String(b.dataset.id===id));
      let eps=episodeCache.get(user+'|'+id);
      if(!eps){list.setAttribute('aria-busy','true');if(!list.children.length)list.append(el('li','orbital-episode-empty','Loading episodes…'));
        try{eps=(await json('Shows/'+seriesId+'/Episodes',{userId:user,seasonId:id,Fields:'Overview,PrimaryImageAspectRatio',EnableImageTypes:'Primary',ImageTypeLimit:1})).Items||[];episodeCache.set(user+'|'+id,eps);if(episodeCache.size>40)episodeCache.delete(episodeCache.keys().next().value);}
        catch(error){if(!current()||season!==id)return;list.replaceChildren(el('li','orbital-episode-empty','Episodes could not be loaded. Choose the season again to retry.'));list.removeAttribute('aria-busy');if(owned&&initial)throw error;return;}}
      if(!current()||season!==id||!box.isConnected)return;
      list.replaceChildren(...(eps.length?eps.map(row):[el('li','orbital-episode-empty','No episodes in this season yet.')]));list.removeAttribute('aria-busy');
      chips.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});}
    const before=page.querySelector('.nextUpSection')||page.querySelector('#listChildrenCollapsible')||page.querySelector('.moreFromSeasonSection')||page.querySelector('#castCollapsible');
    if(!before?.parentNode){if(owned&&owned())throw new Error('Episode content is not attached');return;}
    before.parentNode.insertBefore(box,before);page.classList.add('orbital-has-episodes');
    await show(season,true);
    // Episode pages: 'More like this' for the series (Jellyfin shows it for movies and series only).
    if(item.Type==='Episode'&&!page.querySelector('.orbital-similar')){
      try{const similar=((await json('Items/'+seriesId+'/Similar',{userId:user,Limit:12,Fields:'PrimaryImageAspectRatio'})).Items||[]).filter(s=>s.ImageTags?.Primary);
        if(!similar.length||!current())return;
        const sec=el('section','orbital-similar');sec.dataset.key=key;sec.append(el('h2','orbital-episodes-title','More like this'));const strip=el('div','orbital-similar-strip');
        for(const s of similar){const a=el('a','orbital-similar-card');a.href='#/details?id='+s.Id+'&serverId='+api.serverId();const img=el('img');img.src=api.getImageUrl(s.Id,{type:'Primary',tag:s.ImageTags.Primary,maxWidth:300,quality:80});img.alt='';img.loading='lazy';a.append(img,el('span','',s.Name));strip.append(a);}
        sec.append(strip);(page.querySelector('#castCollapsible')||box).after(sec);}catch{}
    }
  }
  // Sept 27 (web parity with Orbital TV .58): display cleanup shared with the Shield's OrbitalText.
  //  "Cheers (1982" -> "Cheers"; "Breaking.Bad.S01E02.Cats.in.the.Bag..." -> "Cats in the Bag..."; episodes named after
  //  the series -> "Episode N"; release/file names are never shown as a synopsis.
  const OT={
    release:/(\bS\d{1,2}E\d{1,3}\b|\b\d{1,2}x\d{2}\b|\b(2160p|1080p|720p|480p|x26[45]|h\.?26[45]|hevc|web-?dl|webrip|bluray|bdrip|hdtv|remux)\b)/i,
    prefix:/^.*?\b(?:\d{1,2}x\d{2}|S\d{1,2}E\d{1,3})\b\s*[-–:.]\s*(.+)$/i,
    name(v){let t=String(v??'').replace(/\s*\(\d{4}$/,'').trim();if(!t)return null;
      if(!t.includes(' ')&&/[\p{L}\p{N}']\.[\p{L}\p{N}]/u.test(t)&&t.split('.').filter(x=>x.length>=3).length>=2)t=t.replace(/(?<=[\p{L}\p{N}'])\.(?=[\p{L}\p{N}])/gu,' ');return t;},
    overview(v){const t=String(v??'').replace(/<[^>]*>/g,'').trim();if(!t)return null;const spaces=(t.match(/ /g)||[]).length;return this.release.test(t)&&(spaces<=2||t.length<90)?null:t;},
    episode(ep){const number=ep.IndexNumber!=null?'Episode '+ep.IndexNumber:'Episode',raw=String(ep.Name||'').trim(),m=raw.match(this.prefix);
      if(m&&m[1].trim()&&!this.release.test(m[1])&&!/^(?:english|eng|spanish|español|french|german|italian|portuguese|multi|dual audio|subbed|dubbed|subs?|dub|web|hd|sd|uhd|4k|proper|repack)$/i.test(m[1].trim()))return this.name(m[1])||m[1].trim();const c=this.name(raw);if(!c)return number;
      const series=this.name(ep.SeriesName);if(series&&c.toLowerCase()===series.toLowerCase())return number;
      return /^(episode|ep\.?)\s*\d+$/i.test(c)||this.release.test(c)?number:c;},
    title(item){return item.Type==='Episode'?this.episode(item):this.name(item.Name)||item.Name||'';}
  };
  window.OrbitalText=OT;

  // Sept 27: the show page (the owner: "make the episodes page the only page when clicking on a show"). Jellyfin's series
  // page stays underneath (hidden) so its Trailer / Watched / My List / ⋯ buttons keep working; this page drives them.
  // Wide screens: header + Season 1..N, More like this, Cast & crew on the left, the selected list on the right.
  // Phones: header, full-width Play, action row, Episodes / More like this / Cast tabs and a season picker.
  const showCache=new Map();
  async function showPage(api,user,item,page,owned=null){
    if(owned&&!owned())return;
    await window.OrbitalPersonal?.prepare(api);
    if((owned&&!owned())||api.getCurrentUserId()!==user)return;
    window.OrbitalPersonal?.itemActions(api,item,page.querySelector('.detailPageWrapperContainer')||page);
    const key=user+'|'+item.Id;
    if(page.dataset.orbitalShow===key&&page.querySelector('.orbital-show'))return;
    page.dataset.orbitalShow=key;page.querySelectorAll('.orbital-show').forEach(n=>n.remove());
    const host=page.querySelector('.detailPageWrapperContainer');if(!host){if(owned)throw new Error('Show content is not attached');return;}
    page.classList.add('orbital-show-page');
    const json=(path,params)=>api.getJSON(api.getUrl(path,params));
    const current=()=>(!owned||owned())&&api.getCurrentUserId()===user&&location.hash.includes('id='+item.Id)&&page.isConnected&&page.dataset.orbitalShow===key;
    const params=new URLSearchParams(location.hash.split('?')[1]||''),sid=api.serverId();
    const details=id=>'#/details?id='+id+'&serverId='+sid,playHref=id=>details(id)+'&orbitalAutoplay=1';
    const root=el('section','orbital-show');root.dataset.key=key;root.setAttribute('aria-label',(OT.name(item.Name)||'Show')+' · episodes');
    const left=el('div','os-left'),right=el('div','os-right');
    const title=el('h1','os-title'),name=OT.name(item.Name)||item.Name||'';
    if(item.ImageTags?.Logo){const img=el('img','os-logo');img.src=api.getImageUrl(item.HeroArtId||item.Id,{type:'Logo',tag:item.ImageTags.Logo,maxWidth:720,quality:90});img.alt=name;img.onerror=()=>img.replaceWith(el('span','os-title-text',name));title.append(img);}
    else title.append(el('span','os-title-text',name));
    const meta=el('p','os-meta'),synopsis=OT.overview(item.Overview),actions=el('div','os-actions');
    left.append(title,meta);
    if(synopsis){const p=el('p','os-synopsis',synopsis);p.tabIndex=0;p.title='Show the full synopsis';p.onclick=()=>p.classList.toggle('is-open');p.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();p.classList.toggle('is-open');}};left.append(p);}
    left.append(actions);
    const nav=el('div','os-nav');nav.setAttribute('aria-label','Seasons and more');left.append(nav);
    const tabs=el('div','os-tabs');tabs.setAttribute('role','tablist');
    const head=el('div','os-head'),heading=el('h2','os-heading'),select=el('select','os-season-select');select.setAttribute('aria-label','Season');head.append(heading,select);
    const status=el('p','os-status','Loading episodes…');status.setAttribute('role','status');
    const list=el('ol','os-list');list.setAttribute('aria-label','Episodes');
    right.append(tabs,head,status,list);root.append(left,right);host.prepend(root);
    window.OrbitalPersonal?.itemActions(api,item,host);
    let seasons=[],next=null;
    try{seasons=((await json('Shows/'+item.Id+'/Seasons',{userId:user,Fields:'ChildCount'})).Items||[]).filter(s=>s.Type==='Season');}catch(error){if(owned&&owned())throw error;}
    try{next=(await json('Shows/NextUp',{userId:user,seriesId:item.Id,Limit:1,Fields:'Overview'})).Items?.[0]||null;}catch{}
    if(!current())return;
    meta.textContent=[OrbitalRating.label(item),item.ProductionYear,item.OfficialRating,
      seasons.length?(seasons.length===1?'1 season':seasons.length+' seasons'):null,(item.Genres||[]).slice(0,2).join(', ')||null].filter(Boolean).join('  ·  ');
    const episodes=async id=>{const k=user+'|'+id;if(showCache.has(k))return showCache.get(k);
      const eps=(await json('Shows/'+item.Id+'/Episodes',{userId:user,seasonId:id,Fields:'Overview,PrimaryImageAspectRatio',EnableImageTypes:'Primary,Thumb',ImageTypeLimit:1})).Items||[];
      showCache.set(k,eps);if(showCache.size>40)showCache.delete(showCache.keys().next().value);return eps;};
    const askedSeason=params.get('season'),askedEpisode=params.get('episode');
    let season=seasons.some(s=>s.Id===askedSeason)?askedSeason:next?.SeasonId;
    if(!seasons.some(s=>s.Id===season))season=(seasons.find(s=>s.IndexNumber>0)||seasons[0])?.Id;
    let focusId=askedEpisode||next?.Id||null;
    if(!next&&season){try{const eps=await episodes(season);next=eps.find(e=>!e.UserData?.Played)||eps[0]||null;}catch{}}
    // Actions: Play/Resume the next episode and Trailer first; My List, Watched and ⋯ (Jellyfin's own menu) after.
    const nativeButton=cls=>page.querySelector('.mainDetailButtons '+cls);
    const action=(label,cls,fn,icon)=>{const b=el('button','os-action '+cls);b.type='button';if(icon)b.append(el('span','material-icons',icon));b.append(el('span','os-action-label',label));b.onclick=fn;actions.append(b);return b;};
    if(next){const resume=(next.UserData?.PlaybackPositionTicks||0)>0;const b=action((resume?'Resume':'Play')+' S'+(next.ParentIndexNumber??0)+':E'+(next.IndexNumber??0),'os-play',()=>{location.hash=playHref(next.Id);},'play_arrow');b.setAttribute('aria-label',(resume?'Resume ':'Play ')+'season '+(next.ParentIndexNumber??0)+' episode '+(next.IndexNumber??0));if(resume){const r=action('Start over','os-restart',()=>{const m=window.TelevisionPlayerBridge?.manager;if(m?.play)m.play({ids:[next.Id],startPositionTicks:0,serverId:api.serverId()});else location.hash=playHref(next.Id);},'replay');r.setAttribute('aria-label','Start season '+(next.ParentIndexNumber??0)+' episode '+(next.IndexNumber??0)+' from the beginning');}}
    if((item.LocalTrailerCount||0)>0||(item.RemoteTrailers||[]).length)action('Trailer','os-trailer',()=>{const n=nativeButton('.btnPlayTrailer');if(n)n.click();else{const url=item.RemoteTrailers?.[0]?.Url;if(url)window.open(url,'_blank','noopener');}},'movie');
    let favorite=!!item.UserData?.IsFavorite,played=!!item.UserData?.Played;
    const fav=action('','os-fav',()=>{nativeButton('.btnUserRating')?.click();favorite=!favorite;paintToggles();},null);
    const watched=action('','os-watched',()=>{nativeButton('.btnPlaystate')?.click();played=!played;paintToggles();for(const k of [...showCache.keys()])if(k.startsWith(user+'|'))showCache.delete(k);setTimeout(()=>{if(current())choose(selected,false);},900);},null);
    const more=action('More','os-more',()=>nativeButton('.btnMoreCommands')?.click(),'more_horiz');more.setAttribute('aria-label','More options');
    function paintToggles(){fav.replaceChildren(el('span','material-icons',favorite?'check':'add'),el('span','os-action-label','My List'));fav.setAttribute('aria-pressed',String(favorite));
      watched.replaceChildren(el('span','material-icons',played?'check_circle':'radio_button_unchecked'),el('span','os-action-label',played?'Watched':'Mark watched'));watched.setAttribute('aria-pressed',String(played));}
    paintToggles();watched.remove();
    // Entries: seasons, then More like this and Cast & crew.
    const entries=seasons.map(s=>({kind:'season',id:s.Id,label:OT.name(s.Name)||('Season '+(s.IndexNumber??'')),count:s.ChildCount}));
    entries.push({kind:'similar',id:'similar',label:'More like this'});if((item.People||[]).length)entries.push({kind:'cast',id:'cast',label:'Cast & crew'});
    let selected=entries.find(e=>e.id===season)||entries[0];
    const navButtons=new Map();
    for(const entry of entries){const b=el('button','os-nav-item'+(entry.kind!=='season'?' os-nav-extra':''));b.type='button';b.dataset.id=entry.id;
      b.append(el('span','os-nav-label',entry.label));if(entry.count)b.append(el('span','os-nav-count',entry.count===1?'1 episode':entry.count+' episodes'));
      b.onclick=async()=>{const ready=await choose(entry,false);if(ready&&selected===entry&&current())focusRow();};let timer;b.onfocus=()=>{clearTimeout(timer);if(entry!==selected)timer=setTimeout(()=>choose(entry,false),180);};
      nav.append(b);navButtons.set(entry.id,b);}
    for(const [kind,label] of [['season','Episodes'],['similar','More like this'],['cast','Cast & crew']]){if(!entries.some(e=>e.kind===kind))continue;
      const t=el('button','os-tab',label);t.type='button';t.dataset.kind=kind;t.setAttribute('role','tab');
      t.onclick=()=>choose(kind==='season'?(entries.find(e=>e.id===select.value)||entries.find(e=>e.kind==='season')):entries.find(e=>e.kind===kind),false);tabs.append(t);}
    for(const s of entries.filter(e=>e.kind==='season')){const o=el('option','',s.label+(s.count?' · '+s.count+' ep.':''));o.value=s.id;select.append(o);}
    select.onchange=()=>{focusId=null;choose(entries.find(e=>e.id===select.value),false);};
    const still=(src,label,wide,badge,progress,done)=>{const art=el('div','os-still'+(wide?'':' os-portrait'));
      if(src){const img=el('img');img.src=src;img.alt='';img.loading='lazy';img.onerror=()=>{img.remove();art.append(el('span','os-still-text',label));};art.append(img);}else art.append(el('span','os-still-text',label));
      if(badge)art.append(el('span','os-badge',badge));
      if(progress>0&&progress<100){const bar=el('span','os-progress');bar.style.setProperty('--p',progress.toFixed(1)+'%');art.append(bar);}
      if(done){const d=el('span','os-done material-icons','check');d.setAttribute('aria-label','Watched');art.append(d);}return art;};
    const minutes=t=>t?Math.max(1,Math.round(t/6e8)):null;
    function episodeRow(raw){if(window.OrbitalPersonal?.isHidden(api,raw)){const omitted=el('li');omitted.hidden=true;return omitted;}const ep=window.OrbitalPersonal?.project(api,raw)||raw;const li=el('li'),a=el('a','os-row');a.href=playHref(ep.Id);a.dataset.id=ep.Id;
      const label=OT.episode(ep),ud=ep.UserData||{},pct=Number(ud.PlayedPercentage)||0,badge='S'+(ep.ParentIndexNumber??0)+':E'+(ep.IndexNumber??0);
      const src=ep.ImageTags?.Primary?api.getImageUrl(ep.Id,{type:'Primary',tag:ep.ImageTags.Primary,maxWidth:520,quality:80}):!ep.oxSpoilerMask?.includes('image')&&item.BackdropImageTags?.[0]?api.getImageUrl(item.HeroArtId||item.Id,{type:'Backdrop',tag:item.BackdropImageTags[0],maxWidth:520,quality:70}):null;
      const body=el('div','os-body');if(ep.Id===focusId)body.append(el('span','os-flag',pct>0&&pct<100?'Continue':ep.Id===next?.Id?'Up next':'This episode'));
      body.append(el('strong','os-row-title',label));const ov=OT.overview(ep.Overview);if(ov)body.append(el('p','os-row-overview',ov));
      const m=minutes(ep.RunTimeTicks),left=pct>0&&pct<100&&ep.RunTimeTicks?Math.max(1,Math.round(ep.RunTimeTicks*(1-pct/100)/6e8)):null;
      const line=[m?m+'m':null,left?left+' min left':null].filter(Boolean).join('  ·  ');if(line)body.append(el('span','os-row-meta',line));
      a.append(still(src,label,true,badge,pct,ud.Played),body);a.setAttribute('aria-label',[badge,label,ov,line].filter(Boolean).join('. ')+'. Play');
      const info=el('a','os-row-info material-icons','info');info.href=details(ep.Id);info.setAttribute('aria-label','Episode details: '+label);info.title='Episode details';
      li.append(a,info);if(ep.oxSpoilerMask?.length){const reveal=el("button","orbital-chip","Reveal episode");reveal.onclick=()=>{window.OrbitalPersonal.reveal(api,raw);li.replaceWith(episodeRow(raw));};li.append(reveal);}return li;}
    function itemRow(s){const li=el('li'),a=el('a','os-row');a.href=details(s.Id);a.dataset.id=s.Id;
      const src=s.BackdropImageTags?.[0]?api.getImageUrl(s.Id,{type:'Backdrop',tag:s.BackdropImageTags[0],maxWidth:520,quality:75}):s.ImageTags?.Thumb?api.getImageUrl(s.Id,{type:'Thumb',tag:s.ImageTags.Thumb,maxWidth:520,quality:75}):s.ImageTags?.Primary?api.getImageUrl(s.Id,{type:'Primary',tag:s.ImageTags.Primary,maxWidth:360,quality:75}):null;
      const body=el('div','os-body'),label=OT.name(s.Name)||s.Name||'';body.append(el('strong','os-row-title',label));const ov=OT.overview(s.Overview);if(ov)body.append(el('p','os-row-overview',ov));
      const line=[OrbitalRating.label(s),s.ProductionYear,(s.Genres||[]).slice(0,2).join(', ')||null].filter(Boolean).join('  ·  ');if(line)body.append(el('span','os-row-meta',line));
      a.append(still(src,label,true),body);li.append(a);return li;}
    function personRow(p){const li=el('li'),a=el('a','os-row os-person');a.href=details(p.Id);a.dataset.id=p.Id;
      const src=p.PrimaryImageTag?api.getImageUrl(p.Id,{type:'Primary',tag:p.PrimaryImageTag,maxWidth:240,quality:80}):null;
      const body=el('div','os-body');body.append(el('strong','os-row-title',p.Name||''));const role=p.Role?'as '+p.Role:p.Type&&p.Type!=='Actor'?String(p.Type).replace(/([a-z])([A-Z])/g,'$1 $2'):'';if(role)body.append(el('span','os-row-meta',role));
      a.append(still(src,p.Name||'',false),body);li.append(a);return li;}
    let serial=0;
    async function choose(entry,initial){if(!entry||!current())return;const mine=++serial;selected=entry;
      heading.textContent=entry.kind==='season'?entry.label:entry.label;select.hidden=entry.kind!=='season'||entries.filter(e=>e.kind==='season').length<2;if(entry.kind==='season')select.value=entry.id;
      for(const [id,b] of navButtons){b.classList.toggle('is-selected',id===entry.id);b.setAttribute('aria-current',id===entry.id?'true':'false');}
      for(const t of tabs.children)t.setAttribute('aria-selected',String(t.dataset.kind===entry.kind));
      list.setAttribute('aria-label',entry.label);list.setAttribute('aria-busy','true');list.inert=true;list.style.minHeight=Math.min(600,list.clientHeight)+'px';list.style.visibility='hidden';status.hidden=false;status.textContent='Loading '+entry.label+'…';
      let rows;
      try{if(entry.kind==='season')rows=(await episodes(entry.id)).map(episodeRow);
        else if(entry.kind==='similar'){const k=user+'|similar|'+item.Id;let s=showCache.get(k);if(!s){s=(await json('Items/'+item.Id+'/Similar',{userId:user,Limit:20,Fields:'Overview,Genres,PrimaryImageAspectRatio'})).Items||[];showCache.set(k,s);}rows=s.map(itemRow);}
        else rows=(item.People||[]).slice(0,40).map(personRow);}
      catch(error){if(!current()||mine!==serial)return;list.replaceChildren();list.inert=false;list.removeAttribute('aria-busy');list.style.visibility='';list.style.minHeight='';status.textContent='Couldn’t load this. Choose it again to retry.';if(owned&&initial)throw error;return;}
      if(!current()||mine!==serial||!root.isConnected)return;
      list.replaceChildren(...rows);list.inert=false;list.removeAttribute('aria-busy');list.style.visibility='';list.style.minHeight='';status.hidden=rows.length>0;if(!rows.length)status.textContent=entry.kind==='season'?'No episodes in this season yet.':'Nothing to show here yet.';
      const target=list.querySelector('.os-row[data-id="'+CSS.escape(focusId||'')+'"]');
      if(target&&initial)requestAnimationFrame(()=>target.scrollIntoView({block:'nearest'}));return true;}
    function focusRow(){if(list.getAttribute('aria-busy')==='true')return;(list.querySelector('.os-row[data-id="'+CSS.escape(focusId||'')+'"]')||list.querySelector('.os-row'))?.focus();}
    // Remote/keyboard: Up/Down inside a column, Right into the list, Left back to the seasons.
    root.addEventListener('keydown',e=>{const t=e.target;if(!(t instanceof HTMLElement))return;
      const move=(items,dir)=>{const i=items.indexOf(t),n=items[i+dir];if(n){e.preventDefault();n.focus();n.scrollIntoView({block:'nearest'});}};
      if(t.classList.contains('os-row')){const rows=[...list.querySelectorAll('.os-row')];if(e.key==='ArrowDown')move(rows,1);else if(e.key==='ArrowUp')move(rows,-1);else if(e.key==='ArrowLeft'&&getComputedStyle(nav).display!=='none'){e.preventDefault();navButtons.get(selected.id)?.focus();}}
      else if(t.classList.contains('os-nav-item')){const items=[...nav.children];if(e.key==='ArrowDown')move(items,1);else if(e.key==='ArrowUp')move(items,-1);else if(e.key==='ArrowRight'){e.preventDefault();focusRow();}}});
    list.addEventListener('focusin',e=>{const r=e.target.closest?.('.os-row');if(r&&selected.kind==='season')focusId=r.dataset.id;});
    await choose(selected,true);
    // Remote/keyboard browsers start on Play; touch screens get no focus ring.
    if(current()&&matchMedia('(hover: hover)').matches&&!document.activeElement?.closest?.('.orbital-show'))actions.querySelector('.os-play,button')?.focus({preventScroll:true});
  }

  // Sept 27: movie and episode pages, like Orbital TV .58: title logo, clean titles and synopsis, badge chips,
  // resume progress + time left, More like this before cast, and an "All episodes" link back to the show page.
  function refineDetail(api,item,page){
    window.OrbitalPersonal?.itemActions(api,item,page.querySelector('.detailPageWrapperContainer')||page);
    item=window.OrbitalPersonal?.project(api,item)||item;
    if(!['Movie','Episode'].includes(item.Type))return;
    const name=page.querySelector('h1.itemName'),parent=page.querySelector('.parentName');
    page.classList.toggle('orbital-has-logo',false);
    if(item.Type==='Movie'&&item.ImageTags?.Logo&&name&&!name.querySelector('.orbital-title-logo')){
      const img=el('img','orbital-title-logo');img.src=api.getImageUrl(item.HeroArtId||item.Id,{type:'Logo',tag:item.ImageTags.Logo,maxWidth:720,quality:90});img.alt=OT.name(item.Name)||'';img.onerror=()=>{img.remove();page.classList.remove('orbital-has-logo');};name.prepend(img);page.classList.add('orbital-has-logo');}
    else if(name?.querySelector('.orbital-title-logo'))page.classList.add('orbital-has-logo');
    // Clean visible titles without fighting Jellyfin's own rendering (text nodes only, idempotent).
    const clean=(node,value)=>{if(!node||!value)return;for(const n of node.childNodes)if(n.nodeType===3&&n.textContent.trim()&&n.textContent.trim()!==value){n.textContent=value;return;}
      const a=node.querySelector('a');if(a&&a.textContent.trim()&&a.textContent.trim()!==value)a.textContent=value;};
    if(item.Type==='Episode'){
      // Jellyfin: <h3 class=itemName><bdi><a>Season 1</a> - 2. Breaking.Bad.S01E02.Cats.in.the.Bag...</bdi></h3>
      const epName=page.querySelector('.nameContainer .itemName'),bdi=epName?.querySelector('bdi')||epName;
      if(bdi){const link=bdi.querySelector('a'),linked=!!link,title=OT.episode(item);
        if(link){const season=link.textContent.includes(' · Episode ')?link.dataset.orbitalSeason:link.textContent.trim();link.dataset.orbitalSeason=season;link.classList.add('orbital-ep-eyebrow');
          const eyebrow=season+(item.IndexNumber!=null&&!/^Episode \d+$/.test(title)?' · Episode '+item.IndexNumber:'');if(link.textContent!==eyebrow)link.textContent=eyebrow;}
        const value=linked?title:(item.IndexNumber!=null?'E'+item.IndexNumber+' · ':'')+title,t=[...bdi.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).at(-1);
        if(t){if(t.textContent!==value)t.textContent=value;}else if(!linked)bdi.textContent=value.trim();}
      clean(page.querySelector('.nameContainer .parentName bdi')||parent,OT.name(item.SeriesName));}
    else clean(name?.querySelector('bdi')||name,OT.name(item.Name));
    page.querySelectorAll('.starRatingContainer').forEach(n=>n.classList.toggle('orbital-thin-rating',OrbitalRating.thin(item)));
    const overview=page.querySelector('.detailSectionContent .overview');if(overview)overview.classList.toggle('orbital-hidden-overview',!OT.overview(overview.textContent));
    // Resume progress + time left, under the buttons.
    page.querySelectorAll('.orbital-resume-line').forEach(n=>{if(n.dataset.item!==item.Id)n.remove();});
    const ud=item.UserData||{},pos=ud.PlaybackPositionTicks||0,run=item.RunTimeTicks||0;
    if(pos>0&&run>0&&!ud.Played&&!page.querySelector('.orbital-resume-line')){const line=el('div','orbital-resume-line');line.dataset.item=item.Id;const bar=el('span','orbital-resume-bar');bar.style.setProperty('--p',Math.min(100,pos/run*100).toFixed(1)+'%');
      const left=Math.max(1,Math.round((run-pos)/6e8));line.append(bar,el('span','',left>=60?Math.floor(left/60)+'h '+left%60+'m left':left+' min left'));page.querySelector('.mainDetailButtons')?.after(line);}
    // More like this before cast/extras.
    const similar=page.querySelector('#similarCollapsible'),cast=page.querySelector('#castCollapsible');
    if(similar&&cast&&(cast.compareDocumentPosition(similar)&Node.DOCUMENT_POSITION_FOLLOWING))cast.before(similar);
    // Episode pages: back to the whole show on this season.
    if(item.Type==='Episode'&&item.SeriesId&&!page.querySelector('.orbital-show-link')){const a=el('a','orbital-chip orbital-show-link','All episodes');
      a.href='#/details?id='+item.SeriesId+'&serverId='+api.serverId()+(item.SeasonId?'&season='+item.SeasonId:'')+'&episode='+item.Id;page.querySelector('.mainDetailButtons')?.append(a);}
  }
  let detailVeilTimer=0;
  function detailVeil(on){const root=document.documentElement;clearTimeout(detailVeilTimer);
    if(on){root.classList.add('orbital-detail-pending');detailVeilTimer=setTimeout(()=>detailVeil(false),1200);}
    else if(root.classList.contains('orbital-detail-pending')){root.classList.remove('orbital-detail-pending');root.classList.add('orbital-detail-reveal');setTimeout(()=>root.classList.remove('orbital-detail-reveal'),260);}}
  addEventListener('hashchange',()=>detailVeil(/^#\/details\?/.test(location.hash)));
  async function enhanceDetail(api,user){
    if(!/^#\/details\?/.test(location.hash))return;
    const route=location.hash,id=new URLSearchParams(route.split('?')[1]).get('id');
    const backdrop=document.querySelector('#itemDetailPage:not(.hide) #itemBackdrop');
    const detailPage=backdrop?.closest('#itemDetailPage'),host=detailPage?.parentElement;
    if(!id||!backdrop||!detailPage||!host)return;
    let server,credential;try{server=api.serverId();credential=api.accessToken();}catch{return;}
    const previous=state.detailReadyOwner;
    if(state.detailKey===user+id&&previous?.api===api&&previous.route===route&&previous.user===user&&previous.server===server&&previous.credential===credential&&previous.page===detailPage&&previous.backdrop===backdrop&&previous.current()){
      if(!state.detailBusy)detailVeil(false);return;
    }
    const owner={api,user,server,credential,route,page:detailPage,backdrop};state.detailReadyOwner=owner;
    const current=()=>{try{return state.detailReadyOwner===owner&&window.ApiClient===api&&api.getCurrentUserId()===user&&api.serverId()===server&&api.accessToken()===credential&&location.hash===route&&detailPage.isConnected&&backdrop.isConnected&&detailPage.parentElement===host&&document.querySelector('#itemDetailPage:not(.hide) #itemBackdrop')===backdrop;}catch{return false;}};
    owner.current=current;if(!current())return;
    state.detailKey=user+id;state.detailNode=backdrop;
    const stamp=phase=>{if(!current())return false;detailPage.dataset.pageReadyRoute=route;detailPage.dataset.pageReadyUser=user;detailPage.dataset.phase=phase;detailPage.dataset.presentable='pending';return true;};
    stamp('loading');const ticket=window.OrbitalPageReady?.begin(route);
    delete detailPage.dataset.orbitalShow;delete detailPage.dataset.orbitalEpisodes;
    detailPage.querySelectorAll('.orbital-show,.orbital-episodes,.orbital-similar').forEach(n=>n.remove());
    backdrop.querySelectorAll('.orbital-detail-art').forEach(n=>n.remove());
    state.detailBusy=true;
    try{const rawItem=await api.getItem(user,id);if(!current())return;if(rawItem?.Id===id){owner.autoplayItemId=id;autoplayDetail(user);}await window.OrbitalPersonal?.prepare(api);const item=window.OrbitalPersonal?.project(api,rawItem)||rawItem;
      if(!current())return;
      if(!rawItem||rawItem.Id!==id||!item||item.Id!==id)throw new Error('Detail item identity mismatch');
      backdrop.closest('#itemDetailPage')?.classList.toggle('orbital-channel-page',item.Type==='TvChannel');
      detailPage.querySelectorAll('.ox-spoiler-detail').forEach(n=>n.remove());for(const kind of ['title','image','description'])detailPage.classList.toggle('ox-mask-'+kind,item.oxSpoilerMask?.includes(kind)===true);
      if(item.oxSpoilerMask?.length){const safe=el('section','ox-spoiler-detail');safe.append(el('h1','',item.Name),el('p','','Unwatched episode. Your spoiler preferences are applied.'));const reveal=el('button','orbital-chip','Reveal episode');reveal.onclick=()=>{window.OrbitalPersonal.reveal(api,rawItem);state.detailKey=null;enhanceDetail(api,user);};safe.append(reveal);const controls=detailPage.querySelector('.mainDetailButtons');if(controls?.parentElement)controls.before(safe);else(detailPage.querySelector('.detailPagePrimaryContent')||backdrop).prepend(safe);}
      detailPage?.classList.toggle('orbital-cinema',['Movie','Series','Season','Episode'].includes(item.Type));
      // Sept 27: the detail page element is reused between titles; only series keep the show page.
      if(detailPage&&item.Type!=='Series'){detailPage.classList.remove('orbital-show-page');detailPage.querySelectorAll('.orbital-show').forEach(n=>n.remove());delete detailPage.dataset.orbitalShow;}
      if(detailPage?.classList.contains('orbital-cinema')){cinemaDetails(detailPage,item);qualityBadge(detailPage,item);prepareRemote(api,user,item,detailPage);
        await Promise.all([downloadAndKeepActions(api,user,item,detailPage,current),item.Type==='Series'?showPage(api,user,item,detailPage,current):episodesPanel(api,user,item,detailPage,current)]);
        if(!current())return;
        refineDetail(api,item,detailPage);for(const wait of [700,2000])setTimeout(()=>{if(current())refineDetail(api,item,detailPage);},wait);}
      document.querySelectorAll('.orbital-feed-choices').forEach(n=>n.remove());
      if(item.Type==='TvChannel') await feedChoices(api,user,item,detailPage,current);
      if(!current())return;
      let source=image(api,item,'Backdrop',1800);
      if(!source&&item.ParentBackdropItemId&&item.ParentBackdropImageTags?.length)source=api.getImageUrl(item.ParentBackdropItemId,{type:'Backdrop',index:0,tag:item.ParentBackdropImageTags[0],maxWidth:1800,quality:90});
      let poster=false;
      if(!source&&item.ImageTags?.Primary){source=api.getImageUrl(item.Id,{type:'Primary',tag:item.ImageTags.Primary,maxWidth:900,quality:80});poster=true;}
      else if(!source&&item.SeriesId&&item.SeriesPrimaryImageTag){source=api.getImageUrl(item.SeriesId,{type:'Primary',tag:item.SeriesPrimaryImageTag,maxWidth:900,quality:80});poster=true;}
      backdrop.classList.toggle('orbital-art-poster',poster);backdrop.classList.toggle('orbital-art-missing',!source);
      if(source){backdrop.querySelectorAll('.orbital-detail-art').forEach(n=>n.remove());const img=el('img','orbital-detail-art'+(poster?' orbital-detail-art-poster':''));img.alt='';img.src=source;backdrop.append(img);}
      else if(!backdrop.querySelector('.orbital-detail-art-text')){backdrop.append(el('span','orbital-detail-art-text',(item.SeriesName||item.Name||'').replace(/\s*\(\d{4}\)\s*$/,'')));}
      if(!current())return;
      if(!detailPage.querySelector('.mainDetailButtons')||!detailPage.querySelector('.detailPageWrapperContainer'))throw new Error('Detail content is not attached');
      stamp('complete');
      await window.OrbitalPageReady?.prepare(detailPage,{api,user,server,credential,host,valid:current});
    }catch{if(current()){stamp('error');await window.OrbitalPageReady?.fail('This title could not finish loading. Please retry.',ticket);}}
    finally{if(current()){state.detailBusy=false;requestAnimationFrame(()=>{if(current())detailVeil(false);});}}
  }
  addEventListener('orbital:page-retry',event=>{
    if(event.detail?.route!==location.hash||!/^#\/details\?/.test(location.hash))return;
    const owner=state.detailReadyOwner;if(!owner?.current())return;
    state.detailKey=null;enhanceDetail(owner.api,owner.user);
  });
  // Resolution/codec badge from the server's stored streams; nothing is probed to show it.
  function qualityBadge(page,item){
    if(!['Movie','Episode'].includes(item.Type))return;
    const streams=item.MediaSources?.[0]?.MediaStreams||[],video=streams.find(s=>s.Type==='Video'),audio=streams.find(s=>s.Type==='Audio');
    page.querySelectorAll('.orbital-quality-row').forEach(n=>{if(n.dataset.item!==item.Id)n.remove();});
    if(!video?.Height){page.querySelectorAll('.orbital-quality-row').forEach(n=>n.remove());return;}
    const h=video.Height,w=video.Width||0,label=h>=2100||w>=3840?'4K':h>=1080||w>=1920?'1080p':h>=720||w>=1280?'720p':h>=540?'540p':'SD · '+h+'p';
    const parts=[label,video.VideoRangeType&&video.VideoRangeType!=='SDR'?video.VideoRangeType:null,audio?.Codec?String(audio.Codec).toUpperCase()+(audio.Channels>2?' '+(audio.Channels>=6?'5.1':audio.Channels+'ch'):''):null].filter(Boolean);
    // Own row after the primary buttons: jellyfin-web re-renders its misc-info line per item and the
    // detail page element is reused between titles, so the badge is keyed to the item it describes.
    let row=page.querySelector('.orbital-quality-row');
    if(!row){row=el('div','orbital-quality-row');(page.querySelector('.mainDetailButtons')||page.querySelector('.detailSectionContent'))?.after(row);}
    row.dataset.item=item.Id||'';const chips=el('div','orbital-quality-chips');const range=String(video.VideoRangeType||'');
    const labels=[label,/DOVI/i.test(range)?'Dolby Vision':range&&range!=='SDR'&&range!=='Unknown'?'HDR':null,streams.some(s=>s.Type==='Audio'&&/atmos/i.test((s.Profile||'')+' '+(s.DisplayTitle||'')))?'Atmos':null,
      (()=>{const ch=Math.max(0,...streams.filter(s=>s.Type==='Audio').map(s=>s.Channels||0));return ch>=8?'7.1':ch>=6?'5.1':null;})(),streams.some(s=>s.Type==='Subtitle')?'CC':null].filter(Boolean);
    for(const t of labels)chips.append(el('span','orbital-quality-chip',t));row.replaceChildren(chips);
  }
  // Remote (streamed) titles are probed by the server on their first Play, which can take 6-10 s.
  // Start that same negotiation while the title page is open so Play begins quickly. One request per
  // title per minute, only for un-probed remote sources, never for Live TV.
  const prepared=new Map();
  async function prepareRemote(api,user,item,page){
    if(!['Movie','Episode'].includes(item.Type))return;
    const source=item.MediaSources?.[0];if(!source||source.Protocol!=='Http'||!source.IsRemote)return;
    const probed=(source.MediaStreams||[]).some(s=>s.Type==='Video');
    page.querySelectorAll('.orbital-prepare-note').forEach(n=>n.remove());
    if(probed)return;
    const key=user+'|'+item.Id,now=Date.now();
    if(prepared.get(key)&&now-prepared.get(key)<60000)return;
    prepared.set(key,now);
    const note=el('p','orbital-backfill-note orbital-prepare-note','Preparing playback…');note.setAttribute('role','status');
    const phone=window.OrbitalPhone?.active();
    if(phone){let slot=page.querySelector('.orbital-prepare-slot');if(!slot){slot=el('div','orbital-prepare-slot');(page.querySelector('.mainDetailButtons')||page.querySelector('.detailSectionContent'))?.after(slot);}slot.append(note);}
    else (page.querySelector('.mainDetailButtons')||page.querySelector('.detailSectionContent'))?.after(note);
    const noteTimer=phone?setTimeout(()=>note.remove(),8000):null;
    try{
      const r=await api.ajax({type:'POST',url:api.getUrl('Items/'+item.Id+'/PlaybackInfo'),data:JSON.stringify({UserId:user,AutoOpenLiveStream:false,IsPlayback:false,DeviceProfile:{}}),contentType:'application/json',dataType:'json'});
      const ok=(r?.MediaSources?.[0]?.MediaStreams||[]).some(s=>s.Type==='Video');
      if(!note.isConnected)return;
      if(ok){note.remove();qualityBadge(page,{Id:item.Id,Type:item.Type,MediaSources:r.MediaSources});}
      else note.remove();
    }catch(error){if(!note.isConnected){}else if(error?.status===429)note.textContent='Playback is busy. Try again shortly.';else note.remove();}finally{if(noteTimer)clearTimeout(noteTimer);}
  }
  // Keep explanations available without making the main actions read like diagnostics.
  function detailHelp(className,summaryText,bodyText){
    const box=el('details','orbital-detail-help '+className);
    const summary=el('summary','',summaryText);
    const body=el('p','orbital-backfill-note',bodyText);
    box.append(summary,body);return box;
  }
  function cinemaDetails(page,item){
    const original=page.querySelector('.originalTitle'),name=page.querySelector('h1.itemName');
    const normalized=t=>t.replace(/\s*\(\d{4}\)\s*$/,'').trim().toLocaleLowerCase();
    if(original&&name)original.classList.toggle('orbital-repeated-title',normalized(original.textContent)===normalized(name.textContent));
    page.classList.toggle('ob21-season',item.Type==='Season');
    if((item.Type==='Series'||(item.Type==='Season'&&item.ChildCount>0))&&!page.querySelector('.orbital-season-jump')){
      const b=el('button','orbital-chip orbital-season-jump',item.Type==='Season'?'Episodes':'Seasons & episodes');b.type='button';
      b.onclick=()=>{const section=page.querySelector('.orbital-episodes')||page.querySelector('#listChildrenCollapsible');section?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});section?.querySelector('a,button')?.focus({preventScroll:true});};
      page.querySelector('.mainDetailButtons')?.append(b);
    }
    // Sept 27: 'IMDb , TMDB' plain links become chips (the joining ', ' text nodes are dropped).
    page.querySelectorAll('.itemExternalLinks:not(.orbital-links)').forEach(box=>{for(const n of [...box.childNodes])if(n.nodeType===3)n.remove();box.classList.add('orbital-links');});
    const tracks=page.querySelector('form.trackSelections');
    if(tracks&&['Movie','Episode'].includes(item.Type)&&!tracks.closest('.orbital-playback-options')){
      const box=el('details','orbital-playback-options');const summary=el('summary','','Audio, subtitles & video');
      tracks.before(box);box.append(summary,tracks);
    }
    page.querySelectorAll('.btnPlayTrailer').forEach(button=>{
      button.setAttribute('aria-label','Watch trailer');button.setAttribute('title','Watch trailer');
      if(!button.querySelector('.orbital-trailer-label'))button.append(el('span','orbital-trailer-label','Watch trailer'));
    });
    page.querySelectorAll('.btnPlay,.btnResume').forEach(button=>{
      if(!button.querySelector('.orbital-play-label')){const name=button.getAttribute('title')||button.getAttribute('aria-label')||'Play';button.append(el('span','orbital-play-label',name));}
    });
    const remote=(item.Tags||[]).some(tag=>String(tag).toLowerCase()==='iptv vod');
    let notice=page.querySelector('.orbital-iptv-capacity');
    // Jellyfin reuses this page across titles. Never carry a remote-source notice to a local title.
    if(notice&&(!remote||notice.dataset.item!==item.Id||notice.tagName!=='DETAILS')){notice.remove();notice=null;}
    if(remote&&!notice){
      notice=detailHelp('orbital-iptv-capacity','About streaming availability',
        'This copy streams from an external source with a shared connection limit. If all connections are in use, playback waits for one to become available. Other movies and shows in your library remain available.');
      notice.dataset.item=item.Id;
      (page.querySelector('.mainDetailButtons')||page.querySelector('.detailSectionContent'))?.after(notice);
    }
  }
  // Use Jellyfin's own authenticated download handler for ordinary media files. Remote
  // pointers stay hidden: saving a .strm file is neither an offline copy nor a safe way
  // to expose a provider route. IPTV titles instead get an explicit request link-off.
  async function downloadAndKeepActions(api,user,item,page,owned=null){
    if(owned&&!owned())return;
    const buttons=page.querySelector('.mainDetailButtons');if(!buttons){if(owned)throw new Error('Detail actions are not attached');return;}
    page.querySelectorAll('.orbital-keep-available,.orbital-keep-note,.orbital-cloud-download,.orbital-download-note').forEach(n=>n.remove());
    const nativeDownload=buttons.querySelector('.btnDownload');
    const source=item.MediaSources?.[0],path=String(item.Path||source?.Path||'');
    const pointer=/\.strm(?:$|[?#])/i.test(path)||source?.IsRemote||source?.Protocol==='Http';
    const tagged=value=>(value||[]).some(tag=>String(tag).toLowerCase()==='iptv vod');
    const iptvItem=tagged(item.Tags)||path.toLowerCase().includes('/iptv-vod/');
    const cloudPointer=pointer&&!iptvItem&&path.toLowerCase().startsWith('/config/catalog/');
    let policy=null;try{policy=(await api.getCurrentUser())?.Policy||null;}catch{/* Native controls remain unchanged on an API failure. */}
    if((owned&&!owned())||api.getCurrentUserId()!==user||new URLSearchParams(location.hash.split('?')[1]||'').get('id')!==item.Id||!page.isConnected)return;
    const downloadable=Boolean(nativeDownload&&policy?.EnableContentDownloading&&item.CanDownload&&['Movie','Episode'].includes(item.Type)&&!pointer);
    if(nativeDownload){
      nativeDownload.classList.toggle('hide',!downloadable);
      nativeDownload.querySelectorAll('.orbital-download-label').forEach(n=>n.remove());
      if(downloadable){nativeDownload.setAttribute('title','Download file');nativeDownload.setAttribute('aria-label','Download file');nativeDownload.append(el('span','orbital-download-label','Download'));}
    }
    if(window.OrbitalEdition?.features?.downloads&&cloudPointer&&policy?.EnableContentDownloading&&item.CanDownload&&['Movie','Episode'].includes(item.Type)){
      const button=el('button','orbital-chip orbital-cloud-download');button.type='button';button.append(icon('download'),el('span','orbital-download-label','Download'));
      button.setAttribute('title','Download video file');button.setAttribute('aria-label','Download video file');
      button.addEventListener('click',async()=>{
        if(button.getAttribute('aria-busy')==='true')return;button.setAttribute('aria-busy','true');button.disabled=true;
        let note=el('p','orbital-backfill-note orbital-download-note','Preparing secure download…');note.setAttribute('role','status');buttons.after(note);
        try{
          const response=await fetch('/cloud-download/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Authorization':'MediaBrowser Token='+JSON.stringify(api.accessToken())},body:JSON.stringify({itemId:item.Id})});
          if(!response.ok)throw new Error('download session '+response.status);const result=await response.json();
          if(!/^\/cloud-download\/file\/[0-9a-f]{32}$/i.test(result.url||''))throw new Error('unexpected download route');
          const anchor=el('a');anchor.href=result.url;anchor.download='';anchor.hidden=true;anchor.referrerPolicy='no-referrer';document.body.append(anchor);anchor.click();anchor.remove();
          note.textContent='Download handed to your browser';setTimeout(()=>note.remove(),5000);
        }catch{note.textContent='Download could not start. Try again in a moment.';}
        finally{button.removeAttribute('aria-busy');button.disabled=false;}
      });
      buttons.append(button);
    }
    if(!['Movie','Series','Season','Episode'].includes(item.Type))return;
    let root=item;
    if(['Season','Episode'].includes(item.Type)&&item.SeriesId){try{root=await api.getItem(user,item.SeriesId);}catch{return;}}
    if((owned&&!owned())||api.getCurrentUserId()!==user||new URLSearchParams(location.hash.split('?')[1]||'').get('id')!==item.Id||!page.isConnected)return;
    const rootPath=String(root.Path||root.MediaSources?.[0]?.Path||'').toLowerCase();
    const iptv=tagged(item.Tags)||tagged(root.Tags)||rootPath.includes('/iptv-vod/');
    const tmdb=root.ProviderIds?.Tmdb;if(!tmdb||!['Movie','Series'].includes(root.Type))return;
    if(!window.OrbitalPersonal?.enabled(api))return;
    const keep=el('button','orbital-chip orbital-keep-available','Request');keep.type='button';
    keep.setAttribute('title','Request this title through your linked Seerr account');
    keep.addEventListener('click',async()=>{
      if(api.getCurrentUserId()!==user||!page.isConnected||new URLSearchParams(location.hash.split('?')[1]||'').get('id')!==item.Id)return;
      if(location.origin!==((window.OrbitalConfig&&window.OrbitalConfig.publicOrigin)||location.origin)){openRequestModal((root.Type==='Movie'?'movie/':'tv/')+encodeURIComponent(tmdb),keep);return;}
      const m=window.OrbitalExperience.install({api,container:buttons,enabled:true,profile:'main',opener:keep});if(!m)return;const binding=await m.controller.open();
      if(m.controller.accept(binding)&&api.getCurrentUserId()===user&&page.isConnected)await m.controller.itemPanel('title-request',root.Id);
    });
    buttons.append(keep);
    buttons.after(detailHelp('orbital-keep-note','About requests','Check availability or request an eligible title through Seerr. Seerr may already list this title as available.'));

  }
  async function feedChoices(api,user,item,page,owned=null){
    if(owned&&!owned())return;
    const channels=await allChannels(api,user);
    if((owned&&!owned())||api.getCurrentUserId()!==user||!page.isConnected||!location.hash.includes('id='+item.Id))return;
    // Match only the explicit source-choice naming contract, never programme title alone.
    const isChoice=c=>(Number(c.Number)>=2601&&Number(c.Number)<=2999)||(Number(c.Number)>=3101&&Number(c.Number)<=3999);
    const parent=isChoice(item)?channels.find(c=>!isChoice(c)&&item.Name.startsWith(c.Name.slice(0,170)+' [')):item;
    const choices=parent?channels.filter(c=>isChoice(c)&&c.Name.startsWith(parent.Name.slice(0,170)+' [')):[];
    const box=el('section','orbital-feed-choices orbital-personal');box.setAttribute('aria-label','Stream sources');
    box.append(el('h2','','Playback options'));
    if(Number(item.ChannelNumber||item.Number)>=5000)box.append(el('p','orbital-backfill-note orbital-iptv-capacity','Shared IPTV capacity · Viewers can share this same channel. If every provider slot is busy or this feed fails, playback moves through its ordered alternates, then a free backup where available, then a local availability notice.'));
    if(choices.length){
      box.append(el('p','','Automatic playback tries every feed in order. Choose a specific feed only when you want to override it.'));
      const links=el('div','orbital-source-links');
      let iptvIndex=0,otherIndex=1;[parent,...choices].forEach(c=>{const raw=c.Name.slice(parent.Name.slice(0,170).length).replace(/^ \[|\]$/g,'');let label;if(c.Id===parent.Id)label='Play automatically';else if(/iptv/i.test(raw))label='IPTV feed '+(++iptvIndex);else if(/free event/i.test(raw))label='Free event backup';else if(/web stream/i.test(raw))label='Web stream backup';else{const named=raw.replace(/[\[\]|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,40);label=named&&!/^(alternate|alternative|backup)( feed| source)?$/i.test(named)?named:'Feed '+(++otherIndex);}const a=link('orbital-chip',label,detail(api,c.Id)+'&orbitalAutoplay=1','switch_video');if(c.Id===item.Id)a.setAttribute('aria-current','true');links.append(a);});box.append(links);
    }else box.append(el('p','','Only one source is currently available for this channel. Alternate feeds appear here automatically when available. The player’s Quality setting changes playback quality, not the source.'));
    box.append(link('orbital-text-link','Browse all channels','#/livetv?tab=2','arrow_forward'));
    const anchor=page.querySelector('.detailSectionContent')||page.querySelector('.detailPageContent');
    if(anchor){anchor.append(box);if(user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')&&!anchor.querySelector('.simple-detail-report')){const wrap=el('div','simple-detail-report orbital-personal');const b=el('button','simple-report','Not working? Tell the owner');b.type='button';b.dataset.channelId=item.Id;b.dataset.channelName=item.Name;b.dataset.program=item.CurrentProgram?.Name||'';wrap.append(b);anchor.append(wrap);}}
  }
  async function adminTools(api,user){
    if(!/^#\/dashboard(?:[?&]|$)/.test(location.hash)&&!activeHome()){document.querySelectorAll('.orbital-admin-tools,.orbital-backfill').forEach(n=>n.remove());return;}
    if(state.adminUser!==user){try{const u=await api.getCurrentUser();if(api.getCurrentUserId()!==user)return;state.adminUser=user;state.isAdmin=Boolean(u.Policy?.IsAdministrator);}catch{return;}}
    const page=[...document.querySelectorAll('.page:not(.hide)')].find(n=>n.getClientRects().length);
    if(!state.isAdmin||!page||page.querySelector('.orbital-admin-tools'))return;
    const box=el('nav','orbital-admin-tools orbital-personal');box.setAttribute('aria-label','Server tools');box.append('');
    const target=page.querySelector('.content-primary')||page;
    if(location.hash.startsWith('#/dashboard'))target.prepend(box);else target.append(box);
  }
  function readableTracks(){
    document.querySelectorAll('.detailTrackSelect').forEach(select=>{
      let text=select.parentElement.querySelector('.orbital-track-value');
      if(select.disabled && select.options.length===1){
        if(!text){text=el('span','orbital-track-value');select.after(text);}
        const value=select.options[0].textContent;
        if(text.textContent!==value)text.textContent=value;
        select.classList.add('orbital-single-track');
      }else{if(text)text.remove();select.classList.remove('orbital-single-track');}
    });
  }
  function hero(api, items) {
    const section=el('section','orbital-hero orbital-personal'); section.setAttribute('aria-label','Featured from your library');
    const picture=el('img','orbital-hero-image'); picture.alt=''; picture.decoding='async'; picture.fetchPriority='high';
    const shade=el('div','orbital-hero-shade'); shade.setAttribute('aria-hidden','true');
    const content=el('div','orbital-hero-content');
    const kicker=el('p','orbital-kicker','Spotlight · from your collection');
    const title=el('h1','orbital-hero-title'); const meta=el('div','orbital-meta'); const overview=el('p','orbital-hero-overview');
    const actions=el('div','orbital-actions'); const explore=link('orbital-action','Details','#','info_outline');
    const sports=link('orbital-action orbital-action-secondary','Find a film','#orbital-discover','movie');
    sports.addEventListener('click',e=>{e.preventDefault();const shelf=document.querySelector('.orbital-discover');shelf?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});shelf?.querySelector('button')?.focus({preventScroll:true});});
    actions.append(explore,sports);content.append(kicker,title,meta,overview,actions);
    const controls=el('div','orbital-carousel-controls'); const dots=el('div','orbital-dots'); dots.setAttribute('aria-label','Choose a featured title');
    const arrows=el('div','orbital-carousel-arrows'); let index=0;
    const render=i=>{
      index=(i+items.length)%items.length;const item=items[index];
      title.textContent=item.Name;overview.textContent=short(item.Overview);overview.hidden=!item.Overview;
      explore.href=detail(api,item.Id);explore.lastChild.textContent='Details';explore.setAttribute('aria-label','Details for '+item.Name);
      meta.replaceChildren();
      [item.ProductionYear,item.OfficialRating,item.RunTimeTicks?Math.round(item.RunTimeTicks/600000000)+' min':null,...(item.Genres||[]).slice(0,2)].filter(Boolean).forEach(x=>meta.append(el('span','',String(x))));
      const source=image(api,item,'Backdrop',1800);if(source) picture.src=source;
      [...dots.children].forEach((b,j)=>b.setAttribute('aria-pressed',String(j===index)));
      section.dataset.itemId=item.Id;
    };
    items.forEach((item,i)=>{const b=el('button','orbital-dot');b.type='button';b.setAttribute('aria-label','Feature '+item.Name);b.addEventListener('click',()=>render(i));dots.append(b);});
    [['Previous featured title','chevron_left',-1],['Next featured title','chevron_right',1]].forEach(([label,symbol,delta])=>{const b=el('button','orbital-arrow');b.type='button';b.setAttribute('aria-label',label);b.append(icon(symbol));b.addEventListener('click',()=>render(index+delta));arrows.append(b);});
    controls.append(dots,arrows);section.append(picture,shade,content,controls);render(0);return section;
  }
  function libraries(views) {
    const bar=el('nav','orbital-library-bar orbital-personal');bar.setAttribute('aria-label','Your libraries');
    bar.append(el('span','orbital-library-label','My library'));const links=el('div','orbital-library-links');
    const labels={'Debrid Movies':'Movies','Debrid TV Shows':'Series','Debrid Anime Movies':'Anime films','Debrid Anime Shows':'Anime series','Movies':'Local movies','TV Shows':'Local series'};
    const order=['Debrid Movies','Debrid TV Shows','Debrid Anime Movies','Debrid Anime Shows','Movies','TV Shows'];
    const sorted=views.filter(v=>!/^IPTV (?:Movies|TV Shows)$/.test(v.Name)).sort((a,b)=>(order.indexOf(a.Name)<0?99:order.indexOf(a.Name))-(order.indexOf(b.Name)<0?99:order.indexOf(b.Name)));
    sorted.forEach(v=>{
      let href,symbol='video_library';
      if(v.CollectionType==='livetv'){href='#/livetv?tab=2';symbol='sensors';}
      else if(v.CollectionType==='movies'){href='#/movies?topParentId='+encodeURIComponent(v.Id)+'&collectionType=movies';symbol='movie';}
      else if(v.CollectionType==='tvshows'){href='#/tv?topParentId='+encodeURIComponent(v.Id)+'&collectionType=tvshows';symbol='tv';}
      else {href='#/list?parentId='+encodeURIComponent(v.Id);}
      const a=link('orbital-chip'+(v.CollectionType==='livetv'?' orbital-chip-live':''),(v.Type==='UserView'?v.Name:labels[v.Name]||v.Name),href,symbol);a.title=v.Name;links.append(a);
    });
    bar.append(links);return bar;
  }
  function liveSection(api, channels) {
    const user=api.getCurrentUserId();const section=el('section','orbital-live orbital-personal');section.setAttribute('aria-label','Live TV now');section.dataset.channelCount=channels.length;
    const header=el('div','orbital-section-heading');const h=el('h2','','Live, your way');h.append(el('small','','What’s on now, and what’s coming next'));
    header.append(h,link('orbital-text-link','Open guide','#/livetv?tab=1','arrow_forward'));section.append(header);
    const filters=el('div','orbital-shelf-filters');filters.setAttribute('aria-label','Live TV views');
    const teams=el('div','orbital-team-filter');const input=el('input');input.type='search';input.placeholder='Team names, separated by commas';input.setAttribute('aria-label','Team names');
    try{input.value=localStorage.getItem('orbital-teams-'+user)||'';}catch{}
    const apply=el('button','orbital-chip','Find my teams');apply.type='button';teams.append(input,apply);
    const rail=el('div','orbital-live-rail');const status=el('p','orbital-shelf-status');status.setAttribute('role','status');
    const parents=channels.filter(c=>!isFeed(c));let mode=state.liveMode||'Live now';let request=0;
    const paint=async()=>{
      const version=++request;teams.hidden=mode!=='My teams';filters.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===mode)));
      rail.replaceChildren();status.textContent='Loading guide…';const now=Date.now();let rows=[];
      try{
        if(mode==='Starting soon'||mode==='My teams'){
          if(!state.upcoming||Date.now()-state.upcomingAt>120000){
            const list=[];let offset=0;
            for(let page=0;page<20;page++){
              const r=await api.ajax({type:'GET',url:api.getUrl('LiveTv/Programs',{UserId:user,MinStartDate:new Date(now).toISOString(),MaxStartDate:new Date(now+6*3600000).toISOString(),SortBy:'StartDate',SortOrder:'Ascending',Limit:200,StartIndex:offset}),dataType:'json'});
              list.push(...(r.Items||[]));offset+=(r.Items||[]).length;if(!r.Items?.length||offset>=(r.TotalRecordCount??offset))break;
            }
            if(api.getCurrentUserId()!==user||!section.isConnected)return;state.upcoming=list;state.upcomingAt=Date.now();
          }
          rows=state.upcoming.map(p=>({c:parents.find(c=>c.Id===p.ChannelId),p})).filter(x=>x.c);
        }
        if(mode!=='Starting soon')rows=[...parents.filter(c=>c.CurrentProgram&&new Date(c.CurrentProgram.StartDate)<=now&&new Date(c.CurrentProgram.EndDate)>now).map(c=>({c,p:c.CurrentProgram})),...rows];
        if(mode==='Favorites')rows=rows.filter(({c})=>c.UserData?.IsFavorite);
        if(mode==='My teams'){
          const terms=input.value.split(',').map(t=>t.trim().toLocaleLowerCase()).filter(Boolean);
          rows=terms.length?rows.filter(({c,p})=>terms.some(t=>(p.Name+' '+c.Name).toLocaleLowerCase().includes(t))):[];
        }
        if(mode==='Live now')rows.sort((a,b)=>Number(Boolean(b.c.UserData?.IsFavorite))-Number(Boolean(a.c.UserData?.IsFavorite))||Number(Boolean(b.p.IsLive))-Number(Boolean(a.p.IsLive)));
        const seen=new Set();rows=rows.filter(({c,p})=>{const key=c.Id+'|'+p.Name+'|'+p.StartDate;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,12);
        if(version!==request||api.getCurrentUserId()!==user||!section.isConnected)return;
        for(const {c,p} of rows){
          const card=link('orbital-live-card','',detail(api,c.Id));card.setAttribute('aria-label',p.Name+' on '+c.Name);
          const placeholder=p.Name===c.Name||/programme listings are unavailable|channel placeholder/i.test(p.Overview||'');
          const current=new Date(p.StartDate)<=now;const brand=el('div','orbital-channel');brand.append(el('span','orbital-live-badge',current?'ON NOW':'UP NEXT'),el('span','orbital-channel-name',c.Name));
          card.append(brand,el('h3','',placeholder?c.Name:p.Name),el('span','orbital-airtime',placeholder?'Live channel':time(p.StartDate)+' – '+time(p.EndDate)));
          const alternatives=channels.filter(x=>isFeed(x)&&x.Name.startsWith(c.Name.slice(0,170)+' ['));
          if(alternatives.length)card.append(el('span','orbital-feed-count',alternatives.length+' alternate feeds'));
          if(current&&!placeholder){const progress=el('div','orbital-guide-progress');const fill=el('span');fill.style.width=Math.max(0,Math.min(100,100*(now-new Date(p.StartDate))/(new Date(p.EndDate)-new Date(p.StartDate))))+'%';progress.append(fill);progress.setAttribute('aria-hidden','true');card.append(progress);}rail.append(card);
        }
        status.textContent=rows.length?(mode==='Starting soon'||mode==='My teams'?'Listings for the next 6 hours. Open the guide for later times.':''):(mode==='My teams'?(input.value.trim()?'No matching listings in the next 6 hours. This does not mean the team is not playing.':'Enter a team name to find matching listings.'):mode==='Favorites'?'Favorite a channel on its details page to see it here.':'No listings here right now. Open the guide or browse channels.');
      }catch{if(version===request)status.textContent='The guide could not be loaded. Open the guide or select another view to retry.';}
    };
    ['Live now','Starting soon','Favorites','My teams'].forEach(label=>{const b=el('button','orbital-chip',label);b.type='button';b.setAttribute('aria-pressed',String(label===mode));b.onclick=()=>{mode=label;state.liveMode=mode;paint();};filters.append(b);});
    apply.onclick=()=>{try{localStorage.setItem('orbital-teams-'+user,input.value.slice(0,200));}catch{}paint();};input.addEventListener('keydown',e=>{if(e.key==='Enter')apply.click();});
    section.append(filters,teams,rail,status);queueMicrotask(paint);return section;
  }
  function footer(){const f=el('footer','orbital-footer orbital-personal');f.append(el('span','','Your collection. Your cinema.'),link('','Standard interface',location.pathname+'?orbital=off#/movies'));return f;}
  function selectFeatured(items){
    const seen=new Set();const movies=items.filter(x=>x.BackdropImageTags?.length&&x.Overview&&x.LocationType!=='Virtual').filter(x=>{const k=x.Name.toLowerCase()+'|'+x.ProductionYear;if(seen.has(k))return false;seen.add(k);return true;});
    // Explainable editorial order; no claim of a recommendation model.
    movies.sort((a,b)=>(Number(Boolean(a.UserData?.Played))-Number(Boolean(b.UserData?.Played)))||((b.ProductionYear||0)-(a.ProductionYear||0))||(OrbitalRating.value(b)-OrbitalRating.value(a)));
    return movies.slice(0,6);
  }
  function hideDuplicateRows(home){
    if(home.querySelector('.orbital-library-bar')){
      for(const s of home.querySelectorAll('.homeSectionsContainer > .verticalSection')){
        const cards=[...s.querySelectorAll('.card[data-type]')];
        if(cards.length&&cards.every(c=>['CollectionFolder','UserView'].includes(c.dataset.type))) s.classList.add('orbital-library-original');
      }
    }
    if(home.querySelector('.orbital-live')){
      for(const s of home.querySelectorAll('.homeSectionsContainer > div')){
        if(s.classList.contains('orbital-live'))continue;
        if(s.querySelector('a[href*="livetv?tab=1"]')&&s.querySelector('a[href*="livetv?tab=2"]'))s.classList.add('orbital-original-live');
      }
    }
  }
  function ensureLive(home,api){
    if(home.querySelector('.orbital-live')||!state.channels?.length)return;
    const native=home.querySelector('.homeSectionsContainer');
    if(!native)return;
    const live=liveSection(api,state.channels);
    const feature=native.querySelector('.orbital-hero');if(feature)feature.after(live);else native.prepend(live);
  }
  const isFeed=c=>{const n=Number(c.Number);return n>=2601&&n<=2999||n>=3101&&n<=3999;};
  async function allChannels(api,user){
    const items=[];const seen=new Set();let start=0;
    for(let page=0;page<30;page++){
      const r=await api.getLiveTvChannels({UserId:user,EnableCurrentProgram:true,EnableUserData:true,Limit:200,StartIndex:start});
      if(api.getCurrentUserId()!==user)return [];
      const fresh=(r.Items||[]).filter(c=>!seen.has(c.Id));fresh.forEach(c=>seen.add(c.Id));items.push(...fresh);
      start+=(r.Items||[]).length;if(!fresh.length||start>=(r.TotalRecordCount??start))break;
    }return items;
  }
  function orderHome(home){
    const native=home.querySelector('.homeSectionsContainer');if(!native)return;
    const hero=native.querySelector('.orbital-hero');if(!hero)return;
    const rows=[...native.children];
    const early=rows.filter(n=>/^(Continue Watching|Next Up)$/.test(n.querySelector('.sectionTitle')?.textContent?.trim()||''));
    let anchor=hero;
    for(const row of early.reverse()){if(row.nextElementSibling!==anchor)native.insertBefore(row,anchor);anchor=row;}
    // Keep native cards, resume positions and playback handlers intact.
    const names={'Debrid Movies':'Movies','Debrid TV Shows':'Series','Debrid Anime Movies':'Anime films','Debrid Anime Shows':'Anime series','Movies':'Local movies','TV Shows':'Local series'};
    home.querySelectorAll('.sectionTitle').forEach(n=>{const t=n.textContent.trim();if(t.startsWith('Recently Added in ')){const label=names[t.slice(18)];if(label)n.textContent='Recently added · '+label;}});
  }
  function filmCard(api,item){
    const card=el('article','orbital-film');const a=link('orbital-film-art','',detail(api,item.Id));a.setAttribute('aria-label','Details for '+item.Name);
    const source=image(api,item,'Backdrop',700)||image(api,item,'Primary',500);
    if(source){const img=el('img');img.src=source;img.alt='';img.loading='lazy';img.addEventListener('error',()=>img.remove(),{once:true});a.append(img);}
    a.append(el('span','orbital-film-overlay','Details'));card.append(a);
    card.append(link('orbital-film-title',item.Name,detail(api,item.Id)));
    const meta=[item.ProductionYear,item.OfficialRating,item.RunTimeTicks?Math.round(item.RunTimeTicks/600000000)+' min':null].filter(Boolean);
    card.append(el('p','orbital-film-meta',meta.join(' · ')),el('p','orbital-film-summary',short(item.Overview,130)));return card;
  }
  function discover(api,user,initial){
    const section=el('section','orbital-discover orbital-personal');section.id='orbital-discover';section.setAttribute('aria-label','Find your next film');
    const head=el('div','orbital-section-heading');const h=el('h2','','Find your next film');h.append(el('small','','Explore your collection by genre'));head.append(h);section.append(head);
    const filters=el('div','orbital-shelf-filters');filters.setAttribute('aria-label','Film genres');
    const rail=el('div','orbital-film-rail');const status=el('p','orbital-shelf-status');status.setAttribute('role','status');
    let version=0;
    const render=items=>{const seen=new Set();const unique=items.filter(i=>{const key=i.Name.replace(/\s*\(\d{4}\)$/,'').toLocaleLowerCase()+'|'+i.ProductionYear;if(seen.has(key))return false;seen.add(key);return true;});rail.replaceChildren(...unique.slice(0,12).map(i=>filmCard(api,i)));status.textContent=unique.length?'':'No films in this genre yet. Try another genre or request something new.';};
    ['All','Adventure','Comedy','Drama','Science Fiction','Thriller'].forEach((genre,i)=>{
      const b=el('button','orbital-chip',genre);b.type='button';b.setAttribute('aria-pressed',String(!i));
      b.onclick=async()=>{const request=++version;filters.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));status.textContent='Finding films…';rail.setAttribute('aria-busy','true');
        try{const r=await api.getItems(user,{Recursive:true,IncludeItemTypes:'Movie',Genres:genre==='All'?undefined:genre,SortBy:'CommunityRating,SortName',SortOrder:'Descending',Limit:24,Fields:'Overview,Genres',EnableImageTypes:'Backdrop,Primary'});
          if(request!==version||api.getCurrentUserId()!==user||!section.isConnected)return;render(r.Items||[]);
        }catch{if(request===version){rail.replaceChildren();status.textContent='Could not load this shelf. Select a genre to try again.';}}
        finally{if(request===version)rail.removeAttribute('aria-busy');}};
      filters.append(b);
    });section.append(filters,rail,status);render(initial);return section;
  }
  function requestHelp(){
    const box=el('aside','orbital-request-help orbital-personal');const copy=el('div');copy.append(el('h2','','Something missing?'),el('p','','Request a movie or series with your Jellyfin login. Approved requests appear when a playable source is available.'));
    box.append(copy,requestLink('orbital-action orbital-action-secondary','Browse & request','/','add_circle_outline'));return box;
  }
  function liveBuffer(api) {
    // v12's player uses SDK XHR, independently of the legacy window.ApiClient.
    // Only same-origin playback-info POSTs for an authenticated TV channel change.
    const proto=window.XMLHttpRequest?.prototype;
    if(!api?.getItem||!proto?.open||!proto.send||proto.send.orbitalLiveBuffer)return;
    const open=proto.open,send=proto.send,requests=new WeakMap();
    proto.open=function(method,url,...args){
      let id=null;try{const u=new URL(url,location.href);if(String(method).toUpperCase()==='POST'&&u.origin===location.origin)id=u.pathname.match(/\/Items\/([^/]+)\/PlaybackInfo$/i)?.[1];}catch{}
      requests.set(this,{id});return open.call(this,method,url,...args);
    };
    const wrapped=function(body){
      const request=requests.get(this),client=window.ApiClient,user=client?.getCurrentUserId?.();
      let data;try{if(request?.id&&user&&typeof body==='string')data=JSON.parse(body);}catch{}
      if(!Array.isArray(data?.DeviceProfile?.TranscodingProfiles))return send.call(this,body);
      const server=client.serverId?.(),credential=client.accessToken?.();let settled=false,timer=null;
      const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);if(this.readyState!==1||requests.get(this)!==request)return;
        // Never send a deferred old-account request after the client identity changes.
        if(window.ApiClient!==client||client.getCurrentUserId?.()!==user||client.serverId?.()!==server||client.accessToken?.()!==credential){this.abort?.();return;}send.call(this,value);};
      // This optional reserve lookup cannot hold PlaybackInfo before it is sent.
      timer=setTimeout(()=>finish(body),5000);
      Promise.resolve().then(()=>client.getItem(user,request.id)).then(item=>{
        if(settled||this.readyState!==1||requests.get(this)!==request)return;
        if(item?.Type!=='TvChannel'||client.getCurrentUserId()!==user)return finish(body);
        // Long initial reserves help browser-captured event relays survive jitter,
        // but force real-time linear HLS sources past hls.js's manifest timeout.
        // Keep the measured reserve for owned event-channel numbers and use a
        // bounded three-segment start for linear/free and curated IPTV channels.
        const number=Number.parseInt(String(item.ChannelNumber||''),10),event=number>=2000&&number<=2999;
        data.DeviceProfile.TranscodingProfiles=data.DeviceProfile.TranscodingProfiles.map(p=>{
          if(String(p.Protocol).toLowerCase()!=='hls')return p;
          const current=Number(p.MinSegments)||0;
          return {...p,MinSegments:event?Math.max(8,current):Math.min(3,current||3)};
        });
        wrapped.orbitalCalls++;finish(JSON.stringify(data));
      },()=>finish(body));
    };
    wrapped.orbitalLiveBuffer=true;wrapped.orbitalCalls=0;proto.send=wrapped;
  }
  function cancelAutoplay(){
    const request=state.autoplayRequest;state.autoplayRequest=null;if(request?.timer)clearTimeout(request.timer);request?.observer?.disconnect();
  }
  function autoplayDetail(user){
    const api=window.ApiClient,route=location.hash;if(!/^#\/details\?/.test(route)){cancelAutoplay();return;}
    const params=new URLSearchParams(route.split('?')[1]||''),id=params.get('id');if(!id||params.get('orbitalAutoplay')!=='1'){cancelAutoplay();return;}
    let server,credential;try{server=api?.serverId?.();credential=api?.accessToken?.();if(!api||api.getCurrentUserId()!==user||params.get('serverId')&&params.get('serverId')!==server){cancelAutoplay();return;}}catch{cancelAutoplay();return;}
    const consumed=state.stockAutoplayConsumed;
    if(consumed?.api===api&&consumed.user===user&&consumed.server===server&&consumed.credential===credential&&consumed.route===route){cancelAutoplay();return;}
    let request=state.autoplayRequest;
    if(!request||request.api!==api||request.user!==user||request.server!==server||request.credential!==credential||request.route!==route){
      cancelAutoplay();request={api,user,server,credential,route,id,attempts:0,timer:null,observer:null,watchPage:null,consume:null};state.autoplayRequest=request;
    }
    const current=()=>{try{return state.autoplayRequest===request&&window.ApiClient===api&&api.getCurrentUserId()===user&&api.serverId?.()===server&&api.accessToken?.()===credential&&location.hash===route;}catch{return false;}};
    const ready=(manual=false)=>{
      const button=document.querySelector('#itemDetailPage:not(.hide) .btnPlay,#itemDetailPage:not(.hide) .btnResume'),page=button?.closest('#itemDetailPage'),owner=state.detailReadyOwner;
      if(!button?.isConnected||!page?.isConnected||button.disabled||button.getAttribute('aria-disabled')==='true'||!button.getClientRects().length)return null;
      const style=getComputedStyle(button);if(style.display==='none'||style.visibility==='hidden')return null;
      if(owner?.api!==api||owner.user!==user||owner.server!==server||owner.credential!==credential||owner.route!==route||owner.page!==page||!owner.current?.())return null;
      const stock=window.OrbitalEdition?.edition==='customer'&&window.TelevisionPlayerBridge?.basic;
      if(!manual&&(owner.autoplayItemId!==id||(stock?page.dataset.phase!=='complete':typeof page.orbitalAutoplayItemMatches!=='function'||!page.orbitalAutoplayItemMatches(api,user,id,route)))||page.dataset.pageReadyRoute!==route||page.dataset.pageReadyUser!==user)return null;
      return button;
    };
    request.consume=(button,manual=false)=>{if(!button||!current()||ready(manual)!==button)return false;params.delete('orbitalAutoplay');cancelAutoplay();history.replaceState(history.state,'',location.pathname+location.search+'#/details?'+params.toString());return true;};
    const owner=state.detailReadyOwner,page=owner?.page;
    if(request.attempts<3&&request.watchPage!==page&&page?.isConnected&&owner.api===api&&owner.user===user&&owner.server===server&&owner.credential===credential&&owner.route===route&&owner.current?.()){
      request.observer?.disconnect();request.watchPage=page;request.observer=new MutationObserver(()=>{
        if(!current()){if(state.autoplayRequest===request)cancelAutoplay();return;}
        if(request.timer===null&&request.attempts<3&&ready())schedule();
      });request.observer.observe(page,{subtree:true,attributes:true,attributeFilter:['class','style','hidden','disabled','aria-disabled']});
    }
    if(!current()||request.timer!==null||request.attempts>=3)return;
    const button=ready();if(!button)return;
    request.attempts++;request.timer=setTimeout(()=>{
      request.timer=null;if(!current()){if(state.autoplayRequest===request)cancelAutoplay();return;}
      if(ready()!==button){if(request.attempts<3)schedule();else request.observer?.disconnect();return;}
      if(request.consume(button)){
        if(window.OrbitalEdition?.edition==='customer'&&window.TelevisionPlayerBridge?.basic){
          state.stockAutoplayConsumed={api,user,server,credential,route};
          // Stock Jellyfin has no private item-page hook. Play the API-confirmed exact ID,
          // after the details surface is ready, instead of trusting a stale button binding.
          Promise.resolve(window.TelevisionPlayerBridge.manager.play({ids:[id],serverId:server,fullscreen:true})).catch(()=>{});
        }else button.click();
      }
    },80);
  }
  async function enhance(){
    state.timer=null;const api=window.ApiClient;const user=api?.getCurrentUserId?.();
    if(user!==state.user){clear();state.user=user;state.retryAt=0;}
    topNav(Boolean(user));
    if(user)liveBuffer(api);
    if(user){enhanceDetail(api,user);autoplayDetail(user);readableTracks();adminTools(api,user);}
    if(!user||!activeHome()||user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')||window.OrbitalBrowse5?.handles(user))return;
    const home=[...document.querySelectorAll('#homeTab.is-active')].find(n=>n.getClientRects().length&&getComputedStyle(n.closest('.page')||n).display!=='none');
    if(!home)return;
    home.closest('.page')?.classList.add('orbital-home-page');
    if(state.home===home&&home.querySelector('.orbital-library-bar')){ensureLive(home,api);hideDuplicateRows(home);orderHome(home);return;}
    if(state.busy||Date.now()<state.retryAt)return;
    state.busy=true;const generation=++state.generation;
    try{
      const results=await Promise.allSettled([
        api.getItems(user,{Recursive:true,IncludeItemTypes:'Movie',SortBy:'CommunityRating',SortOrder:'Descending',Limit:100,Fields:'Overview,Genres',EnableImageTypes:'Backdrop,Primary',ImageTypeLimit:1}),
        api.getUserViews({},user),
        allChannels(api,user)
      ]);
      if(generation!==state.generation||api.getCurrentUserId()!==user||!home.isConnected)return;
      const views=results[1].status==='fulfilled'?results[1].value.Items:[];
      if(!views?.length)throw new Error('Library navigation unavailable');
      home.querySelectorAll('.orbital-personal').forEach(n=>n.remove());
      const featured=results[0].status==='fulfilled'?selectFeatured(results[0].value.Items||[]):[];
      const native=home.querySelector('.homeSectionsContainer');if(!native)throw new Error('Home still loading');
      const bar=libraries(views);home.prepend(bar);if(featured.length)native.prepend(hero(api,featured));
      if(results[0].status==='fulfilled')native.append(discover(api,user,featured));
      home.append(requestHelp());
      if(results[2].status==='fulfilled'&&results[2].value.length){
        state.channels=results[2].value;ensureLive(home,api);
        if(state.refresh)clearInterval(state.refresh);
        state.refresh=setInterval(async()=>{
          if(document.hidden||!activeHome()||api.getCurrentUserId()!==user||!home.isConnected)return;
          try{const fresh=await allChannels(api,user);
            if(generation===state.generation&&api.getCurrentUserId()===user&&home.isConnected){state.channels=fresh;const old=home.querySelector('.orbital-live');if(old&&!old.contains(document.activeElement))old.replaceWith(liveSection(api,state.channels));else ensureLive(home,api);}
          }catch{/* Native guide remains available. */}
        },120000);
      }
      home.append(footer());state.home=home;hideDuplicateRows(home);orderHome(home);window.OrbitalSettle?.end();
    }catch{state.retryAt=Date.now()+30000;window.OrbitalSettle?.end();console.warn('[Orbital] Enhanced home unavailable; native library retained.');}
    finally{state.busy=false;}
  }
  function schedule(){if(!state.timer)state.timer=setTimeout(enhance,150);}
  const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&!n.classList?.contains('orbital-personal'))))schedule();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',event=>{if(event.isTrusted===true)state.autoplayRequest?.consume?.(event.target?.closest?.('#itemDetailPage .btnPlay,#itemDetailPage .btnResume'),true);},{capture:true,passive:true});
  document.addEventListener('orbital:stock-details-ready',()=>{if(state.autoplayRequest)schedule();});
  window.addEventListener('hashchange',()=>{cancelAutoplay();schedule();});document.addEventListener('visibilitychange',schedule);
  window.addEventListener('pagehide',()=>{cancelAutoplay();if(state.refresh)clearInterval(state.refresh);});
  schedule();
})();
/* Administrator-only backfill dashboard; server publishes aggregate snapshots. */
(()=>{
'use strict';if(window.OrbitalEdition?.edition==='customer')return;if(new URLSearchParams(location.search).get('orbital')==='off')return;
let user=null,admin=false,busy=false,last=0;
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
async function refresh(force=false){
 const api=window.ApiClient,u=api?.getCurrentUserId?.();
 if(u!==user){user=u;admin=false;last=0;document.querySelectorAll('.orbital-backfill').forEach(n=>n.remove());if(u){try{admin=!!(await api.getCurrentUser()).Policy?.IsAdministrator;}catch{return;}}}
 if(!u||!admin||busy||document.hidden||!/^#\/(home|dashboard)(?:[?&]|$)/.test(location.hash)||(/^#\/home/.test(location.hash)&&new URLSearchParams(location.hash.split('?')[1]||'').get('tab')==='1'))return;
 const host=document.querySelector('.orbital-admin-tools');if(!host)return;
 let box=host.parentElement.querySelector('.orbital-backfill');if(box&&Date.now()-last<30000&&!force)return;
 if(!box){box=make('section','orbital-backfill orbital-personal');box.setAttribute('aria-label','Library backfill progress');host.after(box);box.append(make('p','','Loading library progress…'));}
 busy=true;
 try{
  const prefs=await api.ajax({type:'GET',url:api.getUrl('DisplayPreferences/orbital-backfill-progress',{userId:u,client:'orbital'}),dataType:'json'});
  if(api.getCurrentUserId()!==u||!box.isConnected)return;
  const d=JSON.parse(prefs.CustomPrefs?.progress||'null');if(!d?.overall)throw Error('No snapshot');
  const o=d.overall,head=make('div','orbital-backfill-heading');head.append(make('h2','','Library backfill'),make('strong','orbital-backfill-percent',o.percent+'% available'));
  const progress=make('progress');progress.max=o.total||1;progress.value=o.available;progress.setAttribute('aria-label','Backfill titles available in Jellyfin');
  const stats=make('div','orbital-backfill-stats');for(const [label,value] of [['Available in Jellyfin',o.available],['Submitted',o.submitted],['Waiting to submit',o.waiting_to_submit],['Needs attention',o.needs_attention]]){const cell=make('div');cell.append(make('strong','',Number(value).toLocaleString()),make('span','',label));stats.append(cell);}
  const list=make('div','orbital-backfill-services');for(const [name,s] of Object.entries(d.services)){const row=make('div');row.append(make('span','',name),make('strong','',s.available.toLocaleString()+' / '+s.total.toLocaleString()));list.append(row);}
  const age=Date.now()/1000-d.updated_at;const footer=make('p','orbital-backfill-note',(age>180?'Update delayed · ':'Updated ')+new Date(d.updated_at*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · '+o.total.toLocaleString()+' unique backfill titles');
  box.replaceChildren(head,progress,stats,list,make('p','orbital-backfill-note','Available means indexed in Jellyfin. A series may have only some episodes; playback is not verified for every title. Service rows overlap.'),make('p','orbital-backfill-note','After backfill delivery: '+d.daily_movies+' movies + '+d.daily_series+' series daily at 6:00 AM Central.'),footer);
  if(d.acquisition && Number.isFinite(d.acquisition.sources_exhausted_items)){
   const a=d.acquisition, pending=Number.isFinite(a.outstanding_jobs)?a.outstanding_jobs.toLocaleString():'Unavailable';
   box.append(make('p','orbital-backfill-note','Acquisition across the library: '+pending+' pending jobs · '+a.sources_exhausted_items.toLocaleString()+' items resting after sources were exhausted. Automatic retries: 6 hours, then 1 day, then 3 days. These counts include seasons and episodes, not just titles.'));
  }
  if(d.attention?.length){const details=make('details');details.append(make('summary','',d.attention.length+' titles need attention'));for(const e of d.attention){details.append(make('p','',e.title+' — '+e.reason));}box.append(details);}
  const b=make('button','orbital-chip','Refresh progress');b.type='button';b.onclick=()=>{last=0;refresh(true);};box.append(b);last=Date.now();
 }catch{box.replaceChildren(make('h2','','Library backfill'),make('p','','Progress is temporarily unavailable. It will retry automatically.'));last=0;}
 finally{busy=false;}
}
setInterval(refresh,10000);window.addEventListener('hashchange',()=>setTimeout(refresh,500));document.addEventListener('visibilitychange',()=>refresh());refresh();
})();
/* Simple uses her isolated tablet client on every browser. */
(()=>{
'use strict';if(new URLSearchParams(location.search).get('orbital')==='off')return;
const uid=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');let timer;
function update(){const api=window.ApiClient;const active=api?.getCurrentUserId?.()===uid;document.documentElement.classList.toggle('simple-mode',active);document.documentElement.classList.remove('ntv-on-home');
 if(!active){document.querySelectorAll('.simple-team-shortcuts').forEach(n=>n.remove());return;}
 if(!location.pathname.startsWith('/simple/')){location.replace('/simple/#/home');return;}
 // Legacy unsupported My Teams mount removed; the isolated Track B owns this module.
 document.querySelectorAll('.simple-team-shortcuts').forEach(n=>n.remove());
}
function queue(){clearTimeout(timer);timer=setTimeout(update,150);}new MutationObserver(rs=>{if(rs.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&!n.closest?.('.simple-team-shortcuts'))))queue();}).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('hashchange',queue);queue();
})();

/* Explicit user-submitted trouble reports; authenticated Jellyfin storage. */
(()=>{
'use strict';if(new URLSearchParams(location.search).get('orbital')==='off')return;
const owner=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'),key='simple-channel-reports';let sending=false,adminUser=null,admin=false,last=0,busy=false;
const elem=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
const endpoint=(api)=>api.getUrl('DisplayPreferences/'+key,{userId:owner,client:'orbital'});
const read=api=>api.ajax({type:'GET',url:endpoint(api),dataType:'json'});
const write=(api,p)=>api.ajax({type:'POST',url:endpoint(api),data:JSON.stringify(p),contentType:'application/json'});
function entries(p){try{const a=JSON.parse(p.CustomPrefs?.reports||'[]');return Array.isArray(a)?a.slice(-100):[];}catch{return [];}}
document.addEventListener('click',async e=>{
 const b=e.target.closest?.('.simple-report');if(!b)return;const api=window.ApiClient;if(api?.getCurrentUserId?.()!==owner||sending)return;
 sending=true;b.disabled=true;let status=b.parentElement.querySelector('.simple-report-status');if(!status){status=elem('p');status.className='simple-report-status';status.setAttribute('role','status');b.after(status);}status.textContent='Sending…';
 try{const p=await read(api);if(api.getCurrentUserId()!==owner)throw Error();const rows=entries(p);const duplicate=rows.some(r=>r.channelId===b.dataset.channelId&&Date.now()-Date.parse(r.at)<300000);if(!duplicate){rows.push({id:crypto.randomUUID(),at:new Date().toISOString(),channelId:b.dataset.channelId,channel:String(b.dataset.channelName).slice(0,180),program:String(b.dataset.program||'').slice(0,200),status:'open'});p.CustomPrefs={...p.CustomPrefs,reports:JSON.stringify(rows.slice(-100))};await write(api,p);}status.textContent='Saved for the owner. You can choose another channel.';b.textContent='Reported — thank you';}
 catch{status.textContent='Could not send. Please try again when the connection returns.';b.disabled=false;}finally{sending=false;}
});
async function refresh(){const api=window.ApiClient,u=api?.getCurrentUserId?.();if(!u)return;
 if(adminUser!==u){adminUser=u;admin=false;document.querySelectorAll('.simple-inbox').forEach(n=>n.remove());try{admin=!!(await api.getCurrentUser()).Policy?.IsAdministrator;}catch{return;}}
 if(!admin||!/^#\/(home|dashboard)(?:[?&]|$)/.test(location.hash)||busy)return;
 const host=document.querySelector('.orbital-admin-tools');if(!host)return;const old=host.querySelector('.simple-inbox');if(old&&(Date.now()-last<60000||old.contains(document.activeElement)))return;
 busy=true;try{const p=await read(api);if(api.getCurrentUserId()!==u)return;const rows=entries(p);const open=rows.filter(r=>r.status!=='resolved');const box=elem('details');box.className='simple-inbox orbital-personal';box.append(elem('summary',"Simple’s channel reports ("+open.length+' open)'));if(!rows.length)box.append(elem('p','No channel problems reported.'));
 for(const r of [...rows].reverse().slice(0,30)){const item=elem('div');item.className='simple-inbox-item';item.append(elem('strong',r.channel),elem('p',new Date(r.at).toLocaleString()+' · '+(r.program||'No programme listed')+' · '+r.status));if(r.status!=='resolved'){const done=elem('button','Mark handled');done.type='button';done.onclick=async()=>{done.disabled=true;try{const fresh=await read(api);const all=entries(fresh);const row=all.find(x=>x.id===r.id);if(row)row.status='resolved';fresh.CustomPrefs={...fresh.CustomPrefs,reports:JSON.stringify(all)};await write(api,fresh);last=0;box.remove();refresh();}catch{done.disabled=false;done.textContent='Could not save — retry';}};item.append(done);}box.append(item);}old?.remove();host.append(box);last=Date.now();}catch{/* retry on later visit; no false empty state */}finally{busy=false;}}
setInterval(()=>{if(!document.hidden)refresh();},10000);window.addEventListener('hashchange',()=>setTimeout(refresh,600));setTimeout(refresh,1200);
})();



window.OrbitalTeamArt=window.OrbitalTeamArt||{};
/* Orbital browsing adapter. Bundled into orbital.js; no fifth runtime asset. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('orbital') === 'off') return;
  const SIMPLE = (window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
  const S = {user:null, key:null, pending:null, views:[], cache:new Map(), timer:null, serial:0, navReturnFocus:null, routeKey:null};
  const node = (tag,cls,text) => {const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const a = (text,href,cls='ob5-link') => {const n=node('a',cls,text);n.href=href;return n;};
  const icon = name => {const n=node('span','material-icons',name);n.setAttribute('aria-hidden','true');return n;};
  const requestHref = path => window.OrbitalParity ? window.OrbitalParity.requestHref(path) : location.origin + (window.OrbitalAsset||'/web/orbital/')+'requests.html?path=' + encodeURIComponent(path || '/') + '&returnTo=' + encodeURIComponent(location.pathname + location.hash);
  const requestLink = (cls,label,path='/',symbol) => {const n=a(label,requestHref(path),cls);if(window.ApiClient?.getCurrentUserId?.()===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'))n.style.setProperty('display','none','important');if(symbol)n.prepend(icon(symbol));n.addEventListener('click',()=>{n.href=requestHref(path);},{capture:true});return n;};
  const button = (label,action,cls='ob5-button') => {const n=node('button',cls,label);n.type='button';n.onclick=action;return n;};
  const route = () => {const [path,query='']=location.hash.slice(1).split('?');return {path,q:new URLSearchParams(query)};};
  let browseSettleTimer=null, browseTarget=null;
  const phoneSurface=()=>/Android/i.test(navigator.userAgent)||matchMedia("(max-width:900px)").matches;
  const browseRouteHandled=(hash=location.hash)=>{const [path,query='']=hash.replace(/^#/,'').split('?'),q=new URLSearchParams(query);return path==='/home'&&q.get('tab')!=='1'||(path==='/movies'||path==='/tv')&&q.get('orbitalBrowse')!=='all'||path==='/livetv';};
  const beginBrowseTransition=(hash=location.hash)=>{if(hash===location.hash){const path=hash.split('?')[0],selector=path==='#/home'?'#homeTab.is-active':path==='#/movies'?'#moviesPage':path==='#/tv'?'#tvshowsPage, #tvPage':null;const root=selector&&document.querySelector(selector)?.querySelector(':scope > .ob5-browse');if(root?.getClientRects().length&&root.dataset.phase==='complete'&&root.dataset.presentable!=='pending'){finishBrowseTransition();return;}}clearTimeout(browseSettleTimer);if(!browseRouteHandled(hash))return finishBrowseTransition(true);browseTarget=hash;document.documentElement.classList.add('orbital-settling');document.documentElement.setAttribute('aria-busy','true');browseSettleTimer=setTimeout(()=>finishBrowseTransition(true),hash.startsWith('#/livetv')?9000:8000);};
  const finishBrowseTransition=(force=false)=>{const {path}=route();
    if(!force){if(browseTarget&&browseTarget!==location.hash)return;
      const selector=path==='/home'?'#homeTab.is-active':path==='/movies'?'#moviesPage':path==='/tv'?'#tvshowsPage, #tvPage':null;
      if(selector){const host=document.querySelector(selector),root=host?.querySelector(':scope > .ob5-browse');if(!root?.getClientRects().length||!root.dataset.loaded||root.dataset.presentable==='pending')return;if(phoneSurface()&&root.dataset.phase==='preview'&&!root.dataset.stableFirst&&root.dataset.usefulReady!=='true')return;}}
    clearTimeout(browseSettleTimer);browseSettleTimer=null;browseTarget=null;document.documentElement.classList.remove('orbital-settling','orbital-editing');document.documentElement.removeAttribute('aria-busy');};
  // Native WebView navigation can replace history without dispatching hashchange.
  // Start before its router handles the actual link, using the DESTINATION route.
  document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a||e.defaultPrevented||e.ctrlKey||e.metaKey||e.shiftKey||a.target==='_blank')return;let u;try{u=new URL(a.href,location.href);}catch{return;}if(u.origin===location.origin&&(a.getAttribute('href').startsWith('#')||u.pathname===location.pathname)&&u.hash&&u.hash!==location.hash&&browseRouteHandled(u.hash))beginBrowseTransition(u.hash);},true);
  // Own the transition gate in the long-lived browsing controller as well as
  // the early bootstrap. Jellyfin can replace its route shell after login;
  // this keeps the gate alive across that replacement.
  window.OrbitalSettle={begin:beginBrowseTransition,end:finishBrowseTransition};
  function browsePhase(root,phase,api,user){
    const p=root.__pageReadyOwner||(root.__pageReadyOwner={api,user,server:api.serverId?.(),credential:api.accessToken?.(),route:location.hash});
    if(window.ApiClient!==p.api||api!==p.api||api.getCurrentUserId()!==p.user||api.serverId?.()!==p.server||api.accessToken?.()!==p.credential||location.hash!==p.route)return;
    root.dataset.pageReadyRoute=p.route;root.dataset.pageReadyUser=p.user;root.dataset.phase=phase;
    if(phase==='complete')queueMicrotask(()=>{if(root.isConnected)void window.OrbitalPageReady?.prepare(root,{api,user,server:p.server,credential:p.credential,valid:()=>window.ApiClient===p.api&&api.getCurrentUserId()===p.user&&api.serverId?.()===p.server&&api.accessToken?.()===p.credential&&location.hash===p.route});});
    else if(phase==='error'&&window.OrbitalPageReady?.managed(p.route))void window.OrbitalPageReady.fail('This selection could not finish loading. Your filters are preserved. Please retry.');
  }
  const details = (api,item) => '#/details?id='+encodeURIComponent(item.Id)+'&serverId='+encodeURIComponent(api.serverId());
  const clean = name => {
    let value=String(name||'').replace(/\s*\(\d{4}\)\s*$/,'').replace(/\s+/g,' ').trim();
    const words=value.split(' '),half=words.length/2;
    if(Number.isInteger(half)&&half>0&&words.slice(0,half).join(' ').toLocaleLowerCase()===words.slice(half).join(' ').toLocaleLowerCase())value=words.slice(0,half).join(' ');
    const repairs={'ter the dragon':'Enter the Dragon','emy of the state':'Enemy of the State','bring me the head of. lfredo garcia':'Bring Me the Head of Alfredo Garcia'};
    value=repairs[value.toLocaleLowerCase()]||value;
    return value;
  };
  const itemKey = item => item.ProviderIds?.Tmdb ? item.Type+':tmdb:'+item.ProviderIds.Tmdb : item.Type+':'+clean(item.Name).toLowerCase()+':'+(item.ProductionYear||'');
  // Keep every backend source intact, but show one viewer-facing card for the same title.
  // A physical file wins, then a cloud-library pointer, then IPTV VOD. This gives
  // requested content a stable primary copy while retaining IPTV as a backend fallback.
  const sourceRank = item => {
    const path=String(item.Path||'').toLowerCase(),tags=(item.Tags||[]).map(x=>String(x).toLowerCase());
    if(tags.includes('iptv vod')||path.includes('/iptv-vod/'))return 2;
    return path.endsWith('.strm')?1:0;
  };
  const unique = items => {
    const order=[],chosen=new Map();
    for(const item of items){const key=itemKey(item);if(!chosen.has(key)){order.push(key);chosen.set(key,item);}else if(sourceRank(item)<sourceRank(chosen.get(key)))chosen.set(key,item);}
    return order.map(key=>chosen.get(key));
  };
  function artwork(api,item,wide=false) {
    if(item.oxSpoilerMask?.includes("image"))return null;
    let id=item.Id,type='Primary',tag=item.ImageTags?.Primary;
    if(wide){
      if(item.ImageTags?.Thumb){type='Thumb';tag=item.ImageTags.Thumb;}
      else if(item.BackdropImageTags?.length){type='Backdrop';tag=item.BackdropImageTags[0];}
      else if(item.ParentThumbItemId){id=item.ParentThumbItemId;type='Thumb';tag=item.ParentThumbImageTag;}
      else if(item.ParentBackdropItemId){id=item.ParentBackdropItemId;type='Backdrop';tag=item.ParentBackdropImageTags?.[0];}
    }
    if(!tag&&item.SeriesId&&item.SeriesPrimaryImageTag){id=item.SeriesId;type='Primary';tag=item.SeriesPrimaryImageTag;}
    if(!tag&&id===item.Id)return null;
    const phone=innerWidth<700;return api.getImageUrl(id,{type,tag,maxWidth:wide?(phone?640:1000):(phone?300:420),quality:85});
  }
  function img(url,cls,alt='') {const n=node('img',cls);n.src=url;n.alt=alt;n.loading='lazy';n.onerror=()=>{if(!window.OrbitalPageReady?.fallbackImage(n))n.remove();};return n;}
  const fetchJson = (api,path,q) => api.ajax({type:'GET',url:api.getUrl(path,q),dataType:'json'});
  async function catalog(api,user,q) {
    const query={Recursive:true,Limit:36,Fields:'Overview,Genres,ProviderIds,DateCreated,Path,Tags',ImageTypeLimit:1,EnableImageTypes:'Primary,Backdrop,Thumb',EnableTotalRecordCount:false,...q};
    const off=await OrbitalRating.offset(api,user,query);if(off)query.StartIndex=(query.StartIndex||0)+off;
    return ((await api.getItems(user,query)).Items||[]).filter(i=>!OrbitalRating.thin(i));
  }
  // Movies and episodes sorted by date played in one query took ~0.9-1.4 s; two parallel queries take ~0.3 s.
  async function watchedItems(api,user) {
    const played=i=>Date.parse(i.UserData?.LastPlayedDate||'')||0;
    const parts=await Promise.all(['Movie','Episode'].map(type=>catalog(api,user,{IncludeItemTypes:type,IsPlayed:true,SortBy:'DatePlayed',SortOrder:'Descending'})));
    return parts.flat().sort((a,b)=>played(b)-played(a)).slice(0,36);
  }
  // NextUp is authoritative for episodes. Imported played/resume records never select an episode.
  function continueItems(next,resume,series=[]) {
    const identities=new Map(series.map(s=>[s.Id,s.ProviderIds?.Tvdb?'tvdb:'+s.ProviderIds.Tvdb:s.ProviderIds?.Tmdb?'tmdb:'+s.ProviderIds.Tmdb:s.ProductionYear?clean(s.Name).toLowerCase()+':'+s.ProductionYear:s.Id]));
    const episodeOrder=[],episodeChoice=new Map();
    for(const item of next.filter(i=>i.Type==='Episode'&&!i.UserData?.Played)){
      const key=identities.get(item.SeriesId)||item.SeriesId||item.SeriesName;if(!key)continue;
      if(!episodeChoice.has(key)){episodeOrder.push(key);episodeChoice.set(key,item);}
      else if(sourceRank(item)<sourceRank(episodeChoice.get(key)))episodeChoice.set(key,item);
    }
    const episodes=episodeOrder.map(key=>episodeChoice.get(key));
    const recency=new Map();
    for(const i of resume){if(i.SeriesId)recency.set(i.SeriesId,Math.max(recency.get(i.SeriesId)||0,Date.parse(i.UserData?.LastPlayedDate)||0));}
    const movies=unique(resume.filter(i=>i.Type==='Movie'&&!i.UserData?.Played&&i.UserData?.PlaybackPositionTicks>0));
    return [...episodes,...movies].sort((a,b)=>(recency.get(b.SeriesId)||Date.parse(b.UserData?.LastPlayedDate)||0)-(recency.get(a.SeriesId)||Date.parse(a.UserData?.LastPlayedDate)||0)).slice(0,30);
  }
  window.OrbitalBrowse5={handles:user=>!!user&&user!==SIMPLE,continueItems};
  function card(api,item,wide=false) {
    if(window.OrbitalPersonal?.isHidden(api,item))return window.OrbitalPersonal.omitted(item);
    item=window.OrbitalPersonal?.project(api,item)||item;
    const n=a('',details(api,item),'ob5-card'+(wide?' ob5-wide':''));n.dataset.itemId=item.Id;if(item.SeriesId)n.dataset.seriesId=item.SeriesId;
    const art=node('div','ob5-art');const url=artwork(api,item,wide);
    if(url)art.append(img(url,''));else art.append(node('span','ob5-art-fallback',clean(item.SeriesName||item.Name)));
    const position=item.UserData?.PlaybackPositionTicks||0;
    if(wide&&position>0&&item.RunTimeTicks){const p=node('progress','ob5-progress');p.max=item.RunTimeTicks;p.value=position;p.setAttribute('aria-hidden','true');art.append(p);const percent=Math.max(1,Math.min(99,Math.round(position/item.RunTimeTicks*100)));n.setAttribute('aria-label',clean(item.SeriesName||item.Name)+' · '+percent+'% watched');}
    n.append(art,node('strong','ob5-card-title',clean(item.SeriesName||item.Name)));
    const meta=item.Type==='Episode'?(()=>{const se=`S${item.ParentIndexNumber||0} · E${item.IndexNumber||0}`,t=window.OrbitalText?.episode(item)||'';return !t||/^Episode \d+$/.test(t)?se:se+' · '+t;})():[item.ProductionYear,item.OfficialRating].filter(Boolean).join(' · ');
    n.append(node('span','ob5-card-meta',meta));
    if(wide&&position>0&&item.RunTimeTicks>position){
      const remaining=Math.ceil((item.RunTimeTicks-position)/600000000);
      n.append(node('span','ob21-remaining',remaining>=60?`${Math.floor(remaining/60)}h ${remaining%60}m left`:`${remaining}m left`));
    }
    return n;
  }
  function shelf(api,title,items,{wide=false,href}={}) {
    if(!items.length)return null;
    const section=node('section','ob5-shelf');section.setAttribute('aria-label',title);
    const head=node('div','ob5-shelf-head');head.append(node('h2','',title));if(href)head.append(a('View all',href));
    // Phone rows need only enough cards for the first few swipes. The same shelves remain available,
    // while avoiding hundreds of initial DOM nodes and image observers on Android-class hardware.
    const phone=phoneSurface(),first=phone?Math.min(6,items.length):items.length;
    const strip=node('div','ob5-strip');for(const item of items.slice(0,first))strip.append(card(api,item,wide));
    if(first<items.length){let rest=items.slice(first);
      const fill=()=>{if(!rest)return;const f=document.createDocumentFragment();for(const item of rest)f.append(card(api,item,wide));rest=null;strip.append(f);strip.removeEventListener('scroll',near);};
      const near=()=>{if(strip.scrollLeft+strip.clientWidth*2>=strip.scrollWidth)fill();};strip.addEventListener('scroll',near,{passive:true});strip.addEventListener('focusin',near);}
    const controls=node('div','ob5-row-controls');
    for(const [label,direction,symbol] of [['Previous titles',-1,'chevron_left'],['More titles',1,'chevron_right']]){const b=button('',()=>strip.scrollBy({left:direction*strip.clientWidth*.8,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}),'ob5-arrow');b.setAttribute('aria-label',label);b.append(icon(symbol));controls.append(b);}
    head.append(controls);section.append(head,strip);return section;
  }
  // Hero carousel (Claude): swipe on touch, Left/Right keys and edge arrows on desktop, cross-fade, auto-advance every 8 s.
  // Auto-advance pauses while hovered, focused, touched, off-screen, in a background tab, or with reduced motion.
  const FEATURE_AUTO_MS=8000;
  if(!window.__obFeatureTimer)window.__obFeatureTimer=setInterval(()=>{
    if(document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    for(const box of document.querySelectorAll('.ob5-feature')){if(typeof box._obAdvance!=='function'||!box.isConnected||box.matches(':hover')||box.contains(document.activeElement)||Date.now()-(box._obTouched||0)<FEATURE_AUTO_MS*2)continue;const r=box.getBoundingClientRect();if(r.bottom<60||r.top>innerHeight-60||!r.width)continue;if(Date.now()-(box._obShownAt||0)>=FEATURE_AUTO_MS-250)box._obAdvance(1,true);}
  },1000);
  function feature(api,items,mode,eyebrow) {
    items=window.OrbitalPersonal?.filter(api,items).map(i=>window.OrbitalPersonal.project(api,i))||items;
    {const trusted=items.filter(i=>!OrbitalRating.thin(i));if(trusted.length)items=trusted;}
    const pool=items.filter(i=>i.BackdropImageTags?.length),seed=[...new Date().toLocaleDateString('en-CA')+'|'+api.getCurrentUserId()+'|'+mode].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0),offset=pool.length?(pool.every(i=>i.HeroReason)?0:seed%pool.length):0;const options=[...pool.slice(offset),...pool.slice(0,offset)].slice(0,5);if(!options.length)return null;
    let index=0;const box=node('section','ob5-feature');box.setAttribute('aria-label','Featured titles');box.setAttribute('aria-roledescription','carousel');
    const art=node('div','ob5-feature-art'),content=node('div','ob5-feature-copy'),controls=node('div','ob5-feature-controls');content.setAttribute('aria-live','polite');
    const backdrop=item=>api.getImageUrl(item.HeroArtId||item.Id,{type:'Backdrop',tag:item.BackdropImageTags[0],maxWidth:innerWidth<700?1000:1920,quality:90});
    const paint=(animate)=>{const item=options[index],picture=img(backdrop(item),'','');picture.loading='eager';
      if(animate&&art.firstElementChild){picture.classList.add('ob5-feature-incoming');const old=[...art.children];art.append(picture);const settle=()=>{picture.classList.remove('ob5-feature-incoming');setTimeout(()=>old.forEach(n=>n.remove()),420);};picture.decode?.().then(settle,settle)??settle();}
      else art.replaceChildren(picture);
      const hadFocus=content.contains(document.activeElement)?[...content.querySelectorAll('a,button')].indexOf(document.activeElement):-1;
      content.replaceChildren(node('span','ob5-eyebrow',item.HeroReason||eyebrow||((mode==='tv'||item.Type==='Series')?'FROM YOUR SERIES LIBRARY':'FROM YOUR MOVIE LIBRARY')),node('h1','',clean(item.Name)),node('p','ob5-feature-meta',[item.ProductionYear,item.OfficialRating,OrbitalRating.label(item),...(item.Genres||[]).slice(0,2)].filter(Boolean).join(' · ')),node('p','ob5-overview',String(item.Overview||'').replace(/<[^>]*>/g,'').slice(0,230)),a(item.Type==='Movie'||item.Type==='Episode'?'Play':'Explore title',details(api,item)+(item.Type==='Movie'||item.Type==='Episode'?'&orbitalAutoplay=1':''),'ob5-button ob5-primary'),a('Details',details(api,item),'ob5-button'));
      if(item.ImageTags?.Logo){const heading=content.querySelector('h1');const logo=img(api.getImageUrl(item.HeroArtId||item.Id,{type:'Logo',tag:item.ImageTags.Logo,maxWidth:900,quality:90}),'ob5-title-logo',clean(item.Name));logo.loading='eager';logo.onload=()=>{if(heading.isConnected&&logo.naturalWidth>0)heading.replaceChildren(logo);};logo.onerror=()=>{};if(logo.complete&&logo.naturalWidth>0)heading.replaceChildren(logo);}
      if(animate){content.classList.remove('ob5-feature-fade');void content.offsetWidth;content.classList.add('ob5-feature-fade');}
      if(hadFocus>=0)content.querySelectorAll('a,button')[hadFocus]?.focus({preventScroll:true});
      box._obShownAt=Date.now();controls.querySelectorAll('.ob5-feature-dot').forEach((b,i)=>{b.setAttribute('aria-pressed',String(i===index));b.classList.remove('is-timing');if(i===index&&options.length>1){void b.offsetWidth;b.classList.add('is-timing');}});
      const next=options[(index+1)%options.length];if(next&&next!==item){const pre=new Image();pre.src=backdrop(next);}};
    const go=(step,auto)=>{if(options.length<2)return;index=(index+step+options.length)%options.length;if(!auto)box._obTouched=Date.now();paint(true);};
    box._obAdvance=go;
    options.forEach((item,i)=>{const b=button('',()=>{if(i!==index){index=i;box._obTouched=Date.now();paint(true);}},'ob5-feature-dot');b.setAttribute('aria-label','Feature '+clean(item.Name));controls.append(b);});
    if(options.length>1){
      const prev=button('',()=>go(-1),'ob5-feature-nav ob5-feature-prev'),next=button('',()=>go(1),'ob5-feature-nav ob5-feature-next');prev.setAttribute('aria-label','Previous featured title');next.setAttribute('aria-label','Next featured title');prev.tabIndex=next.tabIndex=-1;box._obNav=[prev,next];
      box.addEventListener('keydown',e=>{if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.target.matches('input,textarea,select'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();go(e.key==='ArrowRight'?1:-1);}});
      let sx=0,sy=0,tracking=false,swiped=false;
      box.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;tracking=true;swiped=false;box._obTouched=Date.now();},{passive:true});
      box.addEventListener('touchmove',e=>{if(!tracking)return;const dx=e.touches[0].clientX-sx,dy=e.touches[0].clientY-sy;if(Math.abs(dy)>Math.abs(dx)*1.2&&Math.abs(dy)>12){tracking=false;return;}if(Math.abs(dx)>12)art.style.setProperty('--ob5-drag',Math.max(-60,Math.min(60,dx/4))+'px');},{passive:true});
      box.addEventListener('touchend',e=>{art.style.removeProperty('--ob5-drag');if(!tracking)return;tracking=false;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.3){swiped=true;go(dx<0?1:-1);}},{passive:true});
      box.addEventListener('touchcancel',()=>{tracking=false;art.style.removeProperty('--ob5-drag');},{passive:true});
      box.addEventListener('click',e=>{if(swiped){swiped=false;e.preventDefault();e.stopPropagation();}},true);
    }
    if(box._obNav){controls.prepend(box._obNav[0]);controls.append(box._obNav[1]);}box.append(art,content,controls);paint(false);return box;
  }
  function libraryHref(view) {
    if(view.CollectionType==='livetv')return '#/livetv?tab=1';
    const path=({movies:'movies',tvshows:'tv',boxsets:'boxsets',music:'music',books:'books',homevideos:'homevideos',musicvideos:'musicvideos',playlists:'playlists'})[view.CollectionType]||'mixed';
    return '#/'+path+'?topParentId='+encodeURIComponent(view.Id)+'&collectionType='+encodeURIComponent(view.CollectionType||'movies');
  }
  function setNavigationOpen(open, returnFocus) {
    const nav=document.querySelector('#ob5-navigation'),toggle=document.querySelector('#ob5-menu-toggle');
    if(!nav||!toggle)return;
    document.querySelector('#ob21-top-navigation')?.toggleAttribute('inert',open);
    if(open){
      S.navReturnFocus=returnFocus?.isConnected?returnFocus:document.activeElement;
      document.documentElement.classList.add('ob5-nav-open');
      nav.removeAttribute('inert');nav.setAttribute('aria-hidden','false');toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Close navigation');
      requestAnimationFrame(()=>{(nav.querySelector('[aria-current="page"]')||nav.querySelector('a'))?.focus();});
    }else{
      document.documentElement.classList.remove('ob5-nav-open');
      nav.setAttribute('inert','');nav.setAttribute('aria-hidden','true');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');
      const target=S.navReturnFocus;S.navReturnFocus=null;if(returnFocus!==false&&target?.isConnected)requestAnimationFrame(()=>target.focus());
    }
  }
  function ensureNavigationChrome(nav) {
    let toggle=document.querySelector('#ob5-menu-toggle');
    if(!toggle){toggle=button('',()=>setNavigationOpen(!document.documentElement.classList.contains('ob5-nav-open'),toggle),'ob5-menu-toggle');toggle.id='ob5-menu-toggle';toggle.setAttribute('aria-controls','ob5-navigation');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');toggle.append(icon('menu'));document.body.append(toggle);}
    let scrim=document.querySelector('#ob5-navigation-scrim');
    if(!scrim){scrim=node('button','ob5-navigation-scrim');scrim.id='ob5-navigation-scrim';scrim.type='button';scrim.setAttribute('aria-label','Close navigation');scrim.onclick=()=>setNavigationOpen(false);document.body.append(scrim);}
    const open=document.documentElement.classList.contains('ob5-nav-open');nav.toggleAttribute('inert',!open);nav.setAttribute('aria-hidden',open?'false':'true');
  }
  function navigation(views) {
    let nav=document.querySelector('#ob5-navigation');
    const capabilities=JSON.stringify([views.map(v=>[v.Id,v.CollectionType]),window.OrbitalEdition?.features]);
    let restoreFocus=null;
    if(nav&&nav.dataset.capabilities!==capabilities){
      const focused=document.activeElement,top=document.querySelector('#ob21-top-navigation');
      if(nav.contains(focused)||top?.contains(focused))restoreFocus={href:focused.closest?.('a')?.getAttribute('href'),top:!!top?.contains(focused)};
      nav.remove();top?.remove();nav=null;
    }
    if(!nav){nav=node('nav','ob5-navigation');nav.id='ob5-navigation';nav.setAttribute('aria-label','Navigation');

      const main=node('div','ob5-main-nav');
      const movie=views.find(v=>v.CollectionType==='movies'),tv=views.find(v=>v.CollectionType==='tvshows');
      const hasLive=views.some(v=>v.CollectionType==='livetv');const entries=[['Home','#/home','home'],...((hasLive||window.OrbitalEdition?.features?.sports)?[['Sports','#/livetv?tab=0&sports=1','sports']]:[]),...(movie?[['Movies',views.filter(v=>v.CollectionType==='movies').length===1?libraryHref(movie):'#/movies?collectionType=movies','movie']]:[]),...(tv?[['TV Shows',views.filter(v=>v.CollectionType==='tvshows').length===1?libraryHref(tv):'#/tv?collectionType=tvshows','tv']]:[]),...(views.some(v=>v.CollectionType==='livetv')?[['Live','#/livetv?tab=1','live_tv']]:[]),['Services','#/movies?orbitalBrowse=services','apps'],['Search','#/search','search']];
      for(const [label,href,symbol] of entries){const l=a('',href);l.append(icon(symbol),node('span','',label));main.append(l);}nav.append(main);
      const secondary=node('div','ob5-secondary-nav');
      secondary.append(a('My List','#/movies?orbitalBrowse=mylist','favorite_border'),requestLink('','Requests','/','add_circle_outline'));
      const extra=views.filter(v=>!/^IPTV (?:Movies|TV Shows)$/.test(v.Name)&&v.CollectionType!=='livetv'&&(v.CollectionType!=='movies'&&v.CollectionType!=='tvshows'||views.filter(x=>x.CollectionType===v.CollectionType).length>1));
      if(extra.length){secondary.append(node('span','ob5-nav-caption','LIBRARIES'));for(const view of extra)secondary.append(a(view.Name,libraryHref(view)));}
      const fallback=a('Standard interface',location.pathname+'?orbital=off#/movies','ob5-standard');secondary.append(fallback);nav.append(secondary);
      // Cover the old route before the hash changes and before the browser can
      // paint another frame. The hashchange listener then retargets the gate.
      nav.addEventListener('click',event=>{const link=event.target.closest?.('a');if(link&&new URL(link.href,location.href).origin===location.origin)beginBrowseTransition(new URL(link.href,location.href).hash);if(link)setNavigationOpen(false,false);},true);
      document.body.append(nav);
    }
    nav.dataset.capabilities=capabilities;
    ensureNavigationChrome(nav);
    // Reuse the account-filtered destinations; no extra catalog requests or invented actions.
    let top=document.querySelector('#ob21-top-navigation');
    if(!top){
      top=node('nav','ob21-top-navigation');top.id='ob21-top-navigation';top.setAttribute('aria-label','Primary navigation');

      for(const link of nav.querySelectorAll('.ob5-main-nav a')){
        const label=link.querySelector('span:not(.material-icons)')?.textContent||link.textContent;
        if(label==='Search')continue;
        top.append(a(label,link.getAttribute('href'),'ob21-top-link'));
      }
      top.addEventListener('click',event=>{const link=event.target.closest?.('a');if(link)beginBrowseTransition(new URL(link.href,location.href).hash);},true);
      document.body.append(top);
    }
    if(restoreFocus?.href){[...(restoreFocus.top?top:nav).querySelectorAll('a')].find(a=>a.getAttribute('href')===restoreFocus.href)?.focus({preventScroll:true});}
    document.documentElement.classList.add('ob5-shell');
    const {path,q}=route();for(const l of nav.querySelectorAll('a')){const dest=new URL(l.href);const [p,s='']=dest.hash.slice(1).split('?'),dq=new URLSearchParams(s);const teamPage=path==='/movies'&&String(q.get('orbitalBrowse')||'').startsWith('team:');const selected=teamPage?dest.origin===location.origin&&p==='/livetv'&&dq.get('sports')==='1':dest.origin===location.origin&&p===path&&(p!='/home'||dq.get('tab')===q.get('tab'))&&(p!='/movies'&&p!='/tv'||dq.get('topParentId')===q.get('topParentId')&&(dq.get('orbitalBrowse')||'')===(q.get('orbitalBrowse')||''))&&(p!='/livetv'||(dq.get('tab')||'0')===(q.get('tab')||'0')&&(dq.get('sports')==='1')===(q.get('sports')==='1'));if(selected)l.setAttribute('aria-current','page');else l.removeAttribute('aria-current');}
    for(const l of top.querySelectorAll('a')){const match=[...nav.querySelectorAll('a')].find(n=>n.getAttribute('href')===l.getAttribute('href'));if(match?.hasAttribute('aria-current'))l.setAttribute('aria-current','page');else l.removeAttribute('aria-current');}
  }
  const emptyHome = () => ({feature:[],top:[],latest:[],decades:[],genres:[],continue:[],series:[],channels:[],events:[],favorites:[],because:{title:'',items:[]}});
  const settledItems = result => result?.status==='fulfilled'?(result.value.Items||result.value):[];
  async function homeContent(api,user,onPreview) {
    // Share the authenticated board with team cards and Home refresh. Keep the
    // original server timestamps; cache reuse never renews freshness evidence.
    const firstEvents=window.OrbitalRefresh.events(api);
    const firstChannels=fetchJson(api,'LiveTv/Channels',{UserId:user,Limit:100,EnableUserData:true,EnableCurrentProgram:true,ImageTypeLimit:1});
    firstEvents.catch(()=>{});firstChannels.catch(()=>{});
    const query={IncludeItemTypes:'Movie'};
    const picks={MinCommunityRating:7,ImageTypes:'Primary',SortBy:'CommunityRating,DateCreated',SortOrder:'Descending'};

    // Keep the first wave small. Hero and recent titles are enough to make Home useful while
    // personalization and the larger discovery surface continue without blocking the page.
    const latestPromise=catalog(api,user,{IncludeItemTypes:'Movie,Series',SortBy:'DateCreated',SortOrder:'Descending'});
    const heroPromise=catalog(api,user,{IncludeItemTypes:'Movie,Series',MinCommunityRating:6.5,ImageTypes:'Backdrop',SortBy:'CommunityRating,DateCreated',SortOrder:'Descending'});
    const nextPromise=fetchJson(api,'Shows/NextUp',{UserId:user,Limit:80,EnableResumable:true,EnableRewatching:false,Fields:'Overview,ProviderIds,Genres,Path,Tags'});
    const resumePromise=fetchJson(api,'Users/'+user+'/Items/Resume',{Limit:100,MediaTypes:'Video',Fields:'Overview,ProviderIds,Genres,Path,Tags'});
    // Discover the same first hero as feature() while personal rows settle.
    const homeEpoch=S.serial;
    heroPromise.then(items=>{if(api.getCurrentUserId()!==user||S.serial!==homeEpoch)return;
      const item=unique(items).find(i=>i.BackdropImageTags?.length);if(!item)return;
      const preload=new Image();preload.fetchPriority='high';preload.src=api.getImageUrl(item.HeroArtId||item.Id,{type:'Backdrop',tag:item.BackdropImageTags[0],maxWidth:1920,quality:90});
    }).catch(()=>{});
    const preview=emptyHome();let leadShown=false;
    const publishLead=()=>{if(!phoneSurface()&&!leadShown&&(preview.latest.length||preview.feature.length)){leadShown=true;onPreview?.({...preview});}};
    latestPromise.then(items=>{preview.latest=unique(items);publishLead();}).catch(()=>{});
    heroPromise.then(items=>{preview.feature=unique(items);publishLead();}).catch(()=>{});
    const personalPromise=Promise.allSettled([nextPromise,resumePromise]).then(async personal=>{
      const next=settledItems(personal[0]),resume=settledItems(personal[1]);
      let identities=[];const ids=[...new Set(next.map(i=>i.SeriesId).filter(Boolean))];
      if(ids.length){try{identities=(await api.getItems(user,{Ids:ids.join(','),Limit:100,Fields:'ProviderIds,Path,Tags'})).Items||[];}catch{}}
      preview.continue=continueItems(next,resume,identities);
      if(preview.continue.length&&leadShown&&!phoneSurface())onPreview?.({...preview});
      return {personal,next,resume,identities};
    });
    const lead=await Promise.allSettled([latestPromise,heroPromise]);
    preview.latest=unique(settledItems(lead[0]));preview.feature=unique(settledItems(lead[1]));
    publishLead();

    const [genres,extraGenres]=window.OrbitalParity?.genres('movies',user)||[['Thriller','Comedy','Adventure','Science Fiction'],['Action','Horror','Family','Animation','Documentary','Western']];

    if(phoneSurface()&&onPreview){
      // Optional personal/live enrichment must not hold the first useful frame
      // or prevent the retained discovery jobs from running in the background.
      void Promise.allSettled([personalPromise,firstEvents,firstChannels]).then(([personal,ev,ch])=>{
        const events=ev.status==='fulfilled'?ev.value:[];
        const channels=ch.status==='fulfilled'?(ch.value.Items||[]):[];
        onPreview({...preview,latest:[],events,channels,stableFirst:true});
      }).catch(()=>{});
    }
    const jobs=[
      ()=>catalog(api,user,{...query,...picks,IsPlayed:false}),
      ...genres.map(genre=>()=>catalog(api,user,{...query,Genres:genre,MinCommunityRating:6.5,ImageTypes:'Primary',SortBy:'CommunityRating,SortName',SortOrder:'Descending'})),
      ()=>catalog(api,user,{IncludeItemTypes:'Series',IsPlayed:false,SortBy:'CommunityRating',SortOrder:'Descending'}),
      ()=>firstChannels,
      ()=>firstEvents,
      ()=>catalog(api,user,{IncludeItemTypes:'Movie,Series',Filters:'IsFavorite',SortBy:'DatePlayed,SortName',SortOrder:'Descending'}),
      ()=>watchedItems(api,user),
      ...extraGenres.map(genre=>()=>catalog(api,user,{...query,Genres:genre,MinCommunityRating:6.5,ImageTypes:'Primary',SortBy:'CommunityRating,SortName',SortOrder:'Descending',IsPlayed:false}))
    ];
    const [personalData,rest]=await Promise.all([personalPromise,(async()=>{
      const results=new Array(jobs.length);let nextJob=0;
      async function worker(){while(nextJob<jobs.length){const index=nextJob++;
        if(api.getCurrentUserId()!==user||S.serial!==homeEpoch)throw new Error('Home changed');
        try{results[index]={status:'fulfilled',value:await jobs[index]()};}catch(reason){results[index]={status:'rejected',reason};}
        await new Promise(resolve=>setTimeout(resolve,0));
      }}
      await Promise.all([worker(),worker(),worker()]);return results;
    })()]);
    const {personal,next,resume,identities}=personalData,read=i=>settledItems(rest[i]);
    if(lead.every(r=>r.status==='rejected')&&personal.every(r=>r.status==='rejected')&&rest.slice(0,5).every(r=>r.status==='rejected'))throw new Error('Catalog unavailable');
    const seriesIndex=1+genres.length,channelsIndex=seriesIndex+1,todayIndex=channelsIndex+1,favoritesIndex=todayIndex+1,watchedIndex=favoritesIndex+1,extraStart=watchedIndex+1;
    let because={title:'',items:[]};const watched=read(watchedIndex)[0]||resume[0];
    const watchedName=clean(watched?.SeriesName||watched?.Name),seedId=watched?.SeriesId||watched?.Id;
    if(watchedName&&seedId){try{const response=await fetchJson(api,'sports/api/recommendations',{seed:seedId});const choices=response.items||[];because={title:'Because you watched '+watchedName,items:unique(choices.filter(item=>item.Id!==seedId&&!item.UserData?.Played))};}catch{/* Other shelves remain available. */}}
    return {feature:preview.feature,top:unique(read(0)),latest:preview.latest,decades:[],genres:[...genres.map((name,i)=>({name,items:unique(read(i+1))})),...extraGenres.map((name,i)=>({name,items:unique(read(extraStart+i))}))],continue:continueItems(next,resume,identities),series:unique(read(seriesIndex)),channels:read(channelsIndex),events:read(todayIndex),favorites:unique(read(favoritesIndex)),because};
  }

  async function content(api,user,mode,parent,onPreview){
    const heroTask=fetchJson(api,'sports/api/catalogue',{view:'hero',type:mode==='tv'?'Series':mode==='movies'?'Movie':'All',parent:parent||undefined}).catch(()=>({hero:[]}));
    let done=false,curatedHero=null,lastPreview=null;
    heroTask.then(h=>{curatedHero=h;if(!done&&lastPreview)onPreview?.({...lastPreview,hero:h.hero||[]});});
    // A real recent title can supply the initial feature while optional hero sources settle.
    const preview=onPreview?value=>{lastPreview=value;const localHero=value.feature?.length?value.feature:(mode==='home'?(value.latest||[]).filter(item=>item.BackdropImageTags?.length):[]);if(!done)onPreview({...value,hero:curatedHero?.hero?.length?curatedHero.hero:localHero});}:null;
    const [value,h]=await Promise.all([contentLocal(api,user,mode,parent,preview),heroTask]);done=true;
    return {...value,hero:h.hero||[]};
  }
  async function contentLocal(api,user,mode,parentId,onPreview) {
    if(mode==='home')return homeContent(api,user,onPreview);
    const type=mode==='tv'?'Series':'Movie',scope=parentId?{ParentId:parentId}:{};
    const query={IncludeItemTypes:type,...scope};
    // A pure rating sort surfaces obscure titles with a handful of votes; a shuffled, well-rated,
    // poster-bearing selection reads as recommendations without inventing popularity data.
    const picks={MinCommunityRating:7,ImageTypes:'Primary',SortBy:'CommunityRating,DateCreated',SortOrder:'Descending'};
    const jobs=[catalog(api,user,{...query,...picks,IsPlayed:false}),catalog(api,user,{...query,SortBy:'DateCreated',SortOrder:'Descending'})];
    const rotated=window.OrbitalParity?.genres(mode,user);const genres=rotated?.[0]||(mode==='tv'?['Drama','Comedy','Documentary','Science Fiction']:['Thriller','Comedy','Adventure','Science Fiction']);
    for(const genre of genres)jobs.push(catalog(api,user,{...query,Genres:genre,MinCommunityRating:6.5,ImageTypes:'Primary',SortBy:'CommunityRating,SortName',SortOrder:'Descending'}));
    const heroIndex=jobs.length;jobs.push(catalog(api,user,{...query,MinCommunityRating:6.5,ImageTypes:'Backdrop',SortBy:'CommunityRating,DateCreated',SortOrder:'Descending'}));
    let nextIndex,resumeIndex,seriesIndex,channelsIndex,todayIndex,yesterdayIndex,favoritesIndex,watchedIndex;
    if(mode==='home'){
      nextIndex=jobs.length;jobs.push(fetchJson(api,'Shows/NextUp',{UserId:user,Limit:80,EnableResumable:true,EnableRewatching:false,Fields:'Overview,ProviderIds,Genres,Path,Tags'}));
      resumeIndex=jobs.length;jobs.push(fetchJson(api,'Users/'+user+'/Items/Resume',{Limit:100,MediaTypes:'Video',Fields:'Overview,ProviderIds,Genres,Path,Tags'}));
      seriesIndex=jobs.length;jobs.push(catalog(api,user,{IncludeItemTypes:'Series',IsPlayed:false,SortBy:'CommunityRating',SortOrder:'Descending'}));
      channelsIndex=jobs.length;jobs.push(fetchJson(api,'LiveTv/Channels',{UserId:user,Limit:100,EnableUserData:true,EnableCurrentProgram:true,ImageTypeLimit:1}));
      const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),yesterday=new Date(today+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
      todayIndex=jobs.length;jobs.push(fetchJson(api,'sports/api/events',{date:today}));
      yesterdayIndex=jobs.length;jobs.push(fetchJson(api,'sports/api/events',{date:yesterday.toISOString().slice(0,10)}));
      favoritesIndex=jobs.length;jobs.push(catalog(api,user,{IncludeItemTypes:'Movie,Series',Filters:'IsFavorite',SortBy:'DatePlayed,SortName',SortOrder:'Descending'}));
      watchedIndex=jobs.length;jobs.push(watchedItems(api,user));
    }
    const extraGenres=rotated?.[1]||(mode==='tv'?['Reality','Crime','Animation','Kids','Action','Mystery']:['Action','Horror','Family','Animation','Documentary','Western']);
    const extraStart=jobs.length;
    for(const genre of extraGenres)jobs.push(catalog(api,user,{...query,Genres:genre,MinCommunityRating:6.5,ImageTypes:'Primary',SortBy:'CommunityRating,SortName',SortOrder:'Descending',IsPlayed:false}));
    const decades=mode==='home'?[]:[['2020s',2020,2026],['2010s',2010,2019],['1990s',1990,1999]];const decadeStart=jobs.length;
    for(const [,from,to] of decades)jobs.push(catalog(api,user,{...query,Years:Array.from({length:to-from+1},(_,i)=>from+i).join(','),MinCommunityRating:6.5,ImageTypes:'Primary',SortBy:'CommunityRating,SortName',SortOrder:'Descending'}));
    // Optional genre/decade shelves never hold the useful library hero hostage.
    if(onPreview)Promise.allSettled([jobs[0],jobs[1],jobs[heroIndex]]).then(early=>{
      const read=i=>early[i].status==='fulfilled'?(early[i].value.Items||[]):[];
      if(read(0).length||read(1).length)onPreview({feature:unique(read(2)),top:unique(read(0)),latest:unique(read(1)),decades:[],genres:[],continue:[],series:[],channels:[],events:[],favorites:[],because:{title:'',items:[]}});
    });
    const result=await Promise.allSettled(jobs);const read=i=>result[i]?.status==='fulfilled'?(result[i].value.Items||result[i].value):[];
    if(result.slice(0,6).every(r=>r.status==='rejected'))throw new Error('Catalog unavailable');
    let identities=[];const ids=mode==='home'?[...new Set(read(nextIndex).map?.(i=>i.SeriesId).filter(Boolean)||[])]:[];
    if(mode==='home'&&ids.length){try{identities=(await api.getItems(user,{Ids:ids.join(','),Limit:100,Fields:'ProviderIds,Path,Tags'})).Items||[];}catch{/* SeriesId still prevents repeated episodes within a series. */}}
    let because={title:'',items:[]};
    if(mode==='home'){
      const watched=read(watchedIndex)[0]||read(resumeIndex)[0];
      const watchedName=clean(watched?.SeriesName||watched?.Name),seedId=watched?.SeriesId||watched?.Id;
      if(watchedName&&seedId){try{const response=await fetchJson(api,'sports/api/recommendations',{seed:seedId});const choices=response.items||[];because={title:'Because you watched '+watchedName,items:unique(choices.filter(item=>item.Id!==seedId&&!item.UserData?.Played))};}catch{/* Other shelves remain available. */}}
    }
    return {feature:unique(read(heroIndex)),top:unique(read(0)),latest:unique(read(1)),decades:decades.map(([name],i)=>({name,items:unique(read(decadeStart+i))})),genres:[...genres.map((name,i)=>({name,items:unique(read(i+2))})),...extraGenres.map((name,i)=>({name,items:unique(read(extraStart+i))}))],continue:mode==='home'?continueItems(read(nextIndex),read(resumeIndex),identities):[],series:mode==='home'?unique(read(seriesIndex)):[],channels:mode==='home'?read(channelsIndex):[],events:mode==='home'?[...(read(todayIndex).events||[]).map(e=>window.TelevisionFeedUi.withFreshness(e,read(todayIndex))),...(read(yesterdayIndex).events||[]).map(e=>window.TelevisionFeedUi.withFreshness(e,read(yesterdayIndex)))]:[],favorites:mode==='home'?unique(read(favoritesIndex)):[],because};
  }
  function liveGames(api,events) {
    const games=events.filter(e=>e.state==='live'&&e.sources.length).sort((a,b)=>Number(a.sources.every(s=>/test|experimental/i.test(s.name)))-Number(b.sources.every(s=>/test|experimental/i.test(s.name)))).slice(0,16);
    if(!games.length||!window.OrbitalSportsCards)return null;
    const section=node('section','ob5-shelf ob5-live');section.setAttribute('aria-label','Live sports');const head=node('div','ob5-shelf-head');head.append(node('h2','','Live sports'),a('All games','#/livetv?tab=0&sports=1'),a('Guide','#/livetv?tab=1'));const strip=node('div','ob5-strip');
    for(const event of games){if(innerWidth>=1000&&!document.documentElement.classList.contains('layout-mobile')&&window.OrbitalSportsCards.card){const stops=[];const card=window.OrbitalSportsCards.card(event,api,stops);card.dataset.refreshKey=event.league+'|'+event.id;strip.append(card);const cleanup=setInterval(()=>{if(!card.isConnected){for(const stop of stops)stop();clearInterval(cleanup);}},15000);continue;}const card=button('',e=>window.OrbitalSportsCards.open(event,api,e.currentTarget),'ob5-game-card');card.dataset.refreshKey=event.league+'|'+event.id;card.append(node('span','ob5-eyebrow',event.league+' · '+window.TelevisionFeedUi.truth(event)),window.OrbitalSportsCards.teams(event),node('span','ob5-card-meta',event.stale?'Saved game data':window.TelevisionFeedUi.sources(event).filter(s=>!s.automatic).length+' feeds'));strip.append(card);}section.append(head,strip);return section;
  }
  function live(api,channels) {
    const current=channels.filter(c=>c.CurrentProgram&&Number(c.Number)<2000).sort((a,b)=>Number(!!b.UserData?.IsFavorite)-Number(!!a.UserData?.IsFavorite)).slice(0,16);
    if(!current.length)return null;
    const section=node('section','ob5-shelf ob5-live');section.setAttribute('aria-label','Live now');const head=node('div','ob5-shelf-head');head.append(node('h2','','Live now'),a('Sports','#/livetv?tab=0&sports=1'),a('Open guide','#/livetv?tab=1'));section.append(head);
    const strip=node('div','ob5-strip');for(const c of current){const p=c.CurrentProgram,n=a('',details(api,c),'ob5-live-card');const art=node('div','ob5-live-art');const url=artwork(api,p,true)||artwork(api,c);if(url)art.append(img(url,''));else art.append(icon('live_tv'));
      art.append(node('span','ob5-live-badge','LIVE'));n.append(art,node('span','ob5-eyebrow',c.Name),node('strong','',p.Name||c.Name));const start=Date.parse(p.StartDate),end=Date.parse(p.EndDate);if(end>start){const elapsed=Math.max(0,Date.now()-start),progress=node('progress','ob5-progress');progress.max=end-start;progress.value=elapsed;progress.setAttribute('aria-hidden','true');n.setAttribute('aria-label',c.Name+' · '+(p.Name||c.Name)+' · '+Math.max(0,Math.min(100,Math.round(elapsed/(end-start)*100)))+'% elapsed');n.append(progress);}strip.append(n);}section.append(strip);return section;
  }
  // ---- Category browsing: genre / decade / sort pages rendered as a paged grid (60 per page). ----
  const DECADES=[['2020s',2020,2029],['2010s',2010,2019],['2000s',2000,2009],['1990s',1990,1999],['1980s',1980,1989],['Classics',1900,1979]];
  const GENRES={movies:['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Music','Mystery','Romance','Science Fiction','Thriller','TV Movie','War','Western'],tv:['Action & Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Kids','Mystery','Reality','Sci-Fi & Fantasy','Soap','Talk','War & Politics','Western']};
  function filterHref(mode,spec){const q=route().q;q.set('orbitalBrowse',spec);return '#/'+(mode==='tv'?'tv':'movies')+'?'+q;}
  function chipGroup(label,row){
    const group=node('div','ob5-chip-group');if(label)group.append(node('span','ob5-chip-label',label));
    const controls=node('div','ob5-chip-controls');
    for(const [name,delta,symbol] of [['Previous choices',-1,'chevron_left'],['More choices',1,'chevron_right']]){const b=button('',()=>row.scrollBy({left:delta*row.clientWidth*.75,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}),'ob5-chip-arrow');b.setAttribute('aria-label',name+(label?' in '+label:''));b.append(icon(symbol));controls.append(b);}
    const sync=()=>{const [prev,next]=controls.children,overflow=row.scrollWidth>row.clientWidth+2;group.classList.toggle('ob5-chip-overflow',overflow);prev.disabled=!overflow||row.scrollLeft<3;next.disabled=!overflow||row.scrollLeft+row.clientWidth>=row.scrollWidth-3;};
    row.addEventListener('scroll',sync,{passive:true});window.ResizeObserver&&new ResizeObserver(sync).observe(row);requestAnimationFrame(sync);group.append(row,controls);return group;
  }
  function browseBy(api,mode){
    const box=node('section','ob5-shelf ob5-browse-by');box.setAttribute('aria-label','Browse by category');
    const head=node('div','ob5-shelf-head');head.append(node('h2','','Browse by'));box.append(head);
    if(matchMedia('(min-width:900px)').matches){
      const state=dfDefaults();box.append(discoveryDock(mode,state,(field,b)=>dfSheet(mode,state,field,b)));
      const shortcuts=node('div','ob5-chip-row');for(const g of GENRES[mode==='tv'?'tv':'movies'].slice(0,6))shortcuts.append(a(g,dfHref(mode,{...state,genre:g}),'ob5-chip'));
      shortcuts.append(a('All titles',dfHref(mode,{...state,grid:'1'}),'ob5-chip'));box.append(shortcuts);return box;
    }
    const state=dfDefaults(),controls=node('div','df-service-controls df-library-controls');
    const sort=button('Sort: '+(FILTER_SORTS[state.sort]?.[0]||'Top rated'),()=>dfSheet(mode,state,'sort',sort,{onApply:d=>{location.hash=dfHref(mode,{...d,grid:'1'});}}),'df-dock-button df-sort');sort.setAttribute('aria-haspopup','dialog');
    controls.append(discoveryDock(mode,state,(field,b)=>dfSheet(mode,state,field,b)),sort,a('All titles ›',dfHref(mode,{...state,grid:'1'}),'df-view-all df-all-titles'));
    box.append(controls);return box;
  }

  // Subcategory rules. g = any of these co-genres, k = regex over title + overview, y = year range,
  // x = excluded co-genres. A shelf is shown when at least six pool titles match.
  const SUB={
    movies:{
      'Documentary':[['True crime',{g:['Crime'],k:'murder|killer|homicide|serial killer|cold case|kidnap|true crime|manhunt|convicted|fbi|crime spree|unsolved|wrongful'}],['White-collar & scams',{k:'fraud|ponzi|scam|embezzl|wall street|swindl|con man|con artist|bankrupt|corruption|scandal|insider'}],['Disasters & survival',{k:'disaster|hurricane|earthquake|tsunami|wildfire|avalanche|flood|survival|shipwreck|titanic|chernobyl|explosion|collapse|tornado|rescue'}],['Music & concerts',{g:['Music','Concerts','Concert'],k:'concert|band|album|tour|singer|rapper|hip-hop|rock|jazz|festival'}],['Nature & wildlife',{k:'wildlife|nature|planet|ocean|shark|animal|species|jungle|arctic|wilderness|reef|predator|elephant|whale'}],['Space & science',{k:'space|nasa|universe|cosmos|astronaut|physics|scientist|science|quantum|galaxy|moon landing|rocket'}],['History & war',{g:['History','War'],k:'world war|wwii|ww2|nazi|hitler|battle|ancient|empire|civil war|vietnam|holocaust|cold war|revolution'}],['Sports',{k:'football|basketball|baseball|boxing|olympic|nfl|nba|soccer|racing|formula|wrestl|athlete|championship|hockey|golf|tennis|ufc|mma|skateboard|surf'}],['Biographies & portraits',{k:'life of|biography|biopic|portrait of|his life|her life|memoir|the story of|rise and fall|the man behind|the woman behind|in his own words|in her own words'}],['Comedy & stand-up',{g:['Comedy','Stand-Up Comedy'],k:'stand-up|standup|comedian|comedy special'}],['Food & travel',{k:'chef|cuisine|restaurant|food|cooking|travel|expedition|road trip|journey across|voyage'}],['Cults, conspiracies & the unexplained',{k:'cult|conspiracy|ufo|alien|paranormal|secret society|bigfoot|mystery of|unexplained|haunted|psychic'}],['Politics & society',{k:'politic|president|election|democracy|activist|protest|racism|immigra|civil rights|inequality|climate change|social justice'}],['Crime & cartels',{k:'cartel|drug|trafficking|mafia|mob|gang|narco'}]],
      'Action':[['Superheroes & comics',{k:'superhero|marvel|avengers|batman|spider-man|x-men|justice league|comic|mutant|superman|wolverine'}],['Martial arts',{k:'martial|kung fu|karate|ninja|samurai|fighter|tournament|shaolin|bruce lee|jackie chan'}],['Spies & espionage',{k:'\\bspy\\b|espionage|\\bcia\\b|\\bmi6\\b|\\bkgb\\b|secret agent|covert|undercover|intelligence agency'}],['Heists & getaways',{k:'heist|robbery|thieves|steal|bank job|getaway|casino'}],['Military & war',{g:['War'],k:'soldier|marine|navy seal|special forces|platoon|army|sniper'}],['Sci-fi action',{g:['Science Fiction']}],['Crime action',{g:['Crime']}],['Adventures',{g:['Adventure']}],['Survival & disaster',{k:'survive|survival|disaster|stranded|earthquake|tsunami|hijack|hostage'}],['Action comedies',{g:['Comedy']}]],
      'Comedy':[['Romantic comedies',{g:['Romance']}],['Family comedies',{g:['Family']}],['Animated comedies',{g:['Animation']}],['Stand-up & specials',{g:['Stand-Up Comedy'],k:'stand-up|standup|comedy special|live at|comedian'}],['Dark comedies',{g:['Crime','Thriller'],k:'dark comedy|black comedy|murder|crime'}],['Holiday comedies',{k:'christmas|holiday|santa|thanksgiving|new year'}],['Buddies, weddings & road trips',{k:'road trip|best friend|buddy|bachelor|wedding|bromance|vacation|reunion'}],['Teen & coming of age',{k:'high school|teen|coming of age|college|prom|graduat'}],['Workplace & satire',{k:'office|satire|corporate|boss|workplace|campaign|spoof|parody'}],['Comedy classics',{y:[1900,1989]}]],
      'Drama':[['Crime dramas',{g:['Crime']}],['Period & historical',{g:['History'],k:'century|victorian|kingdom|1800s|1900s|regency|medieval|empire|dynasty'}],['Based on true stories',{k:'true story|based on the true|based on a true|biopic|real-life|inspired by true|the true story|biography'}],['Sports dramas',{k:'football|basketball|baseball|boxing|boxer|olympic|coach|champion|athlete|racing|wrestl|hockey|golf'}],['Romantic dramas',{g:['Romance']}],['Legal & political',{k:'lawyer|trial|courtroom|attorney|senator|president|political|verdict|justice|judge'}],['War dramas',{g:['War']}],['Family dramas',{g:['Family'],k:'family drama|coming of age|single mother|single father|estranged|generations|adoption|foster'}],['Music & musicals',{g:['Music','Musical']}],['Thrillers & suspense',{g:['Thriller']}],['Independent & festival',{k:'sundance|independent|festival|award-winning'}]],
      'Horror':[['Supernatural & haunted',{k:'ghost|haunt|demon|possess|exorcis|paranormal|spirit|curse|occult|ouija'}],['Slashers & serial killers',{k:'slasher|killer|masked|serial|massacre|stalk|murder'}],['Zombies & outbreaks',{k:'zombie|undead|outbreak|infected|virus|plague|apocalyp'}],['Creature features',{k:'creature|monster|shark|werewolf|vampire|beast|swamp|giant|spider'}],['Found footage',{k:'found footage|footage|camera crew|documentary crew|recording'}],['Horror comedies',{g:['Comedy']}],['Psychological horror',{k:'psycholog|madness|insanity|nightmare|obsess|asylum|mind'}],['Sci-fi horror',{g:['Science Fiction']}],['Cabins, cults & backwoods',{k:'cabin|woods|cult|forest|camp|backwoods|island|remote'}],['Horror classics',{y:[1900,1989]}]],
      'Science Fiction':[['Space & galaxies',{k:'space|galaxy|planet|astronaut|starship|mars|orbit|cosmos'}],['Time travel & loops',{k:'time travel|time loop|travels back|the future|timeline|paradox'}],['Dystopias & apocalypse',{k:'dystopia|apocalyp|wasteland|post-apocalyptic|survivors|totalitarian|last humans'}],['AI, robots & cyborgs',{k:'robot|android|artificial intelligence|a\\.i\\.|cyborg|machine|computer|simulation|virtual'}],['Aliens & invasions',{k:'alien|invasion|extraterrestrial|first contact|ufo'}],['Sci-fi thrillers',{g:['Thriller']}],['Sci-fi action',{g:['Action']}],['Superheroes',{k:'superhero|marvel|comic|mutant'}],['Sci-fi horror',{g:['Horror']}],['Sci-fi classics',{y:[1900,1989]}]],
      'Thriller':[['Psychological thrillers',{k:'psycholog|obsess|paranoi|mind games|manipulat|twisted|secret'}],['Crime thrillers',{g:['Crime']}],['Spies & conspiracies',{k:'spy|espionage|conspiracy|cover-up|government|agent|cia'}],['Mysteries',{g:['Mystery']}],['Action thrillers',{g:['Action']}],['Kidnappings, hostages & home invasion',{k:'kidnap|hostage|home invasion|abduct|ransom|captive|intruder'}],['Serial killers',{k:'serial killer|murderer|killer'}],['Survival thrillers',{k:'survive|survival|stranded|wilderness|trapped|shark'}],['Erotic & noir',{k:'noir|seduct|affair|femme fatale|erotic'}]],
      'Crime':[['Heists',{k:'heist|robbery|bank job|steal|casino|thieves'}],['Mafia & gangsters',{k:'mafia|gangster|mob|cartel|crime family|godfather|syndicate|hitman'}],['Detectives & noir',{k:'detective|noir|investigat|private eye|inspector'}],['Prison stories',{k:'prison|inmate|penitentiary|jail|escape'}],['True crime documentaries',{g:['Documentary']}],['Serial killers',{k:'serial killer|murderer|killer|slasher'}],['Cops & undercover',{k:'cop|police|undercover|narcotics|precinct|officer|detective'}],['Crime comedies',{g:['Comedy']}],['Crime dramas',{g:['Drama']}]],
      'Romance':[['Romantic comedies',{g:['Comedy']}],['Period romance',{g:['History'],k:'century|regency|victorian|1800s|kingdom|aristocrat'}],['Tearjerkers',{g:['Drama'],k:'illness|dying|cancer|grief|loss|memory|goodbye'}],['Holiday romance',{k:'christmas|holiday|snow|winter wedding'}],['Teen romance',{k:'high school|teen|first love|prom|college'}],['Romantic thrillers',{g:['Thriller','Mystery']}],['Musical romance',{g:['Music','Musical']}]],
      'Adventure':[['Family adventures',{g:['Family']}],['Fantasy quests',{g:['Fantasy'],k:'quest|kingdom|dragon|sword|magic'}],['Action adventures',{g:['Action']}],['Animated adventures',{g:['Animation']}],['Treasure & expeditions',{k:'treasure|expedition|jungle|lost city|explorer|island|voyage|pirate'}],['Survival',{k:'survive|survival|stranded|wilderness'}],['Sci-fi adventures',{g:['Science Fiction']}]],
      'Family':[['Animated',{g:['Animation']}],['Family adventures',{g:['Adventure']}],['Holiday favourites',{k:'christmas|holiday|santa|halloween|easter'}],['Animals & pets',{k:'dog|puppy|cat|horse|animal|pet|dolphin'}],['Family comedies',{g:['Comedy']}],['Fantasy & magic',{g:['Fantasy']}],['Sports & underdogs',{k:'team|coach|championship|soccer|football|baseball|basketball'}]],
      'Animation':[['Family animation',{g:['Family']}],['Anime',{k:'anime|japan|tokyo|manga|studio ghibli'}],['Animated comedies',{g:['Comedy'],x:['Family']}],['Superheroes',{k:'superhero|batman|spider|marvel|justice league|dc'}],['Fantasy & adventure',{g:['Fantasy','Adventure']}],['Animated sci-fi',{g:['Science Fiction']}]],
      'Fantasy':[['Epic & sword-and-sorcery',{k:'kingdom|sword|dragon|wizard|quest|realm|throne|warrior'}],['Fairy tales',{k:'fairy|princess|tale|once upon|enchanted'}],['Magic & witches',{k:'witch|magic|sorcer|spell|wizard'}],['Superheroes',{k:'superhero|marvel|comic'}],['Animated fantasy',{g:['Animation']}],['Family fantasy',{g:['Family']}],['Dark fantasy',{g:['Horror','Thriller']}]],
      'Mystery':[['Whodunits & detectives',{k:'whodunit|detective|investigat|inspector|sleuth|clue|murder'}],['Supernatural mysteries',{g:['Horror','Fantasy'],k:'ghost|haunt|supernatural'}],['Crime mysteries',{g:['Crime']}],['Psychological',{g:['Thriller'],k:'psycholog|memory|amnesia|obsess'}],['Sci-fi mysteries',{g:['Science Fiction']}]],
      'History':[['Ancient worlds',{k:'rome|roman|greek|egypt|pharaoh|gladiator|spartan|ancient'}],['Medieval & knights',{k:'medieval|knight|crusade|viking|castle|middle ages'}],['Kings, queens & royalty',{k:'queen|king|royal|throne|monarch|palace|prince'}],['Wars & revolutions',{g:['War'],k:'war|revolution|battle'}],['20th century',{k:'19[0-9]0s|world war|cold war|1960s|1970s|1980s'}],['Biopics',{k:'true story|biography|life of|biopic'}]],
      'War':[['World War II',{k:'wwii|world war ii|world war 2|nazi|hitler|1944|1945|normandy|d-day|pearl harbor|holocaust'}],['Vietnam',{k:'vietnam|saigon|viet cong'}],['Modern conflicts',{k:'iraq|afghanistan|marine|navy seal|special forces|kabul|baghdad|taliban'}],['World War I & earlier',{k:'world war i|1914|1917|1918|trench|civil war|napoleon|revolution'}],['War dramas',{g:['Drama']}],['War action',{g:['Action']}]],
      'Western':[['Classic westerns',{y:[1900,1979]}],['Modern westerns',{y:[1990,2030]}],['Outlaws & gunslingers',{k:'outlaw|bandit|gunslinger|bounty|sheriff|posse|gang'}],['Frontier & cattle',{k:'frontier|ranch|cattle|homestead|pioneer|trail'}]],
      'Music':[['Concerts & live',{g:['Concerts','Concert'],k:'concert|live at|live from|tour'}],['Music biopics',{k:'life of|biography|true story|rise of|the story of'}],['Musicals',{g:['Musical'],k:'musical|broadway|sing|dance'}],['Music documentaries',{g:['Documentary']}],['Music dramas',{g:['Drama']}]]
    },
    tv:{
      'Documentary':[['True crime',{g:['Crime'],k:'murder|killer|homicide|serial killer|cold case|true crime|manhunt|convicted|unsolved|victims|detective'}],['Nature & wildlife',{k:'nature|wildlife|planet|animal|ocean|predator|earth|species'}],['History',{k:'history|war|empire|ancient|century|historical'}],['Science & space',{k:'space|science|universe|cosmos|nasa|physics|technology|engineering'}],['Sports',{k:'football|basketball|baseball|soccer|nfl|nba|racing|formula|athlete|boxing|wrestl|golf|hockey|olympic'}],['Music & culture',{k:'music|band|album|hip-hop|rock|artist|culture'}],['Food & travel',{k:'food|chef|cooking|restaurant|travel|journey|road'}],['Paranormal, UFOs & mysteries',{k:'ufo|paranormal|ghost|alien|unexplained|mystery|haunted|bigfoot|conspiracy'}],['Politics & society',{g:['War & Politics','News'],k:'politic|president|election|justice|society|activist|scandal'}],['Scams & scandals',{k:'fraud|scam|ponzi|scandal|con artist|cult|corruption'}],['Docuseries about people',{k:'life of|family|behind the scenes|intimate|portrait|celebrity'}]],
      'Reality':[['Competitions',{k:'competition|compete|contest|challenge|race|win|prize|elimination'}],['Dating & relationships',{k:'dating|love|bachelor|couple|marriage|single|romance|wedding'}],['Cooking & food',{k:'cook|chef|kitchen|food|bake|restaurant|recipe'}],['Home & renovation',{k:'renovat|home|house|property|design|flip|estate'}],['Celebrities & families',{k:'celebrit|family|housewives|kardashian|famous|lifestyle'}],['Survival & adventure',{k:'survival|wild|alone|island|expedition|outdoor|treasure'}],['Talent, music & dance',{k:'talent|sing|dance|idol|voice|performance|band'}],['Business & makeovers',{k:'business|makeover|shark|pitch|deal|restore|garage|auction'}],['True crime reality',{g:['Crime','Documentary']}]],
      'Comedy':[['Sitcoms',{k:'sitcom|roommates|neighbors|apartment|workplace|office|family|friends'}],['Animated comedies',{g:['Animation']}],['Sketch, satire & late night',{g:['Talk'],k:'sketch|satire|late night|talk show|parody|improv'}],['Dramedies',{g:['Drama']}],['Teen & coming of age',{k:'high school|teen|college|coming of age'}],['Family comedies',{g:['Family','Kids']}],['Romantic comedies',{g:['Romance'],k:'romance|love|dating'}],['British comedies',{k:'british|london|england|bbc|uk '}],['Comedy classics',{y:[1900,1999]}]],
      'Crime':[['Detectives & procedurals',{k:'detective|police|investigat|procedural|homicide|precinct|forensic|inspector'}],['True crime docuseries',{g:['Documentary']}],['Gangs, mafia & cartels',{k:'mafia|gangster|cartel|mob|gang|drug|narco'}],['Legal dramas',{k:'lawyer|law|court|attorney|trial|prosecut'}],['Spies & thrillers',{k:'spy|espionage|agent|terror|conspiracy'}],['Crime comedies',{g:['Comedy']}],['Prison & undercover',{k:'prison|undercover|inmate'}],['British crime',{k:'british|london|scotland|bbc|england|itv'}]],
      'Drama':[['Crime dramas',{g:['Crime']}],['Period dramas',{k:'century|victorian|regency|1800s|1900s|1920s|1950s|1960s|kingdom|royal|dynasty|historical'}],['Medical dramas',{k:'hospital|doctor|medical|nurse|surgeon|paramedic'}],['Legal & political',{g:['War & Politics'],k:'lawyer|law|court|politic|senator|president|white house'}],['Family sagas',{g:['Family'],k:'family|generations|sisters|brothers|dynasty'}],['Teen dramas',{k:'high school|teen|college|coming of age'}],['Soaps',{g:['Soap']}],['Sci-fi & fantasy dramas',{g:['Sci-Fi & Fantasy']}],['Mysteries',{g:['Mystery']}],['Based on true stories',{k:'true story|based on|real events|biograph|scandal'}],['British dramas',{k:'british|london|england|bbc|itv|scotland|wales'}]],
      'Kids':[['Preschool',{k:'preschool|toddler|little|learn|abc|numbers|sing'}],['Cartoons',{g:['Animation']}],['Live-action & family',{g:['Family'],x:['Animation']}],['Educational & discovery',{k:'learn|science|explore|discover|education|nature'}],['Adventures & heroes',{k:'adventure|hero|rescue|superhero|quest'}]],
      'Family':[['Cartoons & animation',{g:['Animation']}],['Kids shows',{g:['Kids']}],['Family comedies',{g:['Comedy']}],['Family dramas',{g:['Drama']}],['Adventure & fantasy',{g:['Sci-Fi & Fantasy','Action & Adventure']}]],
      'Animation':[['Anime',{k:'anime|japan|tokyo|manga|shonen|isekai'}],['Kids cartoons',{g:['Kids','Family']}],['Adult animation',{g:['Comedy'],x:['Kids','Family']}],['Superheroes',{k:'superhero|batman|spider|marvel|justice league|dc'}],['Sci-fi & fantasy animation',{g:['Sci-Fi & Fantasy']}]],
      'Sci-Fi & Fantasy':[['Space & aliens',{k:'space|galaxy|starship|planet|alien|astronaut'}],['Superheroes',{k:'superhero|marvel|dc|comic|mutant|powers'}],['Supernatural & horror',{k:'vampire|werewolf|ghost|demon|supernatural|witch|zombie'}],['Dystopias & apocalypse',{k:'dystopia|apocalyp|post-apocalyptic|survivors|virus'}],['Epic fantasy',{k:'kingdom|dragon|sword|magic|realm|throne|quest'}],['Time travel & mysteries',{k:'time travel|timeline|parallel|mystery|conspiracy'}],['Animated sci-fi & fantasy',{g:['Animation']}]],
      'Action & Adventure':[['Superheroes',{k:'superhero|marvel|dc|comic|mutant'}],['Spies & agents',{k:'spy|agent|espionage|cia|undercover'}],['Military & tactical',{k:'military|soldier|navy|seal|special forces|war'}],['Survival & wilderness',{k:'survival|wilderness|island|stranded|apocalyp'}],['Sci-fi action',{g:['Sci-Fi & Fantasy']}],['Crime action',{g:['Crime']}],['Animated action',{g:['Animation']}]],
      'Mystery':[['Detective mysteries',{k:'detective|investigat|inspector|whodunit|clue|solve'}],['Supernatural mysteries',{g:['Sci-Fi & Fantasy'],k:'supernatural|ghost|paranormal'}],['Crime mysteries',{g:['Crime']}],['Psychological',{k:'psycholog|memory|secret|missing|disappear'}],['British mysteries',{k:'british|london|england|bbc|itv|village'}]],
      'War & Politics':[['Political dramas',{k:'politic|president|white house|senator|election|prime minister'}],['War',{k:'war|soldier|battle|military|nazi|resistance'}],['Spy thrillers',{k:'spy|espionage|agent|cia|kgb'}],['Docuseries',{g:['Documentary']}]]
    }
  };
  const norm=s=>String(s||'').toLowerCase();
  // Sept 27: subgenres for genres that had none.
  SUB.movies['TV Movie']=[['Holiday & Christmas',{k:'christmas|holiday|santa|hallmark|snow|reindeer|mistletoe'}],['Romances',{g:['Romance']}],['Thrillers & mysteries',{g:['Thriller','Mystery']}],['Family',{g:['Family']}],['Animated',{g:['Animation']}],['Based on true stories',{k:'true story|based on the true|based on a true|real-life|biopic|inspired by true'}],['Documentaries',{g:['Documentary']}]];
  SUB.tv['Western']=[['Classic westerns',{y:[1900,1989]}],['Modern westerns',{y:[1990,2100]}],['Drama',{g:['Drama']}]];
  SUB.tv['Talk']=[['Late night',{k:'late night|tonight|late show|talk show|monologue'}],['Comedy',{g:['Comedy']}],['News & politics',{g:['News','War & Politics'],k:'news|politic|election|daily'}]];
  SUB.tv['Soap']=[['Drama',{g:['Drama']}],['Romance',{k:'love|romance|affair|marriage|wedding'}],['Family sagas',{g:['Family'],k:'family|dynasty|generations|heir|empire'}]];
  function matchRule(item,rule){
    const genres=(item.Genres||[]).map(norm);
    if(rule.x&&rule.x.some(g=>genres.includes(norm(g))))return false;
    let ok=false;
    if(rule.g&&rule.g.some(g=>genres.includes(norm(g))))ok=true;
    if(!ok&&rule.k){const title=norm(item.Name),overview=norm(item.Overview),terms=rule.k.split('|').filter(Boolean);if(terms.some(term=>new RegExp(term,'i').test(title))||terms.filter(term=>new RegExp(term,'i').test(overview)).length>=2)ok=true;}
    if(!ok&&rule.y){const y=item.ProductionYear||0;if(y>=rule.y[0]&&y<=rule.y[1])ok=true;}
    return ok;
  }
  const POOL=new Map();
  const poolKey=(user,mode,genre,parent)=>[user,mode==='tv'?'Series':'Movie',parent||'',genre].join('|');
  async function genreSample(api,user,mode,genre){
    const parent=route().q.get('topParentId')||'',type=mode==='tv'?'Series':'Movie';
    const q={IncludeItemTypes:type,Recursive:true,...(parent?{ParentId:parent}:{}),Genres:genre,Fields:'Genres,Overview,ProductionYear,OfficialRating,CommunityRating,ProviderIds,DateCreated,Path,Tags',ImageTypeLimit:1,EnableImageTypes:'Primary,Backdrop,Thumb'};
    const [top,recent]=await Promise.all([api.getItems(user,{...q,SortBy:'CommunityRating,SortName',SortOrder:'Descending',Limit:400,EnableTotalRecordCount:true,StartIndex:await OrbitalRating.offset(api,user,{...q,SortBy:'CommunityRating,SortName',SortOrder:'Descending'})}),
      api.getItems(user,{...q,SortBy:'DateCreated',SortOrder:'Descending',Limit:60,EnableTotalRecordCount:false})]);
    if(api.getCurrentUserId()!==user)throw new Error('Account changed');
    const seen=new Set(),raw=[];for(const i of [...(top.Items||[]),...(recent.Items||[])])if(!seen.has(i.Id)){seen.add(i.Id);raw.push(i);}
    return {items:unique(raw).sort((x,y)=>OrbitalRating.value(y)-OrbitalRating.value(x)),total:top.TotalRecordCount??raw.length};
  }
  async function genrePool(api,user,mode,genre){
    const parent=route().q.get('topParentId')||'',type=mode==='tv'?'Series':'Movie',key=poolKey(user,mode,genre,parent),hit=POOL.get(key);
    if(hit&&Date.now()-hit.time<600000)return hit.items;
    const raw=[],seen=new Set();let start=0,total=1;
    while(start<total){
      const r=await api.getItems(user,{IncludeItemTypes:type,Recursive:true,...(parent?{ParentId:parent}:{}),Genres:genre,Fields:'Genres,Overview,ProductionYear,OfficialRating,CommunityRating,ProviderIds,DateCreated,Path,Tags',ImageTypeLimit:1,EnableImageTypes:'Primary,Backdrop,Thumb',SortBy:'SortName',SortOrder:'Ascending',StartIndex:start,Limit:500,EnableTotalRecordCount:true});
      if(api.getCurrentUserId()!==user||route().q.get('topParentId')!== (parent||null))throw new Error('Library changed');
      const page=r.Items;if(!Array.isArray(page))throw new Error('Invalid catalog');
      total=r.TotalRecordCount??page.length;
      if(!page.length&&start<total)throw new Error('Incomplete catalog');
      for(const item of page){if(seen.has(item.Id))throw new Error('Catalog changed while paging');seen.add(item.Id);raw.push(item);}
      start+=page.length;if(!page.length)break;
      if(start>50000)throw new Error('Catalog exceeds bounded client inventory');
    }
    const items=unique(raw).sort((a,b)=>OrbitalRating.value(b)-OrbitalRating.value(a));
    POOL.set(key,{time:Date.now(),items,total:items.length});if(POOL.size>12)POOL.delete(POOL.keys().next().value);return items;
  }
  function subcategories(mode,genre,pool){
    const rules=(SUB[mode==='tv'?'tv':'movies']||{})[genre]||[];const out=[];
    for(const [name,rule] of rules){const items=pool.filter(i=>matchRule(i,rule));if(items.length>=6)out.push({name,items});}
    return out;
  }
  const shuffle=items=>items.slice().sort((a,b)=>OrbitalRating.value(b)-OrbitalRating.value(a)||Date.parse(b.DateCreated||0)-Date.parse(a.DateCreated||0)||clean(a.SortName||a.Name).localeCompare(clean(b.SortName||b.Name)));
  async function renderCategory(api,user,mode,genre,host,key){
    const root=node('div','ob5-browse ob5-category');root.dataset.mode=mode;root.dataset.key=key;browsePhase(root,'loading',api,user);root.dataset.loaded=String(Date.now());
    const h=node('div','ob5-page-heading');h.append(node('h1','',genre));
    const back=a('← '+(mode==='tv'?'TV Shows':'Movies'),'#/'+(mode==='tv'?'tv':'movies')+'?'+(()=>{const q=route().q;q.delete('orbitalBrowse');return q;})(),'ob5-button');h.append(back);root.append(h);
    const status=node('p','ob5-filter-status','Loading '+genre+'…');status.setAttribute('role','status');root.append(status);
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);if(focus?.isConnected&&root.contains(focus))focus.focus({preventScroll:true});host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');
    // Sept 27: draw from a fast two-query sample (top rated + newest) when the full genre is not cached (Comedy was
    // ~12 sequential 500-item requests, a 2.5 s gate); the full pool loads behind and adds any missing collection chips.
    let pool,sampleTotal=null;const cachedPool=POOL.get(poolKey(user,mode,genre,route().q.get('topParentId')||''));
    try{if(cachedPool&&Date.now()-cachedPool.time<600000)pool=cachedPool.items;else{const sample=await genreSample(api,user,mode,genre);pool=sample.items;sampleTotal=sample.total;}}
    catch{browsePhase(root,'error',api,user);status.textContent='This category could not be loaded. The native library remains available.';return true;}
    if(!root.isConnected)return true;
    const total=sampleTotal??(cachedPool?.total||pool.length);
    const subs=subcategories(mode,genre,pool);
    status.textContent=`${total.toLocaleString()} title${total===1?'':'s'}`+(subs.length?` · ${subs.length} collections`:'');
    const chips=node('div','ob5-chip-row ob5-sub-chips');
    for(const s of subs){const c=a(s.name,filterHref(mode,'genre:'+genre+':sub:'+encodeURIComponent(s.name)),'ob5-chip');chips.append(c);}
    chips.append(a('All A–Z',filterHref(mode,'genre:'+genre+':all'),'ob5-chip ob5-chip-all'));root.append(chipGroup('Collections',chips));
    if(sampleTotal!=null)genrePool(api,user,mode,genre).then(all=>{if(!root.isConnected||api.getCurrentUserId()!==user||chips.contains(document.activeElement))return;
      const more=subcategories(mode,genre,all),known=new Set(subs.map(s=>s.name)),exact=all.length,count=Math.max(more.length,subs.length);
      for(const s of more)if(!known.has(s.name))chips.insertBefore(a(s.name,filterHref(mode,'genre:'+genre+':sub:'+encodeURIComponent(s.name)),'ob5-chip'),chips.lastChild);
      status.textContent=`${exact.toLocaleString()} title${exact===1?'':'s'}`+(count?` · ${count} collections`:'');}).catch(()=>{});
    const featured=shuffle(pool.filter(i=>i.BackdropImageTags?.length&&OrbitalRating.value(i)>=6.5)).slice(0,5);
    const f=feature(api,featured,mode);if(f)root.append(f);
    const append=n=>{if(n)root.append(n);};
    append(shelf(api,'Top rated '+genre.toLowerCase(),pool.slice(0,18),{href:filterHref(mode,'genre:'+genre+':all')}));
    const recent=pool.slice().sort((x,y)=>Date.parse(y.DateCreated||0)-Date.parse(x.DateCreated||0)).slice(0,18);
    append(shelf(api,'Recently added',recent));
    for(const s of subs)append(shelf(api,s.name,shuffle(s.items.slice(0,60)).slice(0,18),{href:filterHref(mode,'genre:'+genre+':sub:'+encodeURIComponent(s.name))}));
    const unplayed=pool.filter(i=>!i.UserData?.Played);if(unplayed.length>=6)append(shelf(api,'Haven’t watched yet',shuffle(unplayed.slice(0,120)).slice(0,18)));
    for(const [name,from,to] of [['2020s',2020,2030],['2010s',2010,2019],['2000s',2000,2009],['1990s',1990,1999]]){const d=pool.filter(i=>i.ProductionYear>=from&&i.ProductionYear<=to);if(d.length>=6)append(shelf(api,genre+' from the '+name,shuffle(d.slice(0,120)).slice(0,18),{href:filterHref(mode,'genre:'+genre+':years:'+from+'-'+to)}));}
    root.append(a('Browse all '+genre+' A–Z',filterHref(mode,'genre:'+genre+':all'),'ob5-button ob5-load-more'));
    browsePhase(root,'complete',api,user);restoreBrowsePosition(root);return true;
  }
  async function renderPoolGrid(api,user,mode,genre,title,pick,host,key){
    const root=node('div','ob5-browse ob5-filter');root.dataset.mode=mode;root.dataset.key=key;browsePhase(root,'loading',api,user);root.dataset.loaded=String(Date.now());
    const h=node('div','ob5-page-heading');h.append(node('h1','',title));h.append(a('← '+genre,filterHref(mode,'genre:'+genre),'ob5-button'));root.append(h);
    const status=node('p','ob5-filter-status','Loading…');status.setAttribute('role','status');root.append(status);const grid=node('div','ob5-grid');root.append(grid);
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);if(focus?.isConnected&&root.contains(focus))focus.focus({preventScroll:true});host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');
    let pool;try{pool=await genrePool(api,user,mode,genre);}catch{browsePhase(root,'error',api,user);status.textContent='This list could not be loaded.';return true;}
    if(!root.isConnected)return true;
    const items=pick(pool).sort((x,y)=>String(x.SortName||x.Name).localeCompare(String(y.SortName||y.Name)));let start=0;const PAGE=60,countKey=filterReturnKey(api,user,key);
    const more=button('Load more',()=>page(),'ob5-button ob5-load-more');root.append(more);
    function page(){const slice=items.slice(start,start+PAGE);for(const item of slice)grid.append(card(api,item));start+=slice.length;poolGridCounts.delete(countKey);poolGridCounts.set(countKey,start);if(poolGridCounts.size>16)poolGridCounts.delete(poolGridCounts.keys().next().value);status.textContent=items.length?(start<items.length?`Showing ${start} of ${items.length}`:`${items.length} title${items.length===1?'':'s'}`):'Nothing here yet.';more.hidden=start>=items.length;}
    const want=Math.min(poolGridCounts.get(countKey)||PAGE,FILTER_CARDS_MAX);do page();while(start<want&&start<items.length);browsePhase(root,'complete',api,user);restoreBrowsePosition(root);return true;
  }
  const poolGridCounts=new Map();
  const browsePositions=new Map();let restoreHash=null;
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('.ob5-browse a[href]');if(!target)return;
    const parents=[];let parent=target.parentElement;while(parent){if(parent.scrollHeight>parent.clientHeight+2||parent.scrollWidth>parent.clientWidth+2)parents.push({id:parent.id,cls:parent.className,top:parent.scrollTop,left:parent.scrollLeft});parent=parent.parentElement;}
    browsePositions.set(location.hash,{user:S.user,href:target.getAttribute('href'),shelf:target.closest('.ob5-shelf')?.getAttribute('aria-label'),offset:target.getBoundingClientRect().top,top:scrollY,parents});
  },true);
  window.addEventListener('hashchange',event=>{const previous=new URL(event.oldURL).hash;if(browsePositions.has(location.hash))restoreHash=location.hash;});
  function restoreBrowsePosition(root){
    if(restoreHash!==location.hash)return;const saved=browsePositions.get(restoreHash);if(!saved||saved.user!==S.user)return;
    const hash=restoreHash;requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(location.hash!==hash||!root.isConnected)return;
      const target=[...root.querySelectorAll('a[href]')].find(n=>n.getAttribute('href')===saved.href&&(!saved.shelf||n.closest('.ob5-shelf')?.getAttribute('aria-label')===saved.shelf));
      target?.focus({preventScroll:true});for(const entry of saved.parents){let n=entry.id?document.getElementById(entry.id):[...root.querySelectorAll('*'),root,...document.querySelectorAll('.mainAnimatedPages,.skinBody')].find(n=>n.className===entry.cls);if(n){n.scrollTop=entry.top;n.scrollLeft=entry.left;}}
      window.scrollTo({top:saved.top,behavior:'instant'});restoreHash=null;
      let cancelled=false;const cancel=()=>cancelled=true;window.addEventListener('wheel',cancel,{once:true,passive:true});window.addEventListener('touchstart',cancel,{once:true,passive:true});window.addEventListener('keydown',cancel,{once:true});
      const align=()=>{if(cancelled||location.hash!==hash||!target?.isConnected)return;const delta=target.getBoundingClientRect().top-saved.offset;if(Math.abs(delta)>1){let scroller=target.parentElement;while(scroller&&!(scroller.scrollHeight>scroller.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;if(scroller&&scroller!==document.body&&scroller!==document.documentElement)scroller.scrollTop+=delta;else window.scrollBy({top:delta,behavior:'instant'});}};
      align();setTimeout(align,250);setTimeout(align,700);setTimeout(()=>{align();window.removeEventListener('wheel',cancel);window.removeEventListener('touchstart',cancel);window.removeEventListener('keydown',cancel);},1200);
    }));
  }
  // Editing a discovery view replaces it; shelf/grid/detail links create destinations.
  let dfPendingFocus=null;
  function dfFocusSelector(active=document.activeElement){
    if(active?.dataset.filter)return '[data-filter="'+active.dataset.filter+'"]';
    if(active?.dataset.contentType)return '[data-content-type="'+active.dataset.contentType+'"]';
    if(active?.dataset.availability)return '[data-availability="'+active.dataset.availability+'"]';
    if(active?.matches('.df-option-search'))return '.df-toolbar .df-option-search';
    if(active?.matches('.df-sort'))return '.df-sort';
    return '[data-filter="genre"]';
  }
  function dfReplace(href,selector=dfFocusSelector()){
    if(href===location.hash)return;
    const api=window.ApiClient;dfPendingFocus={href,selector,identity:api?.serverId?.()+'|'+api?.getCurrentUserId?.()};
    const current=new URLSearchParams(location.hash.split('?')[1]||'').get('orbitalBrowse')||'';
    if(/^(provider:|discover\?|genre:|decade:|sort:)/.test(current)){document.documentElement.classList.add('orbital-editing');location.replace(href);}else location.hash=href;
  }
  function dfRestoreFocus(root,api){
    const held=dfPendingFocus;if(!held)return;
    if(held.href!==location.hash||held.identity!==api.serverId?.()+'|'+api.getCurrentUserId?.()){dfPendingFocus=null;return;}
    const target=root.querySelector(held.selector)||root.querySelector('[data-filter="genre"],button,a[href]');
    if(!target)return;target.focus({preventScroll:true});
    if(target.matches('input'))target.setSelectionRange?.(target.value.length,target.value.length);
    dfPendingFocus=null;
  }
  function dfEditLink(link){link.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();dfReplace(link.getAttribute('href'));});return link;}
  function renderServices(api,user,host,key){
    const root=node('div','ob5-browse df-services');root.dataset.key=key;root.dataset.mode='services';
    root.dataset.loaded='true';root.dataset.complete='true';browsePhase(root,'complete',api,user);
    const heading=node('div','df-heading');heading.append(node('h1','','Explore services'));root.append(heading,node('p','df-status','Choose a catalogue, then browse the titles in your library or explore listings outside it.'));
    const row=servicesRow();row.querySelector('.ob5-shelf-head')?.remove();row.querySelector('.ob5-strip').classList.add('df-services-grid');root.append(row);
    root.append(node('p','df-hint','Service listings describe a catalogue. Titles in your library use your existing Jellyfin access; external listings do not promise playback or subscription availability.'));
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');
    restoreBrowsePosition(root);finishBrowseTransition();return true;
  }

  const SERVICES=[['apple-tv','Apple TV+'],['netflix','Netflix'],['disney-plus','Disney+'],['hulu','Hulu'],['max','HBO Max'],['prime-video','Prime Video'],['peacock','Peacock'],['paramount-plus','Paramount+']];
  function servicesRow(){
    const section=node('section','ob5-shelf');section.setAttribute('aria-label','Explore services');
    const head=node('div','ob5-shelf-head');head.append(node('h2','','Explore services'),a('All services','#/movies?orbitalBrowse=services','df-view-all'));section.append(head);
    const strip=node('div','ob5-strip');for(const [id,name] of SERVICES){
      const tile=a('','#/movies?orbitalBrowse=provider:'+id,'ob5-service-card');tile.setAttribute('aria-label',name);tile.dataset.service=id;
      // A touch/hover/focus makes sure this service's first screen is ready before the tap lands.
      const warm=()=>{const api=window.ApiClient,user=api?.getCurrentUserId?.();if(user)svcFirst(api,user,id).catch(()=>{});};
      for(const type of ['pointerdown','touchstart','focus','mouseenter'])tile.addEventListener(type,warm,{passive:true});
      const image=node('img','ob5-service-logo');image.alt=name;image.src=(window.OrbitalAsset||'/web/orbital/')+'service-art-29/'+id+(['netflix','hulu','max','paramount-plus'].includes(id)?'.svg':'.png');
      image.addEventListener('error',()=>{image.remove();tile.textContent=name;},{once:true});tile.append(image);strip.append(tile);
    }section.append(strip);svcPrefetchAll(section);return section;
  }
  /* Sept 27, 2026 (Claude, the owner: service buttons should open nearly instantly). Opening a service used to
   * download that service's whole catalogue (0.6-7.8 MB gzip, Prime Video 26 MB JSON) and parse it before drawing.
   * Now the first screen comes from sports/api/catalogue?view=first (a few KB: counts, genres, the default grid and
   * hero), prefetched for all eight services while Home is idle and kept on the device for the next launch, so a tap
   * draws at once. The full list (view=lite: same entries without fields the page never reads) loads ~1 s later and
   * takes over seamlessly; filters, search and Load more wait for it only if used first. */
  const SVC=new Map(),SVC_STORE='orbital-svc-discovery-all-v2:',SVC_FIRST_FRESH=120e3,SVC_FIRST_KEEP=6*3600e3,SVC_FULL_KEEP=10*60e3,SVC_FULL_MAX=2;
  const svcKey=(api,user,id)=>(api.serverId?.()||api.serverInfo?.()?.Id||'')+'|'+user+'|'+id;
  const svcSeed=user=>[...new Date().toLocaleDateString('en-CA')+'|'+user+'|movies'].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  function svcEntry(api,user,id){const k=svcKey(api,user,id);let e=SVC.get(k);
    if(!e){e={key:k};SVC.set(k,e);try{const s=JSON.parse(localStorage.getItem(SVC_STORE+k)||'null');if(s&&s.data?.view==='discover'&&Date.now()-s.at<SVC_FIRST_KEEP){e.first=s.data;e.firstAt=s.at;}}catch{}}
    return e;}
  function svcFirst(api,user,id,force=false){const e=svcEntry(api,user,id);
    if(!force&&e.first&&Date.now()-e.firstAt<SVC_FIRST_KEEP){if(Date.now()-e.firstAt>=SVC_FIRST_FRESH&&!e.firstP)svcFirst(api,user,id,true).catch(()=>{});return Promise.resolve(e.first);}if(e.firstP)return e.firstP;
    const p=fetchJson(api,'sports/api/catalogue',{provider:id,view:'discover',type:'All',scope:'library',sort:'rated'}).then(d=>{
      if(d?.view!=='discover'||!Array.isArray(d.rows))throw new Error('first view unavailable');
      if(api.getCurrentUserId()===user){e.first=d;e.firstAt=Date.now();try{localStorage.setItem(SVC_STORE+e.key,JSON.stringify({at:e.firstAt,data:d}));}catch{}}return d;
    }).finally(()=>{if(e.firstP===p)e.firstP=null;});
    e.firstP=p;return p;}
  function svcFull(api,user,id){const e=svcEntry(api,user,id);
    if(e.full&&Date.now()-e.fullAt<SVC_FULL_KEEP)return Promise.resolve(e.full);if(e.fullP)return e.fullP;
    const p=fetchJson(api,'sports/api/catalogue',{provider:id,view:'lite'}).then(d=>{if(!Array.isArray(d?.entries))throw new Error('catalogue unavailable');
      e.full=d;e.fullAt=Date.now();
      // Bound memory: keep only the most recent full catalogues (Prime Video alone is tens of MB parsed).
      const held=[...SVC.values()].filter(x=>x.full).sort((a,b)=>b.fullAt-a.fullAt);for(const x of held.slice(SVC_FULL_MAX)){x.full=null;x.fullAt=0;}
      return d;}).finally(()=>{if(e.fullP===p)e.fullP=null;});
    e.fullP=p;return p;}
  let svcPrefetchTimer=0;
  function svcPrefetchAll(section){
    clearTimeout(svcPrefetchTimer);
    const api=window.ApiClient,user=api?.getCurrentUserId?.(),owner=S.serial,hash=location.hash;
    const serverIdentity=()=>api?.serverId?.()||api?.serverInfo?.()?.Id||'';
    const server=serverIdentity(),credential=api?.accessToken?.();
    if(!user||user===SIMPLE||navigator.connection?.saveData||!/^#\/home(?:[?&]|$)/.test(hash)||new URLSearchParams(hash.split('?')[1]||'').get('tab')==='1')return;
    const owned=()=>{
      const root=document.querySelector('#homeTab.is-active > .ob5-browse[data-mode="home"]');
      return !document.hidden&&!navigator.connection?.saveData&&window.ApiClient===api&&api.getCurrentUserId()===user&&serverIdentity()===server&&api.accessToken?.()===credential&&S.serial===owner&&location.hash===hash&&section?.isConnected&&root?.contains(section)&&root.dataset.phase==='complete'&&root.dataset.presentable!=='pending'&&![...document.querySelectorAll('video,audio')].some(media=>!media.paused&&!media.ended);
    };
    svcPrefetchTimer=setTimeout(async()=>{
      for(const [id] of SERVICES){
        if(!owned())return;
        const e=svcEntry(api,user,id);if(e.first&&Date.now()-e.firstAt<SVC_FIRST_FRESH)continue;
        try{await svcFirst(api,user,id,true);}catch{return;}
        if(!owned())return;
        await new Promise(resolve=>{if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(resolve,{timeout:400});else setTimeout(resolve,400);});
      }
    },2500);
  }
  const tmdbWatch=e=>'https://www.themoviedb.org/'+(e.type==='Movie'?'movie':'tv')+'/'+e.tmdb+'/watch?locale=US';
  const providerViews=new Map();
  // Shared service discovery: bounded rows/pages, URL state, no full-catalogue transfer.
  const serviceDiscoveryCache=new Map(),serviceGridCounts=new Map();
  const svcState=()=>({...dfDefaults(),type:'All',scope:'library',search:'',...Object.fromEntries(new URLSearchParams(route().q.get('obd')||''))});
  function svcHref(id,s){const q=route().q;q.set('orbitalBrowse','provider:'+id);q.set('obd',new URLSearchParams(Object.entries(s).filter(([k,v])=>v)).toString());return '#/movies?'+q;}
  function svcDiscover(api,user,id,s,force=false){
    const params={provider:id,view:'discover',...s},key=JSON.stringify([svcKey(api,user,id),params]),hit=serviceDiscoveryCache.get(key);
    if(!force&&hit&&Date.now()-hit.at<120000)return Promise.resolve(hit.data);
    return fetchJson(api,'sports/api/catalogue',params).then(data=>{if(data.view!=='discover')throw Error('Discovery unavailable');if(api.getCurrentUserId()===user){serviceDiscoveryCache.set(key,{at:Date.now(),data});while(serviceDiscoveryCache.size>24)serviceDiscoveryCache.delete(serviceDiscoveryCache.keys().next().value);}return data;});
  }
  function svcCard(api,e){
    if(e.item){const tile=card(api,e.item);if(!e.item.ImageTags?.Primary&&e.poster){const art=tile.querySelector('.ob5-art');art.replaceChildren(img('https://image.tmdb.org/t/p/w342'+e.poster,''));}return tile;}
    const tile=node('article','ob30-catalogue-card df-offer'),art=node('div','ob5-art');
    if(e.poster)art.append(img('https://image.tmdb.org/t/p/w342'+e.poster,''));else art.append(node('span','ob5-art-fallback',e.title));
    const actions=node('div','df-offer-actions'),source=a('Where to watch',e.source||tmdbWatch(e),'df-offer-link');source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('aria-label','Where to watch '+e.title);
    const request=requestLink('df-offer-link','Request','/'+(e.type==='Movie'?'movie':'tv')+'/'+e.tmdb);request.setAttribute('aria-label','Request '+e.title);actions.append(source,request);
    tile.append(art,node('h3','',e.title),node('p','df-offer-note',[e.year,e.type==='Movie'?'Movie':e.type==='Series'?'Series':null].filter(Boolean).join(' · ')||'Not in your library'),actions);return tile;
  }
  // Claude refinement: one header, one control band above the artwork, hero only on the untouched view, stable row heights.
  async function renderProvider(api,user,id,host,key){
    const service=SERVICES.find(s=>s[0]===id);if(!service)return false;
    const s=svcState(),mode=s.type==='Series'?'tv':'movies',root=node('div','ob5-browse ob5-provider df-service');root.dataset.key=key;browsePhase(root,'loading',api,user);root.dataset.mode=mode;root.dataset.provider=id;
    const initialHash=location.hash,countKey=svcKey(api,user,id)+'|'+initialHash,restoreSearch=document.activeElement?.matches('.df-service .df-option-search'),alive=()=>root.isConnected&&api.getCurrentUserId()===user&&location.hash===initialHash;
    const navigate=patch=>{dfReplace(svcHref(id,{...s,...patch}));};
    const refined=['genre','decade','watch','rating','favorite','sub','co','search'].some(k=>s[k]),browsing=!!(s.grid||s.sub||s.co);
    const heading=node('div','df-heading df-service-head'),titleBox=node('div','df-title-box'),status=node('p','df-status','Loading your selection…');status.setAttribute('role','status');
    titleBox.append(node('h1','',service[1]),status);if(browsing)titleBox.append(node('p','df-list-context',[s.sub||s.co||s.genre,FILTER_SORTS[s.sort]?.[0],s.type==='All'?'All titles':s.type==='Series'?'TV Shows':'Movies'].filter(Boolean).join(' · ')));heading.append(titleBox,a('All services','#/movies?orbitalBrowse=services','df-view-all'));root.append(heading);window.OrbitalPersonal?.saveControl(api,heading,mode,s,id);
    const segment=(label,items,current,go,attr)=>{const g=node('div','df-segment');g.setAttribute('role','group');g.setAttribute('aria-label',label);for(const [v,t] of items){const b=button(t,()=>{if(current!==v)go(v);},'df-seg');b.setAttribute('aria-pressed',String(current===v));if(attr)b.dataset[attr]=v;g.append(b);}return g;};
    const types=segment('Content type',[['All','All'],['Movie','Movies'],['Series','TV Shows']],s.type,v=>navigate({type:v}),'contentType');types.classList.add('df-type-switch');
    const scope=segment('Availability',[['library','In your library'],['service','Not in your library']],s.scope,v=>navigate({scope:v,watch:'',favorite:'',sub:'',co:'',grid:''}));scope.classList.add('df-service-scope');for(const b of scope.children)b.dataset.availability=b.textContent==='In your library'?'library':'service';
    const search=node('input','df-option-search');search.type='search';search.placeholder='Search '+service[1];search.setAttribute('aria-label',search.placeholder);search.value=s.search;let timer;
    search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(alive())navigate({search:search.value,grid:search.value?'1':''});},450);};
    const toolbar=node('div','df-toolbar');toolbar.append(types,scope,search);root.append(toolbar);
    let data;const open=(field,b)=>dfSheet(mode,s,field,b,{genres:data?.genres,onApply:d=>navigate(d),service:s.scope==='service'});
    const controls=node('div','df-service-controls'),sort=button('Sort: '+(FILTER_SORTS[s.sort]?.[0]||'Top rated'),()=>open('sort',sort),'df-dock-button df-sort');sort.setAttribute('aria-haspopup','dialog');
    controls.append(discoveryDock(mode,s,open),sort,a(browsing?'‹ Back to discovery':'All titles ›',svcHref(id,{...s,sub:'',co:'',grid:browsing?'':'1'}),'df-view-all df-all-titles'));root.append(controls);
    const active=node('div','df-active');
    for(const k of ['genre','decade','watch','rating','favorite','sub','co'])if(s[k])active.append(button((k==='favorite'?'My List':k==='rating'?'Rating '+s[k]+'+':k==='watch'?(s[k]==='no'?'Unwatched':'Watched'):k==='decade'?s[k].split('|').map(y=>DECADES.find(d=>String(d[1])===y)?.[0]||y).join(' + '):s[k].split('|').join(' + '))+' ×',()=>navigate({[k]:'',...(k==='genre'?{sub:'',co:'',grid:''}:{})}),'df-chip-remove'));
    if(active.childElementCount>1)active.append(button('Clear all',()=>navigate({...dfDefaults(),type:s.type,scope:s.scope,sort:s.sort,search:''}),'df-clear'));
    if(active.childElementCount)root.append(active);
    const heroHost=node('div','df-service-hero');root.append(heroHost);
    const content=node('div','df-content');root.append(content);
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');
    dfRestoreFocus(root,api);const skeleton=strip=>{strip.classList.add('df-row-loading');strip.replaceChildren(...Array.from({length:8},()=>node('div','df-skel')));strip.setAttribute('aria-busy','true');};
    async function load(){try{
      const defaults=s.scope==='library'&&s.type==='All'&&!refined&&!browsing&&s.sort==='rated';
      data=defaults?await svcFirst(api,user,id):await svcDiscover(api,user,id,s);
      if(!alive())return;content.replaceChildren();root.dataset.complete='true';root.dataset.loaded='true';root.dataset.resultCount=data.total;
      const noun=s.type==='All'?(data.total===1?'title':'titles'):mode==='tv'?(data.total===1?'show':'shows'):(data.total===1?'movie':'movies');
      status.textContent=data.total.toLocaleString()+' '+noun+(s.scope==='service'?' on '+service[1]+' not in your library yet':' in your library')+(data.stale?' · Saved listings':'')+(!data.current_claim&&s.scope==='service'?' · Availability unverified':'');
      if(data.hero?.length&&!refined&&!browsing){const hero=feature(api,data.hero,mode,(service[1]+' · In your library').toUpperCase());if(hero)heroHost.replaceChildren(hero);}
      dfRestoreFocus(root,api);const rows=(data.rows||[]).filter(r=>r.id==='new'||r.id==='rated'||r.count>=3),shown=rows.length?rows:(data.rows||[]);
      if(shown.length){root.dataset.layout='shelves';
        for(const row of shown){
          const section=node('section','ob5-shelf');section.setAttribute('aria-label',row.title);section.dataset.rowId=row.id;
          const head=node('div','ob5-shelf-head'),href=svcHref(id,{...s,...row.filters});head.append(a(row.title,href,'df-row-title'),a('View all · '+row.count.toLocaleString(),svcHref(id,{...s,...row.filters,grid:'1'}),'df-view-all'));section.append(head);
          const strip=node('div','ob5-strip');section.append(strip);content.append(section);
          const paint=entries=>{strip.classList.remove('df-row-loading');strip.removeAttribute('aria-busy');strip.replaceChildren(...entries.map(e=>svcCard(api,e)));if(!root.style.getPropertyValue('--df-strip-h')&&entries.length)requestAnimationFrame(()=>{const h=strip.offsetHeight;if(h>120)root.style.setProperty('--df-strip-h',h+'px');});restoreBrowsePosition(root);};
          if(row.entries.length)paint(row.entries);else {
            skeleton(strip);let pending=false;
            const fill=async()=>{if(pending||!alive())return;pending=true;try{const r=await svcDiscover(api,user,id,{...s,...row.filters,grid:'1',start:'0',limit:'12'});if(alive())paint(r.entries);}catch{pending=false;if(alive()){strip.classList.remove('df-row-loading');strip.replaceChildren(button('Retry '+row.title,()=>{skeleton(strip);fill();},'ob5-button df-row-retry'));}}};
            const observer=new IntersectionObserver(entries=>{if(!alive()){observer.disconnect();return;}if(entries.some(e=>e.isIntersecting)){observer.disconnect();fill();}},{rootMargin:'600px 0px'});observer.observe(section);
            window.addEventListener('hashchange',()=>observer.disconnect(),{once:true});
          }
        }
      }else {root.dataset.layout='grid';const grid=node('div','ob5-grid');content.append(grid);let start=0;
        const more=button('Load more',async()=>{more.disabled=true;try{const r=await svcDiscover(api,user,id,{...s,grid:'1',start:String(start)});if(alive())append(r.entries);}catch{more.textContent='Retry loading more';}finally{more.disabled=false;}},'ob5-button ob5-load-more');
        const want=serviceGridCounts.get(countKey)||60;
        const append=entries=>{grid.append(...entries.map(e=>svcCard(api,e)));start+=entries.length;serviceGridCounts.set(countKey,start);while(serviceGridCounts.size>16)serviceGridCounts.delete(serviceGridCounts.keys().next().value);more.hidden=start>=data.total;more.textContent='Load more · '+start.toLocaleString()+' of '+data.total.toLocaleString();};append(data.entries);content.append(more);
        while(start<want&&start<data.total&&alive()){const r=await svcDiscover(api,user,id,{...s,grid:'1',start:String(start)});if(!alive())return;if(!r.entries.length)break;append(r.entries);}
        if(!data.total){const empty=node('div','df-empty');empty.append(node('h2','','No matching titles'),node('p','','Remove a filter to explore more of this catalogue.'),dfEditLink(a('Reset filters',svcHref(id,{...s,...dfDefaults(),search:''}),'ob5-button ob5-primary')));content.append(empty);}
      }
      root.append(node('p','df-attribution','US availability · checked '+String(data.updated_at||'').slice(0,10)+' · TMDB / JustWatch. Availability varies by subscription and season.'));restoreBrowsePosition(root);if(restoreSearch){search.focus({preventScroll:true});search.setSelectionRange(search.value.length,search.value.length);}
    }catch{if(alive()){root.dataset.loaded='true';browsePhase(root,'error',api,user);status.textContent='This selection could not load. Your filters are kept.';dfRestoreFocus(root,api);content.replaceChildren(button('Retry',load,'ob5-button ob5-primary'));}}}
    // This loader outlives renderFilter. Release the route gate when its real
    // content (or retry state) is ready, rather than waiting for the timeout.
    load().finally(()=>{if(alive()){if(root.dataset.phase!=='error')browsePhase(root,'complete',api,user);finishBrowseTransition();window.OrbitalPhone?.end('service content ready');}});return true;
  }
  function discoveryDock(mode,s,open){const dock=node('div','df-dock');dock.setAttribute('aria-label','Filter this library');const labels={genre:s.genre.includes('|')?s.genre.split('|').length+' genres':s.genre||'All genres',decade:s.decade.includes('|')?s.decade.split('|').length+' decades':DECADES.find(d=>String(d[1])===s.decade)?.[0]||'Any decade',watch:s.watch?(s.watch==='no'?'Unwatched':'Watched'):'Watch status',more:(s.rating||s.favorite)?'Rating & My List · '+[s.rating&&s.rating+'+',s.favorite&&'My List'].filter(Boolean).join(', '):'Rating & My List'};for(const field of ['genre','decade','watch','more']){const b=button(labels[field],()=>open(field,b),'df-dock-button');b.dataset.filter=field;b.setAttribute('aria-haspopup','dialog');b.classList.toggle('is-selected',field==='more'?!!(s.rating||s.favorite):!!s[field]);if(field==='watch'&&s.scope==='service'){b.disabled=true;b.title='Watch status applies to titles in your library';}dock.append(b);}return dock;}

  function teamCorner(api,user){
    const section=node('section','ob5-shelf');section.setAttribute('aria-label','Your teams');section.append(node('h2','','Your teams'));
    const strip=node('div','ob5-strip');section.append(strip);
    const storage='home-teams-v1:'+user;
    const read=()=>{try{return JSON.parse(localStorage.getItem(storage)||'[]').slice(0,12);}catch{return [];}};
    /* Account teams live in memory; storage is only a cache (review v2 D04). */
    let revision=null,current=null;const teams=()=>current||read();
    const flag={get:k=>{try{return localStorage.getItem(k);}catch{return '1';}},set:k=>{try{localStorage.setItem(k,'1');}catch{}}};
    const syncStatus=node('small','ob5-team-sync','Checking account teams…');section.append(syncStatus);
    const migration='team-account-migrated:'+api.getUrl('sports/api/team-preferences')+':'+user;
    const request=body=>api.ajax({type:body?'POST':'GET',url:api.getUrl('sports/api/team-preferences'),dataType:'json',...(body?{contentType:'application/json',data:JSON.stringify(body)}:{})});
    const accept=data=>{if(api.getCurrentUserId()!==user||!Array.isArray(data?.teams))return false;revision=data.revision;current=data.teams.slice(0,12);try{localStorage.setItem(storage,JSON.stringify(current));}catch{}return true;};
    async function sync(){let data;try{data=await request();}catch{syncStatus.textContent=read().length?'Saved on this device · Sync unavailable':'Account teams unavailable · Retry later';return;}
      if(api.getCurrentUserId()!==user)return;
      if(!flag.get(migration)){const local=read();if(local.length){try{const merged=await request({revision:data.revision,teams:local,migration:true});if(api.getCurrentUserId()!==user)return;if(merged&&Array.isArray(merged.teams))data=merged;}catch{}}flag.set(migration);}
      if(accept(data)){paint();syncStatus.textContent='\u00a0';}
    }
    const paint=()=>{
      const fresh=node('div','');
      /* Sept 26: a followed team's live game (or one later today) surfaces in this row. */
      const soon=Date.now()+18*3600e3;
      const teamGame=team=>{const [league,id]=String(team.key||'').split('~');
        const mine=games.filter(e=>e.league===league&&(e.teams||[]).some(t=>String(t.espn_id)===id));
        return mine.find(e=>e.state==='live')||mine.filter(e=>e.state==='scheduled'&&Date.parse(e.start)>Date.now()-3600e3&&Date.parse(e.start)<soon).sort((x,y)=>Date.parse(x.start)-Date.parse(y.start))[0]||null;};
      const shown=new Set();
      for(const team of teams()){
        const game=teamGame(team);
        if(game?.state==='live'&&shown.has(game.id))continue;   /* both teams followed: one live card */
        if(game?.state==='live'&&window.OrbitalSportsCards&&window.TelevisionFeedUi){shown.add(game.id);
          const live=button('',e=>window.OrbitalSportsCards.open(game,api,e.currentTarget),'ob5-game-card ob5-team-live');
          live.dataset.refreshKey=game.league+'|'+game.id;live.setAttribute('aria-label',team.name+' live now: '+game.name);
          const feeds=window.TelevisionFeedUi.sources(game).filter(s=>!s.automatic).length;
          live.append(node('span','ob5-eyebrow','LIVE · '+window.TelevisionFeedUi.truth(game)),window.OrbitalSportsCards.teams(game),node('span','ob5-card-meta',game.stale?'Saved game data':feeds?'Watch · '+feeds+' feeds':'Game details'));
          fresh.append(live);continue;}   /* the live card stands in for the team card until the game ends */
        const card=a('','#/movies?orbitalBrowse='+encodeURIComponent('team:'+team.key),'ob5-team-card');
        const logo=team.logos?.find(u=>u.startsWith('https://a.espncdn.com/'));if(logo)card.append(img(logo,'ob5-team-logo',''));
        /* Sept 28: rank, record and the next game from the shared team context (fetched once, 10 min). */
        if(String(team.key||'').includes('~')&&teamDue(team.key))teamContext(api,team.key).then(()=>{if(section.isConnected)paint();},()=>{});
        const ctx=teamNow(team.key);if(ctx?.color)card.style.setProperty('--team-c','#'+ctx.color);
        const total=ctx?.record?.find(r=>r.type==='total')||ctx?.record?.[0];
        const facts=ctx?[ctx.rank?'#'+ctx.rank:'',total?.summary,ctx.standing].filter(Boolean).join(' · '):'';
        let meta='',when=false;
        if(game){when=true;meta=game.state==='live'?'Live now':'Today · '+new Date(game.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
        else if(ctx){const games=teamGames(ctx),next=teamNext(games),last=teamLast(games);
          if(next&&next.state==='live'){when=true;meta='Live now';}
          else if(next)meta='Next · '+(gRelDay(next)||gDate(next,{weekday:'short',month:'short',day:'numeric'}))+(next.time_tbd?'':' '+gTime(next))+' · '+gVs(next)+' '+gOpp(next);
          else if(last)meta='Last · '+(last.result||'')+' '+gScore(last)+' '+gVs(last)+' '+gOpp(last);}
        card.setAttribute('aria-label',[team.name,facts,meta].filter(Boolean).join('. '));
        card.append(node('strong','',ctx?.short||team.name));if(facts)card.append(node('span','ob5-team-record',facts));
        card.append(node('span',when?'ob5-team-when':'ob5-team-next',meta||(ctx?'Schedule · stats · news':'Loading team…')));fresh.append(card);
      }
      fresh.append(button(teams().length?'Edit teams':'Choose your teams',choose,'ob5-button'));window.OrbitalRefresh.reconcile(strip,fresh.children);
    };
    function choose(){
      const opener=document.activeElement,dialog=node('dialog','ob5-team-picker');
      dialog.style.cssText='box-sizing:border-box;background:#101b2c;color:white;border:1px solid #62758c;border-radius:18px;width:min(640px,calc(100vw - 32px));max-height:85vh;padding:24px';
      dialog.setAttribute('aria-label','Your Home teams');dialog.append(node('h2','','Your Home teams'),node('p','','Choose up to 12 teams. Shared with your account on web and Orbital TV.'));
      const league=node('select','ob5-button'),list=node('div',''),status=node('p','',''),search=node('input','ob5-button'),count=node('p','');search.type='search';search.placeholder='Find a team';search.setAttribute('aria-label','Find a team');search.oninput=()=>{for(const row of list.children)row.hidden=!row.textContent.toLowerCase().includes(search.value.toLowerCase());};list.style.cssText='max-height:45vh;overflow:auto';
      league.setAttribute('aria-label','League');for(const name of ['MLB','NFL','College football','NBA','WNBA','NHL']){const option=node('option','',name);option.value=name;league.append(option);}
      let chosen=teams().slice(),generation=0;const countSelected=()=>count.textContent=chosen.length+' of 12 teams selected';countSelected();
      const load=async()=>{const run=++generation;list.replaceChildren();status.textContent='Loading teams…';try{
        const data=await fetchJson(api,'sports/api/team-directory',{league:league.value});if(run!==generation||api.getCurrentUserId()!==user||!dialog.isConnected)return;
        status.textContent=data.stale?'Saved team directory':'Choose teams below';
        for(const team of data.teams){const label=node('label',''),check=node('input','');check.type='checkbox';check.checked=chosen.some(t=>t.key===team.key);label.style.cssText='display:flex;align-items:center;gap:14px;min-height:48px';check.style.cssText='width:24px;height:24px';
          check.onchange=()=>{if(check.checked){if(chosen.length>=12){check.checked=false;status.textContent='Choose up to 12 teams.';return;}chosen.push(team);}else chosen=chosen.filter(t=>t.key!==team.key);countSelected();};
          label.append(check,node('span','',team.name));list.append(label);}
      }catch{status.textContent='Teams are unavailable. Change the league to retry.';}};
      league.onchange=()=>{search.value='';load();};
      const close=()=>dialog.close();dialog.addEventListener('close',()=>{generation++;dialog.remove();opener?.focus();});
      dialog.append(league,search,count,status,list,button('Retry team directory',load,'ob5-button'),button('Cancel',close,'ob5-button'),button('Save',async()=>{if(api.getCurrentUserId()!==user){close();return;}if(revision===null){status.textContent='Account sync is unavailable. Retry when connected.';sync();return;}const saveButton=dialog.querySelector('button:last-child');saveButton.disabled=true;status.textContent='Saving to your account…';try{const data=await request({revision,teams:chosen});if(accept(data)){paint();syncStatus.textContent='';close();}}catch{status.textContent='Could not save. Choices may have changed on another device. Close and reopen to review account teams.';await sync();}finally{saveButton.disabled=false;}},'ob5-button'));
      document.body.append(dialog);dialog.showModal();load();
    }
    let games=[],gameTimer=null,loading=false;
    async function loadGames(force=false){
      if(api.getCurrentUserId()!==user||(gameTimer&&!section.isConnected)){clearInterval(gameTimer);document.removeEventListener('visibilitychange',resume);return;}
      if(document.hidden||loading)return;loading=true;
      try{const events=await window.OrbitalRefresh.events(api,force===true);if(api.getCurrentUserId()!==user||!section.isConnected)return;
        games=events.filter(e=>e.state==='live'||e.state==='scheduled');paint();await sync();
      }catch{games=games.map(e=>({...e,stale:true}));paint();syncStatus.textContent='Saved game information · Retrying automatically';}finally{loading=false;}
    }
    const resume=()=>{if(!document.hidden)loadGames(true);};document.addEventListener('visibilitychange',resume);
    paint();sync();queueMicrotask(loadGames);gameTimer=setInterval(loadGames,60000);return section;
  }
  // Sept 28 (Claude): team hub. Shared team context cache (Home card + team page); legacy-tolerant (old servers have no 'schedule').
  const TEAMCTX=new Map();
  // Last good team context survives reloads, scoped to its captured server/account.
  const TEAM_DISPLAY_AGE=86400000;
  const teamScope=(api,key)=>{try{const server=api?.serverId?.(),user=api?.getCurrentUserId?.();if(typeof server!=='string'||!server||typeof user!=='string'||!user||typeof key!=='string'||!key)return null;const id=JSON.stringify([server,user,key]);return {api,server,user,credential:api.accessToken?.(),key,id,storage:'orbital-teamctx:'+id};}catch{return null;}};
  const teamActive=s=>{try{return !!s&&window.ApiClient===s.api&&s.api.serverId?.()===s.server&&s.api.getCurrentUserId?.()===s.user&&s.api.accessToken?.()===s.credential;}catch{return false;}};
  const teamValid=(t,key)=>!!t&&typeof t==='object'&&!Array.isArray(t)&&typeof t.name==='string'&&!!t.name.trim()&&typeof t.league==='string'&&!!t.league&&t.id!=null&&!!String(t.id)&&(!key.includes('~')||key===t.league+'~'+String(t.id))&&(!t.key||t.key===key)&&['logos','record','schedule','events','statistics','news'].every(k=>t[k]==null||Array.isArray(t[k])&&t[k].every(v=>k==='logos'?typeof v==='string':!!v&&typeof v==='object'&&!Array.isArray(v)))&&(t.events==null||t.events.every(e=>e.teams==null||Array.isArray(e.teams)&&e.teams.every(v=>!!v&&typeof v==='object'&&!Array.isArray(v))));
  const teamFresh=at=>typeof at==='number'&&Number.isFinite(at)&&at>0&&Date.now()>=at&&Date.now()-at<TEAM_DISPLAY_AGE;
  const teamStored=scope=>{try{if(!teamActive(scope))return null;const raw=localStorage.getItem(scope.storage);if(!raw||raw.length>1048576)return null;const v=JSON.parse(raw);return v&&teamFresh(v.at)&&teamValid(v.t,scope.key)?{...v.t,stale:true}:null;}catch{return null;}};
  const teamStore=(scope,t,at)=>{try{if(teamActive(scope)&&teamFresh(at)&&teamValid(t,scope.key)){const raw=JSON.stringify({at,t});if(raw.length<=1048576)localStorage.setItem(scope.storage,raw);}}catch{}};
  function teamContext(api,key,force=false){
    const scope=teamScope(api,key),hit=scope?TEAMCTX.get(scope.id):null,age=hit?Date.now()-hit.at:Infinity;
    if(hit&&!force&&teamActive(hit.owner)&&age>=0&&(hit.failed?age<120000:age<600000))return hit.p;
    const old=hit&&teamFresh(hit.goodAt)?hit.t:null,owned={at:Date.now(),t:old,goodAt:old?hit.goodAt:null,owner:scope};
    const owns=()=>!scope||teamActive(scope)&&TEAMCTX.get(scope.id)===owned;
    const p=fetchJson(api,'sports/api/team',{key}).then(d=>{
      const t=d?.teams?.[key];if(!teamValid(t,key))throw Error('Team unavailable');
      if(!owns())throw Error('Team context owner changed');
      const at=Date.now();if(scope){TEAMCTX.set(scope.id,{at,goodAt:at,p:Promise.resolve(t),t,owner:scope});teamStore(scope,t,at);}return t;
    }).catch(err=>{if(scope&&owns()){owned.at=Date.now();owned.failed=true;TEAMCTX.set(scope.id,owned);}throw err;});
    owned.p=p;if(scope&&teamActive(scope))TEAMCTX.set(scope.id,owned);p.catch(()=>{});return p;
  }
  const teamNow=key=>{const scope=teamScope(window.ApiClient,key);if(!teamActive(scope))return null;const h=TEAMCTX.get(scope.id);return h&&teamFresh(h.goodAt)?h.t:teamStored(scope);};
  const teamDue=key=>{const scope=teamScope(window.ApiClient,key),h=scope?TEAMCTX.get(scope.id):null,age=h?Date.now()-h.at:Infinity;return !h||!teamActive(h.owner)||age<0||age>(h.failed?120000:600000);};
  function teamGames(team){
    if(Array.isArray(team.schedule))return team.schedule;
    const sc=v=>{v=v&&typeof v==='object'?(v.displayValue??v.value):v;const n=Number(v);return v==null||v===''||!Number.isFinite(n)?null:n;};
    return (team.events||[]).map(e=>{const st=e.status?.type||{},me=(e.teams||[]).find(t=>String(t.id)===String(team.id)),op=(e.teams||[]).find(t=>t!==me)||{};
      const us=sc(me?.score),them=sc(op.score),state=st.state==='post'?'final':st.state==='in'?'live':'scheduled';
      return {id:e.id,date:e.date,state,detail:st.shortDetail||st.description,home:me?.side==='home',opponent:{id:op.id,name:op.name,short:op.name,logo:op.logo},
        score:us,opponent_score:them,result:state==='final'&&us!=null&&them!=null?(us>them?'W':us<them?'L':'T'):null,broadcast:(e.broadcasts||[])[0]||null,time_tbd:false};});
  }
  const gCalendar=g=>{if(g.time_tbd&&/^\d{4}-\d{2}-\d{2}$/.test(g.schedule_date||'')){const [y,m,d]=g.schedule_date.split('-').map(Number),value=new Date(y,m-1,d,12);if(value.getFullYear()===y&&value.getMonth()===m-1&&value.getDate()===d)return value;}return new Date(g.date);};
  const gDate=(g,o)=>gCalendar(g).toLocaleDateString([],o||{weekday:'short',month:'short',day:'numeric'});
  const gTime=g=>g.time_tbd?'Time TBA':new Date(g.date).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const gVs=g=>g.home||g.neutral?'vs':'at';
  const gOpp=(g,long)=>(g.opponent?.rank?'#'+g.opponent.rank+' ':'')+((long?g.opponent?.name:g.opponent?.short)||g.opponent?.name||'Opponent');
  const gScore=g=>g.score!=null&&g.opponent_score!=null?g.score+'–'+g.opponent_score:'';
  function gRelDay(g){const a=gCalendar(g);a.setHours(0,0,0,0);const b=new Date();b.setHours(0,0,0,0);const d=Math.round((a-b)/864e5);
    return d===0?'Today':d===1?'Tomorrow':d===-1?'Yesterday':d>1&&d<7?a.toLocaleDateString([],{weekday:'long'}):null;}
  const teamNext=games=>games.find(g=>g.state==='live')||games.find(g=>g.state==='scheduled'&&(g.time_tbd&&g.schedule_date?gCalendar(g).setHours(23,59,59,999)>=Date.now():Date.parse(g.date)>Date.now()-4*3600e3))||null;
  const teamLast=games=>[...games].reverse().find(g=>g.state==='final')||null;
  const recordName=r=>({total:'Overall',home:'Home',road:'Away',away:'Away',vsconf:'Conference',vsdiv:'Division'})[r.type]||r.name||'Record';
  function teamGameEvent(team,g,board){
    const hit=(board||[]).find(e=>String(e.id)===String(g.id)&&e.league===team.league);if(hit)return hit;
    const me={name:team.name,espn_id:String(team.id),side:g.home?'home':'away',score:g.score==null?null:String(g.score)};
    const op={name:g.opponent?.name||'Opponent',espn_id:String(g.opponent?.id||''),side:g.home?'away':'home',score:g.opponent_score==null?null:String(g.opponent_score)};
    return {id:String(g.id),league:team.league,name:g.home?op.name+' at '+me.name:me.name+' at '+op.name,start:g.date,
      state:{final:'final',live:'live',scheduled:'scheduled'}[g.state]||'unavailable',status:g.detail||'Scheduled',teams:[me,op],sources:[],stale:false};
  }
  const TEAM_KEY_STATS={
    football:[['Passing','Total Points Per Game','Points / game'],['Passing','Yards Per Game','Yards / game'],['Passing','Net Passing Yards Per Game','Pass yds / game'],['Rushing','Rushing Yards Per Game','Rush yds / game'],['Miscellaneous','3rd down %','3rd down %'],['Miscellaneous','Turnover Ratio','Turnover margin'],['Defense','Sacks','Sacks'],['Defensive Interceptions','Interceptions','Interceptions']],
    baseball:[['Batting','Batting Average','AVG'],['Batting','Home Runs','Home runs'],['Batting','Runs','Runs'],['Batting','OBP Pct + SLG Pct','OPS'],['Pitching','Earned Run Average','ERA'],['Pitching','Walks Plus Hits Per Inning Pitched','WHIP'],['Pitching','Strikeouts','Strikeouts (pitching)'],['Batting','Stolen Bases','Stolen bases']],
    basketball:[['Offensive','Points Per Game','Points / game'],['General','Rebounds Per Game','Rebounds / game'],['Offensive','Assists Per Game','Assists / game'],['Offensive','Field Goal Percentage','FG %'],['Offensive','3-Point Field Goal Percentage','3-point %'],['Offensive','Free Throw Percentage','FT %'],['Defensive','Steals Per Game','Steals / game'],['Defensive','Blocks Per Game','Blocks / game']],
    hockey:[['Offensive','Goals','Goals'],['Defensive','Goals Against','Goals against'],['Offensive','Power Play Goals','Power-play goals'],['Offensive','Shooting Percentage','Shooting %'],['Defensive','Save Percentage','Save %'],['Defensive','Goals Against Average','Goals-against avg'],['Offensive','Faceoff Win Percent','Faceoff %'],['Penalties','Penalty Minutes','Penalty minutes']]};
  const TEAM_SPORT={NFL:'football','College football':'football',MLB:'baseball',NBA:'basketball',WNBA:'basketball',NHL:'hockey'};
  const TEAM_STAT_SKIP=/^(Team Games Played|Games Started|Is Qualified|Qualified|Minutes|Minutes Per Game|Production|.*Wins Above Replacement|Zone Rating)$/;
  function teamLogo(url,cls){if(typeof url!=='string'||!url.startsWith('https://a.espncdn.com/'))return node('span',cls+' otp-logo-blank');const i=img(url,cls,'');i.onerror=()=>i.replaceWith(node('span',cls+' otp-logo-blank'));return i;}

  async function renderTeam(api,user,id,host,key){
    const root=node('div','ob5-browse ob5-team-page otp');root.dataset.key=key;browsePhase(root,'loading',api,user);
    const back=a('‹ Home','#/home','otp-back');const shell=node('div','otp-shell');
    const status=node('p','otp-loading','Loading team information…');status.setAttribute('role','status');shell.append(status);root.append(back,shell);
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');
    const legacy=!id.includes('~'),[league,teamId]=id.split('~');
    const load=async force=>{if(legacy){const d=await fetchJson(api,'sports/api/teams',{});const t=d.teams?.[id];if(!t)throw Error();return t;}return teamContext(api,id,force);};
    let team,board=[],selected='schedule',gameTimer,metaTimer,pending=false,reels=null,reelsAt=0;
    const teamRoute=location.hash,teamServer=api.serverId?.(),teamCredential=api.accessToken?.();
    const alive=()=>root.isConnected&&window.ApiClient===api&&api.getCurrentUserId()===user&&api.serverId?.()===teamServer&&api.accessToken?.()===teamCredential&&location.hash===teamRoute;
    const stop=()=>{clearInterval(gameTimer);clearInterval(metaTimer);document.removeEventListener('visibilitychange',onVisible);};
    const open=(g,ev)=>{const event=teamGameEvent(team,g,board),cards=window.OrbitalSportsCards;if(event.state==='live')cards?.feeds(event,api,ev.currentTarget);else cards?.open(event,api,ev.currentTarget);};
    function gameCard(kind,g){
      const b=button('',e=>open(g,e),'otp-game otp-game-'+kind);b.dataset.eventId=String(g.id);
      const live=board.find(e=>String(e.id)===String(g.id));
      b.append(node('span','otp-eyebrow',kind==='live'?'LIVE NOW':kind==='next'?'NEXT GAME':'LAST GAME'));
      const who=node('span','otp-game-who');who.append(teamLogo(g.opponent?.logo,'otp-game-logo'),node('span','otp-game-opp',gVs(g)+' '+gOpp(g,true)));b.append(who);
      if(kind==='last'){const r=node('span','otp-game-big');const badge=node('span','otp-result',g.result||'');badge.dataset.result=g.result||'';r.append(badge,document.createTextNode(' '+gScore(g)));b.append(r,node('span','otp-game-small',gDate(g,{weekday:'short',month:'short',day:'numeric'})));}
      else if(kind==='live'){if(live&&window.OrbitalSportsCards)b.append(window.OrbitalSportsCards.teams(live));
        b.append(node('span','otp-game-big',live?window.TelevisionFeedUi?.truth(live)||'Live':g.detail||'Live'),node('span','otp-game-small',live&&window.TelevisionFeedUi?.eligible(live).length?'Watch live · Choose feed':'Choose a live feed'));}
      else{b.append(node('span','otp-game-big',(gRelDay(g)||gDate(g))+' · '+gTime(g)));b.append(node('span','otp-game-small',[gRelDay(g)?gDate(g,{month:'short',day:'numeric'}):'',g.broadcast,g.venue].filter(Boolean).join(' · ')||(g.week||'')));
        if(live&&window.TelevisionFeedUi?.eligible(live).length)b.append(node('span','otp-game-watch','Watch available'));}
      return b;
    }
    function row(g){
      const b=button('',e=>open(g,e),'otp-row');b.dataset.eventId=String(g.id);b.dataset.state=g.state;
      const d=node('span','otp-row-date');d.append(node('small','',gDate(g,{weekday:'short'})),node('span','',gDate(g,{month:'short',day:'numeric'})));
      const who=node('span','otp-row-who');who.append(node('small','otp-row-vs',gVs(g)),teamLogo(g.opponent?.logo,'otp-row-logo'),node('span','otp-row-opp',gOpp(g)));
      const end=node('span','otp-row-end');
      if(g.state==='final'){const r=node('span','otp-result',g.result||'–');r.dataset.result=g.result||'';end.append(r,node('span','otp-row-score',gScore(g)));}
      else if(g.state==='live')end.append(node('span','otp-live-pill','LIVE'),node('span','otp-row-score',gScore(g)));
      else if(g.state==='canceled'||g.state==='postponed')end.append(node('span','otp-row-note',g.state==='canceled'?'Canceled':'Postponed'));
      else end.append(node('span','otp-row-time',gTime(g)),g.broadcast?node('small','otp-row-tv',g.broadcast):'');
      b.setAttribute('aria-label',gDate(g,{weekday:'long',month:'long',day:'numeric'})+', '+gVs(g)+' '+gOpp(g,true)+', '+(g.state==='final'?({W:'won',L:'lost',T:'tied'}[g.result]||'final')+' '+gScore(g):g.state==='scheduled'?gTime(g):g.state));
      b.append(d,who,end);return b;
    }
    const pane=node('div','otp-pane'),tabs=node('div','otp-tabs'),glance=node('div','otp-glance'),reelBox=node('section','otp-reels');reelBox.hidden=true;
    /* Sept 28: highlight reels (recent games, found by search) + the team's own YouTube channel. */
    const reelCard=r=>window.OrbitalReels.card(r.video,{title:(r.home?'vs ':'at ')+(r.opponent||'Opponent'),sub:new Date(r.date).toLocaleDateString([],{month:'short',day:'numeric'}),
      badge:r.result?r.result+' '+(r.score!=null&&r.opponent_score!=null?r.score+'–'+r.opponent_score:''):'',tone:r.result||''});
    function paintReels(){if(!reels||!window.OrbitalReels){reelBox.hidden=true;return;}const kids=[];
      const games=reels.game_reels||[],chan=(reels.videos||[]).filter(v=>!games.some(g=>g.video.id===v.id));
      if(!games.length&&!chan.length){reelBox.hidden=true;return;}
      const head=node('div','otp-reels-head');head.append(node('h2','','Highlights'));if(chan.length>6){const more=button('All videos',()=>{selected='videos';paintPane();tabs.querySelector('[data-tab=videos]')?.focus();tabs.scrollIntoView({block:'start',behavior:'smooth'});},'otp-link');head.append(more);}
      const strip=node('div','orv-row otp-reel-row');for(const r of games)strip.append(reelCard(r));for(const v of chan.slice(0,8))strip.append(window.OrbitalReels.card(v));
      kids.push(head,strip);reelBox.replaceChildren(...kids);reelBox.hidden=false;}
    async function loadReels(force){if(legacy||!alive())return;if(!force&&reels&&Date.now()-reelsAt<15*60e3)return;
      try{const r=await fetchJson(api,'sports/api/team-videos',{key:id});if(!alive())return;reels=r;reelsAt=Date.now();paintReels();if(selected==='videos')paintPane();}catch{if(!reels){reelBox.hidden=true;if(selected==='videos')paintPane();}}}
    function paintGlance(){if(!team)return;const games=teamGames(team),kids=[];
      const liveBoard=board.find(e=>e.state==='live');const liveGame=liveBoard?games.find(g=>String(g.id)===String(liveBoard.id))||{id:liveBoard.id,date:liveBoard.start,state:'live',opponent:{name:(liveBoard.teams||[]).find(t=>String(t.espn_id)!==teamId)?.name}}:games.find(g=>g.state==='live');
      if(liveGame)kids.push(gameCard('live',liveGame));
      const next=games.find(g=>g.state==='scheduled'&&Date.parse(g.date)>Date.now()-4*3600e3&&String(g.id)!==String(liveGame?.id));if(next)kids.push(gameCard('next',next));
      const last=teamLast(games);if(last)kids.push(gameCard('last',last));
      if(!kids.length)kids.push(node('p','otp-empty','No games scheduled right now.'));
      window.OrbitalRefresh.reconcile(glance,kids);}
    function paintPane(){if(!team)return;pane.replaceChildren();for(const b of tabs.children){const on=b.dataset.tab===selected;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;}
      if(selected==='schedule'){const games=teamGames(team);if(!games.length){pane.append(node('p','otp-empty','Schedule is currently unavailable.'));return;}
        const upcoming=games.filter(g=>['live','scheduled','postponed'].includes(g.state)),results=games.filter(g=>!['live','scheduled','postponed'].includes(g.state)).reverse();
        for(const [title,list] of [['Upcoming',upcoming],['Results',results]]){if(!list.length)continue;const sec=node('section','otp-section');sec.append(node('h2','',title));const box=node('div','otp-rows');for(const g of list)box.append(row(g));sec.append(box);pane.append(sec);}
        if(!team.schedule)pane.append(node('p','otp-foot','Recent and upcoming games only'));}
      if(selected==='videos'){if(!reels){pane.append(node('p','otp-empty',legacy?'Videos are unavailable for this team.':'Loading videos…'));return;}
        const games=reels.game_reels||[],chan=reels.videos||[];
        if(games.length){const sec=node('section','otp-section');sec.append(node('h2','','Game highlights'));const g=node('div','orv-grid');for(const r of games)g.append(reelCard(r));sec.append(g);pane.append(sec);}
        if(chan.length){const sec=node('section','otp-section');sec.append(node('h2','','From the team channel'));const g=node('div','orv-grid');for(const v of chan)g.append(window.OrbitalReels.card(v,{sub:v.published?new Date(v.published).toLocaleDateString([],{month:'short',day:'numeric'}):''}));sec.append(g);pane.append(sec);}
        if(!games.length&&!chan.length)pane.append(node('p','otp-empty','No videos found yet.'));
        pane.append(node('p','otp-foot','Videos play from YouTube. Game highlights come from the league, conference and team channels.'));}
      if(selected==='stats'){const stats=team.statistics||[];if(!stats.length){pane.append(node('p','otp-empty','Statistics are currently unavailable.'));return;}
        const find=(c,l)=>stats.find(s=>s.category===c&&s.label===l);const keys=(TEAM_KEY_STATS[TEAM_SPORT[team.league]]||[]).map(([c,l,t])=>[t,find(c,l)]).filter(x=>x[1]);
        const gp=stats.find(s=>/^(Games Played|Team Games Played)$/.test(s.label));
        if(keys.length){const grid=node('div','otp-stats');for(const [t,s] of keys){const tile=node('div','otp-stat');tile.append(node('strong','',s.value),node('span','',t));grid.append(tile);}pane.append(grid);}
        pane.append(node('p','otp-foot','Season statistics'+(gp?' · '+gp.value+' game'+(gp.value==='1'?'':'s'):'')+(team.statistics_stale?' · Saved data':'')));
        const cats=new Map();for(const s of stats){if(TEAM_STAT_SKIP.test(s.label))continue;const list=cats.get(s.category)||[];if(!list.some(x=>x.label===s.label))list.push(s);cats.set(s.category,list);}
        const all=node('div','otp-allstats');all.append(node('h2','','All statistics'));
        for(const [cat,list] of cats){const d=node('details','otp-statgroup');d.append(node('summary','',cat+' · '+list.length));const t=node('dl','');for(const s of list)t.append(node('dt','',s.label),node('dd','',s.value));d.append(t);all.append(d);}
        pane.append(all);}
      if(selected==='news'){const news=team.news||[];if(!news.length){pane.append(node('p','otp-empty','No recent stories.'));return;}
        const list=node('div','otp-news');let around=false;
        for(const n of news){if(n.team_story===false&&!around&&news.some(x=>x.team_story)){around=true;list.append(node('h2','otp-news-head','Around the league'));}
          const card=n.url?a('',n.url,'otp-story'):node('div','otp-story');if(n.url){card.target='_blank';card.rel='noopener noreferrer';}
          if(n.image&&String(n.image).startsWith('https://a.espncdn.com/')){const pic=img(n.image,'otp-story-img','');pic.loading='lazy';pic.onerror=()=>pic.remove();card.append(pic);}
          const text=node('div','otp-story-text');text.append(node('strong','',n.headline||'Story'));if(n.description)text.append(node('p','',n.description));
          const when=new Date(n.published);text.append(node('small','',['ESPN',Number.isNaN(when.valueOf())?'':when.toLocaleDateString([],{month:'short',day:'numeric'}),n.video?'Video':'',n.url?'Opens ESPN':''].filter(Boolean).join(' · ')));card.append(text);list.append(card);}
        pane.append(list);}
    }
    function paintAll(){
      const hero=node('section','otp-hero'),logo=teamLogo(team.logos?.[0],'otp-hero-logo'),text=node('div','otp-hero-text');
      if(team.color)hero.style.setProperty('--otp-c','#'+team.color);
      const h1=node('h1','');if(team.rank)h1.append(node('span','otp-rank','#'+team.rank));h1.append(document.createTextNode(team.name));
      text.append(node('p','otp-eyebrow',[team.league,team.standing].filter(Boolean).join(' · ')),h1);
      const form=teamGames(team).filter(g=>g.state==='final'&&['W','L','T'].includes(g.result)).slice(-5);if(form.length)text.append(node('p','otp-form','Recent form · '+form.map(g=>g.result).join(' · ')+' · oldest to newest'));const rec=node('div','otp-records');for(const [i,r] of (team.record||[]).slice(0,4).entries()){const x=node('span',i?'otp-record':'otp-record otp-record-main');x.append(node('strong','',r.summary||'–'),node('small','',recordName(r)));rec.append(x);}
      if(rec.children.length)text.append(rec);hero.append(logo,text);
      tabs.replaceChildren();tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Team sections');
      for(const [k,label] of [['schedule','Schedule'],['videos','Videos'],['stats','Stats'],['news','News']]){const b=button(label,()=>{selected=k;paintPane();},'otp-tab');b.dataset.tab=k;b.setAttribute('role','tab');
        b.onkeydown=e=>{const l=[...tabs.children],i=l.indexOf(b),j=e.key==='ArrowRight'?(i+1)%l.length:e.key==='ArrowLeft'?(i+l.length-1)%l.length:-1;if(j<0)return;e.preventDefault();l[j].focus();l[j].click();};tabs.append(b);}
      const foot=node('div','otp-updated');const when=node('small','','ESPN · Updated '+new Date(team.fetched_at*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+(team.stale?' · Saved data':''));foot.append(when,button('Refresh',()=>refreshMeta(true),'otp-refresh'));
      shell.replaceChildren(hero,glance,tabs,pane,reelBox,foot);browsePhase(root,'complete',api,user);paintGlance();paintReels();paintPane();loadReels();
    }
    async function refreshMeta(force){if(!alive()){stop();return;}if(document.hidden&&!force)return;
      try{const next=await load(force===true);if(!alive())return;team=next;const f=pane.contains(document.activeElement)?document.activeElement.dataset.eventId:null,y=scrollY;paintAll();if(f)pane.querySelector('[data-event-id="'+CSS.escape(f)+'"]')?.focus({preventScroll:true});scrollTo(0,y);}
      catch{if(!team){browsePhase(root,'error',api,user);status.textContent='Team information is currently unavailable.';shell.replaceChildren(status,button('Retry',()=>{status.textContent='Loading team information…';shell.replaceChildren(status);refreshMeta(true);},'ob5-button'));}}}
    async function refreshGames(){if(!alive()){stop();return;}if(document.hidden||pending||legacy)return;pending=true;
      try{const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),yesterday=new Date(today+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
       const responses=await Promise.all([today,yesterday.toISOString().slice(0,10)].map(date=>api.ajax({type:'GET',url:api.getUrl('sports/api/events',{date,projection:'cards'}),dataType:'json',timeout:12000})));
       if(!alive())return;const events=responses.flatMap(data=>(data.events||[]).map(e=>({...window.TelevisionFeedUi.withFreshness(e,data),source_projection:'deferred',sources:[],watchable:undefined,feed_status:undefined})));board=events.filter(e=>e.league===league&&(e.teams||[]).some(t=>String(t.espn_id)===teamId));paintGlance();}catch{}finally{pending=false;}}
    const onVisible=()=>{if(!document.hidden){refreshGames();refreshMeta();}};
    document.addEventListener('visibilitychange',onVisible);gameTimer=setInterval(refreshGames,30000);metaTimer=setInterval(()=>refreshMeta(),300000);
    const cached=legacy?null:teamNow(id);if(cached){team=cached;paintAll();}
    // Game availability is independent of season statistics and news.
    await Promise.allSettled([refreshMeta(false),refreshGames()]);
    return true;
  }

  // Sept 27: sortable lists accept ';sort=..;decade=..;unwatched=1' options (encoded in the spec, so each
  // combination is its own route: Back, retention and revalidation work unchanged).
  const FILTER_SORTS={az:['A–Z','SortName','Ascending'],new:['Newest','PremiereDate,ProductionYear,SortName','Descending'],rated:['Top rated','CommunityRating,SortName','Descending'],added:['Recently added','DateCreated,SortName','Descending']};
  function filterSpec(spec,mode){
    const [core,...optParts]=String(spec).split(';'),opts={};for(const p of optParts){const [k,v]=p.split('=');if(k&&v)opts[k]=v;}
    const def=filterSpecCore(core,mode);if(!def||!def.sortable)return def;
    const q={...def.query},defaultSort=core.startsWith('decade:')?'new':'az',sort=FILTER_SORTS[opts.sort||defaultSort];
    q.SortBy=sort[1];q.SortOrder=sort[2];if(sort[1].startsWith('CommunityRating'))q.MinCommunityRating=q.MinCommunityRating||1;
    if(opts.unwatched==='1')q.IsPlayed=false;
    const dec=core.startsWith('genre:')&&DECADES.find(d=>String(d[1])===opts.decade);if(dec)q.Years=Array.from({length:dec[2]-dec[1]+1},(_,i)=>dec[1]+i).join(',');
    const base=def.title.replace(/ · A–Z$/,'');
    return {...def,query:q,core,opts,defaultSort,title:base+(dec?' · '+dec[0]:'')+' · '+sort[0]+(opts.unwatched==='1'?' · Unwatched':'')};
  }
  function filterSpecCore(spec,mode){
    const [kind,value='',...rest]=String(spec).split(':');const type=mode==='tv'?'Series':'Movie';
    const base={IncludeItemTypes:type,Recursive:true,Fields:'PrimaryImageAspectRatio,ProductionYear,OfficialRating,CommunityRating,ProviderIds,Path,Tags',ImageTypeLimit:1,EnableImageTypes:'Primary,Backdrop,Thumb'};
    if(kind==='genre'&&rest[0]==='all')return {title:value+' · A–Z',query:{...base,Genres:value,SortBy:'SortName',SortOrder:'Ascending'},sortable:true,back:'genre:'+value};
    if(kind==='decade'){const d=DECADES.find(x=>String(x[1])===value)||['',Number(value),Number(value)+9];return {title:d[0]?'From the '+d[0]:value,query:{...base,Years:Array.from({length:d[2]-d[1]+1},(_,i)=>d[1]+i).join(','),SortBy:'ProductionYear,SortName',SortOrder:'Descending'},sortable:true};}
    if(kind==='sort'){
      if(value==='recent')return {title:'Recently added',query:{...base,SortBy:'DateCreated',SortOrder:'Descending'}};
      if(value==='unplayed')return {title:mode==='tv'?'Series you haven’t started':'Films you haven’t watched',query:{...base,IsPlayed:false,MinCommunityRating:6,SortBy:'CommunityRating,SortName',SortOrder:'Descending'}};
      if(value==='rating')return {title:'Top rated',query:{...base,MinCommunityRating:7.5,ImageTypes:'Primary',SortBy:'CommunityRating,SortName',SortOrder:'Descending'}};
      if(value==='favorites')return {title:'Favorites',query:{...base,Filters:'IsFavorite',SortBy:'SortName',SortOrder:'Ascending'}};
    }
    return null;
  }
  // FILTER_RETURN_V2: retain filtered views per server/account/route and revalidate membership on return.
  // Bounded by view count and retained cards; every asynchronous response is fenced by a per-view generation.
  const filterReturnViews=new Map(),FILTER_VIEWS_MAX=8,FILTER_CARDS_MAX=1200;
  const filterReturnKey=(api,user,key)=>JSON.stringify([api.serverId?.()||'',user,key]);
  const filterReturnDrop=k=>{const v=filterReturnViews.get(k);if(v){filterReturnViews.delete(k);v.dispose();}};
  const filterReturnClear=()=>{for(const k of [...filterReturnViews.keys()])filterReturnDrop(k);};
  function filterReturnTrim(keep){let cards=0;for(const v of filterReturnViews.values())cards+=v.cards();
    for(const [k,v] of [...filterReturnViews]){if(filterReturnViews.size<=FILTER_VIEWS_MAX&&cards<=FILTER_CARDS_MAX)break;if(v.root===keep)continue;cards-=v.cards();filterReturnDrop(k);}}
  const twoFrames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  function scrollNearest(n,delta){let s=n.parentElement;while(s&&!(s.scrollHeight>s.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(s).overflowY)))s=s.parentElement;if(s&&s!==document.body&&s!==document.documentElement)s.scrollTop+=delta;else window.scrollBy({top:delta,behavior:'instant'});}
  // Shared Android/Web discovery. All entry points normalize to a single query state.
  const DF = {cache:new Map(), counts:new Map(), epoch:0, dialog:null};
  const dfDefaults=()=>({genre:'',decade:'',watch:'',rating:'',favorite:'',sort:'rated',sub:'',co:'',grid:''});
  function dfNormalize(input,mode,availableGenres){
    const s={...dfDefaults(),...input},genres=availableGenres||GENRES[mode==='tv'?'tv':'movies'];
    s.genre=[...new Set(String(s.genre||'').split('|').filter(g=>genres.includes(g)))].join('|');
    s.decade=[...new Set(String(s.decade||'').split('|').filter(y=>DECADES.some(d=>String(d[1])===y)))].join('|');
    if(!['','no','yes'].includes(s.watch))s.watch='';
    if(!['','6','7','8'].includes(s.rating))s.rating='';
    s.favorite=s.favorite==='1'?'1':'';s.grid=s.grid==='1'?'1':'';
    if(!Object.hasOwn(FILTER_SORTS,s.sort))s.sort='rated';
    if((s.genre.includes('|')&&s.sub)||!availableGenres&&!(SUB[mode==='tv'?'tv':'movies'][s.genre]||[]).some(x=>x[0]===s.sub))s.sub='';
    if(!genres.includes(s.co)||s.co===s.genre)s.co='';
    if(!s.genre){s.sub='';s.co='';}return s;
  }
  function dfParse(spec,mode){
    if(spec.startsWith('discover?'))return dfNormalize(Object.fromEntries(new URLSearchParams(spec.slice(9))),mode);
    const [core,...extras]=spec.split(';'),[kind,value,...tail]=core.split(':'),s=dfDefaults();
    if(!['genre','decade','sort'].includes(kind))return null;
    if(kind==='genre'){s.genre=value;if(tail[0]==='sub'){try{s.sub=decodeURIComponent(tail.slice(1).join(':'));}catch{}s.grid='1';}
      if(tail[0]==='all')s.grid='1';if(tail[0]==='years')s.decade=(tail[1]||'').split('-')[0];}
    if(kind==='decade')s.decade=value;
    if(kind==='sort'){if(value==='recent')s.sort='added';if(value==='unplayed')s.watch='no';if(value==='favorites')s.favorite='1';}
    for(const part of extras){const [k,v]=part.split('=');if(k==='unwatched')s.watch=v==='1'?'no':'';else if(['sort','decade'].includes(k))s[k]=v;}
    return dfNormalize(s,mode);
  }
  function dfSpec(s){const q=new URLSearchParams();for(const k of Object.keys(dfDefaults()))if(s[k])q.set(k,s[k]);return 'discover?'+q;}
  const dfHref=(mode,s)=>filterHref(mode,dfSpec(dfNormalize(s,mode)));
  function dfQuery(s,mode,parent){
    const q={IncludeItemTypes:mode==='tv'?'Series':'Movie',Recursive:true,Fields:'Genres,Overview,ProductionYear,OfficialRating,CommunityRating,ProviderIds,DateCreated,Path,Tags',ImageTypeLimit:1,EnableImageTypes:'Primary,Backdrop,Thumb',EnableTotalRecordCount:true,SortBy:'SortName',SortOrder:'Ascending'};
    q.SortBy=FILTER_SORTS[s.sort][1];q.SortOrder=FILTER_SORTS[s.sort][2];if(parent)q.ParentId=parent;if(s.genre)q.Genres=s.genre;
    const decades=DECADES.filter(d=>s.decade.split('|').includes(String(d[1])));if(decades.length)q.Years=decades.flatMap(d=>Array.from({length:d[2]-d[1]+1},(_,i)=>d[1]+i)).join(',');
    if(s.watch)q.IsPlayed=s.watch==='yes';if(s.favorite)q.Filters='IsFavorite';if(s.rating)q.MinCommunityRating=Number(s.rating);return q;
  }
  function dfItems(raw,s,mode){
    const rule=(SUB[mode==='tv'?'tv':'movies'][s.genre]||[]).find(x=>x[0]===s.sub)?.[1];
    return unique(raw).filter(i=>(!rule||matchRule(i,rule))&&(!s.co||(i.Genres||[]).includes(s.co))).sort((a,b)=>{
      const az=String(a.SortName||a.Name||'').localeCompare(String(b.SortName||b.Name||''),undefined,{numeric:true});
      if(s.sort==='az')return az;
      const value=i=>s.sort==='added'?(Date.parse(i.DateCreated)||0):s.sort==='new'?(Date.parse(i.PremiereDate)||Number(i.ProductionYear)*31557600000||0):OrbitalRating.value(i);
      return value(b)-value(a)||az||String(a.Id).localeCompare(String(b.Id));
    });
  }
  function dfGroups(items,s,mode){
    if(s.sub||s.co||s.grid)return [];
    const groups=[];
    if(!s.genre||s.genre.includes('|')){for(const genre of GENRES[mode==='tv'?'tv':'movies']){const list=items.filter(i=>(i.Genres||[]).includes(genre));if(list.length>=3)groups.push({name:genre,items:list,state:s.genre.includes('|')?{...s,co:genre,grid:'1'}:{...s,genre}});}}
    else {for(const [name,rule] of SUB[mode==='tv'?'tv':'movies'][s.genre]||[]){const list=items.filter(i=>matchRule(i,rule));if(list.length>=3)groups.push({name,items:list,state:{...s,sub:name,grid:'1'}});}
      if(!groups.length)for(const genre of GENRES[mode==='tv'?'tv':'movies']){if(genre===s.genre)continue;const list=items.filter(i=>(i.Genres||[]).includes(genre));if(list.length>=3&&list.length<items.length)groups.push({name:genre,items:list,state:{...s,co:genre,grid:'1'}});}}
    return groups;
  }
  function dfClear(){DF.epoch++;DF.cache.clear();DF.counts.clear();if(DF.dialog)DF.dialog(false);}
  async function dfInventory(api,user,q,alive,preview){
    const {SortBy,SortOrder,...membership}=q,key=JSON.stringify([api.serverId?.()||api.getUrl(''),user,membership]),hit=DF.cache.get(key);
    if(hit&&Date.now()-hit.time<120000)return hit.items;
    let start=0,total=null;const all=[],ids=new Set();
    while(total===null||start<total){
      if(!alive())throw Error('Navigation changed');
      let timer;const r=await Promise.race([api.getItems(user,{...q,StartIndex:start,Limit:start?500:180}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Library request timed out')),20000);})]).finally(()=>clearTimeout(timer));
      if(!alive())throw Error('Navigation changed');
      if(!Array.isArray(r.Items)||!Number.isFinite(r.TotalRecordCount))throw Error('Incomplete library response');
      if(total!==null&&total!==r.TotalRecordCount)throw Error('Library changed while loading; retry');total=r.TotalRecordCount;
      if(!r.Items.length&&start<total)throw Error('Incomplete library response');
      for(const i of r.Items){if(ids.has(i.Id))throw Error('Library changed while loading; retry');ids.add(i.Id);all.push(i);}
      start+=r.Items.length;if(start>50000)throw Error('This library is too large for category discovery');
      if(start<total&&start===r.Items.length)preview(all,total);
      if(!r.Items.length)break;
    }
    if(!alive())throw Error('Navigation changed');DF.cache.set(key,{time:Date.now(),items:all});
    while(DF.cache.size>4)DF.cache.delete(DF.cache.keys().next().value);return all;
  }
  function dfSheet(mode,state,field,opener,config={}){
    if(DF.dialog)return;const initialHash=location.hash;let draft={...state},apply=false,closed=false;
    const dialog=node('dialog','df-sheet'),header=node('div','df-sheet-head'),body=node('div','df-sheet-body'),footer=node('div','df-sheet-foot');
    const titles={genre:'Genre',decade:'Release decade',watch:'Watch status',sort:'Sort titles',more:'Rating & My List',sub:'Subgenre'};
    const title=node('h2','',titles[field]);title.id='df-sheet-title';dialog.setAttribute('aria-labelledby',title.id);
    const keydown=e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopImmediatePropagation();close();}};
    const finish=(go=false)=>{if(closed)return;closed=true;dialog.close();dialog.remove();DF.dialog=null;window.removeEventListener('keydown',keydown,true);window.removeEventListener('popstate',pop);window.removeEventListener('hashchange',changed);if(opener?.isConnected)opener.focus({preventScroll:true});if(go&&location.hash===initialHash){if(config.onApply)config.onApply(draft);else dfReplace(dfHref(mode,draft));}};
    const pop=()=>finish(apply),changed=()=>finish(false);
    const close=()=>{apply=false;history.back();};DF.dialog=finish;
    header.append(title,button('×',close,'df-close'));header.lastChild.setAttribute('aria-label','Close filters');
    const changedDraft=(k,v)=>{draft[k]=v;if(k==='sub')draft.co='';if(k==='genre'){draft.sub='';draft.co='';draft.grid='';}draft=dfNormalize(draft,mode,config.genres);};
    function choices(k,label,entries,searchable=false){
      const section=node('section','df-options');section.append(node('h3','',label));const list=node('div','df-options-list');
      if(searchable){const input=node('input','df-option-search');input.type='search';input.placeholder='Find a '+label.toLowerCase();input.setAttribute('aria-label','Search '+label.toLowerCase());input.oninput=()=>{for(const b of list.children)b.hidden=!b.textContent.toLowerCase().includes(input.value.toLowerCase());};section.append(input);}
      for(const [value,text] of entries){const multi=k==='genre'||k==='decade',selected=()=>multi?(value?draft[k].split('|').includes(value):!draft[k]):draft[k]===value;const b=button(text,()=>{let next=value;if(multi&&value){const set=new Set(draft[k].split('|').filter(Boolean));set.has(value)?set.delete(value):set.add(value);next=[...set].join('|');}changedDraft(k,next);for(const el of list.children){const v=el.dataset.value;el.setAttribute('aria-pressed',String(multi?(v?draft[k].split('|').includes(v):!draft[k]):draft[k]===v));}},'df-option');b.dataset.value=value;b.setAttribute('aria-pressed',String(selected()));list.append(b);}
      section.append(list);body.append(section);
    }
    const genres=[['','All genres'],...(config.genres||GENRES[mode==='tv'?'tv':'movies']).map(g=>[g,g])];
    const decades=[['','Any decade'],...DECADES.map(d=>[String(d[1]),d[0]==='Classics'?'Before 1980':d[0]])];
    const watches=[['','Any status'],['no',mode==='tv'?'Not completed':'Unwatched'],['yes',mode==='tv'?'Completed':'Watched']];
    if(field==='genre')choices('genre','Genre',genres,true);
    if(field==='decade')choices('decade','Release decade',decades);
    if(field==='watch')choices('watch','Watch status',watches);
    if(field==='sort')choices('sort','Sort titles',Object.entries(FILTER_SORTS).map(([k,v])=>[k,v[0]]));
    if(field==='sub')choices('sub','Subgenre',[['','All '+state.genre],...(SUB[mode==='tv'?'tv':'movies'][state.genre]||[]).map(x=>[x[0],x[0]])],true);
    if(field==='more'){
      for(const [k,label,entries] of [['genre','Genre',genres],['decade','Release decade',decades],['watch','Watch status',watches],['rating','Minimum rating',[['','Any rating'],['6','6+'],['7','7+'],['8','8+']]],['favorite','My List',[['','All titles'],['1','Favorites only']]]]){
        if(!['rating','favorite'].includes(k))continue;const wrap=node('label','df-field'),select=node('select','df-select');select.setAttribute('aria-label',label);for(const [v,t] of entries){const o=node('option','',t);o.value=v;select.append(o);}select.value=draft[k];if(config.service&&['watch','favorite'].includes(k)){select.disabled=true;select.title='Available for titles in your library';}select.onchange=()=>changedDraft(k,select.value);wrap.append(node('span','',label),select);body.append(wrap);
      }
      const note=node('p','df-hint','Your genre, decade and watch-status choices stay selected. Ratings come from the catalogue; unrated titles are excluded when a minimum is set.');body.append(note);
    }
    body.prepend(node('p','df-hint',field==='more'?'Narrow the current selection.': (field==='genre'||field==='decade'?'Choose one or more. Match any selected choice; your other filters stay selected.':'Your other filters stay selected.')));
    footer.append(button('Reset '+(field==='more'?'rating and list':'choice'),()=>{if(field==='more')draft={...draft,rating:'',favorite:''};else if(field==='sort')draft.sort='rated';else {draft[field]='';if(field==='genre'){draft.sub='';draft.co='';}}apply=true;history.back();},'df-reset'));
    footer.append(button('Apply'+(field==='decade'?' decade':''),()=>{if(field==='sub')draft.grid=draft.sub?'1':'';apply=true;history.back();},'ob5-button ob5-primary'));
    dialog.append(header,body,footer);document.body.append(dialog);
    history.pushState({...history.state,dfSheet:true},'',location.href);window.addEventListener('popstate',pop);window.addEventListener('hashchange',changed);window.addEventListener('keydown',keydown,true);
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
    dialog.showModal();header.lastChild.focus();
  }
  function dfTitle(s,mode){
    let title=s.sub||s.co||(s.genre?s.genre.split('|').join(' + '):'')|| (s.favorite?'My List':s.watch==='no'?(mode==='tv'?'Not completed':'Unwatched'):s.watch==='yes'?(mode==='tv'?'Completed':'Watched'):s.sort==='added'?'Recently added':s.sort==='new'?'Recently released':mode==='tv'?'TV Shows':'Movies');
    if(s.decade&&!s.sub&&!s.co)title+=(s.genre?' in the ':' · ')+(s.decade.split('|').map(y=>DECADES.find(d=>String(d[1])===y)?.[0]).filter(Boolean).join(' + '));return title;
  }
  async function renderDiscovery(api,user,mode,state,host,key){
    const s=dfNormalize(state,mode),root=node('div','ob5-browse df-browse'),parent=route().q.get('topParentId')||'',spec=route().q.get('orbitalBrowse'),epoch=DF.epoch;
    root.dataset.mode=mode;root.dataset.key=key;browsePhase(root,'loading',api,user);root.dataset.loaded=String(Date.now());
    const alive=()=>root.isConnected&&DF.epoch===epoch&&api.getCurrentUserId()===user&&route().q.get('orbitalBrowse')===spec&&(route().q.get('topParentId')||'')===parent;
    const homeq=route().q;homeq.delete('orbitalBrowse');const crumbs=node('nav','df-crumbs');crumbs.setAttribute('aria-label','Library breadcrumb');crumbs.append(a(mode==='tv'?'TV Shows':'Movies','#/'+(mode==='tv'?'tv':'movies')+'?'+homeq));
    if(s.sub||s.co){crumbs.append(node('span','',' / '),a(dfTitle({...s,sub:'',co:'',grid:''},mode),dfHref(mode,{...s,sub:'',co:'',grid:''})));}
    const heading=node('div','df-heading');heading.append(node('h1','',dfTitle(s,mode)));if(!s.grid&&!s.sub&&!s.co)heading.append(a('View all',dfHref(mode,{...s,grid:'1'}),'df-view-all'));
    if(s.sub||s.co){const change=button('Change subgenre',()=>dfSheet(mode,s,'sub',change),'df-change');heading.append(change);}
    root.append(crumbs,heading);
    window.OrbitalPersonal?.saveControl(api,heading,mode,{...s,...(route().q.get('topParentId')?{parent_id:route().q.get('topParentId')}:{})});
    const dock=node('div','df-dock');dock.setAttribute('role','group');dock.setAttribute('aria-label','Filter this library');
    const labels={genre:s.genre.includes('|')?s.genre.split('|').length+' genres':s.genre||'All genres',decade:s.decade.includes('|')?s.decade.split('|').length+' decades':DECADES.find(d=>String(d[1])===s.decade)?.[0]||'Any decade',watch:s.watch?(s.watch==='no'?(mode==='tv'?'Not completed':'Unwatched'):(mode==='tv'?'Completed':'Watched')):'Watch status',more:'Rating & My List'+((s.rating?1:0)+(s.favorite?1:0)?' · '+((s.rating?1:0)+(s.favorite?1:0)):'')};
    for(const k of ['genre','decade','watch','more']){const b=button(labels[k],()=>dfSheet(mode,s,k,b),'df-dock-button');b.dataset.filter=k;b.setAttribute('aria-label',({genre:'Genre',decade:'Release decade',watch:'Watch status',more:'Rating & My List'})[k]+': '+labels[k]);b.setAttribute('aria-haspopup','dialog');b.classList.toggle('is-selected',k==='more'?!!(s.rating||s.favorite):!!s[k]);dock.append(b);}root.append(dock);
    const meta=node('div','df-meta'),status=node('p','df-status','Loading your library…');status.setAttribute('role','status');meta.append(status);
    const actions=node('div','df-actions');if(s.genre||s.decade||s.watch||s.rating||s.favorite||s.sub||s.co)actions.append(dfEditLink(a('Reset filters',dfHref(mode,{...dfDefaults(),sort:s.sort}),'df-reset')));
    const sort=button(FILTER_SORTS[s.sort][0],()=>dfSheet(mode,s,'sort',sort),'df-sort');sort.setAttribute('aria-label','Sort: '+FILTER_SORTS[s.sort][0]);actions.append(sort);meta.append(actions);root.append(meta);
    const content=node('div','df-content');root.append(content);
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');window.OrbitalPhone?.end('discovery controls ready');dfRestoreFocus(root,api);
    const countKey=JSON.stringify([api.serverId?.()||'',user,key]);let final=false,previewShown=false,pendingDraw=null,interacted=false;
    root.addEventListener('pointerdown',()=>{interacted=true;},{passive:true});root.addEventListener('keydown',()=>{interacted=true;});root.addEventListener('wheel',()=>{interacted=true;},{passive:true});root.addEventListener('touchmove',()=>{interacted=true;},{passive:true});
    const readyButton=button('Show complete results',()=>{const next=pendingDraw;pendingDraw=null;interacted=false;readyButton.remove();if(next)draw(next,true);},'ob5-button df-ready');
    function draw(raw,complete){
      if(!alive())return;if(!complete&&previewShown)return;
      if(complete&&previewShown&&interacted){pendingDraw=raw;status.textContent='Complete results are ready. Your current view is preserved.';if(!readyButton.isConnected)meta.append(readyButton);return;}
      const items=dfItems(raw,s,mode),groups=dfGroups(items,s,mode);final=complete;previewShown=!complete;
      const focusHref=root.contains(document.activeElement)?document.activeElement.getAttribute('href'):null;
      const strips=new Map([...content.querySelectorAll('.ob5-shelf')].map(n=>[n.getAttribute('aria-label'),n.querySelector('.ob5-strip')?.scrollLeft||0]));
      // Preserve focused title and horizontal shelf positions as the full inventory replaces the preview.
      content.replaceChildren();root.dataset.complete=String(complete);root.dataset.resultCount=String(items.length);browsePhase(root,complete?'complete':'preview',api,user);
      status.textContent=complete?`${items.length.toLocaleString()} ${mode==='tv'?'shows':'titles'}${s.rating?' · Rating '+s.rating+'+':''}${s.favorite?' · My List':''}`:'Building categories from your full library…';
      if(groups.length){root.dataset.layout='shelves';
        if(!s.decade&&!s.watch&&!s.rating&&!s.favorite){const f=feature(api,items.filter(i=>i.BackdropImageTags?.length).slice(0,12),mode);if(f){f.classList.add('df-feature');content.append(f);}}
        for(const g of groups){const row=shelf(api,g.name,g.items.slice(0,12),{href:dfHref(mode,g.state)});if(row){row.querySelector('h2').replaceChildren(a(g.name,dfHref(mode,g.state)));content.append(row);row.querySelector('.ob5-strip').scrollLeft=strips.get(g.name)||0;}}
        content.append(a('View all matching titles',dfHref(mode,{...s,grid:'1'}),'ob5-button df-all'));
      }else if(complete){root.dataset.layout='grid';
        const grid=node('div','ob5-grid df-grid');content.append(grid);let count=0;
        const more=button('Load more',()=>paint(Math.min(count+60,items.length)),'ob5-button ob5-load-more');
        function paint(want){for(const item of items.slice(count,want))grid.append(card(api,item));count=want;DF.counts.set(countKey,count);while(DF.counts.size>12)DF.counts.delete(DF.counts.keys().next().value);more.hidden=count>=items.length;more.textContent='Load more · '+count+' of '+items.length;}
        paint(Math.min(Math.max(DF.counts.get(countKey)||60,60),items.length));content.append(more);
        if(!items.length){content.append(node('h2','','No matching titles'),node('p','','Try another decade or remove a filter. Your selections are still above.'),dfEditLink(a('Clear filters',dfHref(mode,dfDefaults()),'ob5-button')));}
      }else content.append(node('div','df-loading','Finding matching titles…'));
      if(focusHref){const target=[...root.querySelectorAll('a[href]')].find(n=>n.getAttribute('href')===focusHref);target?.focus({preventScroll:true});}
      window.OrbitalPhone?.end('discovery content ready');if(complete)restoreBrowsePosition(root);
    }
    async function load(){
      try{const raw=await dfInventory(api,user,dfQuery(s,mode,parent),alive,(raw)=>{if(!s.grid&&!s.sub&&!s.co)draw(raw,false);});draw(raw,true);}
      catch(e){if(!alive())return;root.dataset.complete='error';browsePhase(root,'error',api,user);status.textContent='Could not finish loading this selection.';const error=node('div','df-error');error.append(node('p','','Your filters are preserved. Retry to load the complete library.'),button('Retry',()=>{error.remove();status.textContent='Retrying…';load();},'ob5-button'));content.append(error);}
    }
    load();return true;
  }
  window.OrbitalDiscovery={parse:dfParse,normalize:dfNormalize,spec:dfSpec,query:dfQuery,items:dfItems,groups:dfGroups};
  window.addEventListener('hashchange',e=>{if(/#\/details/.test(e.oldURL))DF.cache.clear();});

  async function renderFilter(api,user,mode,spec,host,key){
    if(/^(mylist|requests)(:|$)/.test(String(spec))&&window.OrbitalParity)return window.OrbitalParity.dispatch(spec,api,user,host,key,{browsePhase,restoreBrowsePosition,finishBrowseTransition});const discovery=dfParse(spec,mode);if(discovery)return renderDiscovery(api,user,mode,discovery,host,key);
    const parts=String(spec).split(':');
    if(parts[0]==='services')return renderServices(api,user,host,key);
    if(parts[0]==='provider')return renderProvider(api,user,parts[1],host,key);
    if(parts[0]==='team')return renderTeam(api,user,parts[1],host,key);
    if(parts[0]==='genre'&&parts.length===2)return renderCategory(api,user,mode,parts[1],host,key);
    if(parts[0]==='genre'&&parts[2]==='sub'){const sub=decodeURIComponent(parts.slice(3).join(':'));const rules=(SUB[mode==='tv'?'tv':'movies']||{})[parts[1]]||[];const rule=rules.find(r=>r[0]===sub);if(rule)return renderPoolGrid(api,user,mode,parts[1],sub,pool=>pool.filter(i=>matchRule(i,rule[1])),host,key);}
    if(parts[0]==='genre'&&parts[2]==='years'){const [from,to]=parts[3].split('-').map(Number);return renderPoolGrid(api,user,mode,parts[1],parts[1]+' from '+from+'–'+to,pool=>pool.filter(i=>i.ProductionYear>=from&&i.ProductionYear<=to),host,key);}
    const def=filterSpec(spec,mode);if(!def)return false;
    const returnKey=filterReturnKey(api,user,key),saved=filterReturnViews.get(returnKey);
    if(saved?.reusable()){filterReturnViews.delete(returnKey);filterReturnViews.set(returnKey,saved);host.querySelectorAll(':scope > .ob5-browse').forEach(n=>{if(n!==saved.root)n.remove();});host.prepend(saved.root);host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');restoreBrowsePosition(saved.root);filterReturnTrim(saved.root);await saved.revalidate();return true;}
    if(saved)filterReturnDrop(returnKey);
    const root=node('div','ob5-browse ob5-filter');root.dataset.mode=mode;root.dataset.key=key;browsePhase(root,'loading',api,user);root.dataset.loaded=String(Date.now());
    const h=node('div','ob5-page-heading');const title=node('h1','',def.title);h.append(title);
    const back=def.back?a('← '+def.back.split(':')[1],filterHref(mode,def.back),'ob5-button'):a('← '+(mode==='tv'?'TV Shows':'Movies'),'#/'+(mode==='tv'?'tv':'movies')+'?'+(()=>{const q=route().q;q.delete('orbitalBrowse');return q;})(),'ob5-button');h.append(back);root.append(h);
    if(def.sortable){/* Sept 27: sort, decade and watched filters for genre and decade lists. */
      const opts=def.opts||{},bar=node('div','ob5-filter-bar');bar.setAttribute('role','group');bar.setAttribute('aria-label','Sort and filter');
      const go=(k,v)=>{const o={...opts};if(v)o[k]=v;else delete o[k];location.replace(filterHref(mode,[def.core,...Object.entries(o).map(([x,y])=>x+'='+y)].join(';')));};
      const pick=(label,k,entries,current,fallback)=>{const wrap=node('label','ob5-filter-control');const s=node('select','ob5-filter-select');
        for(const [v,t] of entries){const o=node('option','',t);o.value=v;s.append(o);}s.value=current;s.onchange=()=>go(k,s.value===fallback?'':s.value);wrap.append(node('span','',label),s);return wrap;};
      bar.append(pick('Sort','sort',Object.entries(FILTER_SORTS).map(([k,v])=>[k,v[0]]),opts.sort||def.defaultSort,def.defaultSort));
      if(String(def.core).startsWith('genre:'))bar.append(pick('Decade','decade',[['','Any decade'],...DECADES.map(d=>[String(d[1]),d[0]])],opts.decade||'',''));
      const hide=button(opts.unwatched==='1'?'Unwatched only':'Hide watched',()=>go('unwatched',opts.unwatched==='1'?'':'1'),'ob5-chip ob5-filter-toggle');hide.setAttribute('aria-pressed',String(opts.unwatched==='1'));bar.append(hide);
      root.append(bar);}
    const status=node('p','ob5-filter-status','Loading…');status.setAttribute('role','status');root.append(status);
    const grid=node('div','ob5-grid');root.append(grid);
    const more=button('Load more',()=>page(),'ob5-button ob5-load-more');more.hidden=true;root.append(more);
    let start=0,total=null,busy=false,gen=0,loaded=false,checking=false,queued=false,needsCheck=false;const PAGE=60;
    const owned=g=>g===gen&&filterReturnViews.get(returnKey)?.root===root&&api.getCurrentUserId?.()===user&&filterReturnKey(api,user,key)===returnKey;
    const keyOf=n=>n.dataset.orbitalKey,make=item=>{const n=card(api,item);n.dataset.orbitalKey=itemKey(item);return n;};
    const paint=()=>{status.textContent=total===0?'Nothing here yet.':(start<total?`Showing ${start} of ${total}`:`${total} title${total===1?'':'s'}`);more.hidden=!(total!==null&&start<total);};
    async function page(){
      if(needsCheck&&!busy){await revalidate();return;}
      if(busy){if(checking)queued=true;return;}busy=true;more.disabled=true;const g=++gen;
      try{const off=await OrbitalRating.offset(api,user,def.query);const r=await api.getItems(user,{...def.query,StartIndex:start+off,Limit:PAGE,EnableTotalRecordCount:true});if(r.TotalRecordCount!=null)r.TotalRecordCount=Math.max(0,r.TotalRecordCount-off);
        if(!owned(g))return;
        total=r.TotalRecordCount??total;const raw=r.Items||[],have=new Set([...grid.children].map(keyOf));
        for(const item of unique(raw))if(!have.has(itemKey(item)))grid.append(make(item));start+=raw.length;loaded=true;more.textContent='Load more';
        paint();browsePhase(root,'complete',api,user);filterReturnTrim(root);
      }catch{if(!owned(g))return;browsePhase(root,start?'complete':'error',api,user);status.textContent=start?'The next page could not be loaded. Your current titles are still here.':'This list could not be loaded. Retry or go back.';more.textContent='Retry';more.hidden=false;}
      finally{if(g===gen){busy=false;more.disabled=false;}}
    }
    // Return path: keep the retained cards and position, then reconcile the loaded window with the server.
    async function revalidate(){
      if(busy||!loaded)return;busy=checking=true;needsCheck=true;const g=++gen;
      try{
        await twoFrames();if(!owned(g))return;
        // Light identity probe of the loaded window (+1 page); tolerate short pages, bounded to 12 requests.
        const want=Math.max(start,PAGE)+PAGE,fresh=[],off=await OrbitalRating.offset(api,user,def.query);let freshTotal=null;
        for(let n=0;n<12&&fresh.length<want;n++){const r=await api.getItems(user,{...def.query,Fields:'ProviderIds,Path,ProductionYear,Tags',EnableImages:false,EnableUserData:false,StartIndex:fresh.length+off,Limit:want-fresh.length,EnableTotalRecordCount:true});
          if(!owned(g))return;freshTotal=r.TotalRecordCount!=null?Math.max(0,r.TotalRecordCount-off):freshTotal;const got=r.Items||[];fresh.push(...got);if(!got.length||(freshTotal!=null&&fresh.length>=freshTotal))break;}
        // A bounded probe must cover its requested window or prove server exhaustion.
        // Preserve the retained view when a capped/partial response cannot establish membership.
        if(fresh.length<want&&(freshTotal==null||fresh.length<freshTotal))throw new Error('Incomplete filter membership probe');
        const old=[...grid.children];let active=document.activeElement,fi=old.findIndex(n=>n.contains(active));
        const focusKey=fi>=0?keyOf(old[fi]):null;
        let keep=Math.min(Math.max(start,PAGE),fresh.length);
        if(focusKey){const at=fresh.findIndex(i=>itemKey(i)===focusKey);if(at>=keep)keep=at+1;}
        const wanted=unique(fresh.slice(0,keep)),existing=new Map(old.map(n=>[keyOf(n),n]));
        const survives=n=>{const i=wanted.find(w=>itemKey(w)===keyOf(n));return !!i&&i.Id===n.dataset.itemId;};
        const missing=wanted.filter(i=>existing.get(itemKey(i))?.dataset.itemId!==i.Id);let full=new Map();
        if(missing.length){const r=await api.getItems(user,{...def.query,Ids:missing.map(i=>i.Id).join(','),StartIndex:0,Limit:missing.length,EnableTotalRecordCount:false});if(!owned(g))return;full=new Map((r.Items||[]).map(i=>[i.Id,i]));}
        // Full metadata may arrive after another remote/key/touch action. Re-read the
        // current focus immediately before reconciliation, never restore a stale one.
        active=document.activeElement;fi=old.findIndex(n=>n.contains(active));
        let anchor=null;
        if(fi>=0){for(let d=0;d<old.length&&!anchor;d++)for(const j of [fi+d,fi-d])if(!anchor&&old[j]&&survives(old[j]))anchor=old[j];}
        else anchor=old.find(n=>survives(n)&&n.getBoundingClientRect().bottom>0)||null;
        const anchorTop=anchor?.getBoundingClientRect().top;
        const next=wanted.map(i=>{const n=existing.get(itemKey(i));if(n&&n.dataset.itemId===i.Id)return n;const f=full.get(i.Id);return f?make(f):null;}).filter(Boolean),kept=new Set(next);
        for(const n of old)if(!kept.has(n))n.remove();
        next.forEach((n,i)=>{if(grid.children[i]!==n)grid.insertBefore(n,grid.children[i]||null);});
        start=keep;total=freshTotal??total;needsCheck=false;more.textContent='Load more';paint();
        if(fi>=0&&anchor){if(document.activeElement!==anchor)anchor.focus({preventScroll:true});if(anchor!==old[fi])status.textContent='A title you opened is no longer in this list. '+status.textContent;}
        if(anchor?.isConnected&&anchorTop!=null){const delta=anchor.getBoundingClientRect().top-anchorTop;if(Math.abs(delta)>1)scrollNearest(anchor,delta);}
        filterReturnTrim(root);
      }catch{if(owned(g)){status.textContent='Could not check this list for changes. Your loaded titles are kept. Retry before loading more.';more.textContent='Retry';more.hidden=false;}}
      finally{checking=false;if(g===gen){busy=false;more.disabled=false;if(queued&&!needsCheck){queued=false;await page();}}}
    }
    host.querySelectorAll(':scope > .ob5-browse').forEach(n=>n.remove());host.prepend(root);if(focus?.isConnected&&root.contains(focus))focus.focus({preventScroll:true});host.classList.add('ob5-content-ready');document.documentElement.classList.add('ob5-landing');
    filterReturnViews.set(returnKey,{root,revalidate,reusable:()=>loaded,cards:()=>grid.childElementCount,dispose:()=>{gen++;}});filterReturnTrim(root);
    await page();restoreBrowsePosition(root);return true;
  }
  function homeSettings(root,api,user){
    window.OrbitalPersonal?.mount(api,root);
    window.OrbitalPersonal?.homeRows(api,root,item=>card(api,item));
    const storage='orbital-home-layout:'+api.serverId()+':'+user;
    let settings={};try{settings=JSON.parse(localStorage.getItem(storage)||'{}');}catch{}
    const sections=()=>[...root.querySelectorAll(':scope > section[aria-label]')];
    const apply=()=>{for(const n of sections())n.hidden=(settings.hidden||[]).includes(n.getAttribute('aria-label'))||!!n.querySelector('.ob5-strip:empty');};
    root.__applyHomeSettings=apply;apply();
    const control=button('Customize Home',()=>{
      const d=node('dialog','ob5-team-picker');d.setAttribute('aria-label','Customize Home');
      d.append(node('h2','','Customize Home'),node('p','','Choose the sections shown in this browser. Saved separately for your account. Continue Watching includes movies, episodes and VOD with saved progress.'));
      const hidden=new Set(settings.hidden||[]);
      for(const title of new Set(['Featured titles','Continue Watching','Your teams','Live sports','Live now','Explore services','My List','Recently added',...sections().map(n=>n.getAttribute('aria-label'))])){const label=node('label',''),check=node('input','');check.type='checkbox';check.checked=!hidden.has(title);check.onchange=()=>check.checked?hidden.delete(title):hidden.add(title);label.style.cssText='display:flex;gap:14px;align-items:center;min-height:44px';label.append(check,node('span','',title));d.append(label);}
      const status=node('p','');d.append(status,button('Cancel',()=>d.close()),button('Save',()=>{try{localStorage.setItem(storage,JSON.stringify({hidden:[...hidden]}));settings={hidden:[...hidden]};apply();d.close();}catch{status.textContent='This browser could not save your choices. Check its storage settings.';}}));
      d.addEventListener('close',()=>{d.remove();control.focus({preventScroll:true});},{once:true});document.body.append(d);d.showModal();
    },'ob5-button ob5-customize-home');root.append(control);
  }
  function diverseHomeGenres(data) {
        // Use returned candidates only, retaining each genre's server order. Round-robin
        // selection gives small genres a turn before broad genres consume shared titles.
        const shown=new Set();
        const rows=data.genres.map(row=>({...row,candidates:row.items,items:[],next:0}));
        for(let pass=0;pass<18;pass++){
          let added=false;
          for(const row of rows){
            while(row.next<row.candidates.length){
              const item=row.candidates[row.next++],key=itemKey(item);
              if(shown.has(key))continue;
              shown.add(key);row.items.push(item);added=true;break;
            }
          }
          if(!added)break;
        }
        return rows.map(({candidates,next,...row})=>row);
      }
      function render(api,data,mode,previous=null) {
    data=window.OrbitalPersonal?.filterHome(api,data)||data;
    data=window.OrbitalParity?.rotate(data,mode,S.user)||data;if(mode==='home')data={...data,genres:diverseHomeGenres(data)};
    if(window.OrbitalPersonal && !window.OrbitalPersonal.reusable(api,previous))previous=null;
    // Reuse before constructing: detached duplicate heroes/teams previously started
    // image loads, account requests and timers on every preview-to-complete mount.
    const oldShelves=mode==='home'?[...(previous?.querySelectorAll(':scope > .ob5-shelf')||[])]:[];
    const previousShelf=title=>oldShelves.find(n=>n.getAttribute('aria-label')===title);
    const homeShelf=(title,items,options={})=>previousShelf(title)||shelf(api,title,items,options);
    const root=node('div','ob5-browse');root.dataset.mode=mode;
    if(!['top','latest','continue','series','channels','events','favorites','feature'].some(k=>data[k]?.length)){const empty=node('section','ob5-shelf');empty.append(node('h1','',mode==='home'?'Welcome to Orbital':'No titles yet'),node('p','','Add your media folders in Orbital Setup and scan the library. Your titles will appear here when they are ready.'));if(window.OrbitalEdition?.features?.sports)empty.append(a('Explore Sports','#/livetv?tab=0&sports=1','ob5-button'));root.append(empty);return root;}
    if(mode!=='home'){const h=node('div','ob5-page-heading');h.append(node('h1','',mode==='tv'?'TV Shows':'Movies'));const q=route().q;q.set('orbitalBrowse','all');h.append(a('Browse all · Sort & filter','#/'+(mode==='tv'?'tv':'movies')+'?'+q,'ob5-button'));root.append(h);}
    const append=n=>{if(n)root.append(n);};append(previous?.querySelector(':scope > .ob5-feature')||feature(api,data.hero||[],mode));
    if(mode==='home'){append(homeShelf('Continue Watching',data.continue,{wide:true}));if(S.views.some(v=>v.CollectionType==='livetv'))append(previousShelf('Your teams')||teamCorner(api,S.user));append(liveGames(api,data.events)||live(api,data.channels));append(servicesRow());append(homeShelf('My List',data.favorites.slice(0,18),{href:'#/movies?orbitalBrowse=mylist'}));append(homeShelf(data.because.title,data.because.items.slice(0,18)));append(homeShelf('Series worth starting',data.series.slice(0,18)));}
    const intentions=node('section','ob5-shelf oe-discover');intentions.setAttribute('aria-label','Find your next watch');intentions.append(node('h2','','Find your next watch'));const choices=node('div','oe-bar');for(const [title,filter] of [['Something new','sort:recent;unwatched=1'],['Highly rated, unwatched','sort:unplayed'],['A comedy tonight','genre:Comedy;unwatched=1'],['A documentary','genre:Documentary;unwatched=1'],['Explore the 1990s','decade:1990;unwatched=1']])choices.append(a(title,filterHref(mode==='home'?'movies':mode,filter),'ob5-button'));intentions.append(choices);append(intentions);if(mode!=='home')append(browseBy(api,mode));
    append(shelf(api,mode==='tv'?'Well-rated series you haven’t started':'Well-rated films you haven’t watched',data.top.slice(0,18),{href:filterHref(mode==='home'?'movies':mode,'sort:unplayed')}));
    for(const genre of data.genres)append(shelf(api,genre.name,genre.items.slice(0,18),{href:filterHref(mode==='home'?'movies':mode,'genre:'+genre.name)}));
    for(const decade of data.decades||[])append(shelf(api,'From the '+decade.name,decade.items.slice(0,18),{href:filterHref(mode,'decade:'+decade.name.slice(0,4))}));
    append(shelf(api,'Recently added',data.latest.slice(0,18),{href:filterHref(mode==='home'?'movies':mode,'sort:recent')}));
    root.append(requestLink('ob5-request','Request a movie or show','/'));if(mode==='home')homeSettings(root,api,S.user);return root;
  }
  let homeRefreshPending=false,homeRefreshAt=0,personalHomeRefresh=null,personalHomeFocus=null;
  const personalRefreshOwner=(p,connected=true)=>p&&(!connected||p.root.isConnected)&&location.hash===p.route&&window.ApiClient===p.api&&p.api.getCurrentUserId()===p.user&&p.api.serverId?.()===p.server&&p.api.accessToken?.()===p.credential;
  async function refreshHome(force=false){
    const api=window.ApiClient,user=api?.getCurrentUserId?.(),root=document.querySelector('#homeTab.is-active > .ob5-browse[data-mode="home"][data-phase="complete"]');
    if(!root||!/^#\/home(?:[?&]|$)/.test(location.hash)||document.hidden||homeRefreshPending||user!==S.user||(!force&&Date.now()-homeRefreshAt<60000))return;
    const owner=S.serial;homeRefreshPending=true;
    const valid=()=>root.isConnected&&api.getCurrentUserId()===user&&owner===S.serial;
    const replaceShelf=(title,fresh)=>{
      const old=[...root.querySelectorAll(':scope > .ob5-shelf')].find(n=>n.getAttribute('aria-label')===title);
      if(old&&fresh){window.OrbitalRefresh.reconcile(old.querySelector('.ob5-strip'),fresh.querySelector('.ob5-strip').children);old.hidden=false;}
      else if(old){old.hidden=true;old.querySelector('.ob5-strip').replaceChildren();}
      else if(fresh){if(phoneSurface()&&title==='Continue Watching'){const hero=root.querySelector(':scope > .ob5-feature');if(hero)hero.after(fresh);else root.prepend(fresh);}else{const anchor=title==='Continue Watching'?root.querySelector('.ob5-feature'):root.querySelector('.ob5-live');if(anchor)anchor.after(fresh);else root.append(fresh);}}
    };
    try{
      const results=await Promise.allSettled([
        Promise.all([fetchJson(api,'Shows/NextUp',{UserId:user,Limit:80,EnableResumable:true,EnableRewatching:false,Fields:'Overview,ProviderIds,Genres,Path,Tags'}),fetchJson(api,'Users/'+user+'/Items/Resume',{Limit:100,MediaTypes:'Video',Fields:'Overview,ProviderIds,Genres,Path,Tags'})]),
        window.OrbitalRefresh.events(api,force),fetchJson(api,'LiveTv/Channels',{UserId:user,Limit:100,EnableUserData:true,EnableCurrentProgram:true}),
        catalog(api,user,{IncludeItemTypes:'Movie,Series',Filters:'IsFavorite',SortBy:'DatePlayed,SortName',SortOrder:'Descending'}),
        catalog(api,user,{IncludeItemTypes:'Movie',SortBy:'DateCreated',SortOrder:'Descending'})]);
      if(!valid())return;
      const cache=S.cache.get(user+'|home|')?.value;
      if(results[0].status==='fulfilled'){const [next,resume]=results[0].value,items=continueItems(next.Items||[],resume.Items||[],[]);replaceShelf('Continue Watching',shelf(api,'Continue Watching',items,{wide:true}));if(cache)cache.continue=items;}
      if(results[1].status==='fulfilled'){const events=results[1].value,fresh=liveGames(api,events);replaceShelf('Live sports',fresh);if(cache)cache.events=events;}else if(cache?.events){replaceShelf('Live sports',liveGames(api,cache.events.map(e=>({...e,stale:true}))));}
      if(results[2].status==='fulfilled'){const channels=results[2].value.Items||[];if(!root.querySelector('.ob5-shelf[aria-label="Live sports"]:not([hidden])'))replaceShelf('Live now',live(api,channels));else root.querySelector('[aria-label="Live now"]')?.setAttribute('hidden','');if(cache)cache.channels=channels;}
      for(const [index,title,field,href] of [[3,'My List','favorites','#/movies?orbitalBrowse=mylist'],[4,'Recently added','latest',filterHref('movies','sort:recent')]])if(results[index].status==='fulfilled'){const items=unique(results[index].value);replaceShelf(title,shelf(api,title,items.slice(0,18),{href}));if(cache)cache[field]=items;}
      root.__applyHomeSettings?.();homeRefreshAt=Date.now();
    }finally{homeRefreshPending=false;}
  }
  setInterval(()=>refreshHome(),15000);
  window.addEventListener('hashchange',()=>{homeRefreshAt=0;setTimeout(()=>refreshHome(true),1000);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshHome(true);});
  function cleanup() {TEAMCTX.clear();S.homeAnchorStop?.();dfClear();document.querySelectorAll('#ob5-navigation,#ob5-menu-toggle,#ob5-navigation-scrim,#ob21-top-navigation,.ob5-browse').forEach(n=>n.remove());document.querySelectorAll('.ob5-content-ready').forEach(n=>n.classList.remove('ob5-content-ready'));document.documentElement.classList.remove('ob5-shell','ob5-landing','ob5-player-route','ob5-nav-open');S.views=[];S.cache.clear();filterReturnClear();S.key=null;S.pending=null;S.pendingOwner=null;S.navReturnFocus=null;}
  function preserveHomeAnchor(root,anchor,y,valid){
    S.homeAnchorStop?.();if(!anchor||!Number.isFinite(y))return;
    const focus=document.activeElement;let stopped=false,first=null,second=null;const timers=[];
    const inputs=['wheel','touchstart','keydown','pointerdown'];
    const stop=()=>{if(stopped)return;stopped=true;if(first!==null)cancelAnimationFrame(first);if(second!==null)cancelAnimationFrame(second);timers.forEach(clearTimeout);for(const name of inputs)window.removeEventListener(name,stop,true);if(S.homeAnchorStop===stop)S.homeAnchorStop=null;};
    const align=()=>{if(stopped)return;if(!valid()||!root.isConnected||!anchor.isConnected||!root.contains(anchor)||document.activeElement!==focus){stop();return;}const delta=anchor.getBoundingClientRect().top-y;if(Math.abs(delta)>1){let scroller=anchor.parentElement;while(scroller&&!(scroller.scrollHeight>scroller.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;if(scroller&&scroller!==document.body&&scroller!==document.documentElement)scroller.scrollTop+=delta;else window.scrollBy({top:delta,behavior:'instant'});}};
    S.homeAnchorStop=stop;for(const name of inputs)window.addEventListener(name,stop,{capture:true,once:true,passive:true});
    align();if(stopped)return;first=requestAnimationFrame(()=>{align();if(!stopped)second=requestAnimationFrame(align);});for(const delay of [100,250,700])timers.push(setTimeout(align,delay));timers.push(setTimeout(stop,750));
  }
  async function enhance() {
    S.timer=null;const api=window.ApiClient,user=api?.getCurrentUserId?.();const credential=api?.accessToken?.(),server=api?.serverId?.();
    // Only the invocation that took the pending lock may release it (a guard-return must not free another's lock).
    let owned=null;const acquire=k=>{owned={};S.pending=k;S.pendingOwner=owned;},release=()=>{if(owned&&S.pendingOwner===owned){S.pending=null;S.pendingOwner=null;}owned=null;};
    if(S.routeKey!==location.hash){S.routeKey=location.hash;S.serial++;S.pending=null;S.pendingOwner=null;setNavigationOpen(false,false);beginBrowseTransition();}
    if(api!==S.api||user!==S.user||server!==S.server||credential!==S.credential){cleanup();S.serial++;S.api=api;S.user=user;S.server=server;S.credential=credential;}
    const invocationRoute=location.hash,pageTicket=window.OrbitalPageReady?.begin(invocationRoute);
    const prepareRoot=(root,serial)=>window.OrbitalPageReady?.prepare(root,{api,user,server,credential,valid:()=>window.ApiClient===api&&S.serial===serial&&S.user===user&&location.hash===invocationRoute&&api.getCurrentUserId()===user&&api.serverId?.()===server&&api.accessToken?.()===credential});
    if(!user||user===SIMPLE){if(user===SIMPLE)finishBrowseTransition();return;}
    const personalReady=window.OrbitalPersonal?.prepare(api);
    try {
      if(!S.views.length){if(S.pending==='views')return;acquire('views');const views=await api.getUserViews({},user);if(window.ApiClient!==api||S.user!==user||api.getCurrentUserId()!==user||api.accessToken?.()!==credential||api.serverId?.()!==server||location.hash!==invocationRoute)return;S.views=views.Items||[];release();}
      if(!S.views.length&&route().path!=='/home'){if(window.OrbitalPageReady?.managed())void window.OrbitalPageReady.fail('No libraries are available for this account. Retry after checking access.',pageTicket);return;}
      navigation(S.views);if(location.hash.startsWith('#/mypreferenceshome')){const host=document.querySelector('.page:not(.hide) form,.page:not(.hide) .readOnlyContent');if(host&&!host.querySelector('.ob5-settings-scope'))host.prepend(node('p','ob5-settings-scope','These section selectors configure Standard Jellyfin Home. For Orbital, use Customize Home at the bottom of Home.'));}
      const {path,q}=route(),mode=path==='/home'&&q.get('tab')!=='1'?'home':path==='/movies'?'movies':path==='/tv'?'tv':null;
      document.documentElement.classList.toggle('ob5-player-route',/video|player/i.test(path));
      if(!mode||mode==='home'||q.get('orbitalBrowse')==='all')document.documentElement.classList.remove('ob5-landing');
      if(!mode||q.get('orbitalBrowse')==='all'){document.querySelectorAll('.ob5-content-ready').forEach(n=>n.classList.remove('ob5-content-ready'));document.querySelectorAll('.ob5-browse').forEach(n=>n.remove());S.key=null;if(mode)finishBrowseTransition();return;}
      const host=document.querySelector(mode==='home'?'#homeTab.is-active':mode==='movies'?'#moviesPage':'#tvshowsPage, #tvPage');
      // Fail open if the pinned v12 page adapter no longer matches.
      if(!host||!host.getClientRects().length){document.documentElement.classList.remove('ob5-landing');return;}
      if(host.querySelector(':scope > .ob5-browse'))finishBrowseTransition();
      const spec=q.get('orbitalBrowse');
      if(mode!=='home'&&spec){const fkey=user+'|'+mode+'|'+(q.get('topParentId')||'')+'|'+spec+(spec.startsWith('provider:')?'|'+(q.get('obd')||''):'');const current=host.querySelector(':scope > .ob5-browse');if(current?.dataset.key===fkey)return;if(S.pending===fkey)return;acquire(fkey);const serial=++S.serial;
        await personalReady;if(api.getCurrentUserId()!==user)return;const ok=await renderFilter(api,user,mode,spec,host,fkey);if(serial!==S.serial||route().q.get('orbitalBrowse')!==spec)return;S.key=ok?fkey:null;finishBrowseTransition();return;}
      const key=user+'|'+mode+'|'+(q.get('topParentId')||'');
      const existing=host.querySelector(':scope > .ob5-browse');
      // A complete route owns its visible state until navigation or an explicit refresh.
      // Time alone must never replace a usable page underneath an idle user.
      if(existing?.dataset.key===key&&existing.dataset.phase==='complete'){if(window.OrbitalPageReady?.managed())void prepareRoot(existing,S.serial);if(mode==='home')refreshHome();return;}
      if(S.pending===key)return;acquire(key);const serial=++S.serial;
      const mount=(value,phase)=>{const now=route();if(window.ApiClient!==api||location.hash!==invocationRoute||serial!==S.serial||S.user!==user||api.getCurrentUserId()!==user||api.accessToken?.()!==credential||api.serverId?.()!==server||now.path!==path||now.q.get('topParentId')!==q.get('topParentId')||!host.isConnected)return false;
        const current=host.querySelector(':scope > .ob5-browse');
        if(phase==='preview'&&current?.dataset.phase==='complete'&&current.dataset.key===key)return false;
        // Capture the first Phone layout before render reuses its nodes. Full
        // discovery still renders normally; new rows follow the established rows.
        const retainedHome=phoneSurface()&&mode==='home'&&current&&(!window.OrbitalPersonal||window.OrbitalPersonal.reusable(api,current))?[...current.children].filter(n=>n.matches('.ob5-feature,.ob5-shelf')):[];
        const focus=document.activeElement;
        const anchor=mode==='home'&&current?(current.contains(focus)&&focus.matches?.('.ob5-card')?focus:scrollY>0?[...current.querySelectorAll('.ob5-card')].find(n=>{const r=n.getBoundingClientRect();return r.bottom>80&&r.top<innerHeight;}):null):null;
        const anchorY=anchor?.getBoundingClientRect().top,root=render(api,value,mode,current);if(value.stableFirst)root.dataset.stableFirst='true';if(phoneSurface()&&!current)root.dataset.presentable='pending';root.dataset.key=phase==='complete'?key:key+'|preview';root.dataset.phase=phase;root.dataset.loaded=String(Date.now());if(mode==='home'&&phase==='preview'&&!phoneSurface())for(const row of root.querySelectorAll(':scope > .ob5-shelf'))row.style.contentVisibility='visible';
        const reusable=window.OrbitalPersonal&&!window.OrbitalPersonal.reusable(api,current)?null:current;window.OrbitalPersonal?.stamp(api,root);const oldFeature=reusable?.querySelector(':scope > .ob5-feature'),newFeature=root.querySelector(':scope > .ob5-feature');if(oldFeature){if(newFeature)newFeature.replaceWith(oldFeature);else root.prepend(oldFeature);}
        if(mode==='home'&&reusable)for(const previous of reusable.querySelectorAll(':scope > .ob5-shelf')){const next=[...root.querySelectorAll(':scope > .ob5-shelf')].find(n=>n.getAttribute('aria-label')===previous.getAttribute('aria-label'));if(next)next.replaceWith(previous);}
        if(retainedHome.length){for(const row of retainedHome)if(row.parentNode!==root)root.insertBefore(row,root.querySelector(':scope > .ob5-request'));root.__applyHomeSettings?.();}
        host.querySelectorAll(':scope > .ob5-browse').forEach(n=>{if(n!==root)n.remove();});host.prepend(root);if(phase==='complete'&&personalHomeFocus){const pending=personalHomeFocus;personalHomeFocus=null;if(personalRefreshOwner(pending,false)&&document.activeElement===document.body&&!document.querySelector('dialog.ox-panel[open]'))root.querySelector(':scope > .ox-open')?.focus({preventScroll:true});}if(focus?.isConnected&&root.contains(focus))focus.focus({preventScroll:true});if(mode==='home'&&anchor){const anchorRoute=location.hash;preserveHomeAnchor(root,anchor,anchorY,()=>serial===S.serial&&S.user===user&&api.getCurrentUserId()===user&&api.accessToken?.()===credential&&api.serverId?.()===server&&location.hash===anchorRoute&&host.isConnected&&host.querySelector(':scope > .ob5-browse')===root);}host.classList.add('ob5-content-ready');document.documentElement.classList.toggle('ob5-landing',mode!=='home');
        if(window.OrbitalPageReady?.managed()){void prepareRoot(root,serial).then(good=>{if(good){finishBrowseTransition();window.OrbitalPhone?.end('first useful content');}});}
        else if(root.dataset.presentable==='pending'){
          const hero=root.querySelector('.ob5-feature-art img');
          const art=hero?Promise.resolve(hero.decode?.()).catch(()=>{}):Promise.resolve();
          Promise.race([art,new Promise(resolve=>setTimeout(resolve,650))]).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!root.isConnected||S.serial!==serial||location.hash!==S.routeKey)return;root.dataset.presentable='true';finishBrowseTransition();window.OrbitalPhone?.end('first viewport ready');})));
        }else finishBrowseTransition();return true;};
      // Preserve all final shelves; useful current previews remain interactive
      // while their optional background discovery completes.
      let data=S.cache.get(key);if(!data){const preview=!existing?value=>{Promise.resolve(personalReady).then(()=>mount(value,'preview')).catch(()=>{});}:null;data={value:await Promise.all([content(api,user,mode,q.get('topParentId'),preview),personalReady]).then(values=>values[0]),time:Date.now()};if(window.ApiClient!==api||api.getCurrentUserId()!==user||api.accessToken?.()!==credential||api.serverId?.()!==server||location.hash!==invocationRoute)return;S.cache.set(key,data);}
      const now=route();if(serial!==S.serial||S.user!==user||now.path!==path||now.q.get('topParentId')!==q.get('topParentId')||!host.isConnected)return;
      if(mount(data.value,'complete')){S.key=key;if(mode==='home')homeRefreshAt=Date.now();restoreBrowsePosition(host.querySelector(':scope > .ob5-browse'));}
    }catch(e){if(window.OrbitalPageReady?.managed()){void window.OrbitalPageReady.fail('Your library could not finish loading. Please retry.',pageTicket);}else{document.documentElement.classList.remove('ob5-landing');finishBrowseTransition(true);console.warn('[Orbital browse] Native content retained:',e?.message||'unavailable');}}
    finally{release();}
  }
  function schedule(){if(!S.timer)S.timer=setTimeout(enhance,180);}
  window.addEventListener('orbital:features-changed',schedule);
  window.addEventListener('orbital:page-retry',event=>{if(event.detail?.route!==location.hash||!window.OrbitalPageReady?.managed()||route().path==='/livetv')return;S.serial++;S.key=null;S.pending=null;S.pendingOwner=null;for(const key of [...S.cache.keys()])if(key.startsWith(S.user+'|'))S.cache.delete(key);const host=document.querySelector(route().path==='/home'?'#homeTab.is-active':route().path==='/movies'?'#moviesPage':'#tvshowsPage, #tvPage');host?.querySelector(':scope > .ob5-browse')?.remove();host?.classList.remove('ob5-content-ready');schedule();});
  // Observe only for route hosts that Jellyfin creates after hash navigation. Orbital-owned
  // mutations and unrelated React updates are not lifecycle signals.
  new MutationObserver(()=>{const user=window.ApiClient?.getCurrentUserId?.();if(user&&user!==SIMPLE&&(!document.querySelector('#ob5-navigation')||S.routeKey!==location.hash)){schedule();return;}const {path}=route(),host=path==='/home'?document.querySelector('#homeTab.is-active'):path==='/movies'?document.querySelector('#moviesPage'):path==='/tv'?document.querySelector('#tvshowsPage, #tvPage'):null;if(host&&!host.querySelector(':scope > .ob5-browse'))schedule();}).observe(document.querySelector('#reactRoot')||document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>{setNavigationOpen(false,false);S.serial++;const next=location.hash;if(S.routeKey!==next){S.routeKey=next;S.pending=null;S.pendingOwner=null;}beginBrowseTransition();schedule();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){const {path}=route(),host=path==='/home'?document.querySelector('#homeTab.is-active'):path==='/movies'?document.querySelector('#moviesPage'):path==='/tv'?document.querySelector('#tvshowsPage, #tvPage'):null;if(host&&!host.querySelector(':scope > .ob5-browse'))schedule();}});
  document.addEventListener('focusin',event=>{const chip=event.target.closest?.('.ob5-chip-row .ob5-chip');if(chip)chip.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
  document.addEventListener('keydown',event=>{
    const open=document.documentElement.classList.contains('ob5-nav-open');
    if(open&&(event.key==='Escape'||event.key==='BrowserBack')){event.preventDefault();setNavigationOpen(false);return;}
    if(open&&event.key==='Tab'){const links=[...document.querySelectorAll('#ob5-navigation a')].filter(n=>n.getClientRects().length);if(!links.length)return;const first=links[0],last=links.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}return;}
    if(open)return;
    const card=event.target.closest?.('.ob5-strip > a,.ob5-strip > button');if(!card)return;
    const cards=[...card.parentElement.children].filter(n=>n.matches('a,button')),index=cards.indexOf(card);
    if(event.key==='ArrowLeft'){event.preventDefault();if(index>0)cards[index-1].focus();else setNavigationOpen(true,card);}
    else if(event.key==='ArrowRight'&&index<cards.length-1){event.preventDefault();cards[index+1].focus();}
  });
  window.addEventListener('orbital:refresh',()=>{dfClear();const {path,q}=route(),mode=path==='/home'&&q.get('tab')!=='1'?'home':path==='/movies'?'movies':path==='/tv'?'tv':null;if(!mode)return;const host=document.querySelector(mode==='home'?'#homeTab.is-active':mode==='movies'?'#moviesPage':'#tvshowsPage, #tvPage'),root=host?.querySelector(':scope > .ob5-browse');if(root?.contains(document.activeElement))return;const key=S.user+'|'+mode+'|'+(q.get('topParentId')||'');S.cache.delete(key);
    const dialog=document.querySelector('dialog.ox-panel[open]');
    if(mode==='home'&&root&&dialog){
      const api=window.ApiClient,pending={root,key,route:location.hash,api,user:api.getCurrentUserId(),server:api.serverId?.(),credential:api.accessToken?.()};
      personalHomeRefresh=pending;root.style.visibility='hidden';root.setAttribute('aria-hidden','true');root.inert=true;
      dialog.addEventListener('close',()=>{
        if(personalHomeRefresh!==pending)return;personalHomeRefresh=null;
        if(!personalRefreshOwner(pending)){S.cache.delete(pending.key);if(pending.root.isConnected){pending.root.remove();if(location.hash===pending.route)beginBrowseTransition();}schedule();return;}
        if(!document.querySelector('dialog.ox-panel[open]')){personalHomeFocus=pending;beginBrowseTransition();}
        window.dispatchEvent(new Event('orbital:refresh'));
      },{once:true});return;
    }
    filterReturnClear();if(root)root.dataset.key=key+'|refreshing';S.serial++;schedule();});
  S.routeKey=location.hash;beginBrowseTransition();schedule();
})();
/* Session-scoped network work; never change the user's saved settings. */
(()=>{
 'use strict';
 if(new URLSearchParams(location.search).get('orbital')==='off')return;
 function install(){
  const api=window.ApiClient;if(!api||api.__orbitalSessionWork)return;
  api.__orbitalSessionWork=true;
  if(typeof api.detectBitrate==='function'){
   // Legacy Auto caller: never restore a previous-network sessionStorage estimate.
   // The SDK playback path has its separate validated detector in module 2211.
   const detect=api.detectBitrate.bind(api);
   api.detectBitrate=function(){
    try{sessionStorage.removeItem('orbital-bitrate:'+api.serverId()+':'+api.getCurrentUserId());}catch{}
    api.lastDetectedBitrate=0;api.lastDetectedBitrateTime=0;
    return detect(true);
   };
  }
  if(typeof api.ajax==='function'){
   const ajax=api.ajax.bind(api);
   api.ajax=async function(options){
    if(/\/SyncPlay\/List(?:[?#]|$)/i.test(options?.url||'')){
     const id=api.getCurrentUserId(),u=await api.getCurrentUser();
     if(id!==api.getCurrentUserId()||u.Policy?.SyncPlayAccess==='None'){const e=new Error('SyncPlay unavailable for this account');e.status=403;throw e;}
    }
    return ajax(options);
   };
  }
  if(typeof api.getSyncPlayGroups==='function'){
   const original=api.getSyncPlayGroups.bind(api);let identity=null,permission=null;
   api.getSyncPlayGroups=async function(){
    const user=api.getCurrentUserId();if(identity!==user){identity=user;permission=api.getCurrentUser();}
    const current=await permission;
    if(api.getCurrentUserId()!==user)throw new Error('Account changed');
    if(current.Policy?.SyncPlayAccess==='None'){
     const error=new Error('SyncPlay is not enabled for this account');error.status=403;throw error;
    }
    return original();
   };
  }
 }
 install();const timer=setInterval(install,100);setTimeout(()=>clearInterval(timer),15000);
})();

/* Neutral browser title; internal identity and routes stay stable. */
(()=>{const title=document.querySelector('title');if(!title)return;const update=()=>{if(/orbital/i.test(document.title))document.title=document.title.replace(/orbital/ig,'Television');};new MutationObserver(update).observe(title,{childList:true,characterData:true,subtree:true});update();})();
/* Sports feed presentation: API truth only, no probes, preview or proof synthesis. */
(()=>{'use strict';
const SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
const sources=event=>{const rows=(event?.sources||[]).filter(s=>s&&typeof s.id==='string'&&s.id);const identity=s=>/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(s.id)?s.id.replace(/-/g,'').toLowerCase():s.id;const excluded=s=>s.policy_excluded===true||(event?.league==='MLB'&&s.kind==='team'&&(s.blackout===true||event?.source_policy==='national_only'||event?.postseason===true));const blocked=new Set(rows.filter(excluded).map(identity));return [...new Map(rows.filter(s=>!blocked.has(identity(s))).map(s=>[s.id,s])).values()];};
const manualAllowed=user=>!!user&&user!==SIMPLE;
const sourceBlocked=s=>s?.policy_excluded===true||s?.blackout===true||s?.notice_only===true;
const automaticEligible=s=>!!s&&!sourceBlocked(s)&&(typeof s.automatic_eligible==='boolean'?s.automatic_eligible:s.eligible===true);
const manualAvailable=s=>!!s&&!sourceBlocked(s)&&s.manual_available!==false;
// Human feed names from the real provider name and the game's teams; the raw provider name stays available as `raw`.
const TWO_WORD=/(red sox|white sox|blue jays|maple leafs|red wings|blue jackets|golden knights|trail blazers|red bulls)$/i;
const CLUB_SHORT={'red bull new york':'Red Bulls','new york red bulls':'Red Bulls','real salt lake':'Real Salt Lake','sporting kansas city':'Sporting KC','new york city fc':'NYCFC','los angeles fc':'LAFC','st. louis city sc':'St. Louis City'};
 const mascot=name=>{const n=String(name||'').trim();if(CLUB_SHORT[n.toLowerCase()])return CLUB_SHORT[n.toLowerCase()];const club=n.replace(/\s+(FC|CF|SC|AFC|CFC)$/,'');if(club!==n)return club;const m=n.match(TWO_WORD);return m?n.slice(-m[1].length):n.split(/\s+/).pop()||n;};
const title=t=>t.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase()).replace(/\b(Espn|Tnt|Tbs|Fs1|Fs2|Nbc|Cbs|Abc|Mlb|Nfl|Nba|Nhl|Wnba|Mls|Ufc|Usa|Hd)\b/g,w=>w.toUpperCase());
const feedText=value=>typeof value==='string'&&!/https?:\/\/|rt(?:sp|mp):\/\/|[\x00-\x1f\x7f]|(?:password|username|token|api_key)\s*=/i.test(value)?value.replace(/\s+/g,' ').trim().slice(0,256):'';
const specificFeedText=value=>{const text=feedText(value);return /^(?:game feed|alternative source|alternate source|main feed|backup feed)(?:\s+\d+)?$/i.test(text)?'':text;};
const raw=source=>feedText(source?.label_short)||feedText(source?.name)||'';
function clean(text){return String(text||'').split('|')[0].replace(/\s+via\s+ip\w*.*$/i,'').replace(/^(us\s*)?(mlb|nba|wnba|nhl|nfl|mls)\b[\s:]*/i,'').replace(/\b(hd|fhd|uhd|4k)\b/ig,'').replace(/\s*[\u00b7|-]\s*tv channel\s*$/i,'').replace(/\s+/g,' ').trim();}
function label(source,event){
 const providers=[...new Set((Array.isArray(source?.source_labels)?source.source_labels:[]).slice(0,32).map(r=>feedText(r?.provider_label)).filter(Boolean))];
 let provider=feedText(source?.provider_label);const channel=specificFeedText(source?.channel_label)||specificFeedText(source?.label_short)||specificFeedText(source?.name);
 if(source?.automatic===true)return (raw(source)||'Automatic selection')+(providers.length?' · Available sources: '+providers.join(' / '):'');
 if(/^automatic choice$/i.test(provider)&&providers.length)provider+=' ('+providers.join(' / ')+')';
 if(provider&&channel){const p=provider.toLowerCase(),c=channel.toLowerCase();return c===p||c.startsWith(p+' · ')?channel:provider+' · '+channel;}
 return channel||(provider?provider+' · Channel not identified':'Source not identified');
}
function quality(source){const q=source?.quality;if(!q||!Number.isFinite(q.height)||q.height<=0)return '';const fps=Number.isFinite(q.fps)&&q.fps>0?Math.round(q.fps):null;return q.height+'p'+(fps?' · '+fps+' fps':'');}
function detail(source){const routes=[...new Set((Array.isArray(source?.source_labels)?source.source_labels:[]).map(s=>label({...s,automatic:false})))].filter(v=>v!=='Source not identified'&&v!==label(source));return [quality(source),source?.language==='es'?'Español':null,routes.length?'Sources: '+routes.slice(0,8).join(' / '):null].filter(Boolean).join(' · ');}
// Measured evidence written by the server from recent real plays (never a probe).
function evidence(source){const e=source?.evidence||{};if(e.verdict==='steady')return {tone:'good',chip:'Smooth lately',text:'Smooth lately'+(Number.isFinite(e.median_mbps)?': '+e.median_mbps+' Mbit/s median over its last '+e.sessions+' plays':'')};if(e.verdict==='offline')return {tone:'warn',chip:'Off air lately',text:'Off air lately: its last try got a provider placeholder, not the game'};if(e.verdict==='slow')return {tone:'warn',chip:'Slow lately',text:'Slow lately'+(Number.isFinite(e.median_mbps)?': '+e.median_mbps+' Mbit/s median over its last '+e.sessions+' plays':'')+'; it may stall'};return null;}
function reason(source){const e=evidence(source);return e?.tone==='good'?'Chosen because it has run smoothly lately ('+e.text.replace(/^Smooth lately: /,'')+').':e?.tone==='warn'?'Every feed for this game has been slow lately; the next one starts on its own if this stalls.':'Another feed starts on its own if this one stalls.';}
function verification(source){return '';}
function truth(event,now=Date.now()){if(event?.state==='final')return /^final/i.test(event?.status||'')?event.status:'Final';if(event?.stale)return 'Saved game data · refresh for the latest';if(event?.state==='live')return event.status||'Live';if(/delay|postpon|suspend|cancel/i.test(event?.status||''))return event.status;const start=Date.parse(event?.start);if(Number.isFinite(start)&&start<now)return event?.watchable?'Starting now':'Awaiting live update';return event?.status||'Scheduled';}
function withFreshness(event,response,now=Date.now()){const raw=response?.fetched_at,stamp=typeof raw==='number'?raw*1000:Date.parse(raw),warnings=response?.warnings||[];return {...event,fetched_at:raw,warnings,stale:!!event?.stale||!!response?.stale||!Number.isFinite(stamp)||now-stamp>120000||stamp-now>60000||warnings.some(w=>!/feed inventory/i.test(String(w))&&/stale|saved|cached|previous schedule|status may be outdated|(?:schedule|scoreboard).*(?:unavailable|failed)/i.test(String(w)))};}
const eligible=event=>(event?.state==='live'||event?.watchable===true)&&!event?.stale?sources(event).filter(s=>!s.automatic&&automaticEligible(s)):[];
const api={sources,manualAllowed,automaticEligible,manualAvailable,label,raw,quality,detail,evidence,reason,verification,truth,eligible,withFreshness,mascot};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.TelevisionFeedUi=api;
})();

/* Ephemeral tracker execution ownership. Credentials stay private, never in keys. */
(function(root){'use strict';
 let active=null,details=null,serial=0;const ids=new WeakMap(),listeners=new Set();
 function notify(){for(const entry of [...listeners])if(entry.scope!==active){listeners.delete(entry);try{entry.fn();}catch{}}}
 function capture(){const api=root.ApiClient;let server,user,credential;try{server=api?.serverId?.()||'';user=api?.getCurrentUserId?.()||'';credential=api?.accessToken?.();}catch{invalidate();return null;}
  const route=root.location?.hash||'';
  if(!api||!user){if(active){active=null;details=null;notify();}return null;}
  if(details&&details.api===api&&details.server===server&&details.user===user&&details.credential===credential&&details.route===route)return active;
  details={api,server,user,credential,route};active=Object.freeze({});ids.set(active,String(++serial));notify();return active;
 }
 function accepts(scope){return !!scope&&capture()===scope;}
 function observe(scope,fn){if(!accepts(scope))return ()=>{};const entry={scope,fn};listeners.add(entry);return ()=>listeners.delete(entry);}
 function invalidate(){active=null;details=null;notify();}
 root.addEventListener?.('hashchange',invalidate);root.addEventListener?.('pagehide',invalidate);
 root.OrbitalTrackerOwnership={capture,accepts,key:scope=>ids.get(scope)||'',observe,invalidate};
})(window);

/* Real metadata trackers. No media requests and no inferred coordinates/delay. */
(()=>{'use strict';
const kinds=new Set(['baseball','football','basketball','hockey']);
const number=v=>typeof v==='number'&&Number.isFinite(v);
const unit=v=>number(v)&&v>=0&&v<=1;
const drawable=d=>!!d&&kinds.has(d.kind)&&(d.tracking_available===true||d.display_geometry===true)&&d.geometry_available===true&&(!d.stale||d.reference_estimated===true);
const points=d=>drawable(d)?(d.points||[]).filter(p=>unit(p.x)&&unit(p.y)):[];
const bars=d=>drawable(d)?(d.plays||[]).filter(p=>unit(p.start_x)&&unit(p.end_x)):[];
const key=e=>e.league+':'+(e.id||e.event_id);
const identity=()=>{const a=window.ApiClient;return a?[a.serverId(),a.getCurrentUserId()].join(':'):'';};
function trackerCourtArc(league,hoop={x:.5,y:5.25/47}){
 const cx=hoop.x*50,cy=hoop.y*47,r=league==='NBA'?23.75:22+1.75/12,first=Math.acos(-22/r),last=Math.acos(22/r);
 return [{x:(cx-22)/50,y:0},...Array.from({length:33},(_,i)=>{const a=first+(last-first)*i/32;return {x:(cx+r*Math.cos(a))/50,y:(cy+r*Math.sin(a))/47};}),{x:(cx+22)/50,y:0}];
}
function trackerShotColor(d,p){
 const teams=d.teams||[],team=teams.find(t=>String(t.id)===String(p.team_id)&&p.team_id!==undefined&&String(p.team_id)!=='');
 if(!team)return '#dce6ee';
 const raw=/^#[0-9a-f]{6}$/i.test(team.color||'')?team.color:teams.indexOf(team)===0?'#68bcf2':'#ff8392';
 return '#'+[1,3,5].map(i=>Math.floor(parseInt(raw.slice(i,i+2),16)*.68+255*.32).toString(16).padStart(2,'0')).join('');
}
function trackerPlacementCorner(meta,binding,{width=.32,height=.27}={},now=Date.now()/1000){
 const corners=['top-left','top-right','bottom-left','bottom-right'];
 if(!meta||!binding)return null;
 const normalize=(k,v)=>k==='channel'?String(v??'').replace(/-/g,'').toLowerCase():String(v??'');
 for(const k of ['event_id','channel','viewer_session','playback_epoch','source_id','source_generation'])if(!normalize(k,binding[k])||normalize(k,binding[k])!==normalize(k,meta[k]))return null;
 if(!Number.isFinite(meta.observed_at)||!Number.isFinite(meta.expires_at)||meta.observed_at>now+2||now-meta.observed_at>90||meta.expires_at<=now||meta.expires_at<meta.observed_at||meta.expires_at-meta.observed_at>120)return null;
 if(![...corners,'bottom'].includes(meta.scorebar_corner))return null;
 const regions=(Array.isArray(meta.detected_regions)?meta.detected_regions:[]).slice(0,8).filter(r=>r&&['scorebar','network_logo'].includes(r.role)&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1&&r.y+r.height<=1);
 if(!regions.some(r=>r.role==='scorebar'))return null;
 regions.push({x:.82,y:0,width:.18,height:.08});
 width=Math.max(.08,Math.min(.5,width));height=Math.max(.08,Math.min(.7,height));
 const scores=corners.map(c=>{const rect={x:c.endsWith('left')?.02:.98-width,y:c.startsWith('top')?.1:.96-height,width,height};return [c,regions.reduce((sum,r)=>sum+Math.max(0,Math.min(rect.x+rect.width,r.x+r.width)-Math.max(rect.x,r.x))*Math.max(0,Math.min(rect.y+rect.height,r.y+r.height)-Math.max(rect.y,r.y)),0)];});
 const minimum=Math.min(...scores.map(x=>x[1])),best=scores.filter(x=>x[1]<=minimum+.000001);
 return (best.find(x=>x[0]===meta.preferred_empty_corner)||best[0])[0];
}

function trackerFootballCurrentText(p){return String(p.text||'').split(/\s*\(\s*Original Play\s*:/i)[0].trimEnd();}
function trackerFootballKind(p){
 const t=((p.type||'')+' '+trackerFootballCurrentText(p)).toLowerCase();
 if(/^penalty/i.test(p.type||'')||/penalty/.test(t)&&/no play/.test(t))return 'Penalty';
 if(/\bno play\b/.test(t))return 'No play';
 // A defensive touchdown still has turnover impact for the drive's offense.
 if(/intercept/.test(t))return 'INT';
 if(/fumble recovery \(opponent\)|fumble return/.test(t))return 'Fumble';
 if(/kickoff/.test(t))return 'Kickoff';
 if(/extra point|point after/.test(t))return 'PAT';
 if(/field goal/.test(t))return 'FG';
 if(/punt/.test(t))return 'Punt';
 return /touchdown/.test(t)?'TD':/incomplet/.test(t)?'Inc':/sack/.test(t)?'Sack':/kneel/.test(t)?'Kneel':/pass/.test(t)?'Pass':/rush|run|scramble/.test(t)?'Run':'Play';
}
function trackerFootballYards(p){return Number.isFinite(p.start_x)&&Number.isFinite(p.end_x)&&p.start_x>=0&&p.start_x<=1&&p.end_x>=0&&p.end_x<=1?Math.round((p.end_x-p.start_x)*100):Number.isFinite(p.yards)?p.yards:null;}
function trackerFootballColor(yards,kind='Play'){return ['FG','Punt','Kickoff','PAT'].includes(kind)?'#c7d5e0':kind==='INT'||kind==='Fumble'?'#ffbd69':kind==='TD'||Number.isFinite(yards)&&yards>0?'#63e6b0':Number.isFinite(yards)&&yards<0?'#ff8392':'#c7d5e0';}
function trackerFootballLabel(p){const kind=trackerFootballKind(p),yards=trackerFootballYards(p),amount=yards===null||['Inc','Punt','FG','PAT','Kickoff','INT','Fumble','No play'].includes(kind)?'':yards===0?'no gain':(yards>0?'+':'−')+Math.abs(yards);const result=['FG','PAT'].includes(kind)?(/no good|missed|blocked/i.test(p.type+' '+trackerFootballCurrentText(p))?' missed':/\bgood\b/i.test(p.type+' '+trackerFootballCurrentText(p))?' good':''):'';return [kind+result,amount].filter(Boolean).join(yards===0?' · ':' ');}
function trackerFootballRows(d,limit=60){return (d.plays||[]).filter(p=>[p.start_x,p.end_x].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&!/timeout|end (of )?(period|quarter|half|game|regulation)|two-minute|coin toss/i.test(p.type||'')).slice(-limit);}
function trackerLineToGain(d){const ball=d.field?.ball_x,raw=d.situation?.distance,distance=Number(raw),team=d.summary?.team_id;if(!Number.isFinite(ball)||ball<0||ball>1||raw==null||String(raw).trim()===''||!Number.isFinite(distance)||distance<0||distance>100||!team||String(team)!==String(d.situation?.team_id))return null;return distance===0?1:Math.min(1,ball+distance/100);}
function trackerDriveSpan(d,drive){
 if(d?.kind!=='football'||d.geometry_available!==true||d.stale||!drive)return null;
 const valid=p=>[p.start_x,p.end_x].every(v=>Number.isFinite(v)&&v>=0&&v<=1);
 const supplied=Array.isArray(drive.play_details)?drive.play_details:[],rows=supplied.filter(p=>p&&valid(p)&&(!p.team_id||String(p.team_id)===String(drive.team_id))&&!/timeout|end (of )?(period|quarter|half|game|regulation)|two-minute|coin toss/i.test(p.type||''));
 const terminal=rows.at(-1),kick=terminal&&['FG','PAT','Punt','Kickoff'].includes(trackerFootballKind(terminal));
 // Kicks report travel to another field spot. They are not offensive drive progress.
 if(kick)return {start:rows[0].start_x,end:terminal.start_x};
 if(!rows.length&&/field goal|punt|extra point|kickoff/i.test(drive.result||''))return null;
 return [drive.start_x,drive.end_x].every(v=>Number.isFinite(v)&&v>=0&&v<=1)?{start:drive.start_x,end:drive.end_x}:null;
}
function trackerFootballReportedView(d){
 const admin=p=>/timeout|end (of )?(period|quarter|half|game|regulation)|two-minute|coin toss/i.test(p?.type||'');
 const last=(d.plays||[]).filter(p=>p&&!admin(p)).at(-1),drive=(d.drives||[]).find(row=>String(row.id)===String(d.summary?.drive_id)),members=(drive?.play_details||[]).filter(p=>p&&!admin(p));
 if(!last||!drive||members.at(-1)?.id!==last.id||members.filter(p=>p.id===last.id).length!==1)return d;
 const kind=trackerFootballKind(last),result=String(d.summary?.result||''),agrees=kind==='FG'?/field goal/i.test(result):kind==='Punt'?/punt/i.test(result):kind==='TD'?/touchdown/i.test(result):kind==='INT'?/intercept/i.test(result):kind==='Fumble'?/fumble/i.test(result):false;
 return agrees?{...d,situation:null,field:{...d.field,ball_x:null}}:d;
}
function trackerFootballState(d){
 const teams=d.teams||[],s=d.situation||{},team=teams.find(t=>String(t.id)===String(s.team_id)&&s.team_id!=null),same=team&&String(s.team_id)===String(d.summary?.team_id),live=d.state==='live',down=Number(s.down),raw=s.distance,distance=Number(raw),valid=live&&same&&Number.isInteger(down)&&down>=1&&down<=4&&raw!=null&&String(raw).trim()!==''&&Number.isFinite(distance)&&distance>=0&&distance<=100;
 const ordinal=n=>n+({1:'st',2:'nd',3:'rd',4:'th'}[n]||'th'),drive=d.summary?.team_id!=null&&String(d.summary.team_id).trim()!==''?teams.find(t=>t.id!=null&&String(t.id)===String(d.summary.team_id)):null;
 const period=Number.isInteger(d.period)&&d.period>0?(d.period<=4?'Q'+d.period:'OT'+(d.period-4)):'',clock=typeof d.clock==='string'?d.clock:'';
 return {team:valid?team:null,drive,down:valid?ordinal(down)+' & '+(distance===0||s.goal_to_go===true?'Goal':distance):'',spot:valid&&typeof s.spot==='string'?s.spot:'',clock:[period,clock].filter(Boolean).join(' · ')||d.status||'',saved:d.stale===true,estimated:d.estimated===true||d.reference_estimated===true||d.held===true,ball:valid&&Number.isFinite(d.field?.ball_x)&&d.field.ball_x>=0&&d.field.ball_x<=1?d.field.ball_x:null,target:valid?trackerLineToGain(d):null};
}
function trackerDriveSvg(d,drive,make){const span=trackerDriveSpan(d,drive);if(!span)return null;
 const W=600,H=60,E=50,X=u=>E+u*(W-2*E),off=(d.teams||[]).find(t=>t.id===drive.team_id),def=(d.teams||[]).find(t=>t.id&&t.id!==drive.team_id),color=trackerShotColor(d,{team_id:drive.team_id}),hex=(t,f)=>/^#[0-9a-f]{6}$/i.test(t?.color||'')?t.color:f;
 const s=make('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`${off?.abbreviation||'Offense'} drive from ${Math.round(span.start*100)} to ${Math.round(span.end*100)} yards from own goal line. Offense attacks right.`,class:'otv-drive-mini'});
 s.append(make('rect',{x:1,y:1,width:W-2,height:42,rx:7,fill:'#142f29',stroke:'#527969','stroke-width':1}));
 for(const [x,t] of [[1,off],[W-E,def]]){s.append(make('rect',{x,y:1,width:E-1,height:42,fill:hex(t,'#365365'),'fill-opacity':.9}));s.append(make('text',{x:x+E/2,y:26,'text-anchor':'middle',fill:'#fff','font-size':12,'font-weight':750},t?.abbreviation||''));}
 for(let n=0;n<=100;n+=10){const x=X(n/100);s.append(make('line',{x1:x,x2:x,y1:1,y2:43,stroke:n===50?'#b2cdc1':'#527969','stroke-width':n===50?1.5:1}));if(n>0&&n<100)s.append(make('text',{x,y:57,'text-anchor':'middle',fill:'#afc6bc','font-size':11},n<=50?n:100-n));}
 const a=X(span.start),b=X(span.end),dir=b>=a?1:-1,tone=trackerFootballColor(Math.round((span.end-span.start)*100));
 s.append(make('line',{x1:a,x2:b,y1:22,y2:22,stroke:tone,'stroke-width':7,'stroke-linecap':'round'}));
 if(Math.abs(b-a)>5)s.append(make('path',{d:`M ${b} 22 L ${b-dir*9} 15 L ${b-dir*9} 29 Z`,fill:tone}));
 s.append(make('circle',{cx:a,cy:22,r:4,fill:'#142f29',stroke:'#fff','stroke-width':1.5}),make('circle',{cx:b,cy:22,r:3,fill:'#fff'}));return s;
}
function trackerProbabilityRuns(samples){const runs=[];let active=null;
 for(let i=1;i<samples.length;i++){const a=samples[i-1],b=samples[i];if(b.index!==a.index+1){active=null;continue;}const cross=(a.home-.5)*(b.home-.5)<0?{index:a.index+(b.index-a.index)*(.5-a.home)/(b.home-a.home),home:.5}:null,points=cross?[a,cross,b]:[a,b];for(let j=1;j<points.length;j++){const first=points[j-1],last=points[j],homeFavored=(first.home+last.home)/2>=.5;if(!active||active.homeFavored!==homeFavored){active={homeFavored,points:[first,last]};runs.push(active);}else active.points.push(last);}}
 return runs;
}
function trackerProbabilityModel(r){const values=Array.isArray(r.win_probability)?r.win_probability.slice(0,800):[],teams=(r.teams||[]).slice(0,2),samples=values.map((home,index)=>({index,home})).filter(p=>Number.isFinite(p.home)&&p.home>=0&&p.home<=1);if(samples.length<2||teams.length!==2)return null;
 const home=teams.find(t=>t.home===true)||teams[1],away=teams.find(t=>t.home===false)||teams[0],colored=teams.map(t=>({...t,color:/^#?[0-9a-f]{6}$/i.test(t.color||'')?'#'+t.color.replace(/^#/,''):t.color})),hc=trackerShotColor({teams:colored},{team_id:home.id}),ac=trackerShotColor({teams:colored},{team_id:away.id});
 const W=640,H=240,L=82,R=14,T=14,B=34,last=values.length-1,x=i=>L+(W-L-R)*i/last,y=p=>T+(H-T-B)*(1-p),periods=(r.win_probability_periods||[]).filter(p=>Number.isInteger(p.index)&&p.index>=0&&p.index<=last&&Number.isInteger(p.period)&&p.period>0&&p.period<=30).slice(0,30).sort((a,b)=>a.index-b.index),keys=(r.win_probability_key_plays||[]).filter(p=>Number.isInteger(p.index)&&samples.some(s=>s.index===p.index)).slice(0,80);
 return {samples,runs:trackerProbabilityRuns(samples),home,away,hc,ac,W,H,L,R,T,B,last,x,y,periods,keys};
}
function trackerProbabilitySvg(r,make){const m=trackerProbabilityModel(r);if(!m)return null;const {samples,home,away,hc,ac,W,H,L,R,T,B,last,x,y,periods,keys}=m,name=t=>t.abbr||t.short||t.name||'',label=p=>r.league==='MLB'?String(p):r.league==='NHL'?'P'+p:p>4?'OT'+(p-4):'Q'+p;
 const s=make('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`Win probability. ${name(home)} above 50%, ${name(away)} below 50%.`,class:'otv-probability-chart'});
 for(const [p,text,tone] of [[1,name(home)+' 100%',hc],[.5,'50%','#aec3d1'],[0,name(away)+' 100%',ac]]){s.append(make('line',{x1:L,x2:W-R,y1:y(p),y2:y(p),stroke:p===.5?'#7f99aa':'#405667','stroke-width':p===.5?1.3:1,'stroke-dasharray':p===.5?'4 4':'none'}));s.append(make('text',{x:L-10,y:y(p)+4,'text-anchor':'end',fill:tone,'font-size':12},text));}
 for(let i=0;i<periods.length;i++){const p=periods[i],xx=x(p.index),next=periods[i+1]?.index??last;s.append(make('line',{x1:xx,x2:xx,y1:T,y2:H-B,stroke:'#334e60','stroke-width':1}));s.append(make('text',{x:x((p.index+next)/2),y:H-10,'text-anchor':'middle',fill:'#adc3d1','font-size':12},label(p.period)));}
 if(!periods.length||periods[0].index>last*.15)s.append(make('text',{x:L,y:H-10,fill:'#adc3d1','font-size':12},'Start'));
 for(const run of m.runs){const first=run.points[0],last=run.points.at(-1),tone=run.homeFavored?hc:ac,points=run.points.map(p=>x(p.index)+','+y(p.home)).join(' '),outline=run.points.map(p=>'L '+x(p.index)+' '+y(p.home)).join(' ');s.append(make('path',{d:`M ${x(first.index)} ${y(.5)} ${outline} L ${x(last.index)} ${y(.5)} Z`,fill:tone,'fill-opacity':.28}),make('polyline',{points,fill:'none',stroke:tone,'stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round'}));}
 for(const k of keys){const p=samples.find(v=>v.index===k.index),dot=make('circle',{cx:x(k.index),cy:y(p.home),r:4.5,fill:'#ffd166',stroke:'#142331','stroke-width':1.5,'data-key-play-index':k.index});dot.append(make('title',{},k.text||'Scoring play'));s.append(dot);}return s;
}

function pitchCall(row,previous){
 const text=String(row?.text||row?.type||'');
 if(/two[- ]strike foul/i.test(row?.type||'')||(/foul/i.test(text)&&!/tip|bunt/i.test(text)&&row?.strikes===2&&previous?.strikes===2))return 'Two-strike foul';
 if(/foul/i.test(text))return 'Foul';
 if(/swinging|whiff|missed swing/i.test(text))return 'Swinging strike';
 if(/looking|called strike/i.test(text))return 'Called strike';
 if(/in play|single|double|triple|home run|groundout|flyout/i.test(text))return 'In play';
 if(/\bball\b/i.test(text))return 'Ball';
 return /strike/i.test(text)?'Strike':String(row?.type||'Reported pitch');
}
function pitchIdentity(row,previous,ordinal){
 const number=Number.isInteger(row?.pitch_number)?row.pitch_number:Number.isInteger(row?.number)?row.number:ordinal;
 const type=String(row?.pitch_type||'Pitch'),speed=Number.isFinite(row?.mph)?Math.round(row.mph)+' mph':'';
 return {number,call:pitchCall(row,previous),label:['Pitch '+number,type,speed,pitchCall(row,previous)].filter(Boolean).join(' · ')};
}
function pitchNumberPlacement(x,y,r,used){
 let result={x:x+r+18,y:y-r-14};
 for(let attempt=0;attempt<64;attempt++){
  const angle=attempt%8*Math.PI/4,radius=28+Math.floor(attempt/8)*24;
  const candidate=attempt===0?result:{x:x+Math.cos(angle)*radius,y:y+Math.sin(angle)*radius};
  if(used.every(p=>Math.hypot(p.x-candidate.x,p.y-candidate.y)>=30)){result=candidate;break;}
 }
 used.push(result);return result;
}

function physicalPitches(pitches){
 const valid=g=>g&&g.source==='mlb'&&g.perspective==='pitcher'&&Number.isInteger(g.game_pk)&&g.game_pk>0&&typeof g.play_id==='string'&&g.play_id.length>0&&[['x_ft',-5,5],['z_ft',-2,8],['top_ft',2,5],['bottom_ft',.5,3],['width_in',16.99,17.01],['ball_radius_in',1.4,1.5]].every(([k,a,b])=>Number.isFinite(g[k])&&g[k]>=a&&g[k]<=b)&&g.top_ft>g.bottom_ft;
 const rows=pitches.filter(p=>valid(p.physical)),g=rows.at(-1)?.physical;if(!g)return null;
 return {field:{physical_width:10,physical_height:10,source:'mlb',units:'feet',ball_radius:g.ball_radius_in/120,ball_size:'nominal',zone:{x:(5-g.width_in/24)/10,y:(8-g.top_ft)/10,width:g.width_in/120,height:(g.top_ft-g.bottom_ft)/10,approximate:false}},points:rows.map(p=>{const previous=pitches[pitches.indexOf(p)-1],foul=/foul/i.test(p.text)&&!/tip|bunt/i.test(p.text)&&p.strikes===2&&previous?.strikes===2;return {id:p.id,x:(5-p.physical.x_ft)/10,y:(8-p.physical.z_ft)/10,number:p.pitch_number,type:foul?'two-strike foul':p.text,text:p.text,at:p.at};}),calibration:{note:'MLB tracked locations · batter-specific zone'}};
}
const model={physicalPitches,pitchCall,pitchIdentity,drawable,points,bars,key,courtArc:trackerCourtArc,teamColor:trackerShotColor,placementCorner:trackerPlacementCorner,footballColor:trackerFootballColor,footballKind:trackerFootballKind,footballYards:trackerFootballYards,footballLabel:trackerFootballLabel,footballRows:trackerFootballRows,footballState:trackerFootballState,reportedFootballView:trackerFootballReportedView,lineToGain:trackerLineToGain,driveSpan:trackerDriveSpan,driveField:(d,drive)=>trackerDriveSvg(d,drive,svg),probabilityModel:trackerProbabilityModel,probabilityField:r=>trackerProbabilitySvg(r,svg)};
if(typeof module!=='undefined'&&module.exports){module.exports=model;return;}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const svg=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=String(text);return n;};
const colors=['#af87ff','#ff686e'];
const teamColor=trackerShotColor;
const pitchColor=p=>/two-strike foul/i.test(p.type||'')?'#c39aff':/foul/i.test(p.type||p.text||'')?'#ffcd57':/strike|whiff/i.test(p.type||p.text||'')?'#ff5867':/in play|out|single|double|triple|home run|hit/i.test((p.type||'')+' '+(p.result||''))?'#f4f7fb':'#79dd9e';
const hex=(c,fallback)=>/^#[0-9a-f]{6}$/i.test(String(c||''))?c:fallback;
const offenseOf=d=>(d.teams||[]).find(t=>t.id===d.summary?.team_id)||null;
const defenseOf=d=>{const o=offenseOf(d);return o?(d.teams||[]).find(t=>t.id&&t.id!==o.id)||null:null;};
const playKind=trackerFootballKind;
function possession(d){const o=offenseOf(d);if(!o)return null;const live=d.state==='live'&&unit(d.field?.ball_x);
 const b=el('div','otv-possession');const chip=el('span','otv-possession-chip',o.abbreviation||o.name);chip.style.background=hex(o.color,'#35505f');
 const other=defenseOf(d);b.append(chip,el('strong','',(o.name||o.abbreviation)+(live?' ball':' \u00b7 latest drive')),el('span','otv-possession-dir',(live?'toward ':'at ')+(other?.abbreviation||'the end zone')+' \u25b6'));return b;}
const completed=d=>d.kind==='baseball'&&(d.summary?.completed===true||d.summary?.scope==='previous_at_bat');
function field(d,{translucent=false,onInspect=null,footballStrip=false}={}){
 const w=600,baseballHeight=number(d.field?.physical_width)&&number(d.field?.physical_height)&&d.field.physical_width>0?600*d.field.physical_height/d.field.physical_width:600,h=d.kind==='hockey'?255:d.kind==='basketball'?564:d.kind==='football'?(footballStrip?112:Math.max(w/2.25,58+8*30)):baseballHeight;
 const s=svg('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':d.kind+' tracker; '+(d.calibration?.note||'coordinates supplied by ESPN')});s.classList.add('otv-tracker-map');if(translucent)s.style.background='transparent';
 const rect=(x,y,width,height,fill,stroke='#aac1cd',extra={})=>s.append(svg('rect',{x,y,width,height,fill,stroke,...extra}));
 const line=(x1,y1,x2,y2,stroke='#d5e3e8',extra={})=>s.append(svg('line',{x1,y1,x2,y2,stroke,...extra}));
 if(d.kind==='baseball'){
  const z=d.field?.zone;if(z&&[z.x,z.y,z.width,z.height].every(unit)){rect(z.x*w,z.y*h,z.width*w,z.height*h,'#1c3546','#c3d7e2',{'stroke-width':2});for(let i=1;i<3;i++){line((z.x+z.width*i/3)*w,z.y*h,(z.x+z.width*i/3)*w,(z.y+z.height)*h,'#64808f');line(z.x*w,(z.y+z.height*i/3)*h,(z.x+z.width)*w,(z.y+z.height*i/3)*h,'#64808f');}}
 }else if(d.kind==='basketball'){
  rect(1,1,w-2,h-2,translucent?'rgba(97,78,56,.22)':'#42372d','#cfdddf',{rx:10,'stroke-width':2});
  rect(w*.34,0,w*.32,h*19/47,translucent?'rgba(41,163,168,.14)':'#284e51','#cfdddf',{'stroke-width':2});
  s.append(svg('circle',{cx:w/2,cy:h*19/47,r:w*6/50,fill:'none',stroke:'#cfdddf','stroke-width':2}));
  const hoop=d.field?.hoop||{x:.5,y:5.25/47},hx=hoop.x*w,hy=hoop.y*h;
  s.append(svg('path',{d:trackerCourtArc(d.league,hoop).map((p,i)=>(i?'L':'M')+' '+p.x*w+' '+p.y*h).join(' '),fill:'none',stroke:'#cfdddf','stroke-width':2}));
  s.append(svg('path',{d:`M ${hx-w*4/50} ${hy} A ${w*4/50} ${h*4/47} 0 0 0 ${hx+w*4/50} ${hy}`,fill:'none',stroke:'#cfdddf','stroke-width':2}));
  s.append(svg('circle',{cx:hx,cy:hy,r:9,fill:'none',stroke:'#f2b96d','stroke-width':3}));line(hx-w*.06,hy-h*.022,hx+w*.06,hy-h*.022,'#f2b96d',{'stroke-width':3});
  s.append(svg('path',{d:`M ${w*.38} ${h} A ${w*.12} ${h*6/47} 0 0 1 ${w*.62} ${h}`,fill:'none',stroke:'#cfdddf','stroke-width':2}));
 }else if(d.kind==='hockey'){
  rect(1,1,w-2,h-2,translucent?'rgba(67,96,115,.22)':'#243b4b','#cfdddf',{rx:w*28/200,ry:h*28/85,'stroke-width':2});
  for(const x of [.375,.625])line(x*w,0,x*w,h,'#69b2e4',{'stroke-width':2});
  for(const x of [.055,.5,.945])line(x*w,0,x*w,h,'#ed8790',{'stroke-width':x===.5?2:1});
  s.append(svg('ellipse',{cx:w/2,cy:h/2,rx:w*15/200,ry:h*15/85,fill:'none',stroke:'#69b2e4','stroke-width':2}));
  for(const x of [.155,.845])for(const y of [20.5/85,64.5/85]){s.append(svg('ellipse',{cx:x*w,cy:y*h,rx:w*15/200,ry:h*15/85,fill:'none',stroke:'#d98690','stroke-width':1.5}));s.append(svg('circle',{cx:x*w,cy:y*h,r:2,fill:'#d98690'}));}
  for(const x of [.35,.65])for(const y of [20.5/85,64.5/85])s.append(svg('circle',{cx:x*w,cy:y*h,r:2,fill:'#d98690'}));
  for(const x of [.055,.945]){const gx=x*w,dir=x<.5?1:-1,ry=h*6/85,rx=w*6/200;s.append(svg('path',{d:`M ${gx} ${h/2-ry} A ${rx} ${ry} 0 0 ${dir>0?1:0} ${gx} ${h/2+ry} Z`,fill:'rgba(105,178,228,.27)',stroke:'#69b2e4','stroke-width':1.5}));rect(dir>0?gx-w*4.5/200:gx,h/2-h*3/85,w*4.5/200,h*6/85,'none','#f4ccd2',{'stroke-width':2});}
 }else{
  const offense=offenseOf(d),defense=defenseOf(d),ez=w/12,X=u=>ez+u*(w-2*ez),top=44,list=trackerFootballRows(d).slice(-8),rowH=(h-top-14)/8;
  rect(1,1,w-2,h-2,footballStrip?'none':translucent?'rgba(35,84,58,.25)':'#193b2c','#73988b',{rx:10,'stroke-width':1.5});
  for(let n=0;n<100;n+=10)if(!footballStrip&&n%20===0)rect(X(n/100),1,(w-2*ez)/10,h-2,'rgba(255,255,255,.025)','none');
  const zone=(x,t,own)=>{rect(x,1,ez-1,h-2,footballStrip?'none':hex(t?.color,own?'#3b5566':'#5b3b45'),'none',{'fill-opacity':translucent?.6:.9});if(t)s.append(svg('text',{x:x+ez/2,y:h/2,'text-anchor':'middle','dominant-baseline':'central',fill:'#fff','font-size':18,'font-weight':750,'letter-spacing':3,transform:`rotate(${own?-90:90} ${x+ez/2} ${h/2})`},t.abbreviation||''));};
  zone(1,offense,true);zone(w-ez,defense,false);
  for(let n=0;n<=100;n+=5)line(X(n/100),1,X(n/100),h-1,n===50?'#b2cdc1':n%10?'#315a45':'#5f8873',{'stroke-width':n===50?2:n%10?1:1.3});
  const hashes=d.league==='College football'?[.375,.625]:[.4421875,.5578125];for(let n=1;n<100;n++)if(n%5)for(const band of hashes)line(X(n/100),h*band-2,X(n/100),h*band+2,'rgba(178,205,193,.28)');
  for(let n=10;n<100;n+=10)s.append(svg('text',{x:X(n/100),y:27,'text-anchor':'middle',fill:'#dcebe3','font-size':20,'font-weight':700,'font-family':'ui-monospace,monospace'},n<=50?n:100-n));
  const state=trackerFootballState(d),gain=state.target;if(gain!==null)line(X(gain),34,X(gain),h-1,'#ffd166',{'stroke-width':footballStrip?4:2,'stroke-dasharray':'7 4','data-field-marker':'target'});
  if(state.ball!==null)line(X(state.ball),34,X(state.ball),h-1,'#ffffff',{'stroke-width':footballStrip?5:2.5,'data-field-marker':'ball'});
  list.forEach((p,i)=>{const y=top+rowH*(i+.5),kind=trackerFootballKind(p),kick=['FG','PAT','Punt','Kickoff'].includes(kind),x1=X(p.start_x),x2=kick?x1:X(p.end_x),yards=trackerFootballYards(p),color=trackerFootballColor(yards,kind);
   const group=svg('g',{'data-play-kind':kind,'data-yardage':yards,'data-start-x':p.start_x,'data-end-x':p.end_x});group.append(svg('title',{},p.text||p.type||'Reported play'));
   if(Math.abs(x2-x1)<4)group.append(svg('circle',{cx:x1,cy:y,r:7,fill:'none',stroke:color,'stroke-width':3}));
   else{const dir=x2>x1?1:-1;group.append(svg('line',{x1,y1:y,x2:x2-dir*5,y2:y,stroke:color,'stroke-width':7,'stroke-linecap':'round'}),svg('path',{d:`M ${x2} ${y} L ${x2-dir*8} ${y-6} L ${x2-dir*8} ${y+6} Z`,fill:color}));}
   group.append(svg('circle',{cx:x1,cy:y,r:3,fill:'none',stroke:'#eaf2ed','stroke-width':1.3}));
   const label=trackerFootballLabel(p),tw=label.length*11.5,hi=Math.max(x1,x2),lo=Math.min(x1,x2),wanted=hi+tw+16>w-ez?lo-tw-12:hi+12,tx=Math.max(ez+4,Math.min(w-ez-tw-4,wanted));
   group.append(svg('text',{x:tx,y:y+6,fill:'#f4f8f5','font-size':19,'font-weight':700,'font-family':'ui-monospace,monospace',style:'filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))'},label));s.append(group);
  });
 }
 const decidingId=completed(d)?points(d).at(-1)?.id:null;
 const allPoints=points(d),latestId=allPoints.at(-1)?.id,pitchLabels=[];
 for(const p of allPoints){
  const baseball=d.kind==='baseball',hockey=d.kind==='hockey',last=p.id===latestId,r=baseball?(d.field?.source==='mlb'&&number(d.field.ball_radius)?d.field.ball_radius*w:18):last?7:5.5,color=baseball?pitchColor(p):teamColor(d,p),x=baseball?p.x*w:Math.max(r+1,Math.min(w-r-1,p.x*w)),y=baseball?p.y*h:Math.max(r+1,Math.min(h-r-1,p.y*h));
  const group=svg('g',{'data-point-id':p.id||'','data-team':p.team_id??'','data-period':p.period??''});group.append(svg('title',{},p.text||p.type||'Reported shot'));
  if(last&&!baseball)group.append(svg('circle',{cx:x,cy:y,r:r+5,fill:'none',stroke:color,'stroke-width':1,opacity:.65}));
  if(baseball&&decidingId&&p.id===decidingId)group.append(svg('circle',{cx:x,cy:y,r:r+8,fill:'none',stroke:'#9fe3c1','stroke-width':4}));
  group.append(svg('circle',{cx:x,cy:y,r,fill:baseball||hockey||p.made===true?color:'none',stroke:baseball?'#173749':color,'stroke-width':baseball?2:2.2}));
  if(baseball){
   const rows=d.plays||[],at=rows.findIndex(row=>String(row.id)===String(p.id)),row=at<0?p:{...p,...rows[at]},identity=pitchIdentity(row,rows[at-1],allPoints.indexOf(p)+1),label=pitchNumberPlacement(x,y,r,pitchLabels);
   group.setAttribute('aria-label',identity.label);group.querySelector('title').textContent=identity.label;group.dataset.labelX=String(label.x);group.dataset.labelY=String(label.y);
   group.append(svg('line',{x1:x,y1:y,x2:label.x,y2:label.y,stroke:'#e3edf6','stroke-width':1.5,opacity:.8}),svg('circle',{cx:label.x,cy:label.y,r:14,fill:'#102b3a',stroke:color,'stroke-width':2}),svg('text',{x:label.x,y:label.y+7,'text-anchor':'middle',fill:'#fff','font-size':22,'font-weight':800},identity.number));
   if(typeof onInspect==='function'){group.dataset.trackerDot=String(p.id);group.setAttribute('role','button');group.setAttribute('tabindex','0');group.style.cursor='pointer';group.append(svg('circle',{cx:label.x,cy:label.y,r:28,fill:'transparent'}));const select=()=>{if(group.isConnected)onInspect(String(p.id));};group.onclick=select;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};}
  }
  if(hockey&&(p.goal===true||/^goal$/i.test(p.type||'')))group.append(svg('circle',{cx:x,cy:y,r:r+4,fill:'none',stroke:'#ffd166','stroke-width':3}));
  s.append(group);
 }

 if(d.kind==='baseball'){const z=d.field?.zone;if(z&&[z.x,z.y,z.width,z.height].every(unit)){const xs=[z.x*w,(z.x+z.width)*w,...points(d).map(p=>p.x*w),...pitchLabels.map(p=>p.x)],ys=[z.y*h,(z.y+z.height)*h,...points(d).map(p=>p.y*h),...pitchLabels.map(p=>p.y)];const pad=48,x0=Math.max(0,Math.min(...xs)-pad),x1=Math.min(w,Math.max(...xs)+pad),y0=Math.max(0,Math.min(...ys)-pad),y1=Math.min(h,Math.max(...ys)+pad),side=Math.max(x1-x0,y1-y0),cx=(x0+x1)/2,cy=(y0+y1)/2;s.setAttribute('viewBox',[cx-side/2,cy-side/2,side,side].map(v=>Math.round(v)).join(' '));}}
 return s;
}
function playList(d,compact){
 const list=el('ol','otv-tracker-plays');for(const p of (d.plays||[]).slice(compact?(d.kind==='baseball'?-4:-1):0)){const row=el('li','otv-tracker-play');if(Number.isInteger(p.number)){const n=el('span','otv-tracker-number',p.number);if(d.kind==='baseball')n.style.backgroundColor=pitchColor(p);row.append(n);}const text=el('span','otv-tracker-play-copy');text.append(el('strong','',p.pitch_type||p.down_distance||p.type||'Play'));if(p.text){const description=el('span','',d.kind==='baseball'?p.type||p.text:p.text);description.title=p.text;text.append(description);}row.append(text);if(number(p.mph))row.append(el('span','',p.mph+' mph'));if(Number.isInteger(p.balls)&&Number.isInteger(p.strikes))row.append(el('span','',p.strikes>=3?'Strikeout':p.balls>=4?'Walk':p.balls+'–'+p.strikes));list.append(row);}return list;
}
function summary(d){const wrap=el('div','otv-tracker-summary');for(const t of d.summary?.teams||[]){const team=(d.teams||[]).find(x=>x.id===t.team_id),row=el('p','');const label=el('strong','',t.name||t.abbreviation||team?.abbreviation||team?.name||'');if(['basketball','hockey'].includes(d.kind)){const swatch=el('span','otv-tracker-team-swatch');swatch.style.backgroundColor=teamColor(d,{team_id:t.team_id});swatch.setAttribute('aria-hidden','true');label.prepend(swatch);}row.append(label);const facts=[];for(const [k,label] of [['fg_made','FG made'],['fg_attempts','FG attempts'],['three_made','3PT made'],['three_attempts','3PT attempts'],['shots_on_goal','shots on goal'],['goals','goals']])if(number(t[k])&&!(d.kind==='hockey'&&k==='goals'))facts.push(t[k]+' '+label);if(facts.length)row.append(document.createTextNode(' · '+facts.join(' · ')));wrap.append(row);}if(typeof d.summary?.description==='string')wrap.append(el('p','',d.summary.description));if(d.kind==='baseball'){const facts=[];if(number(d.summary?.pitch_count))facts.push(d.summary.pitch_count+(Number(d.summary.pitch_count)===1?' pitch':' pitches'));if(!completed(d)&&d.summary?.balls<4&&d.summary?.strikes<3&&Number.isInteger(d.summary?.balls)&&Number.isInteger(d.summary?.strikes))facts.push('Count '+d.summary.balls+'–'+d.summary.strikes);if(d.summary?.outcome&&!completed(d))facts.push(d.summary.outcome);if(facts.length)wrap.append(el('p','',facts.join(' · ')));}return wrap;}
const shotFilter={event:null,team:'',period:''};
function shotFilters(d,map){if(shotFilter.event!==d.event_id){shotFilter.event=d.event_id;shotFilter.team='';shotFilter.period='';}const bar=el('div','otv-shot-filters');const apply=()=>{for(const n of map.querySelectorAll('[data-point-id]'))n.style.display=(shotFilter.team&&n.dataset.team!==shotFilter.team)||(shotFilter.period&&n.dataset.period!==shotFilter.period)?'none':'';for(const b of bar.querySelectorAll('button'))b.setAttribute('aria-pressed',String(shotFilter[b.dataset.key]===b.dataset.value));};const chip=(key,value,label)=>{const b=el('button','otv-chip',label);b.type='button';b.dataset.key=key;b.dataset.value=value;b.onclick=()=>{shotFilter[key]=value;apply();};return b;};bar.append(chip('team','','Both teams'));for(const t of (d.teams||[]).slice().sort((a,b)=>Number(a.side==='home')-Number(b.side==='home')))bar.append(chip('team',String(t.id),t.abbreviation||t.name));const periods=[...new Set(points(d).map(p=>p.period).filter(Number.isInteger))].sort((a,b)=>a-b);if(periods.length>1){bar.append(el('span','otv-chip-gap'),chip('period','','All quarters'));for(const q of periods)bar.append(chip('period',String(q),q<=4?'Q'+q:'OT'+(q-4)));}apply();return bar;}
function renderFootballLive(d){
 const state=trackerFootballState(d),section=el('section','otv-tracker-content otv-football-card otv-football-live is-compact');section.dataset.kind='football';
 const now=el('div','otv-football-live-now');
 if(state.team)now.append(el('strong','otv-football-live-team',state.team.abbreviation||state.team.name),el('span','otv-football-direction','→'));
 now.append(el('strong','otv-football-live-down',state.down|| (d.state==='final'?'Final':'Situation unavailable')));section.append(now);
 if(state.spot)section.append(el('p','otv-football-live-spot',(state.saved?'Last reported ball':'Ball')+' at '+state.spot));
 if(drawable(d)&&state.ball!==null){const chart=field({...d,plays:[],points:[]},{translucent:true,footballStrip:true});chart.setAttribute('aria-label','Reported field position. Offense attacks right. White: ball. Gold: first down target.');section.append(chart);const key=el('div','otv-football-live-key');key.append(el('span','otv-football-ball','Ball'));if(state.target!==null)key.append(el('span','otv-football-target',state.down.endsWith('Goal')?'Goal line':'First down'));key.append(el('span','otv-football-direction-label','Attacks →'));section.append(key);}
 const latest=(d.plays||[]).filter(p=>p&&typeof p.text==='string'&&p.text&&!/timeout|end (of )?(period|quarter|half|game|regulation)|two-minute|coin toss/i.test(p.type||'')).at(-1);
 if(latest){const result=el('div','otv-football-live-result'),kind=trackerFootballKind(latest);let label=trackerFootballLabel(latest).replace(/^Inc\b/,'Incomplete').replace(/^INT\b/,'Interception').replace(/^FG\b/,'Field goal').replace(/^PAT\b/,'Extra point').replace(/^TD\b/,'Touchdown');if(/[+−]\d+$/.test(label))label+=' yd';result.style.setProperty('--football-impact',trackerFootballColor(trackerFootballYards(latest),kind));result.title=latest.text;result.append(el('small','','Last reported play'),el('strong','',label));section.append(result);}
 else section.append(el('p','otv-football-live-empty','Waiting for a reported play'));
 section.append(el('small','otv-football-live-note',state.saved?'Saved report':state.estimated?'Reported estimate':'Reported information'));return section;
}
function footballDriveOverview(d,state){
 const rows=trackerFootballRows(d),team=state.drive||state.team,drive={team_id:team?.id,start_x:rows[0]?.start_x,end_x:rows.at(-1)?.end_x,play_details:rows},map=trackerDriveSvg(d,drive,svg);
 if(!map)return null;map.classList.add('otv-tracker-map','otv-drive-overview');map.setAttribute('aria-label','Drive progress. Offense attacks right; select a play below to inspect it.');
 for(const p of rows){const kind=trackerFootballKind(p),end=['FG','PAT','Punt','Kickoff'].includes(kind)?p.start_x:p.end_x;if(!Number.isFinite(end))continue;const dot=svg('circle',{cx:50+end*500,cy:22,r:4,fill:trackerFootballColor(trackerFootballYards(p),kind),stroke:'#eafbf5','stroke-width':1.5});dot.append(svg('title',{},p.text));map.append(dot);}
 if(state.target!==null)map.append(svg('line',{x1:50+state.target*500,x2:50+state.target*500,y1:2,y2:42,stroke:'#ffd166','stroke-width':2}));return window.OrbitalSportsGlass?.decorateDrive(map)||map;
}
function footballDriveMetrics(d){
 const parsed=/^(\d+) plays?, (-?\d+) yards?, (\d{1,2}:\d{2})$/.exec(d.summary?.description||'');
 return parsed?[['Plays',parsed[1]],['Yards',parsed[2]],['Drive time',parsed[3]]]:[];
}
function renderFootball(d,{compact=false,desktop=false}={}){
 if(compact)return renderFootballLive(d);
 d=trackerFootballReportedView(d);
 const state=trackerFootballState(d),section=el('section','otv-tracker-content otv-football-card'+(compact?' is-compact':''));section.dataset.kind='football';
 const heading=el('div','otv-football-heading');heading.append(el('h3','otv-panel-label',state.drive?(state.drive.abbreviation||state.drive.name)+' drive':'Football tracker'),el('small','otv-football-report',(state.saved?'Saved report':state.estimated?'Reported estimate':'Reported')+(state.clock&&state.clock!=='Final'?' · '+state.clock:'')));section.append(heading);
 const situation=el('div','otv-football-state');
 if(compact){const score=el('div','otv-football-score');for(const side of ['away','home']){const team=(d.teams||[]).find(t=>t.side===side);if(!team)continue;const item=el('span','otv-football-score-team');item.append(el('span','',team.abbreviation||team.name),el('b','',team.score==null||team.score===''?'—':String(team.score)));score.append(item);}situation.append(score);}
 const now=el('div','otv-football-now');if(state.team)now.append(el('span','otv-football-possession',(state.team.abbreviation||state.team.name)+(state.saved?' last reported possession':' ball')));
 if(state.down)now.append(el('strong','otv-football-down',state.down));if(state.spot)now.append(el('span','otv-football-spot','at '+state.spot));
 if(!state.down)now.append(el('strong','otv-football-down',d.state==='final'?'Final':d.summary?.result||'Situation not reported'));situation.append(now);const metrics=el('div','otv-drive-metrics');for(const [label,value] of footballDriveMetrics(d)){const metric=el('div','');metric.append(el('strong','',value),el('small','',label));metrics.append(metric);}if(metrics.children.length)situation.append(metrics);section.append(situation);
 const layout=el('div','otv-tracker-layout'),visual=el('div','otv-football-visual');
 if(drawable(d)){const chart=footballDriveOverview(d,state)||field(d,{translucent:compact});visual.append(chart);if(state.ball!==null){const markers=el('p','otv-football-markers');markers.append(el('span','otv-football-ball','Ball · '+state.spot));if(state.target!==null)markers.append(el('span','otv-football-target',state.down.endsWith('Goal')?'Target · goal line':'Target · '+Math.round((state.target-state.ball)*100)+' yd to first down'));visual.append(markers);}}
 else visual.append(el('p','otv-tracker-unavailable','Play map unavailable · reported details below'));
 layout.append(visual);const details=el('div','otv-tracker-details');
 const rows=(d.plays||[]).filter(p=>p&&typeof p.text==='string'&&p.text),list=playList({...d,plays:rows},false),byId=new Map(rows.map(p=>[String(p.id),p]));
 for(const [i,row] of [...list.children].entries())row.dataset.footballPlayId=String(rows[i].id);
 const latest=rows.at(-1);if(compact){if(latest){const result=el('div','otv-football-recent');result.append(el('small','otv-panel-label','Latest report'),el('strong','',trackerFootballLabel(latest)),el('p','otv-football-result',latest.text));result.style.setProperty('--football-impact',trackerFootballColor(trackerFootballYards(latest),trackerFootballKind(latest)));details.append(result);}else details.append(el('p','otv-football-result','No plays reported yet'));details.append(summary(d));}
 else{
  list.append(...[...list.children].reverse());list.firstElementChild?.classList.add('otv-latest-play');section.classList.toggle('otv-newest-first',desktop);
  details.append(el('h4','otv-panel-label','Recent plays'));
  if(rows.length>8){const recent=el('ol','otv-tracker-plays');for(const row of [...list.children].slice(0,8))recent.append(row.cloneNode(true));const older=el('details','otv-earlier-plays');older.append(el('summary','','Show all '+rows.length+' reported plays'),list);details.append(recent,older);}else details.append(list);
  {for(const row of details.querySelectorAll('.otv-tracker-play')){const play=byId.get(row.dataset.footballPlayId);if(!play)continue;const select=el('button','otv-play-select');select.type='button';select.dataset.playId=String(play.id);select.setAttribute('aria-label','Show play: '+play.text);select.setAttribute('aria-pressed','false');select.append(...row.childNodes);row.append(select);select.disabled=!unit(play.start_x)||!unit(play.end_x);select.onclick=()=>{const map=visual.querySelector('.otv-tracker-map');if(!map)return;map.replaceWith(field({...d,plays:[play],field:{...d.field,ball_x:null},situation:null}));visual.querySelector('.otv-football-markers')?.remove();for(const b of details.querySelectorAll('.otv-play-select'))b.setAttribute('aria-pressed',String(b===select));};}
   const reset=el('button','otv-category','Show whole drive');reset.type='button';reset.onclick=()=>{const replacement=renderFootball(d,{compact,desktop}),nextVisual=replacement.querySelector('.otv-football-visual');visual.replaceChildren(...nextVisual.childNodes);for(const b of details.querySelectorAll('.otv-play-select'))b.setAttribute('aria-pressed','false');};details.append(reset);
  }
 }
 layout.append(details);section.append(layout);
 const legend=el('p','otv-tracker-legend');for(const [name,color] of [['Gain','#63e6b0'],['Loss','#ff8392'],['No gain / kick','#c7d5e0'],['Turnover','#ffbd69']]){const item=el('span',''),dot=el('span','otv-tracker-dot');dot.style.backgroundColor=color;item.append(dot,document.createTextNode(name));legend.append(item);}section.append(legend);
 if(!compact)section.append(el('p','otv-tracker-calibration','Offense attacks → · kicks mark the kick location'));
 if(d.stale)section.append(el('p','otv-tracker-delayed','Saved reported information · retrying automatically'));
 if(d.truncated)section.append(el('p','otv-tracker-calibration','Chart shows the latest reported plays.'));return section;
}

function render(d,{compact=false,previousId=null,onInspect=null,desktop=innerWidth>=1000&&!document.documentElement.classList.contains('layout-mobile')}={}){
 if(d.kind==='baseball'&&!compact&&window.TelevisionBaseballGameView)return window.TelevisionBaseballGameView.create(d,{onInspect});
 if(d.kind==='football')return renderFootball(d,{compact,desktop});
 const section=el('section','otv-tracker-content'+(compact?' is-compact':''));section.dataset.kind=d.kind||'unknown';if(d.direction_derived)section.dataset.directionDerived='true';const title={baseball:completed(d)?'Last at-bat':'This at-bat',football:offenseOf(d)?(offenseOf(d).abbreviation||offenseOf(d).name)+' drive':'Drive chart',basketball:'Shot chart',hockey:'Shot map',soccer:'Match commentary'}[d.kind]||'Game tracker';section.append(el('h3','otv-panel-label',title));if(d.kind==='football'&&!compact&&drawable(d)){const pos=possession(d);if(pos)section.append(pos);}if(completed(d)&&d.summary?.outcome)section.append(el('p','otv-tracker-outcome',d.summary.outcome));
 const layout=el('div','otv-tracker-layout');if(drawable(d)){const map=field(d,{translucent:compact,onInspect});layout.append(map);const latest=points(d).at(-1)?.id;if(previousId&&latest&&latest!==previousId&&d.kind==='basketball')for(const n of map.querySelectorAll('[data-point-id]'))if(n.dataset.pointId===latest)n.classList.add('otv-tracker-new');}else if(d.kind!=='soccer')layout.append(el('p','otv-tracker-unavailable',d.stale?'Saved tracker data · refresh for the latest':d.unavailable_reason||'Tracking unavailable'));
 const details=el('div','otv-tracker-details');const plays=playList(d,compact);if(desktop&&!compact&&d.kind!=='baseball'){plays.append(...[...plays.children].reverse());plays.firstElementChild?.classList.add('otv-latest-play');section.classList.add('otv-newest-first');}if(!compact&&d.kind!=='baseball'&&plays.children.length>3){const older=el('details','otv-earlier-plays'),label=el('summary','','Show all '+plays.children.length+' reported plays'),recent=el('ol','otv-tracker-plays');for(const row of (desktop?[...plays.children].slice(0,3):[...plays.children].slice(-3)))recent.append(row.cloneNode(true));older.append(label,plays);details.append(summary(d),el('h4','otv-panel-label',desktop?'Latest play · newest first':'Recent plays'),recent,older);}else details.append(plays,summary(d));layout.append(details);section.append(layout);if(d.kind==='football'&&drawable(d)){const legend=el('p','otv-tracker-legend');for(const [name,color] of [['Gain','#63e6b0'],['Loss','#ff8392'],['No gain / kick','#c7d5e0'],['Turnover','#ffbd69']]){const k=el('span',''),dot=el('span','otv-tracker-dot');dot.style.backgroundColor=color;k.append(dot,document.createTextNode(name));legend.append(k);}section.append(legend);}if(d.kind==='baseball'&&drawable(d)){const legend=el('p','otv-tracker-legend');for(const [name,color] of [['Strike','#ff5867'],['Ball','#79dd9e'],['Foul','#ffcd57'],['Two-strike foul','#c39aff'],['In play','#f4f7fb']]){const key=el('span','');const dot=el('span','otv-tracker-dot');dot.style.backgroundColor=color;key.append(dot,document.createTextNode(name));legend.append(key);}section.append(legend);}if(d.kind==='basketball'){section.append(el('p','otv-tracker-calibration','Filled: made · Hollow: missed'));const map=section.querySelector('.otv-tracker-map');if(map&&!compact)section.insertBefore(shotFilters(d,map),section.querySelector('.otv-tracker-layout'));}if(d.kind==='hockey')section.append(el('p','otv-tracker-calibration','Gold ring: goal'));if(d.calibration?.note){const brief=d.kind==='football'?'Whole drive, oldest first · offense attacks right'+(trackerLineToGain(d)!==null&&d.state==='live'?' · white: ball · gold: first down':''):d.kind==='baseball'&&d.field?.zone?.approximate?(compact?'Approx. strike zone':'Catcher\u2019s view · approximate strike zone, not adjusted for batter height'):compact&&d.direction_derived?'Ends normalized from shot locations':d.calibration.note;const note=el('p','otv-tracker-calibration',brief);note.title=d.calibration.note;section.append(note);}if(compact&&d.kind==='baseball'&&(d.plays||[]).length>4){const all=el('details','otv-all-pitches');all.append(el('summary','', 'All '+d.plays.length+' pitches'),playList(d,false));section.append(all);}if(desktop&&!compact&&d.kind==='football'){const candidates=(d.plays||[]).slice().reverse();for(const list of section.querySelectorAll('.otv-tracker-plays'))for(const [i,row] of [...list.children].entries()){const play=candidates[i];if(!play)continue;const select=el('button','otv-play-select');select.type='button';select.dataset.playId=String(play.id||i);select.setAttribute('aria-label','Show play: '+(play.text||play.type||'Play'));select.append(...row.childNodes);row.append(select);select.onclick=()=>{const map=section.querySelector('.otv-tracker-map');if(!map||!unit(play.start_x)||!unit(play.end_x))return;map.replaceWith(field({...d,plays:[play],field:{...d.field,ball_x:null}}));for(const b of section.querySelectorAll('.otv-play-select'))b.setAttribute('aria-pressed',String(b===select));};select.disabled=!unit(play.start_x)||!unit(play.end_x);}const reset=el('button','otv-category','Show whole drive');reset.type='button';reset.onclick=()=>{const map=section.querySelector('.otv-tracker-map');if(map)map.replaceWith(field(d));for(const b of section.querySelectorAll('.otv-play-select'))b.setAttribute('aria-pressed','false');};details.append(reset);}if(d.truncated)section.append(el('p','otv-tracker-calibration','Chart shows the latest reported plays.'));return section;
}
function createTrackerScheduler(limit=4,maxQueued=32){
 let active=0;const queue=[];
 function drain(){while(active<limit&&queue.length){const job=queue.shift();if(!job.valid()){job.reject(Error('Tracker context changed'));continue;}active++;Promise.resolve().then(()=>{if(!job.valid())throw Error('Tracker context changed');return job.task();}).then(job.resolve,job.reject).finally(()=>{active--;drain();});}}
 return {run(task,valid=()=>true){return new Promise((resolve,reject)=>{if(queue.length>=maxQueued){reject(Error('Tracker queue full'));return;}queue.push({task,valid,resolve,reject});drain();});},snapshot:()=>({active,queued:queue.length})};
}
const trackerRequests=createTrackerScheduler();
const cache=new Map(),inflight=new Map();
const ownership=window.OrbitalTrackerOwnership;
let transportScope=null,transportOff=null;
function trackerContext(){const scope=ownership.capture();if(scope!==transportScope){transportOff?.();cache.clear();inflight.clear();transportScope=scope;transportOff=scope?ownership.observe(scope,()=>{if(transportScope===scope){cache.clear();inflight.clear();transportScope=null;transportOff=null;}}):null;}return scope;}
const trackerCacheKey=(event,scope=trackerContext())=>ownership.key(scope)+':'+key(event);

function trackerReply(event,raw,scope,context){if(context==='viewer_source'||!window.OrbitalGameStore?.supported(event)||!Object.hasOwn(raw||{},'game_snapshot'))return raw;const latest=window.OrbitalGameStore.latest(event,{scope});if(!latest)throw Error('Latest official presentation unavailable');return latest;}
async function fetchTracker(event,maxAgeMs=3500,context='latest_page'){const scope=trackerContext();if(!scope)throw Error('Sign in to load trackers');const k=trackerCacheKey(event,scope),old=cache.get(k);if(old&&old.scope===scope&&Date.now()-old.at<maxAgeMs)return trackerReply(event,old.value,scope,context);if(inflight.has(k)){const result=await inflight.get(k);return trackerReply(event,result,scope,context);}const a=window.ApiClient,eventId=String(event.id||event.event_id),league=event.league;
 const current=()=>scope===transportScope&&ownership.accepts(scope)&&window.ApiClient===a;
 let fetchStarted;const promise=trackerRequests.run(()=>{fetchStarted=performance.now();return a.ajax({type:'GET',url:a.getUrl('sports/api/tracker',{event:eventId,league,date:new Date(event.start||Date.now()).toLocaleDateString('en-CA',{timeZone:'America/Chicago'})}),dataType:'json',timeout:6000});},current).then(d=>{if(!current())throw Error('Tracker context changed');if(String(d.event_id)!==eventId||d.league!==league)throw Error('Tracker event mismatch');const elapsed=(performance.now()-fetchStarted)/1000;d={...d,tracker_response_elapsed_s:elapsed};if(maxAgeMs<=500&&elapsed>1)d={...d,syncassist:undefined};if(window.OrbitalGameStore?.supported(event))window.OrbitalGameStore.accept(event,d,{scope});cache.set(k,{scope,at:Date.now(),value:d});while(cache.size>32)cache.delete(cache.keys().next().value);return d;}).finally(()=>{if(inflight.get(k)===promise)inflight.delete(k);});inflight.set(k,promise);const result=await promise;return trackerReply(event,result,scope,context);
}
function visible(n,ignoreModal=false){const modal=document.querySelector('dialog[open]');if(!ignoreModal&&modal&&!modal.contains(n))return false;const b=n.getBoundingClientRect();return !document.hidden&&n.isConnected&&b.width>0&&b.height>0&&b.bottom>0&&b.top<innerHeight;}
function trackerPollingPolicy(context,interval,maxAgeMs){return context==='latest_page'?{interval:1000,maxAgeMs:250}:{interval,maxAgeMs};}
function watch(event,slot,update,interval=4000,{ignoreModal=false,maxAgeMs=3500,context='latest_page',initialRequest=false}={}){({interval,maxAgeMs}=trackerPollingPolicy(context,interval,maxAgeMs));let needsInitial=initialRequest,cancelled=false,running=false,timer,previousId=null,run=0,seen=null,ownerOff=null,attached=false;const attachDeadline=performance.now()+5000,scope=trackerContext();
 const current=()=>!cancelled&&ownership.accepts(scope)&&scope===transportScope&&slot.isConnected;
 const stop=()=>{if(cancelled)return;cancelled=true;run++;clearTimeout(timer);seen?.disconnect();ownerOff?.();document.removeEventListener('visibilitychange',resume);};
 const tick=async()=>{if(running)return;clearTimeout(timer);if(!slot.isConnected&&!attached&&performance.now()<attachDeadline){if(cancelled||!ownership.accepts(scope)||scope!==transportScope){stop();return;}timer=setTimeout(tick,50);return;}if(slot.isConnected)attached=true;if(!current()){stop();return;}const tickStarted=performance.now();running=true;if(visible(slot,ignoreModal)||needsInitial){needsInitial=false;const serial=++run;try{const d=await fetchTracker(event,maxAgeMs,context);if(current()&&serial===run){update(d,previousId);previousId=points(d).at(-1)?.id||previousId;}else stop();}catch{if(current()){const saved=context==='latest_page'&&window.OrbitalGameStore?.supported(event)?window.OrbitalGameStore.health(event,'delayed',{scope}):null;update(saved||{event_id:event.id,kind:'unknown',unavailable_reason:'Tracker temporarily unavailable',plays:[]});}else stop();}}running=false;if(current())timer=setTimeout(tick,visible(slot,ignoreModal)?(maxAgeMs<=500?Math.max(50,interval-(performance.now()-tickStarted)):interval):Math.max(10000,interval));else stop();};
 const resume=()=>{if(!document.hidden)tick();};document.addEventListener('visibilitychange',resume);seen=typeof IntersectionObserver==='function'?new IntersectionObserver(es=>{if(es.some(x=>x.isIntersecting))tick();}):null;seen?.observe(slot);ownerOff=ownership.observe(scope,stop);tick();return stop;}
const dialogs=new WeakMap(),SIMPLE_TRACKER=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
const SKELETON_KIND={MLB:'baseball',NFL:'football','College football':'football',NBA:'basketball',WNBA:'basketball',NHL:'hockey',MLS:'soccer'};
function skeletonView(event,compact=false,allowSaved=true){const recent=allowSaved?cache.get(trackerCacheKey(event)):null;const saved=window.OrbitalGameStore?.supported(event)?window.OrbitalGameStore.latest(event):recent?.value;if(recent&&Date.now()-recent.at<120000&&saved)return render(saved,{compact});const kind=SKELETON_KIND[event.league];
 const d={event_id:event.id||event.event_id,league:event.league,kind,skeleton:true,tracking_available:kind!=='soccer',geometry_available:kind!=='soccer',stale:false,points:[],plays:[],teams:[],summary:{},
  field:kind==='baseball'?{width:1,height:1,physical_width:170,physical_height:140,zone:{x:48/170,y:44/140,width:56/170,height:44/140,approximate:true}}:kind==='basketball'?{physical_width:50,physical_height:47,hoop:{x:.5,y:5.25/47}}:{}};
 const section=render(d,{compact});section.classList.add('is-loading');section.setAttribute('aria-busy','true');
 section.querySelector('.otv-tracker-details')?.replaceChildren(el('p','otv-tracker-calibration','Loading live '+({baseball:'pitches',basketball:'shots',hockey:'shots',football:'drives'}[kind]||'data')+'\u2026'));return section;}
let historyDialogSerial=0;
function mountGame(container,event){if(window.ApiClient?.getCurrentUserId?.()===SIMPLE_TRACKER)return;const dialog=container.closest('dialog');if(!dialog||!['MLB','NFL','College football','NBA','WNBA','NHL','MLS'].includes(event.league))return;const execution=trackerContext();let state=dialogs.get(dialog);if(state&&state.execution!==execution){state.stop?.();state.slot.remove();dialogs.delete(dialog);state=null;}if(!state){const slot=el('div','otv-tracker-game');const cached=cache.get(trackerCacheKey(event));state={execution,slot,historyScope:[String(execution),String(event.id),event.league,'reported-dialog',++historyDialogSerial],payload:window.OrbitalGameStore?.supported(event)?window.OrbitalGameStore.latest(event,{scope:execution}):cached&&cached.scope===execution&&Date.now()-cached.at<120000?cached.value:null};dialogs.set(dialog,state);slot.append(skeletonView(event,false,container.dataset.contextLoading!=='true'));const opened=state;opened.history=window.OrbitalHistoryRuntime?.create(opened.historyScope)||null;const dispose=()=>{opened.history?.clear();opened.stop?.();opened.ownerOff?.();opened.payload=null;opened.slot.remove();if(dialogs.get(dialog)===opened)dialogs.delete(dialog);};opened.ownerOff=ownership.observe(execution,dispose);dialog.addEventListener('close',dispose,{once:true});}
 const layout=container.querySelector('.otv-context-layout')||container;layout.prepend(state.slot);
 const paint=(d,previousId)=>{
 if(!ownership.accepts(state.execution)||!state.slot.isConnected||!dialog.isConnected||!container.isConnected)return;
 if(container.dataset.contextLoading==='true'){state.payload=d;return;}
 if(d.kind==='unknown'&&state.payload?.kind&&state.payload.kind!=='unknown'){
  state.delayed=true;
  let notice=state.slot.querySelector('.otv-tracker-delayed');if(!notice){notice=el('p','otv-tracker-delayed','Updates delayed · showing the last received plays; retrying automatically');notice.setAttribute('role','status');state.slot.prepend(notice);}return;
 }
 if(!state.delayed)state.slot.querySelector('.otv-tracker-delayed')?.remove();
 const signature=JSON.stringify({...d,fetched_at:undefined,source_updated_at:undefined});
 if(state.signature===signature&&state.slot.querySelector('.otv-tracker-content')){
  const incoming=container.querySelector('.otv-game-insight>.otv-insight-panel:not(.otv-last-play)');
  if(incoming){state.slot.querySelector(':scope>.otv-insight-panel')?.remove();if(d.kind==='football')incoming.remove();else state.slot.prepend(incoming);}return;
 }
 const chosen=state.slot.querySelector('.otv-play-select[aria-pressed=true]')?.dataset.playId;
 const focused=state.slot.contains(document.activeElement)?document.activeElement?.dataset.playId:null;
 const expanded=!!state.slot.querySelector('.otv-earlier-plays[open]'),scroll=dialog.scrollTop;
 state.payload=d;state.signature=signature;const oldDiamond=[...container.querySelectorAll('.otv-game-graphic')].find(n=>!state.slot.contains(n))||state.slot.querySelector('.otv-game-graphic');const keptSituation=state.slot.querySelector(':scope>.otv-insight-panel');const nextView=render(d,{previousId});if(d.kind==='football'){const oldMap=state.slot.querySelector('.otv-football-visual svg'),newMap=nextView.querySelector('.otv-football-visual svg');if(oldMap&&newMap)newMap.replaceWith(reconcileField(oldMap,newMap));}state.slot.replaceChildren(nextView);if(d.kind==='baseball'&&state.slot.querySelector('.otv-baseball-game')){oldDiamond?.remove();}else if(d.kind==='baseball'&&oldDiamond){const row=state.slot.querySelector('.otv-tracker-layout');row.classList.add('has-diamond');row.insertBefore(oldDiamond,row.querySelector('.otv-tracker-details'));}else if(d.kind==='football'&&state.slot.querySelector('.otv-football-state')){oldDiamond?.remove();}else if(oldDiamond){/* Sept 26: the numbers (down/to go/ball spot, period/clock) sit directly under the tracker graphic; no second picture. */const numbers=oldDiamond.querySelector('.otv-field-captionline'),map=state.slot.querySelector('.otv-tracker-map');if(numbers&&map){const visual=el('div','otv-tracker-visual');map.replaceWith(visual);visual.append(map,numbers);oldDiamond.remove();}else state.slot.append(oldDiamond);}else if(d.kind==='football'&&d.situation){/* Sept 26: scoreboard sent no situation; use the tracker's latest play end state. */const map=state.slot.querySelector('.otv-tracker-map'),sit=d.situation;if(map){const cap=el('figcaption','otv-field-captionline');for(const [label,value] of [['Down',sit.down],['To go',sit.distance===0?'Goal':sit.distance],['Ball spot',sit.spot]]){const m=el('div','otv-game-metric');m.append(el('span','',label),el('strong','',String(value)));cap.append(m);}const visual=el('div','otv-tracker-visual');map.replaceWith(visual);visual.append(map,cap);}}/* Sept 26: the game situation reads first, above the graphic. */const situation=container.querySelector('.otv-game-insight>.otv-insight-panel:not(.otv-last-play)')||keptSituation;if(situation&&d.kind==='football'){situation.remove();}else if(situation){if(d.tracking_available)situation.querySelector('.otv-situation-note')?.remove();const offense=(d.teams||[]).find(t=>t.id===d.summary?.team_id);if(d.kind==='football'&&/^#[0-9a-f]{6}$/i.test(offense?.color||''))situation.style.setProperty('--otv-accent',offense.color);if(d.kind==='football'&&d.situation&&!situation.querySelector('.otv-situation-big')){const sit=d.situation,n=Number(sit.down),ord=n+(['th','st','nd','rd'][n]||'th');const big=el('div','otv-situation-big');big.append(el('strong','otv-situation-down',ord+' & '+(sit.distance===0?'Goal':sit.distance)),el('span','otv-situation-spot','at '+sit.spot));situation.querySelector('.otv-situation-head')?.after(big);situation.querySelector('.otv-situation-sub')?.remove();}state.slot.prepend(situation);}
 if(expanded)state.slot.querySelector('.otv-earlier-plays')?.setAttribute('open','');
 if(chosen)[...state.slot.querySelectorAll('.otv-play-select')].find(b=>b.dataset.playId===chosen)?.click();
 if(focused)[...state.slot.querySelectorAll('.otv-play-select')].find(b=>b.dataset.playId===focused)?.focus({preventScroll:true});
 if(chosen||focused||expanded)dialog.scrollTop=scroll;
  };if(state.payload)paint(state.payload);if(!state.stop)state.stop=watch(event,state.slot,(d,previousId)=>{if(d.kind!=='unknown')state.delayed=false;paint(d,previousId);});
}
// Reconcile the drawing in place: retain the field and unchanged SVG marks.
function reconcileField(current,fresh){
 if(!current||current.namespaceURI!==fresh.namespaceURI)return fresh;
 function sync(old,next){
  for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name))old.removeAttribute(attr.name);
  for(const attr of [...next.attributes])if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
  const before=[...old.childNodes],after=[...next.childNodes];
  for(let i=0;i<after.length;i++){const a=before[i],b=after[i];if(!a){old.append(b);continue;}if(a.nodeType!==b.nodeType||a.nodeName!==b.nodeName){a.replaceWith(b);continue;}if(a.nodeType===3){if(a.nodeValue!==b.nodeValue)a.nodeValue=b.nodeValue;}else sync(a,b);}
  for(let i=after.length;i<before.length;i++)before[i].remove();
 }
 sync(current,fresh);return current;
}
function updateCardField(current,data){const fresh=field(data);fresh.classList.add('otv-card-field');return reconcileField(current,fresh);}
const preparedTrackerFields=new Map();
function previewField(event){const kind=SKELETON_KIND[event.league];if(preparedTrackerFields.has(kind))return preparedTrackerFields.get(kind).cloneNode(true);if(!['football','baseball','basketball','hockey'].includes(kind))return null;const geometry=kind==='baseball'?{physical_width:170,physical_height:140,zone:{x:48/170,y:44/140,width:56/170,height:44/140,approximate:true}}:kind==='basketball'?{physical_width:50,physical_height:47,hoop:{x:.5,y:5.25/47}}:{};const chart=field({kind,league:event.league,teams:[],summary:{},situation:{},field:geometry,plays:[],points:[]});chart.classList.add('otv-card-field');chart.dataset.previewKind=kind;chart.setAttribute('aria-label',kind+' tracker · waiting for reported plays');preparedTrackerFields.set(kind,chart.cloneNode(true));return chart;}
// Geometry only: no scores, rows, accounts, network requests or media sessions.
(window.requestIdleCallback||((fn)=>setTimeout(fn,0)))(()=>{for(const league of ['NFL','MLB','NBA','NHL'])previewField({league});});
window.TelevisionTrackers={...model,reconcileField,previewField,updateCardField,createScheduler:createTrackerScheduler,render,mountGame,fetchTracker,watch,skeletonView,cardField:(d,options={})=>{const chart=field(d,options);chart.classList.add('otv-card-field');return chart;}};
})();

/* Official reported baseball state; estimates never grant picture authority. */
(function(root){'use strict';
const finite=v=>typeof v==='number'&&Number.isFinite(v),integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const copy=v=>JSON.parse(JSON.stringify(v));
const displayAt=p=>p.pitch===true&&finite(p.estimated_at)&&p.estimated_at>=p.at&&p.estimated_at<=p.at+3?Math.min(p.estimated_at,finite(p.end_at)&&p.end_at>=p.at?p.end_at:p.estimated_at):p.at;
function estimatedCutoff(state,now){
 if(!state?.available||!finite(state.cutoff)||!finite(now))return null;
 // The media clock already freezes on pause/stall and resets on owner/seek.
 // An ESPN history ceiling cannot cap a separate fresh MLB report lane.
 // Explicit picture holds still freeze both lanes at the released cutoff.
 const at=state.holding===true?state.cutoff:finite(state.estimated_cutoff)?state.estimated_cutoff:state.cutoff;
 return Math.min(at,now);
}
function lane(data,now){
 const v=data?.reported_mlb;
 const checked=v?.freshness_checked_at??v?.observed_at;
 if(data?.kind!=='baseball'||data.league!=='MLB'||!v||v.schema!==1||v.source!=='MLB'||String(v.event_id)!==String(data.event_id)||!Number.isSafeInteger(v.game_pk)||v.game_pk<=0||v.stale===true||!finite(now)||!finite(v.observed_at)||!finite(checked)||checked<v.observed_at||checked>now+1||v.observed_at>now+1||now-checked>15||v.exact_picture_alignment===true)return null;
 const rows=v.timeline;if(!Array.isArray(rows)||!rows.length||rows.length>4096)return null;
 const seen=new Set();let last=-Infinity;
 for(const p of rows){if(!p||typeof p.id!=='string'||!/^mlb[-_]/.test(p.id)||p.id.length>96||seen.has(p.id)||!finite(p.at)||p.at<=0||p.at>now+1||p.at<last||typeof p.text!=='string'||p.text.length>400||![null,undefined,'inning_start','pitch','result','action','inning_end','at_bat_start'].includes(p.stage))return null;seen.add(p.id);last=p.at;
  if(p.pitch===true&&p.in_play===true&&p.text!=='In play')return null;
  if(p.bases!=null&&(!Array.isArray(p.bases)||p.bases.length>3||new Set(p.bases).size!==p.bases.length||!p.bases.every(n=>integer(n,3)&&n>=1)))return null;
 }
 return v;
}
function source(data,{now,cutoff=null}={}){
 const v=lane(data,now);if(!v||cutoff!==null&&!finite(cutoff))return null;
 const rows=v.timeline.filter(p=>cutoff===null||displayAt(p)<=cutoff);if(!rows.length)return null;
 const terminalId=data.reported_mlb_selected===true?data.reported_mlb_terminal_id:v.timeline.at(-1)?.id;
 return {...data,state:'live',timeline:copy(rows),timeline_complete:true,plays:[],points:[],recent:[],summary:{},situation:null,reported_mlb_selected:true,reported_mlb_terminal_id:terminalId,reported_source:'MLB',reference_estimated:true,estimated:true,exact:false,currentDecoderProof:false,occurrenceAuthority:false,carrierAuthority:false,physicalDisplayProven:false};
}
function reduce(data,{now,cutoff=null}={}){
 const d=source(data,{now,cutoff});if(!d)return null;
 const rows=d.timeline,last=rows.at(-1),pitch=rows.findLast(p=>p.pitch===true&&p.at_bat),bat=pitch?.at_bat;
 const pitches=[...new Map(rows.filter(p=>p.pitch===true&&p.at_bat===bat).map(p=>[p.pitch_number??p.id,p])).values()].sort((a,b)=>(a.pitch_number??0)-(b.pitch_number??0)||a.at-b.at);
 const result=rows.findLast(p=>p.result===true&&p.at_bat===bat);
 const context=rows.findLast(p=>p.period===last.period&&p.half===last.half&&Array.isArray(p.bases));
 // Official non-pitch actions can change count or outs. Use the latest reached
 // semantic time, because an earlier timeout and a later pitch can share raw
 // start time. Unknown action fields cannot erase a known count.
 const latest=predicate=>rows.reduce((best,p)=>predicate(p)&&(!best||displayAt(p)>=displayAt(best))?p:best,null);
 const half=p=>p.period===last.period&&p.half===last.half;
 const outsRow=latest(p=>half(p)&&integer(p.outs,3));
 const countValue=(key,max)=>latest(p=>half(p)&&p.at_bat===bat&&integer(p[key],max))?.[key]??null;
 const balls=countValue('balls',4),strikes=countValue('strikes',3);
 const terminal=last.stage==='inning_end';
 const currentStart=rows.findLast(p=>p.stage==='at_bat_start');
 const previous=!!(currentStart&&bat&&currentStart.at_bat!==bat&&currentStart.at>=pitch.at);
 const finished=d.reported_mlb.state==='final'&&last.id===d.reported_mlb_terminal_id&&(terminal||last.result===true);
 const phase=finished?'final':terminal?'between_innings':previous?'between_batters':result?'outcome':pitch?.in_play===true?'in_play':pitch?'pitch':'between_batters';
 const score=side=>rows.findLast(p=>integer(p[side],999))?.[side];
 const teams=(d.teams||[]).map(t=>({...t,score:score(t.side)==null?'':String(score(t.side))}));
 const stateRows=pitches.map(p=>({...p,number:p.pitch_number,type:p.text}));
 const physical=pitches.filter(p=>p.physical&&finite(p.physical.x_ft)&&finite(p.physical.z_ft));
 const points=physical.map(p=>({...p,number:p.pitch_number,x:(5-p.physical.x_ft)/10,y:(8-p.physical.z_ft)/10}));
 const g=physical.at(-1)?.physical;
 const field=g?{width:1,height:1,physical_width:10,physical_height:10,units:'feet',source:'mlb',ball_radius:1.45/120,zone:{x:(5-17/24)/10,y:(8-g.top_ft)/10,width:17/120,height:(g.top_ft-g.bottom_ft)/10,approximate:false}}:{width:1,height:1,physical_width:300,physical_height:300,zone:{x:88/300,y:149/300,width:56/300,height:44/300,approximate:true}};
 const outs=terminal?3:outsRow?.outs??null;
 const bases=terminal?[]:context?.bases??null;
 const name=p=>typeof p==='string'?p:p?.name??null;
 const situation={balls:result||terminal||previous?null:balls,strikes:result||terminal||previous?null:strikes,outs,bases_known:bases!==null,on_first:bases===null?null:bases.includes(1),on_second:bases===null?null:bases.includes(2),on_third:bases===null?null:bases.includes(3),batter:name(previous?currentStart?.batter:pitch?.batter),pitcher:name(previous?currentStart?.pitcher:pitch?.pitcher)};
 return {...d,state:finished?'final':'live',teams,plays:stateRows,points,field,situation,tracking_available:!!pitches.length,geometry_available:!!points.length,display_geometry:true,baseball_phase:phase,summary:{at_bat_id:bat??null,pitch_count:pitches.length,balls:previous?pitch?.balls??null:balls,strikes:previous?pitch?.strikes??null:strikes,outcome:result?.text??null,completed:!!result,scope:previous?'previous_at_bat':'current_or_latest_at_bat',phase,location_pending:pitches.length-points.length},recent:rows.filter(p=>p.result===true).slice(-6),status:finished?'Final':terminal?`${last.half==='top'?'Middle':'End'} ${last.period}`:`${last.half==='top'?'Top':'Bottom'} ${last.period}`,period:last.period,stale:false,display_label:'MLB reported data · estimated timing',alignment_status:'MLB reported data · estimated timing'};
}
function createRetention(){
 let saved=null;
 const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 function view(data,{now,cutoff,scope}={}){
  const v=data?.reported_mlb,negative=['alignment_invalidated','replay','slate','discontinuity','source_switch','contradictory'].some(k=>data?.[k]===true)||Array.isArray(data?.semantic_negatives)&&data.semantic_negatives.length>0;
  if(negative||!Array.isArray(scope)||!scope.length||!finite(cutoff)||!finite(now)){saved=null;return null;}
  if(saved&&!same(saved.scope,scope))saved=null;
  const fresh=reduce(data,{now,cutoff});
  if(fresh){
   if(typeof v.source_feed_sha256==='string'&&/^[a-f0-9]{64}$/.test(v.source_feed_sha256))saved={scope:scope.slice(),hash:v.source_feed_sha256,event:v.event_id,game:v.game_pk,cutoff,now,data:copy({...data,reported_mlb_selected:true,reported_mlb_terminal_id:fresh.reported_mlb_terminal_id,reported_mlb:{...v,timeline:fresh.timeline}})};
   else saved=null;
   return fresh;
  }
  // Reuse only the prefix already released by this viewer. A quiet source or
  // failed refresh cannot introduce another pitch or renew its observations.
  if(!saved||v?.stale!==true||v.schema!==1||v.source!=='MLB'||String(v.event_id)!==String(saved.event)||v.game_pk!==saved.game||v.source_feed_sha256!==saved.hash){saved=null;return null;}
  const held=reduce(saved.data,{now:saved.now,cutoff:Math.min(saved.cutoff,cutoff)});
  return held?{...held,reported_saved:true,stale:true,display_label:'Holding reached MLB report · refresh pending',alignment_status:'Holding reached MLB report · refresh pending'}:null;
 }
 return {view,clear:()=>{saved=null;}};
}
const retained=createRetention();
const api={lane,source,reduce,estimatedCutoff,createRetention,retained:retained.view};if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.OrbitalReportedBaseball=api;
})(typeof window!=='undefined'?window:null);

/* Pure tracker cutoff policy. Local compatibility never grants R4 verification. */
/* public build: a private provider module is not included here. */

/* Viewer-local picture estimate. No carrier, occurrence or exact authority. */
/* public build: a private provider module is not included here. */

/* Bounded viewer-picture capture. Canvas/rVFC correspondence remains approximate. */
/* public build: a private provider module is not included here. */


/* Page facts are latest official reports. Viewer timing remains in the player. */
(function(root){'use strict';
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const copy=v=>JSON.parse(JSON.stringify(v));
 const freeze=v=>{if(object(v)||Array.isArray(v)){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;};
 const supported=e=>['MLB','NFL','College football'].includes(e?.league);
 function present(event,payload,snapshot=payload?.game_snapshot){
  const model=payload?.latest_render_model,id=String(event?.id??event?.event_id??'');
  if(!supported(event)||!object(snapshot)||snapshot.schema!==1||snapshot.game_id!==id||snapshot.league!==event.league
   ||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||!/^[0-9a-f]{32}$/.test(snapshot.publisher_instance||'')
   ||typeof snapshot.timeline_epoch!=='string'||!snapshot.timeline_epoch||!Array.isArray(snapshot.events)||snapshot.events.length>4096
   ||!object(model)||model.event_id!==id||model.league!==event.league||model.game_revision!==snapshot.revision
   ||model.kind!==(event.league==='MLB'?'baseball':'football')||!['live','final','scheduled'].includes(model.state)
   ||!['fresh','delayed','unknown','unavailable'].includes(snapshot.source_health)
   ||!['plays','points','timeline','drives','recent','teams'].every(k=>Array.isArray(model[k])&&model[k].length<=4096)
   ||!['summary','situation','field'].every(k=>object(model[k]))
   ||model.selected_event_id!==(snapshot.events.at(-1)?.event_id??null))return null;
  let previous=-1;const ids=new Set();for(const row of snapshot.events){
   if(!object(row)||typeof row.event_id!=='string'||!row.event_id||ids.has(row.event_id)
    ||!Number.isSafeInteger(row.sequence)||row.sequence<=previous||!object(row.state_after)||!object(row.detail)
    ||typeof row.row_revision!=='string'||!row.row_revision||row.report_at!=null&&(typeof row.report_at!=='number'||!Number.isFinite(row.report_at)))return null;
   ids.add(row.event_id);previous=row.sequence;
  }
  if(payload.drives!=null&&(!Array.isArray(payload.drives)||payload.drives.length>128))return null;
  const value=copy(model);
  // The compact football presentation contains the current drive only. The
  // normal page chart keeps all official drives supplied in this same response.
  // It never borrows history from a player projection or a different response.
  if(model.kind==='football'&&Array.isArray(payload.drives))value.drives=copy(payload.drives);
  return freeze({...value,game_snapshot:copy(snapshot),timeline_epoch:snapshot.timeline_epoch,
   publisher_instance:snapshot.publisher_instance,source_health:snapshot.source_health,
   latest_reported:true,held:false,display_label:'Latest reported'});
 }
 function create(event){
  let owner=null,revision=-1,model=null;const retired=new Set();
  function accept(payload){
   const next=present(event,payload);if(!next)return null;
   const instance=next.publisher_instance,number=next.game_revision;
   if(retired.has(instance)||owner===instance&&number<revision)return null;
   if(owner&&owner!==instance){retired.add(owner);if(retired.size>16)retired.delete(retired.values().next().value);}
   owner=instance;revision=number;model=next;return model;
  }
  return Object.freeze({accept,latest:()=>model,clear(){owner=null;revision=-1;model=null;retired.clear();}});
 }
 const api=Object.freeze({supported,present,create});
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.OrbitalLatestPageModel=api;
})(typeof window!=='undefined'?window:globalThis);

/* Thin latest-game snapshot cache. Selection and timing belong to the service. */
(function(root){'use strict';
const copy=v=>JSON.parse(JSON.stringify(v));
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const supported=e=>['MLB','NFL','College football'].includes(e?.league);
const game=e=>String(e?.league||'')+'|'+String(e?.id??e?.event_id??'');
function sourceRow(event){
 const row={...copy(event.state_after),...copy(event.detail),id:event.event_id,at:event.report_at,stage:event.phase,phase:event.phase,row_revision:event.row_revision,sequence:event.sequence};
 if(row.pitch_number!=null)row.number=row.pitch_number;
 return row;
}
function renderDto(event,payload,snapshot){return root.OrbitalLatestPageModel.present(event,payload,snapshot);}
function create({ownership=root?.OrbitalTrackerOwnership,maxGames=32}={}){
 const records=new Map(),listeners=new Map(),owned=new Map();
 const scopeOf=o=>o?.scope||ownership?.capture?.(),valid=s=>!!s&&(!ownership?.accepts||ownership.accepts(s)),key=(e,s)=>String(ownership?.key?.(s)||s)+'|'+game(e);
 function protect(s){if(owned.has(s)||!ownership?.observe)return;owned.set(s,ownership.observe(s,()=>{for(const [k,e] of records)if(e.scope===s)records.delete(k);for(const [k,e] of listeners)if(e.scope===s)listeners.delete(k);owned.delete(s);}));}
 function validate(event,value){
  if(!supported(event)||!value||value.schema!==1||String(value.game_id)!==String(event.id??event.event_id)||value.league!==event.league||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.timeline_epoch!=='string'||!value.timeline_epoch||!value.latest||typeof value.latest!=='object'||Array.isArray(value.latest)||!['live','final','scheduled'].includes(value.latest.state))return false;
  if(value.events!=null){if(!Array.isArray(value.events)||value.events.length>4096)return false;let sequence=-1;const ids=new Set();for(const row of value.events){if(!row||typeof row.event_id!=='string'||!row.event_id||ids.has(row.event_id)||!Number.isSafeInteger(row.sequence)||row.sequence<=sequence||typeof row.row_revision!=='string'||!row.row_revision||(row.report_at!=null&&!finite(row.report_at))||!row.state_after||!row.detail)return false;ids.add(row.event_id);sequence=row.sequence;}}
  return true;
 }
 function notify(k,d){for(const fn of listeners.get(k)?.callbacks||[])try{fn(d);}catch{}}
 function accept(event,payload,options={}){
   const scope=scopeOf(options);if(!valid(scope))return null;protect(scope);const k=key(event,scope),old=records.get(k),snapshot=payload?.game_snapshot;
   if(!validate(event,snapshot))return old?.dto||null;
   const inbox=old?.inbox||root.OrbitalLatestPageModel.create(event),dto=inbox.accept(payload);
   if(!dto)return old?.dto||null;
   const immutable=freeze(copy(snapshot));records.set(k,{scope,snapshot:immutable,dto,inbox});while(records.size>maxGames)records.delete(records.keys().next().value);notify(k,dto);return dto;
  }
 function latest(event,options={}){const s=scopeOf(options);return valid(s)?records.get(key(event,s))?.dto||null:null;}
 function health(event,status='delayed',options={}){
  const s=scopeOf(options);if(!valid(s))return null;const k=key(event,s),entry=records.get(k);if(!entry)return null;if(!['fresh','delayed','unknown','unavailable'].includes(status)||entry.snapshot.source_health===status)return entry.dto;
  entry.snapshot=freeze({...entry.snapshot,source_health:status,...(finite(options.healthObservedAt)?{health_observed_at:options.healthObservedAt}:{})});entry.dto=freeze({...entry.dto,game_snapshot:entry.snapshot,source_health:status,stale:status!=='fresh'});notify(k,entry.dto);return entry.dto;
 }
 function subscribe(event,fn,options={}){const s=scopeOf(options);if(!valid(s)||typeof fn!=='function')return ()=>{};protect(s);const k=key(event,s);let value=listeners.get(k);if(!value){value={scope:s,callbacks:new Set()};listeners.set(k,value);}value.callbacks.add(fn);const d=latest(event,{scope:s});if(d)fn(d);return ()=>{value.callbacks.delete(fn);if(!value.callbacks.size)listeners.delete(k);};}
 return {accept,latest,health,subscribe,supported,create};
}
const api={create,renderDto};if(root)root.OrbitalGameStore=create();if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);


/* Player trackers v3 (Sept 29 polish): the watched game gets a spoiler-safe tracker held to your picture; every tracked game
   keeps a translucent scorebar; an edge panel (TV/desktop), slim rail (phone landscape) or under-video panel (phone portrait);
   a side-rail game picker that never dims the game. Replaces the v2 other-games overlay; every v2 control is kept
   (on/off toggle, Down opens the picker, hold OK toggles, Watch, Remove/unpin, quiet controls). */
(()=>{'use strict';
const SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
const LEAGUES=['MLB','NFL','College football','NBA','WNBA','NHL','MLS'];
const SAFE=120,MAX_DELAY=600,MAX_PINS=3,MOMENT_MS=6000;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=text;return n;};
const button=(text,fn,cls='otv-trk-btn')=>{const execution=ownerExecution,b=el('button',cls,text);b.type='button';b.onclick=(...args)=>{if(execution!==ownerExecution||!ownedTracker()||!b.isConnected)return;return fn(...args);};return b;};
const api=()=>window.ApiClient,who=()=>api()?[api().serverId(),api().getCurrentUserId()].join(':'):'';
let ownerExecution=null,ownerExecutionOff=null;
const ownedTracker=()=>!!ownerExecution&&window.OrbitalTrackerOwnership.accepts(ownerExecution);
const T=()=>window.TelevisionTrackers,F=()=>window.TelevisionFeedUi;
const key=e=>T().key(e),root=()=>document.fullscreenElement||document.body;
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
const art=(e,t)=>window.OrbitalTeamArt?.[e.league+'|'+t.name]||{};
const svgNS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={})=>{const n=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const ordinal=n=>n+(['th','st','nd','rd'][(n%100-20)%10]||['th','st','nd','rd'][n%100]||'th');
const fmt=s=>{s=Math.max(0,Math.round(s));return s<60?s+' s':Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};

// Pure T9 policy. Call from existing tracker/board callbacks and held paint tick; no timer or network.
class TrackerMomentPolicy {
 constructor(){this.states=new Map();}
 reset(){this.states.clear();}
 static options(value){return {scoringPinned:value?.scoringPinned===true,closeFinishes:value?.closeFinishes===true,teamKickoffFinal:value?.teamKickoffFinal===true};}
 signature(options){return JSON.stringify(TrackerMomentPolicy.options(options));}
 seedScheduled(key,options){if(!this.states.has(key))this.states.set(key,{sig:this.signature(options),seen:new Set(),maxAt:0,close:false,started:false,final:false});}
 consume({key,event,data,cutoff,now,options,pinned=false,followed=false}){
  if(!event||!data||String(event.id)!==String(data.event_id)||event.league!==data.league||data.stale||event.stale||!Number.isFinite(cutoff)||!Number.isFinite(now)||cutoff>now)return [];
  const flags=TrackerMomentPolicy.options(options),sig=this.signature(flags);
  const rows=[...new Map((data.timeline||[]).filter(p=>p.id!=null&&String(p.id)&&typeof p.at==='number'&&Number.isFinite(p.at)&&p.at>0&&p.at<=cutoff&&p.at<=now).map(p=>[String(p.id),p])).values()].sort((a,b)=>a.at-b.at),last=rows.at(-1);
  const score=p=>[p?.away,p?.home].map(v=>v==null||v===''?NaN:Number(v));
  const seconds=clock=>{const m=/^(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(String(clock||''));return m&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;};
  const close=p=>{if(!p)return false;const [away,home]=score(p);if(![away,home].every(v=>Number.isFinite(v)&&v>=0&&v<=999))return false;const gap=Math.abs(away-home),sec=seconds(p.clock);
   if(data.kind==='football')return p.period>=4&&sec!=null&&sec<=300&&gap<=8;
   if(data.kind==='basketball')return p.period>=4&&sec!=null&&sec<=300&&gap<=5;
   if(data.kind==='hockey')return p.period>=3&&sec!=null&&sec<=300&&gap<=1;
   return data.kind==='baseball'&&p.period>=9&&gap<=1;};
  const start=p=>{if(p.period!==1)return false;const type=String(p.type||'');
   if(/^game start[.!]?$/i.test(type)||/^game start[.!]?$/i.test(String(p.text||'')))return true;
   if(data.kind==='football')return /kickoff/i.test(type)&&seconds(p.clock)===900;
   if(data.kind==='basketball')return /jump ball|jumpball|tip.?off/i.test(type)&&seconds(p.clock)===(data.league==='NBA'?720:600);
   return data.kind==='hockey'&&/face.?off/i.test(type)&&seconds(p.clock)===1200;};
  const final=p=>{if(/^end (of )?game[.!]?$/i.test(String(p.type||'').trim())||/^end (of )?game[.!]?$/i.test(String(p.text||'').trim()))return true;
   const [away,home]=score(p);return data.state==='final'&&/^end (of )?regulation[.!]?$/i.test(String(p.type||p.text||'').trim())&&Number.isFinite(away)&&Number.isFinite(home)&&away!==home;};
  let state=this.states.get(key);
  if(!state||state.sig!==sig){state={sig,seen:new Set(rows.map(p=>String(p.id))),maxAt:last?.at||0,close:close(last),started:rows.some(start),final:rows.some(final)};this.states.set(key,state);while(this.states.size>80)this.states.delete(this.states.keys().next().value);return [];}
  if(last&&last.at<state.maxAt)return [];
  const fresh=rows.filter(p=>!state.seen.has(String(p.id))&&p.at>=state.maxAt),alerts=[];
  const newest=fresh.filter(p=>p.scoring===true).at(-1);
  if(flags.scoringPinned&&pinned&&newest)alerts.push({kind:'Score',text:newest.text||'Scoring play',at:newest.at,id:'score:'+newest.id});
  if(flags.closeFinishes&&(pinned||followed)&&!state.close&&close(last)&&last)alerts.push({kind:'Close finish',text:(data.teams||[]).map(t=>t.abbreviation||t.name).join(' · '),at:last.at,id:'close:'+last.id});
  if(flags.teamKickoffFinal&&followed){const opening=fresh.find(start),ending=fresh.find(final);
   if(opening&&!state.started)alerts.push({kind:'Your team',text:(data.teams||[]).map(t=>t.abbreviation||t.name).join(' · ')+' · Game started',at:opening.at,id:'start:'+opening.id});
   if(ending&&!state.final)alerts.push({kind:'Your team',text:'Final · '+(data.teams||[]).map(t=>(t.abbreviation||t.name)+' '+(t.side==='away'?ending.away:ending.home)).join('  '),at:ending.at,id:'final:'+ending.id});}
  state.close=state.close||close(last);state.started=state.started||rows.some(start);state.final=state.final||rows.some(final);state.maxAt=Math.max(state.maxAt,last?.at||0);
  for(const p of rows)state.seen.add(String(p.id));while(state.seen.size>256)state.seen.delete(state.seen.values().next().value);
  return alerts;
 }
}

/* ---------- preferences (account + server + this browser) ---------- */
function device(){let d;try{d=localStorage.getItem('orbital-tracker-device-v1');if(!d){d=crypto.randomUUID();localStorage.setItem('orbital-tracker-device-v1',d);}}catch{d='temporary';}return d;}
const prefKey=v=>'orbital-trackers-'+v+':'+who()+':'+device();
function read(){
 const base={enabled:false,selected:[],chosen:true,thisGame:false,size:'m',corner:'right',see:'more',collapsed:false,delays:{},alerts:TrackerMomentPolicy.options(null)};
 try{const v=JSON.parse(localStorage.getItem(prefKey('v3'))||'null');if(v&&Array.isArray(v.selected))return {...base,...v,enabled:false,selected:[],chosen:true,
  size:['s','m','l'].includes(v.size)?v.size:'m',corner:['right','left'].includes(v.corner)?v.corner:'right',see:['more','less'].includes(v.see)?v.see:'more',thisGame:false,collapsed:v.collapsed===true,
  delays:v.delays&&typeof v.delays==='object'?v.delays:{},alerts:TrackerMomentPolicy.options(v.alerts)};}catch{}
 try{const v=JSON.parse(localStorage.getItem(prefKey('v2'))||'null');if(v&&Array.isArray(v.selected))return {...base,enabled:false,selected:[],chosen:true,thisGame:false};}catch{}
 return base;}
function save(){if(!prefs)return;const d=Object.entries(prefs.delays||{}).sort((a,b)=>(b[1]?.at||0)-(a[1]?.at||0)).slice(0,40);prefs.delays=Object.fromEntries(d);try{localStorage.setItem(prefKey('v3'),JSON.stringify(prefs));}catch{/* session only */}}

/* ---------- state ---------- */
let current=null,owner='',surface=null,stack=null,bar=null,toggle=null,rail=null,sheet=null,live=null,generation=0,stops=[],events=[],all=[],prefs=null,
 externalSerial=0,externalStream=null,eventTimer=null,holdTimer=null,tick=null,thisStop=null,thisData=null,thisSection=null,sync={mode:'safe',delay:SAFE,lag0:0,from:''},
 lastCut=null,moments=new Map(),seenScoring=new Map(),quietOff=null,layoutOff=null,col=null,shown=new Map(),stackSig='';

/* ---------- the watched game's hold ---------- */
function video(){return document.querySelector('.videoPlayerContainer video')||document.querySelector('video.htmlvideoplayer')||document.querySelector('video');}
// Local media epochs protect compatibility; exact host epochs use a separate owner callback.
const trackerClock=window.OrbitalTrackerLifecycle.create({safe:SAFE});
const viewerAlignment=window.OrbitalViewerAlignment.create(),completedExposure=window.OrbitalViewerAlignment.createExposureSchedule(),displayContext=window.OrbitalViewerAlignment.createDisplayContext();let retainedTracker=null,retainedSource=null,retainedCut=null,retainedCheckpointSerial=0;
let fetchedTrackerOwner=null,fetchedOwnerEpoch=null,trackerOwnerQuery='',trackerOwnerAt=0,trackerOwnerBusy=false,trackerOwnerJob=null;
function playerWallclock(){return null;}
async function refreshTrackerOwner(){}
let trackerMediaDiagnostic=null,trackerFramePaint=null;
let trackerMedia=null,trackerSrc='',trackerEpoch=0,trackerMediaOff=null,exactOwnerProvider=null,trackerState=null;
let pictureSession=null,pictureSessionJob=null,pictureSessionAt=0,pictureAdapter=null,pictureVideo=null,syncClockBase=null,syncClockJob=null; 
function pictureScope(){return null;}
function samePictureScope(a,b){return false;}
async function refreshPictureSession(){}
function pictureFrame(){return null;}
function pictureInput(){return null;}
async function refreshSyncClock(){}
async function captureSyncClock(originalAt){return null;}
function pictureWall(){return null;}
function sampleSyncAssist(v){}
function disposeSyncAssist(){localReferenceAlignment=null;syncClockBase=null;syncClockJob=null;pictureAdapter?.dispose();pictureAdapter=null;pictureVideo=null;pictureSession=null;pictureSessionJob=null;pictureSessionAt=0;}

function trackerSample(){const v=video(); trackerState=trackerClock.sample({now:Date.now()/1000,paused:v?.paused===true,source:String(feedId())+'|'+String(current?.event?.id||'')});return trackerState;}
function liveLag(){const v=video();try{const q=v?.seekable;if(q?.length){const n=q.end(q.length-1)-v.currentTime;if(Number.isFinite(n)&&n>=0&&n<7200)return n;}}catch{}return null;}
const manualSync=()=>trackerSample().display_ready&&sync.mode==='synced'&&sync.from!=='memory';
const syncAssisted=()=>trackerSample().mode.startsWith('auto_');
function hold(){return trackerSample().hold;}
const cutoff=()=>trackerSample().cutoff;
const feedId=()=>current?.source?.id||'';
function startSync(){sync={mode:'safe',delay:SAFE,lag0:0,from:''};}

function setDelay(seconds,from){trackerSample();const chosenDelay=Math.max(1,Math.min(MAX_DELAY,seconds));trackerClock.setManual(chosenDelay,Date.now()/1000,video()?.currentTime);sync={mode:'synced',delay:chosenDelay,lag0:liveLag(),from};lastCut=null;paintThis(true);}

function matchTrackerPlay(play,choice=null){if(!play||!Number.isFinite(play.at))return false;setDelay(Math.max(1,Date.now()/1000-play.at),'manual');return true;}

function matchObservedTrackerState(observed){
 const fields={period:[1,30],balls:[0,4],strikes:[0,3],outs:[0,3],pitch_number:[1,100]};
 if(thisData?.kind!=='baseball'||current?.event?.league!=='MLB'||!observed||Object.keys(observed).length!==6||!['top','bottom'].includes(observed.half))return false;
 for(const [key,[low,high]] of Object.entries(fields))if(!(key==='pitch_number'&&observed[key]===null)&&(!Number.isSafeInteger(observed[key])||observed[key]<low||observed[key]>high))return false;
 const sameHalf=value=>String(value||'').toLowerCase().replace(/ inning$/,'');
 const matches=(thisData.timeline||[]).filter(play=>play.pitch===true&&sameHalf(play.half)===observed.half&&Object.keys(fields).every(key=>key==='pitch_number'&&observed[key]===null||play[key]===observed[key]));
 if(matches.length!==1)return false;
 return matchTrackerPlay(matches[0]);
}

function adjustTracker(step){setDelay(Math.max(1,(sync.delay||SAFE)+step),'manual');}

function resetSync(){localReferenceAlignment=null;pictureAdapter?.automatic();displayContext.automatic();viewerAlignment.automatic();trackerClock.reset();sync={mode:'safe',delay:SAFE,lag0:0,from:''};lastCut=null;paintThis(true);}

function alignmentControls(){const row=el('div','otv-trk-sheet-row otv-trk-alignment');row.setAttribute('aria-label','Tracker timing');

 for(const [label,step] of [['Tracker earlier',-.5],['Tracker later',.5],['Earlier 1 second',-1],['Later 1 second',1]]){const b=button(label,()=>adjustTracker(step));b.dataset.alignmentAction=String(step);b.setAttribute('aria-label',label+(Math.abs(step)===.5?' by half a second':''));row.append(b);}

 const reset=button('Reset to automatic',resetSync);reset.dataset.alignmentAction='reset';row.append(reset);return row;}



function periodLabel(d,e){if(!e)return d.status||'';if(d.kind==='baseball')return [e.half||'',e.period?ordinal(e.period):''].join(' ').trim()+(Number.isFinite(e.outs)?' · '+e.outs+' out'+(e.outs===1?'':'s'):'');
 if(d.kind==='soccer')return [window.OrbitalTrackerLifecycle.soccerPeriodLabel(e.period),e.clock].filter(Boolean).join(' · ');
 const p=e.period?(d.league==='NHL'?'P'+e.period:(d.kind==='basketball'&&d.league!=='NBA'&&d.league!=='WNBA'?'H':'Q')+e.period):'';return [p,e.clock].filter(Boolean).join(' ');}
// The tracker payload as it looked when your picture was showing it. Nothing newer than the cutoff survives.
// Watched football only. Full-game/history rendering keeps the source fixture unchanged.
function footballFinalBoundary(source,visible,original=source){
 const finite=v=>typeof v==='number'&&Number.isFinite(v),period=v=>Number.isSafeInteger(v)&&v>=1&&v<=30;
 const score=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=999?v:typeof v==='string'&&/^[0-9]{1,3}$/.test(v)?Number(v):null;
 const event=d=>String(d?.event_id??d?.event??'');
 if(!source||!original||original.kind!=='football'||source.kind!==original.kind||original.state!=='final'||!event(original)||event(source)!==event(original)||source.league!==original.league)return false;
 const teams=d=>Array.isArray(d.teams)&&d.teams.length===2&&d.teams.every(t=>t&&t.id!=null&&String(t.id)&&['away','home'].includes(t.side))&&new Set(d.teams.map(t=>String(t.id))).size===2&&new Set(d.teams.map(t=>t.side)).size===2?d.teams:null;
 const currentTeams=teams(source),originalTeams=teams(original);
 if(!currentTeams||!originalTeams||JSON.stringify(currentTeams.map(t=>[String(t.id),t.side]))!==JSON.stringify(originalTeams.map(t=>[String(t.id),t.side])))return false;
 const administrative=p=>/^(?:(?:official|team|media|injury) )?timeout$|^two[- ]minute warning$/i.test(String(p.type||'').trim());
 const valid=p=>p&&p.id!=null&&String(p.id)&&finite(p.at)&&p.at>0;
 const rows=original.timeline;
 if(!Array.isArray(rows)||!rows.length||rows.length>4096||!rows.every(valid)||new Set(rows.map(p=>String(p.id))).size!==rows.length||!Array.isArray(visible)||!visible.length||!visible.every(valid)||new Set(visible.map(p=>String(p.id))).size!==visible.length)return false;
 const order=values=>values.map((p,index)=>({p,index})).sort((a,b)=>a.p.at-b.p.at||a.index-b.index).map(v=>v.p);
 const full=order(rows),released=order(visible),sink=full.findLast(p=>!administrative(p)),reached=released.findLast(p=>!administrative(p));
 if(!sink||!reached)return false;
 // Compare original occurrence and semantic revision. Optional coordinates,
 // observation ages and scheduling enrichment are not football outcome facts.
 const fields=['id','at','text','type','period','clock','away','home','scoring','team_id','possession','down','distance','spot','yards','goal_to_go','goalToGo'];
 if(fields.some(k=>(sink[k]??null)!==(reached[k]??null))||sink.revision_sha256&&reached.revision_sha256&&sink.revision_sha256!==reached.revision_sha256)return false;
 const direct=/^end (?:of )?(game|regulation)[.!]?$/i,kind=direct.exec(String(sink.type||'').trim())||(/^end (?:of )?(period|quarter)$/i.test(String(sink.type||'').trim())?direct.exec(String(sink.text||'').trim()):null);
 if(!kind||!period(sink.period))return false;
 const header=original.period;
 if(header!=null&&(!period(header)||header!==sink.period))return false;
 if(kind[1].toLowerCase()==='regulation'&&(header!==4||sink.period!==4))return false;
 const away=score(originalTeams.find(t=>t.side==='away').score),home=score(originalTeams.find(t=>t.side==='home').score);
 if(away===null||home===null||score(sink.away)!==away||score(sink.home)!==home||kind[1].toLowerCase()==='regulation'&&away===home)return false;
 // A harmless administrative tail can retain an already reached game end.
 // A later football action, score correction or possession change cannot.
 const unchanged=p=>administrative(p)&&(p.away==null||score(p.away)===away)&&(p.home==null||score(p.home)===home)&&(!p.possession||!sink.possession||String(p.possession)===String(sink.possession));
 if(!full.slice(full.indexOf(sink)+1).every(unchanged)||!released.slice(released.indexOf(reached)+1).every(unchanged))return false;
 return true;
}

function heldFootball(source,cutoff,visible,originalSource=source){
 const validAt=p=>typeof p.at==='number'&&Number.isFinite(p.at)&&p.at>0&&p.at<=cutoff;
 const coord=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
 const unique=rows=>[...new Map(rows.map(p=>[String(p.id),p])).values()];
 const timeline=unique((visible||source.timeline||[]).filter(p=>p.id!=null&&String(p.id)&&validAt(p))).sort((a,b)=>a.at-b.at);
 const last=timeline.at(-1),known=new Set((source.teams||[]).map(t=>String(t.id||'')).filter(Boolean));
 const currentId=String(source.summary?.drive_id||'');
 let drives=(source.drives||[]).slice(-40).map(d=>({...d,play_details:d.play_details?.length?d.play_details:(String(d.id||'')===currentId&&currentId?(source.plays||[]):[])}));
 if(!drives.length&&currentId&&known.has(String(source.summary?.team_id||'')))drives=[{id:currentId,team_id:source.summary.team_id,play_details:source.plays||[]}];
 let selected=null;
 for(const d of drives){const team=String(d.team_id||'');if(!String(d.id||'')||!known.has(team))continue;
  const rows=unique((d.play_details||[]).filter(p=>p.id!=null&&String(p.id)&&String(p.team_id||'')===team&&validAt(p))).sort((a,b)=>a.at-b.at).slice(-40).map(p=>{
   const row={...p};if(!coord(row.start_x))delete row.start_x;if(!coord(row.end_x))delete row.end_x;return row;});
  if(rows.length&&(!selected||rows.at(-1).at>=selected.rows.at(-1).at))selected={drive:d,rows};
 }
 const drive=selected?.drive,plays=selected?.rows||[],latest=plays.at(-1),team=String(drive?.team_id||'');
 const joined=!!latest&&!!last&&String(latest.id)===String(last.id)&&latest.at===last.at;
 const samePossession=joined&&team&&String(last.possession||'')===team;
 const endedPlay=!!latest&&/touchdown|extra point|two.point|punt|interception|fumble|turnover on downs|field goal|safety|end (of )?(game|half|regulation|quarter|period)/i.test(latest.type||'');
 // An administrative timeout can follow the already visible drive-ending
 // event. It does not hide that result; future football actions still do.
 const administrative=p=>/^(?:(?:official|team|media|injury) )?timeout$|^two[- ]minute warning$/i.test(String(p.type||'').trim());
 const rawDrive=drive?.play_details||[];
 const fullyReleased=!!drive&&joined&&plays.length===rawDrive.length&&rawDrive.every(p=>p.id!=null&&String(p.id)&&String(p.team_id||'')===team&&validAt(p));
 const terminalPlay=plays.findLast(p=>!administrative(p));
 const terminalRow=terminalPlay&&timeline.find(p=>String(p.id)===String(terminalPlay.id)&&p.at===terminalPlay.at);
 const terminalMatches=()=>{if(!drive||!joined||!terminalPlay||!terminalRow)return false;
  if(terminalRow.type&&String(terminalRow.type)!==String(terminalPlay.type||''))return false;
  // Retain the complete non-administrative prefix and member checks. Missing,
  // conflicting, out-of-window or future football rows cannot supply a result.
  if(unique(rawDrive).length!==rawDrive.length||!rawDrive.every(p=>p.id!=null&&String(p.id)&&String(p.team_id||'')===team&&typeof p.at==='number'&&Number.isFinite(p.at)&&p.at>0&&(validAt(p)||administrative(p))))return false;
  if(!rawDrive.filter(p=>!administrative(p)).every(p=>plays.some(r=>String(r.id)===String(p.id)&&r.at===p.at)))return false;
  if(plays.some(p=>p.at>terminalPlay.at&&(!administrative(p)||p.away!=null&&terminalRow.away!=null&&p.away!==terminalRow.away||p.home!=null&&terminalRow.home!=null&&p.home!==terminalRow.home||p.possession&&terminalRow.possession&&String(p.possession)!==String(terminalRow.possession))))return false;
  const result=String(drive.result||'').toLowerCase(),kind=(terminalPlay.type||'')+' '+(terminalPlay.text||'');
  if(result.includes('touchdown'))return plays.some(p=>/touchdown/i.test(p.type||''))&&/touchdown|extra point|two.point/i.test(terminalPlay.type||'');
  if(result.includes('interception'))return /interception/i.test(kind)&&!!terminalRow.possession&&String(terminalRow.possession)!==team;
  if(result.includes('fumble'))return /fumble/i.test(kind)&&!!terminalRow.possession&&String(terminalRow.possession)!==team;
  if(result.includes('downs'))return /downs/i.test(kind)&&!!terminalRow.possession&&String(terminalRow.possession)!==team;
  if(result.includes('punt'))return /punt/i.test(terminalPlay.type||'');
  if(/field goal|fg/.test(result))return /field goal/i.test(terminalPlay.type||'')&&(!/miss|blocked/i.test(result)||/miss|blocked/i.test(kind))&&(!/good|made/i.test(result)||/good|made/i.test(kind));
  if(result.includes('safety'))return /safety/i.test(terminalPlay.type||'');
  if(/clock ran out|end of/.test(result))return /end (of )?(game|half|regulation)/i.test(kind);
  return false;};
 const terminal=terminalMatches(),field={...(source.field||{})};delete field.ball_x;
 let situation=null;
 if(samePossession&&!endedPlay&&!terminal){if(coord(latest.end_x))field.ball_x=latest.end_x;
  situation={team_id:team};if(last.goal_to_go===true||last.goalToGo===true)situation.goal_to_go=true;if(Number.isInteger(last.down)&&last.down>=1&&last.down<=4)situation.down=last.down;
  if(Number.isInteger(last.distance)&&last.distance>=0&&last.distance<=100)situation.distance=last.distance;
  if(typeof last.spot==='string'&&last.spot)situation.spot=last.spot;}
 const heldDrive=drive?{id:drive.id,team_id:drive.team_id,play_details:plays,plays:plays.length}:null;
 if(heldDrive){const start=plays.find(p=>coord(p.start_x))?.start_x;if(coord(start))heldDrive.start_x=start;if(coord(latest?.end_x))heldDrive.end_x=latest.end_x;
  if(terminal){heldDrive.result=drive.result;
   // Full-drive prose and aggregates can still contain an unreleased tail.
   if(fullyReleased){if(drive.description)heldDrive.description=drive.description;if(Number.isFinite(drive.yards))heldDrive.yards=drive.yards;}
   heldDrive.scoring=!!terminalRow.scoring;heldDrive.away=terminalRow.away;heldDrive.home=terminalRow.home;}}
 const final=footballFinalBoundary(source,timeline,originalSource),displayRow=final?timeline.findLast(p=>!administrative(p)):last;if(final){situation=null;delete field.ball_x;}
 const geometry=source.geometry_available===true||(source.geometry_available==null&&source.orientation_verified===true);
 return {...source,held:true,pending:false,state:final?'final':(source.state==='scheduled'&&!timeline.length?'scheduled':'live'),
  status:final?'Final':[last?.period?(last.period<=4?'Q'+last.period:'OT'+(last.period-4)):'',last?.clock||''].filter(Boolean).join(' · '),
  period:displayRow?.period??null,clock:displayRow?.clock||'',teams:(source.teams||[]).map(t=>({...t,score:t.side==='home'?(displayRow?.home??''):t.side==='away'?(displayRow?.away??''):''})),
  points:[],plays,timeline,recent:[],drives:heldDrive?[heldDrive]:[],summary:drive?{drive_id:drive.id,team_id:drive.team_id,scope:'current_or_latest_drive',completed:terminal,...(terminal?{result:drive.result}:{})}:{},
  situation,field,tracking_available:geometry&&(!source.stale||source.reference_estimated===true)&&plays.some(p=>coord(p.start_x)&&coord(p.end_x)),geometry_available:geometry&&(!source.stale||source.reference_estimated===true),
  completed:terminal,outcome:null,result:null,description:null,yards:null,unavailable_reason:'Play locations appear when reported for your picture'};
}

function heldProjection(d){return projectHeld(d);}

// A held commercial picture must not leave a completed at-bat looking live.
// This is a separately labelled reported estimate, bounded by the existing
// playback clock and the same matched at-bat. It never advances picture proof.
function completedHeldAtBat(d,estimate,timeline){
 const v=video(),pitch=timeline.findLast(p=>p.pitch===true),now=Date.now()/1000;
 if(d.kind!=='baseball'||estimate.holding!==true||estimate.manual_confirmation||estimate.assumed||!Number.isFinite(estimate.last_picture_at)||now-estimate.last_picture_at<15||!Number.isFinite(estimate.estimated_cutoff)||estimate.estimated_cutoff<=estimate.cutoff||!v||v.paused||v.seeking||v.readyState<2||d.stale||!pitch?.at_bat)return null;
 // Replay, wrong-game, withdrawal and contradictory source evidence remain
 // barriers. A generic hold is not permission to disclose later game history.
 if(!/commercial/i.test(estimate.reason||'')||['replay','source_switch','discontinuity','contradictory','alignment_invalidated'].some(k=>d[k]===true)||d.reference_withdrawal!=null||d.withdrawal_at>estimate.last_picture_at)return null;
 const reference=localReferenceSource(d),matched=reference?.rows.find(p=>String(p.id)===String(pitch.id));
 if(!matched||matched.at!==pitch.at||matched.at_bat!==pitch.at_bat||matched.period!==pitch.period||matched.half!==pitch.half)return null;
 const result=reference.rows.findLast(p=>p.result===true&&p.at_bat===pitch.at_bat&&p.period===pitch.period&&p.half===pitch.half&&p.at>estimate.cutoff&&p.at<=Math.min(now,estimate.estimated_cutoff));
 if(!result)return null;
 const view=reportedReferenceEstimate(d,{...reference,index:reference.rows.indexOf(result),manual:false});
 return {...view,completed_hold_estimate:true,picture_held_cutoff:estimate.cutoff,display_label:'Estimated completed at-bat · picture held during commercial',alignment_status:'Estimated completed at-bat · picture held during commercial'};
}
function syncAssistdView(d){return null;}

// A reported reference is useful before picture timing is known. Its original
// source times stay intact; this view never grants exact/display authority.
let localReferenceAlignment=null;
function footballLocalBinding(d,rows,index){return null;}
function footballLocalValid(d,reference,row,record){return false;}
function withdrawFootballLocal(record){
 if(record?.football)pictureAdapter?.withdraw?.('football_manual_source_withdrawn');
 localReferenceAlignment=null;
}
function footballLocalSourcePrefix(source,rows){return null;}

function neutralReferenceEstimate(event){
 const kind=({'MLB':'baseball','NFL':'football','College football':'football','NBA':'basketball','WNBA':'basketball','NHL':'hockey','MLS':'soccer'})[event?.league];
 if(!kind)return null;
 const field=kind==='baseball'?{physical_width:300,physical_height:300,zone:{x:88/300,y:149/300,width:56/300,height:44/300,approximate:true}}:kind==='football'?{width:1,height:1,physical_width:100,physical_height:53.333333,units:'yards'}:kind==='basketball'?{width:1,height:1,physical_width:50,physical_height:47,units:'feet',hoop:{x:.5,y:5.25/47}}:kind==='hockey'?{width:1,height:1,physical_width:200,physical_height:85,units:'feet',goals:[{x:.055,y:.5},{x:.945,y:.5}]}:{width:1,height:1};
 const timingNeutral=['baseball','football'].includes(kind),label='Waiting for picture match · Sync';
 return {kind,league:event.league,event_id:String(event.id),state:timingNeutral?'live':event.state||'live',status:timingNeutral?label:event.status||'Reported game estimate',teams:(event.teams||[]).map(t=>timingNeutral?{id:t.id,name:t.name,abbreviation:t.abbreviation,logo:t.logo,side:t.side,color:t.color,alternateColor:t.alternateColor,score:''}:{...t}),timeline:[],plays:[],points:[],drives:[],recent:[],summary:{},situation:null,field,display_geometry:kind!=='soccer',geometry_available:kind!=='soccer',tracking_available:false,reference_estimated:true,estimated:true,pending:false,...(timingNeutral?{held:true,period:null,clock:'',outcome:null,result:null,description:null,yards:null,display_label:label,alignment_status:label,calibration:{verified:false,display:label}}:{}),exact:false,currentDecoderProof:false,occurrenceAuthority:false,carrierAuthority:false,physicalDisplayProven:false};
}
function localReferenceSource(d){
 if(!ownedTracker()||!current?.event||!d||String(d.event_id??d.event)!==String(current.event.id)||d.league!==current.event.league)return null;
 if(neutralReferenceEstimate(current.event)?.kind!==d.kind)return null;
 const reported=window.OrbitalReportedBaseball?.source(d,{now:Date.now()/1000})||d;
 const raw=Array.isArray(reported.timeline)?reported.timeline:[],rows=[],seen=new Map();
 for(const row of raw.slice(-2000)){if(!row||row.id==null||!String(row.id)||typeof row.text!=='string'||!Number.isFinite(row.at))continue;const id=String(row.id),signature=JSON.stringify(row);if(seen.has(id)){if(seen.get(id)!==signature)return null;continue;}seen.set(id,signature);rows.push(row);}
 return {source:reported,rows,domain:d.kind==='soccer'?'source_sequence':'utc'};
}
function localReferenceScope(){const scope=pictureScope();return {...scope,resource:String(scope.video?.currentSrc||scope.video?.src||''),league:current?.event?.league,attempt:current?.attempt};}
function localReferenceSelection(d){return null;}
function matchLocalReference(play){return false;}
function adjustLocalReference(step){return false;}
function reportedReferenceEstimate(d,selection=null){
 if(!selection&&['baseball','football'].includes(d?.kind))return neutralReferenceEstimate(current?.event);
 const reference=selection||localReferenceSource(d);if(!reference)return null;
 const neutral=neutralReferenceEstimate(current.event),index=selection?.index??reference.rows.length-1,rows=reference.rows.slice(0,index+1),last=rows.at(-1),ids=new Set(rows.map(r=>String(r.id)));
 if(reference.source?.reported_mlb_selected&&rows.length){
  const localNow=Date.now()/1000;const fast=window.OrbitalReportedBaseball?.reduce({...reference.source,reported_mlb:{...reference.source.reported_mlb,timeline:rows}},{now:localNow,cutoff:localNow});
  if(fast){const label=selection?.manual?'Manual MLB reported-play estimate · Sync':'MLB reported game estimate · Sync';return projectWatchedHistory({...fast,held:true,pending:false,manual_estimated:selection?.manual===true,manual_confirmation:selection?.manual===true,manual_anchor_play_id:selection?.anchor_id||null,display_label:label,alignment_status:label,exact:false,currentDecoderProof:false,occurrenceAuthority:false,carrierAuthority:false,physicalDisplayProven:false},d,localNow);}
 }
 let view={...neutral,...footballLocalSourcePrefix(d,rows),reference_estimated:true,timeline:rows,plays:(d.plays||[]).filter(p=>!reference.rows.length||ids.has(String(p.id))),points:(d.points||[]).filter(p=>!reference.rows.length||ids.has(String(p.id))),recent:(d.recent||[]).filter(p=>!reference.rows.length||ids.has(String(p.id)))};
 if(rows.length&&d.kind!=='soccer')view=projectHeld(view,{display_ready:true,common_ready:false,cutoff:last.at,observed_play_id:null,reference_estimate:true},reference.source);
 if(d.kind==='soccer')view={...view,plays:rows,status:[window.OrbitalTrackerLifecycle.soccerPeriodLabel(last?.period),last?.clock].filter(Boolean).join(' · ')||d.status,period:last?.period??d.period,clock:last?.clock??d.clock,summary:{scope:'reported_commentary_estimate'},situation:null,drives:[]};
 if(last)view.teams=(d.teams||neutral.teams).map(t=>({...t,score:last[t.side]==null?t.score:String(last[t.side])}));
 const label=(selection?.manual?'Manual reported-play estimate':d.stale?'Last reported game estimate':'Reported game estimate')+' · Sync';
 return {...view,field:view.field||neutral.field,pending:false,held:true,reference_estimated:true,estimated:true,manual_estimated:selection?.manual===true,manual_confirmation:selection?.manual===true,manual_anchor_play_id:selection?.anchor_id||null,coordinate_domain:reference.domain,display_geometry:d.kind!=='soccer',geometry_available:d.kind!=='soccer'||(view.points||[]).length>0,tracking_available:(view.points||[]).length>0||(view.plays||[]).length>0,display_label:label,alignment_status:label,calibration:{...(d.calibration||{}),verified:false,display:label},exact:false,currentDecoderProof:false,occurrenceAuthority:false,carrierAuthority:false,physicalDisplayProven:false};
}

function held(d){return ownedTracker()&&d?projectHeld(d):null;}
function projectHeld(d,manualState=null,originalSource=d){
 const state=manualState||trackerSample();
 if(state.common_ready&&d.kind==='baseball'&&!d.stale&&(!retainedTracker||retainedTracker.partial===true)){const f=state.common_facts;return {kind:'baseball',league:d.league,event:d.event,held:true,pending:false,partial:true,state:'live',
  status:[f.half,f.period?ordinal(f.period):'',Number.isInteger(f.outs)?f.outs+' out'+(f.outs===1?'':'s'):''].filter(Boolean).join(' · '),reason:'Matching the pitch · only shared facts shown',
  teams:(d.teams||[]).map(t=>({id:t.id,name:t.name,abbreviation:t.abbreviation,logo:t.logo,side:t.side,score:Number.isInteger(f[t.side])?String(f[t.side]):''})),
  points:[],plays:[],timeline:[],recent:[],summary:{},situation:null,tracking_available:false,common_facts:{...f}};}
 if(!state.display_ready)return reportedReferenceEstimate(d)||neutralReferenceEstimate(current?.event);
 if(d.kind==='soccer')return window.OrbitalTrackerLifecycle.soccerSelection(d,state.manual_play_id,Date.now()/1000)||reportedReferenceEstimate(d)||neutralReferenceEstimate(current?.event);
 const tl=(d.timeline||[]).filter(e=>Number.isFinite(e.at));const c=state.cutoff;
 if(!tl.length)return reportedReferenceEstimate(d)||neutralReferenceEstimate(current?.event);
 const observedIndex=state.observed_play_id?tl.findIndex(e=>String(e.id)===state.observed_play_id):-1;
 if(state.observed_play_id&&observedIndex<0)return reportedReferenceEstimate(d)||neutralReferenceEstimate(current?.event);
 const shownAt=e=>state.sync_assistd_schedule&&e.pitch===true&&Number.isFinite(e.estimated_pitch_at)?e.estimated_pitch_at:e.at;
 const vis=state.observed_play_id?tl.slice(0,observedIndex+1):tl.filter(e=>shownAt(e)<=c),last=vis.at(-1);const ids=new Set(vis.map(e=>String(e.id)));
 const visible=e=>Number.isFinite(e.at)&&e.at<=c&&(!state.observed_play_id||ids.has(String(e.id)));
 if(!last)return reportedReferenceEstimate(d)||neutralReferenceEstimate(current?.event);
 const score=side=>last?String(side==='home'?last.home??'':last.away??''):'0';
 const ended=d.state==='final'&&String(last?.id)===String(tl.at(-1).id);
 const h={...d,held:true,state:ended?'final':(d.state==='final'?'live':d.state),status:ended?d.status:periodLabel(d,last),clock:last?.clock||'',period:last?.period||d.period,
  teams:(d.teams||[]).map(t=>({...t,score:score(t.side)})),recent:(d.recent||[]).filter(r=>Number.isFinite(r.at)&&r.at<=c),
  points:(d.points||[]).filter(visible),plays:(d.plays||[]).filter(visible),timeline:vis,situation:null};
 if(d.kind==='football'){const source=state.observed_play_id?{...d,plays:(d.plays||[]).filter(visible),drives:(d.drives||[]).map(x=>({...x,play_details:(x.play_details||[]).filter(visible),result:'',description:'',yards:null}))}:d;Object.assign(h,heldFootball(source,c,vis,originalSource));}
 if(d.kind==='baseball'){
  const pitch=vis.slice().reverse().find(e=>e.pitch&&e.at_bat),bat=pitch?.at_bat;
  const pitches=[...new Map(vis.filter(e=>e.pitch&&e.at_bat===bat).map(e=>[e.pitch_number??e.id,e])).values()];
  const result=vis.slice().reverse().find(e=>e.result&&e.at_bat===bat);
  h.points=pitches.filter(e=>Number.isFinite(e.pitch_x)&&Number.isFinite(e.pitch_y)).map(e=>({id:e.id,x:e.pitch_x,y:e.pitch_y,number:e.pitch_number,type:e.text,text:e.text,at:e.at}));
  h.plays=pitches.map(e=>({id:e.id,text:e.text,type:e.text,number:e.pitch_number,pitch_type:e.pitch_type,mph:e.mph,balls:e.balls,strikes:e.strikes,at:e.at}));
  // Timeline coordinates are full 300-unit source coordinates, not the current at-bat's cropped viewport.
  h.field={...d.field,physical_width:300,physical_height:300,zone:{x:88/300,y:149/300,width:56/300,height:44/300,approximate:true}};
  const physical=window.TelevisionTrackers.physicalPitches(pitches);if(physical)Object.assign(h,physical);else h.calibration={...h.calibration,note:'Approximate strike zone · not adjusted for batter height'};
  // The end-of-at-bat row reports the post-play runners. Keep that state
  // after a hit/walk/out instead of dropping the diamond until another pitch.
  // Only already released rows from this half-inning can supply the situation.
  const situationRow=pitch&&vis.findLast(e=>e.period===pitch.period&&e.half===pitch.half&&e.at>=pitch.at&&Array.isArray(e.bases)&&e.bases.every(n=>Number.isInteger(n)&&n>=1&&n<=3));
  if(situationRow&&h.state==='live')h.situation={balls:result?null:pitch.balls,strikes:result?null:pitch.strikes,outs:situationRow.outs,on_first:situationRow.outs<3&&situationRow.bases.includes(1),on_second:situationRow.outs<3&&situationRow.bases.includes(2),on_third:situationRow.outs<3&&situationRow.bases.includes(3)};
  h.summary={at_bat_id:bat,pitch_count:pitches.length,balls:pitch?.balls,strikes:pitch?.strikes,outcome:result?.text||null,completed:!!result};
 }
 if(ended)h.situation=null;
 if(d.stale&&!state.reference_estimate)return reportedReferenceEstimate(d)||h;
 return h;}

/* ---------- scorebar ---------- */
function teamsOf(event,d){const byside=s=>{const e=(event.teams||[]).find(t=>t.side===s)||{},t=(d?.teams||[]).find(x=>x.side===s)||{};return {name:e.name||t.name||'',abbr:t.abbreviation||art(event,e).abbr||(e.name||'').split(/\s+/).map(x=>x[0]).join('').slice(0,3),
  score:d?t.score:e.score,logo:art(event,e).url,color:t.color||(art(event,e).color?'#'+art(event,e).color:null),id:t.id};};return [byside('away'),byside('home')];}
function logo(t,size){const wrap=el('span','otv-trk-logo');wrap.style.setProperty('--sz',size+'px');if(t.logo?.startsWith('https://a.espncdn.com/')){const i=el('img');i.src=t.logo;i.alt='';i.loading='lazy';i.decoding='async';wrap.append(i);}else{wrap.textContent=t.abbr;if(t.color)wrap.style.background=t.color;}return wrap;}
function glyph(d){const s=d?.situation;if(!s)return null;
 if(d.kind==='baseball'){const g=svg('svg',{viewBox:'0 0 30 22',width:30,height:22,role:'img','aria-label':['Runners:',s.on_first?'first':'',s.on_second?'second':'',s.on_third?'third':'',!(s.on_first||s.on_second||s.on_third)?'none':''].filter(Boolean).join(' ')});
  const base=(x,y,on)=>g.append(svg('rect',{x:x-4,y:y-4,width:8,height:8,transform:`rotate(45 ${x} ${y})`,fill:on?'#ffd166':'none',stroke:on?'#ffd166':'rgba(255,255,255,.7)','stroke-width':1.5}));
  base(15,6,s.on_second);base(7,14,s.on_third);base(23,14,s.on_first);const w=el('span','otv-trk-glyph');w.append(g);
  if(Number.isFinite(s.balls)&&Number.isFinite(s.strikes))w.append(el('span','otv-trk-count',s.balls+'-'+s.strikes));return w;}
 if(d.kind==='football'&&s.down){const w=el('span','otv-trk-glyph otv-trk-dd',ordinal(s.down)+' & '+s.distance);return w;}
 return null;}
function scorebar(event,d,{thisGame=false}={}){
 const b=el('button','otv-trk-bug');b.type='button';const pictureStatus=thisGame&&(!d||d.pending)?'Reported game estimate':(d?.status||event.status||'');const [away,home]=teamsOf(event,d);const poss=d?.situation?.team_id;
 const side=t=>{const s=el('span','otv-trk-side');s.append(logo(t,26));const a=el('span','otv-trk-abbr',t.abbr);if(poss&&t.id===poss)a.classList.add('has-ball');s.append(a,el('span','otv-trk-score',t.score==null||t.score===''?'':t.score));return s;};
 const aw=side(away),hm=side(home);const n=v=>Number(v);if(d&&d.state==='final'){if(n(away.score)>n(home.score))hm.classList.add('is-behind');else if(n(home.score)>n(away.score))aw.classList.add('is-behind');}
 b.append(aw,hm);const st=el('span','otv-trk-status',pictureStatus.replace(/^(Top|Bottom|Bot|Mid|End)\s/,m=>({'Top ':'▲ ','Bottom ':'▼ ','Bot ':'▼ ','Mid ':'Mid ','End ':'End '})[m]||m));b.append(st);const g=glyph(d);if(g)b.append(g);
 b.setAttribute('aria-label',`${away.name} ${away.score??''}, ${home.name} ${home.score??''}. ${pictureStatus}${thisGame?'. Game you are watching':''}`);
 return b;}

/* ---------- game sections ---------- */
function section(event,{thisGame=false}={}){const s=el('section','otv-trk-game');s.dataset.eventId=event.id;if(thisGame)s.dataset.this='true';s.setAttribute('aria-label',(thisGame?'This game: ':'')+event.name);
 const head=el('div','otv-trk-head'),body=el('div','otv-trk-body');s.append(head,body);return s;}
function openState(s){if(s.dataset.this==='true')return !prefs.collapsed;return s.classList.contains('is-open');}
// Identity-only roster cache. No live statistics enter the picture-held card.
const baseballRosters=new Map();
function baseballPeople(event){
 const execution=ownerExecution,account=who(),id=String(event.id),k=window.OrbitalTrackerOwnership.key(execution)+':'+id,old=baseballRosters.get(k);
 if(old&&Date.now()-old.at<60000)return old.people;
 const entry={at:Date.now(),people:old?.people||{}};baseballRosters.set(k,entry);
 while(baseballRosters.size>6)baseballRosters.delete(baseballRosters.keys().next().value);
 const a=api();Promise.resolve(a.ajax({type:'GET',url:a.getUrl('sports/api/boxscore',{event:id,league:'MLB'}),dataType:'json'})).then(box=>{
  if(!window.OrbitalTrackerOwnership.accepts(execution)||execution!==ownerExecution||who()!==account||String(current?.event?.id)!==id||baseballRosters.get(k)!==entry)return;
  if(box.event_id!=null&&String(box.event_id)!==id)return;
  const people={};for(const t of box.players||[])for(const g of t.groups||[])for(const p of g.athletes||[])if(p.name)people[p.name.toLowerCase()]={short:p.short,headshot:p.headshot};
  entry.people=people;paintThis(true);
 }).catch(()=>{});return entry.people;
}
/* Deliberate, bounded panes. All rows and accessible copy use the current held view. */
let compactPane=null;
function compactProjection(){
 if(!ownedTracker()||!current?.event)return null;
 if(typeof gameCenterProjection==='function')return gameCenterProjection(current.event);
 if(!thisData||String(thisData.event_id)!==String(current.event.id)||thisData.league!==current.event.league)return null;
 return {scope:JSON.stringify([who(),feedId(),trackerEpoch,current.event.league,current.event.id]),data:held(thisData)};
}
function compactRows(data){
 const rows=data?.timeline?.length?data.timeline:data?.plays||[];
 return [...new Map(rows.filter(row=>row&&row.id!=null&&String(row.id)&&typeof row.text==='string'&&row.text).slice(-2000).map(row=>[String(row.id),row])).values()];
}
function compactFocus(node=document.activeElement){
 if(!node)return null;
 return node.dataset?.trackerDot?{dot:node.dataset.trackerDot}:node.dataset?.trackerControl?{control:node.dataset.trackerControl}:node.dataset?.trackerPlay?{play:node.dataset.trackerPlay}:{node};
}
function restoreCompactFocus(saved){
 const controls=[...sheet?.querySelectorAll('[data-tracker-control]')||[],...surface?.querySelectorAll('[data-tracker-control]')||[]],plays=[...sheet?.querySelectorAll('[data-tracker-play]')||[],...surface?.querySelectorAll('[data-tracker-play]')||[]];
 const dots=[...sheet?.querySelectorAll('[data-tracker-dot]')||[],...surface?.querySelectorAll('[data-tracker-dot]')||[]];
 let node=saved?.dot?dots.find(n=>n.dataset.trackerDot===saved.dot):saved?.control?controls.find(n=>n.dataset.trackerControl===saved.control):saved?.play?plays.find(n=>n.dataset.trackerPlay===saved.play):saved?.node;
 const visible=n=>!!n?.isConnected&&!n.disabled&&n.getClientRects().length>0;
 if(!visible(node))node=[surface?.querySelector('[data-tracker-control=details]'),...controls.filter(n=>n.dataset.trackerControl==='minimize'),surface?.querySelector('.obc-sync'),toggle].find(visible);
 node?.focus({preventScroll:true});
}
function compactButton(label,action,key){const node=button(label,action);if(key)node.dataset.trackerControl=key;return node;}
function beginCompactPane(kind){
 const projection=compactProjection();if(!projection)return false;
 const old=compactPane,parent=old&&['details','inspect'].includes(old.kind)?old:null,opener=compactFocus();
 sheet?.remove();sheet=null;
 compactPane={kind,scope:projection.scope,parent,opener,selected:old?.selected||null,signature:null};return true;
}
function openTrackerDetails(){if(!beginCompactPane('details'))return;compactPane.parent=null;renderCompactPane(true);}
function openTrackerInspection(id=null){if(!beginCompactPane('inspect'))return;compactPane.selected=id==null?compactPane.selected:String(id);renderCompactPane(true);}
function compactContext(event,data){
 const teams=teamsOf(event,data||{teams:[]}),pair=teams.map(t=>[t.abbr,t.score==null||t.score===''?'':t.score].filter(v=>v!=='').join(' ')).join(' · ');
 return [pair,data?.pending?'Reported game estimate':data?.status].filter(Boolean).join(' · ');
}
function compactInspectionData(data,selected){
 const detailed=(data.plays||[]).find(row=>String(row.id)===String(selected.id)),play={...selected,...detailed};
 const view={...data,plays:[play],timeline:[selected],points:(data.points||[]).filter(point=>String(point.id)===String(selected.id)),drives:[],recent:[],summary:{scope:'inspected_reported_play'},situation:null,outcome:null,result:null,completed:false,truncated:false,field:{width:1,height:1,ball_x:null}};
 if(data.kind==='baseball'){
  view.field={physical_width:300,physical_height:300,zone:{x:88/300,y:149/300,width:56/300,height:44/300,approximate:true}};
  view.calibration={...data.calibration,note:'Approximate strike zone · not adjusted for batter height'};
  const physical=window.TelevisionTrackers?.physicalPitches([play]);if(physical)Object.assign(view,physical,{geometry_available:true,tracking_available:true});
 }
 return view;
}
function renderCompactPane(first=false){
 const state=compactPane;if(!state||!['details','inspect'].includes(state.kind))return;
 const projection=compactProjection();if(!projection||projection.scope!==state.scope){closeSheet(true);return;}
 const data=projection.data,rows=compactRows(data),signature=JSON.stringify([data,state.selected]);
 if(!first&&signature===state.signature)return;state.signature=signature;
 const focus=sheet?.contains(document.activeElement)?compactFocus():null;
 if(!sheet){sheet=el('section','otv-trk-sheet otv-trk-detail-sheet');sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label',state.kind==='details'?'Tracker details':'Inspect known play');}
 sheet.dataset.pane=state.kind;sheet.replaceChildren();
 const heading=el('div','otv-trk-pane-heading');heading.append(el('strong','',state.kind==='details'?'Tracker details':data.kind==='baseball'?'Inspect pitch':'Inspect play'),compactButton('Back',()=>closeSheet(),'pane-back'));sheet.append(heading,el('p','otv-trk-note',compactContext(current.event,data)));
 if(state.kind==='details'){
  const view=T()?.render?.(data,{compact:false,previousId:state.selected,onInspect:openTrackerInspection});if(view)sheet.append(view);if(data.kind==='baseball')sheet.append(el('p','otv-trk-fine','Pitch numbers match the chart and recent chips. Calls: Called strike, Swinging strike, Ball, Foul, Two-strike foul, In play.'));
  if(!rows.length)sheet.append(el('p','otv-trk-note','The field is ready. Play history follows your picture as data arrives.'));
  const actions=el('div','otv-trk-sheet-row');const inspect=compactButton('Inspect',()=>openTrackerInspection(),'details-inspect');inspect.disabled=!rows.length;
  actions.append(inspect,compactButton('Sync',()=>openSync(),'details-sync'),compactButton('Game center',()=>window.OrbitalSportsCards?.open(current.event,api(),document.activeElement),'details-game-center'));sheet.append(actions);
 }else{
  if(state.selected==null&&rows.length)state.selected=String(rows.at(-1).id);
  const index=rows.findIndex(row=>String(row.id)===state.selected),selected=rows[index];
  if(selected){
   const fact=el('div','otv-trk-inspect-fact');fact.append(el('strong','',selected.pitch_type||selected.type||'Reported play'),el('p','',selected.text));
   const fields=[Number.isFinite(selected.mph)?Math.round(selected.mph)+' mph':null,selected.down_distance,selected.clock,Number.isInteger(selected.balls)&&Number.isInteger(selected.strikes)?selected.balls+'–'+selected.strikes+' count':null].filter(Boolean);if(fields.length)fact.append(el('small','',fields.join(' · ')));sheet.append(fact);
   const selection=compactInspectionData(data,selected);const field=T()?.render?.(selection,{compact:true,previousId:state.selected,onInspect:openTrackerInspection});if(field)sheet.append(field);
  }else sheet.append(el('p','otv-trk-note','This play is outside your current picture position. Choose a known play below.'));
  const step=direction=>{const at=rows.findIndex(row=>String(row.id)===state.selected);const row=rows[at+direction];if(row){state.selected=String(row.id);renderCompactPane();}};
  const actions=el('div','otv-trk-sheet-row'),previous=compactButton('Previous',()=>step(-1),'inspect-previous'),next=compactButton('Next',()=>step(1),'inspect-next');previous.disabled=index<=0;next.disabled=index<0||index===rows.length-1;
  actions.append(previous,next,compactButton('Follow picture',()=>closeSheet(true,true),'inspect-follow'));sheet.append(actions);
  const list=el('div','otv-trk-known-list');const start=Math.max(0,index<0?rows.length-60:index-30);for(const row of rows.slice(start,start+60)){
   const item=compactButton(row.text,()=>{state.selected=String(row.id);renderCompactPane();});item.dataset.trackerPlay=String(row.id);item.setAttribute('aria-pressed',String(String(row.id)===state.selected));list.append(item);
  }sheet.append(list);
 }
 if(first)placeSheet();else if(focus)restoreCompactFocus(focus);
}
function refreshCompactPane(){
 if(!compactPane)return;
 const projection=compactProjection();if(!projection||projection.scope!==compactPane.scope){closeSheet(true);return;}
 renderCompactPane();
}

function paintSection(s,event,d,{thisGame=false,note=''}={}){
 const head=s.querySelector('.otv-trk-head'),body=s.querySelector('.otv-trk-body'),focused=s.contains(document.activeElement)?compactFocus():null;
 window.OrbitalSportsGlass?.captureInspection(body,d,thisGame&&event.league==='MLB'?{picture:pictureScope(),attempt:current?.attempt,playing:current?.phase==='playing',generation,watch:trackerWatchSerial,hls:window.OrbitalHlsTrace?.forVideo(trackerMedia),resource:window.OrbitalHlsTrace?.forVideo(trackerMedia)?.coordinateEpoch?.(),withdrawal:trackerState?.withdrawal,referenceWithdrawal:trackerState?.reference_withdrawal,reference:thisData?.reference_timing,pictureState:pictureAdapter?.state()}:null);
 const bug=scorebar(event,d,{thisGame});bug.onclick=()=>{if(thisGame){prefs.collapsed=!prefs.collapsed;save();}else s.classList.toggle('is-open');refreshOpen();};bug.dataset.trackerControl='minimize';bug.setAttribute('aria-expanded',String(openState(s)));head.replaceChildren(bug);const retainedFootballField=body.querySelector('.otc-field svg');body.replaceChildren();
 const baseball=thisGame&&event.league==='MLB'&&window.TelevisionBaseballCard,football=thisGame&&(d?.kind==='football'||['NFL','NCAAF'].includes(event.league))&&window.TelevisionFootballCard;
 s.classList.toggle('has-baseball-card',!!baseball);s.classList.toggle('has-football-card',!!football);
 if(baseball||football){
  const status=syncChip(d),useful=d&&!d.pending?d:neutralReferenceEstimate(event),options={teams:teamsOf(event,useful).map((t,i)=>({...t,side:i?'home':'away'})),people:baseballPeople(event),caption:status.textContent,context:compactContext(event,d),onMinimize:()=>{bug.click();if(!openState(s))bug.focus({preventScroll:true});},onSync:openSync,onDetails:openTrackerDetails,onInspect:openTrackerInspection};
  const nextCard=(baseball?window.TelevisionBaseballCard:window.TelevisionFootballCard).create(baseball?d:useful,options);const nextField=football&&nextCard.querySelector('.otc-field svg');if(retainedFootballField&&nextField)nextField.replaceWith(T().reconcileField(retainedFootballField,nextField));body.append(nextCard);
 }else{
  if(thisGame){const heading=el('div','otv-trk-compact-header');heading.append(el('strong','','Live Tracker'),compactButton('Minimize',()=>bug.click(),'minimize'));body.append(heading,el('p','otv-trk-context',compactContext(event,d)));}
  const useful=d&&!d.pending?d:neutralReferenceEstimate(event),render=T().render(useful,{compact:true});render.classList.add('otv-trk-render');body.append(render);
  const actions=el('div','otv-trk-actions');if(thisGame){const inspect=compactButton('Inspect',()=>openTrackerInspection(),'inspect');inspect.disabled=!compactRows(d).length;actions.append(compactButton('Details',openTrackerDetails,'details'),inspect,syncChip(d));}
  else{const watch=button('Watch',()=>{if(!ownedTracker()||!other(event)||!F().eligible(event).length)return;window.TelevisionPlayback.start({...event,switching:true});});watch.disabled=!F().eligible(event).length||d?.state==='final';actions.append(watch);}body.append(actions);
 }
 if(focused)restoreCompactFocus(focused);
}
function baseballFallback(d){const w=el('div','otv-trk-fallback');const s=d.situation||{};
 const g=svg('svg',{viewBox:'0 0 120 92',width:96,height:74,role:'img','aria-label':'Bases'});const base=(x,y,on)=>g.append(svg('rect',{x:x-8,y:y-8,width:16,height:16,transform:`rotate(45 ${x} ${y})`,fill:on?'#ffd166':'none',stroke:on?'#ffd166':'rgba(255,255,255,.75)','stroke-width':2}));
 base(60,14,s.on_second);base(22,52,s.on_third);base(98,52,s.on_first);g.append(svg('rect',{x:52,y:74,width:16,height:12,rx:2,fill:'rgba(255,255,255,.45)'}));
 const info=el('div','otv-trk-fallback-info');if(Number.isFinite(s.balls))info.append(el('b','',`${s.balls}-${s.strikes}, ${s.outs??0} out${s.outs===1?'':'s'}`));
 const last=(d.recent||[]).at(-1)||(d.timeline||[]).slice().reverse().find(e=>e.result);if(last?.text)info.append(el('span','',last.text));else if(d.summary?.outcome)info.append(el('span','',d.summary.outcome));
 w.append(g,info);return w;}
function lastPlays(d){const ol=el('ol','otv-trk-lastplays');for(const e of (d.timeline||[]).filter(e=>e.text).slice(-3).reverse())ol.append(el('li','',e.text));return ol;}
function syncChip(view=null){const state=trackerSample(),offset=localReferenceAlignment?.offset||0,label=view?.completed_hold_estimate?'Reported result estimate · Sync':localReferenceAlignment?.manual===true?'Manual reported-play estimate'+(offset?' '+(offset>0?'+':'')+offset+' s':'')+' · Sync':pictureAdapter?.state()?.manual_confirmation?'Manual picture estimate · Sync':thisData?.stale?'Last reported estimate · Sync':'Estimated timing · Sync';const c=button(label,openSync,'otv-trk-sync');c.dataset.state=state.mode;c.setAttribute('aria-label',label+'. Open picture alignment');return c;}



/* ---------- one-press sync ---------- */
function trackerAlignChoices(data,released,reference,now){
 const reached=!released?.pending&&Array.isArray(released?.timeline)?released.timeline:[];
 const raw=reached.length?reached:['baseball','football'].includes(data?.kind)&&Array.isArray(reference?.rows)?reference.rows:[];
 return raw.filter(e=>e&&e.id!=null&&String(e.id)&&Number.isFinite(e.at)&&e.at>0&&e.at<=now&&typeof e.text==='string'&&e.text.trim()).slice(-12).reverse();
}
function openSync(){if(!surface||!thisData||!beginCompactPane('sync'))return;sheet=el('div','otv-trk-sheet');sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','Sync tracker to your picture');
 sheet.append(el('b','','Sync to your picture'),el('p','otv-trk-note',thisData.kind==='soccer'?'Automatic matching follows the reported game clock. Adjust timing or match an already released commentary play; it follows known commentary as your picture advances.':'The tracker follows your picture while timing is refined. Adjust by half a second or one second. Match the scorebar you see, or choose the reported play you see.'));
 const status=el('p','otv-trk-note otv-trk-sync-status');const row=el('div','otv-trk-sheet-row otv-trk-sync-choices');
 const now=Date.now()/1000,released=held(thisData),reported=localReferenceSource(thisData);const choices=trackerAlignChoices(thisData,released,reported,now);
 for(const play of choices){const choice=thisData.kind==='baseball'?null:pictureAdapter?.manualChoice?.(play);row.append(button(play.text,()=>{if(!matchTrackerPlay(play,choice)){status.textContent='This reported play changed or no longer belongs to this playback. Choose a current reported play or use timing correction.';return;}status.textContent='Matched to the play you observed. Following your picture with estimated timing; use half-second correction as needed.';paintNudge();}));}
 if(!choices.length)row.append(el('p','otv-trk-note','No reported play choices yet. Timing correction remains available.'));
 if(thisData.kind==='baseball'&&current?.event?.league==='MLB'){
  const form=el('div','otv-trk-sheet-row otv-trk-observed-state'),inputs={};form.setAttribute('aria-label','Observed picture state');
  form.append(el('p','otv-trk-note','Enter only what you observed: inning, half, count and outs. Pitch number within this at-bat is optional. An ambiguous state stays unmatched.'));
  for(const [key,label,low,high] of [['period','Inning',1,30],['balls','Balls',0,4],['strikes','Strikes',0,3],['outs','Outs',0,3],['pitch_number','Pitch number in this at-bat (optional)',1,100]]){
   const wrap=el('label','otv-trk-observed-field'),input=el('input','');input.type='number';input.min=String(low);input.max=String(high);input.step='1';input.inputMode='numeric';input.setAttribute('aria-label',label);wrap.append(el('span','',label),input);form.append(wrap);inputs[key]=input;
  }
  const half=el('select','');half.setAttribute('aria-label','Inning half');for(const [value,label] of [['','Choose half'],['top','Top'],['bottom','Bottom']]){const option=el('option','',label);option.value=value;half.append(option);}form.append(half);
  form.append(button('Match observed picture',()=>{const values={half:half.value};for(const [key,input] of Object.entries(inputs))values[key]=input.value.trim()===''?null:Number(input.value);
   if(!matchObservedTrackerState(values)){status.textContent='No unique current play matches those observed fields. Keep using timing correction or wait for another readable scorebar.';return;}
   status.textContent='Matched your observed picture. Following playback with estimated timing; use half-second correction as needed.';paintNudge();
  }));row.append(form);
 }
 const nudge=el('div','otv-trk-sheet-row otv-trk-nudge');function paintNudge(){nudge.replaceChildren(alignmentControls());}
 paintNudge();const foot=el('div','otv-trk-sheet-row otv-trk-sync-footer');foot.append(button('Automatic alignment',()=>{resetSync();paintNudge();status.textContent=displayContext.status().acquired?'Following your picture. Timing is estimated; manual correction remains available.':'Reported game estimate. Manual correction is available.';}),button('Done',closeSheet));
 sheet.append(row,nudge,status,foot,el('p','otv-trk-fine','Manual matching applies to this playback only. Seeking or changing feeds requires a fresh match.'));placeSheet();}

function formRoving(e,box){
 if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
 const target=document.activeElement;
 // Native editing/select arrows remain available. Up/down moves between controls.
 if((target?.matches('input,select'))&&(e.key==='ArrowLeft'||e.key==='ArrowRight'))return;
 const items=[...box.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')],index=items.indexOf(target);
 if(index<0)return;const delta=e.key==='ArrowUp'||e.key==='ArrowLeft'?-1:1,next=items[index+delta];
 e.preventDefault();e.stopPropagation();next?.focus({preventScroll:false});
}

function sheetKeys(e){if(e.key==='Escape'||e.key==='BrowserBack'||e.key==='Backspace'&&!/input|textarea/i.test(e.target.tagName)){e.preventDefault();e.stopPropagation();closeSheet();return;}if(sheet.querySelector('.otv-trk-observed-state')){formRoving(e,sheet);return;}roving(e,sheet);}
function placeSheet(){surface.append(sheet);sheet.addEventListener('keydown',sheetKeys);sheet.querySelector('button')?.focus({preventScroll:true});}
function closeSheet(all=false,focusAfter=false){
 const previous=compactPane,had=!!sheet;sheet?.remove();sheet=null;compactPane=null;
 if(!ownedTracker())return;
 if(!all&&previous?.parent){compactPane=previous.parent;compactPane.signature=null;renderCompactPane(true);restoreCompactFocus(previous.opener);return;}
 if(had&&(!all||focusAfter))restoreCompactFocus(previous?.opener);
}

/* ---------- settings ---------- */
function openSettings(){if(!surface||!beginCompactPane('settings'))return;compactPane.parent=null;sheet=el('div','otv-trk-sheet');sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','Tracker settings');sheet.append(el('b','','Tracker settings'));
 const group=(label,opts,get,set)=>{const g=el('div','otv-trk-sheet-group');g.append(el('span','otv-trk-label',label));const r=el('div','otv-trk-sheet-row');for(const [v,t] of opts){const b=button(t,()=>{set(v);save();applyLook();[...r.children].forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});b.setAttribute('aria-pressed',String(get()===v));r.append(b);}g.append(r);return g;};
 sheet.append(group('Size',[['s','Small'],['m','Medium'],['l','Large']],()=>prefs.size,v=>prefs.size=v),group('See-through',[['more','More'],['less','Less']],()=>prefs.see,v=>prefs.see=v),
  group('Side',[['right','Right'],['left','Left']],()=>prefs.corner,v=>prefs.corner=v),group('This game',[[true,'Show'],[false,'Hide']],()=>prefs.thisGame,v=>{prefs.thisGame=v;startThis();paintAll(true);}),
  ...[['scoringPinned','Pinned scoring'],['closeFinishes','Close finishes'],['teamKickoffFinal','Your teams: start / final']].map(([k,label])=>group(label,[[false,'Off'],[true,'On']],()=>prefs.alerts[k],v=>{prefs.alerts[k]=v;alertPolicy.reset();alertPhases.clear();alertPhaseFetches.clear();flushAlerts();})),button('Done',closeSheet));
 placeSheet();}

/* ---------- layout ---------- */
function layoutMode(){const w=innerWidth,h=innerHeight;if(h<500&&w>h)return 'rail';if(w<700&&h>w){const v=video()?.getBoundingClientRect();if(v&&v.height>40&&h-v.bottom>=170)return 'below';return 'rail';}return 'panel';}
function applyLook(){if(!surface)return;const m=layoutMode();surface.dataset.mode=m;surface.dataset.size=prefs.size;surface.dataset.see=prefs.see;surface.dataset.side=prefs.corner;surface.dataset.enabled=String(!!prefs.enabled);
 if(m==='below'){const v=video().getBoundingClientRect();surface.style.setProperty('--below',Math.round(v.bottom+8)+'px');}else surface.style.removeProperty('--below');
 // Never under the player's own bar: start the column below it when they would overlap.
 surface.style.removeProperty('--top');const pb=document.getElementById('television-player-feeds');if(pb&&col&&m!=='below'&&!document.documentElement.classList.contains('otv-sports-chrome-hidden')){const r=pb.getBoundingClientRect(),c=col.getBoundingClientRect();if(r.height&&r.right>c.left&&r.left<c.right)surface.style.setProperty('--top',Math.round(r.bottom+8)+'px');}
 refreshOpen();}
function refreshOpen(){if(!surface)return;for(const s of surface.querySelectorAll('.otv-trk-game')){const o=openState(s);s.classList.toggle('is-expanded',o);s.querySelector('.otv-trk-bug')?.setAttribute('aria-expanded',String(o));}}

// Metadata rollover only. Explicit terminal wall time must already be behind the held picture.
function trackerRolloverChoice({old,model,channel,observedChannel,epoch,observedEpoch,cutoff,now,events}){
 const norm=v=>String(v||'').replace(/-/g,'').toLowerCase(),key=e=>e?.league+'|'+e?.id;
 if(!norm(channel)||norm(channel)!==norm(observedChannel)||epoch!==observedEpoch||!old||old.stale||old.state!=='final')return {action:'keep'};
 if(!model||model.stale||model.state!=='final'||String(model.event_id)!==String(old.id)||model.league!==old.league)return {action:'clear'};
 const rows=(model.timeline||[]).filter(p=>p.id&&typeof p.at==='number'&&Number.isFinite(p.at)&&p.at>0);
 const end=p=>/^end (of )?game[.!]?$/i.test(String(p.type||'').trim())||/^end (of )?game[.!]?$/i.test(String(p.text||'').trim())||
  (/^end (of )?regulation[.!]?$/i.test(String(p.type||p.text||'').trim())&&p.away!=null&&p.home!=null&&Number.isFinite(Number(p.away))&&Number.isFinite(Number(p.home))&&Number(p.away)!==Number(p.home));
 const terminal=rows.filter(end).sort((a,b)=>b.at-a.at)[0];
 if(!terminal||!Number.isFinite(cutoff)||!Number.isFinite(now)||terminal.at>now||rows.some(p=>p.at>terminal.at))return {action:'clear'};
 if(cutoff<terminal.at)return {action:'keep'};
 const matches=[...new Map((events||[]).filter(e=>key(e)!==key(old)&&e.state==='live'&&!e.stale&&
  ((e.sources||[]).some(s=>norm(s.id)===norm(channel))||(e.carriers||[]).some(c=>norm(c)===norm(channel)))).map(e=>[key(e),e])).values()];
 return matches.length===1?{action:'bind',event:matches[0]}:{action:'clear'};
}

let trackerRolloverPending=false,trackerRolloverContext=null;
function applyTrackerRollover(rows,observedChannel,observedEpoch){
 const old=rows.find(e=>key(e)===key(current?.event||{}));if(!old)return;
 const choice=trackerRolloverChoice({old,model:thisData,channel:feedId(),observedChannel,epoch:trackerEpoch,observedEpoch,cutoff:cutoff(),now:Date.now()/1000,events:rows});
 if(choice.action==='keep')return;
 resetWatchedAlertState();sync={mode:'safe',delay:SAFE,lag0:0,from:''};trackerClock.reset();trackerState=null;lastCut=null;
 if(feedId()&&prefs.delays){delete prefs.delays[feedId()];save();}
 if(choice.action==='clear'){trackerRolloverPending=true;thisSection?.querySelector('.otv-trk-body')?.replaceChildren();window.TelevisionSportsPlayerUi?.trackerContext?.(null,current?.attempt,feedId());return;}
 thisStop?.();thisStop=null;clearInterval(tick);tick=null;thisData=null;trackerEpoch++;trackerRolloverPending=false;
 prefs.enabled=false;prefs.thisGame=false;prefs.selected=[];prefs.chosen=true;save();current={...current,event:choice.event};paintAll(true);trackerRolloverContext={event:choice.event,attempt:current.attempt,channel:feedId()};
 window.TelevisionSportsPlayerUi?.trackerContext?.(choice.event,current.attempt,feedId());startThis();stackSig='';
}

/* ---------- events and pins ---------- */
const other=e=>e.state==='live'&&!e.stale&&key(e)!==key(current?.event||{});
function followed(){return window.OrbitalFollowed?.list()||(()=>{try{return JSON.parse(localStorage.getItem('home-teams-v1:'+api().getCurrentUserId())||'[]');}catch{return [];}})();}
const follows=(e,list)=>list.some(t=>e.league===t.league&&(e.teams||[]).some(team=>String(team.espn_id)===String(t.id||t.key?.split('~')[1])));
async function refreshEvents(){const run=generation,account=owner,a=api(),observedChannel=feedId(),observedEpoch=trackerEpoch,oldDate=current?.event?.start?new Date(current.event.start).toLocaleDateString('en-CA',{timeZone:'America/Chicago'}):today();const responses=await Promise.all([...new Set([today(),oldDate])].map(date=>a.ajax({type:'GET',url:a.getUrl('sports/api/events',{date}),dataType:'json'})));const data=responses[0];
 if(run!==generation||!ownedTracker()||account!==who()||!surface)return false;const f=followed();
 all=[...new Map(responses.flatMap(d=>(d.events||[]).map(e=>F().withFreshness(e,d))).filter(e=>LEAGUES.includes(e.league)).map(e=>[key(e),{...e,followed:follows(e,f)}])).values()];
 applyTrackerRollover(all,observedChannel,observedEpoch);
 queueTeamPhaseAlerts(all,run,account);
 events=all.filter(other).sort((a,b)=>Number(F().eligible(b).length>0)-Number(F().eligible(a).length>0)||Number(b.followed)-Number(a.followed));
 const mine=all.find(e=>key(e)===key(current?.event||{}));if(mine&&current)current={...current,event:{...current.event,...mine,sources:current.event.sources||mine.sources}};
 return true;}
function stopOthers(){for(const s of stops)s();stops=[];}
function paintAll(force){if(!surface)return;applyLook();toggle.textContent=prefs.enabled?'Trackers on':'Trackers off';toggle.setAttribute('aria-pressed',String(prefs.enabled));
 const pinnedKeys=[];
 const sig=[prefs.enabled,prefs.thisGame,key(current?.event||{}),...pinnedKeys].join('|');
 if(!force&&sig===stackSig){for(const [k,v] of shown){const e=events.find(x=>key(x)===k);if(e)v.event=e;paintSection(v.s,v.event,v.d);}refreshOpen();return;}
 stackSig=sig;const focusId=stack.contains(document.activeElement)?document.activeElement.closest('.otv-trk-game')?.dataset.eventId:null;
 stopOthers();shown.clear();stack.replaceChildren();stack.hidden=!prefs.enabled;if(!prefs.enabled){thisSection=null;return;}
 if(prefs.thisGame&&current?.event&&LEAGUES.includes(current.event.league)){thisSection=section(current.event,{thisGame:true});stack.append(thisSection);paintThis(true);}else thisSection=null;
 const pinned=[];
 if(!pinned.length&&!thisSection)stack.append(el('p','otv-trk-note otv-trk-empty','No live games to track right now.'));
 for(const event of pinned){const s=section(event);stack.append(s);const entry={s,event,d:null};shown.set(key(event),entry);paintSection(s,event,null,{note:'Loading tracker'});
  stops.push(T().watch(event,s,d=>{if(!ownedTracker()||!s.isConnected)return;if(d?.kind==='unknown'&&entry.d)return;entry.d=d;noteMoments(event,d);paintSection(s,entry.event,d);refreshOpen();}));}
 refreshOpen();if(focusId)stack.querySelector('.otv-trk-game[data-event-id="'+CSS.escape(focusId)+'"] .otv-trk-bug')?.focus({preventScroll:true});}
function noteMoments(event,d){rememberAlert(event,d);}
const alertPolicy=new TrackerMomentPolicy(),alertSnapshots=new Map(),alertPhases=new Map(),alertPhaseFetches=new Set(),alertPhasePending=new Map();
let alertOwnerProvider=null,alertCurrentScope='';
function resetAlertState(){alertPolicy.reset();alertSnapshots.clear();alertPhases.clear();alertPhaseFetches.clear();alertPhasePending.clear();moments.clear();if(live)live.textContent='';bar?.querySelector('[data-tracker-alert]')?.remove();surface?.querySelectorAll('.otv-trk-moment').forEach(n=>n.remove());}
const alertIsWatched=event=>String(event?.id||'')===String(current?.event?.id||'')&&event?.league===current?.event?.league;
function resetWatchedAlertState(){const keys=new Set([key(current?.event||{})]);for(const [k,item] of alertSnapshots)if(item.watched){alertSnapshots.delete(k);keys.add(k);}for(const k of keys){alertPolicy.states.delete(k);alertPhases.delete(k);moments.delete(k);for(const stamp of alertPhasePending.keys())if(stamp.startsWith(k+'|'))alertPhasePending.delete(stamp);}}
function alertScope(event=current?.event){
 if(!alertIsWatched(event))return ownedTracker()?JSON.stringify([owner,generation,'live']):'';
 let b=null;try{b=(typeof exactOwnerProvider==='function'?exactOwnerProvider():alertOwnerProvider?.())||null;}catch{}
 const now=Date.now()/1000,identity=['event_generation','viewer_session','playback_epoch','source_id','source_generation'],norm=s=>String(s||'').replace(/-/g,'').toLowerCase();
 const valid=!!b&&ownedTracker()&&current?.phase==='playing'&&b.state==='playing'&&Number.isFinite(b.generated_at)&&b.generated_at<=now&&now-b.generated_at<=90&&Number.isFinite(b.expires_at)&&now<b.expires_at&&b.expires_at<=b.generated_at+120&&
  identity.every(k=>typeof b[k]==='string'&&b[k])&&String(b.event||b.event_id||'')===String(current?.event?.id||'')&&!!b.channel&&norm(b.channel)===norm(feedId());
 const scope=valid?JSON.stringify([owner,generation,typeof trackerEpoch==='number'?trackerEpoch:null,b.event||b.event_id,norm(b.channel),...identity.map(k=>b[k])]):'';
 if(scope!==alertCurrentScope){resetWatchedAlertState();alertCurrentScope=scope;}
 return scope;
}
function rememberAlert(event,data){
 if(!event||!data||!ownedTracker()||String(data.event_id)!==String(event.id)||data.league!==event.league||(trackerRolloverPending&&alertIsWatched(event)))return;
 const scope=alertScope(event);if(!scope)return;
 const watched=alertIsWatched(event),old=alertSnapshots.get(key(event));if(old&&old.scope!==scope)alertPolicy.states.delete(key(event));
 alertSnapshots.set(key(event),{event,data,scope,watched});while(alertSnapshots.size>16)alertSnapshots.delete(alertSnapshots.keys().next().value);
 flushAlerts();
}
function showTrackerAlert(k,alert,event){
 const run=generation,scope=alertScope(event),record={at:Date.now(),kind:alert.kind,text:alert.text};moments.set(k,record);if(live)live.textContent=alert.kind+': '+alert.text;
 const v=shown.get(k);if(v)paintSection(v.s,v.event,v.d);
 else if(k===key(current?.event||{})&&thisSection&&thisData)paintSection(thisSection,current.event,held(thisData),{thisGame:true});
 else if(bar){bar.querySelector('[data-tracker-alert]')?.remove();const pill=el('span','otv-trk-moment',alert.kind+' · '+alert.text);pill.dataset.trackerAlert=k;pill.dataset.trackerAlertId=alert.id;bar.append(pill);}
 refreshOpen();setTimeout(()=>{if(run!==generation||!surface||scope!==alertScope(event)||moments.get(k)!==record)return;const item=shown.get(k);if(item)paintSection(item.s,item.event,item.d);else if(k===key(current?.event||{}))paintThis(true);const pill=bar?.querySelector('[data-tracker-alert]');if(pill?.dataset.trackerAlertId===alert.id)pill.remove();refreshOpen();},MOMENT_MS+50);
}
function flushAlerts(){
 if(!surface||!prefs?.enabled||!ownedTracker()||document.hidden)return;
 const now=Date.now()/1000;
 for(const [k,item] of alertSnapshots){const event=all.find(e=>key(e)===k)||item.event;
  const scope=alertScope(event);if(!scope||item.scope!==scope||item.watched!==alertIsWatched(event))continue;
  if(item.watched&&(!trackerSample().display_ready||trackerSample().observed_play_id||trackerSample().manual_play_id))continue;
  const cut=item.watched?cutoff():now;
  const alerts=alertPolicy.consume({key:k,event,data:item.data,cutoff:cut,now,options:prefs.alerts,pinned:prefs.selected.includes(k),followed:event.followed===true||follows(event,followed())});
  if(alerts.length)showTrackerAlert(k,alerts.at(-1),event);
 }
}
async function queueTeamPhaseAlerts(rows,run,account){
 if(!prefs?.enabled||!prefs.alerts?.teamKickoffFinal)return;
 for(const event of rows){if(!event.followed||event.stale||!alertScope(event))continue;const k=key(event),before=alertPhases.get(k);alertPhases.set(k,event.state);
  if(event.state==='scheduled')alertPolicy.seedScheduled(k,prefs.alerts);
  if(before&&before!==event.state&&(event.state==='live'||event.state==='final')&&!alertPhaseFetches.has(k+'|'+event.state))alertPhasePending.set(k+'|'+event.state,{event,scope:alertScope(event)});
 }
 while(alertPhases.size>80)alertPhases.delete(alertPhases.keys().next().value);
 // One bounded metadata fetch per actual observed transition, using the existing board refresh.
 for(const [stamp,item] of [...alertPhasePending].slice(0,4)){const {event,scope}=item;if(!scope||alertScope(event)!==scope){alertPhasePending.delete(stamp);continue;}alertPhasePending.delete(stamp);alertPhaseFetches.add(stamp);try{
  const data=await T().fetchTracker(event);if(run!==generation||!ownedTracker()||account!==who()||!surface||alertScope(event)!==scope)return;rememberAlert(event,data);
 }catch{/* Missing exact boundary or unavailable metadata stays quiet. */}}
 while(alertPhaseFetches.size>160)alertPhaseFetches.delete(alertPhaseFetches.values().next().value);
}

/* ---------- the watched game: fetch + held paint ---------- */
let trackerWatchSerial=0;
let thisHistory=null;
function historyScope(){return [who(),String(feedId()),trackerEpoch,generation,trackerWatchSerial];}
function projectWatchedHistory(released,raw,cutoff){return thisHistory?.project(released,raw,{scope:historyScope(),cutoff})||released;}
function startThis(){thisHistory?.clear();thisHistory=null;const watchRun=++trackerWatchSerial;thisStop?.();thisStop=null;clearInterval(tick);tick=null;surface?.querySelectorAll('.otv-trk-probe').forEach(n=>n.remove());thisData=null;const ev=current?.event;if(!ev||!LEAGUES.includes(ev.league))return;thisData=neutralReferenceEstimate(ev);if(!prefs.enabled||!prefs.thisGame){disposeSyncAssist();window.TelevisionSportsPlayerUi?.heldScore?.(null,null);return;}startSync();
 thisHistory=window.OrbitalHistoryRuntime?.create(historyScope())||null;
 const probe=el('div','otv-trk-probe');probe.setAttribute('aria-hidden','true');surface.append(probe);
 // watch() pauses while its node is not visible; the probe is a 1px in-viewport node so the held score also serves the player bar.
 thisStop=T().watch(ev,probe,d=>{if(watchRun!==trackerWatchSerial||!ownedTracker()||key(ev)!==key(current?.event||{}))return;if(d?.kind==='unknown'&&thisData)return;thisData=d;const history=thisHistory;const ownedHistoryScope=historyScope();const preparing=history?.prepare(d,ownedHistoryScope);rememberAlert(ev,d);paintThis(false);preparing?.then(()=>{if(history===thisHistory&&watchRun===trackerWatchSerial&&thisData===d&&ownedTracker()&&key(ev)===key(current?.event||{}))paintThis(true);});},500,{ignoreModal:true,maxAgeMs:500,context:'viewer_source'});
 trackerSample();paintThis(true);tick=setInterval(()=>{void refreshTrackerOwner();if(video()!==trackerMedia)trackerSample();trackerFramePaint?.check();},250);}
function paintThis(force){if(!ownedTracker()){if(surface)teardown();return;}void refreshTrackerOwner();flushAlerts();if(trackerRolloverPending){if(thisSection)thisSection.hidden=true;return;}if(thisSection)thisSection.hidden=false;if(!surface||!thisData)return;const h=held(thisData);refreshCompactPane();
 const c=h.pending?null:(h.timeline||[]).at(-1)?.id||'none';const sig=[c,h.status,h.pending,h.reason,JSON.stringify(h.common_facts||null),trackerState.mode,trackerState.label,trackerState.offset,trackerState.historical,trackerState.estimated,sync.mode,sync.delay,Math.round(hold()/5),prefs.enabled,surface.dataset.mode,prefs.collapsed].join('|');
 if(!force&&sig===lastCut)return;
 lastCut=sig;window.TelevisionSportsPlayerUi?.heldScore?.(prefs.enabled&&prefs.thisGame?current?.event:null,prefs.enabled&&prefs.thisGame?h:null);
 if(thisSection&&prefs.enabled){paintSection(thisSection,current.event,h,{thisGame:true});refreshOpen();}}

/* ---------- picker rail (T7): never modal, never dims the game ---------- */
function roving(e,box){const keys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];if(!keys.includes(e.key))return;const items=[...box.querySelectorAll('button:not([disabled])')];const i=items.indexOf(document.activeElement);if(i<0)return;
 const rowOf=n=>n.closest('.otv-trk-row,.otv-trk-sheet-row')||n;let next=null;
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const row=[...rowOf(items[i]).querySelectorAll('button:not([disabled])')];const j=row.indexOf(items[i])+(e.key==='ArrowRight'?1:-1);next=row[j];}
 else{const rows=[...new Set(items.map(rowOf))];const r=rows.indexOf(rowOf(items[i]))+(e.key==='ArrowDown'?1:-1);next=rows[r]?(rows[r].matches('button')?rows[r]:rows[r].querySelector('button:not([disabled])')):null;}
 e.preventDefault();e.stopPropagation();next?.focus({preventScroll:false});}
async function openPicker(){if(!surface){return;}if(rail?.isConnected){rail.querySelector('button')?.focus();return;}const opener=document.activeElement;
 rail=el('aside','otv-trk-picker');rail.setAttribute('role','dialog');rail.setAttribute('aria-label','Other games');const list=el('div','otv-trk-picker-list');
 const close=button('Done',()=>closePicker(opener));const head=el('div','otv-trk-picker-head');head.append(el('b','','Games'),el('span','otv-trk-fine','Open details or watch another game · your game keeps playing'),close);
 rail.append(head,list);root().append(rail);applyLook();rail.dataset.side=prefs.corner;rail.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();closePicker(opener);return;}roving(e,rail);});
 close.focus({preventScroll:true});list.append(el('p','otv-trk-note','Loading games…'));
 try{if(!await refreshEvents()||!rail?.isConnected)return;paintPicker(list);}catch{list.replaceChildren(el('p','otv-trk-note','Games are temporarily unavailable.'));}}
function paintPicker(list){list.replaceChildren();
 const row=(event,{watching=false,upcoming=false}={})=>{const r=el('div','otv-trk-row');if(watching)r.classList.add('is-watching');const watched=watching?(thisData&&String(thisData.event_id)===String(event.id)&&thisData.league===event.league?held(thisData):{teams:[],pending:true}):null;const [away,home]=teamsOf(event,watched);
  const info=el('div','otv-trk-row-info');for(const t of [away,home]){const s=el('span','otv-trk-side');s.append(logo(t,22),el('span','otv-trk-abbr',t.abbr),el('span','otv-trk-score',upcoming?'':(t.score??'')));info.append(s);}
  info.append(el('span','otv-trk-status',watching?(watched?.pending?'Reported game estimate':watched?.status||'Your feed position'):upcoming?new Date(event.start).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):event.status||''));r.append(info);
  if(watching){const b=button(prefs.enabled&&prefs.thisGame?'Tracker on':'Tracker off',()=>{prefs.thisGame=!(prefs.enabled&&prefs.thisGame);prefs.enabled=prefs.thisGame;save();startThis();paintAll(true);b.textContent=prefs.thisGame?'Tracker on':'Tracker off';b.setAttribute('aria-pressed',String(prefs.thisGame));});b.setAttribute('aria-pressed',String(prefs.thisGame));r.append(el('span','otv-trk-tag','Watching'),b);return r;}
  if(!upcoming){const pinned=prefs.selected.includes(key(event)),pin=button(pinned?'Unpin':'Pin',()=>{const k=key(event);if(prefs.selected.includes(k))prefs.selected=prefs.selected.filter(x=>x!==k);else if(prefs.selected.length<MAX_PINS)prefs.selected.push(k);prefs.chosen=true;save();paintPicker(list);});pin.disabled=!pinned&&prefs.selected.length>=MAX_PINS;pin.setAttribute('aria-pressed',String(pinned));pin.setAttribute('aria-label',(pinned?'Unpin ':'Pin ')+event.name);r.append(pin);}const details=button('Details',()=>{if(!ownedTracker())return;window.OrbitalSportsCards?.open(event,api(),document.activeElement);});details.setAttribute('aria-label','Details for '+event.name);r.append(details);
  if(!upcoming){const w=button('Watch',()=>{if(!ownedTracker()||!F().eligible(event).length)return;closePicker();window.TelevisionPlayback.start({...event,switching:true});});w.disabled=!F().eligible(event).length;w.setAttribute('aria-label','Watch '+event.name);r.append(w);}
  return r;};
 const note=el('p','otv-trk-fine','Pins stay in this Games menu; trackers start off for each new game.');
 const mine=all.find(e=>key(e)===key(current?.event||{}))||current?.event;if(mine&&LEAGUES.includes(mine.league)){list.append(el('span','otv-trk-label','Watching'),row(mine,{watching:true}));}
 list.append(el('span','otv-trk-label','Live now'));if(events.length)for(const e of events)list.append(row(e));else list.append(el('p','otv-trk-note','No other live games right now.'));
 const later=all.filter(e=>e.followed&&e.state==='scheduled');if(later.length){list.append(el('span','otv-trk-label','Your teams later'));for(const e of later)list.append(row(e,{upcoming:true}));}
 list.append(note);}
function closePicker(opener){const had=rail;rail?.remove();rail=null;if(had&&opener?.isConnected)opener.focus({preventScroll:true});}

/* ---------- quiet controls (scores never fade) ---------- */
function quiet(){quietOff?.();if(!surface)return;const node=surface;let timer=0,keyboard=false;const wake=e=>{if(e)keyboard=e.type==='keydown';node.classList.remove('is-quiet');clearTimeout(timer);timer=setTimeout(()=>{if((!keyboard||!node.contains(document.activeElement))&&!rail?.isConnected&&!sheet)node.classList.add('is-quiet');else wake();},3000);};
 const kinds=['pointermove','pointerdown','keydown','touchstart'];for(const t of kinds)document.addEventListener(t,wake,{passive:true,capture:true});wake(null);quietOff=()=>{clearTimeout(timer);for(const t of kinds)document.removeEventListener(t,wake,{capture:true});quietOff=null;};}

/* ---------- lifecycle ---------- */
function teardown(preserveAlignment=false){thisHistory?.clear();thisHistory=null;disposeSyncAssist();ownerExecutionOff?.();ownerExecutionOff=null;ownerExecution=null;trackerOwnerJob=null;trackerOwnerBusy=false;fetchedTrackerOwner=null;fetchedOwnerEpoch=null;trackerOwnerQuery='';trackerOwnerAt=0;baseballRosters.clear();if(!preserveAlignment)displayContext.reset();completedExposure.reset();trackerFramePaint?.dispose();trackerFramePaint=null;trackerMediaDiagnostic?.dispose();trackerMediaDiagnostic=null;trackerMediaOff?.();trackerMediaOff=null;trackerMedia=null;trackerSrc='';trackerEpoch++;trackerClock.reset();if(!preserveAlignment){viewerAlignment.reset();retainedTracker=null;retainedSource=null;retainedCut=null;retainedCheckpointSerial=0;}else viewerAlignment.suspend();trackerState=null;trackerRolloverPending=false;trackerRolloverContext=null;trackerWatchSerial++;quietOff?.();layoutOff?.();generation++;clearTimeout(eventTimer);eventTimer=null;clearTimeout(holdTimer);holdTimer=null;clearInterval(tick);tick=null;thisStop?.();thisStop=null;thisData=null;
 stopOthers();shown.clear();stackSig='';closeSheet();rail?.remove();rail=null;surface?.remove();surface=null;col=null;stack=null;bar=null;toggle=null;live=null;thisSection=null;events=[];all=[];lastCut=null;moments.clear();seenScoring.clear();resetAlertState();alertCurrentScope="";
 window.TelevisionSportsPlayerUi?.heldScore?.(null,null);}
function build(account,continuingPrefs=null){owner=account;ownerExecution=window.OrbitalTrackerOwnership.capture();const execution=ownerExecution;ownerExecutionOff=window.OrbitalTrackerOwnership.observe(execution,()=>{if(ownerExecution===execution){externalSerial++;teardown();current=null;}});prefs=continuingPrefs||read();surface=el('aside','otv-trk');surface.id='orbital-trackers';surface.setAttribute('aria-label','Game trackers');
 col=el('div','otv-trk-col');stack=el('div','otv-trk-stack');bar=el('div','otv-trk-bar');live=el('div','otv-trk-live');live.setAttribute('aria-live','polite');live.className='otv-trk-live';
 toggle=button('',()=>{if(!ownedTracker()){teardown();return;}prefs.enabled=!prefs.enabled;prefs.thisGame=prefs.enabled;save();startThis();if(prefs.enabled&&!events.length)refreshEvents().then(ok=>{if(ok)paintAll(true);}).catch(()=>paintAll(true));else paintAll(true);},'otv-trk-btn otv-trk-toggle');
 let held=false;toggle.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();openPicker();}else if(e.key==='Enter'){e.preventDefault();if(e.repeat)return;held=false;holdTimer=setTimeout(()=>{holdTimer=null;held=true;toggle?.click();},600);}};
 toggle.onkeyup=e=>{if(e.key==='Enter'){e.preventDefault();if(holdTimer){clearTimeout(holdTimer);holdTimer=null;}if(!held)toggle.click();}};toggle.onblur=()=>{clearTimeout(holdTimer);holdTimer=null;};
 bar.append(toggle,button('Games',openPicker),button('Settings',openSettings,'otv-trk-btn otv-trk-gear'));
 col.append(bar,stack);surface.append(col,live);root().append(surface);
 const onResize=()=>{applyLook();};addEventListener('resize',onResize);const ro=typeof ResizeObserver==='function'?new ResizeObserver(()=>applyLook()):null;const pb=document.getElementById('television-player-feeds');if(pb)ro?.observe(pb);const mo=new MutationObserver(()=>applyLook());mo.observe(document.documentElement,{attributes:true,attributeFilter:['class']});const v=video();const onMeta=()=>applyLook();v?.addEventListener('loadedmetadata',onMeta);layoutOff=()=>{ro?.disconnect();mo.disconnect();removeEventListener('resize',onResize);v?.removeEventListener('loadedmetadata',onMeta);layoutOff=null;};}
function playback(view){const account=who();if(api()?.getCurrentUserId()===SIMPLE){teardown();current=null;return;}if(view&&!view.event?.id){teardown();current=null;return;}
 const continuing=!!view&&ownedTracker()&&owner===account&&current?.trackerSession!=null&&current.trackerSession===view.trackerSession&&String(current?.event?.id)===String(view.event?.id);
 if(continuing&&surface&&['recovering','starting','awaiting-frame'].includes(view.phase)){viewerAlignment.suspend();trackerWatchSerial++;thisStop?.();thisStop=null;current=view;paintThis(true);return;}
 if(!view||!['playing','buffering'].includes(view.phase)){if(surface)teardown();current=view;return;}
 if(surface&&ownedTracker()&&owner===account&&current?.attempt===view.attempt&&key(current.event)===key(view.event)){const same=trackerRolloverContext&&trackerRolloverContext.attempt===view.attempt&&String(trackerRolloverContext.channel).replace(/-/g,'').toLowerCase()===String(view.source?.id||'').replace(/-/g,'').toLowerCase();current={...view,event:same?trackerRolloverContext.event:{...current.event,...view.event}};return;}
 const continuingPrefs=continuing&&prefs?{...prefs,selected:[...prefs.selected]}:null;teardown(continuing);current=view;build(account,continuingPrefs);paintAll(true);startThis();window.OrbitalFollowed?.load();
 const g=generation;const poll=async()=>{if(g!==generation||!ownedTracker()||!surface)return;try{if(!document.hidden&&await refreshEvents()){paintAll();if(rail?.isConnected)paintPicker(rail.querySelector('.otv-trk-picker-list'));}}catch{}
  if(g===generation)eventTimer=setTimeout(poll,15000);};
 refreshEvents().then(ok=>{if(ok)paintAll();}).catch(()=>{});eventTimer=setTimeout(poll,15000);quiet();}
async function untrackedStarted(active,stream){
 const serial=++externalSerial;externalStream=stream;teardown();current=null;if(!['TvChannel','LiveTvChannel'].includes(stream?.item?.Type)||!stream.playSessionId)return;
 const execution=window.OrbitalTrackerOwnership.capture(),account=who(),manager=window.TelevisionPlayerBridge?.manager;
 const owns=()=>serial===externalSerial&&window.OrbitalTrackerOwnership.accepts(execution)&&account===who()&&manager?.currentItem(active)?.Id===stream.item.Id&&manager?.playSessionId?.(active)===stream.playSessionId;
 if(!owns())return;
 try{const a=api(),yesterday=new Date(Date.now()-86400000).toLocaleDateString('en-CA',{timeZone:'America/Chicago'}),responses=await Promise.all([today(),yesterday].map(date=>a.ajax({type:'GET',url:a.getUrl('sports/api/events',{date}),dataType:'json'})));if(!owns())return;
  const matches=[...new Map(responses.flatMap(d=>(d.events||[]).map(e=>F().withFreshness(e,d))).filter(e=>e.state==='live'&&!e.stale&&(e.sources?.some(s=>s.id===stream.item.Id)||(e.carriers||[]).includes(stream.item.Id))).map(e=>[key(e),e])).values()];
  if(matches.length===1){playback({event:matches[0],source:{id:stream.item.Id},phase:'playing',attempt:{external:stream.playSessionId}});return;}
 }catch{if(!owns())return;}
 // A channel we cannot match might still carry a game, so other-game data could spoil it: keep the v2 message.
 if(!owns()||api().getCurrentUserId()===SIMPLE&&!read().enabled)return;owner=account;surface=el('aside','otv-trk otv-trk-message');surface.id='orbital-trackers';
 surface.append(el('p','otv-trk-note','Trackers unavailable: the game being watched could not be identified.'));root().append(surface);}
function stopped(info){const state=info?.state||info,session=state?.PlayState?.PlaySessionId||state?.PlaySessionId;if(externalStream?.playSessionId&&session===externalStream.playSessionId){externalSerial++;externalStream=null;teardown();}}
document.addEventListener('fullscreenchange',()=>{if(surface)root().append(surface);if(rail?.isConnected)root().append(rail);applyLook();});
window.addEventListener('pagehide',()=>{externalSerial++;teardown();});document.addEventListener('visibilitychange',()=>{if(surface&&!ownedTracker()){externalSerial++;teardown();}});
function gameCenterProjection(event){
 if(!ownedTracker()||!current?.event||!event||String(current.event.id)!==String(event.id)||current.event.league!==event.league)return null;
 const before=pictureScope(),execution=ownerExecution,eventId=String(current.event.id),league=current.event.league,epoch=trackerEpoch;
 if(!before.account||!before.channel||before.execution!==execution)return null;
 const scope=JSON.stringify([before.account,before.channel,before.play||'pending',eventId,league,epoch]);
 let data=thisData&&String(thisData.event_id)===eventId&&thisData.league===league?held(thisData):null;
 if(!data)data=neutralReferenceEstimate(current.event);
 if(!ownedTracker()||execution!==ownerExecution||epoch!==trackerEpoch||!samePictureScope(before,pictureScope())||String(current?.event?.id)!==eventId||current.event.league!==league)return null;
 // The dialog receives only current viewer facts. Empty owned data never falls
 // through to raw latest Game Center cache, scoreboard, boxscore or recap.
 return {scope,event_id:eventId,league,coordinate_domain:pictureAdapter?.state().coordinate_domain||'utc',data:window.OrbitalHistoryRuntime?.copy(data)||structuredClone(data)};
}

window.TelevisionTrackerOverlay={gameCenterProjection,setAlertBinding:provider=>{alertOwnerProvider=typeof provider==='function'?provider:null;alertCurrentScope='';resetAlertState();},playback,openPicker,openSettings,teardown,untrackedStarted,stopped,held:()=>thisData?held(thisData):null,setOwnerBinding:provider=>{exactOwnerProvider=typeof provider==='function'?provider:null;},_debug:{held,cutoff,hold,sync:()=>sync,setDelay,liveLag,trackerState:()=>trackerState,alignmentMeasurements:()=>viewerAlignment.measurements(),displayContext:()=>displayContext.status(),manualMatch:play=>matchTrackerPlay(play),manualObservedState:value=>matchObservedTrackerState(value),syncAssist:()=>pictureAdapter?.state()||null,pictureSessionReady:()=>!!pictureSession,syncClock:()=>syncClockBase?{...syncClockBase,monoNow:performance.now(),mappedNow:pictureWall()}:null}};
window.TelevisionLiveTracker={...(window.TelevisionLiveTracker||{}),gameCenterProjection};
})();

/* Owned HTML player controls; leaves native player controls intact. */
(()=>{'use strict';
const ui=()=>window.TelevisionFeedUi,allowed=()=>ui()?.manualAllowed(window.ApiClient?.getCurrentUserId());
let serial=0,current=null,open=false,scoreTimer=null,chromeCleanup=()=>{},heldView=null,repaint=null,trackerContext=null,trackerPending=false,serverPresentation=false;
function openPlayerSettings(){const box=document.getElementById('television-player-feeds');if(!current||!allowed()||!box)return false;box.classList.remove('orbital-feed-sheet','orbital-browse-sheet');box.querySelector('.orbital-channel-browser')?.remove();box.querySelector('.orbital-settings-heading h2').textContent='Player settings';box.dispatchEvent(new Event('orbitalsettingsopen'));if(!box.open)box.showModal();return true;}
function openFeeds(){if(!openPlayerSettings())return;const box=document.getElementById('television-player-feeds'),toggle=box.querySelector('.otv-pbar-feed');if(toggle?.getAttribute('aria-expanded')!=='true')toggle?.click();const target=box.querySelector('.otv-player-feed[aria-current="true"]')||box.querySelector('.otv-player-feed')||toggle;box.classList.add('orbital-feed-sheet');const search=box.querySelector('.orbital-feed-search');if(search){search.value='';search.oninput();}box.querySelector('.orbital-settings-heading h2').textContent='Choose a feed';target?.scrollIntoView({block:'nearest'});target?.focus({preventScroll:true});}
// Jellyfin's dialog helper dispatches open BEFORE registering its history entry.
// Playback action sheets must not push/pop the underlying player route.
document.addEventListener('open',event=>{
 const sheet=event.target;if(!current||!allowed()||!sheet.matches?.('.actionSheet')||!document.querySelector('#videoOsdPage'))return;
 sheet.setAttribute('data-history','false');sheet.classList.add('orbital-playback-sheet');
 const close=node('button','Close','orbital-native-close');close.type='button';
 const dismiss=()=>{const container=sheet.dialogContainer;if(!sheet.isConnected||!container||sheet.dataset.orbitalClosing)return;sheet.dataset.orbitalClosing='true';sheet.dispatchEvent(new CustomEvent('command',{detail:{command:'back'},bubbles:true,cancelable:true}));};
 close.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();dismiss();});sheet.prepend(close);
 const escape=e=>{if(sheet.isConnected&&['Escape','BrowserBack'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();dismiss();}};
 window.addEventListener('keydown',escape,true);sheet.addEventListener('close',()=>window.removeEventListener('keydown',escape,true),{once:true});
},true);
let lastWatched=null,previousWatched=null;
function remember(view){
 const who=window.ApiClient?.getCurrentUserId(),server=window.ApiClient?.serverId?.();
 if(lastWatched&&(lastWatched.who!==who||lastWatched.server!==server)){lastWatched=null;previousWatched=null;}
 if(view?.phase!=='playing'||!view.source?.id)return;
 if(lastWatched?.id===view.source.id)return;
 previousWatched=lastWatched;lastWatched={who,server,id:view.source.id,event:view.event};
}
async function browse(guide){
 if(!openPlayerSettings())return;const box=document.getElementById('television-player-feeds'),api=window.ApiClient,who=api.getCurrentUserId(),attempt=current.attempt;
 box.classList.add('orbital-browse-sheet');box.querySelector('.orbital-settings-heading h2').textContent=guide?'TV guide':'Channels';
 const host=node('section',null,'orbital-channel-browser'),search=node('input'),list=node('div'),status=node('p'),more=node('button','Load more','otv-category');
 search.type='search';search.placeholder='Search channels';search.setAttribute('aria-label','Search channels');more.type='button';host.append(search,status,list,more);box.append(host);
 const owns=()=>box.isConnected&&box.open&&host.isConnected&&window.ApiClient===api&&api.getCurrentUserId()===who&&current?.attempt===attempt;
 let generation=0,offset=0,timer=null;
 async function load(reset){const run=++generation;if(reset){offset=0;list.replaceChildren();}const from=offset;more.disabled=true;status.textContent='Loading channels…';
  try{const result=await api.getLiveTvChannels({UserId:who,EnableCurrentProgram:true,StartIndex:from,Limit:60,SearchTerm:search.value.trim()});if(!owns()||run!==generation)return;
   if(!Array.isArray(result.Items))throw Error('Channels unavailable');
   for(const channel of result.Items){const row=node('button',String(channel.Number||'')+' '+String(channel.Name||'Channel'),'otv-player-feed');row.type='button';
    const program=channel.CurrentProgram;if(guide)row.append(node('small',program?.Name||'Schedule unavailable'));
    row.onclick=async()=>{if(!owns()||row.disabled)return;row.disabled=true;status.textContent='Switching channel…';try{await window.TelevisionPlayback.cancel(true);if(current||api!==window.ApiClient||who!==api.getCurrentUserId())return;box.close();location.hash='#/details?id='+encodeURIComponent(channel.Id)+'&serverId='+encodeURIComponent(api.serverId())+'&orbitalAutoplay=1';}catch{if(host.isConnected){status.textContent='The previous feed could not close. Please try again after it finishes.';row.disabled=false;}}};list.append(row);
   }offset=from+result.Items.length;more.hidden=!result.Items.length||offset>=Number(result.TotalRecordCount||offset);status.textContent=offset?offset+' channels shown':'No matching channels.';
  }catch{if(owns()&&run===generation)status.textContent='Channels could not load. Try again.';}finally{if(owns()&&run===generation)more.disabled=false;}
 }
 search.oninput=()=>{generation++;clearTimeout(timer);timer=setTimeout(()=>{if(owns())load(true);},250);};more.onclick=()=>load(false);box.addEventListener('close',()=>{generation++;clearTimeout(timer);},{once:true});await load(true);
}
function installChrome(box){
 const heading=node('header',null,'orbital-settings-heading');heading.append(node('h2','Player settings'));const close=node('button','Close','otv-category');close.type='button';close.onclick=()=>box.close();heading.append(close);box.prepend(heading);
 const playback=node('section',null,'orbital-playback-settings');playback.append(node('h3','Playback'));
 const nativeBindings=[];
 const nativeButton=(label,selector)=>{const slot=node('span',null,'orbital-native-control-slot');playback.append(slot);nativeBindings.push({label,selector,slot});return slot;};
 nativeButton('Quality, speed & display','.btnVideoOsdSettings');
 const audio=nativeButton('Audio','.btnAudio'),subtitles=nativeButton('Subtitles','.btnSubtitles');
 const restoreNative=()=>{for(const binding of nativeBindings){const {target,marker,caption,close}=binding;if(!target)continue;target.removeEventListener('click',close);caption.remove();target.classList.remove('orbital-native-playback-control');target.removeAttribute('aria-label');if(binding.aria!==null)target.setAttribute('aria-label',binding.aria);marker.replaceWith(target);binding.target=null;}};
 const refreshPlayback=()=>{restoreNative();for(const binding of nativeBindings){const target=document.querySelector('#videoOsdPage '+binding.selector);binding.slot.hidden=!target||target.classList.contains('hide')||target.disabled;if(binding.slot.hidden)continue;const marker=document.createComment('native playback control'),caption=node('span',binding.label,'orbital-native-caption');binding.aria=target.getAttribute('aria-label');binding.target=target;binding.marker=marker;binding.caption=caption;binding.close=e=>{e.stopPropagation();box.close();};target.before(marker);target.classList.add('orbital-native-playback-control');target.setAttribute('aria-label',binding.label);target.append(caption);binding.slot.append(target);target.addEventListener('click',binding.close);}};
 box.addEventListener('orbitalsettingsopen',refreshPlayback);box.addEventListener('close',restoreNative);box.append(playback);
 const group=node('section',null,'orbital-tracker-settings');group.append(node('h3','Tracker')); group.setAttribute('aria-label','Tracker appearance');
 const label=node('label','Tracker size '),size=node('input'),value=node('output');size.type='range';size.min='60';size.max='170';size.step='5';size.setAttribute('aria-label','Tracker size');
 const refresh=()=>{size.value=String(Math.round((window.OrbitalTrackerPlacement?.state().scale||1)*100));value.textContent=size.value+'%';};
 size.oninput=()=>{window.OrbitalTrackerPlacement?.size(Number(size.value)/100);value.textContent=size.value+'%';};label.append(size,value);group.append(label);
 const action=(text,fn)=>{const b=node('button',text,'otv-category');b.type='button';b.onclick=fn;group.append(b);};
 action('Move tracker',()=>{window.OrbitalTrackerPlacement?.moving(true);box.close();});
 action('Reset position',()=>{window.OrbitalTrackerPlacement?.reset();refresh();});
 action('Show tracker',()=>window.OrbitalServerPlayerRuntime?.show());action('Hide tracker',()=>window.OrbitalServerPlayerRuntime?.hide());
 for(const [label,nudge] of [['Earlier',-1],['Later',1]])action(label,()=>window.OrbitalServerPlayerRuntime?.manual({nudge_s:nudge}));
 const note=node('p','Size and position save automatically. Choose Move tracker, drag the highlighted handle, then Done moving to return here. Earlier/Later changes sync by one second.');group.append(note);
 const cameraLabel=node('label','Pitch camera'),camera=node('select');camera.setAttribute('aria-label','Pitch camera');
 for(const [id,label] of [['catcher-close','Close-up catcher'],['catcher','Catcher'],['wide-catcher','Wide catcher'],['umpire','Umpire'],['side','Side'],['pitcher','Pitcher'],['free','Rotate freely']]){const o=node('option',label);o.value=id;camera.append(o);}
 const refreshCamera=()=>{try{camera.value=localStorage.getItem('orbital-pitch-camera-v1')||'catcher-close';}catch{}cameraLabel.hidden=current?.event?.league!=='MLB';};
 camera.onchange=()=>{try{localStorage.setItem('orbital-pitch-camera-v1',camera.value);}catch{}window.dispatchEvent(new Event('orbitalpitchcamera'));};cameraLabel.append(camera);group.append(cameraLabel);refreshCamera();box.addEventListener('orbitalsettingsopen',refreshCamera);
 box.append(group);refresh();box.addEventListener('orbitalsettingsopen',refresh);
 const done=node('button','Done','otv-category orbital-settings-done');done.type='button';done.onclick=()=>{window.OrbitalTrackerPlacement?.moving(false);box.close();};box.append(done);box.addEventListener('cancel',()=>window.OrbitalTrackerPlacement?.moving(false));box.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();window.OrbitalTrackerPlacement?.moving(false);box.close();}},true);
 const place=()=>{const bottom=document.querySelector('.videoOsdBottom');if(!bottom||bottom.querySelector('.orbital-player-settings-button'))return;const button=node('button','Player settings','otv-category orbital-player-settings-button');button.type='button';button.onclick=openPlayerSettings;const count=ui().sources(current.event).filter(s=>!s.automatic&&ui().manualAvailable(s)).length;const feeds=node('button',ui().label(current.source,current.event)+' · '+count+' feeds','otv-category orbital-player-feeds-button');feeds.type='button';feeds.setAttribute('aria-label','Switch feeds');feeds.onclick=openFeeds;const actions=node('div',null,'orbital-player-actions');const tracker=node('button','Tracker','otv-category');tracker.type='button';tracker.onclick=()=>{if(openPlayerSettings())box.querySelector('.orbital-tracker-settings')?.scrollIntoView({block:'start'});};const center=node('button','Game Center','otv-category');center.type='button';center.onclick=()=>box.querySelector('.orbital-game-center-action')?.click();const channels=node('button','Channels','otv-category'),guide=node('button','Guide','otv-category'),last=node('button','Last channel','otv-category orbital-last-channel');
 for(const b of [channels,guide,last])b.type='button';channels.onclick=()=>browse(false);guide.onclick=()=>browse(true);
 last.disabled=!previousWatched;last.onclick=()=>{const p=previousWatched;if(!p||p.who!==window.ApiClient?.getCurrentUserId()||p.server!==window.ApiClient?.serverId?.())return;window.TelevisionPlayback.select({...p.event,switching:true},p.id);};
 actions.append(feeds,tracker,center,button,channels,guide,last);bottom.append(actions);};
 const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});place();
 chromeCleanup=()=>{restoreNative();observer.disconnect();document.querySelectorAll('.orbital-player-actions').forEach(n=>n.remove());document.documentElement.classList.remove('otv-sports-chrome-hidden');};
}

if(!window.__otvClickRelay){window.__otvClickRelay=true;window.addEventListener('click',e=>{const b=e.target?.closest?.('#television-player-feeds button,#television-play-status button,.orbital-player-actions button');if(!b||b.disabled||typeof b.onclick!=='function')return;e.stopImmediatePropagation();e.preventDefault();b.onclick(e);},true);}
// Text entry and selects belong to the drawer, never to transport shortcuts.
for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{
 if(!e.target?.closest?.('#television-player-feeds input,#television-player-feeds select,#television-player-feeds textarea'))return;
 e.stopImmediatePropagation();
 if(type==='keydown'&&['Escape','BrowserBack'].includes(e.key)){e.preventDefault();window.OrbitalTrackerPlacement?.moving(false);document.getElementById('television-player-feeds')?.close();}
},true);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const root=()=>document.fullscreenElement||document.body;
function paint(view){remember(view);if(view&&view.attempt!==current?.attempt){heldView=null;trackerPending=true;}if(trackerContext&&view?.attempt===trackerContext.attempt&&String(view?.source?.id||'').replace(/-/g,'').toLowerCase()===String(trackerContext.channel).replace(/-/g,'').toLowerCase())view={...view,event:trackerContext.event};else{trackerContext=null;}const existing=document.getElementById('television-player-feeds');if(view&&allowed()&&view.attempt===current?.attempt&&String(view.event?.id)===String(current?.event?.id)&&view.event?.league===current?.event?.league&&existing&&['playing','buffering','awaiting-frame'].includes(view.phase)){current=view;const last=document.querySelector('.orbital-last-channel');if(last)last.disabled=!previousWatched;if(existing.parentNode!==root())root().append(existing);return;}current=view;serial++;chromeCleanup();clearInterval(scoreTimer);existing?.remove();if(!view||!allowed()||!['playing','buffering','awaiting-frame'].includes(view.phase))return;
 const run=serial,ev=view.event,api=window.ApiClient,art=t=>window.OrbitalTeamArt?.[ev.league+'|'+t.name]||{};
 const box=node('dialog',null,'otv-player-feeds otv-pbar orbital-player-settings');box.id='television-player-feeds';box.setAttribute('aria-label','Sports playback');
 // Slim bar: live score, then Feed / Other games / Game center. The score refreshes from the same public events feed.
 const toggle=node('button','Feed · '+ui().label(view.source,ev),'otv-category otv-pbar-feed');toggle.type='button';toggle.title=ui().raw(view.source);toggle.setAttribute('aria-expanded',String(open));
 const score=node('div',null,'otv-pbar-score');const paintScore=e=>{score.replaceChildren(node('span',serverPresentation?(e.presentation_label||'WAITING'):e.tracker_pending?'ESTIMATE':'LIVE','otv-live-pill'));const teams=(e.teams||[]).slice().sort((x,y)=>Number(x.side==='home')-Number(y.side==='home'));teams.forEach((t,i)=>{if(i)score.append(node('span','–','otv-pbar-dash'));const a=art(t);if(a.url?.startsWith('https://a.espncdn.com/')){const img=node('img',null,'otv-pbar-logo');img.src=a.url;img.alt='';score.append(img);}score.append(node('span',(a.abbr||t.name)+(t.score!=null&&t.score!==''?' '+t.score:''),'otv-pbar-team'));});score.append(node('span',e.status||'','otv-pbar-status'));};let lastEv=ev;repaint=e=>{if(e)lastEv=e;const h=heldView;paintScore(trackerPending?(serverPresentation?{...lastEv,teams:(lastEv.teams||[]).map(t=>({...t,score:''})),status:'Waiting for game context',presentation_label:'WAITING',tracker_pending:true}:{...lastEv,status:[lastEv.status,'Reported estimate'].filter(Boolean).join(' · '),tracker_pending:true}):h?{...lastEv,teams:serverPresentation?(h.teams||[]):(lastEv.teams||[]).map(t=>{const x=(h.teams||[]).find(y=>y.side===t.side);return {...t,score:x?.score??''};}),status:h.status||'',presentation_label:h.card?.label||h.unavailable_reason||''}:lastEv);};repaint(ev);
 box.append(score,toggle);
 const panel=node('div',null,'otv-player-feed-panel');panel.hidden=!open;toggle.onclick=()=>{open=!open;panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
 const feedTitle=node('h2','Choose your feed');feedTitle.className='orbital-feed-list-title';panel.append(feedTitle);
 const search=node('input');search.type='search';search.placeholder='Search feeds';search.setAttribute('aria-label','Search feeds');search.className='orbital-feed-search';
 const empty=node('p','No matching feeds.');empty.hidden=true;empty.className='orbital-feed-empty';
 search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase();let count=0;for(const b of panel.querySelectorAll('.otv-player-feed[data-feed-id]')){b.hidden=!b.textContent.toLocaleLowerCase().includes(q);if(!b.hidden)count++;}empty.hidden=count>0;};panel.append(search,empty);const automatic=node('button','Automatic','otv-player-feed');automatic.type='button';automatic.setAttribute('aria-current',String(!view.manual));automatic.append(node('small','Picks a working feed and switches if it fails'));automatic.onclick=()=>{if(!allowed()||!view.manual)return;box.close();window.TelevisionPlayback.start({...ev,switching:true});};panel.append(automatic);for(const source of ui().sources(ev).filter(s=>!s.automatic&&ui().manualAvailable(s))){const on=source.id===view.source?.id,b=node('button',ui().label(source,ev),'otv-player-feed');b.type='button';b.title=ui().raw(source);b.dataset.feedId=source.id;b.setAttribute('aria-current',String(on));const e=ui().evidence(source);b.append(node('small',[on?'Watching':null,ui().quality(source)].filter(Boolean).join(' · ')));if(e){const chip=node('span',e.chip,'otv-feed-note');chip.dataset.tone=e.tone;b.append(chip);}b.onclick=()=>{if(!allowed()||on||!ui().manualAvailable(source))return;open=false;box.close();window.TelevisionPlayback.select(ev,source.id);};panel.append(b);}
 if(!panel.querySelector('.otv-player-feed[data-feed-id]'))panel.append(node('p','No alternate feeds are available for this game.'));
 const other=node('button','Other games','otv-category');other.type='button';
 other.onclick=async()=>{const who=api?.getCurrentUserId();if(!allowed())return;open=true;panel.hidden=false;toggle.setAttribute('aria-expanded','true');other.disabled=true;panel.querySelector('.otv-player-other-games')?.remove();const list=node('div',null,'otv-player-other-games');panel.prepend(list);list.append(node('h3','Other live games'));try{const data=await api.ajax({type:'GET',url:api.getUrl('sports/api/events',{date:new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})}),dataType:'json'});if(run!==serial||who!==api.getCurrentUserId()||!allowed())return;const games=data.events.map(e=>ui().withFreshness(e,data)).filter(e=>e.state==='live'&&!e.stale&&(e.id!==ev.id||e.league!==ev.league)&&ui().eligible(e).length);for(const g of games){const b=node('button',g.name,'otv-player-game');b.type='button';b.append(node('small',[g.league,g.status,(g.teams||[]).map(t=>t.score).filter(v=>v!=null&&v!=='').join('–')].filter(Boolean).join(' · ')));b.onclick=()=>{if(!allowed())return;open=false;box.close();window.TelevisionPlayback.start({...g,switching:true});};list.append(b);}if(!games.length)list.append(node('p','No other live games with a confirmed feed.'));}catch{list.append(node('p','Other games are unavailable.'));}finally{if(run===serial)other.disabled=false;}};
 const center=node('button','Game center','otv-category orbital-game-center-action');center.type='button';center.onclick=async()=>{box.close();try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}window.OrbitalSportsCards?.open(ev,api,center);};
 const trackers=node('button','Trackers','otv-category');trackers.type='button';trackers.onclick=()=>{if(run!==serial||!box.isConnected||window.ApiClient!==api||!allowed()||current?.attempt!==view.attempt||String(current?.event?.id)!==String(ev.id)||current?.event?.league!==ev.league||String(current?.source?.id)!==String(view.source?.id))return;box.close();const runtime=window.OrbitalServerPlayerRuntime;if(typeof runtime?.openSettings==='function')runtime.openSettings();else window.TelevisionTrackerOverlay?.openSettings?.();};box.append(other,center);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();open=false;panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});box.append(panel);root().append(box);installChrome(box);
 scoreTimer=setInterval(async()=>{if(run!==serial||document.hidden)return;try{const data=await api.ajax({type:'GET',url:api.getUrl('sports/api/events',{date:new Date(ev.start).toLocaleDateString('en-CA',{timeZone:'America/Chicago'})}),dataType:'json'});const now=data.events.find(e=>e.id===ev.id&&e.league===ev.league);if(run===serial&&now)repaint(now);}catch{}},30000);
}
window.TelevisionSportsPlayerUi={openSettings:openPlayerSettings,schema2HudVersion:1,serverPresentation:active=>{serverPresentation=active===true;heldView=null;trackerPending=serverPresentation;repaint?.();},paint,trackerContext:(event,attempt,channel)=>{if(current?.attempt!==attempt||String(current?.source?.id||'').replace(/-/g,'').toLowerCase()!==String(channel||'').replace(/-/g,'').toLowerCase())return false;trackerPending=true;heldView=null;trackerContext={event:event||current.event,attempt,channel};if(event)paint({...current,event});else repaint?.();return true;},heldScore:(event,h)=>{heldView=h&&event&&current?.event&&String(event.id)===String(current.event.id)&&event.league===current.event.league&&(serverPresentation||!h.pending)?h:null;trackerPending=!heldView;repaint?.();}};document.addEventListener('fullscreenchange',()=>paint(current));
})();

/* One event per playback session; transport and stream negotiation remain Jellyfin-owned. */
(()=>{
'use strict';
const feedName=(source,event)=>globalThis.window?.TelevisionFeedUi?.label?.(source,event)||source?.label_short||source?.name;
function controller({bridge,identity,fresh,delay,notice,attemptFailure=()=>{},otherWays=()=>{},manualAllowed=()=>true,changed=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,monotonic=()=>globalThis.performance?.now?.()??Date.now()}){
 let plan=null,generation=0,cleanupBarrier=Promise.resolve(),closedBarrier=Promise.resolve();const retired=new WeakSet(),kept=new Set(),reportedFailures=new WeakSet();
 const retiring=new Set();let cleanupFault=false,overlapClosing=null;
 const snapshot=()=>plan&&valid(plan)?{event:plan.event,source:plan.sources[plan.index],phase:plan.phase,manual:plan.manual,attempt:plan.attempt,trackerSession:plan.generation}:null;
 const emit=()=>changed(snapshot());
 const valid=p=>!!p&&plan===p&&p.generation===generation&&p.identity===identity()&&Date.now()<p.expires;
 function clearTimerOnly(p){if(p?.timer){clearTimer(p.timer);p.timer=null;}}
 function clearWatch(p){clearTimerOnly(p);p?.unobserve?.();p&&(p.unobserve=null);}
 // Oct 20: open the next feed as soon as every old feed is closed if the server reports a free paid connection;
 // otherwise (busy or unknown) wait for the full cleanup as before.
 async function openable(closing){let done=false;closing.then(()=>{done=true;},()=>{});
  try{await Promise.race([closing,bounded(closedBarrier)]);}catch(e){await closing;return;}
  if(done)return;
  const who=identity(),api=window.ApiClient;
  while(!done&&who===identity()&&api===window.ApiClient){
   try{const r=await Promise.race([closing,bounded(Promise.resolve().then(()=>api.getJSON(api.getUrl('sports/api/capacity'))),2500,'CapacityTimeout')]);
    if(done)return;
    if(r&&r.fresh===true&&Number.isInteger(r.free)&&r.free>=1&&who===identity()&&api===window.ApiClient)return;
   }catch(e){if(done)return;}
   let timer;try{await Promise.race([closing,new Promise(resolve=>{timer=setTimer(resolve,1000);})]);}finally{clearTimer(timer);}
  }
  await closing;}
 function bounded(promise,timeout=45000,code='CleanupTimeout'){return new Promise((resolve,reject)=>{const timer=setTimer(()=>reject(Error(code)),timeout);promise.then(v=>{clearTimer(timer);resolve(v)},e=>{clearTimer(timer);reject(e)});});}
 // A stalled game-metadata request must not leave the recovery cover forever.
 // This bounds metadata only: exact media retirement still owns its existing fence.
 function refresh(event,p=null,manualSource=null){const remaining=p?p.automaticDeadline-monotonic():12000;if(remaining<=0)return Promise.reject(Error('EventRefreshTimeout'));return bounded(Promise.resolve().then(()=>fresh(event,manualSource)),Math.min(12000,remaining),'EventRefreshTimeout');}
 const refreshTimeoutMessage='Game information did not respond. Refresh this game or choose another feed.';
 function releaseUnplayed(p,a,stream){
  // One Open response acquired one consumer, even if another response has the same
  // shared LiveStreamId. Deduplicate by attempt, never by shared stream identity.
  if(a.release)return a.release;
  retired.add(stream);
  a.release=Promise.resolve().then(async()=>{
   if(p.identity!==identity())throw Error('Playback identity changed');
   if(stream.liveStreamId){
    if(!bridge()?.releaseUnplayed)throw Error('Unplayed stream cleanup unavailable');
    await bridge().releaseUnplayed(p.serverId,stream.liveStreamId);
   }
  });
  a.release.then(a.readyResolve,a.readyReject);return a.release;
 }
 function cleanupAttempt(p,keepPlayer=false){
  const a=p?.attempt;if(!a)return Promise.resolve();if(a.cleanup)return a.cleanup;
  // Register before awaiting Open so an immediate Back cannot miss this retirement.
  if(keepPlayer)kept.add(a);
  if(a.stream)retired.add(a.stream);
  a.detached=new Promise((resolve,reject)=>{a.detachResolve=resolve;a.detachReject=reject});a.detached.catch(()=>{});retiring.add(a);
  a.closedPromise=new Promise(r=>{a.closedMark=r;});a.cleanup=(async()=>{
   await a.ready;if(p.identity!==identity())throw Error('Playback identity changed');
    if(a.nativeToken){
     const b=bridge();if(typeof b?.stopNativeForSwitch!=='function')throw Error('Exact native retirement unavailable');
     const result=await b.stopNativeForSwitch(a.player,a.nativeToken,a.accepted?a.stream:undefined);
     if(result?.player!==a.player||result.token!==a.nativeToken||result.local_detached!==true||
        (a.accepted?(result.stream!==a.stream||result.pending_cancelled!==false):(result.stream!==null||result.pending_cancelled!==true)))throw Error('Exact native retirement changed');
     a.nativeRetirement=result;a.switchDetached=true;
     if(a.accepted){
      if(!a.stream?.playSessionId?.trim()||!b.stopEncoding)throw Error('Exact encoding cleanup unavailable');
      // Missing final binding stays serial; close only the last known actual session.
      await b.stopEncoding(p.serverId,a.stream.playSessionId);
     }
   }else if(a.accepted){
    const b=bridge(),current=a.player&&b?.manager.currentItem(a.player);
    if(!a.stream?.playSessionId?.trim()||!b.stopEncoding)throw Error('Exact encoding cleanup unavailable');
    // The HTML player object is shared. A stale callback must never stop a newer item.
    const ownsPending=a.player?.streamInfo===a.stream;
    if(a.player?.isLocalPlayer&&(ownsPending||current?.Id===a.itemId&&(!b.manager.playSessionId||b.manager.playSessionId(a.player)===a.stream?.playSessionId))){
     if(keepPlayer&&typeof b.stopForSwitchLocal==='function'){
      kept.add(a);
      // Local detachment is independent of the old server STOP. Hold that STOP
      // until the next actual Open returns, avoiding Jellyfin's global live lock.
      const local=b.stopForSwitchLocal(a.player,a.stream,()=>p.identity===identity());
      a.releaseServerStop=()=>a.stream.orbitalSwitchReleaseReport?.();
      await local;a.switchDetached=true;await a.finished;a.detachResolve(true);
      if(a.stream.orbitalReportFence?.failed){
       a.releaseServerStop();
       await b.stopEncoding(p.serverId,a.stream.playSessionId);
       if(a.stream.orbitalReportFence.blockedByPrior&&!a.stream.orbitalReportFence.startDispatched)await releaseUnplayed(p,a,a.stream);
       else throw Error('Playback report acknowledgement unknown');
      }else try{await a.stream.orbitalSwitchStop;}catch(error){
       if(a.stream.orbitalReportFence?.blockedByPrior&&!a.stream.orbitalReportFence.startDispatched)await releaseUnplayed(p,a,a.stream);
       else{await b.stopEncoding(p.serverId,a.stream.playSessionId);throw error;}
      }
     }else if(keepPlayer){if(!b.stopForSwitch)throw Error('In-player switching unavailable');kept.add(a);await b.stopForSwitch(a.player,a.stream);a.switchDetached=true;}
     else if(a.stream.orbitalReportFence?.failed&&typeof b.stopForSwitchLocal==='function'){
      await b.stopForSwitchLocal(a.player,a.stream,()=>p.identity===identity());
      a.stream.orbitalSwitchReleaseReport?.();a.switchDetached=true;
      if(a.stream.orbitalReportFence.blockedByPrior&&!a.stream.orbitalReportFence.startDispatched)await releaseUnplayed(p,a,a.stream);
      else{await b.stopEncoding(p.serverId,a.stream.playSessionId);throw Error('Playback report acknowledgement unknown');}
     }else await b.manager.stop(a.player);
    }
    if(a.stream.orbitalReportFence){
     try{await a.stream.orbitalReportFence.tail;}catch(error){
      if(a.stream.orbitalReportFence.blockedByPrior&&!a.stream.orbitalReportFence.startDispatched)await releaseUnplayed(p,a,a.stream);
      else{await b.stopEncoding(p.serverId,a.stream.playSessionId);throw error;}
     }
    }
    await b.stopEncoding(p.serverId,a.stream.playSessionId);
   }else if(a.release)await a.release;
   // Wait for the original play chain too: a late error must not attach to the next plan.
   await a.finished;
   // This is local retirement, not transport closure or a first-frame receipt.
   a.detachResolve(a.switchDetached===true);
   a.closedMark?.();
   // Preserve the tuner service's 10s shutdown and gateway's 3s release grace.
   await delay(13500);
   if(a.accepted){
    // An aborted HLS request can register its encoder after the first DELETE.
    // Reap only this immutable attempt's encoders; never release its consumer twice.
    if(p.identity!==identity())throw Error('Playback identity changed');
    const session=a.stream?.playSessionId;
    if(!session?.trim()||!bridge()?.stopEncoding)throw Error('Exact encoding cleanup unavailable');
    // Ask the server instead of guessing: only a live encoder on this device needs the
    // second stop and drain. Unknown or failed answers keep the containment fence.
    let residue=true;try{if(bridge().encoderResidue)residue=await bridge().encoderResidue(p.serverId);}catch(error){residue=true;}
    if(residue!==false){await bridge().stopEncoding(p.serverId,session);await delay(13500);}
   }
  })();
  a.cleanup.then(()=>retiring.delete(a),error=>{retiring.delete(a);cleanupFault=true;a.detachReject(error);});
  cleanupBarrier=Promise.all([cleanupBarrier,a.cleanup]).then(()=>{});cleanupBarrier.catch(()=>{});closedBarrier=Promise.all([closedBarrier,Promise.race([a.closedPromise,a.cleanup])]).then(()=>{});closedBarrier.catch(()=>{});
  return a.cleanup;
 }
 function stopAttempt(p){return bounded(cleanupAttempt(p,true));}
 const sourceBlocked=s=>s?.policy_excluded===true||s?.blackout===true||s?.notice_only===true;
 const automaticEligible=s=>!!s&&!sourceBlocked(s)&&(typeof s.automatic_eligible==='boolean'?s.automatic_eligible:s.eligible===true);
 const manualAvailable=s=>!!s&&!sourceBlocked(s)&&s.manual_available!==false;
 function sourcesFor(current,manualSource){const all=[...new Map((current.sources||[]).filter(s=>s?.id).map(s=>[s.id,s])).values()],automatic=all.filter(s=>!s.automatic&&automaticEligible(s)),selected=manualSource?all.find(s=>!s.automatic&&manualAvailable(s)&&s.id===manualSource):null;return {all,sources:(manualSource?(selected?[selected,...automatic.filter(s=>s.id!==manualSource)]:[]):automatic).slice(0,5)};}
 function confirmed(current){return !!current&&(current.state==='live'||current.watchable===true)&&!current.stale;}
 function recoverySourceFact(source){
  // This private server DTO carries current protected source/topology and
  // separately proven content/usability. Sample quality alone is insufficient.
  try{
   const value=source?.feedcheck_recovery,now=Date.now()/1000;
   const keys=['schema','source_scope_sha256','observed_at','valid_until','failure_scope','failure_closure_complete','fallback_groups','content_current_event','picture_usable','audio_usable'];
   if(!value||typeof value!=='object'||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||
      value.failure_scope!=='managed_canonical_leaf_closure_v1'||value.schema!==1||typeof value.source_scope_sha256!=='string'||
      !/^[a-f0-9]{64}$/.test(value.source_scope_sha256)||value.failure_closure_complete!==true||
      ![value.observed_at,value.valid_until].every(v=>typeof v==='number'&&Number.isFinite(v))||
      !(0<=value.observed_at&&value.observed_at<=now&&now<value.valid_until&&value.valid_until-value.observed_at<=15)||
      !Array.isArray(value.fallback_groups)||!value.fallback_groups.length||value.fallback_groups.length>64||
      value.fallback_groups.some((v,i)=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)||i>0&&v<=value.fallback_groups[i-1])||
      !['content_current_event','picture_usable','audio_usable'].every(k=>typeof value[k]==='boolean'))return null;
   return Object.freeze({sourceId:source.id,scope:value.source_scope_sha256,failureScope:value.failure_scope,
    domains:Object.freeze(value.fallback_groups.slice()),
    usable:value.content_current_event&&value.picture_usable&&value.audio_usable});
  }catch{return null;}
 }
 function recoveryBindings(sources){
  const values=Object.create(null);
  for(const source of sources){const fact=recoverySourceFact(source);if(fact)values[source.id]=fact;}
  return Object.freeze(values);
 }
 function trustedRecoveryIndex(p,a,current,fallback){
  // Actual attempts advance monotonically through the original bounded ids.
  // Prefer disjoint managed route leaves; this says nothing about shared
  // provider/account or physical CDN independence and attributes no failure.
  // Existing cleanup, admission, time budget and attempt limit remain owners.
  try{
   if(p.manual||!valid(p)||p.phase!=='recovering'||p.attempt!==a||a.itemId!==p.ids[p.index]||
      !Number.isInteger(p.failures)||p.failures<1||p.failures>2||monotonic()>=p.automaticDeadline||
      !confirmed(current)||current.id!==p.event.id||current.league!==p.event.league||
      current.serverId!==p.serverId||!Array.isArray(current.sources))return fallback;
   const ids=current.sources.map(s=>s?.id);
   if(new Set(ids).size!==ids.length)return fallback;
   const same=(left,right)=>left&&right&&left.sourceId===right.sourceId&&left.scope===right.scope&&left.failureScope===right.failureScope&&
    left.domains.length===right.domains.length&&left.domains.every((v,i)=>v===right.domains[i]);
   const failed=recoverySourceFact(current.sources.find(s=>s?.id===a.itemId));
   if(!same(p.recoveryBindings?.[a.itemId],failed))return fallback;
   for(let index=p.index+1;index<p.ids.length;index++){
    const source=current.sources.find(s=>s?.id===p.ids[index]);
    if(source?.automatic||!automaticEligible(source))continue;
    const candidate=recoverySourceFact(source);
    if(same(p.recoveryBindings?.[source.id],candidate)&&candidate.usable&&
       candidate.domains.every(domain=>!failed.domains.includes(domain)))return index;
   }
   return fallback;
  }catch{return fallback;}
 }

 function failureQualityAdvice(p,a,current){
  // Source-sample diagnosis only: no rank, target, capacity or switch permission.
  // The current failed request supplies ownership; the source digest identifies
  // only the canonical feed sample, never the viewer's audio track or speakers.
  try{
   const captured=a?.qualitySourceBinding,now=Date.now()/1000;
   if(p.manual||!valid(p)||p.phase!=='recovering'||p.attempt!==a||!captured||
      captured.requestGeneration!==p.generation||
      captured.sourceId!==a.itemId||captured.eventId!==p.event.id||captured.league!==p.event.league||
      captured.serverId!==p.serverId||current?.id!==captured.eventId||current?.league!==captured.league||
      current?.serverId!==captured.serverId||!confirmed(current))return null;
   const matches=(current.sources||[]).filter(s=>s?.id===captured.sourceId);
   if(matches.length!==1)return null;
   const q=matches[0].feedcheck_quality,fixed=new Set(['near_uniform_green_observed','black_picture_observed','short_static_window_observed','corrupt_decode_observed']);
   if(!q||q.schema!==1||typeof captured.sourceScope!=='string'||!/^[a-f0-9]{64}$/.test(captured.sourceScope)||
      q.source_scope_sha256!==captured.sourceScope||q.feed_fault!=='unresolved'||q.ranking_eligible!==false||
      ![q.observed_at,q.valid_until].every(v=>typeof v==='number'&&Number.isFinite(v))||
      !(0<=q.observed_at&&q.observed_at<=now&&now<q.valid_until&&q.valid_until-q.observed_at<=15)||
      !['energy_observed','low_energy_observed','unknown'].includes(q.audio_signal)||
      !Array.isArray(q.picturetechnicalfindings)||q.picturetechnicalfindings.length>4||
      q.picturetechnicalfindings.some(v=>typeof v!=='string'||!fixed.has(v))||
      new Set(q.picturetechnicalfindings).size!==q.picturetechnicalfindings.length)return null;
   const reason=q.diagnosis_reason===undefined?(q.picturetechnicalfindings.length?'picture_symptom':q.audio_signal==='low_energy_observed'?'audio_energy_missing':q.audio_signal==='energy_observed'?'audio_energy_observed':'unresolved'):q.diagnosis_reason;
   if(reason==='audio_energy_missing'&&q.audio_signal==='low_energy_observed')return 'Recent feed sample: low audio energy; quiet content can be normal. The playback cause is unconfirmed.';
   if(reason==='audio_energy_observed'&&q.audio_signal==='energy_observed')return 'Recent feed sample: audio energy observed. Sound at this device and the playback cause are unconfirmed.';
   if(reason==='picture_symptom'&&q.picturetechnicalfindings.length)return 'Recent feed sample: picture characteristics need review. The playback cause is unconfirmed.';
   return reason==='unresolved'?'Recent feed sample: the playback cause is unconfirmed.':null;
  }catch{return null;}
 }

// Local retirement admission only. The caller's source/capacity gates still apply.
function localRetirementReceipt(a){
 const p=a?.player,s=a?.stream;
 if(!p||!s||typeof p.getSwitchRetirement!=='function')return null;
 const valid=r=>r?.player===p&&r.start_settled===true&&r.local_detached===true;
 try{
  const html=p.getSwitchRetirement(s);
  if(html?.kind==='htmlvideo-stream-retirement-v1'&&valid(html)&&html.stream===s)return html;
  // Native has an independent API session. Its stable mirror is created solely
  // from the validated exact native epoch/lease response, never from core URLs.
  const native=p.getCurrentMediaSource?.();
  const id=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
  const itemEqual=(x,y)=>x===y||(/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(x)&&/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(y)&&x.replaceAll('-','').toLowerCase()===y.replaceAll('-','').toLowerCase());
  if(!native||!id(native.playSessionId)||native.playSessionId!==s.playSessionId||!id(native.mediaSourceId)||native.mediaSourceId!==s.mediaSource?.Id||!id(native.itemId)||!itemEqual(native.itemId,a.itemId)||!itemEqual(native.itemId,s.item?.Id))return null;
  const captured=a.nativeRetirement;
  if(!a.nativeToken||captured?.player!==p||captured.token!==a.nativeToken||captured.stream!==s||captured.mirror!==native||captured.local_detached!==true||captured.pending_cancelled!==false||s.orbitalNativeFinalTupleUnknown===true)return null;
  const coreLive=s.liveStreamId??s.mediaSource?.LiveStreamId??null;
  if(native.liveStreamId!==coreLive||native.Id!==native.mediaSourceId||native.LiveStreamId!==native.liveStreamId)return null;
  const r=p.getSwitchRetirement(native);
  return r?.kind==='phone-native-stream-retirement-v1'&&valid(r)&&r.stream===native?r:null;
 }catch{return null;}
}

 async function localAdmission(old,current,source,stillCurrent){
  const a=old?.attempt,retiringSource=old?.sources?.[a?.index],freshRetiringSource=(current?.sources||[]).find(s=>s?.id===a?.itemId);
  const shared=s=>s?.open_admission==='shared-gateway-capacity-v1';
  // Both the captured retiring route and its fresh exact-source DTO must share
  // the next route's canonical admission capability. Unknown routes stay serial.
  if(!a?.accepted||!a.player?.isLocalPlayer||typeof a.player?.getSwitchRetirement!=='function'||!a.stream?.playSessionId?.trim()||source?.id===a.itemId||!shared(source)||retiringSource?.id!==a.itemId||!shared(retiringSource)||!shared(freshRetiringSource)||!confirmed(current)||current.id!==old.event.id||current.league!==old.event.league||current.serverId!==old.serverId||old.identity!==identity()||cleanupFault||overlapClosing||retiring.size!==1||!retiring.has(a)||!a.detached)return null;
  const token={closing:a.cleanup,sourceId:source.id,serverId:current.serverId,oldSessionId:a.stream.playSessionId,retried:false,releaseServerStop:a.releaseServerStop,reportBarrier:a.stream.orbitalSwitchStop};overlapClosing=token;
  a.cleanup.then(()=>{if(overlapClosing===token)overlapClosing=null;},()=>{if(overlapClosing===token)overlapClosing=null;});
  const detached=await bounded(a.detached);
  if(!detached||!stillCurrent()||old.identity!==identity()||retiringSource?.id!==a.itemId||!shared(retiringSource)||!shared(freshRetiringSource)||!shared(source))return null;
  const receipt=localRetirementReceipt(a);
  if(!receipt)return null;
  // Native fallback can change the actual session during exact local retirement.
  // Capture only the validated final native mirror after the detach fence.
  if(receipt.kind==='phone-native-stream-retirement-v1')token.oldSessionId=receipt.stream.playSessionId;
  return token;
 }
 function explicitCapacity(error){return [error?.status,error?.statusCode,error?.response?.status].some(value=>value===429||value==='429');}

 function cancel(stop=false,keepPlayer=false){const p=plan;p?.attempt?.overlap?.releaseServerStop?.();if(stop&&(!keepPlayer||!p))for(const old of kept)old.releaseServerStop?.();clearWatch(p);generation++;plan=null;notice(null);emit();if(p?.stream)retired.add(p.stream);if(stop)cleanupAttempt(p,keepPlayer);if(stop&&!keepPlayer){const closing=[...kept],finish=async()=>{for(const a of closing){await bridge()?.finishSwitch?.(a.player,a.stream);kept.delete(a);}};cleanupBarrier.then(finish,finish).catch(()=>{});}return stop?bounded(cleanupBarrier):Promise.resolve();}
 async function attempt(p,overlap=null,retiringSessionId=null){
  if(!valid(p))return;
  p.phase='starting';p.stream=null;p.player=null;clearWatch(p);const index=p.index,a={index,itemId:p.ids[index],accepted:false,overlap,retiringSessionId:overlap?.oldSessionId||retiringSessionId};p.attempt=a;
  const selectedQuality=p.sources[index]?.feedcheck_quality;
  a.qualitySourceBinding=Object.freeze({sourceId:a.itemId,sourceScope:selectedQuality?.schema===1?selectedQuality.source_scope_sha256:null,requestGeneration:p.generation,eventId:p.event.id,league:p.event.league,serverId:p.serverId});
  const chosen=p.sources[index],slow=chosen?.evidence?.verdict==='slow';notice((p.switching?'Switching to ':'Starting ')+(feedName(chosen,p.event)||'your game')+'…',undefined,{cover:true,overlap:!!overlap,detail:overlap?'Opening this feed while the previous connection finishes closing. Waiting for the first picture.':slow?'This feed has been slow lately. If it stalls, the next feed starts on its own.':'Opening the feed and waiting for the first picture.',stepper:p.switching&&p.switchFrom?{from:p.switchFrom,to:feedName(chosen,p.event)||'Next feed',step:2}:undefined});emit();
  a.ready=new Promise((resolve,reject)=>{a.readyResolve=resolve;a.readyReject=reject});a.ready.catch(()=>{});a.finished=new Promise(resolve=>{a.finish=resolve});
  // Cold live starts measured 8.4-12.3s: Jellyfin holds the first playlist until segments exist and the
  // web player retries it at exactly 10s. 12s abandoned working feeds mid-retry (20260923T180017Z).
  p.timer=setTimer(()=>{if(valid(p)&&p.index===index&&p.phase!=='recovering')recover(bridge().manager,p.player||bridge().manager.getCurrentPlayer(),{item:{Id:a.itemId},orbitalAttempt:a},'FirstFrameTimeout');},20000);
  try{await bridge().manager.play({ids:[p.ids[p.index]],serverId:p.serverId,fullscreen:true,orbitalAttempt:{plan:p,index,attempt:a}});}
  catch(error){if(valid(p)&&p.phase!=='recovering')recover(bridge().manager,bridge().manager.getCurrentPlayer(),{item:{Id:a.itemId},orbitalAttempt:a},error||'ServerError');}
  finally{a.finish();if(!a.stream)a.readyResolve();overlap?.releaseServerStop?.();}
 }
 function unavailable(p,message){if(!valid(p))return;const retry=p.event;cancel(true).catch(()=>{});notice(message,()=>otherWays(retry));}
 async function start(event,manualSource=null){
  if(event?.preferredSource&&!manualSource)return select(event,event.preferredSource);
  if(manualSource&&!manualAllowed()){notice('Manual feed selection is not available for this account.');return;}
  const leaving=plan&&valid(plan)?feedName(plan.sources[plan.index],plan.event):null,going=manualSource?feedName((event.sources||[]).find(s=>s?.id===manualSource),event):null;
  const old=plan&&valid(plan)?plan:null,closing=cancel(true,true),session=generation,who=identity();closing.catch(()=>{});let closed=false,reportHandedOff=false;notice((event.switching?'Switching feeds…':'Starting your game…'),undefined,{cover:true,checkingAdmission:!!event.switching,detail:event.switching?'Checking the next feed and safely retiring the current player.':undefined,stepper:event.switching&&leaving?{from:leaving,to:going||'Next feed',step:1}:undefined});
  try{const stillCurrent=()=>session===generation&&who===identity();let current=null,overlap=null;
   if(old?.attempt?.accepted){current=await refresh(event,null,manualSource);if(!stillCurrent())return;const next=confirmed(current)?sourcesFor(current,manualSource).sources[0]:null;overlap=await localAdmission(old,current,next,stillCurrent);if(!stillCurrent())return;}
   if(!overlap){old?.attempt?.releaseServerStop?.();await openable(closing);closed=true;if(!stillCurrent())return;current=await refresh(event,null,manualSource);if(!stillCurrent())return;}else closed=true;
   if(!current||!manualSource&&current.state!=='live'&&current.watchable!==true){notice(current?.state==='final'?'This game has finished.':'This game is not live right now.');return;}
   if(!manualSource&&current.stale){notice('Game status is saved data. Refresh before playing.');return;}
   if(manualSource&&!manualAllowed()){notice('Manual feed selection is not available for this account.');return;}
   const {all,sources}=sourcesFor(current,manualSource);
   const ids=sources.map(s=>s.id);
   if(!ids.length){notice(all.some(s=>s.automatic)?'Individual feeds are not available yet. Refresh to try again.':'Feeds not confirmed yet');return;}
   const b=bridge();if(!b?.manager)throw Error('Player unavailable');
   plan={generation:session,identity:who,ids,sources,recoveryBindings:recoveryBindings(sources),index:0,failures:0,manual:!!manualSource,switching:!!event.switching,switchFrom:leaving,phase:'starting',event:current,serverId:current.serverId,expires:Date.now()+21600000,automaticDeadline:monotonic()+90000};reportHandedOff=!!overlap;await attempt(plan,overlap);
  }catch(error){if(session===generation&&who===identity())notice(error?.message==='EventRefreshTimeout'?refreshTimeoutMessage:closed?'The game could not open. Try again shortly.':error?.message==='CleanupTimeout'?'The previous feed is still closing. Try again shortly.':'The previous feed could not be closed. Reload this page before trying another game.',closed?()=>start(event):undefined);}
  finally{if(!reportHandedOff)old?.attempt?.releaseServerStop?.();}
 }
 function select(event,id){if(!manualAllowed()){notice('Manual feed selection is not available for this account.');return Promise.resolve();}return start({...event,preferredSource:undefined,switching:true},id);}
 function recover(manager,player,stream,error){
  const p=plan;if(!p||!valid(p)||manager!==bridge()?.manager||player&&!player.isLocalPlayer)return false;
  if(stream?.item?.Id&&stream.item.Id!==p.ids[p.index])return false;
  if(stream?.orbitalAttempt?stream.orbitalAttempt!==p.attempt:stream!==p.attempt?.stream)return false;
  const errorText=String(error?.status||error?.statusCode||error?.code||error?.message||error);
  p.attempt?.overlap?.releaseServerStop?.();
  const reportFailure=code=>{const a=p.attempt;if(!a||reportedFailures.has(a))return;reportedFailures.add(a);try{attemptFailure(Object.freeze({attempt:a,channel_id:a.itemId,play_session_id:a.stream?.playSessionId||null,accepted_open:a.accepted===true,phase:p.phase,after_first_frame:p.phase==='playing'||p.phase==='buffering',error:code}));}catch{}};
  if(p.attempt?.overlap&&explicitCapacity(error)){
   const a=p.attempt,overlap=a.overlap;if(overlap.retried||p.phase==='recovering')return true;overlap.retried=true;clearWatch(p);reportFailure('capacity');p.phase='recovering';emit();
   (async()=>{try{
    cleanupAttempt(p,true);await bounded(cleanupBarrier);if(!valid(p)||p.attempt!==a)return;
    const current=await refresh(p.event,p,p.manual&&p.index===0?p.ids[p.index]:null);if(!valid(p)||p.attempt!==a)return;
    const chosen=(current?.sources||[]).find(s=>s?.id===overlap.sourceId&&!s.automatic&&(p.manual&&p.index===0?manualAvailable(s):automaticEligible(s)));
    if((!(p.manual&&p.index===0)&&!confirmed(current))||!current||current.id!==p.event.id||current.league!==p.event.league||current.serverId!==overlap.serverId||!chosen||!manualAllowed()&&p.manual||monotonic()>=p.automaticDeadline){unavailable(p,'This game is currently unavailable.');return;}
    p.sources[p.index]=chosen;await attempt(p,null,overlap.oldSessionId);
   }catch(error){unavailable(p,error?.message==='EventRefreshTimeout'?refreshTimeoutMessage:error?.message==='CleanupTimeout'?'The previous feed is still closing. Other ways to watch this game are available.':'The previous feed could not be closed. Reload this page before trying another game.');}})();return true;
  }
  // A definite account refusal is terminal for this request, not feed-quality
  // evidence. Retain the existing cleanup barrier and do not cycle more feeds.
  const authStatus=[error?.status,error?.statusCode,error?.response?.status].find(value=>value===401||value==='401'||value===403||value==='403');
  if(authStatus!==undefined){unavailable(p,String(authStatus)==='401'?'Sign in again to open this feed.':'This feed is not permitted for this account. Refresh the game or choose another feed.');return true;}
  if(/429|RateLimit|TooManyRequests/i.test(errorText)){reportFailure('capacity');unavailable(p,'The paid connections are in use. Try again when a connection is free.');return true;}
  if(/NotAllowed|Restricted|NotFound/i.test(errorText))return false;
  if(p.phase==='recovering')return true;
  reportFailure(errorText==='BufferTimeout'?'buffer_timeout':errorText==='FirstFrameTimeout'?'first_frame_timeout':'source');
  if(p.phase==='playing'||p.phase==='buffering')p.automaticDeadline=monotonic()+90000;
  clearWatch(p);
  if(++p.failures>=5||monotonic()>=p.automaticDeadline||p.index+1>=p.ids.length){unavailable(p,'The feeds did not respond. Other ways to watch this game are available.');return true;}
  p.phase='recovering';const failed=feedName(p.sources[p.index],p.event);notice((failed?failed+' isn’t responding':'This feed isn’t responding')+' — Trying another source…',undefined,{cover:true});emit();
  (async()=>{try{
   const old={...p,attempt:p.attempt};let handedOff=false;try{stopAttempt(p).catch(()=>{});const closing=bounded(cleanupBarrier);closing.catch(()=>{});
   let current=await refresh(p.event,p);if(!valid(p))return;
   const qualityAdvice=failureQualityAdvice(p,old.attempt,current);if(qualityAdvice)notice((failed?failed+' isn’t responding':'This feed isn’t responding')+' — Trying another source…',undefined,{cover:true,detail:qualityAdvice});
   const nextIndex=()=>{const permitted=new Set((current?.sources||[]).filter(s=>!s.automatic&&automaticEligible(s)).map(s=>s.id));let next=p.index+1;while(next<p.ids.length&&!permitted.has(p.ids[next]))next++;return trustedRecoveryIndex(p,old.attempt,current,next);};
   let next=nextIndex(),chosen=(current?.sources||[]).find(s=>s.id===p.ids[next]);
   const overlap=await localAdmission(old,current,chosen,()=>valid(p));if(!valid(p))return;
   if(!overlap){old.attempt?.releaseServerStop?.();await openable(closing);if(!valid(p))return;current=await refresh(p.event,p);if(!valid(p))return;next=nextIndex();chosen=(current?.sources||[]).find(s=>s.id===p.ids[next]);}
   if((current?.state!=='live'&&current?.watchable!==true)||current.stale){unavailable(p,'This game is no longer confirmed live.');return;}
   if(monotonic()>=p.automaticDeadline){unavailable(p,'This game is currently unavailable.');return;}
   p.index=next;if(chosen)p.sources[next]=chosen;
   if(p.index>=p.ids.length){unavailable(p,'This game is currently unavailable.');return;}
   // Replacing the current item uses Jellyfin's onPlaybackChanging: it stops and reports
   // only this player's transport before negotiating the next source. No queue autoplay.
   handedOff=!!overlap;await attempt(p,overlap);
   }finally{if(!handedOff)old.attempt?.releaseServerStop?.();}
  }catch(error){unavailable(p,error?.message==='EventRefreshTimeout'?refreshTimeoutMessage:error?.message==='CleanupTimeout'?'The previous feed is still closing. Other ways to watch this game are available.':'The previous feed could not be closed. Reload this page before trying another game.');}})();
  return true;
 }
 function infoError(error,tag){const p=plan;if(!p||!tag||tag!==p.attempt||p.phase!=='starting')return false;return recover(bridge()?.manager,bridge()?.manager.getCurrentPlayer(),{item:{Id:p.ids[p.index]},orbitalAttempt:p.attempt},error);}
 function nativeStarting(player,token){
  const p=token?.plan,a=token?.attempt;
  if(!a||!valid(p)||token.index!==p.index||a!==p.attempt||p.phase==='recovering'||a.accepted||a.nativeToken||!player?.isLocalPlayer||typeof player.getCurrentMediaSource!=='function'||typeof player.getSwitchRetirement!=='function'||typeof player.retryLocalRetirement!=='function')return false;
  a.nativeToken=token;a.player=player;p.player=player;
  // No source/session is invented: readiness permits exact pending native stop.
  a.readyResolve();return true;
 }
 function prepared(player,stream,token){if(!token)return true;const p=token.plan,a=token.attempt;
  if(!a)return false;
   // Native owns this consumer; a stale/reused native tuple must never use web Close.
   if(a.nativeToken){
    if(a.nativeToken!==token||a.player!==player||!valid(p)||token.index!==p.index||a!==p.attempt||p.phase==='recovering'||stream?.item?.Id!==a.itemId){if(stream)retired.add(stream);return false;}
    if(a.retiringSessionId){const session=typeof stream?.playSessionId==='string'?stream.playSessionId.trim():'';if(!session||session===a.retiringSessionId.trim()){if(stream)retired.add(stream);if(!a.accepted)infoError(Error('ReplacementPlaySessionInvalid'),a);return false;}}
   }
  if(!valid(p)||token.index!==p.index||a!==p.attempt||p.phase==='recovering'||stream?.item?.Id!==a.itemId){
   if(stream){retired.add(stream);if(!a.accepted){a.stream=stream;releaseUnplayed(p,a,stream).catch(()=>{});}}return false;
  }
  if(a.retiringSessionId){
   const session=typeof stream?.playSessionId==='string'?stream.playSessionId.trim():'';
   if(!session||session===a.retiringSessionId.trim()){
    // A successful Open is still one acquired consumer. Never accept a session
    // that the old background encoding fence could stop; close only this attempt.
    if(stream){retired.add(stream);if(!a.accepted){a.stream=stream;releaseUnplayed(p,a,stream).catch(()=>{});}}
    if(!a.accepted)infoError(Error('ReplacementPlaySessionInvalid'),a);
    return false;
   }
  }
  if(a.overlap?.releaseServerStop){
   const live=stream.liveStreamId||stream.mediaSource?.LiveStreamId;
   if(typeof live!=='string'||!live.trim()){
    a.overlap.releaseServerStop();if(stream){retired.add(stream);if(!a.accepted){a.stream=stream;releaseUnplayed(p,a,stream).catch(()=>{});}}
    infoError(Error('ReplacementLiveStreamInvalid'),a);return false;
   }
   // PlaybackInfo/Open has returned its acquired live consumer. Local media can
   // play while old STOP runs; shared-session reports remain strictly ordered.
   const fence={stream,tail:a.overlap.reportBarrier,current:()=>p.identity===identity(),failed:false};
   stream.orbitalReportFence=fence;player.orbitalReportFence=fence;
   fence.tail.catch(error=>{fence.failed=true;fence.blockedByPrior=true;fence.error=error;reportingBlocked(player,stream,error);});
   a.overlap.releaseServerStop();
  }
  for(const old of kept)if(old.player===player)kept.delete(old);
  a.player=player;a.stream=stream;a.accepted=true;a.readyResolve();p.player=player;p.stream=stream;return true;
 }
 function reportingBlocked(player,stream,error){const p=plan;if(!valid(p)||p.attempt?.stream!==stream||p.attempt?.player!==player)return false;unavailable(p,'The previous feed could not be closed. Reload this page before trying another game.');return true;}
 function accepts(stream){return !stream||!retired.has(stream);}
 function started(item,canObserveFrame=true,stream){const p=plan;if(!p||p.phase==='recovering'||stream&&stream!==p.attempt?.stream)return null;if(item?.Id!==p.ids[p.index])return null;else if(canObserveFrame){p.phase='awaiting-frame';}else{clearWatch(p);p.phase='native-started';notice('The player has started. Picture confirmation is unavailable on this player.');}emit();return p.attempt;}
 function stopped(info){const p=plan;if(!p)return;const state=info?.state||info,item=state?.NowPlayingItem,session=state?.PlayState?.PlaySessionId||state?.PlaySessionId||info?.PlaySessionId;if(!session||session!==p.attempt?.stream?.playSessionId||item?.Id&&item.Id!==p.ids[p.index])return;if(p.phase!=='recovering'&&!info?.nextItem)cancel();}
 function rendered(item,tag){const p=plan;if(valid(p)&&(tag&&tag===p.attempt)&&p.phase!=='recovering'&&item?.Id===p.ids[p.index]){if(p.timer){clearTimer(p.timer);p.timer=null;}p.phase='playing';notice(null);emit();}}
 function buffering(item,tag){const p=plan;if(!valid(p)||!tag||tag!==p.attempt||p.phase!=='playing'||item?.Id!==p.ids[p.index])return;p.phase='buffering';clearTimerOnly(p);const index=p.index;p.timer=setTimer(()=>{if(valid(p)&&p.index===index&&p.phase==='buffering')recover(bridge().manager,p.player||bridge().manager.getCurrentPlayer(),{item,orbitalAttempt:p.attempt},'BufferTimeout');},12000);}
 return {start,select,cancel,recover,infoError,nativeStarting,prepared,reportingBlocked,accepts,started,rendered,buffering,stopped,snapshot,isRecovering:()=>plan?.phase==='recovering'};
}
if(typeof module!=='undefined'&&module.exports){module.exports=controller;return;}
const identity=()=>{const a=window.ApiClient;return a?[a.serverId(),a.getCurrentUserId(),a.accessToken()].join('|'):'';};
function cancelFromUi(showError=false){window.TelevisionPlayback.cancel(true).catch(()=>{if(showError)notice('The previous feed is still closing. Reload this page before trying another game.');});}
function notice(text,retry,options={}){
 const previous=document.getElementById('television-play-status'),focused=document.activeElement;
 const opener=previous?.orbitalNoticeOpener||focused,ownedFocus=!!previous?.contains(focused);
 previous?.remove();
 if(!text){
  let playing=false;try{playing=window.TelevisionPlayback?.snapshot?.()?.phase==='playing';}catch{}
  if(ownedFocus&&!playing&&opener?.isConnected)opener.focus({preventScroll:true});
  return;
 }
 const box=document.createElement('div');box.id='television-play-status';
 box.orbitalNoticeOpener=opener!==document.body&&opener?.isConnected?opener:null;
 box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.setAttribute('aria-atomic','true');
 box.className=options.cover?'otv-start-cover':'otv-play-notice';
 const el=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!=null)node.textContent=value;return node;};
 if(options.cover){
  // Existing controller facts only. A missing snapshot adds no invented identity.
  let view=null;try{view=window.TelevisionPlayback?.snapshot?.();}catch{}
  const title=typeof view?.event?.name==='string'?view.event.name.trim():'';
  let feed='';try{feed=window.TelevisionFeedUi?.label?.(view?.source,view?.event)||view?.source?.label_short||view?.source?.name||'';}catch{}
  if(title)box.append(el('h2','otv-start-title',title));
  if(typeof feed==='string'&&feed.trim())box.append(el('p','otv-start-source','Feed · '+feed.trim()));
 }
 box.append(el('p','otv-start-state',text));
 if(options.cover){
  const motion=el('div','otv-start-motion');motion.setAttribute('aria-hidden','true');motion.append(el('span'));box.append(motion);
 }
 if(options.stepper){
  // These are named endpoints, not percentages or claims that cleanup completed.
  box.classList.add('otv-switch');const st=options.stepper;
  const pair=el('div','otv-switch-pair'),card=(key,value)=>{const node=el('div','otv-switch-card');node.append(el('span','otv-switch-kicker',key),el('strong','',value));return node;};
  pair.append(card('Previous feed',st.from),el('span','otv-switch-arrow','→'),card('Selected feed',st.to));box.append(pair);
 }
 if(options.detail)box.append(el('p','otv-cover-detail',options.detail));
 const choices=[['Back',()=>cancelFromUi(true)]];
 if(retry&&window.TelevisionFeedUi?.manualAllowed(window.ApiClient?.getCurrentUserId()))choices.push(['Other ways to watch this game',retry]);
 for(const [name,fn] of choices){const button=el('button','otv-category',name);button.type='button';button.onclick=fn;box.append(button);}
 if(options.cover)box.onkeydown=event=>{
  if(event.key!=='Tab'||event.ctrlKey||event.altKey||event.metaKey)return;
  const buttons=[...box.querySelectorAll('button:not([disabled])')],first=buttons[0],last=buttons[buttons.length-1];
  if(first&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:false});}
 };
 (document.fullscreenElement||document.body).append(box);
 box.querySelector('button')?.focus({preventScroll:false});
}

/* Generic playback lifecycle subscriptions. No timing or feed selection. */
function playbackSubscriptions(read){
 const listeners=new Set(),attemptIds=new WeakMap();let nextAttempt=0,nextRequest=0,revision=0,intent=null;
 const viewOf=(view,requestId=intent?.id??null)=>{
  if(!view)return null;
  const attempt=view.attempt;let attemptId=null;
  if(attempt&&typeof attempt==='object'){
   if(!attemptIds.has(attempt))attemptIds.set(attempt,++nextAttempt);
   attemptId=attemptIds.get(attempt);
  }
  // Keep the controller-owned attempt as an opaque identity reference. The
  // captured primitive keys and phase cannot change under an earlier callback.
  return Object.freeze({...view,attemptId,generation:view.trackerSession,requestId});
 };
 const notify=(fn,view)=>{try{fn(view);}catch{}};
 const publish=value=>{const version=++revision;for(const fn of [...listeners]){if(version!==revision)break;if(listeners.has(fn))notify(fn,value);}};
 const requested=p=>viewOf({event:p.event,source:p.source,phase:'requested',manual:!!p.source,attempt:null,trackerSession:null},p.id);
 const end=()=>{intent=null;publish(null);};
 const changed=view=>{
  if(!view){if(intent?.pending)publish(requested(intent));else end();return;}
  if(!intent)intent={id:++nextRequest,event:view.event,source:view.source,pending:false};
  intent.pending=false;publish(viewOf(view));
 };
 return {
  changed,end,
  request(event,sourceId,run){
   const p={id:++nextRequest,event,source:(event?.sources||[]).find(s=>s?.id===(sourceId||event?.preferredSource))||null,pending:true};intent=p;publish(requested(p));
   // A subscriber may synchronously cancel or replace the request.
   if(intent!==p)return Promise.resolve();
   const settled=()=>{if(intent===p&&p.pending){const view=read();if(view)changed(view);else end();}};
   let result;try{result=run();}catch(error){settled();throw error;}
   Promise.resolve(result).then(settled,settled);return result;
  },
  subscribe(fn){if(typeof fn!=='function')return ()=>{};listeners.add(fn);notify(fn,intent?.pending?requested(intent):viewOf(read()));return ()=>listeners.delete(fn);}
 };
}
const playbackUpdates=playbackSubscriptions(()=>player.snapshot());
const player=controller({bridge:()=>window.TelevisionPlayerBridge,identity,delay:ms=>new Promise(r=>setTimeout(r,ms)),notice,manualAllowed:()=>window.TelevisionFeedUi?.manualAllowed(window.ApiClient?.getCurrentUserId())===true,attemptFailure:data=>{Promise.resolve(window.OrbitalOwnedPlaybackFailureDiagnostics?.observe?.(data)).catch(()=>{});},changed:view=>{playbackUpdates.changed(view);window.TelevisionSportsPlayerUi?.paint(view);window.TelevisionTrackerOverlay?.playback(view);},otherWays:event=>window.TelevisionOtherWays?.(event),
 fresh:async (event,manualSource=null)=>{const a=window.ApiClient,who=identity();
 if(manualSource){
  const ui=window.TelevisionFeedUi,user=a?.getCurrentUserId(),sources=ui?.sources(event)||[],selected=sources.find(s=>s.id===manualSource&&!s.automatic&&ui.manualAvailable(s));
  if(!ui?.manualAllowed(user)||!selected||!/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(manualSource))return null;
  // Opening a known channel does not depend on scoreboard state or its clock.
  // The authenticated item lookup and PlaybackInfo retain account/capacity authority.
  const item=await a.getItem(user,manualSource);if(who!==identity())throw Error('Account changed');
  if(item?.Type!=='TvChannel'||String(item?.Id||'').replace(/-/g,'').toLowerCase()!==manualSource.replace(/-/g,'').toLowerCase())return null;
  return {...event,sources,serverId:a.serverId()};
 }
 const response=await a.ajax({type:'GET',url:a.getUrl('sports/api/events',{date:new Date(event.start).toLocaleDateString('en-CA',{timeZone:'America/Chicago'})}),dataType:'json'});if(who!==identity())throw Error('Account changed');const current=response.events.find(e=>e.id===event.id&&e.league===event.league);return current?{...window.TelevisionFeedUi.withFreshness(current,response),serverId:a.serverId()}:null;}});
const startPlayback=player.start,selectPlayback=player.select,cancelPlayback=player.cancel;
player.start=(event,source)=>playbackUpdates.request(event,source,()=>startPlayback(event,source));
player.select=(event,id)=>playbackUpdates.request(event,id,()=>selectPlayback(event,id));
player.cancel=(...args)=>{playbackUpdates.end();return cancelPlayback(...args);};
player.subscribe=playbackUpdates.subscribe;
window.TelevisionPlayback=player;
// A retained SPA player can leave connected hidden videos before the current one.
// Bind picture confirmation only to the single visible local player surface.
function visiblePlaybackVideo(){
 const videos=[...document.querySelectorAll('.videoPlayerContainer video, video.htmlvideoplayer')].filter(v=>{
  if(!v.isConnected||v.closest?.('[hidden],[aria-hidden="true"]')||!v.getClientRects?.().length)return false;
  const style=document.defaultView.getComputedStyle(v);
  return style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);
 });
 return videos.length===1?videos[0]:null;
}
const prepare=player.prepared;
player.prepared=(active,stream,token)=>{
 const previousMediaSrc=visiblePlaybackVideo()?.currentSrc||'',accepted=prepare(active,stream,token);
 if(accepted&&token?.attempt)token.attempt.previousMediaSrc=previousMediaSrc;
 return accepted;
};
// Core supplies the original stream and token. Account, source and player must
// still be the exact accepted attempt before a callback changes watch state.
player.playStarted=(active,stream,token)=>{
 if(!token){window.TelevisionTrackerOverlay?.untrackedStarted(active,stream);return;}
 const owns=()=>{const view=player.snapshot(),a=token.attempt;return !!a&&view?.attempt===a&&a.accepted===true&&a.player===active&&a.stream===stream&&a.itemId===stream?.item?.Id&&view.source?.id===a.itemId&&token.plan?.attempt===a&&token.plan?.player===active&&token.plan?.stream===stream&&view.phase!=='recovering'&&player.accepts(stream);};
 if(!owns())return;
 const item=stream.item,initialVideo=visiblePlaybackVideo(),observable=!token.attempt.nativeToken&&(typeof initialVideo?.requestVideoFrameCallback==='function'||typeof globalThis.HTMLVideoElement?.prototype?.requestVideoFrameCallback==='function');
 const tag=player.started(item,observable,stream);if(!tag||!owns()||token.attempt.nativeToken)return;
 token.plan.unobserve?.();
 let cancelled=false,retry=null,stopVideo=null;
 token.plan.unobserve=()=>{cancelled=true;if(retry!==null)clearTimeout(retry);retry=null;stopVideo?.();stopVideo=null;};
 const bind=()=>{
  retry=null;if(cancelled||!owns())return;
  const video=visiblePlaybackVideo();
  // Keep the existing first-frame deadline while the HTML surface is becoming
  // visible. The attempt's normal cleanup also cancels this local retry.
  if(!video){if(observable)retry=setTimeout(bind,100);return;}
  try{window.OrbitalOwnedPlaybackFailureDiagnostics?.bindVideo?.({attempt:tag,stream,video});}catch{}
  if(!observable||typeof video.requestVideoFrameCallback!=='function')return;
  let mediaSrc=null,frame=null,localGeneration=0,needPicture=true;
  // Optional timing diagnostics cannot prevent confirmation of an actual frame.
  // In an HTTP context randomUUID may be unavailable; timing evidence abstains.
  let trace=null,attempt=null,scope=null;try{const rendererId=crypto.randomUUID();attempt=crypto.randomUUID();trace=window.OrbitalPresentationTrace.create(rendererId);scope=trace.activate(stream.playSessionId,attempt,localGeneration);}catch{trace=null;}
  let hlsTrace=null;
  const findHls=()=>{const found=window.OrbitalHlsTrace?.forVideo(video)||null;if(found!==hlsTrace){hlsTrace?.activate(null);hlsTrace=found;hlsTrace?.activate(scope);}return hlsTrace;};
  const snapshot=()=>{const value=trace?.snapshot(performance.now());return value?{...value,candidateFragment:findHls()?.snapshot(value.mediaTimeUs/1e6)||null,sampleProvenance:findHls()?.sampleProvenance?.(value.mediaTimeUs/1e6)||null,mediaDiagnostic:window.OrbitalViewerMedia?.forVideo(video)?.snapshot()||null}:null;};if(window.OrbitalPresentationTrace)window.OrbitalPresentationTrace.latest=snapshot;
  const same=()=>!cancelled&&owns()&&visiblePlaybackVideo()===video&&video.currentSrc===mediaSrc;
  const rendered=(captured,observedGeneration,now,metadata)=>{
   frame=null;if(!same())return;if(observedGeneration!==localGeneration){observe();return;}
   // Firefox can quantize performance.now() differently from the rVFC argument.
   // Receipt freshness uses two reads of the same clock API; retain callback time
   // separately rather than shifting it or widening a freshness tolerance.
   let accepted=false;try{accepted=trace?.observe(captured,now,metadata,performance.now())===true;}catch{}
   const submitted=Number.isFinite(metadata?.mediaTime)&&metadata.mediaTime>=0&&Number.isSafeInteger(metadata?.presentedFrames)&&metadata.presentedFrames>0&&video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0;
   if(submitted&&needPicture){needPicture=false;player.rendered(item,tag);}
   if(accepted)window.OrbitalCalibration?.frame(snapshot);
   observe();
  };
  const observe=()=>{if(same()&&frame==null){findHls();const captured=scope,observedGeneration=localGeneration;frame=video.requestVideoFrameCallback((now,metadata)=>rendered(captured,observedGeneration,now,metadata));}};
  const invalidate=()=>{localGeneration++;trace?.clear();scope=trace?.activate(stream.playSessionId,attempt,localGeneration)||null;hlsTrace?.activate(scope);};
  const arm=()=>{if(cancelled||!owns()||visiblePlaybackVideo()!==video)return;const src=video.currentSrc;if(!src||src===tag.previousMediaSrc)return;if(mediaSrc===src)return;mediaSrc=src;invalidate();observe();};
  const waiting=()=>{if(same()){invalidate();needPicture=true;player.buffering(item,tag);observe();}};
  const transition=()=>{if(same())invalidate();};
  const events=['seeking','seeked','pause','ratechange','emptied'];
  stopVideo=()=>{trace?.clear();hlsTrace?.activate(null);if(frame!=null)video.cancelVideoFrameCallback?.(frame);frame=null;
   video.removeEventListener('waiting',waiting);video.removeEventListener('loadedmetadata',arm);video.removeEventListener('loadeddata',arm);
   events.forEach(name=>video.removeEventListener(name,transition));
   if(window.OrbitalPresentationTrace?.latest===snapshot)window.OrbitalPresentationTrace.latest=null;};
  video.addEventListener('waiting',waiting);video.addEventListener('loadedmetadata',arm);video.addEventListener('loadeddata',arm);
  events.forEach(name=>video.addEventListener(name,transition));arm();
 };
 bind();
};

let wired=null;function bind(){const b=window.TelevisionPlayerBridge;if(!b||wired===b)return;wired=b;b.stopEncoding=async(serverId,sessionId)=>{
 const a=window.ApiClient,account=a?.accessToken?.(),user=a?.getCurrentUserId?.();
 // Retry only the idempotent exact-session encoder DELETE, never LiveStreams/Close.
 for(let attempt=0;attempt<3;attempt++){
  if(a!==window.ApiClient||a?.serverId()!==serverId||a?.accessToken?.()!==account||a?.getCurrentUserId?.()!==user||typeof sessionId!=='string'||!sessionId.trim())throw Error('Playback identity changed');
  try{await a.stopActiveEncodings(sessionId);return;}catch(error){if(attempt===2||error?.name==='AbortError')throw error;}
  await new Promise(resolve=>setTimeout(resolve,attempt===0?250:750));
 }
};b.encoderResidue=async serverId=>{const a=window.ApiClient;if(a?.serverId()!==serverId)throw Error('Playback identity changed');const rows=await a.getSessions({deviceId:a.deviceId()});if(!Array.isArray(rows))throw Error('Sessions unavailable');return rows.some(s=>s?.TranscodingInfo);};b.releaseUnplayed=async(serverId,liveStreamId)=>{const a=window.ApiClient;if(a?.serverId()!==serverId||!liveStreamId)throw Error('Playback identity changed');await a.ajax({type:'POST',url:a.getUrl('LiveStreams/Close',{liveStreamId})});};b.events.on(b.manager,'playbackstop',(_,data)=>{player.stopped(data);window.TelevisionTrackerOverlay?.stopped(data);});}
bind();const timer=setInterval(bind,100);setTimeout(()=>clearInterval(timer),15000);
window.addEventListener('popstate',e=>{if(window.__otvDialogPop&&window.__otvDialogPop(e))return;cancelFromUi();});window.addEventListener('pagehide',event=>{if(event instanceof PageTransitionEvent)cancelFromUi();});
document.addEventListener('fullscreenchange',()=>{const box=document.getElementById('television-play-status');if(box)(document.fullscreenElement||document.body).append(box);});
document.addEventListener('keydown',e=>{if(player.isRecovering()&&['Escape','BrowserBack'].includes(e.key)){cancelFromUi(true);}},true);
})();

/* Hidden native Live TV views (Sept 24, 2026 stress audit). Orbital draws the Channels grid and
 * the Guide itself; Jellyfin's native views stayed mounted but hidden and still loaded and drew
 * EVERY channel: the React Channels tab asks with no limit (2,050 cards, 53,722 hidden nodes,
 * 9.5 s main-thread on desktop, 77 s on a 4x-throttled phone) and the legacy guide asks for 500
 * channels (15,393 hidden cells). Those two exact request shapes now ask for one item. Orbital's
 * own requests (EnableCurrentProgram, no 'fields') and Simple's account are untouched. */
(()=>{'use strict';if(window.__otvNativeTrim)return;window.__otvNativeTrim=true;
const SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
const trim=u=>{try{const s=String(u);if(!/\/LiveTv\/Channels\?/i.test(s)||window.ApiClient?.getCurrentUserId?.()===SIMPLE)return u;
 if(/[?&]fields=PrimaryImageAspectRatio/i.test(s)&&!/[?&]limit=/i.test(s))return s+'&limit=1';
 if(/[?&]EnableFavoriteSorting=true/i.test(s)&&/[?&]AddCurrentProgram=false/i.test(s))return s.replace(/([?&]Limit=)\d+/i,'$11');
 return u;}catch(error){return u;}};
const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...rest){return open.call(this,m,trim(u),...rest);};
const f=window.fetch;window.fetch=function(u,...a){return f.call(this,typeof u==='string'?trim(u):u,...a);};})();

/* Orbital dialogs in browser history (Sept 24, 2026). Game center, feed chooser, rankings,
 * team and tracker pickers are modal <dialog>s that never entered history, so Back (Android
 * app, browser, mouse) left the page or exited the app. Each now pushes one same-URL entry:
 * Back closes the top dialog and stays put; closing it any other way removes the entry.
 * window.__otvDialogPop(e) tells other popstate listeners (live playback cancel) that this
 * Back only closed a dialog; it is idempotent per event. */
(()=>{'use strict';if(window.__otvDialogPop)return;const open=[];let expected=0,lastEvent=null,lastResult=false;
const show=HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal=function(...args){if(this.classList.contains("df-sheet"))return show.apply(this,args);const result=show.apply(this,args);try{const d=this;if(!open.includes(d)){open.push(d);history.pushState(Object.assign({},history.state||{},{otvDialog:open.length}),'');d.addEventListener('close',()=>{const i=open.indexOf(d);if(i<0)return;open.splice(i,1);if(d.__otvBack){d.__otvBack=false;return;}if(history.state&&history.state.otvDialog){expected++;history.back();}},{once:true});}}catch(error){}return result;};
window.__otvDialogPop=e=>{if(e&&e===lastEvent)return lastResult;lastEvent=e;lastResult=false;if(expected>0){expected--;lastResult=true;return true;}const d=open[open.length-1];const depth=(e&&e.state&&e.state.otvDialog)||0;if(d&&d.open&&depth<open.length){d.__otvBack=true;d.close();lastResult=true;}return lastResult;};
window.addEventListener('popstate',e=>{window.__otvDialogPop(e);});})();

/* Sept 27, 2026 (Claude, the owner: 'all pages back should just be back ... on the home page ... back twice closes').
 * The Android apps (official 2.7.3 and Orbital Phone) send the system Back key to NavigationHelper.goBack, which exits
 * whenever the route is #/home and no stock .dialogContainer is open. Orbital pop-ups (Game Center, team/feed pickers,
 * filter sheets) and Favorites (#/home?tab=1) live on the Home route, so Back closed the app. Now: an open Orbital
 * pop-up closes; Favorites returns to Home; any other page goes back (or Home when there is no history); on Home the
 * first Back shows a hint and a second Back within 2.5 s exits. Browsers and TV remotes are unaffected. */
(()=>{'use strict';if(window.__orbitalSystemBack)return;window.__orbitalSystemBack=true;
const WINDOW=2500;let armed=0,hint=null,hintTimer=0;
const route=()=>{const h=location.hash.replace(/^#!?/,'');const i=h.indexOf('?');return {path:(i<0?h:h.slice(0,i))||'/home',query:new URLSearchParams(i<0?'':h.slice(i+1))};};
const modal=()=>{try{return [...document.querySelectorAll('dialog:modal')].pop()||null;}catch(e){return null;}};
function toast(text){try{if(!hint){hint=document.createElement('div');hint.className='orbital-back-hint';hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');}
 hint.textContent=text;(modal()||document.body).append(hint);requestAnimationFrame(()=>hint.classList.add('is-shown'));clearTimeout(hintTimer);
 hintTimer=setTimeout(()=>{hint.classList.remove('is-shown');setTimeout(()=>{if(!hint.classList.contains('is-shown'))hint.remove();},250);},WINDOW);}catch(e){}}
function closeStockMenu(){
 const menu=[...document.querySelectorAll('.MuiMenu-root.MuiModal-root')].reverse().find(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&n.getAttribute('aria-hidden')!=='true');
 if(!menu)return false;
 const target=menu.querySelector('[role="menu"]')||menu;
 target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));return true;
}
window.addEventListener('hashchange',closeStockMenu);
function back(original){
 try{
  if(closeStockMenu()){armed=0;return;}
  const st=history.state||{};
  if(st.otvDialog||st.dfSheet||document.querySelector('.dialogContainer')){armed=0;history.back();return;}
  const d=modal();if(d){armed=0;d.close();return;}
  const {path,query}=route();
  if(path==='/home'){
   const tab=query.get('tab');if(tab&&tab!=='0'){armed=0;location.hash='#/home';return;}
   if(Date.now()-armed<WINDOW){armed=0;return original();}
   armed=Date.now();toast('Press back again to exit');return;}
  armed=0;
  if(path==='/login'||path==='/selectserver'||path==='/addserver')return original();
  // Only step back into this app's own history (the Navigation API lists same-origin entries); otherwise go Home.
  const nav=window.navigation,page=window.Emby&&window.Emby.Page;
  const inApp=nav&&nav.currentEntry&&typeof nav.currentEntry.index==='number'?nav.currentEntry.index>0:!!(page&&typeof page.canGoBack==='function'&&page.canGoBack());
  if(inApp){if(page&&typeof page.back==='function')page.back();else history.back();return;}
  location.hash='#/home';
 }catch(e){return original();}}
const wrap=h=>{if(h&&typeof h==='object'&&!h.__orbitalBack&&typeof h.goBack==='function'){const o=h.goBack.bind(h);h.goBack=()=>back(o);h.__orbitalBack=true;}return h;};
let current=wrap(window.NavigationHelper);
try{Object.defineProperty(window,'NavigationHelper',{configurable:true,enumerable:true,get:()=>current,set:v=>{current=wrap(v);}});}catch(e){}
window.OrbitalSystemBack=back;})();

;/* public build: a private provider module is not included here. */

/* Search refinement and interaction protection, scoped to the signed-in main web client. */
(() => {
 'use strict';
 if(new URLSearchParams(location.search).get('orbital')==='off')return;
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 let pressed=null;
 document.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat)pressed={key:e.key,node:e.target};},true);
 document.addEventListener('keyup',e=>{if(pressed?.key!==e.key)return;const old=pressed;pressed=null;if(!old.node.isConnected||old.node!==e.target){e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('blur',()=>{pressed=null;});
 // Typo fallback (Claude): when nothing matches exactly, search for pieces of the longest word (each
 // one-letter deletion, its first and last three letters) and keep titles within a small edit distance,
 // so "ofice" finds The Office. Only runs on an empty first page; at most eight small requests.
 const fold=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
 function distance(a,b){
  const d=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){const cost=a[i-1]===b[j-1]?0:1;
   d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}
  return d[a.length][b.length];
 }
 async function closeMatches(get,query,types){
  const q=fold(query);if(q.length<4)return [];
  const word=q.split(' ').filter(w=>w.length>=4).sort((a,b)=>b.length-a.length)[0];if(!word)return [];
  const pieces=new Set();for(let i=0;i<word.length;i++)pieces.add(word.slice(0,i)+word.slice(i+1));pieces.add(word.slice(0,3));pieces.add(word.slice(-3));
  const found=new Map();
  await Promise.all([...pieces].filter(p=>p.length>=3).slice(0,8).map(async term=>{
   try{const d=await get({SearchTerm:term,Recursive:true,IncludeItemTypes:types,Limit:40,Fields:'ProductionYear',EnableImages:false,EnableUserData:false,EnableTotalRecordCount:false});for(const i of d.Items||[])found.set(i.Id,i);}
   catch(e){if(e?.name==='AbortError')throw e;}
  }));
  const limit=q.length<=5?1:2,span=q.split(' ').length;
  const score=i=>{const t=fold(i.Name).split(' ').filter(Boolean);let best=99;
   for(let k=0;k<t.length;k++)for(const n of [span-1,span,span+1])if(n>=1&&k+n<=t.length)best=Math.min(best,distance(q,t.slice(k,k+n).join(' ')));return best;};
  return [...found.values()].map(i=>[score(i),i]).filter(([d])=>d<=limit)
   .sort((a,b)=>a[0]-b[0]||String(a[1].Name).length-String(b[1].Name).length).slice(0,60).map(([,i])=>i);
 }
 let mounted=null;
 function scan(){
  const api=window.ApiClient,user=api?.getCurrentUserId?.(),input=document.querySelector('#searchTextInput');
  if(!user||user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')||!location.hash.startsWith('#/search')||!input?.getClientRects().length)return;
  if(window.OrbitalLibrarySearch){mounted?.dispose();mounted=null;window.OrbitalLibrarySearch.mount(input,api,user);return;}
  if(mounted?.input===input&&mounted.user===user&&mounted.scope===JSON.stringify([api.serverId(),user,api.accessToken()])&&mounted.root.isConnected)return;
  mounted?.dispose();
  const root=make('section',null,'ob5-search-refinement'),head=make('h2','Search your library'),form=make('div',null,'ob5-chip-row'),type=make('select',null,'ob5-button'),year=make('input',null,'ob5-button'),status=make('p'),grid=make('div',null,'ob5-grid'),more=make('button','Show more results','ob5-button'),submit=make('button','Apply filters','ob5-button');
  input.setAttribute('aria-label','Search your library');root.setAttribute('aria-label','Complete library search');type.setAttribute('aria-label','Result type');year.setAttribute('aria-label','Release year');year.type='number';year.min='1880';year.max=String(new Date().getFullYear()+3);year.placeholder='Any year';status.setAttribute('role','status');
  for(const [value,label] of [['Movie,Series','Movies and shows'],['Movie','Movies'],['Series','TV shows'],['Person','People']]){const o=make('option',label);o.value=value;type.append(o);}
  const channels=make('a','Channels','ob5-button'),sports=make('a','Sports','ob5-button');const scopes=make('nav',null,'ob5-complete-search-scopes');scopes.setAttribute('aria-label','Other search scopes');scopes.append(channels,sports);form.classList.add('ob5-search-filters');form.append(type,year,submit);root.append(head,scopes,form,status,grid,more);input.closest('.searchFields')?.after(root);if(!root.isConnected)input.parentElement.after(root);
  const legacy=document.querySelector('#searchPage>.searchResults'),standard=legacy?make('details',null,'ob5-standard-search'):null;if(legacy){legacy.before(standard);standard.append(make('summary','Other media and standard search'),legacy);}
  const searchScope=JSON.stringify([api.serverId(),user,api.accessToken()]);const resetFilters=make('button','Clear filters','ob5-button');resetFilters.type='button';resetFilters.hidden=true;form.append(resetFilters);resetFilters.onclick=()=>{type.value='Movie,Series';year.value='';load(true);};let generation=0,start=0,busy=false,timer,seen=new Set(),query='',inflight=null,fuzzy=false;
  const valid=run=>root.isConnected&&location.hash.startsWith('#/search')&&searchScope===JSON.stringify([api.serverId(),api.getCurrentUserId(),api.accessToken()])&&run===generation;
  async function load(reset=false){
   if(reset){generation++;busy=false;start=0;seen=new Set();grid.replaceChildren();query=input.value.trim();fuzzy=false;inflight?.abort();}
   if(busy)return;
   const run=generation;resetFilters.hidden=type.value==='Movie,Series'&&!year.value;channels.href='#/livetv?tab=2&phoneQuery='+encodeURIComponent(query);sports.href='#/livetv?tab=0&sports=1&phoneQuery='+encodeURIComponent(query);
   if(!query){status.textContent='Enter a title above. Filters search every permitted movie and show.';more.hidden=true;return;}
   if(year.value&&(!year.checkValidity()||!/^\d{4}$/.test(year.value))){status.textContent='Enter a four-digit release year, or leave it blank.';return;}
   busy=true;more.disabled=true;status.textContent='Searching your library…';
   try{
    const params={SearchTerm:query,Recursive:true,IncludeItemTypes:type.value,StartIndex:start,Limit:60,EnableTotalRecordCount:true,Fields:'ProductionYear,PrimaryImageAspectRatio',SortBy:'SortName',SortOrder:'Ascending'};if(year.value)params.Years=year.value;
    const ctl=new AbortController();inflight=ctl;
    const get=async p=>{const r=await fetch(api.getUrl('Users/'+user+'/Items',p),{headers:{'Authorization':'MediaBrowser Token='+JSON.stringify(api.accessToken()),Accept:'application/json'},signal:ctl.signal});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();};
    let data=await get(params);if(!valid(run))return;
    if(start===0&&!(data.Items||[]).length&&!year.value){const close=await closeMatches(get,query,type.value);if(!valid(run))return;if(close.length){data={Items:close,TotalRecordCount:close.length};fuzzy=true;}}
    const rows=data.Items||[];start+=rows.length;
    for(const item of rows){if(seen.has(item.Id))continue;seen.add(item.Id);const a=make('a',null,'ob5-search-result');a.href='#/details?id='+encodeURIComponent(item.Id)+'&serverId='+encodeURIComponent(api.serverId());a.dataset.itemId=item.Id;const image=make('img');image.loading='lazy';image.alt='';image.width=180;image.height=270;image.src=api.getImageUrl(item.Id,{type:'Primary',maxWidth:360,quality:85});image.onerror=()=>image.remove();a.append(image,make('strong',String(item.Name||'Untitled').replace(/\s+/g,' ').trim()),make('span',[item.ProductionYear,item.Type==='Person'?'Person':item.Type==='Series'?'TV show':'Movie'].filter(Boolean).join(' · ')));a.title=item.Name||'';grid.append(a);}
    status.textContent=fuzzy?'No exact match for “'+query+'”. Showing '+seen.size+' close match'+(seen.size===1?'':'es')+'.':seen.size?'Showing '+seen.size+(data.TotalRecordCount!=null?' of '+data.TotalRecordCount:'')+' matching titles':'No matching titles. Try fewer words'+(year.value||type.value!=='Movie,Series'?' or clear the filters':'')+'. Live content is under Channels or Sports.';more.hidden=fuzzy||!rows.length||(data.TotalRecordCount!=null?start>=data.TotalRecordCount:rows.length<60);more.textContent='Show more results';
   }catch(e){if(e?.name==='AbortError')return;if(valid(run)){status.textContent='Search could not load. Retry keeps your results and filters.';more.hidden=false;more.textContent='Retry search';}}
   finally{if(valid(run)){busy=false;more.disabled=false;}}
  }
  const changed=()=>{clearTimeout(timer);generation++;timer=setTimeout(()=>load(true),350);};input.addEventListener('input',changed);submit.onclick=()=>load(true);type.onchange=()=>load(true);year.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();load(true);}};more.onclick=()=>load();
  mounted={input,user,root,scope:searchScope,dispose:()=>{generation++;inflight?.abort();clearTimeout(timer);input.removeEventListener('input',changed);if(standard?.isConnected){standard.before(legacy);standard.remove();}root.remove();}};load(true);
 }
 let queued=false;const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;scan();});}};new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('hashchange',schedule);schedule();
})();

/* Sept 29 performance: marker classes that replace CSS :has() (see patch_perf_css.py). */
(()=>{'use strict';
 const on=(n,c,v)=>{if(n&&n.classList.contains(c)!==!!v)n.classList.toggle(c,!!v);};
 const each=(sel,fn)=>{for(const n of document.querySelectorAll(sel))fn(n);};
 function mark(){
  const H=document.documentElement;
  on(H,'orb-m-more-menu',document.querySelector('.otv-sports-nav .otv-more-menu'));
  on(H,'orb-m-channels-ready',document.getElementById('channelsTab')?.classList.contains('otv-channels-ready'));
  each('header.MuiAppBar-root',n=>on(n,'orb-m-pnav',n.querySelector('.orbital-primary-nav')));
  each('.MuiStack-root.orb-m-pnav-stack',n=>on(n,'orb-m-pnav-stack',n.querySelector(':scope>.orbital-primary-nav')));
  each('.orbital-primary-nav',n=>{const p=n.parentElement;if(p?.classList.contains('MuiStack-root'))on(p,'orb-m-pnav-stack',1);});
  each('.MuiToolbar-root',n=>on(n,'orb-m-libmenu',n.querySelector('[aria-controls="library-view-menu"]')));
  each('.homePage',n=>on(n,'orb-m-content-ready',n.querySelector('.ob5-content-ready')));
  for(const id of ['homeTab','moviesPage','tvPage','tvshowsPage']){const n=document.getElementById(id);if(n)on(n,'orb-m-browse',n.querySelector(':scope>.ob5-browse'));}
  const sp=document.getElementById('searchPage');if(sp)on(sp,'orb-m-scopes',sp.querySelector('.of7-search-scopes'));
  each('.os-row',n=>on(n,'orb-m-portrait',n.querySelector('.os-portrait')));
  each('.otv-context-layout',n=>on(n,'orb-m-graphic',n.querySelector('.otv-game-graphic')));
  each('.otv-game-context-slot',n=>on(n,'orb-m-play',n.querySelector('.otv-tracker-play')));
  each('.otv-page .noItemsMessage',n=>on(n,'orb-m-heading',n.querySelector(':scope>.otv-heading')));
  each('.otv-pregame-story',n=>on(n,'orb-m-img',n.querySelector('img')));
  each('.otv-sports-grid',n=>on(n,'orb-m-live3',n.querySelectorAll(':scope>.otv-sports-game[data-state=live]').length>=3));
 }
 let queued=false;
 const run=()=>{queued=false;try{mark();}catch(e){}};
 new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(run);}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-state']});
 run();
})();

/* Sept 29 polish (W2): #/movies?collectionType=movies (no topParentId) -> the same URL with the account's library id. */
(()=>{'use strict';
let busy=false;
async function fix(){const h=location.hash,m=h.match(/^#\/(movies|tv)(?:\?(.*))?$/);if(!m||busy)return;const q=new URLSearchParams(m[2]||'');if(q.get('topParentId'))return;
 const a=window.ApiClient;if(!a?.getCurrentUserId?.())return;busy=true;
 try{const type=m[1]==='tv'?'tvshows':'movies',views=await a.getUserViews({},a.getCurrentUserId());const v=(views?.Items||[]).find(x=>x.CollectionType===type);
  if(!v||location.hash!==h)return;const rest=new URLSearchParams(q);rest.delete('collectionType');const out=new URLSearchParams({topParentId:v.Id,collectionType:q.get('collectionType')||type});for(const [k,val] of rest)out.append(k,val);location.replace('#/'+m[1]+'?'+out.toString());}
 catch{/* leave the stock page; nothing is lost */}finally{busy=false;}}
const soon=()=>{fix();for(const ms of [300,1000,2500])setTimeout(fix,ms);};addEventListener('hashchange',soon);addEventListener('popstate',soon);const start=setInterval(()=>{if(window.ApiClient?.getCurrentUserId?.()){clearInterval(start);fix();}},200);setTimeout(()=>clearInterval(start),20000);
})();
/* Copy-bound controls for the existing local Jellyfin VOD player. No acquisition. */
(function(global){'use strict';
const normal=v=>String(v||'').toLowerCase().replace(/-/g,'');
function language(value){const code=String(value||'').toLowerCase().split('-')[0];return ({en:'eng',es:'spa',fr:'fra',de:'deu',ja:'jpn',ko:'kor',zh:'zho',pt:'por',it:'ita'})[code]||code;}
function identity(api){return JSON.stringify([api.serverId(),api.getCurrentUserId(),api.accessToken()]);}
class PlayerControls {
 constructor(api,manager,client){this.api=api;this.manager=manager;this.client=client;this.epoch=0;this.context=null;this.binding=null;this.autoDone=new Set();this.autoOverrides={};this.subtitleApplied='';this.subtitleOwner=0;this.subtitleManual=false;this.subtitleSelection=null;this.videoWatch=null;this.videoEpoch=0;this.trackIds=new WeakMap();this.nextTrackId=0;this.subtitleMutating=false;this.onSubtitleChange=null;this.subtitleIntent=null;this.subtitleTicket=0;this.subtitlePending=null;this.subtitleLocalOnly=false;this.subtitleRestore=false;this.subtitleIntentSuspended=false;this.subtitleUnmatchedOff='';}
 current(){const player=this.manager.getCurrentPlayer();if(!player?.isLocalPlayer)return null;const item=this.manager.currentItem(player),source=this.manager.currentMediaSource(player),session=this.manager.playSessionId(player);if(!['Movie','Episode'].includes(item?.Type)||!source?.Id||!session)return null;return {player,item,source,session,account:identity(this.api),copy:JSON.stringify([source.Id,source.ETag||source.Etag||'',source.Path||''])};}
 owns(binding){const current=this.current();return !!current&&current.player===binding.player&&normal(current.item.Id)===normal(binding.item.Id)&&current.source===binding.source&&current.copy===binding.copy&&current.session===binding.session&&current.account===binding.account;}
 stop(preserveSubtitleIntent=false){this.epoch++;this.client.reset();this.detachVideo();this.subtitleOwner++;this.subtitleTicket++;this.subtitlePending=null;if(!preserveSubtitleIntent)this.subtitleIntent=null;this.subtitleManual=false;this.subtitleSelection=null;this.subtitleApplied='';this.subtitleLocalOnly=false;this.subtitleRestore=false;this.binding=null;this.context=null;this.autoDone.clear();this.autoOverrides={};}
 logicalSubtitleScope(binding=this.binding){return binding?JSON.stringify([binding.account,normal(binding.item.Id),binding.copy]):'';}
 async bind(){const binding=this.current();if(!binding){this.stop();return null;}const epoch=++this.epoch;if(!this.binding||!this.owns(this.binding)){this.detachVideo();this.subtitleOwner++;this.subtitleTicket++;this.subtitlePending=null;this.subtitleUnmatchedOff='';this.subtitleIntentSuspended=false;this.subtitleSelection=null;this.subtitleApplied='';this.autoDone.clear();this.autoOverrides={};}this.binding=binding;this.subtitleLocalOnly=false;this.context=null;if(this.subtitleIntent?.scope!==this.logicalSubtitleScope())this.subtitleIntent=null;this.subtitleManual=!!this.subtitleIntent;this.subtitleRestore=this.subtitleManual;try{const result=await this.client.request('/player-context',{id:normal(binding.item.Id),source_id:binding.source.Id});if(epoch!==this.epoch||!this.owns(binding))return null;if(result.item_id!==normal(binding.item.Id)||result.source_id!==binding.source.Id)return null;this.context=result;await this.refreshSubtitles();return result;}catch(error){if(epoch===this.epoch&&this.owns(binding)&&error?.status===422&&error?.code==='duration_unavailable'){this.subtitleLocalOnly=true;await this.refreshSubtitles();}return null;}}
 ticks(){return Math.round(this.manager.currentTime(this.binding.player)*10000);}
 canSeek(){return this.binding&&this.context&&Number.isSafeInteger(this.context.duration_ticks)&&this.context.duration_ticks>0&&this.owns(this.binding)&&this.manager.getPlayerState(this.binding.player)?.PlayState?.CanSeek===true;}
 seek(ticks){if(!this.canSeek()||!Number.isSafeInteger(ticks)||ticks<0||ticks>=this.context.duration_ticks)return false;this.manager.seek(ticks,this.binding.player);return true;}
 segment(){if(!this.canSeek()||this.context.capabilities?.playback_preferences!==true)return null;const ticks=this.ticks(),duration=this.context.duration_ticks,rows=this.context.segments;if(!Number.isSafeInteger(ticks)||!Array.isArray(rows)||rows.length>256)return null;const valid=rows.filter(s=>s&&['Intro','Outro'].includes(s.type)&&Number.isSafeInteger(s.start_ticks)&&Number.isSafeInteger(s.end_ticks)&&0<=s.start_ticks&&s.end_ticks-s.start_ticks>=10000000&&s.end_ticks<=duration&&(s.type!=='Intro'||s.end_ticks<duration)),active=valid.filter(s=>s.start_ticks<=ticks&&ticks<s.end_ticks);if(active.length!==1)return null;const selected=active[0];return valid.some(s=>s!==selected&&s.start_ticks<selected.end_ticks&&selected.start_ticks<s.end_ticks)?null:selected;}
 automatic(type){const key=type==='Intro'?'auto_intro':type==='Outro'?'auto_credits':null;return !!key&&(Object.prototype.hasOwnProperty.call(this.autoOverrides,key)?this.autoOverrides[key]:this.context?.[key]===true);}
 setAutomatic(type,enabled){if(!this.canSeek()||this.context.capabilities?.playback_preferences!==true||typeof enabled!=='boolean'||!['Intro','Outro'].includes(type))return false;this.autoOverrides[type==='Intro'?'auto_intro':'auto_credits']=enabled;return true;}
 async bookmark(label){const binding=this.binding,context=this.context;if(!this.canSeek()||!context.capabilities.bookmarks)return false;const ticks=this.ticks();if(ticks<0||ticks>=context.duration_ticks)return false;const state=await this.client.request('/state');if(!this.owns(binding))return false;await this.client.request('/player-bookmark',{id:context.item_id,source_id:context.source_id,copy_key:context.copy_key,ticks,label,revision:state.revision,mutation_id:crypto.randomUUID().replace(/-/g,'')});if(!this.owns(binding))return false;await this.bind();return true;}
 subtitleScope(){return this.binding?JSON.stringify([this.binding.account,normal(this.binding.item.Id),this.binding.source.Id,this.binding.session]):'';}
 canSubtitles(){return this.subtitleChoices().some(choice=>choice.kind!=='off');}
 subtitleEnabled(){const current=this.current();return !!this.binding&&this.owns(this.binding)&&current?.source===this.binding.source&&current.copy===this.binding.copy&&(this.context?.capabilities.playback_preferences===true||this.subtitleLocalOnly&&!!this.currentVideo());}
 subtitle(index){const choice=this.subtitleChoices().find(c=>index===-1?c.kind==='off':c.kind==='server'&&c.index===index);return !!choice&&this.selectSubtitle(choice);}
 detachVideo(){const watch=this.videoWatch;this.videoWatch=null;this.videoEpoch++;if(watch)for(const [target,event,handler] of watch.listeners)target.removeEventListener(event,handler);}
 currentVideo(){
  if(!this.binding||!this.owns(this.binding)||this.binding.player.id!=='htmlvideoplayer'||typeof document==='undefined')return null;
  const current=this.current();if(current.source!==this.binding.source||current.copy!==this.binding.copy)return null;
  const videos=[...document.querySelectorAll('.videoPlayerContainer video')].filter(v=>v.isConnected&&v.getClientRects().length&&String(v.className||'').split(/\s+/).includes('htmlvideoplayer'));
  if(videos.length!==1)return null;const video=videos[0],playerSrc=this.binding.player.currentSrc?.(),videoSrc=video.currentSrc||video.src;
  if(typeof playerSrc!=='string'||!playerSrc||typeof videoSrc!=='string'||!videoSrc||!video.textTracks)return null;
  // The HTML player's current play options and exact source must own this container.
  const options=this.binding.player._currentPlayOptions;
  if(!options||options.mediaSource!==this.binding.source||normal(options.item?.Id)!==normal(this.binding.item.Id)||options.playSessionId!==this.binding.session)return null;
  const resumed=options.playerStartPositionTicks>0?options.url+'#t='+options.playerStartPositionTicks/10000000:options.url;
  if(playerSrc!==options.url&&playerSrc!==resumed)return null;
  if(videoSrc!==playerSrc&&!(videoSrc.startsWith('blob:')&&this.binding.player._hlsPlayer?.media===video))return null;
  return {video,list:video.textTracks,playerSrc,videoSrc};
 }
 syncVideo(){
  const current=this.currentVideo(),old=this.videoWatch;
  if(!current){this.detachVideo();return null;}
  if(old&&old.video===current.video&&old.list===current.list&&old.playerSrc===current.playerSrc&&old.videoSrc===current.videoSrc)return old;
  this.detachVideo();const watch={...current,owner:this.subtitleOwner,epoch:++this.videoEpoch,loading:current.video.readyState<1,listeners:[]};this.videoWatch=watch;
  const changed=()=>{if(this.videoWatch===watch)this.refreshSubtitles();};
  const loading=()=>{if(this.videoWatch!==watch)return;watch.loading=true;watch.epoch=++this.videoEpoch;changed();};
  const loaded=()=>{if(this.videoWatch!==watch)return;watch.loading=false;changed();};
  for(const [target,event,handler] of [[watch.list,'addtrack',changed],[watch.list,'removetrack',changed],[watch.list,'change',changed],[watch.video,'loadstart',loading],[watch.video,'emptied',loading],[watch.video,'loadedmetadata',loaded]]){target.addEventListener(event,handler);watch.listeners.push([target,event,handler]);}
  return watch;
 }
 ownsVideo(watch,epoch){const current=this.currentVideo();return !!current&&this.videoWatch===watch&&watch.owner===this.subtitleOwner&&watch.epoch===epoch&&!watch.loading&&watch.video.readyState>=1&&current.video===watch.video&&current.list===watch.list&&current.playerSrc===watch.playerSrc&&current.videoSrc===watch.videoSrc;}
 subtitleChoices(){
  if(!this.subtitleEnabled()){this.detachVideo();return [];}
  const owner=this.subtitleOwner,binding=this.binding,choices=[{kind:'off',id:'off',label:'Subtitles off',owner,binding}],streams=(binding.source.MediaStreams||[]).filter(s=>s.Type==='Subtitle'&&Number.isSafeInteger(s.Index)&&s.Index>=0);
  for(const stream of streams)choices.push({kind:'server',id:'server:'+stream.Index,index:stream.Index,label:stream.DisplayTitle||stream.Language||'Subtitle '+stream.Index,language:stream.Language||'',stream,descriptor:JSON.stringify([stream.Type,stream.Index,stream.Language||'',stream.DisplayTitle||'',stream.Codec||'',stream.DeliveryMethod||'',stream.Path||'',stream.DeliveryUrl||'',stream.IsExternal===true,stream.IsForced===true,stream.IsHearingImpaired===true,stream.realDeliveryMethod||'']),owner,binding});
  const watch=this.syncVideo();if(!watch||!this.ownsVideo(watch,watch.epoch))return choices;
  // Keep genuine embedded/HLS mapping and external subtitle rendering on Jellyfin's selector.
  if(streams.some(s=>s.IsExternal!==true&&String(s.DeliveryMethod||'').toLowerCase()!=='external'))return choices;
  const external=new Set([...watch.video.querySelectorAll('track')].map(element=>element.track));
  for(const track of Array.from(watch.list)){if(!['subtitles','captions'].includes(track.kind)||!['disabled','hidden','showing'].includes(track.mode)||external.has(track)||String(track.label||'').includes('manualTrack'))continue;
   if(!this.trackIds.has(track))this.trackIds.set(track,++this.nextTrackId);
   choices.push({kind:'native',id:'native:'+this.trackIds.get(track),track,watch,videoEpoch:watch.epoch,label:track.label||track.language||'Subtitle',language:track.language||'',owner,binding});
  }return choices;
 }
 choiceCurrent(choice){if(!choice||choice.owner!==this.subtitleOwner||!this.binding||!this.owns(choice.binding)||this.current()?.copy!==choice.binding.copy||choice.binding.source!==this.binding.source||!this.subtitleEnabled())return false;return this.subtitleChoices().some(current=>current.kind===choice.kind&&current.id===choice.id&&(choice.kind!=='server'||current.stream===choice.stream&&current.descriptor===choice.descriptor)&&(choice.kind!=='native'||current.track===choice.track&&current.watch===choice.watch&&current.videoEpoch===choice.videoEpoch&&this.ownsVideo(choice.watch,choice.videoEpoch)));}
 subtitleSignature(choice){if(choice.kind==='native')return JSON.stringify([choice.track.kind,choice.track.id||'',choice.track.language||'',choice.track.label||'']);if(choice.kind==='server'){const descriptor=JSON.parse(choice.descriptor),original=descriptor.pop();if(['External','Embed','Encode'].includes(original)&&(descriptor[5]==='Encode'||descriptor[5]===original))descriptor[5]=original;return JSON.stringify(descriptor);}return 'off';}
 setNativeModes(watch,selected){if(!watch||!this.ownsVideo(watch,watch.epoch))return;for(const track of Array.from(watch.list))if(['subtitles','captions'].includes(track.kind)){const mode=track===selected?'showing':'disabled';if(track.mode!==mode)track.mode=mode;}}
 selectSubtitle(choice,manual=true){
  if(this.subtitleMutating||!this.choiceCurrent(choice))return false;this.subtitleMutating=true;
  const ticket=++this.subtitleTicket;this.subtitleIntentSuspended=false;
  try{this.subtitleApplied=this.subtitleScope();if(manual){this.subtitleManual=true;this.subtitleIntent={scope:this.logicalSubtitleScope(),kind:choice.kind,signature:this.subtitleSignature(choice)};}this.subtitleSelection=choice;this.subtitleRestore=false;
   if(choice.kind==='native'){const pending={ticket,choice};this.subtitlePending=pending;const result=this.manager.setSubtitleStreamIndex(-1,this.binding.player);return Promise.resolve(result).then(()=>{if(this.subtitleTicket!==ticket||!this.choiceCurrent(choice))return false;this.subtitleMutating=true;try{this.setNativeModes(choice.watch,choice.track);}finally{this.subtitleMutating=false;}return true;},()=>{if(this.subtitleTicket===ticket)this.subtitleIntentSuspended=true;return false;}).finally(()=>{if(this.subtitlePending===pending)this.subtitlePending=null;if(this.subtitleTicket===ticket&&this.choiceCurrent(choice))this.onSubtitleChange?.();});}
   this.subtitlePending=null;this.setNativeModes(this.syncVideo(),null);if(choice.kind!=='server'||this.manager.getSubtitleStreamIndex?.(this.binding.player)!==choice.index)this.manager.setSubtitleStreamIndex(choice.kind==='off'?-1:choice.index,this.binding.player);
   return true;
  }catch{if(this.subtitlePending?.ticket===ticket)this.subtitlePending=null;if(this.subtitleTicket===ticket)this.subtitleIntentSuspended=true;return false;}finally{this.subtitleMutating=false;this.onSubtitleChange?.();}
 }
 selectedSubtitleId(){const choices=this.subtitleChoices(),server=this.manager.getSubtitleStreamIndex?.(this.binding?.player);if(this.subtitleManual&&this.subtitleSelection?.kind==='off')return 'off';const known=choices.find(c=>c.kind==='server'&&c.index===server);if(known)return known.id;const showing=choices.filter(c=>c.kind==='native'&&c.track.mode==='showing');return showing.length===1?showing[0].id:'off';}
 refreshSubtitles(){
  if(this.subtitleMutating)return;const choices=this.subtitleChoices();if(!choices.length)return;
  const intent=this.subtitleIntent;
  if(intent&&intent.scope!==this.logicalSubtitleScope()){this.subtitleIntent=null;this.subtitleManual=false;this.subtitleSelection=null;this.subtitleTicket++;this.subtitlePending=null;}
  if(this.subtitleManual&&this.subtitleIntent){
   const matches=choices.filter(choice=>choice.kind===this.subtitleIntent.kind&&this.subtitleSignature(choice)===this.subtitleIntent.signature);
   if(matches.length===1){const selected=matches[0];
    if(selected.kind==='off'){this.subtitleMutating=true;try{this.setNativeModes(this.syncVideo(),null);if(this.subtitleRestore||this.manager.getSubtitleStreamIndex?.(this.binding.player)!==-1)this.manager.setSubtitleStreamIndex(-1,this.binding.player);this.subtitleSelection=selected;this.subtitleRestore=false;}finally{this.subtitleMutating=false;}}
    else if(!this.subtitleIntentSuspended&&!this.subtitlePending&&(this.subtitleRestore||!this.choiceCurrent(this.subtitleSelection)||selected.kind==='native'&&selected.track.mode!=='showing'&&this.manager.getSubtitleStreamIndex?.(this.binding.player)===-1))return this.selectSubtitle(selected,true);
   }else if(['native','server'].includes(this.subtitleIntent.kind)){this.subtitleMutating=true;try{this.setNativeModes(this.syncVideo(),null);const index=this.manager.getSubtitleStreamIndex?.(this.binding.player),key=JSON.stringify([this.subtitleOwner,index,this.subtitleIntent.kind,this.subtitleIntent.signature]);if(index===-1)this.subtitleUnmatchedOff='';else if(Number.isSafeInteger(index)&&index>=0&&this.subtitleUnmatchedOff!==key){this.subtitleUnmatchedOff=key;const owner=this.subtitleOwner,binding=this.binding;try{const result=this.manager.setSubtitleStreamIndex(-1,binding.player);if(this.manager.getSubtitleStreamIndex?.(binding.player)===-1)this.subtitleUnmatchedOff='';Promise.resolve(result).then(()=>{if(this.subtitleOwner===owner&&this.owns(binding)&&this.manager.getSubtitleStreamIndex?.(binding.player)===-1)this.subtitleUnmatchedOff='';},()=>{});}catch{/* One refused Off attempt per unchanged owner/default; no guessed replacement selection. */}}this.subtitleRestore=false;}finally{this.subtitleMutating=false;}}
  }
  if(!this.subtitleManual&&this.context?.subtitle_language&&this.subtitleApplied!==this.subtitleScope()){const preferred=choices.find(c=>c.kind!=='off'&&language(c.language)===language(this.context.subtitle_language));if(preferred)return this.selectSubtitle(preferred,false);}
  this.onSubtitleChange?.();
 }
 tick(){const segment=this.segment();if(segment&&this.binding.item.Type==='Episode'&&this.manager.getPlayerState(this.binding.player)?.PlayState?.IsPaused===false&&this.automatic(segment.type)){const key=JSON.stringify([segment.type,segment.start_ticks,segment.end_ticks]);if(!this.autoDone.has(key)){this.autoDone.add(key);this.seek(Math.min(segment.end_ticks,this.context.duration_ticks-1));}}return segment;}
}
function install(){const api=global.ApiClient,bridge=global.TelevisionPlayerBridge;if(!api||!bridge||!global.OrbitalPersonal?.enabled(api)||!global.OrbitalExperience?.Client)return null;const control=new PlayerControls(api,bridge.manager,new global.OrbitalExperience.Client(api));let surface=null,panel=null,disposed=false,bindingKey='',boundSourceObject=null,bindPending=false,nextRetry=0,failures=0;
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='ob5-button';b.textContent=label;b.onclick=fn;return b;};
 const close=()=>{control.onSubtitleChange=null;const dialog=panel;panel=null;dialog?.close();dialog?.remove();};
 const status=(text)=>{let n=surface?.querySelector('[role=status]');if(!n&&surface){n=document.createElement('p');n.setAttribute('role','status');surface.append(n);}if(n)n.textContent=text;};
 const show=()=>{if(!control.canSeek()&&!control.canSubtitles())return;close();panel=document.createElement('dialog');panel.className='ox-player-dialog';panel.setAttribute('aria-label','Playback controls');const title=document.createElement('h2');title.textContent='Playback controls';panel.append(title);const context=control.context;
 if(control.canSeek()&&context?.capabilities.bookmarks){panel.append(button('Bookmark this moment',async()=>{try{if(await control.bookmark('At '+Math.floor(control.ticks()/10000000)+' seconds')){close();status('Bookmark saved.');}}catch{status('Could not save. Reopen controls and try again.');}}));for(const mark of context.bookmarks||[])panel.append(button(mark.label,()=>{if(control.seek(mark.ticks))close();}));}
 if(control.canSeek()&&context?.capabilities.playback_preferences){if(control.binding.item.Type==='Episode')for(const [type,label] of [['Intro','Automatically skip intros for this playback'],['Outro','Automatically skip credits for this playback']]){const wrapper=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=control.automatic(type);toggle.onchange=()=>control.setAutomatic(type,toggle.checked);wrapper.append(toggle,document.createTextNode(label));panel.append(wrapper);}}if(control.subtitleEnabled()){const select=document.createElement('select');select.setAttribute('aria-label','Subtitles');let choices=[],signature='';const refresh=()=>{if(!panel||!panel.contains(select))return;choices=control.subtitleChoices();const next=JSON.stringify(choices.map(c=>[c.id,c.label]));if(next!==signature){signature=next;select.replaceChildren();for(const choice of choices){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.label;select.append(option);}}select.value=control.selectedSubtitleId();};select.onchange=async()=>{const choice=choices.find(c=>c.id===select.value);if(choice)await control.selectSubtitle(choice);refresh();};panel.append(select);control.onSubtitleChange=refresh;refresh();const preferences=document.createElement('p');preferences.textContent=context?.subtitle_language?'Preferred subtitle language: '+context.subtitle_language:'';panel.append(preferences);}
 panel.append(button('Close',close));const dialog=panel;dialog.addEventListener('close',()=>{dialog.remove();if(panel===dialog){panel=null;control.onSubtitleChange=null;surface?.querySelector('button')?.focus();}},{once:true});(document.fullscreenElement||document.body).append(dialog);dialog.showModal();dialog.querySelector('button,select')?.focus();};
 async function bind(){const current=control.current();const key=current?JSON.stringify([normal(current.item.Id),current.copy,current.session,current.account]):'';if(key!==bindingKey||current?.source!==boundSourceObject){bindingKey=key;boundSourceObject=current?.source||null;failures=0;nextRetry=0;close();surface?.remove();surface=null;control.stop(true);}if(!key||surface||bindPending||Date.now()<nextRetry)return;bindPending=true;try{const context=control.context||(control.subtitleLocalOnly?null:await control.bind());if(disposed||!control.binding||!control.owns(control.binding)||!context&&!control.canSubtitles()){failures++;nextRetry=Date.now()+Math.min(30000,1500*2**Math.min(failures,4));return;}const videos=[...document.querySelectorAll('video')].filter(v=>v.isConnected&&v.getClientRects().length);if(videos.length!==1){nextRetry=Date.now()+750;return;}surface=document.createElement('aside');surface.className='ox-player-controls';surface.setAttribute('aria-label','Personal playback controls');surface.append(button('Playback controls',show));const skip=button('Skip intro',()=>{const s=control.segment();if(s)control.seek(Math.min(s.end_ticks,control.context.duration_ticks-1));});skip.dataset.oxSkip='true';skip.hidden=true;surface.append(skip);const root=document.fullscreenElement||document.body;const osd=root.querySelector?.('#videoOsdPage')||root.querySelector?.('.videoOsdPage');(osd?.getClientRects().length?osd:root).append(surface);}finally{bindPending=false;}}
 const update=()=>{if(disposed)return;bind();if(!control.binding||!control.owns(control.binding)){surface?.remove();surface=null;close();return;}control.refreshSubtitles();const active=control.tick(),skip=surface?.querySelector('[data-ox-skip]');if(skip){skip.hidden=!active;skip.textContent=active?.type==='Outro'?'Skip credits':'Skip intro';}if(panel&&!control.canSeek()&&!control.canSubtitles())close();};
 const stopped=()=>{bindingKey='';boundSourceObject=null;control.stop();close();surface?.remove();surface=null;};bridge.events.on(bridge.manager,'playbackstop',stopped);const timer=setInterval(update,750);update();return()=>{disposed=true;clearInterval(timer);bridge.events.off?.(bridge.manager,'playbackstop',stopped);stopped();};
}
global.OrbitalExperiencePlayer={PlayerControls,install};if(typeof module!=='undefined')module.exports={PlayerControls};
if(typeof document!=='undefined'){let dispose=null,account='';const timer=setInterval(()=>{const api=global.ApiClient,key=api?.getCurrentUserId?.()?identity(api):'';if(key!==account){dispose?.();dispose=null;account=key;}if(!dispose)dispose=install();},1000);global.addEventListener('pagehide',()=>{dispose?.();clearInterval(timer);});}
})(typeof window==='undefined'?globalThis:window);

/* Owned sports presentation only. Original API data and player synchronization are untouched. */
(function(global){'use strict';
const scopes='.otv-sports,.otv-game-center,.otv-trk,.otv-trk-picker,.otv-pbar,.ob5-team-page,.ob5-shelf[aria-label="Your teams"],.ob5-shelf[aria-label="Live sports"]';
const flags=['sports_scores','sports_results','sports_headlines','sports_thumbnails'];
let identity='',prefs=null,pending=null,checked=0,generation=0,queued=false;
let revealed=new WeakSet();const labels=new WeakMap();
function account(){const api=global.ApiClient;return global.OrbitalPersonal?.enabled(api)?JSON.stringify([api.serverId(),api.getCurrentUserId(),api.accessToken()]):'';}
function active(){return prefs===null?Object.fromEntries(flags.map(k=>[k,true])):prefs;}
function current(root){return !revealed.has(root)&&flags.some(k=>active()[k]);}
function safeLabel(node){if(node.matches('.otv-sports-game'))return [...node.querySelectorAll('.otv-card2-name')].map(n=>n.textContent).join(' vs ')+' · Game details';if(node.matches('.otp-row'))return [node.querySelector('.otp-row-date')?.textContent,node.querySelector('.otp-row-opp')?.textContent,'Game details'].filter(Boolean).join(' · ');return node.querySelector('strong')?.textContent+' · Team details';}
function paint(){queued=false;const who=account();if(who!==identity){identity=who;generation++;prefs=null;checked=0;pending=null;revealed=new WeakSet();}
 for(const root of document.querySelectorAll(scopes)){
  const hide=!!identity&&current(root),p=active();
  for(const key of flags)root.classList.toggle('ox-'+key,hide&&p[key]===true);
  const strict=hide&&(p.sports_scores||p.sports_results);
  for(const node of root.querySelectorAll('.ob5-team-next'))node.classList.toggle('ox-sports-result-context',/^Last\s*·/.test(node.textContent));
  for(const node of root.querySelectorAll('.otv-sports-game,.otp-row,.ob5-team-card')){
   const old=labels.get(node),value=node.getAttribute('aria-label');
   if(strict){const safe=safeLabel(node);if(value!==safe){labels.set(node,{original:value,safe});node.setAttribute('aria-label',safe);}}
   else if(old){if(value===old.safe){if(old.original===null)node.removeAttribute('aria-label');else node.setAttribute('aria-label',old.original);}labels.delete(node);}
  }
  let button=root.querySelector(':scope > .ox-sports-reveal');
  if(!identity||prefs!==null&&!flags.some(k=>prefs[k])){button?.remove();continue;}
  if(!button){button=document.createElement('button');button.type='button';button.className='ob5-button ox-sports-reveal';button.onclick=()=>{revealed.has(root)?revealed.delete(root):revealed.add(root);paint();};root.prepend(button);}
  const text=revealed.has(root)?'Hide sports spoilers':prefs===null?'Reveal sports details':'Reveal hidden sports details';
  if(button.textContent!==text)button.textContent=text;
  button.setAttribute('aria-pressed',String(revealed.has(root)));
 }
 if(identity&&!pending&&Date.now()-checked>30000){const epoch=generation,who=identity;const client=new global.OrbitalExperience.Client(global.ApiClient);const timer=setTimeout(()=>client.reset(),2500);
  pending=client.request('/state').then(s=>{if(epoch===generation&&who===account()){prefs=s.capabilities?.spoilers?Object.fromEntries(flags.map(k=>[k,s.preferences?.[k]===true])):{};checked=Date.now();}}).catch(()=>{if(epoch===generation)checked=Date.now()-25000;}).finally(()=>{clearTimeout(timer);if(epoch===generation){pending=null;queue();}});
 }
}
function queue(){if(queued)return;queued=true;queueMicrotask(paint);}
new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&!n.matches?.('.ox-sports-reveal'))))queue();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label']});
global.addEventListener('hashchange',()=>{revealed=new WeakSet();queue();});
global.addEventListener('orbital:personal-changed',()=>{generation++;checked=0;pending=null;prefs=null;revealed=new WeakSet();queue();});
const timer=setInterval(queue,1000);global.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
global.OrbitalSportsSpoilers={refresh:queue};queue();
})(window);


/* Compact baseball presentation. Receives picture-held data only. */
(()=>{'use strict';
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
const image=(url,cls)=>{const n=el('img',cls);n.alt='';n.decoding='async';if(/^https:\/\/a\.espncdn\.com\//.test(url||''))n.src=url;else n.hidden=true;n.onerror=()=>{n.hidden=true;};return n;};
const call=(p,previous)=>window.TelevisionTrackers.pitchCall(p,previous);
const short=p=>{const t=(p?.pitch_type||'').toLowerCase();return /four/.test(t)?'4S':/two/.test(t)?'2S':/slider/.test(t)?'SL':/change/.test(t)?'CH':/curve/.test(t)?'CU':/sinker/.test(t)?'SI':/cutter/.test(t)?'FC':/split/.test(t)?'FS':/sweeper/.test(t)?'SW':t.slice(0,3).toUpperCase()||'—';};
const tone=(p,prior)=>/foul/i.test(p?.text||'')&&!/tip|bunt/i.test(p?.text||'')&&p.strikes===2&&prior?.strikes===2?'#c39aff':/foul/i.test(p?.text||'')?'#ffcd57':/strike|swinging|whiff/i.test(p?.text||'')?'#ff5867':/ball/i.test(p?.text||'')&&!/in play/i.test(p?.text||'')?'#79dd9e':'#edf3f9';
function pitchLocationCaption(data,model,points){if(!points.length&&data?.geometry_status==='loading')return 'Loading pitch locations';if(!points.length&&data?.geometry_status==='unavailable')return 'Pitch locations unavailable';return model.field?.source==='mlb'?'MLB zone':'Approx. zone';}
function baseballCounts(data,last){
 const state=data?.reported_source==='MLB'?data.situation:last;
 const valid=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max?value:null;
 return {balls:valid(state?.balls,4),strikes:valid(state?.strikes,3)};
}
function baseballActors(data){
 const rows=data?.plays||[],last=rows.at(-1),timeline=data?.timeline||[],pitch=timeline.slice().reverse().find(p=>p.pitch&&(last?String(p.id)===String(last.id)||last.at_bat!=null&&p.at_bat===last.at_bat:data?.summary?.scope!=='previous_at_bat')),start=timeline.slice().reverse().find(p=>p.at_bat===pitch?.at_bat&&/ pitches to /.test(p.text||'')),names=start?.text?.match(/^(.+?) pitches to (.+)$/);
 const named=value=>typeof value==='string'?value:typeof value?.name==='string'?value.name:'';
 return {names:[named(last?.pitcher)||named(pitch?.pitcher)||names?.[1]||'',named(last?.batter)||named(pitch?.batter)||names?.[2]||''],half:last?.half||pitch?.half||null};
}
function create(data,{teams=[],people={},caption='',context='',onMinimize=null,onSync=null,onInspect=null,onDetails=null,diamond=null}={}){
 const ready=!!data,rows=ready?(data.plays||[]):[],last=rows.at(-1),timeline=ready?(data.timeline||[]):[];
 const pitch=timeline.slice().reverse().find(p=>p.pitch),start=timeline.slice().reverse().find(p=>p.at_bat===pitch?.at_bat&&/ pitches to /.test(p.text||''));
 const names=start?.text?.match(/^(.+?) pitches to (.+)$/),summary=ready&&data?.summary?.summary_only===true,completed=ready&&(data?.summary?.completed===true||data?.summary?.scope==='previous_at_bat'),counts=baseballCounts(data,last),terminal=counts.strikes===3?'Strikeout':counts.balls===4?'Walk':null;
 const card=el('section','otv-baseball-card');card.setAttribute('aria-label','Pitch tracker');
 const header=el('header','obc-header');header.append(image('https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png','obc-league'),el('strong','','Pitch Tracker'));
 const minimize=el('button','obc-minimize');minimize.type='button';minimize.dataset.trackerControl='minimize';minimize.setAttribute('aria-label','Minimize pitch tracker');const icon=el('span','','−');icon.setAttribute('aria-hidden','true');minimize.append(icon);minimize.onclick=onMinimize;minimize.hidden=!onMinimize;header.append(minimize);card.append(header);if(completed)card.append(el('p','obc-context','Last at-bat'));
 const main=el('div','obc-main'),zone=el('div','obc-zone');
 const neutral={kind:'baseball',tracking_available:true,geometry_available:true,stale:false,field:{physical_width:300,physical_height:300,zone:{x:88/300,y:149/300,width:56/300,height:44/300,approximate:true}},points:[],plays:[],calibration:{note:'Approximate zone'}};
 const base=ready&&data.field?.zone?data:neutral;const model={...base,points:base.points||[],kind:"baseball",tracking_available:true,geometry_available:true,stale:false};const chartData=summary?{...model,points:[]}:model;const chart=window.TelevisionTrackers.cardField(chartData,{onInspect});const labels=[...chart.querySelectorAll('[data-label-x]')].map(n=>({x:Number(n.dataset.labelX),y:Number(n.dataset.labelY)}));const z=model.field.zone,ps=chartData.points||[],w=600,hh=600*(model.field.physical_height||1)/(model.field.physical_width||1),pad=34;const xs=[z.x*w,(z.x+z.width)*w,...ps.map(p=>p.x*w),...labels.map(p=>p.x)],ys=[z.y*hh,(z.y+z.height)*hh,...ps.map(p=>p.y*hh),...labels.map(p=>p.y)];const x0=Math.min(...xs)-pad,y0=Math.min(...ys)-pad;chart.setAttribute('viewBox',[x0,y0,Math.max(...xs)-x0+pad,Math.max(...ys)-y0+pad].join(' '));zone.append(chart,el('small','',pitchLocationCaption(data,model,ps)));
 const detail=el('div','obc-pitch'),type=(last?.pitch_type||'Pitch').replace(/four-seam (fb|fastball)/i,'4-Seam Fastball').replace(/two-seam (fb|fastball)/i,'2-Seam Fastball');
 detail.append(el('strong','',summary?'At-bat complete':last?type+(Number.isFinite(last.mph)?' · '+Math.round(last.mph)+' MPH':''):'Reported game estimate'),el('span','',summary?data.summary.outcome||'At-bat complete':completed&&data.summary?.outcome?data.summary.outcome:last?call(last):'Use Sync to match a reported play'));
 const situation=el('div','obc-situation');if(ready&&diamond)situation.append(diamond);else if(ready&&data.situation&&['on_first','on_second','on_third'].every(k=>typeof data.situation[k]==='boolean')){const ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'svg');g.setAttribute('viewBox','0 0 30 22');g.setAttribute('role','img');g.setAttribute('aria-label','Runners: '+['first','second','third'].filter(k=>data.situation['on_'+k]).join(', '));for(const [x,y,k] of [[15,6,'second'],[7,14,'third'],[23,14,'first']]){const r=document.createElementNS(ns,'rect');for(const [a,v] of Object.entries({x:x-4,y:y-4,width:8,height:8,transform:`rotate(45 ${x} ${y})`,fill:data.situation['on_'+k]?'#ffd166':'#788391',stroke:'#c1cad3','stroke-width':.6}))r.setAttribute(a,v);g.append(r)}situation.append(g)}else situation.append(el('span','obc-bases-empty','Bases —'));
 situation.append(el('small','',terminal?'Outcome':'Count'),el('strong','',terminal|| (ready&&!summary&&!completed&&last&&counts.balls!==null&&counts.strikes!==null?counts.balls+'–'+counts.strikes:'—')),el('span','',ready&&!summary&&Number.isInteger(data.situation?.outs)?data.situation.outs+' '+(data.situation.outs===1?'Out':'Outs'):'—'));
 main.append(zone,detail,situation);card.append(main);
 const recent=el('div','obc-recent');recent.append(el('small','obc-label',summary?'At-bat summary':'Last 3 pitches'));
 if(summary)recent.append(el('p','obc-summary',data.summary.outcome||'Next batter'));else{const chips=el('div','obc-chips');const latest=rows.slice(-3);for(let i=0;i<latest.length;i++){const p=latest[i],chip=el('button','obc-chip'),head=el('div','obc-chip-head'),dot=el('span','obc-dot');chip.type='button';chip.disabled=!p||typeof onInspect!=="function";if(p&&typeof onInspect==="function"){chip.dataset.trackerPlay=String(p.id);chip.setAttribute('aria-label',window.TelevisionTrackers.pitchIdentity(p,rows[rows.indexOf(p)-1],rows.indexOf(p)+1).label);chip.onclick=()=>onInspect(String(p.id));}dot.style.background=p?tone(p,rows[rows.indexOf(p)-1]):'#657585';head.append(dot,el('b','',p?'#'+window.TelevisionTrackers.pitchIdentity(p,rows[rows.indexOf(p)-1],rows.indexOf(p)+1).number+' '+(p.pitch_type||short(p)):'—'));chip.append(head,el('span','obc-chip-detail',p?(Number.isFinite(p.mph)?Math.round(p.mph)+' · ':'')+call(p,rows[rows.indexOf(p)-1]):'No pitch reported'));chips.append(chip);}recent.append(chips);}const legend=el('p','obc-call-legend');for(const [label,color] of [['Called / Swinging strike','#ff5867'],['Ball','#79dd9e'],['Foul','#ffcd57'],['Two-strike foul','#c39aff'],['In play','#edf3f9']]){const key=el('span','obc-call-key'),swatch=el('span','obc-call-swatch');swatch.style.backgroundColor=color;swatch.setAttribute('aria-hidden','true');key.append(swatch,document.createTextNode(label));legend.append(key);}recent.hidden=!summary&&!rows.length;card.append(recent,legend);
 const actors=baseballActors(data),footer=el('footer','obc-players'),batting=actors.half?.toLowerCase()==='top'?'away':actors.half?.toLowerCase()==='bottom'?'home':null;
 for(let i=0;i<2;i++){const name=actors.names[i],person=people[name.toLowerCase()]||{},team=batting?teams.find(t=>i===1?t.side===batting:t.side!==batting):null,row=el('div','obc-person');if(ready&&name)row.append(image(team?.logo||team?.url,'obc-team'),image(person.headshot,'obc-photo'));const labels=el('div','obc-person-copy');labels.append(el('strong','',person.short||(name.includes(' ')?name[0]+'. '+name.split(' ').slice(1).join(' '):name)||(i===0?'Pitcher':'Batter')),el('span','',i===0?'Pitching':summary?'Previous at-bat':'At bat'));labels.querySelector('strong').title=name;row.setAttribute('aria-label',(name|| (i===0?'Pitcher':'Batter'))+(i===0?' pitching':' at bat'));row.append(labels);footer.append(row);}card.querySelector('.obc-header').after(footer);
 const sync=el('button','obc-sync',caption||'Estimated timing · Sync');sync.type='button';sync.dataset.trackerControl='sync';sync.onclick=onSync;const controls=el('div','otc-footer');if(onDetails){const details=el('button','otc-action','Details');details.type='button';details.dataset.trackerControl='details';details.onclick=onDetails;controls.append(details);}if(onSync)controls.append(sync);if(onSync||onDetails)card.append(controls);else card.append(el("small","obc-context",caption));return card;
}
window.TelevisionBaseballCard={create,actors:baseballActors,counts:baseballCounts};
})();

/* Missing weather stays absent; zero temperatures and zero precipitation remain real data. */
window.OrbitalWeatherText=w=>{if(!w)return '';const finite=v=>typeof v==='number'&&Number.isFinite(v),parts=[];if(finite(w.temperature))parts.push(Math.round(w.temperature)+'°');if(typeof w.condition==='string'&&w.condition.trim()&&!/^(null|undefined)$/i.test(w.condition.trim()))parts.push(w.condition.trim());if(finite(w.precipitation)&&w.precipitation>=0&&w.precipitation<=100)parts.push(w.precipitation+'% precip.');return parts.join(' · ');};

/* Approved shared football card. */
/* The live card accepts the viewer's held projection, never the live game report. */
(()=>{'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
 const action=(label,key,fn)=>{const n=el('button','otc-action',label);n.type='button';n.dataset.trackerControl=key;if(key==='minimize')n.setAttribute('aria-label','Minimize drive tracker');n.onclick=fn;return n;};
 function create(data,{teams=[],caption='Estimated timing · Sync',onMinimize=null,onSync=null,onDetails=null,onInspect=null}={}){
  const T=window.TelevisionTrackers,state=T.footballState(data),card=el('section','otv-football-live otc-card');card.setAttribute('aria-label','Drive tracker');
  const header=el('header','otc-header');header.append(el('strong','','Drive Tracker'));if(onMinimize)header.append(action('−','minimize',onMinimize));card.append(header);
  const owner=el('div','otc-owner'),team=state.drive||state.team,art=teams.find(t=>String(t.id||t.espn_id)===String(team?.id)||t.abbr===team?.abbreviation);
  if(/^https:\/\/a\.espncdn\.com\//.test(art?.logo||art?.url||'')){const img=el('img','otc-team');img.src=art.logo||art.url;img.alt='';img.onerror=()=>img.hidden=true;owner.append(img);}
  const identity=el('div','otc-identity');identity.append(el('strong','',team?(team.abbreviation||team.name)+(state.team?' ball':' drive'):'Possession not reported'));
  const rows=T.footballRows(data),drive=rows.filter(p=>T.footballKind(p)!=='Kickoff'),gains=drive.filter(p=>!['FG','PAT','Punt','Kickoff','INT','Fumble'].includes(T.footballKind(p))),valid=gains.filter(p=>Number.isFinite(T.footballYards(p))),yards=valid.reduce((total,p)=>total+T.footballYards(p),0);
  identity.append(el('small','',drive.length?(drive.length+' reported '+(drive.length===1?'play':'plays')+(valid.length===gains.length?' · '+yards+' yards':'')+' · →'):'Waiting for a reported play'));
  owner.append(identity);card.append(owner);
  const visual=el('div','otc-field'),shown={team_id:team?.id,start_x:drive[0]?.start_x,end_x:drive.at(-1)?.end_x,play_details:drive},map=data.geometry_available&&!data.stale?T.driveField(data,shown):null;
  if(map){map.classList.add('otc-breadcrumb');const make=(tag,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);return n;};for(const p of drive){const kind=T.footballKind(p),end=['FG','PAT','Punt','Kickoff'].includes(kind)?p.start_x:p.end_x;if(!Number.isFinite(end))continue;const dot=make('circle',{cx:50+end*500,cy:22,r:4,fill:T.footballColor(T.footballYards(p),kind),stroke:'#e4f2ed','stroke-width':1.5});const title=make('title',{});title.textContent=p.text;dot.append(title);map.append(dot);}if(state.target!==null)map.append(make('line',{x1:50+state.target*500,x2:50+state.target*500,y1:2,y2:42,stroke:'#ffd166','stroke-width':2}));visual.append(map);}else visual.append(el('p','otc-empty','Play map unavailable'));card.append(visual);
  const situation=el('div','otc-situation'),down=el('div','');down.append(el('strong','',state.down||'—'),el('small','',state.spot?'at '+state.spot:'Spot not reported'));situation.append(down);
  const clock=el('div','otc-clock');clock.append(el('strong','',data.timeline?.length?state.clock||'—':'—'),el('small','',data.timeline?.length?(state.saved?'Saved report':'Reported situation'):'Match your picture'));situation.append(clock);card.append(situation);
  const last=(data.plays||[]).filter(p=>p?.text).at(-1),latest=el('div','otc-latest');latest.append(el('small','otc-label','Latest play'));
  if(last){const label=el('strong','otc-result',/end (of )?(quarter|half|period|game)/i.test(last.text||'')?'':T.footballLabel(last));label.style.color=T.footballColor(T.footballYards(last),T.footballKind(last));latest.append(label,el('p','otc-play-text',last.text));}
  else latest.append(el('p','otc-play-text','Use Sync to match a reported play'));card.append(latest);
  if(onDetails||onSync){const footer=el('footer','otc-footer');if(onDetails)footer.append(action('Details','details',onDetails));if(onSync)footer.append(action(caption,'sync',onSync));card.append(footer);}
  return card;
 }
 window.TelevisionFootballCard={create};
})();

/* Game Center shows the reported game. The player separately supplies its held prefix. */
(()=>{'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
 function projectPitch(data,p){
  const visible=(data.timeline||[]).filter(row=>Number.isFinite(p.at)&&row.at<=p.at),report=visible.findLast(row=>String(row.id)===String(p.id))||visible.at(-1),context=visible.findLast(row=>row.period===report?.period&&row.half===report?.half&&Array.isArray(row.bases));
  const bases=context?.bases??null,situation={balls:p.balls??null,strikes:p.strikes??null,outs:report?.outs??context?.outs??null,on_first:bases===null?null:bases.includes(1),on_second:bases===null?null:bases.includes(2),on_third:bases===null?null:bases.includes(3)};
  return {...data,plays:[p],points:(data.points||[]).filter(point=>String(point.id)===String(p.id)),timeline:visible,situation,summary:{...data.summary,completed:false,summary_only:false,scope:'current_at_bat'}};
 }
 function create(data,{onInspect=null}={}){
  const T=window.TelevisionTrackers,section=el('section','otv-tracker-content otv-baseball-game');section.dataset.kind='baseball';
  const layout=el('div','otv-tracker-layout'),details=el('div','otv-tracker-details'),teams=(data.teams||[]).map(t=>({...t,abbr:t.abbreviation,logo:window.OrbitalTeamArt?.[data.league+'|'+t.name]?.url}));
  let selected=null;
  const inspect=id=>{if(onInspect){onInspect(id);return;}const p=(data.plays||[]).find(p=>String(p.id)===String(id));if(!p)return;selected=String(id);details.replaceChildren(el('h4','otv-panel-label','Pitch '+T.pitchIdentity(p,null,p.number).number),el('strong','',p.pitch_type||'Reported pitch'),el('p','',p.text));if(Number.isFinite(p.mph))details.append(el('p','',Math.round(p.mph)+' MPH'));
   const chosen=projectPitch(data,p);
   const replacement=window.TelevisionBaseballCard.create(chosen,{teams,caption:'Selected pitch · reported game information',onInspect:inspect});card.replaceWith(replacement);card=replacement;
   for(const n of card.querySelectorAll('[data-tracker-play]')){n.dataset.playId=n.dataset.trackerPlay;n.classList.add('otv-play-select');n.setAttribute('aria-pressed',String(n.dataset.trackerPlay===selected));}details.append(reset);
   details.querySelector('button')?.focus({preventScroll:true});};
  let card=window.TelevisionBaseballCard.create(data,{teams,caption:data.stale?'Saved game report':'Reported game information',onInspect:inspect});
  for(const n of card.querySelectorAll('[data-tracker-play]')){n.classList.add('otv-play-select');n.dataset.playId=n.dataset.trackerPlay;n.setAttribute('aria-pressed','false');}
  const reset=el('button','otv-category','Whole at-bat');reset.type='button';reset.onclick=()=>{const replacement=create(data,{onInspect});section.replaceWith(replacement);(replacement.querySelector('.obh-view-tabs>button')||replacement.querySelector('.otv-tracker-details>button:not(:disabled)'))?.focus({preventScroll:true});};
  details.append(el('h4','otv-panel-label','This at-bat'));for(const p of data.plays||[]){const row=el('button','otv-play-select',T.pitchIdentity(p,null,p.number).label);row.type='button';row.dataset.playId=String(p.id);row.setAttribute('aria-pressed','false');row.onclick=()=>inspect(String(p.id));details.append(row);}if(!(data.plays||[]).length)details.append(el('p','','No pitch reports available yet'));
  layout.append(card,details);section.append(layout);return window.OrbitalSportsGlass?.baseballRecent(section,data)||section;
 }
 window.TelevisionBaseballGameView={create,projectPitch};
})();

/* Sports presentation only. Existing held projections own every displayed fact. */
(()=>{'use strict';
const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
const svg=(tag,attrs,text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const icon=(name)=>{const n=svg('svg',{viewBox:'0 0 24 24',width:16,height:16,'aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round'});n.append(svg('path',{d:({details:'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1',sync:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',inspect:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',minus:'M5 12h14'})[name]||'M5 12h14'}));return n;};
const rosters=new Map();
function artwork(card,data){
 const nameKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 const api=window.ApiClient,ownership=window.OrbitalTrackerOwnership,scope=ownership?.capture(),id=String(data?.event_id||'');
 if(!api||!scope||!id||api.getCurrentUserId()===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'))return;
 const key=ownership.key(scope)+':'+id,names=window.TelevisionBaseballCard.actors(data).names;
 const current=()=>card.isConnected&&window.ApiClient===api&&ownership.accepts(scope)&&String(data.event_id)===id;
 const paint=people=>{if(!current())return;for(const [i,row] of [...card.querySelectorAll('.obc-person')].entries()){
  const person=people[nameKey(names[i])];if(!person)continue;const photo=row.querySelector('.obc-photo');if(photo&&/^https:\/\/a\.espncdn\.com\/i\/headshots\//.test(person.headshot||'')){photo.src=person.headshot;photo.hidden=false;}
  if(person.short)row.querySelector('.obc-person-copy strong').textContent=person.short;
 }};
 queueMicrotask(()=>{if(!current())return;let entry=rosters.get(key);if(!entry||Date.now()-entry.at>60000){
  entry={at:Date.now()};rosters.set(key,entry);while(rosters.size>6)rosters.delete(rosters.keys().next().value);
  const captured=entry;entry.promise=Promise.resolve().then(()=>current()?api.ajax({type:'GET',url:api.getUrl('sports/api/boxscore',{event:id,league:'MLB'}),dataType:'json',timeout:6000}):{}).then(box=>{
   if(window.ApiClient!==api||!ownership.accepts(scope)||rosters.get(key)!==captured||box.event_id!=null&&String(box.event_id)!==id)return {};
   const people={};for(const team of box.players||[])for(const group of team.groups||[])for(const p of group.athletes||[])if(typeof p.name==='string'&&p.name)people[nameKey(p.name)]={short:typeof p.short==='string'&&!/^(null|undefined)$/i.test(p.short.trim())?p.short.trim():'',headshot:typeof p.headshot==='string'?p.headshot:''};return people;
  }).catch(()=>({}));
 }entry.promise.then(paint);
 });
}
function decorateDrive(map){
 if(!map||map.dataset.glassField)return map;map.dataset.glassField='true';map.setAttribute('viewBox','0 0 600 120');map.setAttribute('preserveAspectRatio','none');
 const original=[...map.children], field=original.find(n=>n.tagName==='rect');if(!field)return map;
 field.setAttribute('height',118);field.setAttribute('fill','#183d2f');field.setAttribute('stroke','#88b8b344');field.setAttribute('rx',8);
 const turf=svg('image',{x:50,y:1,width:500,height:118,href:window.OrbitalSportsTurf||(window.OrbitalAsset||'/web/orbital/')+'assets/tracker-turf-506282d2c059.png',preserveAspectRatio:'none',opacity:.48});field.after(turf);
 const shade=svg('rect',{x:50,y:1,width:500,height:118,fill:'#062b1d',opacity:.18});turf.after(shade);
 for(let y of [1,119])shade.after(svg('line',{x1:50,x2:550,y1:y,y2:y,stroke:'#d9f3de',opacity:.55}));
 for(let yard=1;yard<100;yard++){const x=50+yard*5;if(yard%10===0)continue;if(yard%5===0)shade.after(svg('line',{x1:x,x2:x,y1:1,y2:119,stroke:'#bfd8ca',opacity:.22}));for(let y of [40,80])shade.after(svg('line',{x1:x,x2:x,y1:y-2,y2:y+2,stroke:'#eff9f2',opacity:.42}));}
 for(const n of original.slice(1)){
  if(n.tagName==='rect'){n.setAttribute('height',118);n.setAttribute('fill-opacity',.95);}
  if(n.tagName==='text'){
   if(Number(n.getAttribute('y'))===57){n.setAttribute('y',26);n.setAttribute('font-size',18);n.setAttribute('font-weight',600);n.setAttribute('fill','#d9eee1');n.setAttribute('opacity',.8);const bottom=n.cloneNode(true);bottom.setAttribute('y',105);map.insertBefore(bottom,map.querySelector('circle'));}
   else {n.setAttribute('y',64);n.setAttribute('font-size',15);n.setAttribute('letter-spacing',1);n.setAttribute('transform',`rotate(-90 ${n.getAttribute('x')} 60)`);}
  }
  if(n.tagName==='line'){
   if(n.getAttribute('y1')===n.getAttribute('y2')){n.setAttribute('y1',60);n.setAttribute('y2',60);n.setAttribute('stroke-width',5);}
   else {n.setAttribute('y1',1);n.setAttribute('y2',119);n.setAttribute('opacity',n.getAttribute('stroke')==='#ffd166'?.9:.4);}
  }
  if(n.tagName==='path'&&n.hasAttribute('d'))n.setAttribute('transform','translate(0 38)');
  if(n.tagName==='circle'){n.setAttribute('cy',60);n.setAttribute('r',n.getAttribute('fill')==='#fff'?4:5);}
 }
 return map;
}
function controls(card){
 for(const b of card.querySelectorAll('[data-tracker-control]')){
  const key=b.dataset.trackerControl;
  if(key==='minimize'){b.replaceChildren(icon('minus'));const label=node('span','otc-minimize-label','Minimize');b.append(label);}
  if(key==='details'){b.prepend(icon('details'));}
  if(key==='sync'){
   const caption=b.textContent;b.replaceChildren(icon('sync'),node('span','','Sync'));
   const status=node('div','otc-sync-status');status.append(node('span','otc-status-dot'),node('small','',caption.replace(/\s*[·•]\s*Sync$/i,'')));
   b.closest('.otc-footer').after(status);
  }
 }
}
const football=window.TelevisionFootballCard.create;
window.TelevisionFootballCard.create=(data,options={})=>{
 const c=football(data,options);c.classList.add('otc-glass');decorateDrive(c.querySelector('.otc-breadcrumb'));
 const state=window.TelevisionTrackers.footballState(data),identity=c.querySelector('.otc-identity'),team=state.drive||state.team;
 if(team){identity.querySelector('strong').textContent=(team.name||team.abbreviation)+(state.team?' ball':' drive');}
 const summary=identity.querySelector('small');summary.textContent=summary.textContent.replace(' reported','').replace(' · →','');
 const clock=c.querySelector('.otc-clock small');if(clock)clock.textContent=data.held?'Your feed position':clock.textContent;
 const result=c.querySelector('.otc-result');if(result?.textContent){result.classList.add('otc-gain-badge');}
 footballOverlay(c,data);controls(c);return c;
};
const baseball=window.TelevisionBaseballCard.create;
const cardInspectionState=new WeakMap(),pendingInspection=new WeakMap(),pendingBinding=new WeakMap();
function inspectionBinding(value){
 const p=value?.picture;if(!p?.client||!p.execution||!p.video||!p.account||!p.channel||!p.play||!p.event||!Number.isInteger(p.epoch)||value.playing!==true||!value.attempt||!Number.isInteger(value.generation)||!Number.isInteger(value.watch))return null;
 const state=value.pictureState,reference=value.reference;
 return [p.client,p.execution,p.video,p.video.currentSrc||p.video.src||'',p.video.seeking===true,p.account,p.device,p.channel,p.play,p.event,p.epoch,value.attempt,String(value.attempt.id||''),value.generation,value.watch,value.hls,value.resource,value.withdrawal,value.referenceWithdrawal,reference?.generation??null,reference?.withdrawal_at??null,reference?.reference_withdrawal??null,state?.uncertain??null,state?.reason??null,state?.reference_change??null,state?.reference_change?reference?.revision??null:null,state?.original_anchor_at??null,state?.manual_confirmation??null];
}
const sameInspectionBinding=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((value,i)=>value===b[i]);
function inspectionStamp(data){
 if(!data||data.pending||data.kind!=='baseball'||!Array.isArray(data.plays)||!data.plays.length||data.plays.length>256||!Array.isArray(data.points)||data.points.length>256||!Array.isArray(data.timeline)||data.timeline.length>2000)return null;
 const stamp=JSON.stringify({event:data.event_id,league:data.league,state:data.state,period:data.period,phase:data.baseball_phase,reported_source:data.reported_source,binding:data.reported_mlb?.binding,source_generation:data.source_generation,reference_generation:data.reference_generation,reference_withdrawal:data.reference_withdrawal,withdrawal_at:data.withdrawal_at,plays:data.plays,points:data.points,field:data.field,summary:data.summary,situation:data.situation,history:data.batter_history,released_timeline:data.timeline,geometry_available:data.geometry_available,tracking_available:data.tracking_available,orientation_verified:data.orientation_verified});return stamp.length<=2097152?stamp:null;
}
function captureInspection(body,data,value){
 if(!data||typeof data!=='object')return;pendingInspection.delete(data);pendingBinding.delete(data);const binding=inspectionBinding(value);if(!binding)return;pendingBinding.set(data,binding);
 const card=body?.querySelector('.otv-baseball-card'),state=card&&cardInspectionState.get(card),stamp=inspectionStamp(data);
 const history=window.OrbitalBatterHistory?.viewState(card);if(!card?.isConnected||card.closest('[hidden],[aria-hidden=true],[data-enabled=false]')||(!card.dataset.inspectedPitch&&history?.mode!=='history')||!stamp||!state||state.stamp!==stamp||!sameInspectionBinding(state.binding,binding)||state.api!==window.ApiClient||!window.OrbitalTrackerOwnership?.accepts(state.scope)||card.dataset.inspectedPitch&&!inlinePitchChoice(data,card.dataset.inspectedPitch))return;
 pendingInspection.set(data,{...state,id:card.dataset.inspectedPitch||null,history,body});
}
const originalActors=window.TelevisionBaseballCard.actors;
function presentationActors(data){
 if(data?.reported_source!=='MLB'||data?.summary?.scope!=='previous_at_bat')return originalActors(data);
 const named=v=>typeof v==='string'?v:typeof v?.name==='string'?v.name:'';
 const start=(Array.isArray(data.timeline)?data.timeline:[]).findLast(p=>p?.stage==='at_bat_start');
 return {names:[named(data.situation?.pitcher),named(data.situation?.batter)],half:['top','bottom'].includes(start?.half)?start.half:null,next_matchup:true};
}
window.TelevisionBaseballCard.actors=presentationActors;
function inlinePitchChoice(data,id){
 if(data?.summary?.summary_only===true||!Array.isArray(data?.plays)||id==null)return null;
 const index=data.plays.findIndex(p=>p&&String(p.id)===String(id));if(index<0)return null;
 const row=data.plays[index];if(row.id==null||String(row.id)==='')return null;return {row,index,identity:window.TelevisionTrackers.pitchIdentity(row,data.plays[index-1],index+1),call:window.TelevisionTrackers.pitchCall(row,data.plays[index-1])};
}
function inlinePitchDetail(data,choice){
 const summary=data?.summary,last=data?.plays?.at(-1),batId=v=>typeof v==='string'&&v.trim()&&v.length<=160?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?String(v):null;
 const pitchBat=batId(choice.row?.at_bat),summaryBat=batId(summary?.at_bat_id),outcome=summary?.outcome;
 if(choice.row!==last||summary?.completed!==true||!['current_or_latest_at_bat','previous_at_bat'].includes(summary.scope)||!pitchBat||pitchBat!==summaryBat||typeof outcome!=='string'||!outcome.trim()||outcome.length>2048)return choice.call;
 return choice.call===outcome?outcome:choice.call+' · '+outcome;
}
window.TelevisionBaseballCard.create=(data,options={})=>{
 let c,defaultPitchDetail='';const scope=window.OrbitalTrackerOwnership?.capture(),api=window.ApiClient,actors=presentationActors(data),prefix=actors.next_matchup?'Last at-bat · ':'';
 const inspect=id=>{
  if(!c?.isConnected||scope&&!window.OrbitalTrackerOwnership.accepts(scope)||api&&window.ApiClient!==api)return;const choice=inlinePitchChoice(data,id);if(!choice)return;
  const pitch=c.querySelector('.obc-pitch');if(!pitch)return;
  c.dataset.inspectedPitch=String(choice.row.id);c.classList.add('obc-inspecting');
  for(const g of c.querySelectorAll('g[data-point-id]')){const selected=g.dataset.pointId===String(choice.row.id);g.classList.toggle('obc-point-selected',selected);g.classList.toggle('obc-point-muted',!selected);g.setAttribute('aria-pressed',String(selected));g.querySelector('.obc-selection-halo')?.remove();const ball=g.querySelector('[data-physical-ball]');if(selected&&ball){const halo=svg('circle',{cx:ball.getAttribute('cx'),cy:ball.getAttribute('cy'),r:Number(ball.getAttribute('r'))+6,fill:'none',stroke:'#f2f9ff','stroke-width':2,'aria-hidden':'true',class:'obc-selection-halo','data-marker-purpose':'selection halo, not ball diameter'});ball.before(halo);}}
  for(const chip of c.querySelectorAll('.obc-chip'))chip.setAttribute('aria-pressed',String(chip.dataset.trackerPlay===String(choice.row.id)));
  pitch.querySelector('.obc-label').textContent=prefix+'Pitch '+choice.identity.number+' · selected';
  pitch.querySelector('.obc-pitch-type').textContent=(choice.row.pitch_type||'Pitch').replace(/four-seam (fb|fastball)/i,'4-Seam Fastball').replace(/two-seam (fb|fastball)/i,'2-Seam Fastball');
  let speed=pitch.querySelector('.obc-speed');if(Number.isFinite(choice.row.mph)){if(!speed){speed=node('div','obc-speed');speed.append(node('strong',''),node('span','','MPH'));pitch.querySelector('.obc-pitch-type').after(speed);}speed.hidden=false;speed.querySelector('strong').textContent=Math.round(choice.row.mph);}else if(speed)speed.hidden=true;
  pitch.querySelector(':scope>span').textContent=inlinePitchDetail(data,choice);c.querySelector('.obc-count-copy>small').textContent='Live count';
  let reset=pitch.querySelector('.obc-inline-reset');if(!reset){reset=node('button','obc-inline-reset','Latest pitch');reset.type='button';reset.setAttribute('aria-label','Return to latest released pitch');reset.onclick=()=>{
   if(scope&&!window.OrbitalTrackerOwnership.accepts(scope)||api&&window.ApiClient!==api)return;inspect(data.plays.at(-1)?.id);delete c.dataset.inspectedPitch;c.classList.remove('obc-inspecting');for(const g of c.querySelectorAll('g[data-point-id]')){g.classList.remove('obc-point-selected','obc-point-muted');g.setAttribute('aria-pressed','false');g.querySelector('.obc-selection-halo')?.remove();}for(const chip of c.querySelectorAll('.obc-chip'))chip.setAttribute('aria-pressed','false');pitch.querySelector('.obc-label').textContent=prefix+'Pitch '+window.TelevisionTrackers.pitchIdentity(data.plays.at(-1),data.plays.at(-2),data.plays.length).number+' of '+data.plays.length;pitch.querySelector(':scope>span').textContent=defaultPitchDetail;c.querySelector('.obc-count-copy>small').textContent='Count';reset.remove();c.querySelector('.obc-chip:last-child')?.focus({preventScroll:true});
  };pitch.append(reset);}
 };
 c=baseball(data,{...options,onInspect:inspect});defaultPitchDetail=c.querySelector('.obc-pitch')?.querySelector(':scope>span')?.textContent??'';c.classList.add('otc-glass');
 const last=(data?.plays||[]).at(-1),pitch=c.querySelector('.obc-pitch'),main=c.querySelector('.obc-main'),situation=c.querySelector('.obc-situation');
 const title=pitch.querySelector('strong');if(last&&data?.summary?.summary_only!==true){
  const type=(last.pitch_type||'Pitch').replace(/four-seam (fb|fastball)/i,'4-Seam Fastball').replace(/two-seam (fb|fastball)/i,'2-Seam Fastball');
  title.textContent=type;title.className='obc-pitch-type';
  if(Number.isFinite(last.mph)){const speed=node('div','obc-speed');speed.append(node('strong','',Math.round(last.mph)),node('span','','MPH'));title.after(speed);}
  const identity=window.TelevisionTrackers.pitchIdentity(last,(data.plays||[]).at(-2),data.plays.length);
  pitch.prepend(node('small','obc-label',prefix+'Pitch '+identity.number+(String(options.caption||'').startsWith('Selected pitch')?'':' of '+(data.plays||[]).length)));
 }
 if(actors.next_matchup)for(const [i,row] of [...c.querySelectorAll('.obc-person')].entries()){
  const name=actors.names[i],copy=row.querySelector('.obc-person-copy'),team=(options.teams||[]).find(t=>actors.half==='top'?i===1?t.side==='away':t.side==='home':actors.half==='bottom'?i===1?t.side==='home':t.side==='away':false);
  for(const image of row.querySelectorAll('img')){image.removeAttribute('src');image.hidden=true;}
  copy.querySelector('strong').textContent=name.includes(' ')?name[0]+'. '+name.split(' ').slice(1).join(' '):name||(i===0?'Pitcher':'Batter');copy.querySelector('strong').title=name;copy.querySelector('span').textContent=i===0?'Pitching next':'Next batter';row.setAttribute('aria-label',(name||(i===0?'Pitcher':'Batter'))+(i===0?' pitching next':' next batter'));
  if(name&&/^https:\/\/a\.espncdn\.com\//.test(team?.logo||team?.url||'')){let image=row.querySelector('.obc-team');if(!image){image=node('img','obc-team');image.alt='';row.prepend(image);}image.src=team.logo||team.url;image.hidden=false;}
 }
 situation.classList.add('obc-count-band');main.after(situation);const count=situation.querySelector('strong'),outs=situation.querySelector('span');
 const group=node('div','obc-count-copy');group.append(situation.querySelector('small'),count);situation.prepend(group);if(outs)outs.classList.add('obc-outs');
 const knownCount=/\d/.test(count.textContent),knownOuts=/\d/.test(outs?.textContent||''),knownBases=!!situation.querySelector('svg');if(!knownCount&&!knownOuts&&!knownBases)situation.hidden=true;
 const sequence=c.querySelector('.obc-recent>.obc-label');if(sequence)sequence.textContent='Pitch sequence';
 const zone=c.querySelector('.obc-zone');const chart=zone.querySelector('svg');if(chart){
  const accessible=chart.getAttribute('aria-label');if(accessible)chart.setAttribute('aria-label',accessible.replace(/Â·/g,'·'));
  for(const line of chart.querySelectorAll('line[stroke="#64808f"]'))line.remove();
  const prior=chart.viewBox.baseVal;chart.setAttribute('viewBox',`${prior.x+16} ${prior.y+16} ${Math.max(30,prior.width-32)} ${Math.max(30,prior.height-24)}`);
  const box=chart.viewBox.baseVal,zoneRect=chart.querySelector('rect'),plateWidth=Math.min(box.width*.25,40),cx=zoneRect?Number(zoneRect.getAttribute('x'))+Number(zoneRect.getAttribute('width'))/2:box.x+box.width/2,y=box.y+box.height-3;
  chart.append(svg('path',{d:`M ${cx-plateWidth/2} ${y-7} L ${cx+plateWidth/2} ${y-7} L ${cx+plateWidth/2} ${y-2} L ${cx} ${y+5} L ${cx-plateWidth/2} ${y-2} Z`,fill:'#c6d2da',opacity:.55,'aria-hidden':'true'}));
  chart.setAttribute('viewBox',`${box.x} ${box.y} ${box.width} ${box.height+10}`);
  for(const g of chart.querySelectorAll('g[data-point-id]')){
   const circles=[...g.querySelectorAll('circle')],ball=circles.find(n=>!['none','transparent',null].includes(n.getAttribute('fill'))),badge=circles.find(n=>Number(n.getAttribute('r'))===14),color=ball?.getAttribute('fill');
   if(ball){ball.dataset.physicalBall='true';ball.dataset.markerPurpose='nominal physical ball';ball.setAttribute('stroke','none');ball.setAttribute('stroke-width',0);}
   for(const circle of circles)if(circle!==ball&&circle!==badge){circle.dataset.markerPurpose=circle.getAttribute('fill')==='transparent'?'hit target, not ball diameter':'outcome halo, not ball diameter';circle.classList.add(circle.getAttribute('fill')==='transparent'?'obc-hit-target':'obc-outcome-halo');}
   if(badge&&color){g.style.setProperty('--pitch-call',color);badge.replaceWith(svg('rect',{x:Number(badge.getAttribute('cx'))-14,y:Number(badge.getAttribute('cy'))-14,width:28,height:28,rx:5,fill:'#102b3a',stroke:color,'stroke-width':2,class:'obc-pitch-badge','data-marker-purpose':'pitch number, not ball diameter'}));g.querySelector('text')?.setAttribute('fill','#f4f9ff');}
  }
 }
 const rows=data?.plays||[];c.style.setProperty('--pitch-columns',String(Math.max(1,Math.min(3,rows.length))));for(const [i,b] of [...c.querySelectorAll('.obc-chip')].entries()){
  const p=rows.find(p=>String(p.id)===b.dataset.trackerPlay)||rows.slice(-3)[i];if(!p)continue;
  const dot=b.querySelector('.obc-dot'),head=b.querySelector('.obc-chip-head'),label=head.querySelector('b'),details=b.querySelector('.obc-chip-detail');
  dot.textContent=window.TelevisionTrackers.pitchIdentity(p,rows[rows.indexOf(p)-1],rows.indexOf(p)+1).number;dot.classList.add('obc-pitch-dot');label.textContent=(p.pitch_type||'Pitch').replace(/four-seam (fb|fastball)/i,'4-Seam').replace(/two-seam (fb|fastball)/i,'2-Seam');
  const speed=node('strong','obc-chip-speed',Number.isFinite(p.mph)?Math.round(p.mph)+' MPH':'');head.after(speed);details.textContent=window.TelevisionTrackers.pitchCall(p,rows[rows.indexOf(p)-1]);
 }
 controls(c);if(data)artwork(c,data);
 const stamp=inspectionStamp(data),binding=data&&typeof data==='object'?pendingBinding.get(data):null;if(binding)pendingBinding.delete(data);if(stamp&&scope)cardInspectionState.set(c,{stamp,scope,api,binding});
 const previous=data&&typeof data==='object'?pendingInspection.get(data):null;if(previous){pendingInspection.delete(data);queueMicrotask(()=>{if(c.isConnected&&previous.body.contains(c)&&previous.api===window.ApiClient&&window.OrbitalTrackerOwnership?.accepts(previous.scope)&&sameInspectionBinding(binding,previous.binding)&&inspectionStamp(data)===previous.stamp){if(previous.id)inspect(previous.id);window.OrbitalBatterHistory?.restoreView(c,previous.history);}});}
 return c;
};
function watchArt(event){
 const art=node('span','otv-watch-art');art.setAttribute('aria-hidden','true');
 for(const side of ['away','home']){const team=(event.teams||[]).find(t=>t.side===side),url=window.OrbitalTeamArt?.[event.league+'|'+team?.name]?.url;if(!/^https:\/\/a\.espncdn\.com\//.test(url||''))continue;const image=node('img','');image.src=url;image.alt='';image.onerror=()=>image.hidden=true;art.append(image);}
 const play=node('span','otv-watch-play');play.append(svg('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},''));play.firstChild.append(svg('path',{d:'M8 5 L19 12 L8 19 Z',fill:'currentColor'}));art.append(play);return art;
}
function baseballRecent(section,data){
 section.classList.add('osr-baseball-center');
 const latest=(data.plays||[]).at(-1),T=window.TelevisionTrackers,count=section.querySelector('.obc-count-copy>strong')?.textContent||'—';scoreHeader(section,data,Number.isInteger(latest?.period)?'Inning '+latest.period:'Game center',count+' count');
 const details=section.querySelector('.otv-tracker-details'),cutoff=Math.max(...(data.plays||[]).map(p=>Number.isFinite(p.at)?p.at:-Infinity));
 const recent=(data.recent||[]).filter(p=>Number.isFinite(p.at)&&p.at<=cutoff&&typeof p.text==='string'&&p.text.trim()).slice(-3).reverse();
 if(!details)return section;
 if(!recent.length)return window.OrbitalBatterHistory?.decorate(section,data)||section;
 details.append(node('h4','otv-panel-label otv-recent-heading','Recent plays'));
 const list=node('ol','otv-baseball-history');for(const p of recent){const row=node('li','');row.append(node('small','',p.inning||'Reported play'),node('span','',p.text));list.append(row);}details.append(list);return window.OrbitalBatterHistory?.decorate(section,data)||section;
}
function teamArt(team,league){return window.OrbitalTeamArt?.[league+'|'+team?.name]?.url||team?.logo||team?.url;}
function footballOverlay(card,data){
 const T=window.TelevisionTrackers,state=T.footballState(data),opponent=(data.teams||[]).find(t=>String(t.id)!==String((state.drive||state.team)?.id));
 const owner=card.querySelector('.otc-identity'),toward=opponent?.abbreviation||opponent?.abbr;
 const ownerTitle=owner.querySelector('strong'),abbr=(state.drive||state.team)?.abbreviation||(state.drive||state.team)?.abbr;if(abbr){for(const text of [...ownerTitle.childNodes].filter(n=>n.nodeType===3)){const full=node('span','otc-owner-full',text.textContent);text.replaceWith(full);}ownerTitle.append(node('span','otc-owner-short',abbr+' ball'));}
 if(toward){const direction=node('span','otc-direction');direction.append(node('span','otc-direction-arrow','→'),node('span','','toward '+toward));owner.querySelector('strong').append(direction);}
 const legend=node('div','otc-field-key');for(const [label,color] of [['Gain','#62dec0'],['Loss','#f7788f'],['No gain','#bdced9'],['Turnover','#efc272']]){const item=node('span',''),dot=node('i','');dot.style.background=color;item.append(dot,document.createTextNode(label));legend.append(item);}card.querySelector('.otc-field').after(legend);
 const last=(data.plays||[]).filter(p=>p?.text).at(-1);if(last){const label=node('strong','otc-play-situation');const n=Number(last.down),distance=last.distance;label.textContent=n>=1&&n<=4&&Number.isFinite(distance)?n+(['th','st','nd','rd'][n]||'th')+' & '+(distance===0?'Goal':distance):T.footballLabel(last);card.querySelector('.otc-latest>.otc-label').after(label);}
 const admitted=(data.plays||[]).filter(p=>p&&typeof p.text==='string'&&p.text.trim()),prior=admitted.slice(-8,-1).reverse();
 if(prior.length){const recent=node('section','otc-recent-plays');recent.append(node('h4','','Recent plays'));const list=node('ol','');for(const play of prior){const row=node('li','');row.append(node('strong','',T.footballLabel(play)),node('span','',play.text));list.append(row);}recent.append(list);if(admitted.length>8)recent.append(node('small','',admitted.length-8+' earlier plays · Open Details for the full drive'));card.querySelector('.otc-latest').after(recent);}
}
function footballCenterLayout(section,data){
 const T=window.TelevisionTrackers,state=T.footballState(data),scope=window.OrbitalTrackerOwnership?.capture(),api=window.ApiClient;
 section.classList.add('osr-football-center');
 const heading=section.querySelector('.otv-football-heading'),stateRow=section.querySelector('.otv-football-state'),visual=section.querySelector('.otv-football-visual'),details=section.querySelector('.otv-tracker-details');
 heading.querySelector('h3').textContent='Current drive';
 const metrics=section.querySelector('.otv-drive-metrics');metrics?.classList.add('osr-drive-numbers');
 const rows=T.footballRows(data).filter(p=>p&&typeof p.text==='string'&&p.text),latest=rows.at(-1),team=state.drive||state.team;
 if(team){const ball=node('div','osr-situation-tile'),art=teamArt(team,data.league);ball.append(node('small','','Possession'));const value=node('strong','');if(/^https:\/\/a\.espncdn\.com\//.test(art||'')){const img=node('img','');img.src=art;img.alt='';value.append(img);}value.append(document.createTextNode(team.abbreviation||team.name));ball.append(value);stateRow.append(ball);}
 if(latest){const last=node('div','osr-situation-tile');last.append(node('small','','Latest play'),node('strong','',T.footballKind(latest)+(Number.isFinite(T.footballYards(latest))?' '+(T.footballYards(latest)>0?'+':'')+T.footballYards(latest)+' yds':'')));stateRow.append(last);}
 if(visual){const chart=visual.querySelector('svg');if(chart)chart.classList.add('osr-perspective-field');
  const markers=visual.querySelector('.otv-football-markers');if(markers){markers.replaceChildren();const possession=node('strong','',team?(team.name||team.abbreviation)+' ball':'Drive position');markers.append(possession,node('span','osr-direction','→'));const target=(data.teams||[]).find(t=>String(t.id)!==String(team?.id));if(target)markers.append(node('span','','toward '+(target.abbreviation||target.name)));markers.append(node('span','osr-field-note','Current spot · First down'));}
 }
 if(details&&latest){
  const latestPanel=node('section','osr-latest-panel'),recentPanel=node('section','osr-recent-panel');latestPanel.append(node('h4','','Latest play'));recentPanel.append(node('h4','','Recent plays'));
  const liveList=details.querySelector(':scope>.otv-tracker-plays'),first=liveList?.firstElementChild;
  if(first){latestPanel.append(first);const b=first.querySelector('button'),copy=b?.querySelector('.otv-tracker-play-copy');if(copy){const art=node('span','osr-team-play-art');const url=teamArt(team,data.league);if(/^https:\/\/a\.espncdn\.com\//.test(url||'')){const image=node('img','');image.src=url;image.alt='';art.append(image);}copy.before(art);}}
  if(liveList){for(const li of liveList.children){const p=rows.find(p=>String(p.id)===li.dataset.footballPlayId),b=li.querySelector('button'),copy=b?.querySelector('.otv-tracker-play-copy');if(!p||!copy)continue;const full=copy.querySelector('span');if(full)full.textContent=T.footballKind(p)+(Number.isFinite(T.footballYards(p))?' '+(T.footballYards(p)>0?'+':'')+T.footballYards(p):'');}recentPanel.append(liveList);}
  const prior=details.querySelector('.otv-earlier-plays'),reset=details.querySelector(':scope>.otv-category');if(prior)recentPanel.append(prior);if(reset){reset.classList.add('osr-reset-drive');recentPanel.prepend(reset);}details.replaceChildren(latestPanel,recentPanel);
 }
 scoreHeader(section,data,state.clock||'—',state.down||'Reported situation');
 return section;
}
function scoreHeader(section,data,headline,context){
 const scope=window.OrbitalTrackerOwnership?.capture(),api=window.ApiClient;
 queueMicrotask(()=>{if(!section.isConnected||api&&window.ApiClient!==api||scope&&!window.OrbitalTrackerOwnership.accepts(scope))return;const dialog=section.closest('.otv-gc-page'),header=dialog?.querySelector(':scope>.otv-game-header');if(!header)return;let center=header.querySelector('.osr-score-context');if(!center){center=node('div','osr-score-context');{const pair=header.querySelector('.otv-team-pair');pair?.append(center);pair?.classList.add('has-score-context');}}if(data.state==='final'||dialog.dataset.gameState==='final'){const fin=/^final/i.test(String(data.status||''))?String(data.status):'Final';center.replaceChildren(node('strong','',fin));center.classList.add('is-final');}else center.replaceChildren(node('small','',data.held?'Your feed position':'Reported'),node('strong','',headline),node('span','',context));dialog.classList.add('osr-game-center');const watch=dialog.querySelector('.otv-watch-art');if(data.kind==='football'&&watch&&window.OrbitalSportsBroadcastPreview&&!watch.querySelector('.osr-broadcast-preview')){const img=node('img','osr-broadcast-preview');img.src=window.OrbitalSportsBroadcastPreview;img.alt='';watch.prepend(img);watch.classList.add('has-broadcast-preview');}});
}
window.OrbitalSportsGlass={decorateDrive,icon,watchArt,baseballRecent,inlinePitchChoice,presentationActors,inspectionStamp,captureInspection,inspectionBinding,sameInspectionBinding};
const render=window.TelevisionTrackers.render;
window.TelevisionTrackers.render=(data,options={})=>{
 const result=render(data,options);if(data?.kind!=='football'||options.compact)return result;
 const metrics=result.querySelector('.otv-drive-metrics')||node('div','otv-drive-metrics');if(!metrics.children.length){
  const T=window.TelevisionTrackers,drive=T.footballRows(data).filter(p=>T.footballKind(p)!=='Kickoff'),gains=drive.filter(p=>!['FG','PAT','Punt','INT','Fumble'].includes(T.footballKind(p))),yards=gains.map(p=>T.footballYards(p));
  const values=drive.length?[['Plays',drive.length],...(yards.every(Number.isFinite)?[['Yards',yards.reduce((a,b)=>a+b,0)]]:[])]:[];
  for(const [label,value] of values){const n=node('div','');n.append(node('strong','',value),node('small','',label));metrics.append(n);}if(values.length&&!metrics.isConnected)result.querySelector('.otv-football-state')?.append(metrics);
 }
 return footballCenterLayout(result,data);
};
})();

/* Paints an already bound historical field. This module never chooses a player. */
(()=>{'use strict';
 const cache=new Map(),finite=Number.isFinite;
 function decode(payload,kind){
  try{const n=payload.sampling.nx,m=payload.sampling.nz,metric=payload.metrics[kind];if(n!==33||m!==37||!metric||payload.measurement_plane!=='middle_of_plate'||payload.perspective!=='catcher'||payload.prediction!==false)return null;
   const raw=atob(metric.rates_u16le_base64),mask=atob(metric.valid_lsb0_base64);if(raw.length!==n*m*2||mask.length!==Math.ceil(n*m/8))return null;
   const values=new Float64Array(n*m),valid=new Uint8Array(n*m);for(let i=0;i<values.length;i++){valid[i]=(mask.charCodeAt(i>>3)>>(i&7))&1;values[i]=(raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8))/65535;}return {n,m,values,valid};
  }catch{return null;}
 }
 function rgb(value,kind){const low=kind==='contact'?.45:.15,span=kind==='contact'?.5:.55,t=Math.min(1,Math.max(0,(value-low)/span));const stops=[[39,85,115],[111,105,139],[214,171,105]],a=t<.5?stops[0]:stops[1],b=t<.5?stops[1]:stops[2],f=t<.5?t*2:(t-.5)*2;return a.map((v,i)=>Math.round(v+(b[i]-v)*f));}
 function raster(payload,perspective,kind){
  const grid=decode(payload,kind);if(!grid||!['pitcher','catcher'].includes(perspective))return null;
  const metric=payload.metrics[kind],key=JSON.stringify([perspective,kind,metric.rates_u16le_base64,metric.valid_lsb0_base64]);if(cache.has(key)){const hit=cache.get(key);cache.delete(key);cache.set(key,hit);return hit;}
  const canvas=document.createElement('canvas');canvas.width=165;canvas.height=185;const ctx=canvas.getContext('2d');if(!ctx)return null;const pixels=ctx.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
   const u=(perspective==='pitcher'?canvas.width-1-x:x)/(canvas.width-1)*(grid.n-1),v=y/(canvas.height-1)*(grid.m-1),a=Math.min(grid.n-2,Math.floor(u)),b=Math.min(grid.m-2,Math.floor(v)),fx=u-a,fy=v-b,indices=[b*grid.n+a,b*grid.n+a+1,(b+1)*grid.n+a,(b+1)*grid.n+a+1];
   if(indices.some(i=>!grid.valid[i]))continue;const weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy],rate=indices.reduce((s,i,k)=>s+grid.values[i]*weights[k],0),color=rgb(rate,kind),pos=(y*canvas.width+x)*4;
   pixels.data.set([...color,255],pos);
  }
  ctx.putImageData(pixels,0,0);const url=canvas.toDataURL('image/png');cache.set(key,url);if(cache.size>12)cache.delete(cache.keys().next().value);return url;
 }
 function paint(card,data,kind='contact'){
  const chart=card?.querySelector('.obc-zone svg');if(!chart)return false;chart.querySelector('.obh-pitch-layer')?.remove();delete card.dataset.historyIntegrated;const caption=card.querySelector('.obc-zone>small');if(caption?.dataset.baseCaption)caption.textContent=caption.dataset.baseCaption;
  const binding=window.OrbitalHistoricalSurface?.forData(data),p=binding?.payload,z=p?.domain,view=binding?.display_perspective;if(!p||!z||!['pitcher','catcher'].includes(view)||![z.x_min_ft,z.x_max_ft,z.z_min_ft,z.z_max_ft].every(finite)||z.x_max_ft<=z.x_min_ft||z.z_max_ft<=z.z_min_ft)return false;
  const texture=raster(p,view,kind),outline=chart.querySelector('rect');if(!texture||!outline)return false;const width=data.field?.physical_width,height=data.field?.physical_height;if(width!==10||height!==10)return false;
  const svgW=600,svgH=600*height/width,x=(5+(view==='pitcher'?-z.x_max_ft:z.x_min_ft))/width*svgW,y=(8-z.z_max_ft)/height*svgH,w=(z.x_max_ft-z.x_min_ft)/width*svgW,h=(z.z_max_ft-z.z_min_ft)/height*svgH;
  const image=document.createElementNS('http://www.w3.org/2000/svg','image');for(const [key,value] of Object.entries({x,y,width:w,height:h,href:texture,class:'obh-pitch-layer',preserveAspectRatio:'none','aria-hidden':'true','data-history-metric':kind}))image.setAttribute(key,value);image.style.pointerEvents='none';outline.after(image);card.dataset.historyIntegrated='true';if(caption){caption.dataset.baseCaption??=caption.textContent;caption.textContent=({contact:'Contact',power:'Power',hits:'Hit'}[kind]||'Batter')+' history · '+(view==='pitcher'?'pitcher’s':'catcher’s')+' view';}return true;
 }
 window.OrbitalBatterSurface={decode,rgb,raster,paint};
})();

/* Optional historical enrichment. It cannot select a batter or advance a pitch. */
(()=>{'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
 const names=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
 const kinds={contact:{label:'Contact',unit:'contact / swings'},power:{label:'Power',unit:'hard-hit / batted balls with exit velocity'},hits:{label:'Hits',unit:'hits / batted balls'}};
 const validCounts=c=>!!c&&Number.isSafeInteger(c.sample)&&c.sample>=0&&c.sample<=1000000&&Number.isSafeInteger(c.success)&&c.success>=0&&c.success<=c.sample;
 const rate=c=>validCounts(c)&&c.sample>0?c.success/c.sample:null;
 const text=(v,max=120)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 const actorId=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9][0-9]{0,9}$/.test(v)?v:null;
 function reachedBatter(data){
  const last=data.plays.at(-1);if(!last||last.id==null)return null;
  if(data.summary?.scope==='previous_at_bat'){
   if(data.reported_source!=='MLB')return null;
   const start=(Array.isArray(data.timeline)?data.timeline:[]).findLast(p=>p?.stage==='at_bat_start'),actor=start?.batter;
   if(!actorId(actor?.id)||!text(actor?.name))return null;
   const declared=data.situation?.batter;
   if(declared&&typeof declared==='object'&&(actorId(declared.id)!==actorId(actor.id)||!text(declared.name)||names(declared.name)!==names(actor.name)))return null;
   return actor;
  }
  const matching=(Array.isArray(data.timeline)?data.timeline:[]).filter(p=>p&&String(p.id)===String(last.id));
  const candidates=[last,...matching].filter(p=>p.batter!=null),actors=candidates.map(p=>p.batter);
  if(!actors.length||actors.some(a=>!actorId(a?.id)||!text(a?.name)||actorId(a.id)!==actorId(actors[0].id)||names(a.name)!==names(actors[0].name)))return null;
  return actors[0];
 }
 function profileFor(data){
  try{
   if(!data||!Array.isArray(data.plays)||!data.plays.length)return null;
   const h=data.batter_history,p=h?.profile,actor=reachedBatter(data),shown=window.TelevisionBaseballCard.actors(data).names[1],earliest=Math.min(...data.plays.map(row=>Number.isFinite(row?.at)?row.at:Infinity));
   if(!p||!actor||h.event_id!==String(data.event_id)||actorId(p.batter_id)!==actorId(actor.id)||actorId(h.reached_batter_id)!==actorId(actor.id)||!text(shown)||!text(h.reached_batter_name)||!text(p.batter_name)||names(shown)!==names(actor.name)||names(actor.name)!==names(h.reached_batter_name)||names(actor.name)!==names(p.batter_name)||!Number.isFinite(earliest)||Date.parse(p.dataset_as_of)/1000>earliest)return null;
   if(p.schema!==1||p.prediction!==false||p.perspective!=='catcher'||p.measurement_plane!=='middle_of_plate'||!Array.isArray(p.cells)||p.cells.length!==9||!Number.isFinite(Date.parse(p.dataset_as_of))||!Number.isInteger(p.minimum_color_sample)||p.minimum_color_sample<20||p.minimum_color_sample>1000000||!Number.isSafeInteger(p.summary?.pitches)||p.summary.pitches<0||p.summary.pitches>1000000||!text(p.display_name)||!text(p.period)||!/^\d{4}-\d{2}-\d{2}$/.test(p.last_game)||!Number.isFinite(Date.parse(p.last_game))||Date.parse(p.last_game)>Date.parse(p.dataset_as_of))return null;
   if(Object.keys(kinds).some(k=>!text(p.definitions?.[k],240)||!validCounts(p.summary[k])||p.summary[k].sample>p.summary.pitches))return null;
   if(p.cells.some((c,i)=>!c||c.index!==i||!Number.isSafeInteger(c.pitches)||c.pitches<0||c.pitches>p.summary.pitches||Object.keys(kinds).some(k=>!validCounts(c[k])||c[k].sample>c.pitches)))return null;
   if(data.field?.perspective!=null&&data.field.perspective!==p.perspective&&!(data.field.coordinate_perspective===p.perspective&&['pitcher','catcher'].includes(data.field.perspective))||data.field?.measurement_plane!=null&&data.field.measurement_plane!==p.measurement_plane)return null;
   return p;
  }catch{return null;}
 }
 function overlayEligible(data,p){return data?.field?.source==='mlb'&&data.field.perspective===p.perspective&&data.field.measurement_plane===p.measurement_plane&&data.field.zone?.approximate===false;}
 const displayPerspective=data=>['pitcher','catcher'].includes(data?.field?.perspective)?data.field.perspective:'catcher';
 const displayCells=(p,data)=>displayPerspective(data)==='pitcher'?p.cells.map((_,i)=>p.cells[Math.floor(i/3)*3+2-i%3]):p.cells;
 const position=(cells,index)=>{const i=cells.findIndex(c=>c.index===index);return ['Upper','Middle','Lower'][Math.floor(i/3)]+' '+['left','center','right'][i%3];};
 const cardViews=new WeakMap();
 function historicalCard(card,p,data){
  const live=card.querySelector('.obc-main'),nav=el('div','obh-card-view'),liveButton=el('button','','Back to pitches'),historyButton=el('button','','Batter history ›'),main=el('section','obh-card-main'),grid=el('div','obh-compact-grid'),copy=el('div','obh-card-values'),caption=el('small','obh-card-caption');
  const cells=displayCells(p,data),view=displayPerspective(data);let mode='live',metric='contact',selected=4;nav.setAttribute('role','group');nav.setAttribute('aria-label','Pitch tracker display');grid.setAttribute('role','group');grid.setAttribute('aria-label','Historical batter zones');liveButton.type=historyButton.type='button';main.hidden=true;
  const choose=value=>{mode=value==='history'?'history':'live';card.dataset.batterView=mode;live.hidden=mode==='history';main.hidden=mode!=='history';liveButton.hidden=mode!=='history';historyButton.hidden=mode==='history';if(mode==='history')main.before(nav);else card.querySelector('.obc-zone').append(nav);card.classList.toggle('obh-history-mode',mode==='history');liveButton.setAttribute('aria-pressed',String(mode==='live'));historyButton.setAttribute('aria-pressed',String(mode==='history'));card.querySelector('.obc-count-copy>small').textContent=mode==='history'||card.dataset.inspectedPitch?'Live count':'Count';};
  const controls=buttons(key=>{metric=key;paint();});
  function paint(){
   window.OrbitalBatterSurface?.paint(card,data,metric);
   card.dataset.batterMetric=metric;for(const b of controls.children)b.setAttribute('aria-pressed',String(b.dataset.heatMetric===metric));
   for(const [i,b] of [...grid.children].entries()){const c=cells[i],bg=color(c,metric,p.minimum_color_sample);b.style.background=bg;b.style.color=textColor(bg);b.textContent=c[metric].sample<p.minimum_color_sample?'—':percent(c[metric]);b.setAttribute('aria-pressed',String(c.index===selected));b.setAttribute('aria-label',position(cells,c.index)+': '+kinds[metric].label+' '+percent(c[metric])+', '+c[metric].success+' of '+c[metric].sample);}
   const cell=p.cells[selected];copy.replaceChildren(el('small','obh-card-selected',position(cells,selected)+' · '+view+'’s view'));for(const [key,k] of Object.entries(kinds)){const row=el('div','');row.append(el('small','',k.label),el('strong','',percent(cell[key])),el('span','',cell[key].success+'/'+cell[key].sample));row.title=p.definitions[key]+(cell[key].sample<p.minimum_color_sample?' Small sample.':'');copy.append(row);}caption.textContent='History · '+p.period+' · '+p.minimum_color_sample+' samples for color';
  }
  for(const cell of cells){const b=el('button','','');b.type='button';b.onclick=()=>{selected=cell.index;paint();};grid.append(b);}
  liveButton.onclick=()=>choose('live');historyButton.onclick=()=>choose('history');nav.append(liveButton,historyButton);main.append(grid,copy,controls,caption);live.after(main);card.querySelector('.obc-zone').append(nav);paint();choose('live');
  cardViews.set(card,{restore:value=>{if(kinds[value.metric])metric=value.metric;if(Number.isInteger(value.zone)&&value.zone>=0&&value.zone<9)selected=value.zone;paint();choose(value.mode);},state:()=>({mode,metric,zone:selected})});return card;
 }
 const viewState=card=>cardViews.get(card)?.state()||null;
 const restoreView=(card,value)=>{if(value)cardViews.get(card)?.restore(value);};
 const color=(cell,kind,minimum)=>{const r=rate(cell?.[kind]);if(r===null||cell[kind].sample<minimum)return '#254152';const t=Math.min(1,Math.max(0,(r-(kind==='contact'?.45:.15))/(kind==='contact'?.5:.55))),stops=[[38,72,103],[91,78,132],[190,139,86]],a=t<.5?stops[0]:stops[1],b=t<.5?stops[1]:stops[2],f=t<.5?t*2:(t-.5)*2;return `rgb(${a.map((n,i)=>Math.round(n+(b[i]-n)*f)).join(',')})`;};
 const percent=c=>rate(c)===null?'—':Math.round(rate(c)*100)+'%';
 const textColor=background=>{const rgb=background.match(/^rgb\((\d+),(\d+),(\d+)\)$/);if(!rgb)return '#fff';const c=rgb.slice(1).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722>.179?'#000':'#fff';};
 function buttons(onChange){const group=el('div','obh-metrics');group.setAttribute('role','group');group.setAttribute('aria-label','Batter zone metric');for(const [key,k] of Object.entries(kinds)){const b=el('button','',k.label);b.type='button';b.dataset.heatMetric=key;b.setAttribute('aria-pressed',String(key==='contact'));b.onclick=()=>onChange(key);group.append(b);}return group;}
 function layer(card,data,kind){return window.OrbitalBatterSurface?.paint(card,data,kind)||false;}
 const create=window.TelevisionBaseballCard.create;
 window.TelevisionBaseballCard.create=(data,options={})=>{
  const card=create(data,options);layer(card,data,'contact');const p=profileFor(data);if(!p)return card;return typeof options.onDetails==='function'?historicalCard(card,p,data):card;
 };
 function decorate(section,data){
  const p=profileFor(data),details=section.querySelector('.otv-tracker-details');if(!details)return section;for(const b of details.querySelectorAll(':scope>button[data-play-id]')){const row=(data.plays||[]).find(p=>String(p.id)===b.dataset.playId);if(!row)continue;const T=window.TelevisionTrackers,identity=T.pitchIdentity(row,null,row.number);b.classList.add('obh-sequence-row');b.replaceChildren(el('span','obh-sequence-number',identity.number),el('strong','',row.pitch_type||'Pitch'),el('span','obh-sequence-speed',Number.isFinite(row.mph)?Math.round(row.mph)+' MPH':''),el('span','obh-sequence-call',T.pitchCall(row)));}if(!p)return section;
  const existing=[...details.childNodes],nav=el('div','obh-view-tabs'),atbat=el('button','','At-bat'),zones=el('button','','Batter history'),original=el('div','obh-atbat'),panel=el('section','obh-history');original.append(...existing);
  atbat.type=zones.type='button';atbat.setAttribute('aria-pressed','false');zones.setAttribute('aria-pressed','true');original.hidden=true;
  const choose=show=>{original.hidden=show;panel.hidden=!show;atbat.setAttribute('aria-pressed',String(!show));zones.setAttribute('aria-pressed',String(show));};atbat.onclick=()=>choose(false);zones.onclick=()=>choose(true);nav.append(atbat,zones);
  panel.append(el('h4','',p.display_name+' · batter zones'),el('p','obh-period',p.period+' · '+p.summary.pitches.toLocaleString()+' pitches'));
  const cells=displayCells(p,data),view=displayPerspective(data);let metric='contact',selected=4;const grid=el('div','obh-grid'),values=el('div','obh-values'),label=el('p','obh-selected'),legend=el('div','obh-scale'),note=el('p','obh-note');grid.setAttribute('role','group');grid.setAttribute('aria-label','Select a historical strike-zone area');
  const controls=buttons(key=>{metric=key;paint();for(const b of controls.children)b.setAttribute('aria-pressed',String(b.dataset.heatMetric===key));layer(section.querySelector('.otv-baseball-card'),data,key);});
  section.addEventListener('battermetricchange',event=>{if(!kinds[event.detail])return;metric=event.detail;paint();for(const b of controls.children)b.setAttribute('aria-pressed',String(b.dataset.heatMetric===metric));});
  const rows=['Upper','Middle','Lower'],columns=['left','center','right'];
  function paint(){
   for(const [i,b] of [...grid.children].entries()){const c=cells[i],n=c[metric].sample,background=color(c,metric,p.minimum_color_sample);b.style.background=background;b.style.color=textColor(background);b.textContent=n<p.minimum_color_sample?'—':percent(c[metric]);b.setAttribute('aria-label',position(cells,c.index)+': '+kinds[metric].label+' '+percent(c[metric])+', '+c[metric].success+' of '+n);b.setAttribute('aria-pressed',String(selected===c.index));}
   const c=p.cells[selected];label.textContent=position(cells,selected)+' · '+view+'’s view';values.replaceChildren();for(const [key,k] of Object.entries(kinds)){const row=el('div','');row.append(el('small','',k.label),el('strong','',percent(c[key])),el('span','',c[key].success+' / '+c[key].sample));row.title=p.definitions[key];if(c[key].sample<p.minimum_color_sample)row.append(el('small','obh-small-sample','Small sample'));values.append(row);}note.textContent=kinds[metric].unit+'. Historical results; '+p.minimum_color_sample+' samples needed for color. Through '+p.last_game+'.';
  }
  for(const c of cells){const b=el('button','','');b.type='button';b.onclick=()=>{selected=c.index;paint()};grid.append(b);}legend.append(el('span','','Lower rate'),el('i',''),el('span','','Higher rate'));
  panel.append(controls,grid,legend,label,values,note);details.replaceChildren(nav,original,panel);paint();choose(false);return section;
 }
 window.OrbitalBatterHistory={profileFor,rate,decorate,overlayEligible,viewState,restoreView,displayCells,displayPerspective};
})();

/* Pure CSS replaced-video geometry. The caller owns measurement and clipping audits. */
(function(root){
 'use strict';
 const number='(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
 const scalar=new RegExp('^([+-]?'+number+')(%|px)$','i');
 const fail=reason=>({ok:false,reason});
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 function px(value){
  if(finite(value))return value;
  if(typeof value!=='string')return null;
  const m=value.trim().match(new RegExp('^([+-]?'+number+')px$','i'));
  if(m&&Number.isFinite(Number(m[1])))return Number(m[1]);
  return /^[-+]?0(?:\.0+)?$/.test(value.trim())?0:null;
 }
 function lengthPercentage(token){
  const m=token.match(scalar);
  if(m){const n=Number(m[1]);return Number.isFinite(n)?{percent:m[2]==='%'?n/100:0,pixels:m[2]==='%'?0:n}:null;}
  if(/^[-+]?0(?:\.0+)?$/.test(token))return {percent:0,pixels:0};
  if(!/^calc\([^()]+\)$/i.test(token))return null;
  const body=token.slice(5,-1).replace(/\s+/g,'');
  const terms=body.match(new RegExp('[+-]?'+number+'(?:%|px)','gi'));
  if(!terms||terms.join('')!==body||terms.slice(1).some(t=>!/^[+-]/.test(t)))return null;
  let percent=0,pixels=0;
  for(const term of terms){const part=term.match(scalar);if(!part)return null;const n=Number(part[1]);if(!Number.isFinite(n))return null;if(part[2]==='%')percent+=n/100;else pixels+=n;}
  return Number.isFinite(percent)&&Number.isFinite(pixels)?{percent,pixels}:null;
 }
 const center=()=>({percent:.5,pixels:0});
 function component(token,axis){
  if(token==='center')return center();
  if(token===(axis==='x'?'left':'top'))return {percent:0,pixels:0};
  if(token===(axis==='x'?'right':'bottom'))return {percent:1,pixels:0};
  return lengthPercentage(token);
 }
 function parseObjectPosition(value){
  if(typeof value!=='string')return null;
  const text=value.trim().toLowerCase(),tokens=text.match(/calc\([^()]+\)|[^\s]+/g)||[];
  if(tokens.join(' ')!==text.replace(/\s+/g,' '))return null;
  if(tokens.length===1){
   const t=tokens[0];
   if(t==='top'||t==='bottom')return {x:center(),y:component(t,'y')};
   const x=component(t,'x');return x?{x,y:center()}:null;
  }
  if(tokens.length===2){
   let [x,y]=tokens;
   if((x==='top'||x==='bottom')&&['left','right','center'].includes(y)||x==='center'&&['left','right'].includes(y))[x,y]=[y,x];
   const cx=component(x,'x'),cy=component(y,'y');return cx&&cy?{x:cx,y:cy}:null;
  }
  if(tokens.length<3||tokens.length>4)return null;
  const groups=[];
  for(let i=0;i<tokens.length;i++){
   const edge=tokens[i];if(!['left','right','top','bottom','center'].includes(edge))return null;
   let offset=null;if(i+1<tokens.length)offset=lengthPercentage(tokens[i+1]);
   if(offset){if(edge==='center')return null;i++;}
   groups.push({edge,offset});
  }
  if(groups.length!==2)return null;
  let x=null,y=null;
  for(const group of groups){
   const {edge,offset}=group;
   if(edge==='center')continue;
   const axis=['left','right'].includes(edge)?'x':'y',far=['right','bottom'].includes(edge);
   const pos=offset?{percent:far?1-offset.percent:offset.percent,pixels:far?-offset.pixels:offset.pixels}:component(edge,axis);
   if(axis==='x'){if(x)return null;x=pos;}else{if(y)return null;y=pos;}
  }
  if(groups.some(g=>g.edge==='center')){if(!x)x=center();else if(!y)y=center();else return null;}
  return x&&y?{x,y}:null;
 }
 function axisAlignedTransforms(chain){
  if(!Array.isArray(chain))return false;
  for(const style of chain){
   if(!style||typeof style!=='object')return false;
   if(['transform','rotate','scale','perspective'].some(key=>typeof style[key]!=='string'||!style[key].trim()))return false;
   if(style.perspective&&style.perspective!=='none')return false;
   if(style.rotate&&style.rotate!=='none'&&!/^(?:[xyz]\s+)?[-+]?0(?:\.0+)?(?:deg|rad|grad|turn)$/.test(style.rotate.trim()))return false;
   if(style.scale&&style.scale!=='none'){
    const scales=style.scale.trim().split(/\s+/).map(v=>v.endsWith('%')?Number(v.slice(0,-1))/100:Number(v));
    if(scales.length<1||scales.length>3||scales.some(v=>!Number.isFinite(v)||v<=0))return false;
   }
   const transform=style.transform||'none';if(transform==='none')continue;
   const match=transform.match(/^(matrix|matrix3d)\(([^()]+)\)$/);if(!match)return false;
   const values=match[2].split(',').map(v=>v.trim());
   if(values.some(v=>!new RegExp('^[+-]?'+number+'$','i').test(v)))return false;
   const m=values.map(Number);if(m.some(v=>!Number.isFinite(v)))return false;
   if(match[1]==='matrix'){
    if(m.length!==6||m[0]<=0||m[3]<=0||m[1]!==0||m[2]!==0)return false;
   }else{
    if(m.length!==16||m[0]<=0||m[5]<=0||m[10]<=0||m[15]!==1||[1,2,3,4,6,7,8,9,11].some(i=>m[i]!==0))return false;
   }
  }
  return true;
 }
 function rect(input){
  if(!input||![input.left,input.top,input.width,input.height].every(finite)||input.width<0||input.height<0)return null;
  if(!Number.isFinite(input.left+input.width)||!Number.isFinite(input.top+input.height))return null;
  return {left:input.left,top:input.top,width:input.width,height:input.height,right:input.left+input.width,bottom:input.top+input.height};
 }
 function intersect(a,b){
  const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);
  return rect({left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)});
 }
 function resolveVideoContentRect(input){
  if(!input||!input.style)return fail('missing-measurements');
  const box=rect(input.rect),s=input.style;
  if(!box||box.width<=0||box.height<=0)return fail('empty-element-box');
  if(!finite(input.videoWidth)||!finite(input.videoHeight)||input.videoWidth<=0||input.videoHeight<=0)return fail('unknown-intrinsic-size');
  if(!axisAlignedTransforms(input.transforms))return fail('unsupported-or-unaudited-transform');
  if(input.rectangularClipping!==true||!Array.isArray(input.clipRects))return fail('unknown-clipping');
  const insetKeys=['borderLeftWidth','borderRightWidth','borderTopWidth','borderBottomWidth','paddingLeft','paddingRight','paddingTop','paddingBottom'];
  const inset={};for(const key of insetKeys){const n=px(s[key]);if(n===null||n<0)return fail('unknown-box-insets');inset[key]=n;}
  const usedWidth=px(s.width),usedHeight=px(s.height);
  if(usedWidth===null||usedHeight===null||usedWidth<=0||usedHeight<=0||!['content-box','border-box'].includes(s.boxSizing))return fail('unknown-used-box-size');
  const horizontal=inset.borderLeftWidth+inset.borderRightWidth+inset.paddingLeft+inset.paddingRight;
  const vertical=inset.borderTopWidth+inset.borderBottomWidth+inset.paddingTop+inset.paddingBottom;
  const width=s.boxSizing==='border-box'?usedWidth-horizontal:usedWidth,height=s.boxSizing==='border-box'?usedHeight-vertical:usedHeight;
  if(width<=0||height<=0)return fail('empty-content-box');
  const scaleX=box.width/(width+horizontal),scaleY=box.height/(height+vertical);
  if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY)||scaleX<=0||scaleY<=0)return fail('invalid-measured-axis-scale');
  const contentBox=rect({left:box.left+(inset.borderLeftWidth+inset.paddingLeft)*scaleX,top:box.top+(inset.borderTopWidth+inset.paddingTop)*scaleY,width:width*scaleX,height:height*scaleY});
  if(!contentBox)return fail('nonfinite-content-box');
  const fit=s.objectFit,position=parseObjectPosition(s.objectPosition);
  if(!position)return fail('unsupported-object-position');
  let objectWidth=input.videoWidth,objectHeight=input.videoHeight;
  const contain=Math.min(width/objectWidth,height/objectHeight);
  if(fit==='fill'){objectWidth=width;objectHeight=height;}
  else if(['contain','cover','scale-down'].includes(fit)){
   const scale=fit==='cover'?Math.max(width/objectWidth,height/objectHeight):fit==='scale-down'?Math.min(1,contain):contain;
   objectWidth*=scale;objectHeight*=scale;
  }else if(fit!=='none')return fail('unsupported-object-fit');
  const offsetX=(width-objectWidth)*position.x.percent+position.x.pixels,offsetY=(height-objectHeight)*position.y.percent+position.y.pixels;
  const objectRect=rect({left:contentBox.left+offsetX*scaleX,top:contentBox.top+offsetY*scaleY,width:objectWidth*scaleX,height:objectHeight*scaleY});
  if(!objectRect)return fail('nonfinite-fitted-geometry');
  let visibleRect=intersect(contentBox,objectRect);
  for(const inputClip of input.clipRects){const clip=rect(inputClip);if(!clip)return fail('invalid-clip-rect');visibleRect=intersect(visibleRect,clip);}
  if(visibleRect.width<=0||visibleRect.height<=0)return fail('no-visible-video-content');
  return {ok:true,basis:'measured-video-css-object-fit',contentBox,objectRect,visibleRect,objectFit:fit,position,scaleX,scaleY};
 }
 const api=Object.freeze({resolveVideoContentRect,parseObjectPosition,axisAlignedTransforms});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OrbitalVideoGeometry=api;
})(typeof window!=='undefined'?window:globalThis);

/* Presentation-only tracker placement. Stored v1 positions remain viewport fractions.
   The player viewport supplies manual placement limits, including black margins.
   Size is a preference; a uniform temporary fit can reduce it further in a small picture.
   Upright below-video layout and all game data, timing and camera geometry are unchanged. */
(()=>{'use strict';
const KEY='orbital-tracker-placement-v1',MIN=.6,MAX=1.7;
const SURFACES='#orbital-server-player, #orbital-trackers',COLS='#orbital-server-player .otv-trk-col, #orbital-trackers .otv-trk-col';
const read=()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'null');return v&&typeof v==='object'&&!Array.isArray(v)?{...v,locked:true}:{};}catch{return {};}};
const write=v=>{try{localStorage.setItem(KEY,JSON.stringify(v));}catch{}};
const clampScale=s=>Math.min(MAX,Math.max(MIN,Number(s)||1));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const surfaceOf=col=>col.closest(SURFACES);
const compact=col=>!!col.querySelector('.otv-baseball-card.obc-stage-layout');
const below=col=>surfaceOf(col)?.dataset.mode==='below';
const editable=col=>!below(col)&&state.locked===false;
const viewport=()=>({left:0,top:0,width:innerWidth,height:innerHeight,right:innerWidth,bottom:innerHeight});
let state=read(),bound=null,activeDrag=null,queued=false,watchedVideo=null;
const bindings=new Map();
function resolveVideo(){
 const resolver=window.OrbitalServerPlayerIntegration?.resolveVideo;
 if(typeof resolver==='function'){try{return resolver();}catch{return null;}}
 const videos=[...document.querySelectorAll('video')].filter(v=>{const s=getComputedStyle(v);return v.isConnected&&!v.closest?.('[hidden],[aria-hidden="true"]')&&v.getClientRects?.().length&&s.display!=='none'&&!['hidden','collapse'].includes(s.visibility);});
 return videos.length===1?videos[0]:null;
}
const transformRecord=s=>({transform:s.transform||'none',rotate:s.rotate||'none',scale:s.scale||'none',perspective:s.perspective||'none'});
const inset=(s,k)=>Number.parseFloat(s[k])||0;
function videoBounds(video){
 const fallback={rect:viewport(),basis:'viewport-unavailable-video-geometry'};
 if(!video||!window.OrbitalVideoGeometry)return fallback;
 try{
  const transforms=[],clips=[viewport()];let rectangular=true;
  for(let node=video;node;node=node.parentElement){
   const s=getComputedStyle(node);transforms.push(transformRecord(s));
   if((s.offsetPath&&s.offsetPath!=='none')||(s.clipPath&&s.clipPath!=='none')||(s.maskImage&&s.maskImage!=='none')||(s.webkitMaskImage&&s.webkitMaskImage!=='none')||(s.clip&&s.clip!=='auto')||(s.filter&&s.filter!=='none'))rectangular=false;
   const rounded=['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].some(k=>s[k]&&s[k].split(/\s+/).some(v=>!Number.isFinite(Number.parseFloat(v))||Number.parseFloat(v)!==0));
   if(node===video){if(rounded)rectangular=false;continue;}
   const clipsX=['hidden','clip','scroll','auto'].includes(s.overflowX),clipsY=['hidden','clip','scroll','auto'].includes(s.overflowY),paint=/(?:^|\s)(?:paint|strict|content)(?:\s|$)/.test(s.contain||'');
   if(!clipsX&&!clipsY&&!paint)continue;
   if(rounded)rectangular=false;
   if((s.overflowX==='clip'||s.overflowY==='clip')&&s.overflowClipMargin&&!/^(?:padding-box\s+)?0(?:\.0+)?(?:px)?$/.test(s.overflowClipMargin.trim()))rectangular=false;
   const r=node.getBoundingClientRect(),sx=r.width/node.offsetWidth,sy=r.height/node.offsetHeight;
   if(!finite(sx)||!finite(sy)||sx<=0||sy<=0){rectangular=false;continue;}
   const v=viewport(),left=clipsX||paint?r.left+node.clientLeft*sx:v.left,top=clipsY||paint?r.top+node.clientTop*sy:v.top;
   clips.push({left,top,width:clipsX||paint?node.clientWidth*sx:v.width,height:clipsY||paint?node.clientHeight*sy:v.height});
  }
  const s=getComputedStyle(video),result=window.OrbitalVideoGeometry.resolveVideoContentRect({rect:video.getBoundingClientRect(),videoWidth:video.videoWidth,videoHeight:video.videoHeight,style:s,transforms,rectangularClipping:rectangular,clipRects:clips});
  return result.ok?{rect:result.visibleRect,basis:result.basis}:{...fallback,reason:result.reason};
 }catch{return fallback;}
}
function coordinates(surface,col){
 const own=getComputedStyle(col);
 if(['transform','rotate','scale','translate','offsetPath'].some(k=>own[k]&&own[k]!=='none'))return null;
 const r=surface.getBoundingClientRect(),s=getComputedStyle(surface),sx=r.width/surface.offsetWidth,sy=r.height/surface.offsetHeight;
 const transforms=[];for(let node=surface;node;node=node.parentElement){const style=getComputedStyle(node);if(style.offsetPath&&style.offsetPath!=='none')return null;transforms.push(transformRecord(style));}
 if(!finite(sx)||!finite(sy)||sx<=0||sy<=0||!window.OrbitalVideoGeometry?.axisAlignedTransforms(transforms))return null;
 return {left:r.left+inset(s,'borderLeftWidth')*sx,top:r.top+inset(s,'borderTopWidth')*sy,sx,sy};
}
const ownedProperties=['left','top','right','bottom','height','max-height','justify-content','zoom'];
function clearPlacement(col){for(const p of ownedProperties)col.style.removeProperty(p);const stack=col.querySelector('.otv-trk-stack');for(const p of ['max-height','overflow','flex'])stack?.style.removeProperty(p);col.__placementRect=null;col.__placementScale=null;}
function footprint(col,scale,coords){
 const r=col.getBoundingClientRect(),rx=scale*coords.sx,ry=scale*coords.sy;
 let left=0,top=0,right=Math.max(col.offsetWidth,col.scrollWidth||0),bottom=Math.max(col.offsetHeight,col.scrollHeight||0);
 // Include the visible count and an open absolute settings footer, as well as normal flow.
 for(const n of col.querySelectorAll('.otv-trk-stack > *, .obc-count-band, .obc-players, .obc-history, details[open] .otc-footer, .otv-trk-bar')){
  const b=n.getBoundingClientRect();if(!b.width||!b.height)continue;
  left=Math.min(left,(b.left-r.left)/rx);top=Math.min(top,(b.top-r.top)/ry);right=Math.max(right,(b.right-r.left)/rx);bottom=Math.max(bottom,(b.bottom-r.top)/ry);
 }
 return {left,top,right,bottom,width:right-left,height:bottom-top};
}
function apply(col){
 const surface=surfaceOf(col);if(!surface)return;
 const isBelow=below(col);surface.classList.toggle('otv-trk-placeable',!isBelow);
 if(!editable(col)&&activeDrag?.col===col)activeDrag.stop(false);
 syncControls(col);
 if(isBelow){clearPlacement(col);surface.classList.remove('otv-trk-moved');delete surface.dataset.placementBounds;return;}
 const coords=coordinates(surface,col);if(!coords){clearPlacement(col);surface.classList.remove('otv-trk-moved');surface.dataset.placementBounds='unsupported-tracker-transform';return;}
 const bounds={rect:viewport(),basis:'player-viewport'};surface.dataset.placementBounds=bounds.basis;
 const box=bounds.rect,pad=Math.min(8,box.width/4,box.height/4),availableW=box.width-2*pad,availableH=box.height-2*pad;
 const preferred=clampScale(state.scale??1),stack=col.querySelector('.otv-trk-stack');
 col.style.setProperty('zoom',String(preferred));col.style.setProperty('bottom','auto','important');col.style.setProperty('height','auto','important');col.style.setProperty('max-height','none','important');col.style.setProperty('justify-content','flex-start','important');
 // Measure the complete card instead of a scroll-clipped stack or only its toolbar.
 stack?.style.setProperty('max-height','none','important');stack?.style.setProperty('overflow','visible','important');stack?.style.setProperty('flex','none','important');
 const size=footprint(col,preferred,coords);if(!(size.width>0&&size.height>0&&availableW>0&&availableH>0))return;
 const scale=Math.min(preferred,availableW/(size.width*coords.sx),availableH/(size.height*coords.sy));
 col.style.setProperty('zoom',String(scale));col.__placementScale=scale;
 const minX=box.left+pad-size.left*scale*coords.sx,maxX=box.right-pad-size.right*scale*coords.sx;
 const minY=box.top+pad-size.top*scale*coords.sy,maxY=box.bottom-pad-size.bottom*scale*coords.sy;
 const old=col.getBoundingClientRect(),saved=finite(state.x)&&finite(state.y);
 const requestedX=saved?state.x*innerWidth:surface.dataset.side==='left'?minX:maxX;
 const requestedY=saved?state.y*innerHeight:compact(col)?minY+(maxY-minY)/2:old.top;
 const x=Math.min(Math.max(minX,requestedX),Math.max(minX,maxX)),y=Math.min(Math.max(minY,requestedY),Math.max(minY,maxY));
 // CSS zoom scales absolute offsets; also account for a scaled/offset fullscreen host.
 col.style.setProperty('left',((x-coords.left)/(scale*coords.sx))+'px','important');col.style.setProperty('top',((y-coords.top)/(scale*coords.sy))+'px','important');col.style.setProperty('right','auto','important');
 col.__placementRect={left:x,top:y};surface.classList.add('otv-trk-moved');
}
function setPos(col,x,y){if(!editable(col))return;state={...state,x:x/innerWidth,y:y/innerHeight};apply(col);const p=col.__placementRect;if(p)state={...state,x:p.left/innerWidth,y:p.top/innerHeight};}
function reset(col){if(!editable(col))return;state={};write(state);apply(col);}
const origin=col=>{const r=col.getBoundingClientRect();return {x:r.left,y:r.top};};
function nudge(col,dx,dy){if(!editable(col))return;const o=origin(col);setPos(col,o.x+dx,o.y+dy);write(state);}
function rescale(col,s){if(!editable(col))return;state={...state,scale:clampScale(s)};apply(col);write(state);}
function syncControls(col){
 const isCompact=compact(col),canEdit=editable(col),grip=col.__placementGrip;
 if(col.__placementDone)col.__placementDone.hidden=!canEdit;
 if(grip){grip.disabled=!canEdit;grip.hidden=!canEdit;grip.setAttribute('aria-disabled',String(!canEdit));}
 const handle=col.__placementResize;if(handle){handle.hidden=below(col);handle.style.pointerEvents=canEdit?'':'none';}
 const footer=isCompact?col.querySelector('.obc-stage-layout .obc-compact-controls .otc-footer'):null;
 if(!footer||!col.__placementDrag)return;
 if(!footer.__placementControls){
  const row=document.createElement('div');row.className='otv-trk-placement-controls';row.setAttribute('aria-label','Baseball tracker placement');
  Object.assign(row.style,{display:'flex',flexWrap:'wrap',gap:'4px',width:'100%'});
  const button=(label,help)=>{const b=document.createElement('button');b.type='button';b.className='otc-action';b.textContent=label;b.setAttribute('aria-label',help);row.append(b);return b;};
  const move=button('Move','Move tracker. Drag or use arrow keys; plus and minus resize; R resets.'),smaller=button('Size −','Make tracker smaller'),larger=button('Size +','Make tracker larger'),lock=button('Lock','Lock tracker position and size');
  const current=()=>footer.isConnected&&col.contains(footer)&&compact(col);
  // The capture button is retained when the live card and its footer repaint.
  col.__placementDrag(move,(s,e)=>setPos(col,s.r.left+e.clientX-s.x,s.r.top+e.clientY-s.y),grip);
  move.addEventListener('keydown',e=>{if(current())col.__placementKeys(e);});
  move.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
  move.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();if(current())reset(col);});
  smaller.onclick=()=>{if(current())rescale(col,(state.scale??1)-.1);};larger.onclick=()=>{if(current())rescale(col,(state.scale??1)+.1);};
  lock.onclick=()=>{if(!current())return;state={...state,locked:state.locked===false};write(state);apply(col);};
  footer.__placementControls={move,smaller,larger,lock};footer.append(row);
 }
 const controls=footer.__placementControls;for(const b of [controls.move,controls.smaller,controls.larger])b.disabled=!canEdit;
 controls.lock.textContent=state.locked===true?'Unlock':'Lock';controls.lock.setAttribute('aria-pressed',String(state.locked===true));controls.lock.setAttribute('aria-label',state.locked===true?'Unlock tracker position and size':'Lock tracker position and size');
}
function bind(col){
 if(col.__placement)return;col.__placement=true;
 const grip=document.createElement('button');grip.type='button';grip.className='otv-trk-grip otv-trk-placement-grip';const gripIcon=document.createElement('span'),gripLabel=document.createElement('span');gripIcon.className='otv-trk-grip-icon';gripIcon.textContent='⠿';gripIcon.setAttribute('aria-hidden','true');gripLabel.className='otv-trk-grip-label';gripLabel.textContent='Move';gripLabel.setAttribute('aria-hidden','true');grip.append(gripIcon,gripLabel);grip.title='Drag to move · double-click to reset';grip.setAttribute('aria-label','Move or resize tracker. Arrow keys move, plus and minus resize, R resets.');
 // A dedicated retained grip stays outside quiet chrome and never impersonates a toolbar action.
 col.prepend(grip);col.__placementGrip=grip;const done=document.createElement('button');done.type='button';done.className='otv-trk-move-done otc-action';done.textContent='Done moving';done.onclick=()=>{finishMoving();window.TelevisionSportsPlayerUi?.openSettings();};col.prepend(done);col.__placementDone=done;
 const handle=document.createElement('span');handle.className='otv-trk-resize';handle.title='Drag to resize';handle.setAttribute('aria-hidden','true');col.append(handle);col.__placementResize=handle;
 const drag=(target,onMove,capture=target)=>target.addEventListener('pointerdown',e=>{
  if(e.button!==0||!editable(col)||!col.contains(target))return;e.preventDefault();e.stopPropagation();activeDrag?.stop(false);capture.setPointerCapture?.(e.pointerId);
  const start={x:e.clientX,y:e.clientY,r:col.getBoundingClientRect(),s:clampScale(state.scale??1)};let frame=0,last=e;
  const move=ev=>{if(ev.pointerId!==e.pointerId)return;last=ev;if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(col.isConnected&&editable(col))onMove(start,last);});};
  const stop=(commit=true)=>{capture.removeEventListener('pointermove',move);capture.removeEventListener('pointerup',up);capture.removeEventListener('pointercancel',cancel);capture.removeEventListener('lostpointercapture',cancel);cancelAnimationFrame(frame);frame=0;if(commit&&col.isConnected&&editable(col))onMove(start,last);if(commit)write(state);try{capture.releasePointerCapture?.(e.pointerId);}catch{}surfaceOf(col)?.classList.remove('otv-trk-dragging');if(activeDrag?.stop===stop)activeDrag=null;};
  const up=ev=>{if(ev.pointerId===e.pointerId){last=ev;stop();}},cancel=ev=>{if(ev.pointerId===e.pointerId){stop(false);write(state);}};activeDrag={col,stop};surfaceOf(col)?.classList.add('otv-trk-dragging');
  capture.addEventListener('pointermove',move);capture.addEventListener('pointerup',up);capture.addEventListener('pointercancel',cancel);capture.addEventListener('lostpointercapture',cancel);
 });
 drag(grip,(s,e)=>setPos(col,s.r.left+e.clientX-s.x,s.r.top+e.clientY-s.y));
 drag(handle,(s,e)=>{if(!(s.r.width>0))return;const next=clampScale(s.s*(s.r.width+(e.clientX-s.x))/s.r.width);state={...state,scale:next,x:s.r.left/innerWidth,y:s.r.top/innerHeight};apply(col);});
 grip.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});grip.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();reset(col);});
 const keys=e=>{if(!editable(col))return;const step=e.shiftKey?64:16,k=e.key;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(k)){e.preventDefault();e.stopPropagation();nudge(col,k==='ArrowLeft'?-step:k==='ArrowRight'?step:0,k==='ArrowUp'?-step:k==='ArrowDown'?step:0);}
  else if(k==='+'||k==='='){e.preventDefault();e.stopPropagation();rescale(col,(state.scale??1)+.1);}
  else if(k==='-'||k==='_'){e.preventDefault();e.stopPropagation();rescale(col,(state.scale??1)-.1);}
  else if(k==='r'||k==='R'){e.preventDefault();e.stopPropagation();reset(col);}};
 grip.addEventListener('keydown',keys);col.__placementDrag=drag;col.__placementKeys=keys;
 observeColumn(col);apply(col);
}
function observeColumn(col){
 if(bindings.has(col))return;
 const observer=new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.('.obc-stage-layout')||n.querySelector?.('.obc-stage-layout')))))queue();});
 observer.observe(col,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});bindings.set(col,observer);
}
const resizeWatch=typeof ResizeObserver==='function'?new ResizeObserver(()=>queue()):null;
let resizeNodes=new Set();
function observeResize(nodes){
 if(!resizeWatch)return;const next=new Set(nodes.filter(Boolean));
 // Re-observing an unchanged target schedules a fresh initial ResizeObserver delivery.
 for(const node of resizeNodes)if(!next.has(node))resizeWatch.unobserve(node);
 for(const node of next)if(!resizeNodes.has(node))resizeWatch.observe(node);
 resizeNodes=next;
}
const boundsWatch=new MutationObserver(()=>queue());
function observeVideo(video){
 if(watchedVideo!==video){if(watchedVideo)for(const name of ['loadedmetadata','resize','emptied'])watchedVideo.removeEventListener(name,queue);watchedVideo=video;if(video)for(const name of ['loadedmetadata','resize','emptied'])video.addEventListener(name,queue);}
 boundsWatch.disconnect();for(let node=video;node;node=node.parentElement)boundsWatch.observe(node,{attributes:true,attributeFilter:['class','style','width','height']});
}
function scan(){
 const cols=[...document.querySelectorAll(COLS)];bound=cols.find(col=>surfaceOf(col)?.id==='orbital-server-player')||cols[0]||null;
 document.documentElement.classList.toggle('orbital-tracker-moving',cols.some(editable));
 for(const [col,observer]of bindings)if(!cols.includes(col)){if(activeDrag?.col===col)activeDrag.stop(false);observer.disconnect();bindings.delete(col);}
 const video=resolveVideo();observeVideo(video);const sizes=[video];
 for(const col of cols){if(!col.__placement)bind(col);else{observeColumn(col);apply(col);}sizes.push(col,surfaceOf(col));}
 observeResize(sizes);
 observeRoots();
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;scan();});}
const watch=new MutationObserver(records=>{for(const r of records){if(r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.(SURFACES+', video')||n.querySelector?.(SURFACES+', video')))){queue();return;}}});
function observeRoots(){watch.disconnect();if(document.body)watch.observe(document.body,{childList:true,subtree:true});for(const s of document.querySelectorAll(SURFACES))watch.observe(s,{attributes:true,attributeFilter:['data-mode','data-side','data-enabled']});}
if(document.body)scan();else document.addEventListener('DOMContentLoaded',scan);
document.addEventListener('fullscreenchange',queue);addEventListener('resize',queue);
// A scroll can move/clamp the picture without changing its measured size.
document.addEventListener('scroll',()=>{if(bound)queue();},{capture:true,passive:true});
function finishMoving(){activeDrag?.stop();state={...state,locked:true};write(state);scan();}
window.OrbitalTrackerPlacement={reset:()=>{state={};write(state);scan();},moving:on=>{if(!on){finishMoving();return;}state={...state,locked:false};write(state);scan();bound?.__placementGrip?.focus({preventScroll:true});},size:value=>{state={...state,scale:clampScale(value)};write(state);scan();},state:()=>({...state})};
})();

/* Private additive controller failure diagnostics. No legacy report mutation. */
/* Private diagnostic seam only. Never sends reports, binds gateway routes or ranks feeds. */
(function (root) {
 'use strict';
 function create({getSnapshot, getApiClient, getVideo, cryptoProvider = root.crypto,
  log = row => root.console?.debug?.('[orbital-owned-failure-v1]', row)} = {}) {
  const attempts = new WeakMap(), seen = new WeakSet();
  let sequence = 0;
  const normalize = value => typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '';
  const channel = value => /^[0-9a-f]{32}$/.test(normalize(value)) ? normalize(value) : null;
  const session = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
  const current = attempt => {
   const view = getSnapshot?.();
   return view?.attempt === attempt ? view : null;
  };
  function entry(attempt) {
   let value = attempts.get(attempt);
   if (!value) {
    let seed = null; try { seed = cryptoProvider?.randomUUID?.() || null; } catch {}
    value = {seed, api: getApiClient?.(), video: null, stream: null};
    attempts.set(attempt, value);
   }
   return value;
  }
  function bindVideo({attempt, stream, video} = {}) {
   if (!attempt || typeof attempt !== 'object') return false;
   const view = current(attempt);
   if (!view || !stream || stream !== attempt.stream || !video?.isConnected || getVideo?.() !== video) return false;
   const value = entry(attempt);
   if (value.api !== getApiClient?.()) return false;
   value.video = video; value.stream = stream;
   return true;
  }
  async function fingerprint(value) {
   if (typeof value !== 'string' || !value || !cryptoProvider?.subtle?.digest) return null;
   const bytes = new TextEncoder().encode(value);
   try {
    const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
   } catch { return null; } finally { bytes.fill(0); }
  }
  async function observe(failure) {
   const attempt = failure?.attempt, view = current(attempt);
   if (!view || !attempt || typeof attempt !== 'object' || seen.has(attempt)) return false;
   const phases = ['starting', 'awaiting-frame', 'playing', 'buffering', 'native-started'];
   const codes = ['source', 'buffer_timeout', 'first_frame_timeout', 'capacity'];
   if (!phases.includes(failure.phase) || failure.phase !== view.phase || !codes.includes(failure.error)
    || typeof failure.after_first_frame !== 'boolean' || failure.after_first_frame !== ['playing', 'buffering'].includes(view.phase)
    || failure.channel_id !== attempt.itemId || channel(failure.channel_id) !== channel(view.source?.id)
    || !channel(failure.channel_id) || failure.play_session_id !== (attempt.stream?.playSessionId || null)
    || failure.accepted_open !== (attempt.accepted === true)) return false;
   const value = entry(attempt);
   if (value.api !== getApiClient?.()) return false;
   // A reused channel or video does not bind a new attempt. References must agree.
   const v = value.video;
   let videoBinding = 'unavailable';
   if (v) {
    if (value.stream !== attempt.stream || !v.isConnected || getVideo?.() !== v) videoBinding = 'stale';
    else if (!v.currentSrc || attempt.previousMediaSrc && v.currentSrc === attempt.previousMediaSrc) videoBinding = 'previous_source';
    else videoBinding = 'owned';
   }
   seen.add(attempt);
   const captured = {prefix: 'orbital-owned-failure-v1', kind: 'controller_failure', sequence: ++sequence,
    failure: failure.error, phase: failure.phase, controller_after_frame: failure.after_first_frame,
    accepted_open: failure.accepted_open, video_binding: videoBinding};
   const [attemptFp, channelFp, sessionFp] = await Promise.all([
    fingerprint(value.seed), fingerprint(channel(failure.channel_id)), fingerprint(session(failure.play_session_id))
   ]);
   // This is a captured prior failure; asynchronous hashing never reassigns it.
   const row = Object.freeze({...captured, attempt_fp: attemptFp, channel_fp: channelFp, play_session_fp: sessionFp});
   try { log(row); } catch {}
   return true;
  }
  return Object.freeze({bindVideo, observe});
 }
 const api = Object.freeze({create});
 if (typeof module !== 'undefined' && module.exports) module.exports = api;
 else {
  root.OrbitalOwnedPlaybackFailureDiagnosticsFactory = api;
  const getVideo = () => { const videos = [...root.document.querySelectorAll('video')].filter(v => v.isConnected); return videos.length === 1 ? videos[0] : null; };
  root.OrbitalOwnedPlaybackFailureDiagnostics = create({getSnapshot: () => root.TelevisionPlayback?.snapshot?.(), getApiClient: () => root.ApiClient, getVideo});
 }
})(typeof window !== 'undefined' ? window : globalThis);

/* Windows Firefox AAC decoder compatibility for the exact accepted live attempt.
 * HLS/Open can restore stream-copy after PlaybackInfo. Request AAC conversion on
 * the final manifest URL; video, transport ownership and retirement stay intact. */
(function(root){'use strict';
 const guid=value=>typeof value==='string'&&/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value)?value.replace(/-/g,'').toLowerCase():null;
 const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value;
 const windowsFirefox=ua=>typeof ua==='string'&&/Windows NT\b/i.test(ua)&&/Firefox\/\d+/i.test(ua)&&!/(?:Android|Mobile|Tablet|iPhone|iPad|Chrome\/|Chromium\/|Edg\/|OPR\/)/i.test(ua);
 function rewrite(method,input,environment=root){
  try{
   if(String(method).toUpperCase()!=='GET'||!windowsFirefox(environment.navigator?.userAgent))return input;
   const api=environment.ApiClient,control=environment.TelevisionPlayback,view=control?.snapshot?.(),attempt=view?.attempt,stream=attempt?.stream;
   const user=api?.getCurrentUserId?.(),server=api?.serverId?.(),credential=api?.accessToken?.();
   if(!api||!control||!identifier(user)||!identifier(server)||!identifier(credential)||!attempt?.accepted||attempt.nativeToken||attempt.player?.isLocalPlayer!==true||!stream||control.accepts?.(stream)!==true||!['starting','awaiting-frame','playing','buffering'].includes(view.phase)||view.event?.serverId!==server)return input;
   const item=guid(attempt.itemId),source=stream.mediaSource;
   if(!item||guid(view.source?.id)!==item||view.source?.automatic===true||guid(stream.item?.Id)!==item||stream.item?.Type!=='TvChannel'||!identifier(stream.playSessionId)||!identifier(source?.Id))return input;
   const url=new URL(input,environment.location.href),address=new URL(api.serverAddress(),environment.location.href),prefix=address.pathname.replace(/\/$/,'');
   if(url.origin!==environment.location.origin||address.origin!==url.origin||!/^https?:$/.test(url.protocol)||url.username||url.password||!url.pathname.startsWith(prefix+'/'))return input;
   const match=url.pathname.slice(prefix.length).match(/^\/videos\/([^/]+)\/(?:[^/]+\/)*[^/]+\.m3u8$/i);
   if(!match||guid(match[1])!==item)return input;
   const entries=[...url.searchParams],values=name=>entries.filter(([key])=>key.toLowerCase()===name).map(([,value])=>value),one=name=>{const rows=values(name);return rows.length===1?rows[0]:null;};
   if(one('playsessionid')!==stream.playSessionId||one('mediasourceid')!==source.Id)return input;
   for(const [name,expected,normalize]of [['userid',user,guid],['serverid',server,guid],['deviceid',api.deviceId?.(),v=>v],['api_key',credential,v=>v],['apikey',credential,v=>v],['x-emby-token',credential,v=>v]]){const rows=values(name);if(rows.length&&(rows.length!==1||!identifier(expected)||!normalize(rows[0])||!normalize(expected)||normalize(rows[0])!==normalize(expected)))return input;}
   // The selected input codec is observed source metadata. An output codec query
   // alone cannot establish that an unknown or differently coded source is AAC.
   const audio=Array.isArray(source.MediaStreams)?source.MediaStreams.filter(row=>row?.Type==='Audio'):[],indices=values('audiostreamindex');
   if(indices.length>1||indices.length&&!/^(?:-1|0|[1-9][0-9]*)$/.test(indices[0]))return input;
   if(values('hlsaudiostreamindex').length)return input;
   const selectedIndex=indices.length?Number(indices[0]):Number.isInteger(stream.audioStreamIndex)?stream.audioStreamIndex:source.DefaultAudioStreamIndex;
   if(!Number.isInteger(selectedIndex)||selectedIndex < -1)return input;
   // Jellyfin live single-track metadata uses -1 for both the track and default.
   // Accept only that observed unambiguous shape; never guess among tracks.
   if(selectedIndex===-1&&(audio.length!==1||audio[0].Index!==-1||source.DefaultAudioStreamIndex!==-1))return input;
   const selected=audio.filter(row=>row.Index===selectedIndex);
   if(!selected.length||selected.some(row=>String(row.Codec).toLowerCase()!=='aac'))return input;
   // Recheck account and attempt after reading the request; nothing is deferred.
   const now=control.snapshot?.();
   if(environment.ApiClient!==api||environment.TelevisionPlayback!==control||api.getCurrentUserId()!==user||api.serverId()!==server||api.accessToken()!==credential||now?.attempt!==attempt||now.source?.id!==view.source.id||attempt.stream!==stream||control.accepts(stream)!==true)return input;
   // Retain unrelated query bytes verbatim, including token escaping and order.
   // URLSearchParams is used for validation only, never to reserialize secrets.
   const text=String(input),hashAt=text.indexOf('#'),hash=hashAt<0?'':text.slice(hashAt),body=hashAt<0?text:text.slice(0,hashAt),queryAt=body.indexOf('?'),base=queryAt<0?body:body.slice(0,queryAt),raw=queryAt<0?'':body.slice(queryAt+1),audioKeys=new Set(['audiocodec','allowaudiostreamcopy','allowaudiocopy']);
   const parts=raw?raw.split('&').filter(part=>{try{return !audioKeys.has(decodeURIComponent(part.split('=',1)[0].replace(/\+/g,' ')).toLowerCase());}catch{return true;}}):[];
   parts.push('AllowAudioStreamCopy=false','AudioCodec=aac');
   return base+'?'+parts.join('&')+hash;
  }catch{return input;}
 }
 function install(environment=root){
  const proto=environment.XMLHttpRequest?.prototype,open=proto?.open;
  if(!open||open.orbitalWindowsFirefoxAac)return false;
  const wrapped=function(method,url,...rest){return open.call(this,method,rewrite(method,url,environment),...rest);};
  wrapped.orbitalWindowsFirefoxAac=true;proto.open=wrapped;return true;
 }
 const api=Object.freeze({rewrite,install});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else install(root);
})(typeof window!=='undefined'?window:globalThis);

/* Video dialog open watchdog (Oct 20). Jellyfin's video player waits for its 240 ms
   zoom-in animationend before it sets the video source. A page that is not drawing
   (background tab, hidden window, screen off) never fires that event, so Play hangs with
   no video request, the 20 s first-frame timer moves to another feed, and the stalled
   request later resumes with the old feed. If the open animation is still pending after
   600 ms, cancel it and deliver the end event the player is waiting for. A page that
   draws normally has already finished the animation and is left alone. */
(function(root,install){
 if(typeof module==='object'&&module.exports)module.exports=install;
 else install(root);
})(typeof window==='object'?window:globalThis,function installVideoOpenWatchdog(win){
 'use strict';
 const delay=600;
 if(win.OrbitalVideoOpenWatchdog)return win.OrbitalVideoOpenWatchdog;
 const doc=win.document,NAME='htmlvideoplayer-zoomin',seen=new WeakSet(),stats={released:0};
 const pending=node=>(typeof node.getAnimations==='function'?node.getAnimations():[]).filter(a=>a.animationName===NAME&&a.playState!=='finished'&&a.playState!=='idle');
 const settle=node=>{
  if(seen.has(node))return;seen.add(node);
  win.setTimeout(()=>{
   if(!node.isConnected)return;
   const stuck=pending(node);if(!stuck.length)return;
   for(const a of stuck){try{a.cancel();}catch{}}
   const Event=win.AnimationEvent||win.Event;
   node.dispatchEvent(new Event('animationend',{animationName:NAME}));
   stats.released++;
  },delay);
 };
 const scan=list=>{for(const node of list)if(node?.nodeType===1&&node.classList?.contains('videoPlayerContainer'))settle(node);};
 const start=()=>{
  scan(doc.body.children);
  new win.MutationObserver(records=>{for(const r of records)scan(r.addedNodes);}).observe(doc.body,{childList:true});
 };
 if(doc.body)start();else doc.addEventListener('DOMContentLoaded',start,{once:true});
 return win.OrbitalVideoOpenWatchdog={version:1,stats};
});

/* Orbital web/phone parity with Orbital TV 283 (Oct 20 2026, Claude).
   - My List: one page (preview, All/Movies/Shows, sort, wide cards with progress, remove).
   - Requests: in-app search, request (seasons for shows), your requests. Uses the viewer's linked Seerr
     account through /sports/api/experience/v1 (same rules as Orbital TV); no browser hand-off.
   - Home/Movies/TV rotation: genre rows and picks change every three hours per viewer (same window as the
     server's hero/curated rotation), stable while you move around.
   - One Live page: Live opens the Guide; Programs/Channels tabs are folded into it (Sports stays its own page). */
(function(root,install){
 if(typeof module==='object'&&module.exports)module.exports=install;
 else install(root);
})(typeof window==='object'?window:globalThis,function installParity(win){
 'use strict';
 if(win.OrbitalParity)return win.OrbitalParity;
 const doc=win.document;
 const ROTATION=3*3600*1000;
 const PREFIX='/sports/api/experience/v1';
 function seed(user,salt,now){let h=2166136261>>>0;const s=String(user||'').replace(/-/g,'').toLowerCase()+'|'+Math.floor((now??Date.now())/ROTATION)+'|'+salt;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h;}
 function rng(n){let a=n>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
 function shuffle(list,r){const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 // Front-weighted order: better-ranked entries tend to stay early, but each window differs.
 function weighted(list,r){return list.map((x,i)=>({x,k:Math.pow(r(),1+i*0.15)})).sort((a,b)=>b.k-a.k).map(e=>e.x);}
 const MOVIE_GENRES=['Thriller','Comedy','Adventure','Science Fiction','Action','Horror','Family','Animation','Documentary','Western','Drama','Romance','Crime','Mystery','Fantasy','War','History','Music'];
 const TV_GENRES=['Drama','Comedy','Documentary','Reality','Crime','Animation','Kids','Mystery','Action & Adventure','Sci-Fi & Fantasy','Family','War & Politics','Western'];
 function genres(mode,user,now){const pool=mode==='tv'?TV_GENRES:MOVIE_GENRES;const order=shuffle(pool,rng(seed(user,'genres|'+mode,now)));return [order.slice(0,4),order.slice(4,10)];}
 function rotate(data,mode,user,now){
  if(!data||!user)return data;const r=rng(seed(user,'rows|'+mode,now));const out={...data};
  if(Array.isArray(data.top))out.top=weighted(data.top,r);
  if(Array.isArray(data.series))out.series=weighted(data.series,r);
  if(Array.isArray(data.genres))out.genres=data.genres.map(g=>({...g,items:weighted(g.items||[],r)}));
  return out;
 }

 // ---- shared page helpers ------------------------------------------------------------------
 const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const detailsHref=(api,id)=>'#/details?id='+encodeURIComponent(id)+'&serverId='+encodeURIComponent(api.serverId());
 const cleanName=v=>(win.OrbitalText?.name?.(v))||String(v||'').replace(/\s*\(\d{4}\)\s*$/,'');
 function css(){if(doc.getElementById('orbital-parity-css'))return;const s=el('style');s.id='orbital-parity-css';s.textContent=`
.op-page{padding:clamp(12px,3vw,40px);padding-top:calc(var(--ob5-top,72px) + 8px);color:#f1f5f9;max-width:1680px;margin:0 auto}
.op-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}.op-head h1{margin:0;font-size:clamp(24px,3vw,36px)}
.op-count{color:#94a3b8;font-size:14px}
.op-preview{position:relative;min-height:170px;border-radius:14px;overflow:hidden;margin:14px 0 12px;background:#0f1b2c}
.op-preview img.op-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.45}
.op-preview .op-pv{position:relative;padding:22px 24px;max-width:760px}.op-preview h2{margin:0 0 6px;font-size:26px}
.op-preview p{margin:4px 0;color:#cbd5e1;font-size:14px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.op-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 14px}
.op-chip{min-height:38px;padding:0 16px;border-radius:19px;border:1px solid #27384b;background:#0f1b2c;color:#f1f5f9;font:inherit;cursor:pointer}
.op-chip[aria-pressed=true]{background:#c6f576;color:#09131e;border-color:#c6f576}
.op-chip:focus-visible,.op-card:focus-visible,.op-input:focus-visible{outline:2px solid #fff;outline-offset:2px}
.op-select{min-height:38px;border-radius:19px;background:#0f1b2c;color:#f1f5f9;border:1px solid #27384b;padding:0 12px;font:inherit}
.op-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.op-grid.op-posters{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.op-card{position:relative;display:block;color:inherit;text-decoration:none;border-radius:10px;padding:4px}
.op-art{position:relative;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#13243a}
.op-posters .op-art{aspect-ratio:2/3}.op-art img{width:100%;height:100%;object-fit:cover}
.op-art .op-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px;font-weight:600;color:#cbd5e1}
.op-progress{position:absolute;left:0;bottom:0;height:4px;background:#c6f576}
.op-badge{position:absolute;left:6px;bottom:8px;background:rgba(0,0,0,.75);border-radius:5px;padding:2px 7px;font-size:12px;font-weight:700;white-space:nowrap;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis}
.op-title{margin:8px 2px 0;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.op-sub{margin:2px 2px 0;color:#94a3b8;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.op-remove{position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:17px;border:0;background:rgba(0,0,0,.7);color:#fff;cursor:pointer;opacity:0;transition:opacity .15s}
.op-card:hover .op-remove,.op-card:focus-within .op-remove,.op-remove:focus-visible{opacity:1}
@media (hover:none){.op-remove{opacity:1}}
.op-status{color:#94a3b8;margin:12px 0}
.op-search{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.op-input{flex:1 1 260px;min-height:44px;border-radius:10px;border:1px solid #27384b;background:#0f1b2c;color:#f1f5f9;padding:0 14px;font:inherit;font-size:16px}
.op-dialog{position:fixed;inset:0;z-index:100000;background:rgba(2,6,12,.72);display:flex;align-items:center;justify-content:center;padding:16px}
.op-box{background:#0b1626;border:1px solid #27384b;border-radius:14px;max-width:520px;width:100%;max-height:86vh;overflow:auto;padding:20px}
.op-box h2{margin:0 0 8px}.op-box p{color:#cbd5e1}.op-seasons{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin:12px 0}
.op-seasons label{display:flex;gap:8px;align-items:center;background:#0f1b2c;border-radius:8px;padding:8px}
.op-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
.op-primary{background:#c6f576;color:#09131e;border-color:#c6f576;font-weight:700}
html.orbital-live-single .headerTabs .emby-tab-button[data-index="0"],html.orbital-live-single .headerTabs .emby-tab-button[data-index="2"]{display:none!important}
`;doc.head.append(s);}
 function mount(root,host,api,user,h){root.dataset.loaded='true';root.dataset.complete='true';host.querySelectorAll(':scope > .ob5-browse').forEach(n=>{if(n!==root)n.remove();});host.prepend(root);host.classList.add('ob5-content-ready');doc.documentElement.classList.add('ob5-landing');
  h.browsePhase(root,'complete',api,user);h.restoreBrowsePosition?.(root);h.finishBrowseTransition?.();}
 function dialog(title,body,buttons){const d=el('div','op-dialog');d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');const box=el('div','op-box');box.append(el('h2','',title));
  if(typeof body==='string')box.append(el('p','',body));else if(body)box.append(body);const row=el('div','op-actions');
  const close=()=>{d.remove();doc.removeEventListener('keydown',esc,true);};const esc=e=>{if(e.key==='Escape'||e.key==='GoBack'||e.keyCode===10009){e.preventDefault();e.stopPropagation();close();}};
  for(const [label,fn,primary] of buttons||[['OK',null,true]]){const b=el('button','op-chip'+(primary?' op-primary':''),label);b.type='button';b.onclick=()=>{close();fn?.();};row.append(b);}
  box.append(row);d.append(box);d.onclick=e=>{if(e.target===d)close();};doc.body.append(d);doc.addEventListener('keydown',esc,true);(row.querySelector('.op-primary')||row.firstChild)?.focus();return close;}

 // ---- My List -------------------------------------------------------------------------------
 const store=(k,v)=>{try{if(v===undefined)return win.sessionStorage.getItem(k);win.sessionStorage.setItem(k,v);}catch{}return null;};
 async function myList(api,user,host,key,h){
  css();const root=el('div','ob5-browse op-page op-mylist');root.dataset.key=key;root.dataset.mode='mylist';h.browsePhase(root,'loading',api,user);
  const head=el('div','op-head'),title=el('h1','','My List'),count=el('span','op-count');head.append(title,count);
  const preview=el('section','op-preview'),bg=el('img','op-bg'),pv=el('div','op-pv'),pt=el('h2'),pm=el('p'),po=el('p');bg.alt='';pv.append(pt,pm,po);preview.append(bg,pv);
  const bar=el('div','op-bar'),grid=el('div','op-grid'),status=el('p','op-status','Loading My List…');status.setAttribute('role','status');
  root.append(head,preview,bar,status,grid);
  let kind=store('op-mylist-kind')||'all',sort=store('op-mylist-sort')||'watched',items=[];
  const kinds=[['all','All'],['movies','Movies'],['shows','Shows']];
  const sorts=[['watched','Recently watched'],['added','Recently added'],['released','Newest'],['title','A–Z']];
  const chips=kinds.map(([k,label])=>{const b=el('button','op-chip',label);b.type='button';b.onclick=()=>{kind=k;store('op-mylist-kind',k);paintChips();load();};bar.append(b);return [k,b];});
  const select=el('select','op-select');select.setAttribute('aria-label','Sort My List');for(const [k,label] of sorts){const o=el('option','',label);o.value=k;select.append(o);}select.value=sort;select.onchange=()=>{sort=select.value;store('op-mylist-sort',sort);load();};bar.append(select);
  function paintChips(){for(const [k,b] of chips)b.setAttribute('aria-pressed',String(k===kind));}paintChips();
  function sub(i){const d=i.UserData||{};if(i.Type==='Series')return d.UnplayedItemCount>0?(d.UnplayedItemCount===1?'1 episode left':d.UnplayedItemCount+' episodes left'):d.Played?'Watched':null;
   if(d.Played)return 'Watched';if(d.PlaybackPositionTicks>0&&i.RunTimeTicks)return Math.max(1,Math.round((i.RunTimeTicks-d.PlaybackPositionTicks)/6e8))+' min left';
   if(i.RunTimeTicks){const m=Math.round(i.RunTimeTicks/6e8);return m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m';}return null;}
  function show(i){if(!i){pt.textContent='Nothing saved yet';pm.textContent='';po.textContent='Choose “My List” on any movie or show to keep it here.';bg.removeAttribute('src');return;}
   pt.textContent=cleanName(i.Name);pm.textContent=[i.Type==='Series'?'Series':'Movie',i.ProductionYear,i.OfficialRating,(i.Genres||[]).slice(0,2).join(', ')||null,sub(i)].filter(Boolean).join('  ·  ');
   po.textContent=i.Overview||'';const tag=i.BackdropImageTags?.[0];if(tag)bg.src=api.getImageUrl(i.Id,{type:'Backdrop',tag,maxWidth:1280,quality:70});else bg.removeAttribute('src');}
  function card(i){const c=el('a','op-card');c.href=detailsHref(api,i.Id);c.dataset.id=i.Id;const art=el('div','op-art');
   const tag=i.BackdropImageTags?.[0],thumb=i.ImageTags?.Thumb,prim=i.ImageTags?.Primary;
   const src=tag?api.getImageUrl(i.Id,{type:'Backdrop',tag,maxWidth:520,quality:70}):thumb?api.getImageUrl(i.Id,{type:'Thumb',tag:thumb,maxWidth:520,quality:70}):prim?api.getImageUrl(i.Id,{type:'Primary',tag:prim,maxWidth:360,quality:70}):null;
   if(src){const img=el('img');img.src=src;img.alt='';img.loading='lazy';img.onerror=()=>{img.remove();art.append(el('span','op-fallback',cleanName(i.Name)));};art.append(img);}else art.append(el('span','op-fallback',cleanName(i.Name)));
   const d=i.UserData||{};if(i.Type!=='Series'&&d.PlaybackPositionTicks>0&&i.RunTimeTicks&&!d.Played){const p=el('span','op-progress');p.style.width=Math.min(100,100*d.PlaybackPositionTicks/i.RunTimeTicks).toFixed(1)+'%';art.append(p);}
   const rm=el('button','op-remove material-icons','close');rm.type='button';rm.title='Remove from My List';rm.setAttribute('aria-label','Remove '+cleanName(i.Name)+' from My List');
   rm.onclick=async e=>{e.preventDefault();e.stopPropagation();try{await api.updateFavoriteStatus(user,i.Id,false);items=items.filter(x=>x.Id!==i.Id);const next=c.nextElementSibling||c.previousElementSibling;c.remove();count.textContent=items.length===1?'1 title':items.length+' titles';(next?.querySelector?next:null)?.focus();if(!items.length)show(null);}catch{dialog('My List','Couldn’t remove this title. Try again.');}};
   c.append(art,rm,el('p','op-title',cleanName(i.Name)),el('p','op-sub',[i.Type==='Series'?'Series':i.ProductionYear,sub(i)].filter(Boolean).join(' · ')));
   c.addEventListener('focus',()=>show(i));c.addEventListener('mouseenter',()=>show(i));return c;}
  let serial=0;
  async function load(){const mine=++serial;status.hidden=false;status.textContent='Loading My List…';
   const order={watched:['DatePlayed,DateCreated','Descending'],added:['DateCreated','Descending'],released:['PremiereDate','Descending'],title:['SortName','Ascending']}[sort];
   try{const r=await api.getItems(user,{Recursive:true,Filters:'IsFavorite',IncludeItemTypes:kind==='movies'?'Movie':kind==='shows'?'Series':'Movie,Series',SortBy:order[0],SortOrder:order[1],
     Fields:'Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks',EnableImageTypes:'Backdrop,Thumb,Primary',ImageTypeLimit:1,Limit:500,EnableUserData:true});
    if(mine!==serial||!root.isConnected&&root.parentNode)return;items=r.Items||[];
    count.textContent=items.length===1?'1 title':items.length+' titles';grid.replaceChildren(...items.map(card));status.hidden=items.length>0;
    status.textContent=kind==='all'?'Nothing saved yet. Choose “My List” on any movie or show to keep it here.':'No '+(kind==='movies'?'movies':'shows')+' in My List yet.';show(items[0]||null);
   }catch(e){if(mine===serial){status.hidden=false;status.textContent='Couldn’t load My List. Reload to try again.';}}}
  mount(root,host,api,user,h);await load();return true;
 }

 // ---- Requests ------------------------------------------------------------------------------
 async function experience(api,route,body){
  const r=await win.fetch(api.getUrl(PREFIX.slice(1)+route),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Authorization':'MediaBrowser Token='+JSON.stringify(api.accessToken())},body:JSON.stringify(body||{})});
  if(!r.ok){const e=new Error('experience '+r.status);e.status=r.status;throw e;}return r.json();
 }
 function stateLabel(c){const req=c.request?.status;switch(c.state){case 'available':return 'Available';case 'in_library':return 'In your library';case 'partial':return 'Partly available';
  case 'requested':return req==='pending'?'Waiting for approval':req==='declined'?'Declined':'Requested';default:return req==='declined'?'Declined':req==='failed'?'Couldn’t be found':'Request';}}
 async function requests(api,user,host,key,h,initial){
  css();const root=el('div','ob5-browse op-page op-requests');root.dataset.key=key;root.dataset.mode='requests';h.browsePhase(root,'loading',api,user);
  const head=el('div','op-head');head.append(el('h1','','Requests'));
  const intro=el('p','op-status','Search for a movie or show that isn’t here yet. Requests usually arrive within minutes to a few hours.');
  const form=el('form','op-search'),input=el('input','op-input');input.type='search';input.placeholder='Search movies and shows';input.setAttribute('aria-label','Search movies and shows');input.enterKeyHint='search';
  const go=el('button','op-chip op-primary','Search');go.type='submit';const mine=el('button','op-chip','My requests');mine.type='button';form.append(input,go,mine);
  const heading=el('h2','',''),status=el('p','op-status'),grid=el('div','op-grid op-posters');status.setAttribute('role','status');
  root.append(head,intro,form,heading,status,grid);
  let serial=0;
  function card(c){const a=el('a','op-card');a.href='#';a.dataset.tmdb=c.tmdb;const art=el('div','op-art');
   if(c.poster&&/^https:\/\/image\.tmdb\.org\//.test(c.poster)){const img=el('img');img.src=c.poster;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{img.remove();art.append(el('span','op-fallback',c.title));};art.append(img);}else art.append(el('span','op-fallback',c.title));
   art.append(el('span','op-badge',stateLabel(c)));
   a.append(art,el('p','op-title',c.title),el('p','op-sub',[c.type==='tv'?'Series':'Movie',c.year,c.request?.created?'asked '+c.request.created:null].filter(Boolean).join(' · ')));
   a.setAttribute('aria-label',c.title+'. '+stateLabel(c));a.onclick=e=>{e.preventDefault();open(c);};return a;}
  function failed(e){status.hidden=false;status.textContent=e?.status===404?'Requests open on the secure address of this server. Use the link you normally use outside your home.':'Requests aren’t available right now. Try again in a moment.';}
  async function loadMine(){const me=++serial;heading.textContent='Your requests';status.hidden=false;status.textContent='Loading…';
   try{const r=await experience(api,'/my-requests',{});if(me!==serial)return;const list=r.requests||[];grid.replaceChildren(...list.map(card));status.hidden=list.length>0;status.textContent='You haven’t requested anything yet. Search above to request a movie or show.';}
   catch(e){if(me===serial)failed(e);}}
  async function search(term){term=String(term||'').trim().slice(0,100);if(!term)return loadMine();const me=++serial;heading.textContent='Results for “'+term+'”';status.hidden=false;status.textContent='Searching…';
   try{const r=await experience(api,'/discover-search',{term});if(me!==serial)return;const list=r.results||[];grid.replaceChildren(...list.map(card));status.hidden=list.length>0;status.textContent='Nothing found for “'+term+'”. Try a shorter title.';}
   catch(e){if(me===serial)failed(e);}}
  async function open(c){
   if(c.item_id&&['available','in_library'].includes(c.state)){win.location.hash=detailsHref(api,c.item_id);return;}
   let plan;try{plan=await experience(api,'/discover-plan',{type:c.type,tmdb:c.tmdb});}catch(e){dialog(c.title,'Requests aren’t available right now. Try again in a moment.');return;}
   if(!plan.can_request){const why={available_in_seerr:'This is already available.',pending:'You’ve already requested this. It’s waiting for approval.',approved:'This has already been requested. It will appear when it arrives.',completed:'This has already been requested. It will appear when it arrives.',already_requested:'This has already been requested. It will appear when it arrives.'}[plan.state]||(plan.permission?'There’s nothing left to request for this title.':'Your account can’t request this. Ask the server owner.');
    dialog(c.title,why,plan.item_id?[['Open',()=>{win.location.hash=detailsHref(api,plan.item_id);},true],['Back']]:[['OK',null,true]]);return;}
   if(c.type==='movie'){dialog('Request '+c.title+'?','It will be added to your library when it’s found. You’ll see it under Your requests.',[['Request',()=>submit(c,[]),true],['Cancel']]);return;}
   const options=(plan.seasons||[]).filter(s=>s.requestable&&s.number>0);if(!options.length){dialog(c.title,'There’s nothing left to request for this show.');return;}
   const box=el('div','op-seasons'),checks=options.map(s=>{const l=el('label'),cb=el('input');cb.type='checkbox';cb.checked=true;cb.value=s.number;l.append(cb,el('span','',s.name));box.append(l);return cb;});
   const wrap=el('div');wrap.append(el('p','','Choose the seasons to request.'),box);
   dialog('Request '+c.title,wrap,[['Request selected',()=>{const picked=checks.filter(x=>x.checked).map(x=>Number(x.value));if(picked.length)submit(c,picked);},true],['Cancel']]);}
  async function submit(c,seasons){status.hidden=false;status.textContent='Requesting “'+c.title+'”…';
   try{const r=await experience(api,'/discover-submit',{type:c.type,tmdb:c.tmdb,seasons});status.hidden=true;
    dialog(c.title,r.submitted?(r.state==='pending'?'Requested. It’s waiting for approval.':'Requested. It will appear in your library when it’s found.'):'This has already been requested.');if(heading.textContent==='Your requests')loadMine();}
   catch(e){status.hidden=true;dialog(c.title,'The request didn’t go through. Try again in a moment.');}}
  form.onsubmit=e=>{e.preventDefault();search(input.value);};mine.onclick=()=>{input.value='';loadMine();};
  mount(root,host,api,user,h);
  const q=String(initial||'');if(q){input.value=q;await search(q);}else await loadMine();
  if(win.matchMedia?.('(hover: hover)').matches)input.focus({preventScroll:true});return true;
 }
 const requestHref=path=>{const m=/^\/(movie|tv)\/([1-9][0-9]{0,11})$/.exec(String(path||''));return '#/movies?orbitalBrowse='+encodeURIComponent(m?'requests:'+m[1]+':'+m[2]:'requests');};

 // ---- One Live page ---------------------------------------------------------------------------
 function liveSingle(){const hash=win.location.hash||'';const live=/^#\/livetv(?:\?|$)/.test(hash),sports=/[?&]sports=1(?:&|$)/.test(hash);
  doc.documentElement?.classList.toggle('orbital-live-single',live&&!sports);}
 if(doc&&win.addEventListener){css();liveSingle();win.addEventListener('hashchange',liveSingle);win.addEventListener('popstate',liveSingle);}

 async function dispatch(spec,api,user,host,key,h){
  const parts=String(spec).split(':');
  if(parts[0]==='mylist')return myList(api,user,host,key,h);
  if(parts[0]==='requests'){
   if(parts[1]==='movie'||parts[1]==='tv'){let title='';try{const r=await experience(api,'/discover-plan',{type:parts[1],tmdb:Number(parts[2])});title=r.title||'';}catch{}return requests(api,user,host,key,h,title);}
   return requests(api,user,host,key,h,decodeURIComponent(parts.slice(1).join(':')));}
  return null;
 }
 return win.OrbitalParity={version:1,seed,rng,shuffle,weighted,genres,rotate,myList,requests,requestHref,dispatch,stateLabel,liveSingle};
});
/* Oct 26: baserunning plays on the pitch tracker. Pickoff attempts (safe or out) and caught stealing come only from
   released timeline rows: base, runner and outcome are shown as reported, never guessed. A pickoff throw is drawn as
   an illustration on approximate timing and plays once per play; reduced motion shows the finished picture. */
(()=>{'use strict';
 if(window.OrbitalBaseRunning)return;
 const NS='http://www.w3.org/2000/svg',ORD={1:'1st',2:'2nd',3:'3rd',4:'home'},seen=new Map();
 const words={'1b':1,'2b':2,'3b':3,first:1,second:2,third:3,'1st':1,'2nd':2,'3rd':3,home:4};
 const str=v=>typeof v==='string'?v:'';
 const stage=r=>str(r?.phase)||str(r?.stage);
 const isPitch=r=>r?.pitch===true||stage(r)==='pitch';
 const isStart=r=>['at_bat_start','inning_start'].includes(stage(r))||/^(start inning|start batter\/pitcher)$/i.test(str(r?.type))||/ pitches to /.test(str(r?.text));
 const isEnd=r=>stage(r)==='inning_end'||/^(end inning|inning end)$/i.test(str(r?.type));
 const filler=r=>/^(runner movement|end batter\/pitcher)$/i.test(str(r?.type))||r?.event_type==='indexed_runner_endpoint';
 function baseFrom(row,label){
  const a=row.action||{};if(Number.isInteger(a.base)&&a.base>=1&&a.base<=4)return a.base;
  const et=/_(1b|2b|3b|home)$/i.exec(str(row.event_type));if(et)return words[et[1].toLowerCase()];
  const m=/(?:stealing|off(?: at)?|attempt(?: at)?)\s+(1b|2b|3b|1st|2nd|3rd|first|second|third|home)\b/i.exec(label);
  return m?words[m[1].toLowerCase()]:null;
 }
 function runnerFrom(row,label){
  const a=row.action||{},named=v=>typeof v==='string'?v:typeof v?.name==='string'?v.name:'';
  const direct=named(a.runner)||named(row.runners?.[0]?.runner);if(direct)return direct.trim().slice(0,60);
  const m=/^([A-Z][\w.'’-]*(?: [A-Z][\w.'’-]*){0,3}) (?:caught stealing|picked off|was picked off)/.exec(str(row.text));
  return m?m[1]:'';
 }
 function classify(row){
  if(!row||typeof row!=='object'||isPitch(row))return null;
  const a=row.action||{},et=str(row.event_type),label=str(row.type)+' '+str(row.text);let kind=null,out=null,error=false;
  if(a.kind==='pickoff_attempt'){kind='pickoff';out=typeof a.success==='boolean'?a.success:null;}
  else if(a.kind==='pickoff'){kind='pickoff';out=a.success!==false;}
  else if(/^pickoff_caught_stealing/.test(et)){kind='pickoff_caught_stealing';out=true;}
  else if(a.kind==='caught_stealing'||/^caught_stealing/.test(et)){kind='caught_stealing';out=true;}
  else if(/^pickoff_error/.test(et)){kind='pickoff';out=false;error=true;}
  else if(/^pickoff_(1b|2b|3b)$/.test(et)){kind='pickoff';out=true;}
  else if(/picked off/i.test(label)){kind=/caught stealing/i.test(label)?'pickoff_caught_stealing':'pickoff';out=true;}
  else if(/pickoff attempt/i.test(label)){kind='pickoff';out=null;}
  else if(/caught stealing/i.test(label)){kind='caught_stealing';out=true;}
  if(!kind)return null;
  const base=baseFrom(row,label),where=base?(base===4?' home':' '+ORD[base]):'',runner=runnerFrom(row,label);
  let title,copy;
  if(kind==='caught_stealing'){title='Caught stealing'+where;copy='Out'+(runner?' · '+runner:'');}
  else if(kind==='pickoff_caught_stealing'){title='Picked off, caught stealing'+where;copy='Out'+(runner?' · '+runner:'');}
  else if(out===true){title='Picked off at'+(where||' base');copy='Out'+(runner?' · '+runner:'');}
  else if(out===false){title='Pickoff attempt'+(where?' at'+where:'');copy='Safe'+(error?' · throwing error':'')+(runner?' · '+runner+(base&&base<4?' back at '+ORD[base]:''):'');}
  else{title='Pickoff attempt'+(where?' at'+where:'');copy='Result not reported';}
  return {id:String(row.id??''),kind,base,out,runner,thrower:a.thrower==='catcher'?'catcher':a.thrower==='pitcher'?'pitcher':null,title,copy,
   outs:Number.isInteger(row.outs)&&row.outs>=0&&row.outs<=3?row.outs:null};
 }
 // The latest released play is a baserunning play when no pitch or new at-bat follows it.
 function play(timeline){
  const rows=Array.isArray(timeline)?timeline:[];
  for(let i=rows.length-1;i>=0&&i>=rows.length-12;i--){const r=rows[i];if(!r||typeof r!=='object')continue;
   if(isEnd(r)||filler(r))continue;
   if(isPitch(r)||isStart(r))return null;
   return classify(r);}
  return null;
 }
 // A third out ends the half-inning; the retained count is the last count, not an active at-bat.
 function inningEnd(model){
  const rows=Array.isArray(model?.timeline)?model.timeline:[];let ended=model?.situation?.outs===3||model?.baseball_phase==='between_innings';
  let context=null;
  for(let i=rows.length-1;i>=0&&i>=rows.length-14;i--){const r=rows[i];if(!r||typeof r!=='object')continue;
   if(isEnd(r)){ended=true;continue;}
   if(isStart(r))return null;
   if(/^(top|bottom)$/i.test(str(r.half))&&Number.isInteger(r.period)){context=context||r;if(r.outs===3&&!isPitch(r))ended=true;}
   if(isPitch(r))break;}
  if(!ended)return null;
  const half=str(context?.half).toLowerCase(),n=context?.period;
  const ord=Number.isInteger(n)?n+(n%100>=11&&n%100<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'):'';
  return {label:half&&ord?'End of the '+half+' '+ord:'Half-inning over'};
 }
 function el(tag,attrs){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs||{}))n.setAttribute(k,String(v));return n;}
 // Mini diamond. Only the reported base, thrower and outcome are drawn; positions are schematic.
 function graphic(p,{reduce=false}={}){
  const P={home:[60,84],1:[98,48],2:[60,12],3:[22,48],4:[60,84],mound:[60,50]};
  const svg=el('svg',{viewBox:'0 0 120 100',class:'obr-diamond',role:'img','aria-label':p.title+'. '+p.copy});
  svg.append(el('path',{d:'M60 84 L98 48 L60 12 L22 48 Z',fill:'rgba(120,170,120,.16)',stroke:'#c1cad3','stroke-width':1.2}));
  svg.append(el('circle',{cx:60,cy:50,r:4,fill:'#a89a7c'}));
  for(const b of [1,2,3]){const [x,y]=P[b];svg.append(el('rect',{x:x-5,y:y-5,width:10,height:10,transform:`rotate(45 ${x} ${y})`,fill:b===p.base?'#ffd166':'#788391',stroke:'#e6edf3','stroke-width':.8}));}
  svg.append(el('path',{d:'M55 84 h10 v4 l-5 4 l-5 -4 z',fill:p.base===4?'#ffd166':'#e6edf3'}));
  if(!p.base)return svg;
  const [bx,by]=P[p.base],tone=p.out===true?'#ff6b6b':p.out===false?'#79dd9e':'#c8d7e1';
  const played=seen.has(p.id),now=performance.now();if(!played){seen.set(p.id,now);if(seen.size>60)seen.delete(seen.keys().next().value);}
  const age=(now-(seen.get(p.id)??now))/1000,animate=!reduce&&age<1.4;
  if(p.kind==='caught_stealing'||p.kind==='pickoff_caught_stealing'){
   // The runner's advance to the reported base; no throw path is drawn for a steal.
   const from=p.base===4?P[3]:P[p.base-1]||P.home;
   svg.append(el('line',{x1:from[0],y1:from[1],x2:bx,y2:by,stroke:'#e6edf3','stroke-width':1.6,'stroke-dasharray':'3 3','marker-end':''}));
  }else{
   const [tx,ty]=p.thrower==='catcher'?P.home:P.mound,line=el('line',{x1:tx,y1:ty,x2:bx,y2:by,stroke:'#e6edf3','stroke-width':1.4,'stroke-dasharray':'2 3',opacity:.8});
   svg.append(line);const ball=el('circle',{cx:bx,cy:by,r:3,fill:'#fff'});
   if(animate){const m=el('animateMotion',{dur:'.6s',begin:(-age).toFixed(3)+'s',fill:'freeze',path:`M${tx-bx} ${ty-by} L0 0`});ball.append(m);}
   svg.append(ball);
  }
  svg.append(el('circle',{cx:bx+(p.base===2?0:p.base===1?-8:8),cy:by+(p.base===2?8:-6),r:4.5,fill:tone,stroke:'#0b1622','stroke-width':1}));
  if(p.out!==null){const badge=el('text',{x:bx,y:p.base===2?by+26:by-12,'text-anchor':'middle','font-size':11,'font-weight':800,fill:tone});
   badge.textContent=p.out?'OUT':'SAFE';
   if(animate){badge.setAttribute('opacity','0');badge.append(el('animate',{attributeName:'opacity',from:0,to:1,dur:'.2s',begin:(0.6-age).toFixed(3)+'s',fill:'freeze'}));}
   svg.append(badge);}
  return svg;
 }
 const caption='Illustration · reported play, approximate timing';
 // Outermost decorator for the shared card (Game Center and non-presentation trackers): runs after every other
 // create() wrapper so their pitch detail rebuilds cannot hide the baserunning play or the half-inning end.
 function decorate(card,data){
  if(!card?.querySelector||!data||data.summary?.summary_only===true)return card;
  const baseRun=play(data.timeline),halfEnded=inningEnd(data);if(!baseRun&&!halfEnded)return card;
  const h=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  const zone=card.querySelector('.obc-zone'),detail=card.querySelector('.obc-pitch'),situation=card.querySelector('.obc-situation'),main=card.querySelector('.obc-main');
  const outsNode=situation?.lastElementChild,setOuts=n=>{if(outsNode)outsNode.textContent=n+' '+(n===1?'Out':'Outs');};
  if(baseRun){
   if(zone)zone.replaceChildren(graphic(baseRun,{reduce:matchMedia('(prefers-reduced-motion: reduce)').matches}),h('small','',caption));
   if(detail){const head=h('strong','obc-headline',baseRun.title);head.dataset.tone=baseRun.out===true?'out':baseRun.out===false?'safe':'unknown';detail.replaceChildren(h('small','obr-kicker',halfEnded?halfEnded.label:'Baserunning'),head,h('span','obc-result',baseRun.copy));}
   card.dataset.basePlay=baseRun.kind;if(baseRun.outs!==null&&!halfEnded)setOuts(baseRun.outs);
  }
  if(halfEnded){
   card.dataset.halfInning='ended';const label=[...(situation?.querySelectorAll('small')||[])].find(n=>/^(Count|Outcome)$/.test(n.textContent));
   if(label&&label.textContent==='Count'){label.textContent='Last count';label.classList.add('obr-last');
    const value=label.nextElementSibling,c=data.summary||{},s=data.situation||{},b=Number.isInteger(c.balls)?c.balls:s.balls,k=Number.isInteger(c.strikes)?c.strikes:s.strikes;
    if(value&&value.textContent==='—'&&Number.isInteger(b)&&Number.isInteger(k))value.textContent=b+'–'+k;}
   setOuts(3);if(main&&!baseRun)main.before(h('p','obc-context obc-half-end',halfEnded.label));
  }
  return card;
 }
 const card=window.TelevisionBaseballCard;
 if(card&&typeof card.create==='function'){const prior=card.create;card.create=(data,options={})=>decorate(prior(data,options),data);}
 window.OrbitalBaseRunning={classify,play,inningEnd,graphic,decorate,caption};
})();

;
/* Shared free-edition discovery and episode browsing. Uses only Jellyfin library/playback APIs. */
(function(){
 'use strict';
 if(window.OrbitalFreeExperience)return;
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='ofx-button')=>{const b=make('button',cls,text);b.type='button';b.onclick=fn;return b;};
 let dialog=null,opener=null,generation=0;
 // Jellyfin's player consumes document clicks and keys; route owned controls first.
 window.addEventListener('click',e=>{const b=e.target?.closest?.('.ofx-player-open,.ofx-start-over,.ofx-dialog button');if(!b||b.disabled||typeof b.onclick!=='function')return;e.preventDefault();e.stopImmediatePropagation();b.onclick(e);},true);
 for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{if(!dialog||!e.target?.closest?.('.ofx-dialog'))return;e.stopImmediatePropagation();if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();if(type==='keydown')close();}},true);
 function close(){generation++;if(dialog){dialog.close();dialog.remove();dialog=null;}opener?.isConnected&&opener.focus();opener=null;}
 function frame(title,description,from){
  close();opener=from;const box=make('dialog','ofx-dialog');dialog=box;box.setAttribute('aria-label',title);
  const head=make('header','ofx-head'),titles=make('div');titles.append(make('span','ofx-eyebrow','YOUR LIBRARY'),make('h2','',title),make('p','',description));head.append(titles,button('Close',close));box.append(head);
  box.addEventListener('cancel',e=>{e.preventDefault();close();});box.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();e.stopPropagation();close();}},true);
  (document.fullscreenElement||document.body).append(box);box.showModal();return box;
 }
 const descriptions=['Recently added · not watched yet','Top-rated titles you have not seen','Unwatched comedies from your library','Real stories and new perspectives','Discover something from 1990–1999'];
 function discovery(from,links){
  const box=frame('What are you in the mood for?','Choose a starting point. You can refine the results next.',from),list=make('div','ofx-presets');
  links.forEach((link,i)=>{const b=button('',()=>{const href=link.href;close();location.href=href;},'ofx-preset');b.append(make('span','ofx-number',String(i+1).padStart(2,'0')));const text=make('span');text.append(make('strong','',link.textContent),make('small','',descriptions[i]||''));b.append(text,make('span','ofx-arrow','›'));list.append(b);});box.append(list,make('p','ofx-foot','Back to close · Select to explore'));list.querySelector('button')?.focus();
 }
 function binding(){
  const api=window.ApiClient,m=window.TelevisionPlayerBridge?.manager;if(!api||!m)return null;
  try{const p=m.getCurrentPlayer(),item=m.currentItem(p);if(!p?.isLocalPlayer||item?.Type!=='Episode'||!item.SeriesId)return null;
   return {api,m,p,item,key:JSON.stringify([api.serverId(),api.getCurrentUserId(),item.Id,m.playSessionId?.(p)])};}catch{return null;}
 }
 async function episodes(from){
  const owner=binding();if(!owner)return;
  const box=frame(owner.item.SeriesName||'Episodes','',from),ticket=generation;box.classList.add('ofx-episode-drawer');
  const columns=make('div','ofx-columns'),seasons=make('select','ofx-seasons ofx-season-select'),list=make('div','ofx-episodes');seasons.setAttribute('aria-label','Seasons');list.setAttribute('aria-label','Episodes');columns.append(seasons,list);box.append(columns,make('p','ofx-foot','Select an episode to play · Back closes'));
  let selection=0,busy=false;
  const owns=()=>dialog===box&&ticket===generation&&binding()?.key===owner.key;
  const get=(path,params)=>owner.api.ajax({type:'GET',url:owner.api.getUrl(path,{userId:owner.api.getCurrentUserId(),...params}),dataType:'json'});
  const loading=message=>{list.replaceChildren(make('p','ofx-empty',message));list.setAttribute('aria-busy','true');};
  const failure=(message,retry)=>{list.removeAttribute('aria-busy');list.replaceChildren(make('p','ofx-empty',message),button('Try again',retry));};
  async function chooseSeason(season){
   const pass=++selection;loading('Loading episodes…');seasons.value=season.Id;for(const b of seasons.children)b.setAttribute('aria-current',String(b.value===season.Id));
   try{
    const data=await get('Shows/'+encodeURIComponent(owner.item.SeriesId)+'/Episodes',{seasonId:season.Id,Fields:'Overview,PrimaryImageAspectRatio',EnableUserData:true});
    if(!owns()||pass!==selection)return;
    const rows=(data.Items||[]).slice().sort((a,b)=>(a.IndexNumber??0)-(b.IndexNumber??0));list.replaceChildren();list.removeAttribute('aria-busy');
    if(!rows.length){list.append(make('p','ofx-empty','No episodes are available in this season.'));return;}
    rows.forEach((item,index)=>{
     const current=item.Id===owner.item.Id,available=item.LocationType!=='Virtual',position=item.UserData?.PlaybackPositionTicks||0;
     const marker=current?'Now playing':!available?'Unavailable':item.UserData?.Played?'Watched':position>0?'In progress':'';
     const name=(item.IndexNumber!=null?item.IndexNumber+'. ':'')+(item.Name||'Episode').replace(/^.*?\bS\d{1,3}E\d{1,3}\s*[-–:]\s*/i,'');
     const row=button('',async()=>{
      if(!owns()||busy||!available)return;if(current){close();return;}
      const ids=rows.slice(index).filter(e=>e.LocationType!=='Virtual').map(e=>e.Id);busy=true;row.disabled=true;row.setAttribute('aria-busy','true');
      try{await owner.m.play({ids,startPositionTicks:item.UserData?.Played?0:position,serverId:owner.api.serverId()});if(dialog===box)close();}
      catch{if(dialog===box){busy=false;row.disabled=false;row.removeAttribute('aria-busy');const error=make('p','ofx-error','This episode could not start. Try again or choose another episode.');error.setAttribute('role','alert');box.querySelector('.ofx-error')?.remove();list.prepend(error);}}
     },'ofx-episode');row.disabled=!available;row.setAttribute('aria-current',String(current));
     if(item.ImageTags?.Primary){const image=make('img','ofx-still');image.alt='';image.loading='lazy';image.src=owner.api.getImageUrl(item.Id,{type:'Primary',tag:item.ImageTags.Primary,maxWidth:440});image.onerror=()=>image.remove();row.append(image);}else row.append(make('span','ofx-still ofx-placeholder',item.IndexNumber!=null?String(item.IndexNumber):'▶'));
     const text=make('span','ofx-episode-copy');text.append(make('strong','',name),make('small','ofx-meta',[marker,item.RunTimeTicks?Math.round(item.RunTimeTicks/600000000)+' min':''].filter(Boolean).join(' · ')),make('span','ofx-summary',item.Overview||''));
     if(position>0&&item.RunTimeTicks>0&&!item.UserData?.Played){const progress=make('progress');progress.max=item.RunTimeTicks;progress.value=Math.min(position,item.RunTimeTicks);progress.setAttribute('aria-label','Episode progress');text.append(progress);}
     row.append(text);list.append(row);
    });
   }catch{if(owns()&&pass===selection)failure('Episodes could not load. Your video has not changed.',()=>chooseSeason(season));}
  }
  async function load(){loading('Loading seasons…');try{const data=await get('Shows/'+encodeURIComponent(owner.item.SeriesId)+'/Seasons',{});if(!owns())return;const rows=data.Items||[];
   if(!rows.length){list.removeAttribute('aria-busy');list.replaceChildren(make('p','ofx-empty','No seasons are available for this show.'));return;}
   seasons.replaceChildren();for(const season of rows){const b=make('option','ofx-season',season.IndexNumber===0?'Specials':season.Name||'Season '+(season.IndexNumber??0));b.value=season.Id;seasons.append(b);}seasons.onchange=()=>{const selected=rows.find(s=>s.Id===seasons.value);if(selected)chooseSeason(selected);};
   const selected=rows.find(s=>s.Id===owner.item.SeasonId)||rows[0];await chooseSeason(selected);if(owns())seasons.focus();
  }catch{if(owns())failure('Seasons could not load.',load);}}
  await load();
 }
 function localVideo(){
  const api=window.ApiClient,m=window.TelevisionPlayerBridge?.manager;if(!api||!m)return null;
  try{const p=m.getCurrentPlayer(),item=m.currentItem(p),state=m.getPlayerState?.(p);
   if(!p?.isLocalPlayer||!['Episode','Movie','Video'].includes(item?.Type)||item.IsLive||state?.PlayState?.CanSeek===false)return null;
   return {m,p,item};}catch{return null;}
 }
 function seekBy(seconds){const b=localVideo();if(!b)return false;const ms=b.m.currentTime(b.p),duration=b.item.RunTimeTicks;
  if(!Number.isFinite(ms)||typeof b.m.seek!=='function')return false;
  const ticks=Math.max(0,Math.round((ms+seconds*1000)*10000));b.m.seek(duration?Math.min(ticks,duration-1):ticks,b.p);return true;
 }
 function startOver(){const b=localVideo();if(b&&typeof b.m.seek==='function')b.m.seek(0,b.p);}
 window.addEventListener('keydown',e=>{
  if(dialog||e.altKey||e.ctrlKey||e.metaKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
  if(e.target?.closest?.('button,input,select,textarea,a,[role=button],[role=slider],[contenteditable=true]'))return;
  const video=[...document.querySelectorAll('video')].find(v=>v.getClientRects().length&&v.readyState>=2);if(!video)return;
  if(seekBy(e.key==='ArrowLeft'?-10:10)){e.preventDefault();e.stopImmediatePropagation();}
 },true);
 function update(){
  for(const section of document.querySelectorAll('.oe-discover:not([data-ofx])')){const bar=section.querySelector('.oe-bar'),links=bar?[...bar.querySelectorAll('a')]:[];if(!links.length)continue;section.dataset.ofx='true';const open=button('Find your next watch',()=>discovery(open,links),'ob5-button ofx-discover-open');bar.replaceChildren(open);}
  const owner=binding();document.querySelectorAll('.ofx-player-open').forEach(b=>{if(!owner)b.remove();});
  const bottom=document.querySelector('.videoOsdBottom');const playable=localVideo();document.querySelectorAll('.ofx-start-over').forEach(b=>{if(!playable)b.remove();});if(playable&&bottom&&!bottom.querySelector('.ofx-start-over'))bottom.append(button('Start from beginning',startOver,'ofx-button ofx-start-over'));if(owner&&bottom&&!bottom.querySelector('.ofx-player-open')){const open=button('Episodes & seasons',()=>episodes(open),'ofx-button ofx-player-open');bottom.append(open);}
 }
 window.OrbitalFreeExperience={episodes,discovery,close,binding,seekBy,startOver};
 setInterval(()=>{if(!document.hidden)update();},750);update();
})();

/* Ordinary Jellyfin Live TV routes get channel browsing without a managed Sports plan. */
(()=>{'use strict';
let active=null,previous=null,last=null,dialog=null,retirement=null;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
function read(){
 const api=window.ApiClient,pm=window.TelevisionPlayerBridge?.manager,p=pm?.getCurrentPlayer?.(),item=p&&pm.currentItem(p);
 if(!api||!p||!item||!['TvChannel','LiveTvChannel'].includes(item.Type)||window.TelevisionPlayback?.snapshot?.()?.attempt)return null;
 const video=document.querySelector('#videoOsdPage video')||[...document.querySelectorAll('video')].find(v=>v.videoWidth>0&&!v.hidden);
 if(!video||!document.querySelector('.videoOsdBottom'))return null;
 return {api,pm,p,item,video,user:api.getCurrentUserId(),server:api.serverId(),token:api.accessToken(),session:pm.playSessionId(p)};
}
const same=(a,b)=>!!a&&!!b&&a.api===b.api&&a.p===b.p&&a.user===b.user&&a.server===b.server&&a.token===b.token&&a.item.Id===b.item.Id&&a.session===b.session;
function close(){dialog?.close();dialog?.remove();dialog=null;}
function owned(a){return same(a,read());}
function retire(a){
 const original=a.api.reportPlaybackStopped;
 if(typeof original!=='function'||!a.session)return Promise.reject(Error('stop acknowledgement unavailable'));
 return new Promise((resolve,reject)=>{
  let timer,matched=false;
  const restore=()=>{clearTimeout(timer);if(a.api.reportPlaybackStopped===wrapped)a.api.reportPlaybackStopped=original;};
  function wrapped(info){
   const exact=info?.PlaySessionId===a.session&&info?.ItemId===a.item.Id;
   let request;try{request=original.apply(this,arguments);}catch(error){if(exact){restore();reject(error);}throw error;}
   if(exact&&!matched){matched=true;Promise.resolve(request).then(()=>{restore();resolve();},error=>{restore();reject(error);});}
   return request;
  }
  a.api.reportPlaybackStopped=wrapped;
  timer=setTimeout(()=>{restore();reject(Error('stop acknowledgement timed out'));},15000);
  Promise.resolve().then(()=>a.pm.stop(a.p)).catch(error=>{restore();reject(error);});
 });
}
function switchFailure(a,status,message){
 if(window.ApiClient!==a.api||a.api.getCurrentUserId()!==a.user||a.api.serverId()!==a.server||a.api.accessToken()!==a.token)return;
 const player=a.pm.getCurrentPlayer?.();if(player&&a.pm.currentItem(player)&&!owned(a))return;
 if(status.isConnected){status.textContent=message;status.setAttribute('role','alert');return;}
 close();const d=el('dialog',null,'orbital-player-settings orbital-basic-channel-dialog');dialog=d;
 d.setAttribute('role','alertdialog');d.setAttribute('aria-label','Channel switch paused');
 const done=el('button','Close','otv-category');done.onclick=close;
 d.append(el('h2','Channel switch paused'),el('p',message),done);document.body.append(d);d.showModal();done.focus();
 d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;},{once:true});
}
async function switchTo(a,item,status){
 if(!owned(a))return;
 if(item.Id===a.item.Id){close();return;}
 status.textContent='Closing the current channel…';let opening=false;
 try{
  // Keep a single stop promise for this exact playback. An uncertain close is not retried automatically.
  if(!retirement)retirement=retire(a);
  await retirement;
  if(window.ApiClient!==a.api||a.api.getCurrentUserId()!==a.user||a.api.serverId()!==a.server||a.api.accessToken()!==a.token)return;
  if(a.pm.getCurrentPlayer?.()===a.p && a.pm.currentItem(a.p))throw Error('close not confirmed');
  if(a.pm.getCurrentPlayer?.() && a.pm.currentItem(a.pm.getCurrentPlayer()))return; // Another playback already owns the screen.
  opening=true;close();await a.pm.play({ids:[item.Id],serverId:a.server,fullscreen:true});
 }catch{switchFailure(a,status,opening?'The previous channel stopped, but the selected channel could not start. Close this message and choose a channel again.':'The current channel has not confirmed it stopped. No new channel was opened. Close this message and use the player’s Stop or Back control if playback is still active.');}
}
async function browse(guide){
 const a=active;if(!owned(a))return;close();
 const d=el('dialog',null,'orbital-player-settings orbital-basic-channel-dialog');dialog=d;
 const heading=el('header',null,'orbital-settings-heading'),done=el('button','Close','otv-category');done.onclick=close;heading.append(el('h2',guide?'TV guide':'Channels'),done);
 const search=el('input'),status=el('p','Loading channels…'),list=el('div'),more=el('button','Load more','otv-category');
 search.type='search';search.placeholder='Search channels';search.setAttribute('aria-label','Search channels');d.append(heading,search,status,list,more);
 (document.fullscreenElement||document.body).append(d);d.showModal();search.focus();
 let offset=0,generation=0,timer=null,busy=false;
 const current=()=>dialog===d&&d.open&&owned(a);
 async function load(reset){
  const run=++generation;if(reset){offset=0;list.replaceChildren();}more.disabled=true;
  try{
   const data=await a.api.getLiveTvChannels({UserId:a.user,EnableCurrentProgram:true,Limit:60,StartIndex:offset,SearchTerm:search.value.trim()});
   if(!current()||run!==generation)return;
   for(const item of data.Items||[]){
    const row=el('button',String(item.Number||'')+' '+item.Name,'otv-player-feed');row.type='button';
    if(item.Id===a.item.Id)row.append(el('small','Watching'));
    if(guide)row.append(el('small',item.CurrentProgram?.Name||'Schedule unavailable'));
    row.onclick=async()=>{if(!current()||busy)return;busy=true;row.disabled=true;await switchTo(a,item,status);busy=false;};list.append(row);
   }
   offset+=(data.Items||[]).length;more.hidden=!data.Items?.length||offset>=Number(data.TotalRecordCount||offset);status.textContent=offset?offset+' channels shown':'No matching channels.';
  }catch{if(current())status.textContent='Channels could not load. Try again.';}finally{if(current()&&run===generation)more.disabled=false;}
 }
 search.oninput=()=>{generation++;clearTimeout(timer);timer=setTimeout(()=>load(true),250);};more.onclick=()=>load(false);
 d.addEventListener('close',()=>{generation++;clearTimeout(timer);d.remove();if(dialog===d)dialog=null;},{once:true});
 for(const type of ['keydown','keyup'])d.addEventListener(type,e=>{e.stopPropagation();if(type==='keydown'&&['Escape','BrowserBack'].includes(e.key)){e.preventDefault();close();}},true);
 await load(true);
}
function refresh(){
 const next=read();
 if((active||next)&&!same(active,next)){
  close();document.getElementById('orbital-basic-channel-actions')?.remove();retirement=null;active=next;
  if(next){
   const key=next.server+'|'+next.user;
   if(last?.key!==key){last=null;previous=null;}
   if(last?.item.Id!==next.item.Id){previous=last;last={key,item:next.item};}
  }
 }
 if(!active||document.getElementById('orbital-basic-channel-actions'))return;
 const a=active,bar=el('div',null,'orbital-player-actions');bar.id='orbital-basic-channel-actions';
 for(const [label,fn] of [['Channels',()=>browse(false)],['Guide',()=>browse(true)],['Last channel',()=>{if(previous){browse(false).then(()=>{if(dialog&&owned(a))switchTo(a,previous.item,dialog.querySelector('p'));});}}]]){
  const b=el('button',label,'otv-category');b.type='button';if(label==='Last channel')b.disabled=!previous;b.onclick=e=>{e.preventDefault();e.stopPropagation();fn();};bar.append(b);
 }
 document.querySelector('.videoOsdBottom')?.append(bar);
}
setInterval(refresh,500);
})();
