/* Orbital for Jellyfin, public web edition. Picture-timed sync is not included; trackers use the estimated delay and Sync. */
/* Orbital for Jellyfin, customer edition (orbital-public-20261026). Loads before the Orbital shell.
 * - Tells the shell where its files live (works with or without a Jellyfin base URL).
 * - Sports: /sports/api/* is answered by the Orbital Sports plugin on this Jellyfin server when it is installed.
 *   Sports entry points appear only after the plugin answers for the signed-in person.
 *   The game you are watching keeps its tracker on an estimated delay with one-press "Sync to your picture".
 * - A basic player bridge connects the shell to stock Jellyfin's player (Sports Watch, watched-game tracker).
 * - Personal library, requests and service catalogues use configured same-server adapters.
 *   Optional integrations appear after the server confirms they are connected.
 * - ?orbital=off in the address bar shows stock Jellyfin for that page load.
 * Not affiliated with or endorsed by the Jellyfin project. */
(function () {
  'use strict';
  var me = document.currentScript && document.currentScript.src;
  var base = me ? new URL('./', me).pathname : '/web/orbital/';
  window.OrbitalAsset = base;
  // Artwork is supplied by an administrator-connected source, not a bundled logo pack.
  window.OrbitalArtwork = {
    url: function (value) {
      if (typeof value !== 'string' || !value || value.length > 2048) return '';
      try {
        var url = new URL(value, location.href);
        if (url.username || url.password || url.hash) return '';
        if (url.protocol !== 'https:' && !(url.origin === location.origin && url.protocol === 'http:')) return '';
        return url.href;
      } catch (_) { return ''; }
    },
    team: function (event, team) {
      var old = window.OrbitalTeamArt && window.OrbitalTeamArt[event.league + '|' + team.name] || {};
      return Object.assign({}, old, {url:this.url(team.logo) || this.url(old.url), abbr:team.abbreviation || team.abbr || old.abbr});
    }
  };
  window.OrbitalEdition = {
    edition: 'customer', layer: 'orbital-public-20261026',
    features: { sports: false, services: false, requests: false, downloads: false, experience: false, pictureLock: false }
  };
  var SPORTS = /(^|\/)sports\/api\/(status|catalogue|catalogues\/discover|events|rankings|tracker|preview|recap|boxscore|pitch-flight|batter-profile|team-directory|team|teams|team-preferences|team-videos|team-hub|game-explorer|game\/[0-9]{1,12}\/state)$/;
  var BLOCKED = /(^|\/)(sports\/api\/|cloud-download\/|simple\/|orbital\/requests\.html)/;
  var STATUS = /(^|\/)sports\/api\/status$/;
  function blocked(u) {
    try {
      var url = new URL(u, location.href);
      if (url.origin !== location.origin) return false;
      if (!BLOCKED.test(url.pathname)) return false;
      if (/\/sports\/api\/experience\/v1\//.test(url.pathname) && window.OrbitalEdition.features.experience) return false;
      // Sports data goes to the server only once the plugin has answered the status check (or did last visit);
      // until then it is answered locally, so a server without the plugin sees no sports requests at all.
      return !(SPORTS.test(url.pathname) && (STATUS.test(url.pathname) || window.OrbitalEdition.features.sports));
    } catch (e) { return false; }
  }
  var body = JSON.stringify({ error: 'unavailable', reason: 'not part of this edition' });
  var realFetch = window.fetch && window.fetch.bind(window);
  if (realFetch) {
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (blocked(u)) {
        return Promise.resolve(new Response(body, { status: 404, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  }
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (blocked(url)) args[1] = base + '__unavailable__.json'; // missing file: Jellyfin answers 404 locally
    return open.apply(this, args);
  };
  var root = document.documentElement, owner = null, liveFor = null, sportsFor = null;
  function current(o) {
    var api = window.ApiClient;
    return owner === o && api === o.api && api.getCurrentUserId() === o.user &&
      api.serverId() === o.server && api.accessToken() === o.credential;
  }
  function publish(r) {
    var features = window.OrbitalEdition.features, personal = !!(r && r.personal_library === true);
    features.sports = !!(r && r.sports === true);
    features.services = !!(r && r.services === true);
    features.experience = personal;
    features.requests = !!(r && r.requests === true && personal);
    root.classList.toggle('orbital-ce-sports', features.sports);
    root.classList.toggle('orbital-ce-services', features.services);
    root.classList.toggle('orbital-ce-personal', personal);
    root.classList.toggle('orbital-ce-requests', features.requests);
    window.OrbitalConfig = window.OrbitalConfig || {};
    window.OrbitalConfig.experienceService = personal;
    window.OrbitalExperienceConfig = { enabled: personal };
    window.OrbitalEdition.sports = features.sports ? {version:r.version,watchedGame:r.watched_game} : null;
    window.dispatchEvent(new Event('orbital:features-changed'));
  }
  root.classList.add('orbital-ce-no-livetv');
  function checks() {
    var api = window.ApiClient, uid = api && api.getCurrentUserId && api.getCurrentUserId();
    if (!uid) {
      if (owner) { owner = null; liveFor = sportsFor = null; publish(null); root.classList.add('orbital-ce-no-livetv'); }
      return;
    }
    if (!owner || !current(owner)) {
      owner = {api:api,user:uid,server:api.serverId(),credential:api.accessToken()};
      liveFor = sportsFor = null; publish(null); root.classList.add('orbital-ce-no-livetv');
    }
    var o = owner;
    if (liveFor !== o) {
      liveFor = o;
      api.getJSON(api.getUrl('LiveTv/Channels', {UserId:uid,Limit:1,EnableTotalRecordCount:true}))
        .then(function (r) { if(current(o)) root.classList.toggle('orbital-ce-no-livetv', !(r && r.TotalRecordCount > 0)); })
        .catch(function () { if(current(o)) { root.classList.add('orbital-ce-no-livetv'); liveFor = null; } });
    }
    if (sportsFor !== o) {
      sportsFor = o;
      api.getJSON(api.getUrl('sports/api/status'))
        .then(function (r) { if(current(o)) publish(r); })
        .catch(function (e) { if(current(o)) { publish(null); if(!e || e.status !== 404) sportsFor = null; } });
    }
  }
  setInterval(checks, 2000);

  // Stock Jellyfin does not track a native-owned stream as its current web player.
  // Before another explicit Play, wait for the plugin's exact previous lease to retire.
  function installNativeRetirement(player) {
    if (!player || player._orbitalPublicRetirement || typeof player.play !== 'function' || typeof player.stop !== 'function') return false;
    var original = player.play, starting = false;
    player.play = async function (options) {
      if (starting) throw new Error('A playback request is already in progress.');
      starting = true;
      try {
        if (this._lifecycle && !this._lifecycle.detached) await this.stop(true);
        return await original.call(this, options);
      } finally { starting = false; }
    };
    player._orbitalPublicRetirement = true;
    return true;
  }
  var nativeTimer = setInterval(function () {
    if (!window.NativePlayer || !window.ExoPlayer || !window.NativePlayer.getLifecycleProtocol) return;
    if (installNativeRetirement(window.ExoPlayer)) clearInterval(nativeTimer);
  }, 250);
  setTimeout(function () { clearInterval(nativeTimer); }, 60000);

  // Basic player bridge. The owner's server patches Jellyfin's core bundle to hand the shell its player manager
  // (window.TelevisionPlayerBridge, with feed-switch and picture hooks). Customers run stock Jellyfin, so without
  // this the Sports "Watch" buttons do nothing and the watched game never gets its tracker. Here we find stock
  // Jellyfin's own, already-running playback manager by its shape (no core edits), and:
  //  - tell the shell when a Live TV channel starts or stops, so the watched game gets its tracker on an estimated
  //    delay with "Sync to your picture" (the shell's untracked-channel path);
  //  - make Sports "Watch" open the chosen feed's channel in the normal player.
  // Never replaces a full bridge, and does nothing if the manager can't be found.
  function findManager() {
    var chunks = window.webpackChunk, req = null;
    if (!chunks || typeof chunks.push !== 'function') return null;
    try { chunks.push([['fp-bridge-' + Date.now()], {}, function (r) { req = r; }]); } catch (e) { return null; }
    if (!req || !req.m) return null;
    var ids = Object.keys(req.m);
    for (var i = 0; i < ids.length; i++) {
      var src = '';
      try { src = Function.prototype.toString.call(req.m[ids[i]]); } catch (e) { continue; }
      if (src.indexOf('getCurrentPlayer') < 0 || src.indexOf('playSessionId') < 0 || src.indexOf('setActivePlayer') < 0) continue;
      var mod; try { mod = req(ids[i]); } catch (e) { continue; } // loaded long ago by Jellyfin: returns its instance
      for (var k in mod) {
        var v; try { v = mod[k]; } catch (e) { continue; }
        if (v && typeof v === 'object' && typeof v.getCurrentPlayer === 'function' && typeof v.play === 'function' &&
            typeof v.playSessionId === 'function' && typeof v.currentItem === 'function') return v;
      }
    }
    return null;
  }
  function basicBridge() {
    var shell = window.TelevisionPlayback, events = window.Events, api = window.ApiClient;
    if (window.TelevisionPlayerBridge) return true; // the full bridge is present: nothing to add
    if (!shell || !events || typeof events.on !== 'function' || !api) return false;
    var pm = findManager();
    if (!pm) return false; // Retry while the stock player manager is still loading.
    var bridge = window.TelevisionPlayerBridge = { manager: pm, events: events, basic: true };
    var started = 0;
    events.on(pm, 'playbackstart', function (e, player) {
      var serial = ++started;
      // Let the player page settle first; the shell tears trackers down on the route change into the player.
      setTimeout(function () {
        if (serial !== started || window.TelevisionPlayerBridge !== bridge) return;
        try {
          var item = pm.currentItem(player);
          if (!item || !window.OrbitalEdition.features.sports) return;
          var stream = { item: item, mediaSource: pm.currentMediaSource(player), playSessionId: pm.playSessionId(player) };
          if (item.Type !== 'TvChannel' && item.Type !== 'LiveTvChannel') {
            window.TelevisionPlayback.playStarted(player, stream, null); // lets the shell clear any tracker
            return;
          }
          // Only hand a channel to the tracker when a live game is on it, so ordinary channels stay clean.
          var day = function (offset) {
            return new Date(Date.now() - offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
          };
          Promise.all([0, 1].map(function (o) { return api.getJSON(api.getUrl('sports/api/events', { date: day(o) })); }))
            .then(function (days) {
              if (serial !== started) return;
              var carried = days.some(function (d) {
                return ((d && d.events) || []).some(function (e) {
                  return e.state === 'live' && (e.carriers || []).indexOf(item.Id) >= 0;
                });
              });
              if (carried) window.TelevisionPlayback.playStarted(player, stream, null);
            })
            .catch(function () { /* sports unreachable: no tracker, playback unaffected */ });
        } catch (err) { /* tracker stays off; playback is unaffected */ }
      }, 1500);
    });
    events.on(pm, 'playbackstop', function (e, data) {
      started++;
      try { window.TelevisionTrackerOverlay && window.TelevisionTrackerOverlay.stopped(data); } catch (err) {}
    });
    function open(event, sourceId) {
      var ui = window.TelevisionFeedUi, list = (ui && ui.sources ? ui.sources(event) : event && event.sources) || [];
      var pick = null;
      for (var i = 0; i < list.length && sourceId; i++) if (list[i] && list[i].id === sourceId) pick = list[i];
      if (!pick && ui && ui.eligible) pick = ui.eligible(event)[0] || null;
      if (!pick) pick = list[0] || null;
      if (!pick) return Promise.resolve();
      var dialog = document.querySelector('dialog[open]');
      if (dialog) { try { dialog.close(); } catch (err) {} }
      // Use the normal details route so Jellyfin mounts its video surface before autoplay.
      // A direct manager.play call from Game Center can leave the app covering the video.
      if (pm.getCurrentPlayer() && pm.currentItem(pm.getCurrentPlayer())) return Promise.reject(new Error('Stop the current playback before starting this game.'));
      location.hash = '#/details?id=' + encodeURIComponent(pick.id) + '&serverId=' + encodeURIComponent(api.serverId()) + '&orbitalAutoplay=1';
      return Promise.resolve();
    }
    shell.start = function (event, sourceId) { return open(event, sourceId || (event && event.preferredSource)); };
    shell.select = function (event, sourceId) { return open(event, sourceId); };
    return true;
  }
  var bridgeTimer = setInterval(function () { if (basicBridge()) clearInterval(bridgeTimer); }, 250);
  setTimeout(function () { clearInterval(bridgeTimer); }, 60000);

  // Servers with several movie (or TV) libraries: the shell's Movies/TV Shows links carry no library, and stock
  // Jellyfin then opens whichever library it lists first, which may be small or empty. Open the largest instead
  // (every library stays in the menu, and Home already draws from all of them).
  var largest = {}, largestFor = null;
  var BARE = { '#/movies?collectionType=movies': ['movies', 'Movie', '#/movies'],
               '#/tv?collectionType=tvshows': ['tvshows', 'Series', '#/tv'] };
  function findLargest(api, uid) {
    largest = {};
    api.getJSON(api.getUrl('Users/' + uid + '/Views')).then(function (r) {
      var views = (r && r.Items) || [];
      Object.keys(BARE).forEach(function (bare) {
        var type = BARE[bare], mine = views.filter(function (v) { return v.CollectionType === type[0]; });
        if (mine.length < 2) return;
        Promise.all(mine.map(function (v) {
          return api.getJSON(api.getUrl('Items', { ParentId: v.Id, Recursive: true, IncludeItemTypes: type[1], Limit: 0,
                                                    EnableTotalRecordCount: true, UserId: uid }))
            .then(function (c) { return [(c && c.TotalRecordCount) || 0, v.Id]; }, function () { return [-1, v.Id]; });
        })).then(function (counts) {
          if (largestFor !== uid) return;
          counts.sort(function (a, b) { return b[0] - a[0]; });
          if (counts[0][0] > 0) largest[bare] = type[2] + '?topParentId=' + counts[0][1] + '&collectionType=' + type[0];
        });
      });
    }, function () { largestFor = null; });
  }
  setInterval(function () {
    var api = window.ApiClient, uid = api && api.getCurrentUserId && api.getCurrentUserId();
    if (uid && uid !== largestFor) { largestFor = uid; findLargest(api, uid); }
  }, 2000);
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    var to = a && largest[a.getAttribute('href')];
    if (to) { e.preventDefault(); e.stopPropagation(); location.hash = to; }
  }, true);
  window.addEventListener('hashchange', function () { // typed or opened from elsewhere
    var to = largest[location.hash];
    if (to) location.replace(to);
  });

  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return blocked(url) ? true : beacon(url, data); };
  }
})();
