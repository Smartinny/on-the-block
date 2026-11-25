// Network + local storage. Sleeper is called live from the browser; values come from
// files the nightly job commits next to the site.
import { buildLeague, buildValueIndex, settingsFromLeague, variantKey } from "./engine.js";

const SLEEPER = "https://api.sleeper.app/v1";
const cache = new Map();

async function getJSON(url, { optional = false } = {}) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(async (r) => {
    if (!r.ok) {
      if (optional) return null;
      throw new Error(`${r.status} loading ${url.replace(SLEEPER, "Sleeper")}`);
    }
    return r.json();
  });
  cache.set(url, p);
  try { return await p; } catch (e) { cache.delete(url); throw e; }
}

export const loadValues = (variant) => getJSON(`./data/values/${variant}.json`);
export const loadDP = () => getJSON("./data/values/dp.json", { optional: true });
export const loadHistory = (variant) => getJSON(`./data/history/${variant}.json`, { optional: true });
export const loadUsage = () => getJSON("./data/usage.json", { optional: true });
export const loadHeadshots = () => getJSON("./data/headshots.json", { optional: true });

/** Every dynasty league for a Sleeper username, each built into a model. */
export async function loadAll(username, onProgress = () => {}) {
  const user = await getJSON(`${SLEEPER}/user/${encodeURIComponent(username.trim())}`);
  if (!user?.user_id) throw new Error(`No Sleeper user called "${username}"`);
  const state = await getJSON(`${SLEEPER}/state/nfl`);
  const season = state.league_season ?? state.season;
  const leagues = (await getJSON(`${SLEEPER}/user/${user.user_id}/leagues/nfl/${season}`)) ?? [];
  const dynasty = leagues.filter((l) => {
    const s = settingsFromLeague(l);
    return s.isDynasty && !s.bestBall;
  });
  onProgress(`Found ${dynasty.length} dynasty leagues`);
  const dp = await loadDP();
  const [usage, headshots] = await Promise.all([loadUsage(), loadHeadshots()]);
  const models = await Promise.all(dynasty.map(async (league) => {
    const settings = settingsFromLeague(league);
    const variant = variantKey(settings);
    const [rosters, users, tradedPicks, fc, history] = await Promise.all([
      getJSON(`${SLEEPER}/league/${league.league_id}/rosters`),
      getJSON(`${SLEEPER}/league/${league.league_id}/users`),
      getJSON(`${SLEEPER}/league/${league.league_id}/traded_picks`),
      loadValues(variant),
      loadHistory(variant),
    ]);
    const values = buildValueIndex(fc, dp, settings);
    const model = buildLeague({ league, rosters, users, tradedPicks, values });
    model.variant = variant;
    model.history = history;
    model.valuesUpdated = fc.updated;
    model.me = model.teams.find((t) => t.ownerId === user.user_id || (rosters.find((r) => r.roster_id === t.rosterId)?.co_owners ?? []).includes(user.user_id));
    return model;
  }));
  return { user, season, models: models.filter((m) => m.me), usage, headshots: headshots ?? {} };
}

export function historyFor(model, id) {
  const h = model.history;
  if (!h?.v?.[id]) return [];
  return h.dates.map((date, i) => ({ date, v: h.v[id][i] }));
}

// ---------- local storage (one browser, one device) ----------
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const store = {
  get username() { return read("otb.user", ""); },
  set username(v) { write("otb.user", v); },
  get sell() { return read("otb.sell", {}); },
  set sell(v) { write("otb.sell", v); },
  get modes() { return read("otb.modes", {}); },
  set modes(v) { write("otb.modes", v); },
  get settings() { return { band: 0.1, threshold: 0.08, ...read("otb.settings", {}) }; },
  set settings(v) { write("otb.settings", v); },
  exportCode() { return btoa(unescape(encodeURIComponent(JSON.stringify({ sell: this.sell, modes: this.modes, settings: this.settings })))); },
  importCode(code) {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (o.sell) this.sell = o.sell;
    if (o.modes) this.modes = o.modes;
    if (o.settings) this.settings = o.settings;
  },
};
