# On The Block

Dynasty fantasy football **sell-side** trade finder for Sleeper. Works across every dynasty league on your account.

- **Board:** players on your sell list whose value just bumped, with the best package for each.
- **Shop:** the package picker. Pick a player; tabs offer ways to sell around him (on his own, plus a small pick, a similar-value teammate instead, or both together). Every package from every buyer is listed, filterable by type; the selected one shows who you lose and get (headshots), the value balance, what it does to your team (win now, future value, core age, 1st-rounders), your lineup after, and why they'd say yes.
- **Sell list:** the players you'd move at the right price. Saved in your browser; copy a code to move it between devices.
- **Leagues:** your mode per league (rebuilding, contending, neutral), auto-detected or set by you.

## How it works

- Static site on GitHub Pages. Sleeper is called live from your browser (public API, no login).
- A nightly GitHub Action (`.github/workflows/data.yml`) saves dynasty values to `data/`:
  FantasyCalc (per format: 1QB/SF × 10/12/14 teams), DynastyProcess, a 60-day value history, and Sleeper weekly usage.
- Engine (`src/engine.js`, tested in `test/`):
  - Values: FantasyCalc 65% + DynastyProcess 35%; TE premium lifts TEs.
  - Picks valued by the original owner's projected finish (early/mid/late), damped by years out.
  - Buyer need = how much your player lifts their best lineup (win-now values). Contenders must improve.
  - Packages: every combination of up to 3 assets from the buyer, plus an optional sweetener from you, inside your value band (±10% default). A star counts for more than the same total spread across pieces.
  - Both sides must come out ahead in their own lens (rebuilders favour youth and picks; contenders favour points now).
  - Sell window: value up 8%+ on the 30-day low or since you listed him. Usage says how urgent: luck (TD-driven) means act now.

- Headshots: the nightly job maps Sleeper IDs to photo URLs from nflverse rosters (`data/headshots.json`); the app falls back to Sleeper's own image server, then to a silhouette.

## Deploy (first time)

1. Create an empty public repo `Smartinny/on-the-block` and push this folder.
2. Actions → Nightly data → Run workflow (publishes `data/`).
3. Settings → Pages → Deploy from branch `main`, folder `/ (root)`.
4. Open https://smartinny.github.io/on-the-block and enter your Sleeper username.

## Develop

```
npm test          # engine tests
python3 -m http.server   # then open http://localhost:8000
```

Run the data job by hand: Actions → Nightly data → Run workflow.
