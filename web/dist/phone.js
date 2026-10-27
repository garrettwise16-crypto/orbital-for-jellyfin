/* Orbital for Jellyfin, public web edition. Picture-timed sync is not included; trackers use the estimated delay and Sync. */
/* Library tab address guard (Oct 20). Stock library pages look up ?tab=N in their tab
   list; a named or out-of-range value (a typed or bookmarked #/livetv?tab=sports) throws
   inside React and leaves an error page. Rewrite such addresses before the router reads
   them. v2 (Oct 20, one Live page): Live TV's Programs and Channels tabs fold into the Guide,
   so #/livetv, tab=0 and tab=2 open the Guide unless it is the Sports page (sports=1). */
(function(root,install){
 if(typeof module==='object'&&module.exports)module.exports=install;
 else install(root);
})(typeof window==='object'?window:globalThis,function installTabGuard(win){
 'use strict';
 if(win.OrbitalTabGuard)return win.OrbitalTabGuard;
 const LIVE={programs:'1',sports:'0',guide:'1',channels:'1',recordings:'3',schedule:'4',series:'5'};
 function normalize(hash){
  const m=/^#(\/[A-Za-z]+)(?:\?(.*))?$/.exec(hash||'');if(!m)return null;
  const live=m[1]==='/livetv',q=new win.URLSearchParams(m[2]||''),tab=q.get('tab'),sports=q.get('sports')==='1';
  if(live&&!sports&&(tab==null||tab==='0'||tab==='2')){q.set('tab','1');return '#'+m[1]+'?'+q.toString();}
  if(tab==null)return null;
  const numeric=/^\d+$/.test(tab);
  if(numeric&&(!live||Number(tab)<=5))return null;
  if(live){
   const name=tab.trim().toLowerCase();q.set('tab',LIVE[name]||'1');
   if(name==='sports')q.set('sports','1');
  }else q.delete('tab');
  const s=q.toString();return '#'+m[1]+(s?'?'+s:'');
 }
 // phone.js loads before the app creates its router, so these listeners run before the
 // router's own popstate listener and the router only ever reads the corrected address.
 const fix=()=>{const next=normalize(win.location.hash);if(next&&next!==win.location.hash)win.history.replaceState(win.history.state,'',win.location.pathname+win.location.search+next);};
 fix();win.addEventListener('popstate',fix,true);win.addEventListener('hashchange',fix,true);
 return win.OrbitalTabGuard={version:2,normalize};
});

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
  function primaryControls(root) {
    const title=root.querySelector('h1,.pageTitle,.sectionTitle');
    const region=root.querySelector('.itemsContainer,.verticalSection,.sections,[role="list"],[role="grid"]');
    const control=root.querySelector('select,.btnFilter,.btnSort,button[aria-label],button[title]');
    return !!(title?.textContent.trim()&&region?.isConnected&&control?.isConnected&&!control.disabled&&root.contains(region)&&root.contains(control)&&control.getClientRects().length&&region.getClientRects().length&&!root.querySelector('.card[data-id],.listItem[data-id]'));
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
          const firstUseful=()=>valid()&&primaryControls(root);
          if(firstUseful())void window.OrbitalPageReady?.prepare(root,{...owner,host,valid,firstUseful});
          else {root.dataset.presentable='pending';window.OrbitalPageReady?.begin(owner.route);}
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
  function primaryControls(root) {
    const title=root.querySelector('h1,.pageTitle,.sectionTitle');
    const region=root.querySelector('.itemsContainer,.verticalSection,.sections,[role="list"],[role="grid"]');
    const control=root.querySelector('select,.btnFilter,.btnSort,button[aria-label],button[title]');
    return !!(title?.textContent.trim()&&region?.isConnected&&control?.isConnected&&!control.disabled&&root.contains(region)&&root.contains(control)&&control.getClientRects().length&&region.getClientRects().length&&!root.querySelector('.card[data-id],.listItem[data-id]'));
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
      if (statuses.some(value => value !== 'complete')) {
        root.dataset.phase='loading';
        const firstUseful=record.firstUseful||(record.firstUseful=()=>current(record)&&record.committed&&record.root===root&&root.isConnected&&root.parentElement===record.host&&document.getElementById(record.id)===root&&!root.classList.contains('hide')&&primaryControls(root));
        if(firstUseful())void window.OrbitalPageReady?.prepare(root,{...record,firstUseful,valid:()=>current(record)&&record.committed&&record.root===root&&root.parentElement===record.host});
        else {root.dataset.presentable='pending';window.OrbitalPageReady?.begin(record.route);}
        return;
      }
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
  const records = new Set(), sections = new WeakMap(), payloads = new WeakMap(), rowPayloads = new WeakMap(), apis = new WeakSet();
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
  function firstRowCurrent(op) {
    const row=op?.firstRow, record=op?.record;
    if(!current(op)||!op.metadata||op.failed||!row||!row.node.isConnected||!record.sections.contains(row.node)||rowPayloads.get(row.data)!==row.proof||row.proof.op!==op||row.proof.ambiguous)return false;
    const items=Array.isArray(row.data)?row.data:row.data?.Items;
    if(!Array.isArray(items)||!items.length||!items.every(item=>typeof item?.Id==='string'&&item.Id&&typeof item.Name==='string'&&item.Name.trim()))return false;
    const cards=[...row.node.querySelectorAll('.card[data-id]')];
    return cards.length===items.length&&cards.every((node,index)=>node.isConnected&&node.dataset.id===items[index].Id&&node.textContent.trim()&&node.getClientRects().length>0);
  }
  function presentFirst(op) {
    if(!firstRowCurrent(op))return;
    const record=op.record,firstUseful=op.firstUseful||(op.firstUseful=()=>firstRowCurrent(op));
    void window.OrbitalPageReady?.prepare(record.root,{...op.owner,host:record.host,firstUseful,valid:()=>current(op)&&op.metadata&&!op.failed});
  }
  function attachRows(record) {
    for(const node of record.sections.querySelectorAll('.itemsContainer')){
      if(record.rows.has(node)||typeof node.getItemsHtml!=='function')continue;
      record.rows.add(node);const after=node.afterRefresh;
      node.afterRefresh=function(data){
        const value=typeof after==='function'?after.apply(this,arguments):undefined;
        const proof=data&&typeof data==='object'?rowPayloads.get(data):null,op=proof?.op;
        if(op?.record===record&&record.current===op&&!proof.ambiguous){
          const previous=op.firstRow;op.firstRow={node,data,proof};
          if(!firstRowCurrent(op))op.firstRow=previous;
          presentFirst(op);
        }
        return value;
      };
    }
  }
  function finish(op) {
    presentFirst(op);
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
                  if(data&&typeof data==='object'){
                    const prior=rowPayloads.get(data);
                    if(!prior||prior.op!==op)rowPayloads.set(data,{op,ambiguous:!!prior});
                  }
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
        record.rows=new WeakSet();record.rowObserver=new MutationObserver(()=>attachRows(record));
        record.rowObserver.observe(container,{childList:true,subtree:true});attachRows(record);
        const onResume = controller.onResume, destroy = controller.destroy;
        controller.onResume = function (...args) {
          let op = record.current;
          if (retained(record) && routeMatches() && (!controller.sectionsRendered || record.loaded || !op)) {
            op = { record, owner: { api, user, server, credential, route: location.hash }, metadata: record.metadata, pending: 0, helperDone: false, failed: false };
            record.current = op;root.dataset.phase = 'loading';root.dataset.presentable = 'pending';window.OrbitalPageReady?.begin(op.owner.route);
          }
          return within(op, onResume, this, args);
        };
        controller.destroy = function (...args) { record.destroyed = true;record.rowObserver.disconnect();records.delete(record);return destroy.apply(this, args); };
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
 const SIMPLE=(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-'),records=new Map(),issuedScopes=new WeakSet();let activeEffect=null;
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
 function controlsCurrent(r){
  const input=r.root?.querySelector('#searchTextInput');
  return records.get(r.route)===r&&mounted(r)&&input?.isConnected&&!input.disabled&&input.getClientRects().length>0&&input.value.trim()===r.query.trim()&&!r.root.querySelector('.card[data-id]');
 }
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
  if(!rendered(r)){
   r.root.dataset.phase='loading';
   const firstUseful=r.firstUseful||(r.firstUseful=()=>controlsCurrent(r));
   if(firstUseful())void window.OrbitalPageReady?.prepare(r.root,{...r,firstUseful,valid:()=>records.get(r.route)===r&&mounted(r)});
   else {r.root.dataset.presentable='pending';window.OrbitalPageReady?.begin(r.route);}
   return;
  }
  const ticket=window.OrbitalPageReady?.begin(r.route);if(r.prepared?.ticket===ticket&&r.prepared.generation===r.generation)return;
  const generation=r.generation;r.prepared={ticket,generation};r.root.dataset.phase='complete';
  void window.OrbitalPageReady?.prepare(r.root,{...r,valid:()=>mounted(r)&&!r.failed&&r.generation===generation&&rendered(r)});
 });}
 function mainScopeOwner(context){
  const api=context?.__legacyApiClient__;if(location.pathname.startsWith('/simple/')||new URLSearchParams(location.search).get('orbital')==='off'||location.hash.split('?')[0]!=='#/search'||!api||api!==window.ApiClient||!context.api)return null;
  try{const user=api.getCurrentUserId(),server=api.serverId?.(),credential=api.accessToken?.(),params=new URLSearchParams(location.hash.split('?')[1]||'');
   if(!user||user===SIMPLE||context.user?.Id!==user||!server||!credential||params.get('serverId')&&params.get('serverId')!==server)return null;
   if(api!==window.ApiClient||api.serverId?.()!==server||api.accessToken?.()!==credential||api.getCurrentUserId()!==user||api!==window.ApiClient)return null;
   return {api,user,server,credential,modernApi:context.api,route:location.hash,pathname:location.pathname,parent:params.get('parentId')||undefined,collection:params.get('collectionType')||undefined};
  }catch{return null;}
 }
 function queryTransition(a,b){const [ap,aq='']=a.split('?'),[bp,bq='']=b.split('?');if(ap!=='#/search'||bp!==ap)return false;const x=new URLSearchParams(aq),y=new URLSearchParams(bq);x.delete('query');y.delete('query');x.sort();y.sort();return x.toString()===y.toString();}
 function scopeCurrent(scope,context){
  if(!issuedScopes.has(scope)||scope.failed||scope.disposed)return false;
  const owner=mainScopeOwner(context);if(!same(scope,owner)||scope.pathname!==location.pathname||!same(scope.instance.owner,owner))return false;
  if(!scope.committed)return scope.route===location.hash;
  const root=scope.root,input=scope.input,roots=[...document.querySelectorAll('#searchPage')].filter(n=>n.isConnected&&!n.classList.contains('hide'));
  if(roots.length!==1||roots[0]!==root||root.parentElement!==scope.host||root.querySelector('#searchTextInput')!==input||!input?.isConnected||input.disabled||!input.getClientRects().length||scope.instance.activeScope?.root!==root)return false;
  // Only the local pending presentation survives a same-Page query transition.
  // Exact new-route enhancement readiness is still required separately.
  return scope.route===location.hash||queryTransition(scope.route,location.hash);
 }
 function decorateRequire(original){
  const cache=new Map(),React=original(63696),provider=original(69410);
  return new Proxy(original,{apply(target,receiver,args){const value=Reflect.apply(target,receiver,args),id=args[0];if(cache.has(id))return cache.get(id);
   if(id===63696&&typeof value.useEffect==='function'){
    const out=new Proxy(value,{get(object,key,receiver){const fn=Reflect.get(object,key,receiver);if(key!=='useEffect')return fn;
     return function(callback,deps){const owner=capture(provider.gf()),record=owner&&records.get(owner.route);return Reflect.apply(fn,this,[function(...args){const previous=activeEffect;activeEffect={owner,record};try{return Reflect.apply(callback,this,args);}finally{activeEffect=previous;}},deps]);};
    }});cache.set(id,out);return out;
   }
   if(id===84849&&typeof value.A==='function'){
    const Original=value.A;
    function PendingSearch(props){
     const context=provider.gf(),scope=props?.__orbitalSearchPageScope,service=window.OrbitalPhoneSearch,initialService=React.useRef(service),locked=React.useRef(false),[,update]=React.useState(0);
     const owned=service===initialService.current&&service===window.OrbitalLibrarySearch&&typeof service?.ownsReady==='function'&&typeof service?.subscribePresentation==='function'&&scopeCurrent(scope,context);if(!owned)locked.current=true;
     const ready=()=>{try{return owned&&scope.route===location.hash&&window.OrbitalPhoneSearch===service&&window.OrbitalLibrarySearch===service&&service?.ownsReady?.(scope.api,scope.route,scope.root)===true;}catch{return false;}};
     const isReady=ready();
     React.useLayoutEffect(()=>{
      let live=true;const changed=()=>{if(live&&!locked.current)update(n=>n+1);};
      const unsubscribe=owned&&service?.subscribePresentation?.(changed);
      if(owned)scope.listeners.add(changed);
      return()=>{live=false;scope?.listeners?.delete(changed);if(typeof unsubscribe==='function')unsubscribe();};
     },[scope,service,owned]);
     // No global singleton is mounted for this issued Main page scope, even
     // before its enhancement is ready or during the stock500ms debounce.
     if(locked.current)return React.createElement(Original,null);
     return React.createElement('span',{'data-orbital-search-pending':'local','data-orbital-search-ready':isReady?'true':'false',hidden:true,'aria-hidden':'true'});
    }
    const out=new Proxy(value,{get(object,key,receiver){return key==='A'?PendingSearch:Reflect.get(object,key,receiver);}});cache.set(id,out);return out;
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
  const pendingLoader=require(84849).A,PageShell=require(65242).A,bodyWrappers=new WeakMap();
  function scopedBody(child,scope){
   if(!scope||typeof child?.type!=='function'||child.ref!=null)return child;
   let Body=bodyWrappers.get(child.type);
   if(!Body){const OriginalBody=child.type;Body=function(props,...rest){const {__orbitalSearchPageScope:owner,...plain}=props,result=Reflect.apply(OriginalBody,this,[plain,...rest]);return result?.type===pendingLoader?React.cloneElement(result,{__orbitalSearchPageScope:owner}):result;};bodyWrappers.set(child.type,Body);}
   return React.createElement(Body,{...child.props,...(child.key==null?{}:{key:child.key}),__orbitalSearchPageScope:scope});
  }
  function Page(...args){const context=provider.gf(),main=mainScopeOwner(context),mainRef=React.useRef(null),owner=capture(context),initial=React.useRef(null),reference=React.useRef(null);if(!initial.current&&owner)initial.current=owner;
   const result=Reflect.apply(Original,this,args),child=result?.props?.children?.[1],props=child?.props;
   if(owner&&same(initial.current,owner)&&result?.props?.id==='searchPage'&&props&&(props.query||'')===owner.query&&props.parentId===owner.parent&&(!owner.query||props.collectionType===owner.collection)){
    if(!reference.current||reference.current.route!==owner.route){const old=reference.current;if(old){old.destroyed=true;old.observer?.disconnect();records.delete(old.route);}reference.current={...owner,queries:new Map(),commits:new Map(),generation:0};records.set(owner.route,reference.current);}
   }else if(reference.current){reference.current.destroyed=true;reference.current.observer?.disconnect();records.delete(reference.current.route);reference.current=null;}
   let scope=null;
   const first=result?.props?.children?.[0],immediate=first?.props?.query,params=new URLSearchParams(location.hash.split('?')[1]||'');
   if(main&&same(main,mainScopeOwner(context))&&result?.type===PageShell&&result.props.id==='searchPage'&&Array.isArray(result.props.children)&&result.props.children.length===2&&typeof first?.type==='function'&&typeof first.props.onSearch==='function'&&typeof child?.type==='function'&&child.ref==null&&props&&props.parentId===main.parent&&(!props.query||props.collectionType===main.collection)&&typeof immediate==='string'&&immediate===(params.get('query')||'')){
    if(!mainRef.current)mainRef.current={owner:main,activeScope:null};
    if(same(mainRef.current.owner,main)){scope={...main,instance:mainRef.current,immediate,committed:false,disposed:false,failed:false,listeners:new Set()};issuedScopes.add(scope);}
   }
   React.useLayoutEffect(()=>{
    if(!scope)return;scope.disposed=false;scope.failed=false;
    const roots=[...document.querySelectorAll('#searchPage')].filter(n=>n.isConnected&&!n.classList.contains('hide')),root=roots[0],input=root?.querySelector('#searchTextInput');
    if(roots.length!==1||!same(scope,mainScopeOwner(context))||scope.route!==location.hash||!input?.isConnected||input.disabled||input.value!==scope.immediate){scope.failed=true;for(const fn of [...scope.listeners])fn();return;}
    scope.root=root;scope.host=root.parentElement;scope.input=input;scope.committed=true;scope.instance.activeScope=scope;for(const fn of [...scope.listeners])fn();
    return()=>{scope.disposed=true;if(scope.instance.activeScope===scope)scope.instance.activeScope=null;};
   },[scope]);
   const r=reference.current;
   React.useLayoutEffect(()=>{if(!current(r))return;const root=document.getElementById('searchPage');if(!root?.isConnected||root.classList.contains('hide'))return;r.root=root;r.host=root.parentElement;r.observer=new MutationObserver(()=>schedule(r));r.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-id','class']});schedule(r);return()=>{r.destroyed=true;r.observer.disconnect();if(records.get(r.route)===r)records.delete(r.route);};},[r]);
   return scope?React.cloneElement(result,{children:[first,scopedBody(child,scope)]}):result;
  }
  return new Proxy(exports,{get(target,key,receiver){return key==='default'?Page:Reflect.get(target,key,receiver);}});
 },decorateRequire);
 window.addEventListener('orbital:page-retry',event=>{const r=records.get(location.hash);if(event.detail?.route===location.hash&&mounted(r))location.reload();});
 window.OrbitalStockSearchReady={supported:['#/search'],scope:'OFF_STOCK_QUERY_AND_PASSIVE_CARD_COMMIT_ONLY'};
}());

/* Fold7 profile: only the previously audited Android device identities activate it.
 * This is presentation targeting, not authorization; Jellyfin still owns permissions. */
(() => {
  'use strict';
  const ids = [];
  const H = document.documentElement, cacheKey = 'orbital-fold7-profile-v1';
  if (new URLSearchParams(location.search).get('orbital') === 'off') return;
  const android = /Android/i.test(navigator.userAgent);
  const ownedBuild = android && /OrbitalPhone\/1/.test(navigator.userAgent);
  let verified = false, currentId = '', pendingId = '', scheduled = false, gateTimer, routeKey = '';
  const small = matchMedia('(max-width:600px), (orientation:landscape) and (max-height:600px)');
  const diagnostics = {profile: false, transitions: []};
  const active = () => small.matches && !location.pathname.startsWith('/simple/') && window.ApiClient?.getCurrentUserId?.()!==(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-');
  const node = (tag, cls, text) => {const n=document.createElement(tag);n.className=cls;if(text!=null)n.textContent=text;return n;};
  const link = (label, href, cls='of7-action') => {const a=node('a',cls,label);a.href=href;return a;};
  function end(reason) {
    if (!H.classList.contains('of7-pending')) return;
    clearTimeout(gateTimer); H.classList.remove('of7-pending');
    const row=diagnostics.transitions.at(-1);if(row&&!row.end){row.end=Math.round(performance.now());row.reason=reason;}
  }
  function begin() {
    const path=location.hash.split('?')[0], key=location.hash;
    if (!active() || !['#/home','#/movies','#/tv'].includes(path)) {end('route');return;}
    if(path==='#/home'&&new URLSearchParams(location.hash.split('?')[1]||'').get('tab')==='1'){end('native tab');return;}
    if(new URLSearchParams(location.hash.split('?')[1]||'').get('orbitalBrowse')==='all'){end('native browse');return;}
    if(routeKey===key)return;routeKey=key;
    H.classList.add('of7-pending');diagnostics.transitions.push({route:path,start:Math.round(performance.now())});
    if(diagnostics.transitions.length>30)diagnostics.transitions.shift();
    clearTimeout(gateTimer);gateTimer=setTimeout(()=>end('fallback timeout'),8000);
    queue();
  }
  function apply() {
    H.classList.toggle('orbital-fold7',active());diagnostics.profile=active();
    if(active())begin();else end('profile inactive');
    queue();
  }
  async function identify() {
    if(ownedBuild){verified=true;apply();return;}if(!android)return;
    const api=window.ApiClient;
    if(typeof api?.deviceId!=='function')return;
    let id;try{id=api.deviceId();}catch{return;}
    if(!id||id===currentId||id===pendingId)return;pendingId=id;
    try {
      const sum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)))).map(b=>b.toString(16).padStart(2,'0')).join('');
      if(api!==window.ApiClient||api.deviceId()!==id)return;
      currentId=id;verified=ids.includes(sum);
      try{if(verified)localStorage.setItem(cacheKey,sum);else localStorage.removeItem(cacheKey);}catch{/* Storage is optional. */}
      apply();
    } catch {verified=false;apply();} finally {pendingId='';}
  }
  function ready() {
    if(!H.classList.contains('of7-pending'))return;
    const path=location.hash.split('?')[0];
    const parent=path==='#/home'?document.querySelector('#homeTab.is-active'):document.querySelector(path==='#/movies'?'#moviesPage':'#tvshowsPage, #tvPage');
    const root=parent?.querySelector(':scope > .ob5-browse');
    if(root?.getClientRects().length && root.dataset.loaded && (path!=='#/home'||root.querySelector('.ob5-feature')))end('content ready');
  }
  function searchScopes() {
    if(!location.hash.startsWith('#/search'))return;
    const input=document.querySelector('#searchTextInput');if(!input||!input.getClientRects().length||document.querySelector('.of7-search-scopes')?.isConnected)return;
    input.dataset.of7Scopes='1';input.setAttribute('aria-label','Search movies and shows');input.placeholder='Search movies and shows';
    const nav=node('nav','of7-search-scopes');nav.setAttribute('aria-label','Search in');
    const library=node('span','of7-action','Movies & shows');library.setAttribute('aria-current','page');
    const channels=link('Channels','#/livetv?tab=2'),games=link('Games','#/livetv?tab=0&sports=1');nav.append(library,channels,games);
    const update=()=>{const q=encodeURIComponent(input.value.trim());channels.href='#/livetv?tab=2&phoneQuery='+q;games.href='#/livetv?tab=0&sports=1&phoneQuery='+q;};
    if(input._of7ScopeUpdate)input.removeEventListener('input',input._of7ScopeUpdate);input._of7ScopeUpdate=update;input.addEventListener('input',update);update();input.closest('.searchFields')?.after(nav);
    if(!nav.isConnected)input.parentElement.parentElement.after(nav);
  }
  function tidyDetails() {
    if(!location.hash.startsWith('#/details'))return;
    for(const page of document.querySelectorAll('.detailPage')) {
      const keep=page.querySelector('.orbital-keep-available'),note=page.querySelector('.orbital-keep-note');
      if(note){const show=!!keep?.getClientRects().length&&getComputedStyle(keep).display!=='none';if(note.hidden===show)note.hidden=!show;}
    }
  }
  function scan() {scheduled=false;ready();if(!verified)return;searchScopes();tidyDetails();}
  function queue() {if(!scheduled){scheduled=true;requestAnimationFrame(scan);}}
  // Now/Next uses only the same authenticated guide response as the full grid.
  function nowNext(rows,programmes,api) {
    const list=node('div','of7-now-next');list.id='otv-guide-results';list.tabIndex=-1;list.setAttribute('aria-label','Now and next on your channels');
    const now=Date.now(),byChannel=new Map();
    for(const p of programmes){if(!byChannel.has(p.ChannelId))byChannel.set(p.ChannelId,[]);byChannel.get(p.ChannelId).push(p);}
    const detail=id=>'#/details?id='+encodeURIComponent(id)+'&serverId='+encodeURIComponent(api.serverId());
    const clock=s=>new Date(s).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    let divided=false;
    for(const c of rows){
      if(c.__noSchedule&&!divided&&list.childElementCount){divided=true;list.append(node('h3','of7-guide-divider','Live channels without a schedule'));}
      const card=node('article','of7-guide-card'),head=node('div','of7-guide-heading');
      if(c.ImageTags?.Primary){const img=node('img','');img.src=api.getImageUrl(c.Id,{type:'Primary',tag:c.ImageTags.Primary,maxWidth:120,quality:85});img.alt='';img.loading='lazy';head.append(img);}
      head.append(link((c.Number?c.Number+' · ':'')+c.Name,detail(c.Id),'of7-guide-name'),link('Watch',detail(c.Id)+'&orbitalAutoplay=1'));
      card.append(head);const all=(byChannel.get(c.Id)||[]).slice().sort((a,b)=>new Date(a.StartDate)-new Date(b.StartDate));
      const current=all.find(p=>new Date(p.StartDate)<=now&&new Date(p.EndDate)>now);
      const next=all.find(p=>new Date(p.StartDate)>now);
      if(!current&&!next){const row=node('div','of7-guide-programme');row.append(node('strong','','Live'),node('span','of7-muted','No guide listing · tap Watch to tune in'));card.append(row);list.append(card);continue;}
      for(const [label,p] of [['Now',current],['Next',next]]){
        const row=node('div','of7-guide-programme');row.append(node('strong','',label));
        if(p){const a=link(p.Name,detail(p.Id),'of7-programme-link');a.append(node('small','',clock(p.StartDate)+' – '+clock(p.EndDate)));row.append(a);if(label==='Now'){const span=new Date(p.EndDate)-new Date(p.StartDate),pct=span>0?Math.max(0,Math.min(100,(now-new Date(p.StartDate))/span*100)):0;const bar=node('span','of7-progress');bar.style.setProperty('--p',pct.toFixed(1)+'%');bar.setAttribute('aria-hidden','true');row.append(bar);}}
        else row.append(node('span','of7-muted',label==='Now'?'Schedule unavailable':'No later listing in this window'));
        card.append(row);
      }list.append(card);
    }return list;
  }
  window.OrbitalPhone={active,ownsDevice:()=>verified,begin,end,nowNext,diagnostics};
  try{verified=ownedBuild||(android&&ids.includes(localStorage.getItem(cacheKey)));}catch{/* Memory-only identity check follows. */}
  apply();small.addEventListener('change',()=>{routeKey='';apply();});
  addEventListener('hashchange',()=>{routeKey='';identify();begin();queue();});
  addEventListener('pageshow',()=>{identify();queue();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){identify();queue();}});
  new MutationObserver(records=>{if((verified||H.classList.contains('of7-pending'))&&records.some(r=>r.addedNodes.length))queue();}).observe(H,{childList:true,subtree:true});
  let attempts=0;const identityTimer=setInterval(()=>{identify();if(++attempts>=120||currentId)clearInterval(identityTimer);},250);
})();


