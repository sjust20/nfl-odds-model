// Tunes the play-by-play model on 2003-2015 and compares it with Market on 2016 onward.
// Objective: RMSE of predicted vs actual home margin. Run: npm run tune
import { readFile } from "node:fs/promises";
import { noQbChange } from "../src/data/qb";
import { isFinal, type GamesFile } from "../src/data/types";
import { runModels, type ModelKey, type Prediction } from "../src/model/engine";
import { betFor, record, type Strategy } from "../src/model/metrics";
import { DEFAULT_SETTINGS, type RatingSettings, type Settings } from "../src/model/settings";

const file: GamesFile = JSON.parse(await readFile(new URL("../public/data/games.json", import.meta.url), "utf8"));
const games = file.games;
const QB_SCALES = [0, 0.5, 0.75, 1, 1.25];
const TRAIN: [number, number] = [2003, 2015];
const TEST: [number, number] = [2016, 2100];

/** Margin RMSE for a model at a given QB scale (the adjustment is additive, so no rerun needed). */
function rmse(preds: Prediction[], k: ModelKey, used: number, scale: number, [from, to]: [number, number], filter = (_: Prediction) => true) {
  let se = 0;
  let seLine = 0;
  let n = 0;
  for (const p of preds) {
    const g = p.game;
    if (!isFinal(g) || g.line === null || g.season < from || g.season > to || !filter(p)) continue;
    const line = p[k].line + (scale - used) * p.qbAdj;
    const m = g.homeScore - g.awayScore;
    se += (line - m) ** 2;
    seLine += (g.line - m) ** 2;
    n++;
  }
  return { rmse: Math.sqrt(se / n), line: Math.sqrt(seLine / n), n };
}

const t0 = performance.now();
const baseRun = runModels(games, DEFAULT_SETTINGS);
console.log(`one full run (both models): ${(performance.now() - t0).toFixed(0)} ms`);

// 1. Grid over play-by-play settings, scored on the training years.
type Cand = Partial<RatingSettings>;
const grid: Cand[] = [];
for (const efficiencyWeight of [0.05, 0.1, 0.15, 0.2, 0.3])
  for (const resultWeight of [0, 0.1])
    for (const efficiency of ["all"] as const)
      for (const halfLifeWeeks of [3, 4, 6])
        for (const seasonCarryover of [0.3])
          if (efficiencyWeight + resultWeight <= 1) grid.push({ efficiencyWeight, resultWeight, efficiency, halfLifeWeeks, seasonCarryover });

const results = grid.map((c) => {
  const s: Settings = { ...DEFAULT_SETTINGS, pbp: { ...DEFAULT_SETTINGS.pbp, ...c } };
  const run = runModels(games, s);
  let best = { scale: 0, rmse: Infinity };
  for (const scale of QB_SCALES) {
    const r = rmse(run.predictions, "pbp", s.pbp.qbScale, scale, TRAIN).rmse;
    if (r < best.rmse) best = { scale, rmse: r };
  }
  return { ...c, qbScale: best.scale, rmse: +best.rmse.toFixed(3) };
});
results.sort((a, b) => a.rmse - b.rmse);
console.log("\nBest play-by-play settings on 2003-2015:");
console.table(results.slice(0, 8));

// 2. Market's own best QB scale on the training years (its other settings were tuned earlier).
const marketScale = QB_SCALES.reduce(
  (best, scale) => {
    const r = rmse(baseRun.predictions, "market", DEFAULT_SETTINGS.market.qbScale, scale, TRAIN).rmse;
    return r < best.rmse ? { scale, rmse: r } : best;
  },
  { scale: 0, rmse: Infinity },
);
console.log(`\nMarket's best QB scale on 2003-2015: ${marketScale.scale} (rmse ${marketScale.rmse.toFixed(3)})`);

// 3. Head to head on the held-out years.
const { qbScale: pbpScale, rmse: _trainRmse, ...bestPbp } = results[0];
void _trainRmse;
const final: Settings = {
  ...DEFAULT_SETTINGS,
  market: { ...DEFAULT_SETTINGS.market, qbScale: marketScale.scale },
  pbp: { ...DEFAULT_SETTINGS.pbp, ...bestPbp, qbScale: pbpScale },
};
const run = runModels(games, final);
const qbChange = (p: Prediction) => !noQbChange(p.qb);
console.log("\nHeld out 2016-now, margin RMSE (lower is better):");
const rows: Record<string, unknown>[] = [];
for (const [label, filter] of [
  ["all games", () => true],
  ["games with a QB change", qbChange],
  ["no QB change", (p: Prediction) => !qbChange(p)],
] as [string, (p: Prediction) => boolean][]) {
  const m0 = rmse(run.predictions, "market", final.market.qbScale, 0, TEST, filter);
  const m = rmse(run.predictions, "market", final.market.qbScale, final.market.qbScale, TEST, filter);
  const p0 = rmse(run.predictions, "pbp", final.pbp.qbScale, 0, TEST, filter);
  const p = rmse(run.predictions, "pbp", final.pbp.qbScale, final.pbp.qbScale, TEST, filter);
  rows.push({ games: label, n: m.n, closingLine: +m.line.toFixed(3), market: +m0.rmse.toFixed(3), marketQb: +m.rmse.toFixed(3), pbp: +p0.rmse.toFixed(3), pbpQb: +p.rmse.toFixed(3) });
}
console.table(rows);

// 4. Against the spread with the default filters.
const rule = (model: ModelKey, skipQbChange: boolean, from: number, to: number): Strategy => ({
  pick: "model", model, market: "spread", minEdge: 0, maxReliability: 24, minGames: 8, skipQbChange, fromSeason: from, toSeason: to,
});
const ats = (s: Strategy) => {
  const res = run.predictions.map((p) => betFor(p, s)?.result).filter((r) => r === 0 || r === 1);
  const w = res.filter((r) => r === 1).length;
  const rec = record(w, res.length - w);
  return `${(rec.pct * 100).toFixed(1)}% n=${res.length}`;
};
console.log("\nDefault sides filters (reliability <= 24, both teams 8+ games):");
for (const model of ["market", "pbp"] as const)
  for (const skip of [true, false])
    console.log(`  ${model.padEnd(6)} ${skip ? "skip QB changes" : "keep QB changes"}: 2003-15 ${ats(rule(model, skip, 2003, 2015))} | 2016-now ${ats(rule(model, skip, 2016, 2100))}`);
console.log("\nChosen settings:", JSON.stringify({ market: final.market, pbp: final.pbp }));
