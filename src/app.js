import { autoMode, shop, sellWindow } from "./engine.js";
import { loadAll, historyFor, store } from "./data.js";

{
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const statusEl = $("#status");
let data = null;
const shopSel = { ids: [], leagues: null, results: null };
const memo = new Map();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const k = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v)));
const pct = (x, sign = true) => `${sign && x > 0 ? "+" : ""}${Math.round(x * 100)}%`;
const setStatus = (t) => (statusEl.textContent = t);
const posBadge = (pos) => `<span class="pos ${esc(pos)}">${esc(pos === "PICK" ? "PK" : pos)}</span>`;
const modeOf = (m) => store.modes[m.league.league_id] || autoMode(m.me, m.values);
const MODE_LABEL = { rebuild: "Rebuilding", contend: "Contending", neutral: "Neutral" };

// ---------- data helpers ----------
function myPlayers() {
  const map = new Map();
  for (const m of data?.models ?? []) {
    for (const id of m.me.playerIds) {
      const p = m.values.players.get(id);
      if (!p) continue;
      const e = map.get(id) ?? { id, name: p.name, pos: p.pos, age: p.age, value: p.value, models: [] };
      e.models.push(m);
      e.value = Math.max(e.value, p.value);
      map.set(id, e);
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}
const modelById = (id) => data?.models.find((m) => m.league.league_id === id);

function shopCached(m, ids) {
  const key = `${m.league.league_id}|${ids.join(",")}|${modeOf(m)}|${store.settings.band}`;
  if (!memo.has(key)) memo.set(key, shop(m, m.me.rosterId, ids, { myMode: modeOf(m), band: store.settings.band }));
  return memo.get(key);
}

// ---------- pieces ----------
function assetRow(a) {
  const owner = a.kind === "pick" && a.owner ? `<span class="muted small">${esc(a.owner)}</span>` : a.age ? `<span class="muted small">${esc(a.age)}</span>` : "";
  return `<div class="asset">${posBadge(a.pos)}<span>${esc(a.label)}</span>${owner}<span class="v">${k(a.value)}</span></div>`;
}
function slip(p, buyerName) {
  const odds = p.odds === "Likely" ? "good" : p.odds === "Fair shot" ? "" : "warn";
  return `<div class="slip">
    <div class="side"><h4>You give</h4>${p.give.map(assetRow).join("")}</div>
    <div class="side"><h4>${esc(buyerName)} gives</h4>${p.get.map(assetRow).join("")}</div>
  </div>
  <div class="meta">
    <span class="pill">${esc(p.type)}</span>
    <span class="pill ${odds}">${esc(p.odds)}</span>
    <span class="pill">Value ${pct(p.ratio - 1)}</span>
    <span class="pill good">Their lineup ${pct(p.gainShare)}</span>
    ${p.rosterNote ? `<span class="pill warn">${esc(p.rosterNote)}</span>` : ""}
  </div>`;
}
function spark(hist) {
  const pts = hist.filter((h) => h.v != null).slice(-30).map((h) => h.v);
  if (pts.length < 2) return "";
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 94 + 1} ${26 - ((v - lo) / span) * 24}`).join("");
  return `<svg class="spark" viewBox="0 0 96 28" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--hammer)" stroke-width="2" stroke-linejoin="round"/></svg>`;
}
function picker(id, placeholder, onPick, exclude = []) {
  const html = `<div class="picker"><input type="search" id="${id}" placeholder="${esc(placeholder)}" autocomplete="off"><div class="opts" id="${id}-opts" hidden></div></div>`;
  const bind = () => {
    const input = $(`#${id}`), box = $(`#${id}-opts`);
    const show = () => {
      const q = input.value.toLowerCase().trim();
      const list = myPlayers().filter((p) => !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 30);
      box.innerHTML = list.map((p) => `<button type="button" data-id="${esc(p.id)}">${posBadge(p.pos)}<span>${esc(p.name)}</span><span class="muted small">${esc(p.age ?? "")}</span><span class="sp"></span><span class="pill">${p.models.length} league${p.models.length > 1 ? "s" : ""}</span></button>`).join("") || `<div class="empty small">No match on your rosters</div>`;
      box.hidden = false;
    };
    input.addEventListener("focus", show);
    input.addEventListener("input", show);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      box.hidden = true;
      input.value = "";
      onPick(b.dataset.id);
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".picker")) box.hidden = true; });
  };
  return { html, bind };
}
const needData = () => `<div class="empty"><span class="big">Load your leagues</span>Type your Sleeper username above and tap Load.</div>`;

