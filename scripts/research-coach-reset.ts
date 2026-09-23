// Research: how well does each coach-reset setting predict a new regime's first 8 games? Run: npx tsx scripts/research-coach-reset.ts
import { readFile } from "node:fs/promises";
import { isFinal } from "../src/data/types";
import { runModels } from "../src/model/engine";
import { DEFAULT_SETTINGS } from "../src/model/settings";
const { games } = JSON.parse(await readFile(new URL("../public/data/games.json", import.meta.url), "utf8"));
for (const coachCarryover of [0, 0.25, 0.5, 1, 2, 4]) {
  for (const reset of [true, false]) {
    if (!reset && coachCarryover) continue;
    const s = { ...DEFAULT_SETTINGS, resetOnCoachChange: reset, market: { ...DEFAULT_SETTINGS.market, coachCarryover } };
    const run = runModels(games, s);
    const ref = runModels(games, { ...s, resetOnCoachChange: true });
    let n = 0, se = 0, seLine = 0;
    ref.predictions.forEach((p, i) => {
      const g = p.game;
      if (!isFinal(g) || g.season < 2003 || p.minGames >= 8 || g.line === null) return;
      const pred = run.predictions[i].market.line;
      se += (pred - (g.homeScore - g.awayScore)) ** 2; seLine += (g.line - (g.homeScore - g.awayScore)) ** 2; n++;
    });
    console.log(`reset=${reset} coachPrior=${coachCarryover}: games where a team has <8 under its coach n=${n} rmse ${Math.sqrt(se / n).toFixed(3)} (line ${Math.sqrt(seLine / n).toFixed(3)})`);
  }
}
