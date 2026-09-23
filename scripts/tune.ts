// Learns the play-by-play model's stacking weights and the tracked "line + components" weights on
// 2003-2015 from the engine's own walk-forward predictions, then scores everything on 2016 onward.
// Market's own settings were grid-searched earlier (see git history of this file).
// Run: npm run tune
import { readFile } from "node:fs/promises";
import { noQbChange } from "../src/data/qb";
import { isFinal, type GamesFile } from "../src/data/types";
import { COMPONENT_KEYS, type ComponentDiffs } from "../src/model/components";
import { runModels, type Prediction } from "../src/model/engine";
import { solveSpd } from "../src/model/linalg";
import { betFor, record, type Strategy } from "../src/model/metrics";
import { DEFAULT_SETTINGS } from "../src/model/settings";
import { LINE_PLUS_COMPONENTS, lineAdjustment } from "../src/model/tracked";

const { games }: GamesFile = JSON.parse(await readFile(new URL("../public/data/games.json", import.meta.url), "utf8"));
const TRAIN = [2003, 2015];
const TEST = [2016, 2100];

const t0 = performance.now();
const run = runModels(games, DEFAULT_SETTINGS);
console.log(`one full run: ${(performance.now() - t0).toFixed(0)} ms`);

const done = run.predictions.filter((p) => isFinal(p.game) && p.game.line !== null);
const inRange = (p: Prediction, [a, b]: number[]) => p.game.season >= a && p.game.season <= b;
const train = done.filter((p) => inRange(p, TRAIN));
const test = done.filter((p) => inRange(p, TEST));
const margin = (p: Prediction) => p.game.homeScore! - p.game.awayScore!;
const comps = (p: Prediction) => COMPONENT_KEYS.map((k) => p.components[k]);

function ols(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const A = new Float64Array(k * k);
  const b = new Float64Array(k);
  X.forEach((row, r) => {
    for (let i = 0; i < k; i++) {
      b[i] += row[i] * y[r];
      for (let j = 0; j < k; j++) A[i * k + j] += row[i] * row[j];
    }
  });
  for (let i = 0; i < k; i++) A[i * k + i] += 1e-6;
  return [...solveSpd(A, b, k)];
}
const asWeights = (b: number[]): ComponentDiffs =>
  Object.fromEntries(COMPONENT_KEYS.map((k, i) => [k, +b[i].toFixed(2)])) as unknown as ComponentDiffs;

// 0. Market's QB adjustment scale (additive, so it can be rescored without rerunning).
const qbRmse = (ps: Prediction[], scale: number) =>
  Math.sqrt(ps.reduce((s, p) => s + (p.market.line + (scale - DEFAULT_SETTINGS.market.qbScale) * p.qbAdj - margin(p)) ** 2, 0) / ps.length);
console.log(`\nMarket QB scale, margin RMSE on 2003-2015 (in use: ${DEFAULT_SETTINGS.market.qbScale}):`);
console.log("  " + [0, 0.5, 0.75, 1, 1.25].map((k) => `${k}: ${qbRmse(train, k).toFixed(3)}`).join(" | "));

// 1. Play-by-play stacking: margin ~ intercept + a × Market line + Σ w × component edges.
const pb = ols(train.map((p) => [1, p.market.line, ...comps(p)]), train.map(margin));
console.log("\nPlay-by-play weights learned on 2003-2015 (put these in DEFAULT_SETTINGS.pbp):");
console.log(JSON.stringify({ intercept: +pb[0].toFixed(2), marketWeight: +pb[1].toFixed(2), weights: asWeights(pb.slice(2)) }));
console.log("Currently in use:", JSON.stringify({ intercept: DEFAULT_SETTINGS.pbp.intercept, marketWeight: DEFAULT_SETTINGS.pbp.marketWeight, weights: DEFAULT_SETTINGS.pbp.weights }));

// 2. Tracked idea: margin - closing line ~ intercept + Σ w × component edges.
const lc = ols(train.map((p) => [1, ...comps(p)]), train.map((p) => margin(p) - p.game.line!));
console.log("\nLine + components weights learned on 2003-2015 (src/model/tracked.ts):");
console.log(JSON.stringify({ intercept: +lc[0].toFixed(2), weights: asWeights(lc.slice(1)) }));
console.log("Currently in use:", JSON.stringify(LINE_PLUS_COMPONENTS));

// 3. Head to head on the held-out years.
const rmse = (ps: Prediction[], f: (p: Prediction) => number) => Math.sqrt(ps.reduce((s, p) => s + (f(p) - margin(p)) ** 2, 0) / ps.length);
const qbChange = (p: Prediction) => !noQbChange(p.qb);
console.log(`\nHeld out 2016-now, margin RMSE (lower is better):`);
console.table(
  (
    [
      ["all games", () => true],
      ["games with a QB change", qbChange],
      ["no QB change", (p: Prediction) => !qbChange(p)],
    ] as [string, (p: Prediction) => boolean][]
  ).map(([label, keep]) => {
    const ps = test.filter(keep);
    return {
      games: label,
      n: ps.length,
      closingLine: +rmse(ps, (p) => p.game.line!).toFixed(3),
      market: +rmse(ps, (p) => p.market.line).toFixed(3),
      pbp: +rmse(ps, (p) => p.pbp.line).toFixed(3),
      linePlusComponents: +rmse(ps, (p) => p.game.line! + lineAdjustment(p.components)).toFixed(3),
    };
  }),
);

// 4. Against the spread with the default sides filters, per model.
const rule = (model: "market" | "pbp", from: number, to: number): Strategy => ({
  pick: "model", model, market: "spread", minEdge: 0, maxReliability: 24, minGames: 8, skipQbChange: true, fromSeason: from, toSeason: to,
});
const ats = (s: Strategy) => {
  const res = run.predictions.map((p) => betFor(p, s)?.result).filter((r) => r === 0 || r === 1);
  const w = res.filter((r) => r === 1).length;
  const rec = record(w, res.length - w);
  return `${(rec.pct * 100).toFixed(1)}% n=${res.length}`;
};
console.log("\nDefault sides rule (reliability <= 24, both teams 8+ games, no QB changes):");
for (const model of ["market", "pbp"] as const)
  console.log(`  ${model.padEnd(6)} 2002-14 ${ats(rule(model, 2002, 2014))} | 2015-now ${ats(rule(model, 2015, 2100))} | all ${ats(rule(model, 2002, 2100))}`);
