import { autoMode, sellWindow, shopAssets, allPackages, sellVariations, tradeImpact, YOUNG, fmtK, clamp } from "./engine.js";
import { loadAll, historyFor, store } from "./data.js";

{
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view"), subbar = $("#subbar"), statusEl = $("#status");
let data = null;
const memo = new Map();
const S = { pid: null, leagueId: null, varKey: "solo", filter: "all", sel: 0 };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, d = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`;
const setStatus = (t) => (statusEl.textContent = t);
const TINT = { QB: "#e9b79f", RB: "#a9cfb4", WR: "#a9bde8", TE: "#c9b1e0" };
const modeOf = (m) => store.modes[m.league.league_id] || autoMode(m.me, m.values);
const MODE = { rebuild: "Rebuilding", contend: "Contending", neutral: "Neutral" };
const modelById = (id) => data?.models.find((m) => m.league.league_id === id);
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 1800); }

// ---------- headshots ----------
const sleeperImg = (id) => `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(id)}.jpg`;
function hs(id, pos, size, name) {
  const primary = data?.headshots?.[id] || sleeperImg(id);
  const fb = data?.headshots?.[id] ? sleeperImg(id) : "";
  const img = id ? `<img src="${esc(primary)}" ${fb ? `data-fb="${esc(fb)}"` : ""} alt="${esc(name)}" loading="lazy">` : "";
  return `<span class="hs" style="--s:${size}px;--pc:var(--${esc(pos)}, #57534e);--tint:${TINT[pos] ?? "#cfcfc8"}"><span class="ph">${img}</span>${size >= 40 ? `<span class="b">${esc(pos)}</span>` : ""}</span>`;
}
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest(".hs")) return;
  if (img.dataset.fb) { img.src = img.dataset.fb; delete img.dataset.fb; } else img.remove();
}, true);
const shortName = (n) => { const p = String(n).split(" "); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : n; };
const roundTag = (a) => (a.label.match(/(\d)(st|nd|rd|th)$/) || [, a.round, "th"]).slice(1).join("");
const icon = (a, size) => (a.kind === "pick" ? `<span class="pk" style="--s:${size}px">${esc(roundTag(a))}</span>` : hs(a.id, a.pos, size, a.label));

// ---------- data helpers ----------
function myPlayers() {
  const map = new Map();
  for (const m of data?.models ?? []) for (const id of m.me.playerIds) {
    const p = m.values.players.get(id);
    if (!p) continue;
    const e = map.get(id) ?? { id, name: p.name, pos: p.pos, age: p.age, value: p.value, models: [] };
    e.models.push(m);
    e.value = Math.max(e.value, p.value);
    map.set(id, e);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}
function packagesFor(m, variation) {
  const key = `${m.league.league_id}|${variation.key}|${variation.assets.map((a) => a.key).join(",")}|${modeOf(m)}|${store.settings.band}`;
  if (!memo.has(key)) memo.set(key, allPackages(shopAssets(m, m.me.rosterId, variation.assets, { myMode: modeOf(m), band: store.settings.band, max: 6 })));
  return memo.get(key);
}
function category(p) {
  const players = p.get.filter((a) => a.kind === "player");
  if (p.get.length >= 3) return "split";
  if (!players.length) return "picks";
  if (players.length < p.get.length) return "mix";
  return players.some((a) => a.age != null && a.age <= (YOUNG[a.pos] ?? 25)) ? "young" : "swap";
}
const CATS = [["all", "All"], ["picks", "Picks"], ["young", "Young players"], ["mix", "Player + pick"], ["swap", "Player swap"], ["split", "3+ pieces"]];

function picker(id, placeholder, onPick, exclude = []) {
  const html = `<div class="picker"><input type="search" id="${id}" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="${esc(placeholder)}"><div class="opts" id="${id}-o" hidden></div></div>`;
  const bind = () => {
    const input = $(`#${id}`), box = $(`#${id}-o`);
    if (!input) return;
    const show = () => {
      const q = input.value.toLowerCase().trim();
      const list = myPlayers().filter((p) => !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q))).slice(0, 40);
      box.innerHTML = list.map((p) => `<button type="button" data-id="${esc(p.id)}">${hs(p.id, p.pos, 36, p.name)}<span><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.pos)} · ${esc(p.age ?? "")} · ${fmtK(p.value)}</span></span><span class="sp"></span><span class="pill">${p.models.length} league${p.models.length > 1 ? "s" : ""}</span></button>`).join("") || `<div class="empty small">No match on your rosters</div>`;
      box.hidden = false;
    };
    input.addEventListener("focus", show);
    input.addEventListener("input", show);
    box.addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) { box.hidden = true; input.value = ""; onPick(b.dataset.id); } });
    document.addEventListener("click", (e) => { if (!e.target.closest(".picker")) box.hidden = true; });
  };
  return { html, bind };
}
const needData = () => `<div class="empty"><h3>Load your leagues</h3>Type your Sleeper username at the top right and press Load.</div>`;

