// Smoke test against a real Sleeper account using the published data files.
// Usage: node scripts/smoke.mjs <sleeper username>
import { readFile } from "node:fs/promises";
import { buildLeague, buildValueIndex, settingsFromLeague, variantKey, autoMode, sellVariations, shopAssets, allPackages, tradeImpact } from "../src/engine.js";

const username = process.argv[2] ?? "Smartinny";
const S = "https://api.sleeper.app/v1";
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const file = async (p) => JSON.parse(await readFile(p, "utf8"));
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

const user = await get(`${S}/user/${username}`);
const state = await get(`${S}/state/nfl`);
const season = state.league_season ?? state.season;
const leagues = (await get(`${S}/user/${user.user_id}/leagues/nfl/${season}`)) ?? [];
console.log(`user ${user.display_name} (${user.user_id}) · season ${season} · ${leagues.length} leagues total`);
const dp = await file("data/values/dp.json");
const heads = await file("data/headshots.json");
const usage = await file("data/usage.json");
const injuries = await file("data/injuries.json").catch(() => ({}));
for (const league of leagues) {
  const st = settingsFromLeague(league);
  console.log(`\n=== ${league.name} · type ${league.settings?.type} · best_ball ${league.settings?.best_ball ?? 0} · ${st.numTeams}T ${st.numQbs === 2 ? "SF" : "1QB"} tep ${st.tep} · status ${league.status}`);
  if (!st.isDynasty || st.bestBall) { console.log("  skipped (not dynasty or best ball)"); continue; }
  const t0 = Date.now();
  const [rosters, users, tradedPicks] = await Promise.all(["rosters", "users", "traded_picks"].map((x) => get(`${S}/league/${league.league_id}/${x}`)));
  const fc = await file(`data/values/${variantKey(st)}.json`);
  const values = buildValueIndex(fc, dp, st, { usage, injuries });
  const m = buildLeague({ league, rosters, users, tradedPicks, values });
  const me = m.teams.find((t) => t.ownerId === user.user_id || (rosters.find((r) => r.roster_id === t.rosterId)?.co_owners ?? []).includes(user.user_id));
  if (!me) { console.log("  not on a roster"); continue; }
  const valued = me.playerIds.filter((id) => values.players.has(id));
  console.log(`  me: ${me.name} · ${me.wins}-${me.losses} · rank ${me.rank}/${m.teams.length} · tier ${me.tier} · auto mode ${autoMode(me, values)} · ${me.playerIds.length} players (${valued.length} valued, ${valued.filter((id) => heads[id]).length} with headshots) · picks ${me.picks.length} (${me.picks.filter((k) => k.round === 1).map((k) => k.label).join(", ")})`);
  const inj = valued.map((id) => values.players.get(id)).filter((p) => p.injury);
  if (inj.length) console.log(`  your injured: ${inj.map((p) => `${p.name} (${p.injury}, ${p.ppg}ppg→${p.redraft})`).join("; ")}`);
  const vet = valued.map((id) => values.players.get(id)).filter((p) => p.age >= 26).sort((a, b) => b.value - a.value)[0];
  if (!vet) continue;
  const mode = autoMode(me, values);
  const vars = sellVariations(m, me.rosterId, vet.id);
  console.log(`  selling ${vet.name} (${vet.pos} ${vet.age}, ${vet.value}) as ${mode} · variations: ${vars.map((v) => v.label).join(" | ")}`);
  const pk = allPackages(shopAssets(m, me.rosterId, vars[0].assets, { myMode: mode, band: 0.1, max: 6 }));
  console.log(`  ${pk.length} packages in ${Date.now() - t0}ms`);
  for (const p of pk.slice(0, 4)) {
    const imp = tradeImpact(m, me, p.buyer, p.give, p.get);
    console.log(`   ${p.score} ${p.odds.padEnd(9)} ${p.buyer.name}: get ${p.get.map((a) => `${a.label} (${a.value}${a.kind === "player" ? `, ${a.ppg}ppg${a.injury ? ", " + a.injury : ""}` : ""})`).join(" + ")}${p.give.length > 1 ? ` · you add ${p.give.slice(1).map((a) => a.label).join(", ")}` : ""} · win now ${pct(imp.winNow)} future ${pct(imp.future)} · their rank ${imp.theirRankBefore}→${imp.theirRankAfter}`);
  }
}