/* Shared library search: route-owned requests, retained results and bounded inactive cache. */
(() => {
 'use strict';
 const cache=new Map(),presentationListeners=new Set();let mounted=null,identity='',identityOwner=null;
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
 const account=api=>api.serverId()+'|'+api.getCurrentUserId();
 const capture=api=>({api,user:api.getCurrentUserId(),server:api.serverId(),credential:api.accessToken?.()});
 const same=(owner,api=window.ApiClient)=>{try{return !!owner&&owner.api===api&&owner.user===api?.getCurrentUserId()&&owner.server===api?.serverId()&&owner.credential===api?.accessToken?.();}catch{return false;}};
 const onSearch=()=>/^#\/search(?:[?]|$)/.test(location.hash);
 const storeKey=k=>'orbital-phone-search-v2:'+k;
 const fold=v=>String(v||'').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
 const relevance=(item,query)=>{const title=fold(item.Name),q=fold(query);return title===q?0:title.replace(/^the /,'')===q?1:title.startsWith(q)?2:title.includes(q)?3:4;};
 function rank(rows,query){return rows.slice().sort((a,b)=>relevance(a,query)-relevance(b,query)||String(a.SortName||a.Name||'').localeCompare(String(b.SortName||b.Name||''),undefined,{numeric:true})||String(a.Id).localeCompare(String(b.Id)));}
 function distance(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);for(let j=1;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){const cost=a[i-1]===b[j-1]?0:1;d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}return d[a.length][b.length];}
 async function closeMatches(get,query,types){
  const q=fold(query),word=q.split(' ').filter(w=>w.length>=4).sort((a,b)=>b.length-a.length)[0];if(q.length<4||!word)return [];
  const pieces=new Set();for(let i=0;i<word.length;i++)pieces.add(word.slice(0,i)+word.slice(i+1));pieces.add(word.slice(0,3));pieces.add(word.slice(-3));const found=new Map();
  await Promise.all([...pieces].filter(p=>p.length>=3).slice(0,8).map(async term=>{try{const d=await get({SearchTerm:term,Recursive:true,IncludeItemTypes:types,Limit:40,Fields:'ProductionYear',EnableImages:false,EnableUserData:false,EnableTotalRecordCount:false});for(const i of d.Items||[])found.set(i.Id,i);}catch{}}));
  const limit=q.length<=5?1:2,span=q.split(' ').length,score=i=>{const t=fold(i.Name).split(' ').filter(Boolean);let best=99;for(let k=0;k<t.length;k++)for(const n of [span-1,span,span+1])if(n>=1&&k+n<=t.length)best=Math.min(best,distance(q,t.slice(k,k+n).join(' ')));return best;};
  return [...found.values()].map(i=>[score(i),i]).filter(([d])=>d<=limit).sort((a,b)=>a[0]-b[0]||String(a[1].Name).length-String(b[1].Name).length).slice(0,60).map(([,i])=>i);
 }
 function remember(m,selected){
  if(!m||!m.root.isConnected||location.hash!==m.route||!same(m.owner)||m.restoring)return;
  m.state.scroll=window.scrollY;
  const cards=[...m.grid.children];const first=selected||cards.find(e=>e.getBoundingClientRect().bottom>180);
  if(first){m.state.anchor=first.dataset.itemId;m.state.offset=first.getBoundingClientRect().top;}
  m.state.touched=Date.now();
  try{sessionStorage.setItem(storeKey(m.key),JSON.stringify({query:m.state.query,type:m.state.type,year:m.state.year,loaded:m.state.cursor,anchor:m.state.anchor,offset:m.state.offset,scroll:m.state.scroll,at:Date.now()}));}catch{}
 }
 function notifyPresentation(){for(const fn of [...presentationListeners]){try{fn();}catch{}}}
 function ownsReady(api,route,stockRoot){
  const m=mounted;if(!m||location.pathname.startsWith('/simple/')||new URLSearchParams(location.search).get('orbital')==='off'||m.user===(window.OrbitalConfig&&window.OrbitalConfig.simpleModeUser||'-')||api!==window.ApiClient||api!==m.api||route!==location.hash||route!==m.route||document.getElementById('searchPage')!==stockRoot||!stockRoot?.isConnected||stockRoot.classList.contains('hide')||!stockRoot.contains(m.root)||!stockRoot.contains(m.input)||m.readyGeneration!==m.generation||!m.readyValid?.())return false;
  const roots=[...document.querySelectorAll('#searchPage')].filter(n=>n.isConnected&&!n.classList.contains('hide'));if(roots.length!==1||roots[0]!==stockRoot)return false;
  const snapshot=window.OrbitalPageReady?.snapshot();return snapshot?.ready===true&&snapshot.kind==='content'&&snapshot.route===route&&snapshot.userId===m.user;
 }
 function subscribePresentation(fn){if(typeof fn!=='function')return()=>{};presentationListeners.add(fn);return()=>presentationListeners.delete(fn);}
 function release(){if(!mounted)return;remember(mounted);mounted.generation++;clearTimeout(mounted.timer);mounted.input.removeEventListener('input',mounted.changed);mounted.input.removeEventListener('keydown',mounted.enter);for(const event of ['pointerdown','wheel','touchstart','keydown'])window.removeEventListener(event,mounted.stopRestore,true);clearTimeout(mounted.restoreTimer);if(mounted.legacy?.isConnected)mounted.legacy.hidden=mounted.legacyHidden;mounted.standard?.remove();mounted.root.remove();mounted=null;notifyPresentation();}
 function prune(){let total=0;for(const [key,s] of [...cache].reverse()){total+=s.items.length;if(cache.size>4||total>1200){if(key!==identity)cache.delete(key);}}}
 function clearDisconnectedStandard(m){
  if(!m?.legacy)return;
  if(m.legacy.isConnected&&m.standard?.isConnected&&m.standard.parentElement===m.legacy.parentElement)return;
  m.legacy.hidden=m.legacyHidden;
  m.standard?.remove();m.standard=null;m.legacy=null;m.legacyHidden=undefined;
 }
 function bindStandard(m){
  clearDisconnectedStandard(m);
  if(m.legacy?.isConnected)return;m.standard?.remove();
  const legacy=[...document.querySelectorAll('.searchResults')].find(e=>e.getClientRects().length);if(!legacy)return;
  const standard=make('details',null,'of7-standard-search');legacy.before(standard);standard.append(make('summary','Other media and standard search'));
  m.standard=standard;m.legacy=legacy;m.legacyHidden=legacy.hidden;legacy.hidden=true;
  standard.addEventListener('toggle',()=>{if(mounted===m&&m.legacy===legacy&&m.standard===standard&&legacy.isConnected&&standard.isConnected&&standard.parentElement===legacy.parentElement)legacy.hidden=!standard.open;});
 }
 function mount(input,api,user){
  if(!onSearch()||!input?.isConnected)return;
  let owner;try{owner=capture(api);}catch{return;}if(!same(owner)||owner.user!==user)return;
  const route=location.hash,key=account(api);
  if(mounted?.input===input&&mounted.key===key&&mounted.route===route&&same(mounted.owner)&&mounted.root.isConnected){bindStandard(mounted);mounted.present?.();return;}
  release();if(identityOwner&&!same(identityOwner,api)){cache.clear();try{sessionStorage.removeItem(storeKey(identity));}catch{}}identity=key;identityOwner=owner;
  let state=cache.get(key),restoring=!!state;
  if(!state){let saved=null;try{saved=JSON.parse(sessionStorage.getItem(storeKey(key)));}catch{}
   if(saved&&Date.now()-saved.at>1800000)saved=null;
   state={query:saved?.query||input.value.trim(),type:saved?.type||'Movie,Series',year:saved?.year||'',items:[],cursor:0,total:null,fuzzy:false,hasDuplicates:false,anchor:saved?.anchor,offset:saved?.offset,scroll:saved?.scroll||0,restoreCount:Math.min(1200,saved?.loaded||60)};restoring=!!saved;
   cache.set(key,state);
  }
  const routeParams=new URLSearchParams(route.split('?')[1]||'');
  const requestedQuery=routeParams.has('query')?String(routeParams.get('query')||'').trim():state.pendingQuery;
  if(requestedQuery!==undefined&&requestedQuery!==state.query){
   state={...state,query:requestedQuery,items:[],cursor:0,total:null,fuzzy:false,hasDuplicates:false,anchor:null,offset:undefined,scroll:0,restoreCount:0};
   cache.set(key,state);restoring=false;
  }
  delete state.pendingQuery;
  const root=make('section',null,'ob5-search-refinement of7-search-retained'),form=make('div',null,'ob5-chip-row ob5-search-filters'),type=make('select',null,'ob5-button'),year=make('input',null,'ob5-button'),status=make('p'),grid=make('div',null,'ob5-grid'),more=make('button','Show more results','ob5-button'),submit=make('button','Apply filters','ob5-button');
  root.setAttribute('aria-label','Complete library search');type.setAttribute('aria-label','Result type');year.setAttribute('aria-label','Release year');year.type='number';year.min='1880';year.max=String(new Date().getFullYear()+3);year.placeholder='Any year';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  for(const [v,label] of [['Movie,Series','Movies and shows'],['Movie','Movies'],['Series','TV shows'],['Person','People']]){const o=make('option',label);o.value=v;type.append(o);}
   const scopes=make('nav',null,'ob5-complete-search-scopes'),channels=make('a','Channels','ob5-button'),sports=make('a','Sports','ob5-button');scopes.setAttribute('aria-label','Other search scopes');scopes.append(channels,sports);
   const updateScopes=()=>{const q=encodeURIComponent(input.value.trim());channels.href='#/livetv?tab=2&phoneQuery='+q;sports.href='#/livetv?tab=0&sports=1&phoneQuery='+q;};
   type.value=state.type;year.value=state.year;input.value=state.query;updateScopes();form.append(type,year,submit);root.append(make('h2','Search your library'),scopes,form,status,grid,more);
  const anchor=input.closest('.searchFields')||input.parentElement,scope=anchor.nextElementSibling;(scope?.classList.contains('of7-search-scopes')?scope:anchor).after(root);
  const m=mounted={key,input,api,user,owner,route,host:root.parentElement,state,root,grid,status,more,type,year,generation:0,busy:false,restoring,restoreTarget:{anchor:state.anchor,offset:state.offset,scroll:state.scroll}};
  bindStandard(m);
  const owned=()=>mounted===m&&root.isConnected&&root.parentElement===m.host&&location.hash===route&&same(owner)&&owner.user===user;
  const valid=run=>owned()&&run===m.generation;
  const matchesControls=()=>state.query===input.value.trim()&&state.type===type.value&&state.year===year.value;
  m.present=()=>{
   if(!owned()||m.busy||!matchesControls())return;
   const generation=m.generation;
   root.dataset.phase='complete';root.dataset.pageReadyRoute=route;root.dataset.pageReadyUser=user;
   const readyValid=()=>owned()&&m.generation===generation&&!m.busy&&matchesControls();
   Promise.resolve(window.OrbitalPageReady?.prepare(root,{...owner,host:m.host,retain:true,valid:readyValid})).then(ok=>{if(ok===true&&readyValid()){m.readyGeneration=generation;m.readyValid=readyValid;notifyPresentation();}});
  };
  m.presentFirst=()=>{
   const generation=m.generation;
   const firstUseful=()=>owned()&&m.generation===generation&&matchesControls()&&input.isConnected&&!input.disabled&&type.isConnected&&!type.disabled&&year.isConnected&&!year.disabled&&submit.isConnected&&!submit.disabled&&root.contains(form)&&root.contains(status)&&!!root.querySelector('h2')?.textContent.trim()&&[input,type,year,submit].every(n=>n.getClientRects().length>0);
   if(!firstUseful())return;
   const readyValid=()=>firstUseful();
   Promise.resolve(window.OrbitalPageReady?.prepare(root,{...owner,route,host:m.host,firstUseful,valid:readyValid})).then(ok=>{if(ok===true&&readyValid()){m.readyGeneration=generation;m.readyValid=readyValid;notifyPresentation();}});
  };
  root.dataset.phase='loading';root.dataset.presentable='pending';
  window.OrbitalPageReady?.begin(route);
  function render(){
   const old=new Map([...grid.children].map(e=>[e.dataset.itemId,e]));const frag=document.createDocumentFragment();
   for(const item of state.items){let a=old.get(item.Id);if(!a){a=make('a',null,'ob5-search-result');a.dataset.itemId=item.Id;const art=make('div',null,'ob5-search-art'),fallback=make('div',null,'ob5-search-art-fallback');fallback.innerHTML='<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="12" y="10" width="40" height="44" rx="4"/><path d="M22 10v44M42 10v44M12 21h10m-10 11h10m-10 11h10m20-22h10M42 32h10M42 43h10"/></svg>';fallback.setAttribute('aria-hidden','true');const img=make('img');img.loading='lazy';img.decoding='async';img.alt='';img.width=180;img.height=270;img.src=api.getImageUrl(item.Id,{type:'Primary',maxWidth:360,quality:85});img.onerror=()=>{img.hidden=true;art.classList.add('has-fallback');};art.append(fallback,img);a.append(art,make('strong'),make('span'));}
    a.href='#/details?id='+encodeURIComponent(item.Id)+'&serverId='+encodeURIComponent(api.serverId());a.querySelector('strong').textContent=String(item.Name||'Untitled').replace(/\s+/g,' ').trim();a.querySelector(':scope > span').textContent=[item.ProductionYear,item.Type==='Person'?'Person':item.Type==='Series'?'TV show':'Movie'].filter(Boolean).join(' · ');frag.append(a);
   }grid.replaceChildren(frag);
    root.dataset.fetchedCount=String(state.cursor);
    status.textContent=!state.query?'Enter a title above. Filters search every permitted movie and show.':state.fuzzy?'No exact match for “'+state.query+'”. Showing '+state.items.length+' close match'+(state.items.length===1?'':'es')+'.':state.items.length?'Showing '+state.items.length+(!state.hasDuplicates&&state.total!=null?' of '+state.total:'')+' matching titles':'No matching titles. Try a different year or title.';
    more.hidden=!state.query||state.fuzzy||(state.total!=null&&state.cursor>=state.total);more.disabled=false;more.textContent='Show more results';
  }
  function restore(){if(!m.restoring||!valid(m.generation))return;input.blur();const t=m.restoreTarget,a=[...grid.children].find(e=>e.dataset.itemId===t.anchor);if(a)window.scrollBy(0,a.getBoundingClientRect().top-(t.offset??180));else window.scrollTo(0,t.scroll||0);}
  function settleRestore(){if(!m.restoring)return;clearTimeout(m.restoreTimer);restore();for(const delay of [100,350,700])setTimeout(()=>{if(valid(m.generation))restore();},delay);m.restoreTimer=setTimeout(()=>{if(valid(m.generation)){restore();m.restoring=false;remember(m);}},1000);}
  async function load(reset=false,refresh=false){
    if(!owned())return;
    if(reset){m.generation++;m.busy=false;m.retryRefresh=false;state.query=input.value.trim();state.type=type.value;state.year=year.value;state.items=[];state.cursor=0;state.total=null;state.fuzzy=false;state.hasDuplicates=false;state.anchor=null;state.scroll=0;m.restoring=false;root.removeAttribute('aria-busy');render();}
   if(m.busy)return;
   if(!state.query){render();m.present();return;}
   if(state.year&&(!year.checkValidity()||!/^\d{4}$/.test(state.year))){status.textContent='Enter a four-digit release year, or leave it blank.';more.hidden=true;m.present();return;}
   const run=++m.generation;m.busy=true;root.dataset.phase='loading';root.dataset.presentable='pending';more.disabled=true;root.setAttribute('aria-busy','true');status.textContent=refresh?'Refreshing your saved results…':'Searching your library…';m.presentFirst();
   const target=refresh?Math.max(60,state.cursor,state.restoreCount||0):60,start=refresh?0:state.cursor;
   try{
    const params={SearchTerm:state.query,Recursive:true,IncludeItemTypes:state.type,StartIndex:start,Limit:target,EnableTotalRecordCount:true,Fields:'ProductionYear,PrimaryImageAspectRatio',SortBy:'SortName',SortOrder:'Ascending'};if(state.year)params.Years=state.year;
     let timeout;const get=params=>api.ajax({type:'GET',url:api.getUrl('Users/'+user+'/Items',params),dataType:'json'});
     const work=async()=>{let d=await get(params);if(!valid(run))return d;if(start===0&&Array.isArray(d.Items)&&!d.Items.length&&!state.year&&state.type!=='Person'){const close=await closeMatches(get,state.query,state.type);if(valid(run)&&close.length){d={Items:close,TotalRecordCount:close.length};state.fuzzy=true;}}return d;};
     const data=await Promise.race([work(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Search timeout')),20000);})]).finally(()=>clearTimeout(timeout));if(!valid(run))return;
     if(!Array.isArray(data.Items)||!Number.isFinite(data.TotalRecordCount)||data.TotalRecordCount<0||(!data.Items.length&&start<data.TotalRecordCount))throw Error('Incomplete search response');
     const rows=data.Items,all=refresh?rows:[...state.items,...rows];state.items=state.fuzzy?[...new Map(all.map(i=>[i.Id,i])).values()]:rank([...new Map(all.map(i=>[i.Id,i])).values()],state.query);state.cursor=start+rows.length;state.hasDuplicates=state.items.length<state.cursor;state.total=data.TotalRecordCount??(rows.length<target?start+rows.length:null);state.restoreCount=0;render();settleRestore();remember(m);prune();
    }catch{if(valid(run)){m.generation++;status.textContent='Search could not refresh. Your results are retained; retry when connected.';more.hidden=false;more.textContent='Retry search';m.retryRefresh=refresh;m.busy=false;more.disabled=false;root.removeAttribute('aria-busy');m.present();}}
   finally{if(valid(run)){m.busy=false;more.disabled=false;root.removeAttribute('aria-busy');m.present();}}
  }
   m.changed=()=>{if(!owned())return;state.pendingQuery=input.value.trim();updateScopes();m.generation++;notifyPresentation();m.busy=false;root.dataset.phase='loading';root.dataset.presentable='pending';root.removeAttribute('aria-busy');status.textContent=state.items.length?'Previous results for “'+state.query+'”. Waiting to search for “'+input.value.trim()+'”…':'Waiting to search for “'+input.value.trim()+'”…';clearTimeout(m.timer);m.restoring=false;m.timer=setTimeout(()=>load(true),350);};input.addEventListener('input',m.changed);submit.onclick=()=>{input.blur();load(true);};type.onchange=()=>load(true);year.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();year.blur();load(true);}};more.onclick=()=>{input.blur();year.blur();const refresh=m.retryRefresh;m.retryRefresh=false;load(false,refresh);};
   input.addEventListener('keydown',m.enter=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(m.timer);input.blur();load(true);}});
  grid.addEventListener('click',e=>{const a=e.target.closest('a[data-item-id]');if(a){m.restoring=false;remember(m,a);input.blur();}});
  m.stopRestore=()=>{m.restoring=false;clearTimeout(m.restoreTimer);};for(const event of ['pointerdown','wheel','touchstart','keydown'])window.addEventListener(event,m.stopRestore,{capture:true,passive:true});
  render();if(restoring)settleRestore();load(false,restoring);
 }
 // A stock React removal must clean its owned disclosure even while scan input is hidden.
 new MutationObserver(()=>clearDisconnectedStandard(mounted)).observe(document.documentElement,{childList:true,subtree:true});
 addEventListener('hashchange',()=>{if(mounted&&location.hash!==mounted.route)release();});
 addEventListener('orbital:page-retry',event=>{if(event.detail?.route!==location.hash||!mounted||!same(mounted.owner))return;const m=mounted;release();cache.delete(m.key);mount(m.input,m.api,m.user);});
 addEventListener('pagehide',()=>remember(mounted));
 let scrollTimer;addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>remember(mounted),80);},{passive:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)remember(mounted);});
  window.OrbitalLibrarySearch=window.OrbitalPhoneSearch={mount,ownsReady,subscribePresentation};
})();