// ---------- SHOP (design F) ----------
function openShop(pid, leagueId) {
  S.pid = pid; S.leagueId = leagueId ?? null; S.varKey = "solo"; S.filter = "all"; S.sel = 0;
  if (location.hash === "#shop") route(); else location.hash = "shop";
}
function renderShop() {
  if (!data) { subbar.innerHTML = ""; view.innerHTML = needData(); return; }
  const mine = myPlayers();
  if (!S.pid) {
    const listed = Object.values(store.sell).flatMap((o) => Object.keys(o)).find((id) => mine.some((p) => p.id === id));
    S.pid = listed ?? null;
  }
  const player = mine.find((p) => p.id === S.pid);
  const pk = picker("shop-pick", player ? "Shop a different player" : "Who are you selling?", (id) => openShop(id));
  if (!player) {
    subbar.innerHTML = `<div class="sellbar"><div class="in"><div class="tools">${pk.html}</div></div></div>`;
    pk.bind();
    view.innerHTML = `<div class="empty"><h3>Pick a player to shop</h3>Search above, or add players to your <a href="#list">sell list</a>.</div>`;
    return;
  }
  if (!S.leagueId || !player.models.some((m) => m.league.league_id === S.leagueId)) S.leagueId = player.models[0].league.league_id;
  const m = modelById(S.leagueId);
  const vars = sellVariations(m, m.me.rosterId, player.id);
  const v = vars.find((x) => x.key === S.varKey) ?? vars[0];
  S.varKey = v.key;
  const all = packagesFor(m, v);
  const counts = Object.fromEntries(CATS.map(([k]) => [k, k === "all" ? all.length : all.filter((p) => category(p) === k).length]));
  const list = S.filter === "all" ? all : all.filter((p) => category(p) === S.filter);
  S.sel = clamp(S.sel, 0, Math.max(0, list.length - 1));
  const buyers = new Set(all.map((p) => p.buyer.rosterId)).size;

  subbar.innerHTML = `<div class="sellbar"><div class="in">
    <div class="tools">${pk.html}
      ${player.models.length > 1 ? `<select id="lg" aria-label="League">${player.models.map((x) => `<option value="${esc(x.league.league_id)}" ${x === m ? "selected" : ""}>${esc(x.league.name)}</option>`).join("")}</select>` : `<span class="pill" style="background:#ffffff1a;color:#fff">${esc(m.league.name)}</span>`}
      <span class="sp"></span><span style="color:var(--mint)">${esc(MODE[modeOf(m)])} · band ±${Math.round(store.settings.band * 100)}%</span>
    </div>
    <span class="eyebrow" style="color:var(--mint);padding:0 6px 16px 0">SELLING</span>
    ${vars.map((x) => `<button class="tab" role="tab" aria-selected="${x.key === v.key}" data-var="${esc(x.key)}"><span class="stack">${x.assets.map((a) => icon(a, 40)).join("")}</span><span style="margin-left:8px"><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></span></button>`).join("")}
  </div></div>`;
  pk.bind();
  $("#lg")?.addEventListener("change", (e) => { S.leagueId = e.target.value; S.varKey = "solo"; S.sel = 0; renderShop(); });
  subbar.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => { S.varKey = b.dataset.var; S.sel = 0; S.filter = "all"; renderShop(); }));

  const left = `<aside class="list">
    <div class="flex"><h2 style="font-size:26px">${all.length} package${all.length === 1 ? "" : "s"}</h2><span class="sp"></span><span class="muted small">${buyers} buyer${buyers === 1 ? "" : "s"} · sorted by fit</span></div>
    <div class="chips">${CATS.filter(([k]) => k === "all" || counts[k]).map(([k, l]) => `<button class="chip" aria-pressed="${S.filter === k}" data-cat="${k}">${esc(l)} ${counts[k]}</button>`).join("")}</div>
    ${list.map((p, i) => `<button class="row-btn" aria-pressed="${i === S.sel}" data-i="${i}">
      <span><span class="flex" style="gap:8px"><b>${esc(p.buyer.name)}</b><span class="muted small">${esc(p.type)}</span></span>
      <span class="gets">${p.get.map((a) => `<span class="get">${icon(a, 30)}${esc(a.kind === "pick" ? a.label : shortName(a.label) + (a.age ? " " + a.age : ""))}</span>`).join("")}</span></span>
      <span><span class="score" style="display:block;color:${i === S.sel ? "var(--hammer)" : "inherit"}">${p.score}</span><span class="small" style="display:block;text-align:right;font-weight:700;color:${p.odds === "Likely" ? "var(--good)" : p.odds === "Fair shot" ? "var(--warn)" : "var(--muted)"}">${esc(p.odds)}</span></span>
    </button>`).join("") || `<div class="empty small">No packages land inside your value band. Widen it on the Sell list tab, or try another tab above.</div>`}
  </aside>`;
  view.innerHTML = `<div class="shop">${left}<section id="detail">${list[S.sel] ? detail(m, list[S.sel]) : `<div class="card empty"><h3>No package selected</h3></div>`}</section></div>`;
  view.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.cat; S.sel = 0; renderShop(); }));
  view.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
    S.sel = +b.dataset.i;
    view.querySelectorAll("[data-i]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    view.querySelectorAll(".row-btn .score").forEach((x, j) => (x.style.color = j === S.sel ? "var(--hammer)" : "inherit"));
    $("#detail").innerHTML = detail(m, list[S.sel]);
    bindDetail(m, list[S.sel]);
  }));
  if (list[S.sel]) bindDetail(m, list[S.sel]);
}

