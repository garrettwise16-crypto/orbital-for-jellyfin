"use strict";
// Server text is always inserted with textContent, never innerHTML.
const KEY = new URLSearchParams(location.hash.slice(1)).get("k") || sessionStorage.getItem("fpk") || "";
if (KEY) { sessionStorage.setItem("fpk", KEY); history.replaceState(null, "", "/"); }

const $ = (id) => document.getElementById(id);
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const S = { plexUrl: null, jfUrl: null, jfFresh: false, libs: [], people: null, runId: null, accounts: [], pollTimer: null };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { "X-FP-Key": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "That didn't work. Please try again.");
  return data;
}
const say = (m) => { $("live").textContent = m; };
function showError(m) { const e = $("error"); e.textContent = m || ""; e.hidden = !m; if (m) { say(m); e.scrollIntoView({ block: "nearest" }); } }
async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.setAttribute("aria-busy", "true"); showError("");
  try { return await fn(); } catch (e) { showError(e.message); } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); if (btn.isConnected && btn.dataset.keep !== "1") btn.textContent = label; }
}
function go(step) {
  if (step === "done") loadLiveTv().catch(e => { $("live-tv-out").textContent = e.message; });
  document.querySelectorAll("[data-panel]").forEach((s) => (s.hidden = s.dataset.panel !== step));
  let before = true;
  document.querySelectorAll("#steps li").forEach((li) => {
    const cur = li.dataset.step === (step === "features" ? "plan" : step); if (cur) before = false;
    li.classList.toggle("done", before); if (cur) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
  showError("");
  const h = document.querySelector(`[data-panel="${step}"] h1`); if (h) { h.tabIndex = -1; h.focus(); }
}
function setStatus(id, kind, title, sub) {
  const box = $(id); box.querySelector(".icon").className = `icon ${kind}`;
  box.querySelector(".sub").textContent = sub; box.querySelector("strong").textContent = title;
}
async function waitJob(onProgress) {
  for (;;) {
    const s = await api("GET", "/api/status");
    if (onProgress) onProgress(s.progress || {});
    if (!s.job.running) { if (s.job.error) throw new Error(s.job.error); return s.job.result; }
    await new Promise((r) => setTimeout(r, 600));
  }
}

// ---- 1. Start: automatic detection ---------------------------------------------------------------
async function detect() {
  const d = await api("POST", "/api/detect", { plexUrl: $("plex-url").value.trim() || null, jellyfinUrl: $("jf-url").value.trim() || null });
  const plex = d.plex.find((p) => p.found), jf = d.jellyfin.find((j) => j.found);
  S.plexUrl = plex && plex.url; S.jfUrl = jf && jf.url; S.jfFresh = !!jf && !jf.wizardCompleted;
  if (plex) setStatus("st-plex", "ok", "Plex found", `Version ${plex.version || "unknown"}${plex.needsSignIn ? ". You'll sign in on the next screen." : ""}`);
  else setStatus("st-plex", "warn", "Plex not found on this PC", "If Plex runs on another computer, use the link below.");
  const starting = !jf && d.jellyfin.some((j) => j.starting);
  const typedJf = $("jf-url").value.trim();
  if (jf) setStatus("st-jf", "ok", "Jellyfin found", S.jfFresh ? "Installed but not set up yet. We'll set it up for you." : `Version ${jf.version}`);
  else if (starting) setStatus("st-jf", "wait", "Jellyfin is starting up", "This takes a moment. This page continues by itself.");
  else if (typedJf) setStatus("st-jf", "warn", "Jellyfin didn't answer", `Nothing answered at ${typedJf}. Check the address, or that Jellyfin is running.`);
  else setStatus("st-jf", "todo", "Jellyfin isn't installed yet", "It's free. Install it below, then this page continues by itself.");
  $("jf-install").hidden = !!jf || starting || !!typedJf || journey() === "existing";
  $("st-plex").hidden = journey() !== "migration";
  const ready = !!jf && !S.installingServer && (journey() !== "migration" || !!plex); const btn = $("btn-start");
  btn.disabled = !ready; btn.textContent = ready ? "Get started" : plex ? "Waiting for Jellyfin..." : "Get started";
  clearTimeout(S.pollTimer);
  if (!jf) S.pollTimer = setTimeout(() => detect().catch(() => {}), starting ? 2000 : 5000);
  if (!plex && journey() === "migration") document.querySelector("details.adv").open = true;
  if (ready) say("Ready. Press Get started.");
}
$("btn-recheck").addEventListener("click", (ev) => busy(ev.target, detect));
$("btn-start").addEventListener("click", (ev) => busy(ev.target, showConnect));

// ---- 2. Connect ------------------------------------------------------------------------------------
async function showConnect() {
  go("connect");
  $("plex-card").hidden = journey() !== "migration";
  const r = journey() === "migration" ? await api("POST", "/api/plex/connect", { url: S.plexUrl }) : {ok: true};
  plexState(r.ok ? "connected" : "signin");
  const s = await api("GET", "/api/status");
  $("jf-icon").className = "icon todo";
  $("jf-intro").textContent = S.jfFresh
    ? "Jellyfin isn't set up yet. Choose a name and password for yourself. You'll use them to sign in to Jellyfin on your TV and phone too."
    : "Sign in with your Jellyfin administrator account. Your password is only used while this app is open.";
  $("pw-hint").textContent = S.jfFresh ? "At least 8 characters." : "";
  $("jf-pass").autocomplete = S.jfFresh ? "new-password" : "current-password";
  if (!$("jf-user").value && S.jfFresh) $("jf-user").value = s.suggestedName || "";
  $("btn-jf").textContent = S.jfFresh ? "Set up Jellyfin and continue" : "Continue";
  (r.ok ? ($("jf-user").value ? $("jf-pass") : $("jf-user")) : $("btn-plex-signin")).focus();
}
function plexState(kind) {
  $("plex-icon").className = `icon ${kind === "connected" ? "ok" : "todo"}`;
  $("plex-text").textContent = kind === "connected" ? "Connected. Plex is only read, never changed."
    : "Sign in so this app can read your libraries and what each person watched. A Plex page opens in a new tab; this app never sees your Plex password.";
  $("btn-plex-signin").hidden = kind === "connected";
}
$("btn-plex-signin").addEventListener("click", (ev) => busy(ev.target, async () => {
  const win = window.open("about:blank", "_blank");
  const { authUrl } = await api("POST", "/api/plex/signin/start");
  if (win) win.location = authUrl; else window.open(authUrl, "_blank", "noopener");
  const st = $("plex-signin-status"); st.textContent = "Finish signing in on the Plex page. This updates by itself.";
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await api("POST", "/api/plex/signin/poll", { url: S.plexUrl });
    if (p.status === "connected") { st.textContent = ""; plexState("connected"); $("jf-user").focus(); return; }
    if (p.status !== "waiting") { st.textContent = ""; throw new Error(p.message || "Plex sign-in didn't finish. Try again."); }
  }
  throw new Error("Plex sign-in timed out. Try again.");
}));
$("btn-showpw").addEventListener("click", () => {
  const show = $("jf-pass").type === "password"; $("jf-pass").type = show ? "text" : "password";
  $("btn-showpw").textContent = show ? "Hide" : "Show"; $("btn-showpw").setAttribute("aria-pressed", String(show));
});
$("jf-form").addEventListener("submit", (ev) => { ev.preventDefault(); busy($("btn-jf"), async () => {
  if (journey() === "migration" && !$("btn-plex-signin").hidden) throw new Error("Sign in to Plex first.");
  const name = $("jf-user").value.trim(), pw = $("jf-pass").value;
  if (!name) { $("jf-user").focus(); throw new Error("Enter a name."); }
  if (S.jfFresh && pw.length < 8) { $("jf-pass").focus(); throw new Error("Use at least 8 characters for the password."); }
  $("btn-jf").textContent = S.jfFresh ? "Setting up Jellyfin..." : "Signing in...";
  await api("POST", "/api/jellyfin/connect", { url: S.jfUrl, username: name, password: pw, createAdmin: S.jfFresh });
  $("jf-pass").value = "";
  await (journey() === "migration" ? showPlan() : showFeatures());
}); });

// ---- 3. Plan -----------------------------------------------------------------------------------------
const KIND = { movie: "Movies", show: "TV shows", artist: "Music", photo: "Photos" };
const ACTION = { reuse: "Already in Jellyfin", create: "Will be added", needs_path: "Folder needed", unsupported: "Not supported" };
const COMPLETE = { full: "Watched, resume points, ratings and playlists", history_only: "Watched titles (from Plex history)", unavailable: "Can't be read" };
async function showPlan() {
  go("plan"); say("Reading your Plex libraries"); document.querySelector('[data-panel="plan"] h1').textContent = "Here's the plan";
  $("review").hidden = true; $("checklist").hidden = true; $("setup-actions").hidden = false;
  $("plan-done").hidden = true; $("plan-summary").hidden = false; $("customize").hidden = false;
  $("btn-setup").disabled = true;
  $("plan-summary").replaceChildren(el("p", { class: "loading", text: "Reading your Plex libraries and finding the same folders for Jellyfin..." }));
  S.libs = (await api("GET", "/api/libraries")).rows;
  const s = await api("GET", "/api/status");
  $("btn-profiles").hidden = !s.plex.signedIn;
  S.people = await api("GET", "/api/users");
  S.orbital = await api("GET", "/api/orbital").catch(() => ({ available: false }));
  $("opt-orbital-wrap").hidden = !S.orbital.available;
  S.sports = S.orbital.available ? await api("GET", "/api/sports").catch(() => ({ available: false })) : { available: false };
  $("opt-sports-wrap").hidden = !S.sports.available;
  renderLibs(); renderPeople(); renderSummary();
  $("btn-setup").disabled = false; $("btn-setup").focus();
}
function userName(id) { const u = S.people.jellyfinUsers.find((x) => x.id === id); return u ? u.name : "?"; }
function renderSummary() {
  const box = $("plan-summary"); box.replaceChildren();
  const chosen = new Set([...document.querySelectorAll("#lib-rows input[type=checkbox]")].filter((c) => c.checked).map((c) => c.dataset.key));
  const libs = S.libs.filter((r) => chosen.has(r.sectionKey));
  const needs = S.libs.filter((r) => r.action === "needs_path");
  box.append(el("div", { class: "plan-row" }, el("span", { class: "pi lib", "aria-hidden": "true" }),
    el("div", {}, el("strong", { text: "Libraries" }), el("span", { text: libs.length ? `${libs.map((r) => r.title).join(", ")}, using the same folders as Plex. Nothing is copied or moved.` : "No libraries selected." }))));
  if (needs.length) {
    box.append(el("p", { class: "warn", text: `Jellyfin can't see the folder for ${needs.map((r) => r.title).join(", ")}. Open "Change" below to point to it.` }));
    $("customize").open = true;
  }
  const rows = currentChoices();
  const people = S.people.sources.map((p) => {
    const c = rows[p.key], who = p.key === "owner" ? "You" : p.name;
    if (c.mode === "skip") return `${who}: not copied`;
    return `${who} → ${c.mode === "create" ? `new Jellyfin account "${c.name}"` : `Jellyfin account "${userName(c.jfUserId)}"`}`;
  });
  box.append(el("div", { class: "plan-row" }, el("span", { class: "pi people", "aria-hidden": "true" }),
    el("div", {}, el("strong", { text: "Progress" }), ...people.map((t) => el("span", { text: t })))));
  if (S.orbital) {
    const on = S.orbital.available && $("opt-orbital").checked;
    box.append(el("div", { class: "plan-row" }, el("span", { class: "pi look", "aria-hidden": "true" }),
      el("div", {}, el("strong", { text: "Look" }), el("span", { text: on
        ? "The Orbital look for Jellyfin's web app: a cinematic Home, smarter browsing and richer show pages. One click switches back."
        : S.orbital.available ? "Jellyfin's standard look." : `Jellyfin's standard look. ${S.orbital.reason || ""}` }))));
  }
  if (S.sports && S.sports.available) {
    const on = sportsChosen();
    box.append(el("div", { class: "plan-row" }, el("span", { class: "pi sports", "aria-hidden": "true" }),
      el("div", {}, el("strong", { text: "Sports" }), el("span", { text: on
        ? "The games in your TV guide, in the Orbital look; connect TheSportsDB, a feed or ESPN's public data afterwards for scores, Game Center and play trackers. Free; Jellyfin restarts once."
        : "Not added. You can add sports later by running this app again." }))));
  }
  box.append(el("div", { class: "plan-row" }, el("span", { class: "pi copy", "aria-hidden": "true" }),
    el("div", {}, el("strong", { text: "What's copied" }), el("span", { text: "Watched titles, play counts, resume points, ratings, playlists and collections. Jellyfin's Home opens with Continue Watching, like Plex. You'll see the numbers before anything is copied." }))));
}
function renderLibs() {
  const tb = $("lib-rows"); tb.replaceChildren();
  for (const r of S.libs) {
    const ok = r.action === "reuse" || r.action === "create";
    const chk = el("input", { type: "checkbox", "aria-label": `Include ${r.title}`, checked: ok, disabled: !ok, "data-key": r.sectionKey, onchange: renderSummary });
    const st = el("td", {}, el("span", { class: `tag ${r.action}`, text: ACTION[r.action] || r.action }));
    for (const prob of r.problems) st.append(el("div", { class: "warn", text: prob }));
    if (r.action === "needs_path") for (const pp of r.plexPaths) {
      const inp = el("input", { "aria-label": `Folder for ${pp} as Jellyfin sees it`, placeholder: "Folder as Jellyfin sees it" });
      const b = el("button", { text: "Use this folder", onclick: () => busy(b, async () => {
        const res = await api("POST", "/api/libraries/path", { plexPath: pp, jfPath: inp.value.trim() });
        if (!res.ok) throw new Error("Jellyfin can't open that folder. Check the spelling.");
        S.libs = res.rows; renderLibs(); renderSummary();
      }) });
      st.append(el("div", { class: "row" }, inp, b));
    }
    const folders = el("td", {});
    r.plexPaths.forEach((p, i) => {
      folders.append(el("div", { class: "path", text: p }));
      if (r.jfPaths[i] && r.jfPaths[i] !== p) folders.append(el("div", { class: "sub", text: `Jellyfin sees it as ${r.jfPaths[i]}` }));
    });
    tb.append(el("tr", {}, el("td", {}, chk), el("th", { scope: "row" }, el("div", { text: r.title }), el("div", { class: "sub", text: KIND[r.kind] || r.kind })), folders, st));
  }
}
function renderPeople() {
  const tb = $("people-rows"); tb.replaceChildren();
  for (const p of S.people.sources) {
    const sel = el("select", { "aria-label": `Jellyfin account for ${p.name}`, "data-key": p.key, disabled: p.completeness === "unavailable", onchange: renderSummary });
    for (const u of S.people.jellyfinUsers) sel.append(el("option", { value: `existing:${u.id}`, text: `${u.name}${u.admin ? " (administrator)" : ""}` }));
    sel.append(el("option", { value: "create", text: `New account "${p.name}"` }), el("option", { value: "skip", text: "Don't copy" }));
    const g = p.suggestion; sel.value = p.completeness === "unavailable" ? "skip" : g.mode === "existing" ? `existing:${g.jfUserId}` : "create";
    const what = el("td", {}, el("div", { text: COMPLETE[p.completeness] || p.completeness }), p.note ? el("div", { class: "sub", text: p.note }) : null);
    if (p.note === "profile PIN required") {
      const pin = el("input", { type: "password", inputmode: "numeric", autocomplete: "off", maxlength: "4", size: "6", "aria-label": `Plex PIN for ${p.name}` });
      const b = el("button", { text: "Unlock", onclick: () => busy(b, async () => {
        await api("POST", "/api/plex/profiles", { home: true, pins: { [p.key.split(":")[1]]: pin.value } });
        S.people = await api("GET", "/api/users"); renderPeople(); renderSummary();
      }) });
      what.append(el("div", { class: "row" }, pin, b));
    }
    tb.append(el("tr", {}, el("th", { scope: "row", text: p.key === "owner" ? "You (Plex owner)" : p.name }), what, el("td", {}, sel)));
  }
}
function currentChoices() {
  const out = {};
  for (const sel of document.querySelectorAll("#people-rows select")) {
    const v = sel.value, src = S.people.sources.find((s) => s.key === sel.dataset.key);
    out[sel.dataset.key] = v.startsWith("existing:") ? { mode: "existing", jfUserId: v.slice(9) } : v === "create" ? { mode: "create", name: src.name } : { mode: "skip" };
  }
  return out;
}
$("opt-orbital").addEventListener("change", () => { $("opt-sports").disabled = !$("opt-orbital").checked; renderSummary(); });
$("opt-sports").addEventListener("change", () => renderSummary());
function sportsChosen() { return !!(S.sports && S.sports.available && $("opt-orbital").checked && $("opt-sports").checked); }
$("btn-profiles").addEventListener("click", (ev) => busy(ev.target, async () => {
  const r = await api("POST", "/api/plex/profiles", { home: true, history: $("chk-history").checked });
  say(`${n(r.added.length, "more person", "more people")} found`);
  S.people = await api("GET", "/api/users"); renderPeople(); renderSummary();
}));

const PHASES = { starting: "libraries", libraries: "libraries", scan: "scan", preview: "match", previewed: "match" };
function tick(p) {
  const order = ["libraries", "scan", "match"], cur = PHASES[p.phase];
  if (!cur) return;
  const idx = order.indexOf(cur);
  document.querySelectorAll("#checklist li").forEach((li, i) => {
    li.className = i < idx ? "done" : i === idx ? "active" : "";
    if (li.dataset.k === "scan" && cur === "scan" && p.message) li.textContent = p.message;
  });
}
$("btn-setup").addEventListener("click", (ev) => busy(ev.target, async () => {
  const include = [...document.querySelectorAll("#lib-rows input[type=checkbox]")].filter((c) => c.checked).map((c) => c.dataset.key);
  if (!include.length) throw new Error("Choose at least one library (open Change).");
  $("customize").open = false; $("setup-actions").hidden = true;
  const cl = $("checklist"); cl.hidden = false; cl.querySelectorAll("li").forEach((li) => (li.className = ""));
  cl.querySelector("li").className = "active"; say("Setting up Jellyfin");
  try {
    await api("POST", "/api/setup", { include, choices: currentChoices(), ratings: $("opt-ratings").checked, favorites: $("opt-fav").checked, homeLayout: $("opt-home").checked,
      orbital: !!(S.orbital && S.orbital.available && $("opt-orbital").checked), sports: sportsChosen() });
    const res = await waitJob(tick);
    cl.hidden = true; $("plan-summary").hidden = true; $("customize").hidden = true;
    const libs = [...document.querySelectorAll("#lib-rows input[type=checkbox]")].filter((c) => c.checked).map((c) => S.libs.find((r) => r.sectionKey === c.dataset.key).title);
    $("plan-done").replaceChildren(el("span", { class: "icon ok", "aria-hidden": "true" }), el("span", { text: `Jellyfin is set up with ${libs.join(", ")}. Nothing has been copied yet.` }));
    $("plan-done").hidden = false; document.querySelector('[data-panel="plan"] h1').textContent = "Almost done";
    S.runId = res.summary.runId; S.accounts = res.newAccounts || []; S.look = res.orbital; S.sportsDone = res.sports;
    renderReview(res);
  } catch (e) { $("setup-actions").hidden = false; throw e; }
}));

const CAT = { watched: "Marked watched", resume: "Resume points", rating: "Ratings", favorite: "Added to Favorites",
  count_or_date: "Play counts updated", kept_newer_jellyfin_state: "Kept newer progress already in Jellyfin" };
function renderReview(res) {
  const out = $("review-out"); out.replaceChildren();
  let total = 0;
  for (const u of res.summary.users) {
    const c = u.counts; total += c.toWrite || 0;
    const stats = el("ul", { class: "stats" });
    for (const [k, label] of Object.entries(CAT)) if (c["cat_" + k]) stats.append(el("li", {}, el("b", { text: String(c["cat_" + k]) }), el("span", { text: label })));
    const unresolved = (c.unmatched || 0) + (c.ambiguous || 0);
    out.append(el("div", { class: "card" }, el("h3", { text: u.source === "owner" ? "You" : u.name }),
      el("p", { class: "sub", text: `${c.matched || 0} of ${c.plexItems || 0} Plex videos found in Jellyfin` }), stats,
      unresolved ? el("p", { class: "warn", text: `${n(unresolved, "title", "titles")} with progress couldn't be matched safely and will be left alone. See the list below.` }) : null));
  }
  const L = res.summary.lists || {};
  if (L.playlists || L.collections) {
    const stats = el("ul", { class: "stats" });
    if (L.playlists) stats.append(el("li", {}, el("b", { text: String(L.playlists) }), el("span", { text: `${L.playlists === 1 ? "Playlist" : "Playlists"} (${n(L.playlistItems || 0, "video", "videos")})` })));
    if (L.collections) stats.append(el("li", {}, el("b", { text: String(L.collections) }), el("span", { text: `${L.collections === 1 ? "Collection" : "Collections"} (${n(L.collectionItems || 0, "video", "videos")})` })));
    out.append(el("div", { class: "card" }, el("h3", { text: "Playlists and collections" }), stats));
  }
  const smart = (L.playlistsSkipped || 0) + (L.collectionsSkipped || 0);
  if (smart) out.append(el("p", { class: "sub", text: `${n(smart, "smart (rule-based) list", "smart (rule-based) lists")} can't be copied because Jellyfin has no equivalent.` }));
  if (res.exceptions.length) {
    const d = el("details", { class: "card" }, el("summary", { text: `Titles left alone (${res.exceptions.length})` }));
    const ul = el("ul"); for (const x of res.exceptions.slice(0, 300)) ul.append(el("li", { text: `${x.label}: ${x.reason}` }));
    d.append(ul); out.append(d);
  }
  const lists = (L.playlists || 0) + (L.collections || 0);
  $("review-title").textContent = total || lists ? "Ready to copy" : "Nothing to copy";
  $("btn-apply").textContent = total || lists ? "Copy my progress" : "Continue";
  if (!total && !lists) out.prepend(el("p", { class: "ok", text: "Jellyfin already has all of this progress." }));
  if (res.orbital && !res.orbital.applied) out.append(el("p", { class: "warn", text: `The Orbital look wasn't applied: ${res.orbital.reason} Jellyfin keeps its standard look; everything else works.` }));
  if (res.sports && !res.sports.applied) out.append(el("p", { class: "warn", text: `Sports wasn't added: ${res.sports.reason} Everything else works; you can try again later.` }));
  $("review").hidden = false; $("review-title").tabIndex = -1; $("review-title").focus();
}
$("btn-apply").addEventListener("click", (ev) => busy(ev.target, async () => {
  $("btn-pause").hidden = false; $("apply-bar").hidden = false;
  try {
    await api("POST", "/api/apply", { runId: S.runId });
    const res = await waitJob((p) => {
      if (p.total) { $("apply-bar").firstElementChild.style.width = `${Math.round((100 * p.done) / p.total)}%`; $("apply-text").textContent = `${p.done} of ${p.total}`; }
    });
    showDone(res);
  } finally { $("btn-pause").hidden = true; $("apply-bar").hidden = true; }
}));
$("btn-pause").addEventListener("click", () => api("POST", "/api/cancel"));

// ---- 4. Done -----------------------------------------------------------------------------------------
function showDone(res) {
  go("done");
  const made = [res.playlistsCreated ? n(res.playlistsCreated, "playlist", "playlists") : null,
                res.collectionsCreated ? n(res.collectionsCreated, "collection", "collections") : null].filter(Boolean);
  $("done-summary").textContent = `${n(res.verified || 0, "title", "titles")} copied and double-checked` +
    (made.length ? `, plus ${made.join(" and ")}.` : ".") +
    (res.failed ? ` ${n(res.failed, "title", "titles")} couldn't be updated; the report has details.` : "") +
    (res.superseded ? ` ${n(res.superseded, "title was", "titles were")} changed in Jellyfin meanwhile and left alone.` : "");
  if (S.look && S.look.applied) $("done-summary").textContent += " Jellyfin's web app now has the Orbital look.";
  if (S.sportsDone && S.sportsDone.applied) $("done-summary").textContent += " Sports is in the menu with the games in your TV guide.";
  $("btn-orbital-off").hidden = !(S.look && S.look.applied);
  $("btn-sports-off").hidden = !(S.sportsDone && S.sportsDone.applied);
  if (S.sportsDone && S.sportsDone.applied) loadSources().catch(e => showError(e.message));
  api("GET", "/api/app").then((a) => {
    $("keep-card").hidden = !(a.canInstall && !a.installed);
    if (a.update && a.update.available) $("done-summary").append(el("span", { class: "sub", text: ` A newer version (${a.update.version}) is available.` }));
  }).catch(() => {});
  const fp = res.firstPlayback || {}; $("open-jf").href = fp.open || "#";
  const tiles = $("continue"); tiles.replaceChildren();
  for (const c of fp.continueWatching || []) {
    const img = el("img", { src: c.image, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(el("span", { class: "poster-fallback", "aria-hidden": "true" })));
    tiles.append(el("li", {}, el("a", { href: c.link, target: "_blank", rel: "noopener", class: "poster" },
      el("span", { class: "art" }, img, el("span", { class: "play", "aria-hidden": "true" })),
      el("span", { class: "cap" }, el("strong", { text: c.series || c.name }), c.series ? el("span", { class: "sub", text: c.name }) : null))));
  }
  $("continue-wrap").hidden = !(fp.continueWatching || []).length;
  const acc = $("accounts"); acc.replaceChildren();
  if (S.accounts.length) {
    acc.append(el("h2", { text: "New Jellyfin accounts" }), el("p", { text: "Give these to each person. They aren't saved anywhere, so write them down now. Everyone can change their password in Jellyfin." }));
    const dl = el("dl"); for (const a of S.accounts) dl.append(el("dt", { text: a.name }), el("dd", { class: "pw", text: a.password }));
    acc.append(dl, el("button", { text: "Copy to clipboard", onclick: (ev) => navigator.clipboard.writeText(S.accounts.map((a) => `${a.name}: ${a.password}`).join("\n")).then(() => (ev.target.textContent = "Copied")) }));
    acc.hidden = false;
  }
  $("open-jf").focus();
}
$("btn-report").addEventListener("click", (ev) => busy(ev.target, async () => {
  const r = await api("GET", "/api/report" + (S.runId ? `?run=${encodeURIComponent(S.runId)}` : ""));
  const a = el("a", { href: URL.createObjectURL(new Blob([r.csv], { type: "text/csv" })), download: "move-to-jellyfin-report.csv" });
  document.body.append(a); a.click(); a.remove();
}));
$("btn-rollback").addEventListener("click", (ev) => busy(ev.target, async () => {
  if (!confirm("Undo the progress this app copied? Anything watched in Jellyfin since then is kept.")) return;
  await api("POST", "/api/rollback", { runId: S.runId });
  const r = await waitJob(); const kept = r.skipped || 0;
  $("undo-out").textContent = `Restored ${n(r.restored || 0, "title", "titles")} to how they were.` +
    (kept ? ` ${n(kept, "title was", "titles were")} watched in Jellyfin since then and left as is.` : "") +
    (r.lastPlayedDateKept ? ` Jellyfin can't erase a "last watched" date, so ${n(r.lastPlayedDateKept, "title keeps", "titles keep")} one.` : "");
}));
$("btn-keep").addEventListener("click", (ev) => busy(ev.target, async () => {
  const r = await api("POST", "/api/app/install");
  $("keep-out").textContent = `Added to your Start menu as "Orbital for Jellyfin".`;
  ev.target.hidden = true; return r;
}));
// Sports sources: the TV guide is built in; anything else is the person's own account and key.
const KEEP = "__keep__";
async function loadSources() {
  loadIntegrations().catch(e => { $("integrations-out").textContent = e.message; });
  try {
    const cur = await api("GET", "/api/sports/sources");
    const db = (cur.sources || []).find((s) => s.type === "thesportsdb");
    const feed = (cur.sources || []).find((s) => s.type === "feed");
    $("src-sportsdb").value = ""; $("src-sportsdb").placeholder = db ? "Connected. Type a new key to change it" : "Not connected";
    $("src-sportsdb").dataset.saved = db ? "1" : "";
    $("src-feed").value = feed ? feed.url : "";
    $("src-feed").dataset.token = feed && feed.token ? "1" : "";
    $("src-espn").checked = (cur.sources || []).some((s) => s.type === "espn-public");
    S.fileSources = (cur.sources || []).filter((s) => s.type === "file");  // add-ons and provider files are kept as they are
    showAddons(cur.addons || []);
    $("sources-card").hidden = false;
    setSourcesDirty(false);
  } catch (e) { $("sources-card").hidden = false; $("sources-out").textContent = "Could not check your sources: " + e.message; throw e; }
}
function showAddons(list) {
  $("addon-list").replaceChildren(...list.map((a) => el("li", {},
    el("strong", { text: a.name }), ` ${a.version ? "version " + a.version + " " : ""}by ${a.author}`,
    a.terms ? el("span", { class: "sub", text: `Uses ${a.terms}'s data under ${a.terms}'s terms. Added ${String(a.accepted_at).slice(0, 10)}.` }) : null,
    el("button", { class: "ghost", text: "Remove", onclick: (ev) => busy(ev.target, async () => {
      if (!confirm(`Remove ${a.name}? Sports stops using it; its file is set aside, not deleted.`)) return;
      await api("POST", "/api/sports/addons", { action: "remove", module: a.module });
      $("addon-out").textContent = `${a.name} removed.`; loadSources();
    }) }))));
}
let pendingAddon = null;
function addonReady() { $("btn-addon-add").disabled = !($("ac-code").checked && ($("ac-terms-row").hidden || $("ac-terms").checked)); }
$("ac-code").addEventListener("change", addonReady);
$("ac-terms").addEventListener("change", addonReady);
$("btn-addon-cancel").addEventListener("click", () => { pendingAddon = null; $("addon-confirm").hidden = true; $("addon-out").textContent = ""; });
$("btn-addon-check").addEventListener("click", (ev) => busy(ev.target, async () => {
  const file = $("addon-file").files[0], url = $("addon-url").value.trim();
  if (!file && !url) { $("addon-out").textContent = "Paste an add-on's address or choose its file first."; return; }
  if (file && file.size > 256 * 1024) { $("addon-out").textContent = "That file is larger than 256 KB, too large for an add-on."; return; }
  $("addon-out").textContent = "Reading its description (nothing in it runs yet)…";
  let r;
  try { r = await api("POST", "/api/sports/addons", file ? { action: "inspect", code: await file.text() } : { action: "inspect", url }); }
  catch (e) { $("addon-out").textContent = "Not added: " + (e.message || e); return; }
  pendingAddon = r; const a = r.addon;
  $("ac-name").textContent = a.name; $("ac-version").textContent = a.version ? ` version ${a.version}` : "";
  $("ac-author").textContent = `by ${a.author}`; $("ac-desc").textContent = a.description || "";
  $("ac-provides").textContent = `Provides: ${(a.provides || []).join(", ") || "games"}${(a.leagues || []).length ? " for " + a.leagues.join(", ") : ""}. Fingerprint ${r.sha256.slice(0, 12)}${r.replaces ? `. Replaces version ${r.replaces.version || "?"} you added earlier` : ""}.`;
  $("ac-home-row").hidden = !a.homepage; if (a.homepage) $("ac-home").href = a.homepage;
  $("ac-code-text").textContent = r.confirm.runs_code;
  $("ac-terms-row").hidden = !r.confirm.terms; $("ac-terms-text").textContent = r.confirm.terms || "";
  $("ac-code").checked = false; $("ac-terms").checked = false; addonReady();
  $("addon-confirm").hidden = false; $("addon-out").textContent = "Check who wrote it and whose terms apply, then confirm.";
}));
$("btn-addon-add").addEventListener("click", (ev) => busy(ev.target, async () => {
  if (!pendingAddon) return;
  try {
    const r = await api("POST", "/api/sports/addons", { action: "install", pending: pendingAddon.pending, runs_code: $("ac-code").checked,
      terms: $("ac-terms").checked ? pendingAddon.addon.terms : null });
    $("addon-out").textContent = `${r.installed.name} added. Sports picks it up within a minute.`;
    pendingAddon = null; $("addon-confirm").hidden = true; $("addon-url").value = ""; $("addon-file").value = "";
    loadSources();
  } catch (e) { $("addon-out").textContent = "Not added: " + (e.message || e); }
}));
function setSourcesDirty(dirty) {
  S.sourcesDirty = dirty;
  if (dirty) { artworkRun++; $("artwork-preview").hidden = true; }
  $("unsaved-notice").hidden = !dirty;
  $("btn-sources").textContent = dirty ? "Save and check sources — unsaved changes" : "Save and check sources";
}
for (const id of ["src-sportsdb", "src-feed", "src-espn"]) {
  $(id).addEventListener("input", () => setSourcesDirty(true));
  $(id).addEventListener("change", () => setSourcesDirty(true));
}
$("open-jf").addEventListener("click", ev => {
  if (S.liveTVRunning || S.liveTVDirty) {
    ev.preventDefault();
    showError(S.liveTVRunning ? "Your Live TV source is still connecting. Wait for its saved confirmation." : "Your Live TV details are not saved. Test the connection, then choose Save and import channels, or clear the form.");
    $("live-tv-form").open = true;
    $(S.liveTVChecked ? "btn-live-tv-save" : "btn-live-tv-check").focus();
    return;
  }
  if (catalogueRunning) { ev.preventDefault(); showError("Your catalogues are still connecting. Wait for the result below before opening Jellyfin."); return; }
  if ($("catalogue-file").files.length) {
    ev.preventDefault();showError("Your catalogue has not been imported. Use Check and import catalogue first.");
    $("btn-catalogue").scrollIntoView({block:"center"});$("btn-catalogue").focus();return;
  }
  if (S.integrationsDirty) {
    ev.preventDefault();
    showError("Your integration settings have not been saved. Use Save and check integration first.");
    $("btn-integrations").scrollIntoView({block:"center"}); $("btn-integrations").focus();
    return;
  }
  if (!S.sourcesDirty) return;
  ev.preventDefault();
  showError("Your source settings have not been saved. Use Save and check sources first, then open Jellyfin.");
  $("btn-sources").scrollIntoView({block:"center"}); $("btn-sources").focus();
});
async function loadIntegrations() {
  const value = await api("GET", "/api/integrations");
  if (S.integrationsDirty) return;
  $("integrations-card").hidden = false;
  $("integration-personal").checked = value.personal_library === true;
  $("integration-requests").checked = value.requests.enabled === true;
  $("integration-url").value = value.requests.url || "";
  $("integration-key").value = "";
  $("integration-key").placeholder = value.requests.key_saved ? "Key saved on your server; leave blank to keep it" : "Paste your Seerr API key";
}
for (const id of ["integration-personal", "integration-requests", "integration-url", "integration-key"]) {
  $(id).addEventListener("input", () => {
    S.integrationsDirty = true;
    $("integrations-out").textContent = "Unsaved changes — save below before opening Jellyfin.";
  });
}
$("btn-integrations").addEventListener("click", ev => busy(ev.target, async () => {
  const ids = ["integration-personal", "integration-requests", "integration-url", "integration-key"];
  const key = $("integration-key").value.trim();
  const settings = {personal_library:$("integration-personal").checked,
    requests:{enabled:$("integration-requests").checked, url:$("integration-url").value.trim(), ...(key ? {key} : {})}};
  ids.forEach(id => { $(id).disabled=true; });
  $("integrations-out").textContent = settings.requests.enabled ? "Connecting to Seerr and checking the API key before saving…" : "Saving your library settings…";
  try {
    await api("POST", "/api/integrations", settings);
    S.integrationsDirty=false; await loadIntegrations();
    $("integrations-out").textContent = settings.requests.enabled ? "Saved and connected. Linked Jellyfin users can now request titles in Orbital." : "Saved. Your library features are ready.";
  } catch (e) { $("integrations-out").textContent="Not saved: "+e.message; }
  finally { ids.forEach(id => { $(id).disabled=false; }); }
}));
let artworkRun = 0;
async function previewArtwork(result) {
  const run = ++artworkRun, samples = result.artwork || [];
  $("artwork-samples").replaceChildren(); $("artwork-preview").hidden = false;
  $("artwork-status").textContent = samples.length ? "Loading a sample of your connected team logos…" :
    result.teamEntries ? "Your source returned teams without usable logo links. Choose a source that includes team badges, then save and check again." :
    "There are no teams to preview yet. Check again when your source has games; an empty schedule cannot confirm artwork.";
  let loaded = 0;
  await Promise.all(samples.map(sample => new Promise(resolve => {
    const label = el("figcaption", {text:sample.name});
    const image = el("img", {alt:sample.name, width:64, height:64, referrerpolicy:"no-referrer"});
    $("artwork-samples").append(el("figure", {}, image, label));
    let finished = false;
    const finish = ok => { if (finished) return; finished=true;clearTimeout(timer); if (ok) loaded++;
      else { image.hidden=true;label.textContent=sample.name+" — image unavailable"; } resolve(); };
    const timer = setTimeout(() => finish(false), 8000);
    image.addEventListener("load", () => finish(image.naturalWidth>0));image.addEventListener("error", () => finish(false));
    try { const url=new URL(sample.url); if(url.protocol!=="https:" || url.username || url.password || url.hash) return finish(false);image.src=url.href; } catch (_) {finish(false);}
  })));
  if (run!==artworkRun || !samples.length) return;
  $("artwork-status").textContent = `${loaded} of ${samples.length} sample logos loaded.` +
    (loaded===samples.length ? " Your connected artwork is ready. This sample does not verify every team." : " Some images could not load. Check your connection or source and retry; scores can still work.");
}
async function checkSources() {
  await api("POST", "/api/sports/sources/check");
  const result = await waitJob(p => { $("sources-out").textContent = p.message || "Checking connections…"; });
  $("sources-out").replaceChildren(...(result.sources || []).map(row => el("p", {text:row.name + ": " + row.message})),
    el("p", {text:result.message || "No source health information was returned. Try again shortly."}));
  await previewArtwork(result);
}
$("btn-check-sources").addEventListener("click", ev => busy(ev.target, checkSources));
$("btn-sources").addEventListener("click", (ev) => busy(ev.target, async () => {
  const sourceInputs = ["src-sportsdb", "src-feed", "src-espn"];
  sourceInputs.forEach(id => { $(id).disabled = true; });
  const sources = [{ type: "guide" }];
  const key = $("src-sportsdb").value.trim();
  if (key) sources.push({ type: "thesportsdb", key });
  else if ($("src-sportsdb").dataset.saved) sources.push({ type: "thesportsdb", key: KEEP });
  const url = $("src-feed").value.trim();
  if (url) sources.push({ type: "feed", url, ...($("src-feed").dataset.token ? { token: KEEP } : {}) });
  if ($("src-espn").checked) sources.push({ type: "espn-public" });
  sources.push(...(S.fileSources || []));
  try {
    await api("POST", "/api/sports/sources", { sources });
    $("sources-out").textContent = "Settings saved. Checking the saved connection settings…";
    await loadSources();
    await checkSources();
  } catch (e) { $("sources-out").textContent = (S.sourcesDirty ? "Not saved: " : "Settings saved, but the connection check failed: ") + (e.message || e); }
  finally { sourceInputs.forEach(id => { $(id).disabled = false; }); $("btn-sources").dataset.keep = "1"; setSourcesDirty(!!S.sourcesDirty); }
}));
$("btn-sports-off").addEventListener("click", (ev) => busy(ev.target, async () => {
  $("undo-out").textContent = "Removing sports. Jellyfin restarts once…";
  await api("POST", "/api/sports/remove"); await waitJob(() => {});
  $("undo-out").textContent = "Sports is removed. Reload any open Jellyfin tabs."; ev.target.hidden = true;
}));
$("btn-orbital-off").addEventListener("click", (ev) => busy(ev.target, async () => {
  await api("POST", "/api/orbital/remove");
  ev.target.hidden = true;
  $("undo-out").textContent = "Jellyfin's web app is back to its standard look. Reload any open Jellyfin tabs.";
}));
$("btn-undo-setup").addEventListener("click", (ev) => busy(ev.target, async () => {
  if (!confirm("Remove the libraries, accounts, playlists and collections this app added? Your video files are not touched.")) return;
  await api("POST", "/api/undo-setup"); const r = await waitJob();
  $("undo-out").textContent = `Removed ${n(r.removed.length, "thing", "things")} this app added (libraries, lists, accounts, Home layout). Your video files were not touched.` + (r.legacyHistoryPreserved ? " Older setup history could not be linked to this server and was left alone." : "");
}));
$("btn-forget").addEventListener("click", (ev) => busy(ev.target, async () => {
  if (!confirm("Delete this app's history and sign-ins from this PC? Undo won't be possible afterwards.")) return;
  await api("POST", "/api/forget"); document.body.replaceChildren(el("main", {}, el("h1", { text: "Deleted. You can close this tab." })));
}));
$("btn-quit").addEventListener("click", async () => { await api("POST", "/api/quit"); document.body.replaceChildren(el("main", {}, el("h1", { text: "All done. You can close this tab." }))); });

// Standalone setup uses the same checked operations as migration, without requiring Plex.
function setServerInstalling(active) {
  S.installingServer = active;
  document.querySelectorAll('input[name="journey"]').forEach(input => { input.disabled = active; });
  if (active) $("btn-start").disabled = true;
}
function journey() { return document.querySelector('input[name="journey"]:checked').value; }
document.querySelectorAll('input[name="journey"]').forEach(x => x.addEventListener("change", () => { localStorage.setItem("fp-journey", journey()); detect().catch(e => showError(e.message)); }));
$("btn-install-server").addEventListener("click", ev => busy(ev.target, async () => {
  if (!$("install-agree").checked) throw new Error("Accept the installation agreements to continue.");
  clearTimeout(S.pollTimer);
  setServerInstalling(true);
  try {
    await api("POST", "/api/server/install", { agreed: true });
    await waitJob(p => { $("server-progress").textContent = p.message || "Installing Jellyfin. This may take a few minutes."; });
  } finally { setServerInstalling(false); }
  $("server-progress").textContent = "Jellyfin is running. Continue to create your account.";
  await detect();
}));
async function showFeatures() {
  go("features");
  $("install-features").disabled = true;
  $("skip-features").disabled = true;
  $("new-library").hidden = false;
  const saved = await api("GET", "/api/setup/progress");
  if (saved.features) {
    for (const f of saved.features) if (["orbital", "sports"].includes(f)) $("feature-" + f).checked = true;
    $("feature-progress").textContent = saved.phase === "running" && !saved.running
      ? "Setup was interrupted. Your completed changes are kept. Sign-in is restored; choose Set up selected features to check and retry."
      : "Your previous choices are restored. Completed features are checked again before reporting Ready.";
  }
  if (saved.running) {
    $("install-features").disabled = true; $("skip-features").disabled = true;
    try { await waitJob(p => { $("feature-progress").textContent = p.message || "Setup is still running…"; }); }
    finally { $("install-features").disabled = false; $("skip-features").disabled = false; }
  }
  S.featureStates = {};
  S.featureResults = {};
  for (const feature of ["orbital", "sports"]) {
    const st = await api("GET", `/api/${feature}`).catch(e => ({available:false, reason:"Could not check this feature: " + e.message}));
    S.featureStates[feature] = st;
    if (st.installed) {
      const ready = feature === "orbital" ? !!st.filesPresent && !st.needsReapply : !!(st.service || {}).ready;
      S.featureResults[feature] = {ready, message:ready ? "Installed; check passed." : "Installed, but needs attention. Select it to check or repair."};
    } else if (saved.results && saved.results[feature]) {
      S.featureResults[feature] = {ready:false, message:"Not currently verified as installed. Select it to check or retry."};
    }
    $("feature-" + feature).disabled = !st.available;
    $("feature-" + feature + "-status").textContent = st.available ? (st.installed ? "Already installed. You can check or repair it." : "Available to add.") : st.reason;
  }
  if (Object.keys(S.featureResults).length) renderFeatureResults(S.featureResults);
  $("install-features").disabled = false; $("skip-features").disabled = false;
}
function renderFeatureResults(results) {
  $("feature-progress").replaceChildren(...Object.entries(results).map(([f,st]) => el("p", {text:`${f === "orbital" ? "Orbital look" : "Sports"}: ${st.message}`})));
}
$("features-all").addEventListener("click", () => ["orbital", "sports"].forEach(f => { $("feature-" + f).checked = !$("feature-" + f).disabled; }));
async function browseFolders(path) {
  const r = await api("POST", "/api/folders", {path});
  $("folder-list").replaceChildren(el("button", {text:"Back to drives", onclick:() => browseFolders("").catch(e => showError(e.message))}), ...r.paths.map(p => el("button", {text:p, onclick:() => busy($("browse-folders"), async () => {
    S.folder = p; $("chosen-folder").textContent = p; $("add-library").disabled = false; await browseFolders(p);
  })})));
}
$("browse-folders").addEventListener("click", ev => busy(ev.target, () => browseFolders("")));
$("add-library").addEventListener("click", ev => busy(ev.target, async () => {
  $("library-progress").textContent = "Checking the folder and adding your library…";
  const r = await api("POST", "/api/library/create", {name:$("library-name").value.trim(), kind:$("library-kind").value, path:S.folder});
  $("library-progress").textContent = r.message;
}));
function finishFeatures() {
  go("done"); $("done-summary").textContent = "Jellyfin is connected. Your feature results are shown below. You can add more features later.";
  $("open-jf").href = S.jfUrl + "/web/";
  document.querySelector('[data-panel="done"] h1').textContent = "Your setup results";
  const hasFailedFeature = Object.values(S.featureResults || {}).some(r => !r.ready);
  document.querySelector('[data-panel="done"] .hero-ok .icon').className = "icon " + (hasFailedFeature ? "warn" : "ok") + " big";
  if (hasFailedFeature) $("done-summary").textContent = "Jellyfin is connected. Some optional features need attention; review the results below. You can still use Jellyfin.";
  $("btn-report").hidden = true; $("btn-rollback").hidden = true;
  $("done-feature-results").replaceChildren(...Array.from($("feature-progress").childNodes).map(n => n.cloneNode(true)));
  $("btn-orbital-off").hidden = !(S.featureResults && S.featureResults.orbital && S.featureResults.orbital.ready);
  $("btn-sports-off").hidden = !(S.featureResults && S.featureResults.sports && S.featureResults.sports.ready);
  if ((S.featureResults && S.featureResults.sports && S.featureResults.sports.ready) ||
      (S.featureStates && S.featureStates.sports && S.featureStates.sports.installed && (S.featureStates.sports.service || {}).ready)) loadSources().catch(e => showError(e.message));
  api("GET", "/api/app").then(a => { $("keep-card").hidden = !(a.canInstall && !a.installed); }).catch(() => {});
}
$("skip-features").addEventListener("click", finishFeatures);
$("manage-features").addEventListener("click", ev => busy(ev.target, showFeatures));
$("refresh-features").addEventListener("click", ev => busy(ev.target, showFeatures));
$("install-features").addEventListener("click", ev => busy(ev.target, async () => {
  const features = ["orbital", "sports"].filter(f => !$("feature-" + f).disabled && $("feature-" + f).checked);
  if (!features.length) throw new Error("Choose a feature, or continue with Jellyfin.");
  if (features.includes("sports") && !$("feature-restart").checked) throw new Error("Confirm that Jellyfin can restart to add Sports.");
  $("skip-features").disabled = true;
  try {
    await api("POST", "/api/features/install", {features, allowRestart:$("feature-restart").checked});
    const r = await waitJob(p => { $("feature-progress").textContent = p.message || "Setting up your selected features…"; });
    S.featureResults = {...(S.featureResults || {}), ...r.features};
    renderFeatureResults(S.featureResults);
    if (Object.values(r.features).every(st => st.ready)) finishFeatures();
  } finally { $("skip-features").disabled = false; }
}));

// ---- boot: resume where the person left off ---------------------------------------------------------
(async () => {
  if (!KEY) { showError("Open this page from the Move to Jellyfin app so it can connect securely."); return; }
  try {
    const savedJourney = localStorage.getItem("fp-journey");
    if (["fresh", "existing", "migration"].includes(savedJourney)) document.querySelector(`input[name="journey"][value="${savedJourney}"]`).checked = true;
    const s = await api("GET", "/api/status");
    if (s.job.running && s.job.name === "server-install") {
      setServerInstalling(true);
      $("jf-install").hidden = false; $("btn-install-server").disabled = true;
      try { await waitJob(p => { $("server-progress").textContent = p.message || "Installing Jellyfin…"; }); }
      finally { $("btn-install-server").disabled = false; setServerInstalling(false); }
      return await detect();
    }
    if (journey() === "migration" && s.plex.connected && s.jellyfin.connected) { S.plexUrl = s.plex.url; S.jfUrl = s.jellyfin.url; return await showPlan(); }
    if (s.jellyfin.connected) { S.jfUrl = s.jellyfin.url; return await showFeatures(); }
    await detect();
  } catch (e) { showError(e.message); }
})();

$("btn-catalogue").addEventListener("click", ev => busy(ev.target, async () => {
  const file=$("catalogue-file").files[0];
  if (!file) throw new Error("Choose a catalogue export first.");
  if(file.size>32*1024*1024) throw new Error("Choose a catalogue smaller than 32 MB.");
  $("catalogue-out").textContent="Reading and checking your catalogue…";
  try {
    const data=JSON.parse(await file.text());
    const saved=await api("POST","/api/catalogues/import",data);
    $("catalogue-file").value="";
    $("catalogue-out").textContent=`Connected ${saved.provider}: ${saved.entries.toLocaleString()} titles. Services will appear when you reopen Jellyfin.`;
  } catch(e) { $("catalogue-out").textContent="Not imported: "+e.message; }
}));

// Live TV uses Jellyfin itself, including installations without the Sports plugin.
const liveTVFields = ["kind", "name", "url", "user", "password", "guide", "connections"];
function liveTVBody() {
  return Object.fromEntries(liveTVFields.map(k => [k === "user" ? "username" : k, $("live-tv-" + k).value]));
}
function liveTVType() {
  const kind = $("live-tv-kind").value;
  $("live-tv-login").hidden = kind !== "xtream";
  $("live-tv-url-label").textContent = kind === "xtream" ? "Provider server address" : kind === "hdhomerun" ? "Tuner address on your home network" : "Playlist address";
  $("live-tv-url").placeholder = kind === "m3u" ? "https://provider.example/playlist.m3u" : kind === "xtream" ? "https://provider.example:8080" : "http://192.0.2.100";
  $("live-tv-guide-hint").textContent = kind === "xtream" ? "We will use your provider's guide automatically. Only fill this in if they gave you a different guide link." : "A guide adds programme names and schedules. Your provider can supply this link.";
}
async function loadLiveTv() {
  const data = await api("GET", "/api/live-tv");
  $("live-tv-sources").replaceChildren(...(data.sources.length ? data.sources.map(s => el("li", {text:s.name + " · " + (s.kind === "hdhomerun" ? "HDHomeRun" : "Playlist")})) : [el("li", {text:"No Live TV sources connected yet. This step is optional."})]));
}
for (const key of liveTVFields) $("live-tv-" + key).addEventListener("input", () => {
  S.liveTVDirty = true; S.liveTVChecked = false;
  $("btn-live-tv-save").disabled = true;
  $("live-tv-out").textContent = "Unsaved changes. Test the connection, then save below.";
  liveTVType();
});
function lockLiveTV(locked) {
  S.liveTVRunning = locked;
  for (const key of liveTVFields) $("live-tv-" + key).disabled = locked;
  for (const key of ["check", "save", "clear"]) $("btn-live-tv-" + key).disabled = locked || (key === "save" && !S.liveTVChecked);
}
$("btn-live-tv-clear").addEventListener("click", () => {
  showError("");
  for (const key of ["url", "user", "password", "guide"]) $("live-tv-" + key).value = "";
  S.liveTVDirty = false; S.liveTVChecked = false; lockLiveTV(false);
  $("live-tv-out").textContent = "Form cleared. Saved sources remain connected.";
});
$("btn-live-tv-refresh").addEventListener("click", ev => busy(ev.target, loadLiveTv));
$("btn-live-tv-check").addEventListener("click", async () => {
  showError("");
  lockLiveTV(true); S.liveTVChecked = false;
  $("live-tv-out").textContent = "Reading the channel list and checking the guide. No video is opened…";
  try {
    const data = await api("POST", "/api/live-tv/check", liveTVBody());
    S.liveTVChecked = true;
    $("live-tv-out").textContent = `${data.at_least ? "At least " : ""}${n(data.channels, "channel", "channels")} found${data.guide_checked ? "; guide checked" : ""}. Ready to save. Choose Save and import channels below.`;
  } catch(e) { $("live-tv-out").textContent = e.message; }
  finally { lockLiveTV(false); }
});
$("btn-live-tv-save").addEventListener("click", async () => {
  if (!S.liveTVChecked) return;
  showError("");
  lockLiveTV(true);
  try {
    await api("POST", "/api/live-tv/save", liveTVBody());
    const result = await waitJob(p => { $("live-tv-out").textContent = p.message || "Connecting your Live TV source…"; });
    S.liveTVDirty = false; S.liveTVChecked = false;
    for (const key of ["url", "user", "password", "guide"]) $("live-tv-" + key).value = "";
    $("live-tv-out").textContent = result.message + " You can now Open Jellyfin at the bottom of this page.";
    await loadLiveTv();
  } catch(e) { $("live-tv-out").textContent = e.message; await loadLiveTv().catch(() => {}); }
  finally { lockLiveTV(false); }
});

let catalogueRunning = false;
$("btn-connect-catalogue").addEventListener("click", ev => busy(ev.target, async () => {
  if (S.integrationsDirty) { $("btn-integrations").focus(); throw new Error("Save and check your Seerr connection above first."); }
  catalogueRunning = true;
  $("catalogue-connect-out").textContent = "Checking your saved Seerr connection…";
  try {
    await api("POST", "/api/catalogues/connect", {provider:$("catalogue-provider").value, automatic_refresh:$("catalogue-auto-refresh").checked});
    const result = await waitJob(p => { $("catalogue-connect-out").textContent = p.message || "Connecting catalogues…"; });
    $("catalogue-connect-out").textContent = "Connected: " + result.catalogues.map(c => `${c.provider} (${c.entries.toLocaleString()} titles)`).join(", ") + ($("catalogue-auto-refresh").checked ? ". Daily updates are on while Jellyfin is running." : ". Manual updates selected; connect again when you want fresh listings.") + " Open Jellyfin below to use Services.";
  } catch(e) { $("catalogue-connect-out").textContent = "Needs attention: " + e.message + ". Previously saved catalogues remain available; retry this service when ready."; }
  finally { catalogueRunning = false; }
}));

// Account approvals remain with the user; no network change happens on page load.
for (const button of document.querySelectorAll('[data-remote]')) button.addEventListener('click', async () => {
  const controls=[...document.querySelectorAll('[data-remote]')]; controls.forEach(b=>b.disabled=true);
  $('remote-out').textContent='Preparing your connection…'; $('remote-approve').hidden=true; $('remote-phone').hidden=true;
  try {
    let result=await api('POST','/api/remote-access',{action:button.dataset.remote,url:$('remote-url').value.trim()});
    if(result.started) result=await waitJob(p=>{$('remote-out').textContent=p.message||'Setting up your connection…';});
    $('remote-out').textContent=result.message;
    if(result.approval_url){$('remote-approve').href=result.approval_url;$('remote-approve').hidden=false;$('remote-start').textContent='Continue after approval';}
    if(result.url){$('remote-result').value=result.url;$('remote-phone').hidden=false;$('remote-qr').hidden=!result.qr;if(result.qr)$('remote-qr').src=result.qr;$('remote-start').textContent='Check connection again';}
  } catch(e) { $('remote-out').textContent=e.message;$('remote-start').textContent='Try again'; }
  finally { controls.forEach(b=>b.disabled=false); }
});
$('remote-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('remote-result').value);$('remote-out').textContent='Address copied. Paste it into the server field in Jellyfin or Orbital.';}catch{$('remote-result').select();$('remote-out').textContent='Select and copy the address above.';}});
$('remote-confirm').addEventListener('click',()=>{$('remote-out').textContent='You confirmed playback works away from home. Keep the server computer on and Tailscale connected on your viewing device.';});
$('remote-help').addEventListener('click',()=>{$('remote-out').textContent='Check that the server computer is on, Tailscale says Connected on both devices, and both use the same Tailscale account. Keep mobile data on. Try the address again; if it opens but playback fails, check the Jellyfin account has remote playback permission. You can return here without repeating installation.';});
