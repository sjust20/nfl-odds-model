// Grid-searches Market model settings on 2003-2015 and reports 2016+ out of sample.
// Objective: RMSE of predicted vs actual home margin. Run: npm run tune
import { readFile } from "node:fs/promises";
import type { GamesFile } from "../src/data/types";
import { runModels } from "../src/model/engine";
import { accuracy, evaluate } from "../src/model/metrics";
import { DEFAULT_SETTINGS, type Settings } from "../src/model/settings";

const file: GamesFile = JSON.parse(await readFile(new URL("../public/data/games.json", import.meta.url), "utf8"));
const games = file.games;

const t0 = performance.now();
const base = runModels(games, DEFAULT_SETTINGS);
console.log(`one full run: ${(performance.now() - t0).toFixed(0)} ms`);

const score = (s: Settings, from: number, to: number) => {
  const run = runModels(games, s);
  const acc = accuracy(run.predictions, "market", "spread", from, to);
  const ats = evaluate(run.predictions, {
    pick: "model", model: "market", market: "spread", minEdge: 0, maxReliability: null, minGames: 0, fromSeason: from, toSeason: to,
  }).overall;
  return { rmse: acc.rmseModel, line: acc.rmseLine, ats: ats.pct, run };
};

type M = Settings["market"];
const grid: Partial<M>[] = [];
for (const halfLifeWeeks of [4, 6, 8])
  for (const seasonCarryover of [0.2, 0.3, 0.4])
    for (const resultWeight of [0.3, 0.4, 0.5])
      for (const coachCarryover of [1])
        for (const ridgeGames of [0.25, 0.5, 1])
          grid.push({ halfLifeWeeks, seasonCarryover, resultWeight, coachCarryover, ridgeGames });

const results = grid.map((g) => {
  const s = { ...DEFAULT_SETTINGS, market: { ...DEFAULT_SETTINGS.market, ...g } };
  const r = score(s, 2003, 2015);
  return { ...g, rmse: +r.rmse.toFixed(3), ats: +(r.ats * 100).toFixed(1) };
});
results.sort((a, b) => a.rmse - b.rmse);
console.table(results.slice(0, 10));
console.table(results.slice(-3));

const best = results[0];
const bestSettings = { ...DEFAULT_SETTINGS, market: { ...DEFAULT_SETTINGS.market, ...best } };
for (const [label, s] of [["best (train pick)", bestSettings], ["current defaults", DEFAULT_SETTINGS]] as const) {
  const out = score(s, 2016, 2100);
  console.log(`${label} on 2016+: rmse ${out.rmse.toFixed(3)} (closing line ${out.line.toFixed(3)}), ATS ${(out.ats * 100).toFixed(1)}%`);
}

// Classic: does the thin-sample blend help?
for (const shrinkGames of [0, 4, 8, 16]) {
  const s = { ...DEFAULT_SETTINGS, classic: { ...DEFAULT_SETTINGS.classic, shrinkGames } };
  const run = runModels(games, s);
  for (const [from, to] of [[2003, 2015], [2016, 2100]]) {
    const acc = accuracy(run.predictions, "classic", "spread", from, to);
    const ats = evaluate(run.predictions, {
      pick: "model", model: "classic", market: "spread", minEdge: 0, maxReliability: null, minGames: 0, fromSeason: from, toSeason: to,
    }).overall;
    console.log(`classic shrink=${shrinkGames} ${from}-${to}: n ${acc.n} rmse ${acc.rmseModel.toFixed(3)} ATS ${(ats.pct * 100).toFixed(1)}%`);
  }
}
void base;
