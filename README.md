# NFL Line Model

A static site that turns the "NFL Lines.xlsx" / "NFL Coaching Stats.xlsm" workflow into an
auto-updating app: a database of NFL lines and results since 1999, team performance against the
line, power rankings, matchup predictions, a walk-forward backtest, and a forward-looking pick log.
A team's history resets whenever its head coach changes, interim coaches included.

## Pages

- **This week**: the current NFL week's games with the sportsbook line (when the odds feed is on),
  both models' lines and totals, edges, reliability, and two picks: one from your sides strategy and
  one from your totals strategy. Each game lists the starting QBs (nflverse's projected starters),
  flagging any change from the team's previous game, since most of the biggest model edges are QB
  changes the model can't see. Also shows last week's results, graded both ways.
- **Power rankings**: Market and Classic ratings, coach tenure, cover stats, and this season's trend.
- **Matchup**: any two teams, home or neutral site.
- **Teams**: cover margin by game under the current coach, rating history, game log, and coaching history.
- **Strategy lab**: separate Sides and Totals tabs, one rule each. Backtest any rule (model edge,
  reliability, minimum games, or, for sides, betting the high- or low-variance team), with results by
  season, an edge × reliability grid split into two eras, and the live out-of-sample record. The
  live record includes closing line value (how far the closing line moved toward each pick). The
  Sides tab also tracks two fixed ideas without betting them (`src/model/tracked.ts`): Market edge
  over 6 with no QB change, and "closing line + efficiency components" (rush offense weighted up,
  pass defense down), scored by its live record and by whether lines move toward it.
- **Model settings**: every parameter of both models. Changes
  recompute in the browser.

## Models

- **Market** (`src/model/market.ts`): weighted least squares over recent closing lines, pulled 30%
  toward final margins, one rating per coaching tenure, adjusted for opponents and home field.
- **Play-by-play**: the Market line plus four opponent-adjusted efficiency components
  (`src/model/components.ts`): each team's pass offense, pass defense, rush offense and rush defense
  in expected points added per play. Stacking weights were learned on 2003–2015.
- Both include a **starting-QB adjustment** (`src/model/qbValue.ts`): each QB's recent EPA per
  dropback, shrunk toward replacement level, compared with the team's recent QB mix.

Held-out margin RMSE, 2016 onward (`npm run tune`): closing line 12.71, play-by-play 12.86, Market
12.90 (13.01 before the QB adjustment). On games with a QB change: line 13.13, Market 13.44 (13.85
before). Efficiency split into pass/rush and offense/defense beat one combined efficiency number;
pass offense is the most stable component week to week (0.55 half-season correlation vs 0.27–0.33
for the rest). Research scripts: `scripts/research-components.ts`, `scripts/research-coach-reset.ts`.

The **engine** (`src/model/engine.ts`) steps week by week, predicting each week using only earlier
data, so the same pass produces the backtest and the live predictions.

The spreadsheet's **Classic** model was retired: its rating (average line faced minus average cover)
is algebraically minus the team's average margin, and it predicted worse than Market. Its cover and
over/under statistics remain (`src/model/ats.ts`, verified against the spreadsheet in
`src/test/ats.test.ts`) because the reliability measure is built from them.

## Data

- Scores, closing lines, totals and head coaches for every game: [nflverse `games.csv`](https://github.com/nflverse/nfldata),
  downloaded on each build (`npm run data`, into `public/data/games.json`, not committed).
- Sportsbook odds (optional): [The Odds API](https://the-odds-api.com), spreads and totals from US
  books. Each pull costs 2 credits (2 markets × 1 region). The workflow pulls at most once a day and
  otherwise reuses the copy on the live site if it's under 20 hours old, so about 60 credits a month.
  Check The Odds API's terms before publishing their data on a public site.
- Play-by-play: nflverse `play_by_play_<season>.csv.gz`, aggregated per game and team (plays,
  expected points added, success, dropbacks, and each QB's dropbacks and EPA) into
  `data/pbp/<season>.json` (`npm run pbp`). Past seasons are committed; the nightly job rebuilds the
  current season and commits it.
- Head-coach corrections: nflverse sometimes carries last season's coach into a new season (2026:
  ARI, ATL, BUF). Each nightly run checks every team's current coach against ESPN's (unofficial) API
  and corrects the current season; near-identical names are only respelled, so they can't cause a
  false reset. ESPN only knows today's coach, so past seasons rely on nflverse. Manual date-ranged
  fixes go in `data/coach-overrides.json` and always win. Corrections are listed on the site.
- Pick log (`public/data/pick-log.json`, committed): each day, predictions for the current NFL week
  are written with the line available at the time. An entry freezes on game day, so it's a true
  out-of-sample record.

## Historical odds (private)

Opening and closing lines since 2020 from The Odds API's historical endpoint, stored in a private
Neon Postgres database (`sql/schema.sql`), not in this repo: the provider's terms allow storing
their data but not redistributing it raw. Needs a paid plan for one month; the full plan is ~18,800
credits (fits the 20K plan). Put `ODDS_API_KEY` and `DATABASE_URL` in `.env.local` (git-ignored), then:

```sh
npm run odds-history -- migrate                      # create tables and the game_open_close view
npm run odds-history -- plan                         # queue a Tuesday opener per week + a close per kickoff time
npm run odds-history -- live-test                    # free-tier end-to-end check (~2 credits)
npm run odds-history -- run --season 2024 --week 1   # trial one week (160 credits), then check
npm run odds-history -- run                          # the rest (resumable; stops at a credit reserve)
npm run odds-history -- status
```

Books: Pinnacle plus nine US books (ten books cost one region). Markets: spreads and totals.

## Develop

```sh
npm install
npm run pbp         # current season's play-by-play (npx tsx scripts/build-pbp.ts 1999 2025 to backfill)
npm run data        # download games and merge play-by-play
npm run dev         # http://localhost:5173
npm test            # model tests
npm run odds        # needs ODDS_API_KEY in the environment
npm run log-picks
npm run tune        # grid-search Market settings (slow)
```

## Deploy (GitHub Pages)

1. Create a GitHub repository and push this folder to `main`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Optional odds feed: in **Settings → Secrets and variables → Actions**, add the secret
   `ODDS_API_KEY`. If the site isn't at `https://<owner>.github.io/<repo>/`, also add the variable
   `SITE_URL` so the daily cache check finds it.
4. The workflow (`.github/workflows/update.yml`) runs daily at 13:00 UTC, on every push, and on
   demand. It downloads data, runs tests, pulls odds, logs picks (committing the log), builds, and
   deploys. If any step fails, the site stays on the previous version.

The Excel files are ignored by git and aren't needed to run the app. Only
`src/test/spreadsheet-fixture.json` (extracted from them) is used to prove the Classic port matches.