function sideHtml(assets, big) {
  return assets.map((a, i) => {
    const size = i === 0 && big ? 96 : 64;
    const sub = a.kind === "pick" ? `${a.band === "mid" ? "" : `projected ${a.band} · `}from ${a.owner.replace(/[()]/g, "").trim() || "?"}` : `${a.pos} · ${a.age ?? "?"}${a.team ? " · " + a.team : ""}`;
    return `<div class="asset">${icon(a, size)}<div><div class="nm" style="font-size:${size > 64 ? 32 : 24}px">${esc(a.label)}</div><div class="muted small">${esc(sub)}</div><div class="cond" style="font-weight:800;font-size:20px;margin-top:4px">${fmtK(a.value)}</div></div></div>`;
  }).join("");
}

function tile(k, v, color, bw, aw, note) {
  return `<div class="card tile"><div class="flex"><b>${k}</b><span class="sp"></span><span class="v" style="color:${color}">${v}</span></div>
    <div class="bars"><i style="width:${bw}%;background:#c9cec8"></i><i style="width:${aw}%;background:${color}"></i></div>
    <div class="muted small" style="margin-top:8px">${note}</div></div>`;
}

function detail(m, p) {
  const imp = tradeImpact(m, m.me, p.buyer, p.give, p.get);
  const angle = clamp((p.ratio - 1) * 60, -8, 8);
  const rel = (x) => { const a = 1, b = 1 + x, mx = Math.max(a, b); return [Math.round((a / mx) * 100), Math.round((b / mx) * 100)]; };
  const [wb, wa] = rel(imp.winNow), [fb, fa] = rel(imp.future);
  const ageD = imp.ageAfter - imp.ageBefore;
  const mxF = Math.max(imp.firstsBefore, imp.firstsAfter, 1);
  const col = (good) => (good ? "var(--good)" : "var(--bad)");
  const lost = imp.lostStarters.filter(Boolean);
  return `<div style="display:flex;flex-direction:column;gap:18px">
  <section class="card" style="padding:24px;border-radius:24px"><div class="deal">
    <div><div class="eyebrow" style="color:var(--bad)">YOU LOSE</div>${sideHtml(p.give, true)}</div>
    <div style="text-align:center">
      <svg viewBox="0 0 140 80" width="140" height="80" aria-hidden="true"><polygon points="70,44 60,76 80,76" fill="#14201b"/><g transform="rotate(${angle.toFixed(1)} 70 40)"><line x1="10" y1="40" x2="130" y2="40" stroke="#14201b" stroke-width="4" stroke-linecap="round"/><rect x="2" y="22" width="34" height="16" rx="4" fill="#b3261e"/><rect x="102" y="18" width="36" height="20" rx="4" fill="#1f8a5b"/></g></svg>
      <div class="cond" style="font-weight:800;font-size:30px;color:${col(p.ratio >= 1)}">${pct(p.ratio - 1)}</div>
      <div class="muted small">value ${p.ratio >= 1 ? "your way" : "their way"}</div>
      <div style="margin-top:8px"><span class="pill ${p.odds === "Likely" ? "good" : p.odds === "Fair shot" ? "warn" : ""}">${esc(p.odds)}</span></div>
    </div>
    <div><div class="eyebrow" style="color:var(--good)">YOU GET · ${esc(p.buyer.name.toUpperCase())}</div>${sideHtml(p.get, false)}</div>
  </div></section>
  <section class="tiles">
    ${tile("Win now", pct(imp.winNow), col(imp.winNow >= 0), wb, wa, lost.length ? `Starting lineup loses ${esc(lost.join(", "))}` : "Starting lineup holds")}
    ${tile("Future value", pct(imp.future), col(imp.future >= 0), fb, fa, "Roster + picks, dynasty value")}
    ${tile("Core age", `${ageD > 0 ? "+" : ageD < 0 ? "−" : ""}${Math.abs(ageD).toFixed(1)}y`, col(ageD <= 0), Math.round((imp.ageBefore / 32) * 100), Math.round((imp.ageAfter / 32) * 100), `Top 10 average now ${imp.ageAfter.toFixed(1)}`)}
    ${tile("1st-rounders", `${imp.firstsBefore} → ${imp.firstsAfter}`, col(imp.firstsAfter >= imp.firstsBefore), Math.round((imp.firstsBefore / mxF) * 100), Math.round((imp.firstsAfter / mxF) * 100), "Next three drafts")}
  </section>
  <section class="card"><div class="flex"><b class="eyebrow" style="font-size:18px">YOUR LINEUP AFTER</b><span class="sp"></span><span class="muted small">new starters outlined</span></div>
    <div class="lineup">${imp.lineupAfter.map((s) => `<div class="slot ${s.changed ? "ch" : ""}"><span class="muted" style="font-size:10px">${esc(s.slot)}</span>${s.id ? hs(s.id, s.pos, 44, s.name) : `<span class="hs" style="--s:44px;--tint:#eee;--pc:#ccc"><span class="ph"></span></span>`}<span>${esc(s.name.split(" ").slice(-1)[0])}</span></div>`).join("")}</div>
  </section>
  <div class="flex" style="flex-wrap:wrap">
    <span class="pill" style="background:var(--turf);color:#fff;padding:8px 14px;border-radius:12px;font-size:13px">Why they say yes: lineup rank ${imp.theirRankBefore} → ${imp.theirRankAfter} · ${pct(imp.theirGain)}</span>
    ${p.rosterNote ? `<span class="pill warn">${esc(p.rosterNote)}</span>` : ""}
    <span class="sp"></span>
    <button class="btn hot" id="copy">Copy offer</button>
  </div></div>`;
}
function bindDetail(m, p) {
  $("#copy")?.addEventListener("click", async () => {
    const txt = `Trade idea (${m.league.name}): I send ${p.give.map((a) => a.label).join(" + ")}; you send ${p.get.map((a) => a.label).join(" + ")}. Interested?`;
    try { await navigator.clipboard.writeText(txt); toast("Offer copied"); } catch { toast(txt); }
  });
}

