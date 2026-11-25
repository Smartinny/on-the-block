// Nightly data job for On The Block.
// Fetches FantasyCalc dynasty values (per league-format variant), DynastyProcess values,
// appends a rolling value history, and summarises Sleeper weekly usage.
// Runs in GitHub Actions (Node 20+). Writes only under data/.

import { mkdir, readFile, writeFile } from "node:fs/promises";

const QBS = [1, 2];
const TEAMS = [10, 12, 14];
const HISTORY_DAYS = 60;
const today = new Date().toISOString().slice(0, 10);

const getJSON = async (url) => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const round = (n) => (n == null ? null : Math.round(n));

async function fantasyCalc() {
  for (const qb of QBS) {
    for (const teams of TEAMS) {
      const key = `fc-${qb}qb-${teams}`;
      const url = `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${qb}&numTeams=${teams}&ppr=1`;
      const rows = await getJSON(url);
      const players = [];
      const picks = [];
      for (const r of rows) {
        const p = r.player ?? {};
        if (p.position === "PICK") {
          picks.push({ name: p.name, v: round(r.value) });
        } else if (p.sleeperId) {
          players.push({
            id: String(p.sleeperId),
            name: p.name,
            pos: p.position,
            team: p.maybeTeam ?? null,
            age: p.maybeAge ?? null,
            v: round(r.value),
            rv: round(r.redraftValue),
            t30: round(r.trend30Day),
          });
        }
      }
      if (players.length < 200) throw new Error(`${key}: only ${players.length} players`);
      await writeFile(`data/values/${key}.json`, JSON.stringify({ updated: today, players, picks }));
      await appendHistory(key, players);
      console.log(`${key}: ${players.length} players, ${picks.length} picks`);
    }
  }
}

async function appendHistory(key, players) {
  const path = `data/history/${key}.json`;
  let h = { dates: [], v: {} };
  try { h = JSON.parse(await readFile(path, "utf8")); } catch { /* first run */ }
  let idx = h.dates.indexOf(today);
  if (idx === -1) {
    h.dates.push(today);
    idx = h.dates.length - 1;
    for (const id of Object.keys(h.v)) h.v[id].push(null);
  }
  for (const p of players) {
    if (!h.v[p.id]) h.v[p.id] = new Array(h.dates.length).fill(null);
    h.v[p.id][idx] = p.v;
  }
  const drop = Math.max(0, h.dates.length - HISTORY_DAYS);
  if (drop) {
    h.dates = h.dates.slice(drop);
    for (const id of Object.keys(h.v)) h.v[id] = h.v[id].slice(drop);
  }
  for (const id of Object.keys(h.v)) if (h.v[id].every((x) => x == null)) delete h.v[id];
  await writeFile(path, JSON.stringify(h));
}

async function dynastyProcess() {
  const res = await fetch("https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv");
  if (!res.ok) throw new Error(`DP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const split = (line) => {
    const out = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]).map((s) => s.toLowerCase());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`DP CSV missing column ${name}`);
    return i;
  };
  const [iName, iPos, iV1, iV2] = ["player", "pos", "value_1qb", "value_2qb"].map(col);
  const players = [];
  for (const line of lines.slice(1)) {
    const c = split(line);
    const v1 = parseFloat(c[iV1]), v2 = parseFloat(c[iV2]);
    if (!Number.isFinite(v1) && !Number.isFinite(v2)) continue;
    players.push({ name: c[iName], pos: c[iPos], v1: round(v1), v2: round(v2) });
  }
  await writeFile("data/values/dp.json", JSON.stringify({ updated: today, players }));
  console.log(`dp: ${players.length} rows`);
}

async function usage() {
  const state = await getJSON("https://api.sleeper.app/v1/state/nfl");
  const season = Number(state.season);
  const lastWeek = state.season_type === "regular" ? Number(state.week) - 1 : state.season_type === "post" ? 18 : 0;
  if (lastWeek < 1) {
    await writeFile("data/usage.json", JSON.stringify({ updated: today, season, weeks: 0, p: {} }));
    return;
  }
  const weeks = [];
  for (let w = 1; w <= lastWeek; w++) weeks.push(await getJSON(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${w}`));
  const per = {};
  weeks.forEach((wk, wi) => {
    for (const [id, s] of Object.entries(wk)) {
      if (!s || !(s.off_snp > 0 || s.pts_ppr)) continue;
      const opp = (s.rec_tgt ?? 0) + (s.rush_att ?? 0) + (s.pass_att ?? 0) * 0.25;
      const tdPts = 6 * ((s.rec_td ?? 0) + (s.rush_td ?? 0)) + 4 * (s.pass_td ?? 0);
      const snap = s.off_snp && s.tm_off_snp ? s.off_snp / s.tm_off_snp : null;
      (per[id] ??= []).push({ w: wi + 1, opp, pts: s.pts_ppr ?? 0, tdPts, snap });
    }
  });
  const p = {};
  const avg = (a, f) => (a.length ? a.reduce((x, y) => x + f(y), 0) / a.length : null);
  for (const [id, games] of Object.entries(per)) {
    if (games.length < 2) continue;
    const recent = games.filter((g) => g.w > lastWeek - 3);
    const prior = games.filter((g) => g.w <= lastWeek - 3);
    if (!recent.length) continue;
    const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
    const recentPts = recent.reduce((x, g) => x + g.pts, 0);
    p[id] = {
      ro: r1(avg(recent, (g) => g.opp)),
      po: r1(avg(prior, (g) => g.opp)),
      rp: r1(avg(recent, (g) => g.pts)),
      pp: r1(avg(prior, (g) => g.pts)),
      td: recentPts > 0 ? r1(recent.reduce((x, g) => x + g.tdPts, 0) / recentPts) : 0,
      rs: r1(avg(recent.filter((g) => g.snap != null), (g) => g.snap)),
      ps: r1(avg(prior.filter((g) => g.snap != null), (g) => g.snap)),
    };
  }
  await writeFile("data/usage.json", JSON.stringify({ updated: today, season, weeks: lastWeek, p }));
  console.log(`usage: ${Object.keys(p).length} players through week ${lastWeek}`);
}

await mkdir("data/values", { recursive: true });
await mkdir("data/history", { recursive: true });
await fantasyCalc();
await dynastyProcess();
await usage();
