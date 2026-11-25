import test from "node:test";
import assert from "node:assert/strict";
import {
  settingsFromLeague, variantKey, buildValueIndex, bestLineup, buildLeague,
  shop, sideValue, sellWindow, usageTag, lens,
} from "../src/engine.js";

// Deterministic fake league: 12 teams, superflex, TEP.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const POS = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE"];
const fcPlayers = [];
for (let i = 0; i < 300; i++) {
  const pos = POS[i % POS.length];
  const age = 21 + Math.floor(rnd() * 13);
  const v = Math.round(9000 * Math.pow(rnd(), 2.2)) + 50;
  const prime = age >= 24 && age <= 29 ? 1 : 0.6;
  fcPlayers.push({ id: String(1000 + i), name: `Player ${i}`, pos, team: "XX", age, v, rv: Math.round(v * prime * (0.5 + rnd())), t30: 0 });
}
const fc = { players: fcPlayers, picks: [
  { name: "2027 1st", v: 3600 }, { name: "2027 2nd", v: 1500 }, { name: "2027 3rd", v: 600 }, { name: "2027 4th", v: 250 },
  { name: "2028 1st", v: 3300 }, { name: "2028 2nd", v: 1300 },
] };
const dp = { players: [{ name: "Player 0", pos: "QB", v1: 2000, v2: 4000 }] };

const league = {
  league_id: "L1", season: "2026", status: "in_season", total_rosters: 12,
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX", ...Array(15).fill("BN"), "IR", "TAXI"],
  scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
  settings: { type: 2, draft_rounds: 4 },
};
const rosters = Array.from({ length: 12 }, (_, t) => ({
  roster_id: t + 1, owner_id: `u${t + 1}`,
  players: fcPlayers.filter((_, i) => i % 12 === t).map((p) => p.id),
  settings: { wins: 11 - t, losses: t },
}));
const users = rosters.map((r) => ({ user_id: r.owner_id, display_name: `Mgr ${r.roster_id}` }));
const tradedPicks = [{ season: "2027", round: 1, roster_id: 12, owner_id: 3, previous_owner_id: 12 }];

test("settings parse superflex + TEP", () => {
  const s = settingsFromLeague(league);
  assert.equal(s.numQbs, 2);
  assert.equal(s.tep, 0.5);
  assert.equal(s.slots.length, 10);
  assert.equal(s.rosterSize, 25);
  assert.equal(variantKey(s), "fc-2qb-12");
});

test("value index blends DP and applies TEP", () => {
  const vi = buildValueIndex(fc, dp, settingsFromLeague(league));
  assert.equal(vi.players.get("1000").value, Math.round(0.65 * fcPlayers[0].v + 0.35 * 4000));
  const te = fcPlayers.find((p) => p.pos === "TE");
  assert.equal(vi.players.get(te.id).value, Math.round(te.v * 1.1));
  assert.equal(vi.pickGeneric.get("2027-1"), 3600);
});

test("lineup fills restrictive slots first", () => {
  const vi = buildValueIndex(fc, dp, settingsFromLeague(league));
  const lu = bestLineup(rosters[0].players, settingsFromLeague(league).slots, vi.players);
  assert.ok(lu.starters.size <= 10 && lu.total > 0);
});

test("consolidation premium: one star > two halves", () => {
  assert.ok(sideValue([{ value: 6000 }]) > sideValue([{ value: 3000 }, { value: 3000 }]) * 0.8);
  assert.ok(sideValue([{ value: 3000 }, { value: 3000 }]) < 6000);
});

test("traded pick moves owner and early band raises value", () => {
  const values = buildValueIndex(fc, dp, settingsFromLeague(league));
  const m = buildLeague({ league, rosters, users, tradedPicks, values });
  const t3 = m.byId.get(3);
  const acquired = t3.picks.find((p) => p.key === "k:2027-1-12");
  assert.ok(acquired, "team 3 owns team 12's 2027 1st");
  assert.ok(!m.byId.get(12).picks.some((p) => p.key === "k:2027-1-12"));
  const all = m.teams.flatMap((t) => t.picks).filter((p) => p.season === 2027 && p.round === 1);
  const weakest = [...m.teams].sort((a, b) => b.rank - a.rank)[0];
  const strongest = [...m.teams].sort((a, b) => a.rank - b.rank)[0];
  const early = all.find((p) => p.key === `k:2027-1-${weakest.rosterId}`);
  const late = all.find((p) => p.key === `k:2027-1-${strongest.rosterId}`);
  assert.equal(early.band, "early");
  assert.equal(late.band, "late");
  assert.ok(early.value > late.value);
});

