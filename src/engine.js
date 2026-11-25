// On The Block — pure engine. No network, no DOM. Unit-tested in Node.
// Values: dynasty `value` (FantasyCalc blended with DynastyProcess) drives fairness;
// `redraft` (win-now) drives lineup strength and buyer need.

export const AGE_CLIFF = { QB: 32, RB: 26, WR: 29, TE: 30 };
export const YOUNG = { QB: 26, RB: 24, WR: 25, TE: 26 };
const ELIGIBLE = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],
  FLEX: ["RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};
const ROUND_LABEL = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };
// Pick value by projected finish of the ORIGINAL owner: [early, mid, late].
const BAND = { 1: [1.45, 1, 0.8], 2: [1.2, 1, 0.88], 3: [1.08, 1, 0.94] };
const BAND_CONF = [0.8, 0.5, 0.3]; // years out 1, 2, 3+ (0 = current-year draft)
const PICK_FALLBACK = { 1: 3200, 2: 1400, 3: 550, 4: 200, 5: 100 };
const POWER = 1.3; // consolidation: one star beats the same total spread thin

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const normName = (s) =>
  String(s ?? "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

// ---------- league settings ----------
export function settingsFromLeague(league) {
  const rp = league.roster_positions ?? [];
  const slots = rp.filter((s) => ELIGIBLE[s]);
  const qbSlots = rp.filter((s) => s === "QB").length;
  const sf = rp.includes("SUPER_FLEX");
  const sc = league.scoring_settings ?? {};
  const st = league.settings ?? {};
  return {
    numQbs: sf || qbSlots >= 2 ? 2 : 1,
    numTeams: league.total_rosters ?? 12,
    ppr: sc.rec ?? 1,
    tep: sc.bonus_rec_te ?? 0,
    slots,
    rosterSize: rp.filter((s) => s !== "IR" && s !== "TAXI").length,
    draftRounds: st.draft_rounds ?? 4,
    season: Number(league.season),
    status: league.status,
    isDynasty: st.type === 2,
    bestBall: st.best_ball === 1,
  };
}

export function variantKey(s) {
  const teams = [10, 12, 14].reduce((a, b) => (Math.abs(b - s.numTeams) < Math.abs(a - s.numTeams) ? b : a));
  return `fc-${s.numQbs}qb-${teams}`;
}

// ---------- values ----------
export function buildValueIndex(fc, dp, settings) {
  const dpMap = new Map();
  for (const r of dp?.players ?? []) {
    const v = settings.numQbs === 2 ? r.v2 : r.v1;
    if (v != null) dpMap.set(`${normName(r.name)}|${r.pos}`, v);
  }
  const tepMult = 1 + 0.2 * Math.min(settings.tep, 1);
  const players = new Map();
  for (const p of fc.players) {
    const d = dpMap.get(`${normName(p.name)}|${p.pos}`);
    let value = d != null ? 0.65 * p.v + 0.35 * d : p.v;
    let redraft = p.rv > 0 ? p.rv : p.v * 0.5;
    if (p.pos === "TE" && settings.tep > 0) { value *= tepMult; redraft *= tepMult; }
    players.set(p.id, {
      id: p.id, name: p.name, pos: p.pos, team: p.team, age: p.age != null ? Math.floor(p.age) : null,
      value: Math.round(value), redraft: Math.round(redraft), fcValue: p.v, trend30: p.t30 ?? 0,
    });
  }
  const pickGeneric = new Map(), pickBanded = new Map();
  for (const k of fc.picks ?? []) {
    const m = /^(\d{4})\s+(?:Round\s+)?(\d)(?:st|nd|rd|th)?(?:\s+\((Early|Mid|Late)\))?$/i.exec(k.name.trim());
    if (!m) continue;
    if (m[3]) pickBanded.set(`${m[1]}-${m[2]}-${m[3].toLowerCase()}`, k.v);
    else pickGeneric.set(`${m[1]}-${m[2]}`, k.v);
  }
  return { players, pickGeneric, pickBanded };
}

// ---------- lineups ----------
export function bestLineup(ids, slots, players) {
  const pool = ids.map((id) => players.get(id)).filter(Boolean).sort((a, b) => b.redraft - a.redraft);
  const used = new Set();
  let total = 0;
  const filled = slots.map((slot, i) => ({ slot, i, id: null }));
  const order = [...filled].sort((a, b) => ELIGIBLE[a.slot].length - ELIGIBLE[b.slot].length);
  for (const f of order) {
    const pick = pool.find((p) => !used.has(p.id) && ELIGIBLE[f.slot].includes(p.pos));
    if (pick) { used.add(pick.id); total += pick.redraft; f.id = pick.id; }
  }
  return { total, starters: used, slots: filled };
}

// ---------- league model ----------
export function buildLeague({ league, rosters, users, tradedPicks, values }) {
  const settings = settingsFromLeague(league);
  const { players } = values;
  const userName = new Map(users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name || "Team"]));
  const teams = rosters.map((r) => {
    const ids = r.players ?? [];
    const lu = bestLineup(ids, settings.slots, players);
    const s = r.settings ?? {};
    const games = (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0);
    const dynasty = ids.reduce((x, id) => x + (players.get(id)?.value ?? 0), 0);
    return {
      rosterId: r.roster_id, ownerId: r.owner_id, name: userName.get(r.owner_id) ?? `Team ${r.roster_id}`,
      playerIds: ids, lineup: lu.total, starters: lu.starters, dynasty,
      wins: s.wins ?? 0, losses: s.losses ?? 0, games, winPct: games ? ((s.wins ?? 0) + 0.5 * (s.ties ?? 0)) / games : null,
    };
  });
  // Strength: lineup rank, blended with record once 3+ games are played.
  const n = teams.length;
  const byLineup = [...teams].sort((a, b) => b.lineup - a.lineup);
  byLineup.forEach((t, i) => (t.lineupPct = n > 1 ? 1 - i / (n - 1) : 0.5));
  for (const t of teams) {
    t.strength = t.games >= 3 && t.winPct != null ? 0.6 * t.lineupPct + 0.4 * t.winPct : t.lineupPct;
  }
  const byStrength = [...teams].sort((a, b) => b.strength - a.strength);
  byStrength.forEach((t, i) => {
    t.rank = i + 1;
    t.tier = i < Math.round(n / 3) ? "contender" : i >= n - Math.round(n / 3) ? "rebuilder" : "middle";
  });
  const byId = new Map(teams.map((t) => [t.rosterId, t]));

  // Picks: everyone owns their own, then apply trades.
  const firstSeason = settings.status === "pre_draft" || settings.status === "drafting" ? settings.season : settings.season + 1;
  const seasons = [firstSeason, firstSeason + 1, firstSeason + 2];
  const own = new Map(); // key season-round-orig -> current owner rosterId
  for (const s of seasons) for (let r = 1; r <= settings.draftRounds; r++) for (const t of teams) own.set(`${s}-${r}-${t.rosterId}`, t.rosterId);
  for (const tp of tradedPicks ?? []) {
    const k = `${tp.season}-${tp.round}-${tp.roster_id}`;
    if (own.has(k)) own.set(k, tp.owner_id);
  }
  for (const t of teams) t.picks = [];
  for (const [k, owner] of own) {
    const [season, rnd, orig] = k.split("-").map(Number);
    const team = byId.get(owner);
    if (!team) continue;
    team.picks.push(pickAsset(season, rnd, byId.get(orig), settings, values, n));
  }
  for (const t of teams) t.picks.sort((a, b) => b.value - a.value);
  return { league, settings, teams, byId, values };
}