/* Orbital Phone Game Center native playback. Keep the owning Game Center underneath
   the native fragment; use Jellyfin's plugin selection and serializable options. */
(function(root){
 'use strict';
 function create(host){
  let pending=null,selectionOwner='',selections=new Map();
  // Closed pending diagnostics: no caller data, timers, retries or lifecycle writes.
  let diagnosticRecords=0;
  function diagnosticClock(){try{const n=host.performance?.now();return Number.isFinite(n)?n:0;}catch{return 0;}}
  function diagnostic(run,stage=run.stage){
   if(!stage||diagnosticRecords>=64)return;
   try{
    diagnosticRecords++;
    const pendingAgeMs=Math.min(600000,Math.max(0,Math.floor(diagnosticClock()-run.began)));
    host.console?.info?.('ORBITAL_PHONE_PENDING_V1 '+JSON.stringify({schema:1,stage,pendingAgeMs,suppressedAttempts:run.suppressedAttempts}));
   }catch{/* Observation must never change playback settlement. */}
  }
  const api=()=>host.ApiClient;
  const identity=()=>{const a=api();return a?[a.serverId(),a.getCurrentUserId(),a.accessToken()].join('|'):'';};
  const gameKey=e=>e&&String(e.league||'')+'|'+String(e.id||'');
  const manager=()=>host.TelevisionPlayerBridge?.manager;
  function isNative(){
   try{return /\bOrbitalPhone\/1\b/.test(host.navigator?.userAgent||'')&&host.NativePlayer?.isEnabled()===true&&
    typeof manager()?.play==='function'&&!manager().syncPlayEnabled&&host.ExoPlayer?.id==='exoplayer'&&manager().getPlayers().includes(host.ExoPlayer);}
   catch{return false;}
  }
  function selected(event){const who=identity();if(selectionOwner!==who){selections.clear();selectionOwner=who;}return selections.get(gameKey(event))||null;}
  function message(dialog,text,retry=null,retryLabel='Retry feed'){
   if(!dialog?.isConnected)return;
   let node=dialog.querySelector('.otv-phone-play-status');
   const side=dialog.querySelector('.otv-gc-watch');if(!text){node?.remove();side?.classList.toggle('has-feed-feedback',!!side.querySelector('.otv-playback-retry'));return;}side?.classList.add('has-feed-feedback');
   if(!node){node=host.document.createElement('p');node.className='otv-gc-note otv-phone-play-status';node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');(dialog.querySelector('.otv-gc-watch')||dialog).append(node);}
   node.textContent=text;
   if(retry){const button=host.document.createElement('button');button.type='button';button.className='otv-gc-switch otv-phone-play-retry';button.textContent=retryLabel;button.onclick=retry;node.append(button);}
  }
  function feedPending(dialog,run,busy,current){
   if(!dialog?.isConnected)return;
   if(busy){dialog.__otvFeedPending=run;run.feedbackDialogs??=new Map();run.feedbackDialogs.set(dialog,current);}
   else if(dialog.__otvFeedPending===run)delete dialog.__otvFeedPending;else return;
   dialog.dispatchEvent(new host.Event('reconcile-feeds'));
  }
  function releaseFeedback(run){for(const [dialog,current] of run.feedbackDialogs||[]){const owned=dialog.__otvFeedPending===run;feedPending(dialog,run,false);if(owned&&dialog!==run.dialog&&current?.())message(dialog,'The earlier feed request has settled. Choose a feed to try again.');}}
  function nativeStarted(run,item){
   const {player,pm,beforeContext,beforeMirror}=run.native,c=player._lifecycle,m=player.getCurrentMediaSource();
   run.native.context=c;
   const opaque=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
   const uuid=/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$/;
   const equal=(a,b)=>a===b||typeof a==='string'&&typeof b==='string'&&uuid.test(a)&&uuid.test(b)&&a.replace(/-/g,'').toLowerCase()===b.replace(/-/g,'').toLowerCase();
   if(player!==host.ExoPlayer||pm!==manager()||!c||c===beforeContext||!m||m===beforeMirror||!Object.isFrozen(m)||c.retiring||c.detached||c.stream!==m||c.bridge!==host.NativePlayer||player._nativePlayer!==c.bridge)return false;
   player._owned(c);
   const a=c.actual,ownedItem=pm.currentItem(player),source=pm.currentMediaSource(player);
   return a&&opaque(c.epoch)&&opaque(c.lease)&&opaque(c.startRequest)&&opaque(m.playSessionId)&&opaque(m.mediaSourceId)&&opaque(m.itemId)&&(m.liveStreamId===null||opaque(m.liveStreamId))&&
    equal(c.selectedItem,item)&&equal(m.itemId,item)&&a.native_play_session_id===m.playSessionId&&a.media_source_id===m.mediaSourceId&&a.item_id===m.itemId&&a.live_stream_id===m.liveStreamId&&m.Id===m.mediaSourceId&&m.LiveStreamId===m.liveStreamId&&
    (c.selectedSource===null||c.selectedSource===m.mediaSourceId)&&pm.getCurrentPlayer()===player&&equal(ownedItem?.Id,item)&&ownedItem.ServerId===api().serverId()&&source?.Id===m.mediaSourceId&&source.LiveStreamId===m.liveStreamId&&pm.playSessionId(player)===m.playSessionId&&
    pm.failedNativePlayer?.()!==player&&player===host.ExoPlayer&&pm===manager()&&player._lifecycle===c&&player.getCurrentMediaSource()===m&&!c.retiring&&!c.detached;
  }
  async function play(event,sourceId=null,{dialog,returnToGame}={}){
   if(!pending&&!isNative())return false;
   const client=api(),who=identity(),game=gameKey(event),route=host.location?.hash;
   const current=()=>client===api()&&who===identity()&&game===gameKey(event)&&(!dialog||dialog.isConnected&&dialog.open&&(!dialog.__event||game===gameKey(dialog.__event)&&Date.parse(dialog.__event.start)===Date.parse(event.start)))&&route===host.location?.hash;
   if(pending){
    feedPending(dialog,pending,true,current);
    pending.suppressedAttempts=Math.min(65535,pending.suppressedAttempts+1);
    if((pending.suppressedAttempts&(pending.suppressedAttempts-1))===0)diagnostic(pending);
    if(pending.unknown){
     const owner=pending;owner.cleanupDialog=dialog;owner.cleanupCurrent=current;
     message(dialog,'The player has not finished closing. Retry cleanup before opening another feed.',()=>{if(current())void owner.recover();},'Retry cleanup');
    }else message(dialog,'A feed is already opening. Wait for it to finish, or close the active player before trying another feed.');
    return true;
   }

   const run={began:diagnosticClock(),stage:null,suppressedAttempts:0,failed:false,sourceId,dialog};pending=run;feedPending(dialog,run,true,current);
   try{
    if(!event?.id||!event.league||!client||!current())return true;
    const ui=host.TelevisionFeedUi;
    if(sourceId&&!ui?.manualAllowed(client.getCurrentUserId())){message(dialog,'Feed selection is not available for this account.');return true;}
    message(dialog,'Opening your feed…');
    // Retire an existing owned HTML feed through its reviewed cleanup before
    // opening native playback. Never leave its recovery timer competing with us.
    if(host.TelevisionPlayback?.snapshot?.()){
     run.stage='HTML_CLEANUP_PENDING';diagnostic(run);
     await host.TelevisionPlayback.cancel(true);
     if(!current())return true;
    }
    const start=new Date(event.start);if(!Number.isFinite(start.getTime()))throw Error('Invalid game date');
    const matches=value=>gameKey(value)===game&&Number.isFinite(Date.parse(value?.start))&&Date.parse(value.start)===start.getTime();
    const context=dialog?.__event||event;
    if(!matches(context)){message(dialog,'Refresh this game before opening a feed.');return true;}
    // Scoreboard freshness cannot renew the retained source inventory.
    const inventory=context.__otvFeedInventory||context;
    const inventoryFresh=()=>!ui.withFreshness({},inventory).stale;
    if(!sourceId&&!inventoryFresh()){message(dialog,'Refresh this game to update the feed choices.');return true;}
    const refresh=()=>client.ajax({type:'GET',url:client.getUrl('sports/api/game/'+event.id+'/state',{league:event.league,date:start.toLocaleDateString('en-CA',{timeZone:'America/Chicago'})}),dataType:'json',timeout:6000});
    // This endpoint refreshes game facts, not feed inventory. Preserve the exact
    // selected context's permitted sources and existing national/blackout policy.
    const refreshed=raw=>matches(raw)?{...context,...ui.withFreshness(raw,raw),sources:context.sources,source_policy:context.source_policy,postseason:context.postseason===true||raw.postseason===true,__otvFeedInventory:inventory}:null;
    const choose=value=>sourceId?ui.sources(value).find(s=>!s.automatic&&ui.manualAvailable(s)&&s.id===sourceId):ui.eligible(value)[0];
    const validSource=source=>source&&!source.automatic&&/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(source.id);
    // Recheck the existing server timestamp/policy at the tap. A still-fresh
    // Game Center selection need not wait for another full schedule inventory.
    let fresh=ui.withFreshness(context,context);
    if(fresh&&validSource(choose(fresh))&&(sourceId||!fresh.stale&&(fresh.state==='live'||fresh.watchable===true))){
     diagnostic(run,'CACHED_EVENT_ACCEPTED');
     // One bounded metadata refresh, never a feed switch or a playback retry.
     // The selected native item/context below remain immutable for this tap.
     if(!sourceId)Promise.resolve().then(refresh).then(response=>{
      if(!current())return;
      const value=refreshed(response);if(!value)return;
      Object.assign(context,value);
      if(dialog?.isConnected)dialog.dispatchEvent(new host.Event('reconcile-feeds'));
      diagnostic(run,'BACKGROUND_REFRESH_SETTLED');
     }).catch(()=>diagnostic(run,'BACKGROUND_REFRESH_FAILED'));
    }else{
     run.stage='REFRESHING_EVENT';diagnostic(run);
     fresh=refreshed(await refresh());
     if(!current())return true;
    }
    if(!fresh||!sourceId&&(fresh.stale||(fresh.state!=='live'&&fresh.watchable!==true))){message(dialog,fresh?.state==='final'?'This game has finished.':'Refresh this game before opening a feed.');return true;}
    if(sourceId&&!ui.manualAllowed(client.getCurrentUserId())){message(dialog,'Feed selection is not available for this account.');return true;}
    const source=sourceId?ui.sources(fresh).find(s=>!s.automatic&&ui.manualAvailable(s)&&s.id===sourceId):ui.eligible(fresh)[0];
    // Native PlayOptions parses Jellyfin UUID item IDs. Never pass a relay URL or
    // automatic alias, and never substitute another feed after a manual tap.
    if(!source||source.automatic||(sourceId?!ui.manualAvailable(source):!ui.automaticEligible(source))||!/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(source.id)){message(dialog,'This feed is no longer available. Refresh the game and choose another.');return true;}
    if(!current()||!isNative())return true;
    if(!sourceId&&!inventoryFresh()){message(dialog,'Refresh this game to update the feed choices.');return true;}
    const options={ids:[source.id],serverId:client.serverId(),fullscreen:true,enableRemotePlayers:false};
    // Optional context only; native discovery revalidates the day, event and actual channel.
    if(/^[0-9]{1,12}$/.test(String(fresh.id))&&['MLB','NFL','College football'].includes(fresh.league)){
     options.orbitalGameIntent={schema:1,event:String(fresh.id),league:fresh.league,channel:source.id.replace(/-/g,'').toLowerCase(),day:start.toLocaleDateString('en-CA',{timeZone:'America/Chicago'})};
    }
    // orbitalAttempt belongs to the HTML stream controller and contains cyclic
    // objects. Native ExoPlayerPlugin serializes these standard options as JSON.
    const player=host.ExoPlayer,pm=manager();
    if(['getCurrentMediaSource','_owned'].some(k=>typeof player[k]!=='function')||['getCurrentPlayer','currentItem','currentMediaSource','playSessionId','stopOwnedNative'].some(k=>typeof pm[k]!=='function')){
     message(dialog,'Update Orbital to open this feed with the current player.');return true;
    }
    run.native={player,pm,beforeContext:player._lifecycle,beforeMirror:player.getCurrentMediaSource()};
    run.stage='NATIVE_MANAGER_PENDING';diagnostic(run);
    await pm.play(options);
    diagnostic(run,'NATIVE_MANAGER_RETURNED');
    if(!nativeStarted(run,source.id))throw Error('Native start was not confirmed');
    if(current()){
     if(selectionOwner!==who){selections.clear();selectionOwner=who;}
     selections.delete(game);selections.set(game,source.id);while(selections.size>12)selections.delete(selections.keys().next().value);
     if(dialog){dialog.dataset.selectedFeed=source.id;dialog.dispatchEvent(new host.Event('reconcile-feeds'));}
     message(dialog,null);
     if(typeof returnToGame==='function')returnToGame({event:context,sourceId:source.id,dialog});
    }
   }catch(error){
    try{host.console?.info?.('ORBITAL_PHONE_FAILURE_V1 '+JSON.stringify({schema:1,code:['Exact native invocation unavailable','Native start was not confirmed','targetInfo cannot be null','player name cannot be null','START_IDENTITY_MISMATCH','NATIVE_REPLY_TIMEOUT'].includes(error?.message)?error.message:'OTHER',name:['Error','TypeError','NativeLifecycleError','OrbitalNavigationRetired'].includes(error?.name)?error.name:'OTHER',contextPresent:!!run.native?.player?._lifecycle,contextDetached:run.native?.player?._lifecycle?.detached===true,contextRetiring:run.native?.player?._lifecycle?.retiring===true}));}catch{}
    run.failed=true;
    const retryFeed=()=>{if(!current())return;if(isNative())void play(event,sourceId,{dialog,returnToGame});else message(dialog,'The player is not ready. Refresh this game and try again.');};
    if(run.native&&!Object.hasOwn(run.native,'context'))run.native.context=run.native.player._lifecycle;
    run.cleanupDialog=dialog;run.cleanupCurrent=current;
    const recover=async()=>{
     if(run.recovering)return;run.recovering=true;
     try{
      if(run.native){
       const {player,pm,context}=run.native;
       if(player!==host.ExoPlayer||pm!==manager()||player._lifecycle!==context)throw Error('Native owner changed');
       // A resolved old manager call may expose a newer accepted player. Its
       // context alone is not evidence that this tap owns its retirement.
       if(context&&!context.retiring&&!context.detached&&pm.failedNativePlayer?.()!==player)throw Error('An active native owner is not this failed invocation');
       run.stage='NATIVE_CLEANUP_PENDING';diagnostic(run);
       if(run.cleanupCurrent())message(run.cleanupDialog,'Closing the failed player…');
       const receipt=await pm.stopOwnedNative(player,true);
       if(player!==host.ExoPlayer||pm!==manager()||player._lifecycle!==context||!receipt||!Object.isFrozen(receipt)||receipt.player!==player||receipt.local_detached!==true||typeof receipt.pending_cancelled!=='boolean'||context&&context.detached!==true)throw Error('Native cleanup is not confirmed');
      }
      run.unknown=false;if(pending===run)pending=null;releaseFeedback(run);
      if(current())message(dialog,'The feed could not open. Try again or choose another feed.',retryFeed);
      else if(run.cleanupCurrent())message(run.cleanupDialog,'The player is closed. Choose a feed to try again.');
     }catch{
      run.unknown=true;run.stage='NATIVE_CLEANUP_UNKNOWN';diagnostic(run);
      if(run.cleanupCurrent())message(run.cleanupDialog,'The player has not finished closing. Retry cleanup before opening another feed.',()=>{if(run.cleanupCurrent())void recover();},'Retry cleanup');
     }finally{run.recovering=false;}
    };
    run.recover=recover;await recover();
   }
   finally{diagnostic(run,run.unknown?'NATIVE_CLEANUP_UNKNOWN':run.failed?'FAILED':'SETTLED');if(pending===run&&!run.unknown)pending=null;if(!run.unknown)releaseFeedback(run);}
   return true;
  }
  return {isNative,play,selected};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports=create;
 else if(root)root.OrbitalPhoneGamePlayback=create(root);
})(typeof window==='undefined'?null:window);