// ---------- BOARD ----------
function windows() {
  const th = store.settings.threshold, groups = new Map();
  for (const [lid, players] of Object.entries(store.sell)) {
    const m = modelById(lid);
    if (!m) continue;
    for (const [pid, entry] of Object.entries(players)) {
      const p = m.values.players.get(pid);
      if (!p || !m.me.playerIds.includes(pid)) continue;
      const hist = historyFor(m, pid);
      const w = sellWindow(entry, p.fcValue, hist, data.usage?.p?.[pid], th);
      const g = groups.get(pid) ?? { pid, name: p.name, pos: p.pos, age: p.age, value: p.value, items: [], hist };
      g.items.push({ m, w });
      groups.set(pid, g);
    }
  }
  for (const g of groups.values()) {
    g.open = g.items.filter((i) => i.w.open);
    g.best = [...g.items].sort((a, b) => b.w.bump - a.w.bump)[0];
    g.bump = g.best.w.bump;
  }
  return [...groups.values()].sort((a, b) => (b.open.length > 0) - (a.open.length > 0) || b.open.length - a.open.length || b.bump - a.bump);
}
function spark(hist) {
  const pts = hist.filter((h) => h.v != null).slice(-30).map((h) => h.v);
  if (pts.length < 2) return "";
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 118 + 1).toFixed(1)} ${(34 - ((v - lo) / span) * 30).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 120 36" width="96" height="30" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--hammer)" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
}
function ring(bump, open) {
  const c = 2 * Math.PI * 38, frac = clamp(bump / 0.16, 0, 1), tick = (store.settings.threshold / 0.16) * 360;
  return `<div class="ring"><svg viewBox="0 0 92 92" width="92" height="92" aria-hidden="true"><circle cx="46" cy="46" r="38" fill="none" stroke="#ecebe3" stroke-width="9"/><circle cx="46" cy="46" r="38" fill="none" stroke="${open ? "#ff6a2b" : bump < 0 ? "#e7b3a6" : "#9fcdb5"}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 46 46)"/><line x1="46" y1="2" x2="46" y2="14" stroke="#14201b" stroke-width="2" transform="rotate(${tick.toFixed(0)} 46 46)"/></svg><b style="color:${bump < 0 ? "var(--bad)" : "inherit"}">${pct(bump)}</b></div>`;
}
function renderBoard() {
  subbar.innerHTML = "";
  if (!data) return (view.innerHTML = needData());
  const gs = windows(), open = gs.filter((g) => g.open.length), watch = gs.filter((g) => !g.open.length);
  const th = store.settings.threshold;
  let html = `<div class="flex" style="align-items:flex-end;margin-bottom:18px"><div><h2>${open.length ? `${open.length} sell window${open.length > 1 ? "s" : ""} open` : "No sell windows open"}</h2>
    <p class="lead" style="margin-bottom:0">Watching ${gs.length} player${gs.length === 1 ? "" : "s"} across ${data.models.length} leagues. A window opens ${pct(th)} above his 30-day low or the value when you listed him.</p></div>
    <span class="sp"></span><a class="btn" href="#list">Edit sell list</a></div>`;
  if (!gs.length) html += `<div class="card empty"><h3>Your sell list is empty</h3>Add players you'd move at the right price, then check back here. <a href="#list">Build your sell list</a></div>`;
  html += `<div class="grid3">`;
  for (const g of open) {
    const it = [...g.open].sort((a, b) => b.w.bump - a.w.bump)[0];
    const solo = sellVariations(it.m, it.m.me.rosterId, g.pid)[0];
    const pk = solo ? packagesFor(it.m, solo)[0] : null;
    const u = it.w.u, urg = it.w.urgency === "Act this week" ? "hot" : it.w.urgency === "Can wait" ? "good" : "warn";
    html += `<article class="card" style="border:2px solid var(--hammer);display:flex;flex-direction:column;gap:14px">
      <div class="flex" style="gap:16px">${ring(g.bump, true)}${hs(g.pid, g.pos, 64, g.name)}<div><div class="cond" style="font-weight:800;font-size:26px;line-height:1.05">${esc(g.name)}</div><div class="muted small">${esc(g.pos)} · ${esc(g.age ?? "")} · ${fmtK(g.value)}</div></div><span class="sp"></span>${spark(g.hist)}</div>
      <div class="flex" style="flex-wrap:wrap;gap:6px"><span class="pill ${urg}">${esc(it.w.urgency)}</span><span class="pill">${esc(u.tag === "unknown" ? "usage n/a" : u.tag)}</span>${g.open.map((i) => `<span class="pill">${esc(i.m.league.name)}</span>`).join("")}</div>
      <div class="muted small">${esc(u.note)}.</div>
      ${pk ? `<div style="background:var(--soft);border-radius:14px;padding:12px"><div class="flex small"><b>Best: ${esc(pk.buyer.name)}</b><span class="sp"></span><span style="font-weight:700;color:${pk.odds === "Likely" ? "var(--good)" : "var(--warn)"}">${esc(pk.odds)}</span></div><div class="gets">${pk.get.map((a) => `<span class="get" style="background:#fff">${icon(a, 30)}${esc(a.label)}</span>`).join("")}</div></div>` : `<div class="muted small">No buyer inside your value band right now.</div>`}
      <button class="btn hot" data-shop="${esc(g.pid)}" data-lg="${esc(it.m.league.league_id)}">See all packages</button>
    </article>`;
  }
  html += `</div>`;
  if (watch.length) html += `<h2 style="font-size:24px;margin:28px 0 10px">Watching</h2><div class="card" style="padding:6px 18px;overflow-x:auto"><table><thead><tr><th>Player</th><th>Trend</th><th>Move</th><th>Needs</th><th>Leagues</th><th></th></tr></thead><tbody>
    ${watch.map((g) => `<tr><td><span class="flex">${hs(g.pid, g.pos, 36, g.name)}<b>${esc(g.name)}</b></span></td><td>${spark(g.hist)}</td><td class="${g.bump >= 0 ? "up" : "down"}" style="font-weight:700">${pct(g.bump)}</td><td>${pct(Math.max(0, th - g.bump))} more</td><td>${g.items.length}</td><td><button class="btn" data-shop="${esc(g.pid)}" data-lg="${esc(g.best.m.league.league_id)}">Shop anyway</button></td></tr>`).join("")}
  </tbody></table></div>`;
  view.innerHTML = html;
  view.querySelectorAll("[data-shop]").forEach((b) => b.addEventListener("click", () => openShop(b.dataset.shop, b.dataset.lg)));
}