function pickAsset(season, round, origTeam, settings, values, n) {
  const yearsOut = season - settings.season - (settings.status === "pre_draft" || settings.status === "drafting" ? 0 : 1);
  const generic = values.pickGeneric.get(`${season}-${round}`)
    ?? Math.round((PICK_FALLBACK[round] ?? 80) * Math.pow(0.85, Math.max(0, yearsOut)));
  const rank = origTeam?.rank ?? Math.ceil(n / 2);
  const band = rank <= Math.round(n / 3) ? "late" : rank > n - Math.round(n / 3) ? "early" : "mid";
  const mults = BAND[round] ?? [1, 1, 1];
  const raw = band === "early" ? mults[0] : band === "late" ? mults[2] : 1;
  const conf = BAND_CONF[Math.min(Math.max(yearsOut, 0), 2)];
  const mult = 1 + (raw - 1) * conf;
  // FantasyCalc prices early/mid/late for the next draft itself: use the market's number.
  const market = values.pickBanded?.get(`${season}-${round}-${band}`);
  const own = origTeam ? ` (${origTeam.name})` : "";
  return {
    key: `k:${season}-${round}-${origTeam?.rosterId}`, kind: "pick", season, round, band,
    label: `${season} ${band === "mid" ? "" : band[0].toUpperCase() + band.slice(1) + " "}${ROUND_LABEL[round] ?? round + "th"}`,
    owner: own, value: Math.round(market ?? generic * mult), redraft: 0, age: null, pos: "PICK",
  };
}

