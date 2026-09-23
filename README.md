# NFL Line Model

A static site that turns the "NFL Lines.xlsx" / "NFL Coaching Stats.xlsm" workflow into an
auto-updating app: a database of NFL lines and results since 1999, team performance against the
line, power rankings, matchup predictions, a walk-forward backtest, and a forward-looking pick log.
A team's history resets whenever its head coach changes, interim coaches included.

## Pages

- **This week**: the current NFL week's games with the sportsbook line (when the odds feed is on),
  both models' lines and totals, edges, reliability, and two picks: one from your sides strategy and
  one from your totals strategy. Also shows last week's results, graded both ways.
- **Power rankings**: Market and Classic ratings, coach tenure, cover stats, and this season's trend.
- **Matchup**: any two teams, home or neutral site.
- **Teams**: cover margin by game under the current coach, rating history, game log, and coaching history.
- **Strategy lab**: separate Sides and Totals tabs, one rule each. Backtest any rule (model edge,
  reliability, minimum games, or, for sides, betting the high- or low-variance team), with results by
  season, an edge × reliability grid split into two eras, and the live out-of-sample record.
- **Model settings**: every model parameter, including the "spreadsheet exactly" preset. Changes
  recompute in the browser.

## Models

- **Classic** (`src/model/classic.ts`): a port of the spreadsheet, verified to 10 decimal places
  against its cached values (`src/test/classic.test.ts`). Rating = average (or EMA) line faced minus
  average cover. The matchup formula is Sheet3's (half the gap, or 0.55× when the teams sit on
  opposite sides of average, with 3 points of home field split between them). One optional change:
  thin samples are blended toward the Market view (`shrinkGames`; 0 = exact spreadsheet).
- **Market** (`src/model/market.ts`): weighted least squares over recent closing lines, blended 30%
  with actual margins, with one rating per coaching tenure. A new coach starts from part of the
  previous regime's evidence (a soft reset), which fades as old games do. Defaults were tuned on
  2003–2015 and checked on 2016 onward (`npm run tune`).
- **Engine** (`src/model/engine.ts`): steps week by week, predicting each week using only earlier
  data. The same pass produces the backtest and the live predictions.

## Data

- Scores, closing lines, totals and head coaches for every game: [nflverse `games.csv`](https://github.com/nflverse/nfldata),
  downloaded on each build (`npm run data`, into `public/data/games.json`, not committed).
- Sportsbook odds (optional): [The Odds API](https://the-odds-api.com), spreads and totals from US
  books. Each pull costs 2 credits (2 markets × 1 region). The workflow pulls at most once a day and
  otherwise reuses the copy on the live site if it's under 20 hours old, so about 60 credits a month.
  Check The Odds API's terms before publishing their data on a public site.
- Pick log (`public/data/pick-log.json`, committed): each day, predictions for the next 8 days are
  written with the line available at the time. An entry freezes on game day, so it's a true
  out-of-sample record.

## Develop

```sh
npm install
npm run data        # download games
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