// ---------- SELL LIST ----------
function renderList() {
  subbar.innerHTML = "";
  if (!data) return (view.innerHTML = needData());
  const sell = store.sell, s = store.settings, mine = myPlayers();
  const listed = mine.filter((p) => p.models.some((m) => sell[m.league.league_id]?.[p.id]));
  const pk = picker("list-pick", "Add a player you'd sell", (id) => {
    const cur = store.sell, p = mine.find((x) => x.id === id);
    for (const m of p.models) (cur[m.league.league_id] ??= {})[id] = { addedAt: new Date().toISOString().slice(0, 10), baseValue: m.values.players.get(id).fcValue };
    store.sell = cur; memo.clear(); renderList();
  }, listed.map((p) => p.id));
  view.innerHTML = `<div class="listwrap" style="display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;align-items:start">
  <div><h2>Sell list</h2><p class="lead">Players you'd move at the right price. Each is watched in every league you tick.</p>
    <div style="max-width:520px;margin-bottom:16px">${pk.html}</div>
    <div class="grid3">${listed.map((p) => `<div class="card"><div class="flex">${hs(p.id, p.pos, 56, p.name)}<div><div class="cond" style="font-weight:800;font-size:24px;line-height:1.05">${esc(p.name)}</div><div class="muted small">${esc(p.pos)} · ${esc(p.age ?? "")} · ${fmtK(p.value)}</div></div><span class="sp"></span><button class="btn" data-del="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button></div>
      <div class="chips">${p.models.map((m) => { const e = sell[m.league.league_id]?.[p.id]; return `<button class="chip" aria-pressed="${!!e}" data-tog="${esc(m.league.league_id)}|${esc(p.id)}">${esc(m.league.name)}</button>`; }).join("")}</div>
      <div class="flex" style="margin-top:12px"><span class="muted small">Watching since ${esc(Object.values(sell).map((o) => o[p.id]?.addedAt).filter(Boolean).sort()[0] ?? "—")}</span><span class="sp"></span><button class="btn" data-shop="${esc(p.id)}">Shop now</button></div></div>`).join("") || `<div class="card empty"><h3>Nothing listed yet</h3>Search above to add a player.</div>`}</div>
  </div>
  <aside style="display:flex;flex-direction:column;gap:16px">
    <div class="card"><b>Settings</b>
      <label class="small muted" style="display:block;margin-top:12px">Sell window opens at<select id="th" style="width:100%;margin-top:4px;padding:8px;border-radius:10px;border:1px solid var(--line)">${[0.05, 0.08, 0.1, 0.15].map((v) => `<option value="${v}" ${v === s.threshold ? "selected" : ""}>${pct(v)} bump</option>`).join("")}</select></label>
      <label class="small muted" style="display:block;margin-top:12px">Value band for packages<select id="band" style="width:100%;margin-top:4px;padding:8px;border-radius:10px;border:1px solid var(--line)">${[0.05, 0.1, 0.15, 0.2].map((v) => `<option value="${v}" ${v === s.band ? "selected" : ""}>±${Math.round(v * 100)}%</option>`).join("")}</select></label>
    </div>
    <div class="card"><b>Move your list to another device</b><p class="small muted" style="margin:4px 0 10px">Your list is saved in this browser only.</p>
      <button class="btn" id="exp">Copy code</button>
      <textarea id="imp" rows="2" placeholder="Paste a code to import" style="width:100%;margin-top:10px;padding:8px;border-radius:10px;border:1px solid var(--line)"></textarea>
      <div class="flex" style="margin-top:8px"><span class="small muted" id="impmsg"></span><span class="sp"></span><button class="btn" id="impbtn">Import</button></div></div>
  </aside></div>`;
  pk.bind();
  view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { const cur = store.sell; for (const k of Object.keys(cur)) delete cur[k][b.dataset.del]; store.sell = cur; renderList(); }));
  view.querySelectorAll("[data-tog]").forEach((b) => b.addEventListener("click", () => {
    const [lid, pid] = b.dataset.tog.split("|"), cur = store.sell, m = modelById(lid);
    if (cur[lid]?.[pid]) delete cur[lid][pid]; else (cur[lid] ??= {})[pid] = { addedAt: new Date().toISOString().slice(0, 10), baseValue: m.values.players.get(pid).fcValue };
    store.sell = cur; renderList();
  }));
  view.querySelectorAll("[data-shop]").forEach((b) => b.addEventListener("click", () => openShop(b.dataset.shop)));
  $("#th").addEventListener("change", (e) => (store.settings = { ...store.settings, threshold: +e.target.value }));
  $("#band").addEventListener("change", (e) => { store.settings = { ...store.settings, band: +e.target.value }; memo.clear(); });
  $("#exp").addEventListener("click", async () => { try { await navigator.clipboard.writeText(store.exportCode()); $("#impmsg").textContent = "Copied."; } catch { $("#imp").value = store.exportCode(); $("#impmsg").textContent = "Copy the code from the box."; } });
  $("#impbtn").addEventListener("click", () => { try { store.importCode($("#imp").value); memo.clear(); renderList(); } catch { $("#impmsg").textContent = "That code didn't read."; } });
}