export function playerAsset(id, values) {
  const p = values.players.get(id);
  if (!p) return null;
  return { key: `p:${id}`, kind: "player", id, label: p.name, pos: p.pos, age: p.age, value: p.value, redraft: p.redraft, team: p.team };
}

export function teamAssets(team, values) {
  return [
    ...team.playerIds.map((id) => playerAsset(id, values)).filter((a) => a && a.value > 0),
    ...team.picks,
  ];
}

// ---------- mode & lenses ----------
export function autoMode(team, values) {
  if (team.tier === "contender") return "contend";
  if (team.tier === "rebuilder") return "rebuild";
  const top = team.playerIds.map((id) => values.players.get(id)).filter(Boolean).sort((a, b) => b.value - a.value).slice(0, 10);
  const age = top.reduce((x, p) => x + (p.age ?? 26), 0) / Math.max(1, top.length);
  return age >= 27 ? "rebuild" : "neutral";
}

export function lens(a, mode) {
  if (a.kind === "pick") return mode === "rebuild" ? 1.12 : mode === "contend" ? 0.85 : 1;
  if (a.age == null || !AGE_CLIFF[a.pos]) return 1;
  const old = a.age >= AGE_CLIFF[a.pos], young = a.age <= YOUNG[a.pos];
  if (mode === "rebuild") return young ? 1.08 : old ? 0.82 : 1;
  if (mode === "contend") return old ? 1.06 : young && a.redraft < a.value * 0.35 ? 0.92 : 1;
  return 1;
}

export const sideValue = (assets, f = (a) => a.value) =>
  Math.pow(assets.reduce((x, a) => x + Math.pow(Math.max(0, f(a)), POWER), 0), 1 / POWER);

// ---------- packages ----------
function* combos(arr, k, start = 0, cur = []) {
  if (cur.length === k) { yield cur; return; }
  for (let i = start; i < arr.length; i++) yield* combos(arr, k, i + 1, [...cur, arr[i]]);
}

function typeLabel(give, get) {
  const gp = get.filter((a) => a.kind === "player").length, gk = get.length - gp;
  let t = gp === 0 ? "Picks" : gk === 0 ? (gp === 1 ? "Player swap" : gp >= 3 ? "Split: 3 players" : "Two players") : "Player + pick";
  if (get.length >= 3 && gp && gk) t = "Split";
  if (give.length > 1) t += " · you add a piece";
  return t;
}

/**
 * Every realistic package one buyer could send for `sellAssets`.
 * opts: { myMode, band (0.10), max (10) }
 */