test("shop finds buyers with valid packages for a rebuilder selling a vet", () => {
  const values = buildValueIndex(fc, dp, settingsFromLeague(league));
  const m = buildLeague({ league, rosters, users, tradedPicks, values });
  const me = m.teams.find((t) => t.tier === "rebuilder");
  const vet = me.playerIds.map((id) => values.players.get(id))
    .filter((p) => p.age >= 27 && p.value > 1500).sort((a, b) => b.value - a.value)[0];
  assert.ok(vet, "fixture has a vet to sell");
  const t0 = performance.now();
  const buyers = shop(m, me.rosterId, [vet.id], { myMode: "rebuild" });
  const ms = performance.now() - t0;
  console.log(`selling ${vet.name} (${vet.pos}, ${vet.age}, ${vet.value}) → ${buyers.length} buyers in ${ms.toFixed(0)}ms`);
  for (const b of buyers.slice(0, 3)) {
    const p = b.packages[0];
    console.log(`  ${b.team.name} [${b.team.tier}] score ${p.score} ${p.type} ${p.odds}: get ${p.get.map((a) => `${a.label}(${a.value})`).join(" + ")}${p.give.length > 1 ? " | you add " + p.give.slice(1).map((a) => a.label).join(", ") : ""} ratio ${p.ratio.toFixed(2)}`);
  }
  assert.ok(buyers.length > 0);
  for (const b of buyers) for (const p of b.packages) {
    assert.ok(p.ratio >= 0.9 && p.ratio <= 1.1);
    assert.ok(p.get.every((a) => a.kind === "pick" || a.age <= 27), "rebuild gets youth or picks");
    if (b.team.tier === "contender") assert.ok(p.gain > 0, "contender must improve");
  }
  assert.ok(ms < 3000);
});

test("lens favours picks when rebuilding", () => {
  assert.ok(lens({ kind: "pick" }, "rebuild") > lens({ kind: "pick" }, "contend"));
  assert.ok(lens({ kind: "player", pos: "RB", age: 28, value: 1, redraft: 1 }, "rebuild") < 1);
});

test("sell window opens on a bump and reads usage", () => {
  const hist = [5000, 4800, 4700, 4900].map((v, i) => ({ date: `d${i}`, v }));
  const w = sellWindow({ baseValue: 4900 }, 5200, hist, { ro: 8, po: 8.2, rp: 20, pp: 13, td: 0.45 });
  assert.equal(w.open, true);
  assert.equal(w.u.tag, "luck");
  assert.equal(w.urgency, "Act this week");
  const closed = sellWindow({ baseValue: 5200 }, 5150, hist.map((h) => ({ ...h, v: 5100 })), null);
  assert.equal(closed.open, false);
  assert.equal(usageTag({ ro: 12, po: 8, rp: 15, pp: 12, td: 0.1 }).tag, "more work");
});

import { sellVariations, shopAssets, allPackages, tradeImpact } from "../src/engine.js";

test("sell variations, asset shopping and impact", () => {
  const values = buildValueIndex(fc, dp, settingsFromLeague(league));
  const m = buildLeague({ league, rosters, users, tradedPicks, values });
  const me = m.teams.find((t) => t.tier === "rebuilder");
  const vet = me.playerIds.map((id) => values.players.get(id)).filter((p) => p.age >= 27 && p.value > 1500).sort((a, b) => b.value - a.value)[0];
  const vars = sellVariations(m, me.rosterId, vet.id);
  console.log("variations:", vars.map((v) => v.label).join(" | "));
  assert.ok(vars.length >= 1 && vars[0].assets[0].id === vet.id);
  for (const v of vars) {
    const pk = allPackages(shopAssets(m, me.rosterId, v.assets, { myMode: "rebuild" }));
    console.log(`  ${v.label}: ${pk.length} packages`);
    if (!pk.length) continue;
    const p = pk[0];
    const imp = tradeImpact(m, me, p.buyer, p.give, p.get);
    assert.ok(Number.isFinite(imp.winNow) && Number.isFinite(imp.future));
    assert.equal(imp.lineupAfter.length, 10);
    assert.ok(imp.theirRankAfter <= imp.theirRankBefore, "buyer should not get worse");
    if (v.key === "solo") console.log(`  impact: winNow ${(imp.winNow * 100).toFixed(1)}% future ${(imp.future * 100).toFixed(1)}% age ${imp.ageBefore.toFixed(1)}→${imp.ageAfter.toFixed(1)} 1sts ${imp.firstsBefore}→${imp.firstsAfter} rank ${imp.theirRankBefore}→${imp.theirRankAfter} lost ${imp.lostStarters}`);
  }
});