// ---------- LEAGUES ----------
function renderLeagues() {
  subbar.innerHTML = "";
  if (!data) return (view.innerHTML = needData());
  const fmt = (st) => `${st.numTeams}-team · ${st.numQbs === 2 ? "Superflex" : "1QB"}${st.tep ? " · TE premium" : ""}`;
  view.innerHTML = `<h2>${data.models.length} dynasty leagues</h2><p class="lead">Your mode decides what counts as a good return. Auto reads your record and roster.</p>
  <div class="grid3">${data.models.map((m) => {
    const o = store.modes[m.league.league_id] || "", auto = autoMode(m.me, m.values);
    const top = m.me.playerIds.map((id) => m.values.players.get(id)).filter(Boolean).sort((a, b) => b.value - a.value).slice(0, 5);
    return `<div class="card"><div class="flex"><b style="font-size:17px">${esc(m.league.name)}</b><span class="sp"></span><span class="pill">${esc(fmt(m.settings))}</span></div>
      <div class="flex" style="margin:12px 0"><div class="stack">${top.map((p) => hs(p.id, p.pos, 40, p.name)).join("")}</div><span class="sp"></span><div style="text-align:right"><div class="cond" style="font-weight:800;font-size:26px;line-height:1">${m.me.wins}-${m.me.losses}</div><div class="muted small">ranked ${m.me.rank} of ${m.teams.length}</div></div></div>
      <select data-mode="${esc(m.league.league_id)}" aria-label="Mode for ${esc(m.league.name)}" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--line)"><option value="" ${!o ? "selected" : ""}>Auto (${esc(MODE[auto])})</option>${["rebuild", "contend", "neutral"].map((x) => `<option value="${x}" ${o === x ? "selected" : ""}>${MODE[x]}</option>`).join("")}</select></div>`;
  }).join("")}</div>`;
  view.querySelectorAll("[data-mode]").forEach((s) => s.addEventListener("change", () => { const cur = store.modes; if (s.value) cur[s.dataset.mode] = s.value; else delete cur[s.dataset.mode]; store.modes = cur; memo.clear(); }));
}

// ---------- router + load ----------
const routes = { board: renderBoard, shop: renderShop, list: renderList, leagues: renderLeagues };
function route() {
  const r = routes[location.hash.slice(1)] ? location.hash.slice(1) : "board";
  document.querySelectorAll("#tabs a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${r}` ? "page" : "false"));
  routes[r]();
}
window.addEventListener("hashchange", route);
async function load(username) {
  setStatus("Loading your leagues…");
  try {
    data = await loadAll(username, setStatus);
    store.username = username;
    memo.clear();
    const upd = data.models[0]?.valuesUpdated;
    setStatus(`${data.models.length} leagues · ${data.user.display_name}${upd ? ` · values ${new Date(upd + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`);
  } catch (e) {
    data = null;
    setStatus(/data\/values/.test(e.message) ? "Player values aren't published yet: the nightly job needs to run once." : e.message);
  }
  route();
}
$("#who").addEventListener("submit", (e) => { e.preventDefault(); const u = $("#username").value.trim(); if (u) load(u); });
$("#username").value = store.username;
if (store.username) load(store.username); else route();
}