export function packagesForBuyer(model, me, buyer, sellAssets, opts = {}) {
  const { values, settings } = model;
  const band = opts.band ?? 0.1;
  const myMode = opts.myMode ?? autoMode(me, values);
  const theirMode = buyer.tier === "contender" ? "contend" : buyer.tier === "rebuilder" ? "rebuild" : "neutral";
  const sellKeys = new Set(sellAssets.map((a) => a.key));
  const sellRaw = sideValue(sellAssets);
  const beforeTheirs = buyer.lineup;

  // What they could send: filtered to what suits your mode, near the right size.
  let pool = teamAssets(buyer, values).filter((a) => a.value >= sellRaw * 0.04 && a.value <= sellRaw * 1.15);
  if (myMode === "rebuild") pool = pool.filter((a) => a.kind === "pick" || (a.age != null && a.age <= (YOUNG[a.pos] ?? 25) + 1));
  pool = pool.sort((a, b) => b.value - a.value).slice(0, 16);

  // Your sweeteners: small extras that close a gap.
  const mine = teamAssets(me, values).filter((a) => !sellKeys.has(a.key) && a.value <= sellRaw * 0.3 && a.value >= sellRaw * 0.03);
  const sweeteners = mine
    .filter((a) => a.kind === "player" ? lens(a, "rebuild") <= 1 && lens(a, myMode) <= 1 : a.round >= 2)
    .sort((a, b) => b.value - a.value).slice(0, 4);

  const out = [];
  const sweetOpts = [null, ...sweeteners];
  for (let k = 1; k <= 3; k++) {
    for (const get of combos(pool, k)) {
      const flat = get.reduce((x, a) => x + a.value, 0);
      if (flat < sellRaw * 0.6 || flat > sellRaw * 2.2) continue;
      for (const sw of sweetOpts) {
        const give = sw ? [...sellAssets, sw] : sellAssets;
        const giveRaw = sw ? sideValue(give) : sellRaw;
        const getRaw = sideValue(get);
        const ratio = getRaw / giveRaw;
        if (ratio < 1 - band || ratio > 1 + band) continue;

        // Your lens: do you come out ahead for your plan?
        const myDelta = sideValue(get, (a) => a.value * lens(a, myMode)) / sideValue(give, (a) => a.value * lens(a, myMode));
        if (myDelta < 0.98) continue;

        // Their lineup after the deal: need gates contenders.
        const giveIds = new Set(get.filter((a) => a.kind === "player").map((a) => a.id));
        const afterIds = [...buyer.playerIds.filter((id) => !giveIds.has(id)), ...give.filter((a) => a.kind === "player").map((a) => a.id)];
        const after = bestLineup(afterIds, settings.slots, values.players).total;
        const gain = after - beforeTheirs;
        const gainShare = beforeTheirs > 0 ? gain / beforeTheirs : 0;
        if (theirMode === "contend" && gain <= 0) continue;
        const needBoost = 1 + clamp(gainShare * 3, -0.1, 0.2);
        const theirDelta = (sideValue(give, (a) => a.value * lens(a, theirMode)) * needBoost) / sideValue(get, (a) => a.value * lens(a, theirMode));
        if (theirDelta < 0.98) continue;

        const fairness = clamp(1 - Math.abs(ratio - 1.02) / band, 0, 1);
        const fit = clamp((myDelta - 0.98) / 0.2, 0, 1);
        const need = clamp(gainShare * 8, 0, 1);
        const odds = clamp((theirDelta - 0.98) / 0.15, 0, 1);
        // Fewer pieces are easier to accept and cost them fewer roster spots.
        const clutter = 5 * (get.length - 1) + (sw ? 4 : 0);
        const score = Math.max(0, Math.round(30 * fairness + 25 * fit + 25 * need + 20 * odds - clutter));
        const extraPlayers = give.filter((a) => a.kind === "player").length - giveIds.size;
        const over = buyer.playerIds.length + extraPlayers - settings.rosterSize;
        out.push({
          give, get, ratio, myDelta, theirDelta, gain, gainShare, score,
          type: typeLabel(give, get),
          odds: theirDelta >= 1.08 ? "Likely" : theirDelta >= 1.0 ? "Fair shot" : "Stretch",
          rosterNote: over > 0 ? `They'll need to drop ${over}` : null,
        });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return diversify(out, opts.max ?? 10);
}

// Keep variety: best of each type first, then the rest by score.
function diversify(list, max) {
  const seen = new Set(), first = [], rest = [];
  const sig = (p) => [...p.give, ...p.get].map((a) => a.key).sort().join("|");
  const uniq = new Set();
  for (const p of list) {
    const s = sig(p);
    if (uniq.has(s)) continue;
    uniq.add(s);
    (seen.has(p.type) ? rest : (seen.add(p.type), first)).push(p);
  }
  return [...first.sort((a, b) => b.score - a.score), ...rest].slice(0, max);
}

/** Shop any mix of your assets (players and/or picks) in one league. */
export function shopAssets(model, myRosterId, sellAssets, opts = {}) {
  const me = model.byId.get(myRosterId);
  if (!me || !sellAssets.length) return [];
  const buyers = [];
  for (const t of model.teams) {
    if (t.rosterId === myRosterId) continue;
    const packages = packagesForBuyer(model, me, t, sellAssets, opts);
    for (const p of packages) p.buyer = t;
    if (packages.length) buyers.push({ team: t, packages, best: packages[0].score });
  }
  return buyers.sort((a, b) => b.best - a.best);
}

/** Shop players in one league: every buyer, ranked by their best package. */
export function shop(model, myRosterId, sellIds, opts = {}) {
  return shopAssets(model, myRosterId, sellIds.map((id) => playerAsset(id, model.values)).filter(Boolean), opts);
}

/** Every package from every buyer, flattened and ranked. */
export function allPackages(buyers) {
  return buyers.flatMap((b) => b.packages).sort((a, b) => b.score - a.score);
}

/**
 * Ways to sell around one player: on his own, with a small add-on,
 * a similar-value teammate instead, or both together.
 */
export function sellVariations(model, myRosterId, playerId) {
  const me = model.byId.get(myRosterId);
  const base = playerAsset(playerId, model.values);
  if (!me || !base) return [];
  const out = [{ key: "solo", label: base.label, sub: `${base.pos} · ${fmtK(base.value)}`, assets: [base] }];
  const addOn = me.picks.filter((k) => k.round >= 2 && k.value <= base.value * 0.35).sort((a, b) => a.season - b.season || a.round - b.round)[0];
  if (addOn) out.push({ key: "plus", label: `${base.label} + ${addOn.label}`, sub: "reach for a bigger return", assets: [base, addOn] });
  const similar = me.playerIds.filter((id) => id !== playerId).map((id) => playerAsset(id, model.values))
    .filter((a) => a && Math.abs(a.value / base.value - 1) <= 0.15).sort((a, b) => Math.abs(a.value - base.value) - Math.abs(b.value - base.value)).slice(0, 2);
  for (const a of similar) out.push({ key: `alt:${a.id}`, label: a.label, sub: `similar value · ${a.pos} ${a.age ?? ""}`.trim(), assets: [a] });
  if (similar[0]) out.push({ key: "bundle", label: `${base.label} + ${similar[0].label}`, sub: `bundle · ${fmtK(base.value + similar[0].value)}`, assets: [base, similar[0]] });
  return out;
}

export const fmtK = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : String(Math.round(v)));

/** What a package does to your team (and why they say yes). */
export function tradeImpact(model, me, buyer, give, get) {
  const { settings, values } = model;
  const ids = (as) => new Set(as.filter((a) => a.kind === "player").map((a) => a.id));
  const keys = (as) => new Set(as.map((a) => a.key));
  const giveIds = ids(give), getIds = ids(get), giveKeys = keys(give), getKeys = keys(get);
  const myAfterIds = [...me.playerIds.filter((id) => !giveIds.has(id)), ...getIds];
  const before = bestLineup(me.playerIds, settings.slots, values.players);
  const after = bestLineup(myAfterIds, settings.slots, values.players);
  const pickVal = (ps) => ps.reduce((x, k) => x + k.value, 0);
  const rosterVal = (pids) => pids.reduce((x, id) => x + (values.players.get(id)?.value ?? 0), 0);
  const myPicksAfter = [...me.picks.filter((k) => !giveKeys.has(k.key)), ...get.filter((a) => a.kind === "pick")];
  const futBefore = rosterVal(me.playerIds) + pickVal(me.picks);
  const futAfter = rosterVal(myAfterIds) + pickVal(myPicksAfter);
  const coreAge = (pids) => {
    const top = pids.map((id) => values.players.get(id)).filter((p) => p && p.age).sort((a, b) => b.value - a.value).slice(0, 10);
    return top.reduce((x, p) => x + p.age, 0) / Math.max(1, top.length);
  };
  const firsts = (ps) => ps.filter((k) => k.round === 1).length;
  // Their lineup rank before and after.
  const theirAfterIds = [...buyer.playerIds.filter((id) => !getIds.has(id)), ...giveIds];
  const theirAfter = bestLineup(theirAfterIds, settings.slots, values.players).total;
  const others = model.teams.filter((t) => t.rosterId !== buyer.rosterId).map((t) => t.lineup);
  const rankOf = (v) => 1 + others.filter((o) => o > v).length;
  const slotName = (s) => ({ SUPER_FLEX: "SF", WRRB_FLEX: "W/R", REC_FLEX: "W/T" }[s] ?? s);
  return {
    winNow: before.total ? after.total / before.total - 1 : 0,
    future: futBefore ? futAfter / futBefore - 1 : 0,
    ageBefore: coreAge(me.playerIds), ageAfter: coreAge(myAfterIds),
    firstsBefore: firsts(me.picks), firstsAfter: firsts(myPicksAfter),
    lineupAfter: after.slots.map((f) => {
      const p = f.id ? values.players.get(f.id) : null;
      return { slot: slotName(f.slot), id: f.id, name: p?.name ?? "Empty", pos: p?.pos ?? "", changed: !!f.id && !before.starters.has(f.id) };
    }),
    lostStarters: [...before.starters].filter((id) => !after.starters.has(id)).map((id) => values.players.get(id)?.name),
    theirRankBefore: rankOf(buyer.lineup), theirRankAfter: rankOf(theirAfter),
    theirGain: buyer.lineup ? theirAfter / buyer.lineup - 1 : 0,
  };
}

// ---------- sell window ----------
export function usageTag(u) {
  if (!u || u.po == null) return { tag: "unknown", note: "Not enough games to read usage" };
  const more = u.ro >= u.po * 1.15 && u.ro - u.po >= 2;
  if (more) return { tag: "more work", note: `Opportunities up ${u.po.toFixed(1)} → ${u.ro.toFixed(1)} a game`, wait: true };
  if (u.td >= 0.35 || (u.pp > 0 && u.rp >= u.pp * 1.25)) return { tag: "luck", note: `${Math.round(u.td * 100)}% of recent points from TDs, usage flat` };
  return { tag: "steady", note: "Usage and scoring steady" };
}

/**
 * entry: { addedAt, baseValue } · cur: current value · hist: [{date, v}] (FC values, oldest first)
 */
export function sellWindow(entry, cur, hist, usage, threshold = 0.08) {
  const recent = hist.filter((h) => h.v != null).slice(-30);
  const low = Math.min(cur, ...recent.map((h) => h.v));
  const high = Math.max(cur, ...recent.map((h) => h.v));
  const fromLow = low > 0 ? cur / low - 1 : 0;
  const fromAdd = entry.baseValue > 0 ? cur / entry.baseValue - 1 : 0;
  const bump = Math.max(fromLow, fromAdd);
  const u = usageTag(usage);
  const open = bump >= threshold;
  return {
    open, bump, fromLow, fromAdd, atHigh: cur >= high * 0.98, u,
    urgency: !open ? null : u.tag === "luck" ? "Act this week" : u.tag === "more work" ? "Can wait" : "This fortnight",
  };
}