// ---------- Board ----------
function windowsFor() {
  const sell = store.sell, th = store.settings.threshold;
  const groups = new Map();
  for (const [lid, players] of Object.entries(sell)) {
    const m = modelById(lid);
    if (!m) continue;
    for (const [pid, entry] of Object.entries(players)) {
      const p = m.values.players.get(pid);
      if (!p || !m.me.playerIds.includes(pid)) continue;
      const hist = historyFor(m, pid);
      const w = sellWindow(entry, p.fcValue, hist, data.usage?.p?.[pid], th);
      const g = groups.get(pid) ?? { pid, name: p.name, pos: p.pos, age: p.age, items: [], hist };
      g.items.push({ m, entry, w });
      groups.set(pid, g);
    }
  }
  for (const g of groups.values()) {
    g.open = g.items.filter((i) => i.w.open);
    g.bump = Math.max(...g.items.map((i) => i.w.bump));
    g.w = [...g.items].sort((a, b) => b.w.bump - a.w.bump)[0].w;
  }
  return [...groups.values()].sort((a, b) => (b.open.length > 0) - (a.open.length > 0) || b.open.length - a.open.length || b.bump - a.bump);
}

function renderBoard() {
  if (!data) return (view.innerHTML = needData());
  const groups = windowsFor();
  const open = groups.filter((g) => g.open.length), watching = groups.filter((g) => !g.open.length);
  const th = store.settings.threshold;
  let html = `<h2>${open.length ? `${open.length} sell window${open.length > 1 ? "s" : ""} open` : "No sell windows open"}</h2>
    <p class="lead">Watching ${groups.length} player${groups.length === 1 ? "" : "s"} across ${data.models.length} leagues. A window opens at ${pct(th)} above the 30-day low or the value when you listed him.</p>`;
  if (!groups.length) html += `<div class="empty"><span class="big">Your sell list is empty</span>Add players you'd move at the right price. <a href="#list">Build your sell list</a></div>`;
  for (const g of open) {
    let best = null;
    for (const it of g.open) {
      const buyers = shopCached(it.m, [g.pid]);
      const b = buyers[0];
      if (b && (!best || b.best > best.b.best)) best = { b, m: it.m };
    }
    const u = g.w.u;
    const urg = g.w.urgency === "Act this week" ? "hot" : g.w.urgency === "Can wait" ? "good" : "warn";
    html += `<article class="card">
      <div class="row">${posBadge(g.pos)}<span class="player">${esc(g.name)}</span><span class="muted">${esc(g.age ?? "")}</span><span class="sp"></span>${spark(g.hist)}<span class="big up">${pct(g.bump)}</span></div>
      <div class="meta"><span class="pill ${urg}">${esc(g.w.urgency)}</span><span class="pill">${esc(u.tag === "unknown" ? "usage n/a" : u.tag)}</span>${g.open.map((i) => `<span class="pill">${esc(i.m.league.name)}</span>`).join("")}</div>
      <p class="small muted" style="margin:8px 0 0">${esc(u.note)}. ${g.w.fromLow >= g.w.fromAdd ? `Up ${pct(g.w.fromLow)} on his 30-day low` : `Up ${pct(g.w.fromAdd)} since you listed him`}${g.w.atHigh ? ", at a 30-day high" : ""}.</p>
      ${best ? `<div class="buyer" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px"><div class="row"><b>Best offer: ${esc(best.b.team.name)}</b><span class="pill">${esc(best.m.league.name)}</span></div>${slip(best.b.packages[0], best.b.team.name)}</div>` : `<p class="small muted">No buyer clears your value band right now.</p>`}
      <div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn" data-shop="${esc(g.pid)}">All offers</button></div>
    </article>`;
  }
  if (watching.length) {
    html += `<h3 style="font-size:22px;margin:22px 0 4px">Watching</h3><div class="card"><table><thead><tr><th>Player</th><th>Move</th><th>Needs</th><th>Leagues</th></tr></thead><tbody>${watching.map((g) => `<tr><td>${posBadge(g.pos)} ${esc(g.name)}</td><td class="${g.bump >= 0 ? "up" : "down"}">${pct(g.bump)}</td><td>${pct(Math.max(0, th - g.bump), false)} more</td><td>${g.items.length}</td></tr>`).join("")}</tbody></table></div>`;
  }
  view.innerHTML = html;
  view.querySelectorAll("[data-shop]").forEach((b) => b.addEventListener("click", () => { shopSel.ids = [b.dataset.shop]; shopSel.leagues = null; shopSel.results = null; location.hash = "shop"; }));
}

// ---------- Shop ----------
function renderShop() {
  if (!data) return (view.innerHTML = needData());
  const mine = myPlayers();
  const byId = new Map(mine.map((p) => [p.id, p]));
  shopSel.ids = shopSel.ids.filter((id) => byId.has(id));
  const leagues = data.models.filter((m) => shopSel.ids.length && shopSel.ids.every((id) => m.me.playerIds.includes(id)));
  if (!shopSel.leagues) shopSel.leagues = new Set(leagues.map((m) => m.league.league_id));
  const pk = picker("shop-pick", shopSel.ids.length ? "Add another player to bundle" : "Who are you selling?", (id) => { shopSel.ids.push(id); shopSel.leagues = null; shopSel.results = null; renderShop(); }, shopSel.ids);
  let html = `<h2>Shop a player</h2><p class="lead">Every buyer in every league you pick, with the best packages they could send.</p>
    <div class="card">${pk.html}
    <div class="meta" style="margin-top:10px">${shopSel.ids.map((id) => `<span class="pill hot">${esc(byId.get(id).name)} <button class="btn ghost" style="min-height:24px;padding:0 6px;border:0" data-rm="${esc(id)}" aria-label="Remove">×</button></span>`).join("")}</div>
    ${shopSel.ids.length ? (leagues.length ? `<div class="row" style="margin-top:10px">${leagues.map((m) => `<label class="chk"><input type="checkbox" data-lg="${esc(m.league.league_id)}" ${shopSel.leagues.has(m.league.league_id) ? "checked" : ""}>${esc(m.league.name)}</label>`).join("")}</div>
      <div class="row" style="margin-top:12px"><span class="small muted">Value band ±${Math.round(store.settings.band * 100)}%</span><span class="sp"></span><button class="btn hot" id="run">Find buyers</button></div>` : `<p class="small muted">You don't own all of these in one league.</p>`) : ""}
    </div><div id="results"></div>`;
  view.innerHTML = html;
  pk.bind();
  view.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { shopSel.ids = shopSel.ids.filter((x) => x !== b.dataset.rm); shopSel.leagues = null; shopSel.results = null; renderShop(); }));
  view.querySelectorAll("[data-lg]").forEach((c) => c.addEventListener("change", () => { c.checked ? shopSel.leagues.add(c.dataset.lg) : shopSel.leagues.delete(c.dataset.lg); }));
  $("#run")?.addEventListener("click", () => {
    $("#results").innerHTML = `<div class="empty">Working through every package…</div>`;
    setTimeout(() => { shopSel.results = leagues.filter((m) => shopSel.leagues.has(m.league.league_id)).map((m) => ({ m, buyers: shopCached(m, shopSel.ids) })); drawResults(); }, 20);
  });
  if (shopSel.results) drawResults();
}

function drawResults() {
  const el = $("#results");
  if (!el) return;
  el.innerHTML = shopSel.results.map(({ m, buyers }) => `<section class="card">
    <div class="row"><h3 style="margin:0;font-size:22px">${esc(m.league.name)}</h3><span class="sp"></span><span class="pill">${esc(MODE_LABEL[modeOf(m)])}</span><span class="pill">${buyers.length} buyer${buyers.length === 1 ? "" : "s"}</span></div>
    ${buyers.length ? buyers.map((b) => `<div class="buyer">
      <div class="row"><b>${esc(b.team.name)}</b><span class="pill ${b.team.tier === "contender" ? "good" : ""}">${esc(b.team.tier)}</span><span class="small muted">${b.team.wins}-${b.team.losses}</span><span class="sp"></span><span class="num big" style="font-size:24px">${b.best}</span></div>
      ${slip(b.packages[0], b.team.name)}
      ${b.packages.length > 1 ? `<details><summary>${b.packages.length - 1} more package${b.packages.length > 2 ? "s" : ""}</summary>${b.packages.slice(1).map((p) => `<div style="margin-top:10px">${slip(p, b.team.name)}</div>`).join("")}</details>` : ""}
    </div>`).join("") : `<p class="muted small">No package lands inside your value band. Try widening it on the Sell list tab.</p>`}
  </section>`).join("") || `<div class="empty">Pick at least one league.</div>`;
}

// ---------- Sell list ----------
function renderList() {
  if (!data) return (view.innerHTML = needData());
  const sell = store.sell, s = store.settings;
  const mine = myPlayers();
  const listed = mine.filter((p) => p.models.some((m) => sell[m.league.league_id]?.[p.id]));
  const pk = picker("list-pick", "Add a player you'd sell", (id) => {
    const cur = store.sell, p = mine.find((x) => x.id === id);
    for (const m of p.models) {
      const v = m.values.players.get(id);
      (cur[m.league.league_id] ??= {})[id] = { addedAt: new Date().toISOString().slice(0, 10), baseValue: v.fcValue };
    }
    store.sell = cur;
    renderList();
  }, listed.map((p) => p.id));
  view.innerHTML = `<h2>Sell list</h2><p class="lead">Players you'd move at the right price. Each is watched in every league you tick.</p>
  <div class="card">${pk.html}</div>
  ${listed.map((p) => `<div class="card"><div class="row nowrap">${posBadge(p.pos)}<span class="player ellip">${esc(p.name)}</span><span class="muted">${esc(p.age ?? "")}</span><button class="btn" style="margin-left:auto" data-del="${esc(p.id)}">Remove</button></div>
    <div class="row" style="margin-top:8px">${p.models.map((m) => { const e = sell[m.league.league_id]?.[p.id]; return `<label class="chk"><input type="checkbox" data-tog="${esc(m.league.league_id)}|${esc(p.id)}" ${e ? "checked" : ""}>${esc(m.league.name)}${e ? `<span class="muted small">since ${esc(e.addedAt)}</span>` : ""}</label>`; }).join("")}</div></div>`).join("") || `<div class="empty">Nothing listed yet.</div>`}
  <h3 style="font-size:22px;margin:22px 0 4px">Settings</h3>
  <div class="card"><div class="row">
    <label class="sp">Sell window opens at<select id="th">${[0.05, 0.08, 0.1, 0.15].map((v) => `<option value="${v}" ${v === s.threshold ? "selected" : ""}>${pct(v)} bump</option>`).join("")}</select></label>
    <label class="sp">Value band<select id="band">${[0.05, 0.1, 0.15].map((v) => `<option value="${v}" ${v === s.band ? "selected" : ""}>±${Math.round(v * 100)}%</option>`).join("")}</select></label>
  </div></div>
  <div class="card"><b>Move your list to another device</b><p class="small muted" style="margin:4px 0 8px">Your list is saved in this browser only. Copy the code here, paste it on your other device.</p>
    <div class="row"><button class="btn" id="exp">Copy code</button><span class="sp"></span></div>
    <textarea id="imp" rows="2" placeholder="Paste a code to import" style="margin-top:8px"></textarea>
    <div class="row" style="margin-top:8px"><span class="small muted" id="impmsg"></span><span class="sp"></span><button class="btn" id="impbtn">Import</button></div></div>`;
  pk.bind();
  view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const cur = store.sell;
    for (const lid of Object.keys(cur)) delete cur[lid][b.dataset.del];
    store.sell = cur; renderList();
  }));
  view.querySelectorAll("[data-tog]").forEach((c) => c.addEventListener("change", () => {
    const [lid, pid] = c.dataset.tog.split("|"), cur = store.sell, m = modelById(lid);
    if (c.checked) (cur[lid] ??= {})[pid] = { addedAt: new Date().toISOString().slice(0, 10), baseValue: m.values.players.get(pid).fcValue };
    else delete cur[lid]?.[pid];
    store.sell = cur; renderList();
  }));
  $("#th").addEventListener("change", (e) => { store.settings = { ...store.settings, threshold: +e.target.value }; });
  $("#band").addEventListener("change", (e) => { store.settings = { ...store.settings, band: +e.target.value }; memo.clear(); });
  $("#exp").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(store.exportCode()); $("#impmsg").textContent = "Copied."; }
    catch { $("#imp").value = store.exportCode(); $("#impmsg").textContent = "Copy the code from the box."; }
  });
  $("#impbtn").addEventListener("click", () => {
    try { store.importCode($("#imp").value); memo.clear(); renderList(); } catch { $("#impmsg").textContent = "That code didn't read. Copy it again."; }
  });
}

// ---------- Leagues ----------
function renderLeagues() {
  if (!data) return (view.innerHTML = needData());
  const fmt = (st) => `${st.numTeams}-team ${st.numQbs === 2 ? "SF" : "1QB"}${st.tep ? " TEP" : ""}`;
  view.innerHTML = `<h2>${data.models.length} dynasty leagues</h2><p class="lead">Your mode decides what counts as a good return. Auto reads your record and roster.</p>
  ${data.models.map((m) => { const o = store.modes[m.league.league_id] || ""; const auto = autoMode(m.me, m.values); return `<div class="card"><div class="row"><b style="font-size:17px">${esc(m.league.name)}</b><span class="sp"></span><span class="pill">${esc(fmt(m.settings))}</span></div>
    <p class="small muted" style="margin:4px 0 10px">${m.me.wins}-${m.me.losses} · ranked ${m.me.rank} of ${m.teams.length} on lineup and record</p>
    <select data-mode="${esc(m.league.league_id)}" aria-label="Mode for ${esc(m.league.name)}"><option value="" ${!o ? "selected" : ""}>Auto (${esc(MODE_LABEL[auto])})</option>${["rebuild", "contend", "neutral"].map((x) => `<option value="${x}" ${o === x ? "selected" : ""}>${MODE_LABEL[x]}</option>`).join("")}</select></div>`; }).join("")}`;
  view.querySelectorAll("[data-mode]").forEach((s) => s.addEventListener("change", () => {
    const cur = store.modes;
    if (s.value) cur[s.dataset.mode] = s.value; else delete cur[s.dataset.mode];
    store.modes = cur; memo.clear();
  }));
}

// ---------- router + load ----------
const routes = { board: renderBoard, shop: renderShop, list: renderList, leagues: renderLeagues };
function route() {
  const r = routes[location.hash.slice(1)] ? location.hash.slice(1) : "board";
  document.querySelectorAll("#tabs a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${r}` ? "page" : "false"));
  routes[r]();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

async function load(username) {
  setStatus("Loading your leagues…");
  try {
    data = await loadAll(username, setStatus);
    store.username = username;
    memo.clear();
    const upd = data.models[0]?.valuesUpdated;
    setStatus(`${data.models.length} dynasty leagues loaded for ${data.user.display_name}${upd ? ` · values ${new Date(upd + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`);
  } catch (e) {
    data = null;
    setStatus(/data\/values/.test(e.message) ? "Player values haven't been published yet. The nightly job needs to run once." : e.message);
  }
  route();
}
$("#who").addEventListener("submit", (e) => { e.preventDefault(); const u = $("#username").value.trim(); if (u) load(u); });
$("#username").value = store.username;
if (store.username) load(store.username); else route();
}
