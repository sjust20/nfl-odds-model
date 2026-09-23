// Research: does splitting efficiency into pass/rush offense/defense predict margins better?
// Walk-forward: before each week, fit opponent-adjusted per-play EPA ratings for each team's
// pass offense, pass defense, rush offense and rush defense from earlier games only. Then learn
// how much each component matters on 2003-2015 and score 2016 onward.
// Run: npx tsx scripts/research-components.ts
import { readFile } from "node:fs/promises";
import { isFinal, type Game, type GamesFile } from "../src/data/types";
import { runModels } from "../src/model/engine";
import { solveSpd } from "../src/model/linalg";
import { DEFAULT_SETTINGS } from "../src/model/settings";

const { games }: GamesFile = JSON.parse(await readFile(new URL("../public/data/games.json", import.meta.url), "utf8"));
const TRAIN = [2003, 2015];
const TEST = [2016, 2100];
const COMPONENTS = ["pass", "rush"] as const;
type Comp = (typeof COMPONENTS)[number];

interface CompObs { off: string; def: string; n: number; y: number; week: number; season: number }

/** Opponent-adjusted per-play EPA: y = mu + off[offense] + def[defense], weighted by plays and recency. */
function fitComp(obs: CompObs[], week: number, season: number, halfLife: number, carry: number, ridge: number) {
  const decay = Math.LN2 / halfLife;
  const idx = new Map<string, number>();
  const used: { o: CompObs; w: number }[] = [];
  for (let i = obs.length - 1; i >= 0; i--) {
    const o = obs[i];
    const w = Math.exp(-decay * (week - o.week)) * carry ** (season - o.season) * o.n;
    if (w < 0.05) {
      if (season - o.season > 3) break;
      continue;
    }
    used.push({ o, w });
    for (const k of [`o:${o.off}`, `d:${o.def}`]) if (!idx.has(k)) idx.set(k, idx.size);
  }
  const n = idx.size + 1; // last unknown: league mean
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (const { o, w } of used) {
    const cols = [idx.get(`o:${o.off}`)!, idx.get(`d:${o.def}`)!, n - 1];
    for (const i of cols) {
      b[i] += w * o.y;
      for (const j of cols) A[i * n + j] += w;
    }
  }
  for (let i = 0; i < n - 1; i++) A[i * n + i] += ridge;
  A[(n - 1) * n + n - 1] += 1e-6;
  const x = n > 1 ? solveSpd(A, b, n) : new Float64Array(1);
  const get = (k: string) => (idx.has(k) ? x[idx.get(k)!] : 0);
  return { off: (t: string) => get(`o:${t}`), def: (t: string) => get(`d:${t}`) };
}

/** Least squares with a tiny ridge; returns coefficients. */
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

// Market model predictions (with its QB adjustment) for the comparison, and the QB adjustment itself.
const run = runModels(games, DEFAULT_SETTINGS);
const pred = new Map(run.predictions.map((p) => [p.game.id, p]));

interface Row { g: Game; x: Record<string, number>; market: number; pbp: number; qbAdj: number; margin: number; line: number }

function walk(halfLife: number, carry: number, ridge: number): Row[] {
  const obs: Record<Comp, CompObs[]> = { pass: [], rush: [] };
  const rows: Row[] = [];
  const weeks: Game[][] = [];
  let last = -1;
  for (const g of games) {
    const key = g.season * 100 + g.week;
    if (key !== last) (weeks.push([]), (last = key));
    weeks[weeks.length - 1].push(g);
  }
  weeks.forEach((week, wi) => {
    const season = week[0].season;
    if (season >= TRAIN[0]) {
      const fits = Object.fromEntries(COMPONENTS.map((c) => [c, fitComp(obs[c], wi, season, halfLife, carry, ridge)])) as Record<Comp, ReturnType<typeof fitComp>>;
      for (const g of week) {
        if (!isFinal(g) || g.line === null) continue;
        const p = pred.get(g.id)!;
        const h = g.home;
        const a = g.away;
        // Scaled to a game's typical volume so coefficients read as "points per point".
        const scale = { pass: 36, rush: 26 };
        const x: Record<string, number> = { hfa: g.neutral ? 0 : 1 };
        for (const c of COMPONENTS) {
          x[`${c}Off`] = scale[c] * (fits[c].off(h) - fits[c].off(a));
          x[`${c}Def`] = scale[c] * (fits[c].def(a) - fits[c].def(h)); // + = away defense leakier
        }
        rows.push({ g, x, market: p.market.line, pbp: p.pbp.line, qbAdj: p.qbAdj, margin: g.homeScore - g.awayScore, line: g.line });
      }
    }
    for (const g of week) {
      if (!isFinal(g) || !g.pbp) continue;
      for (const [off, def, t] of [[g.home, g.away, g.pbp.home], [g.away, g.home, g.pbp.away]] as const) {
        const rush = t.pl - t.db;
        if (t.db) obs.pass.push({ off, def, n: t.db, y: t.dbEp / t.db, week: wi, season: g.season });
        if (rush) obs.rush.push({ off, def, n: rush, y: (t.ep - t.dbEp) / rush, week: wi, season: g.season });
      }
    }
  });
  return rows;
}

const inRange = (r: Row, [a, b]: number[]) => r.g.season >= a && r.g.season <= b;
const rmse = (rows: Row[], f: (r: Row) => number) => Math.sqrt(rows.reduce((s, r) => s + (f(r) - r.margin) ** 2, 0) / rows.length);
const ats = (rows: Row[], f: (r: Row) => number) => {
  let w = 0, n = 0;
  for (const r of rows) {
    const edge = f(r) - r.line;
    const cover = r.margin - r.line;
    if (!edge || !cover) continue;
    n++;
    if (Math.sign(edge) === Math.sign(cover)) w++;
  }
  return `${((w / n) * 100).toFixed(1)}%`;
};
const FEATS = ["passOff", "passDef", "rushOff", "rushDef"];

// 1. Pick the rating settings on the training years (components-only fit).
let best: { hl: number; carry: number; ridge: number; rmse: number; rows: Row[] } | null = null;
for (const hl of [6, 10, 16])
  for (const carry of [0.5, 0.7])
    for (const ridge of [100, 400]) {
      const rows = walk(hl, carry, ridge);
      const train = rows.filter((r) => inRange(r, TRAIN));
      const cols = ["hfa", ...FEATS];
      const beta = ols(train.map((r) => [...cols.map((c) => r.x[c]), r.qbAdj]), train.map((r) => r.margin));
      const f = (r: Row) => cols.reduce((s, c, i) => s + beta[i] * r.x[c], 0) + beta[cols.length] * r.qbAdj;
      const e = rmse(train, f);
      console.log(`half-life ${hl}, carryover ${carry}, ridge ${ridge}: train rmse ${e.toFixed(3)}`);
      if (!best || e < best.rmse) best = { hl, carry, ridge, rmse: e, rows };
    }
console.log(`\nChosen: half-life ${best!.hl}, carryover ${best!.carry}, ridge ${best!.ridge} plays`);
const rows = best!.rows;
const train = rows.filter((r) => inRange(r, TRAIN));
const test = rows.filter((r) => inRange(r, TEST));

// 2. Candidate predictors, coefficients learned on train only.
type Spec = { name: string; cols: (r: Row) => number[]; base?: (r: Row) => number };
const specs: Spec[] = [
  { name: "components only (+ QB adj)", cols: (r) => [r.x.hfa, ...FEATS.map((c) => r.x[c]), r.qbAdj] },
  { name: "one net-efficiency term (+ QB adj)", cols: (r) => [r.x.hfa, FEATS.reduce((s, c) => s + r.x[c], 0), r.qbAdj] },
  { name: "Market model + components", cols: (r) => [1, r.market, ...FEATS.map((c) => r.x[c])] },
  { name: "closing line + components", cols: (r) => [1, ...FEATS.map((c) => r.x[c])], base: (r) => r.line },
  { name: "closing line + Market model's disagreement", cols: (r) => [1, r.market - r.line], base: (r) => r.line },
];
console.log(`\nHeld out ${TEST[0]}-now (${test.length} games). Margin RMSE, and against-the-spread when betting the model's side:`);
console.log(`  closing line                                rmse ${rmse(test, (r) => r.line).toFixed(3)}`);
console.log(`  Market model (current)                      rmse ${rmse(test, (r) => r.market).toFixed(3)}  ATS ${ats(test, (r) => r.market)}`);
console.log(`  play-by-play model (current)                rmse ${rmse(test, (r) => r.pbp).toFixed(3)}  ATS ${ats(test, (r) => r.pbp)}`);
for (const s of specs) {
  const base = s.base ?? (() => 0);
  const beta = ols(train.map(s.cols), train.map((r) => r.margin - base(r)));
  const f = (r: Row) => base(r) + s.cols(r).reduce((acc, v, i) => acc + beta[i] * v, 0);
  const coef = beta.map((b) => b.toFixed(2)).join(", ");
  console.log(`  ${s.name.padEnd(43)} rmse ${rmse(test, f).toFixed(3)}  ATS ${ats(test, f)}   [coef ${coef}]`);
}

// 3. How stable is each component from one half-season to the next? (Correlation of a team's
// first-8-games raw per-play EPA with its last-8-games, same season.)
const byTeamSeason = new Map<string, { off: Record<Comp, [number, number][]>; def: Record<Comp, [number, number][]> }>();
for (const g of games) {
  if (!isFinal(g) || !g.pbp || g.season < 2003 || g.type !== "REG") continue;
  for (const [team, own, opp] of [[g.home, g.pbp.home, g.pbp.away], [g.away, g.pbp.away, g.pbp.home]] as const) {
    const k = `${team}${g.season}`;
    const e = byTeamSeason.get(k) ?? { off: { pass: [], rush: [] }, def: { pass: [], rush: [] } };
    e.off.pass.push([own.dbEp, own.db]);
    e.off.rush.push([own.ep - own.dbEp, own.pl - own.db]);
    e.def.pass.push([opp.dbEp, opp.db]);
    e.def.rush.push([opp.ep - opp.dbEp, opp.pl - opp.db]);
    byTeamSeason.set(k, e);
  }
}
const corr = (xs: number[], ys: number[]) => {
  const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = m(xs), my = m(ys);
  const c = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  return c / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
};
console.log("\nStability: correlation of a team's per-play EPA in games 1-8 vs games 9-16 of the same season");
for (const side of ["off", "def"] as const)
  for (const c of COMPONENTS) {
    const a: number[] = [], b: number[] = [];
    for (const e of byTeamSeason.values()) {
      const v = e[side][c];
      if (v.length < 16) continue;
      const rate = (s: [number, number][]) => s.reduce((t, [ep]) => t + ep, 0) / s.reduce((t, [, n]) => t + n, 0);
      a.push(rate(v.slice(0, 8)));
      b.push(rate(v.slice(8, 16)));
    }
    console.log(`  ${c} ${side === "off" ? "offense" : "defense"}: ${corr(a, b).toFixed(2)} (${a.length} team-seasons)`);
  }

// 4. Robustness of "closing line + components": coefficient stability, significance, betting.
console.log("\nRobustness of closing line + components:");
const lineCols = (r: Row) => [1, ...FEATS.map((c) => r.x[c])];
const fitResid = (rs: Row[]) => ols(rs.map(lineCols), rs.map((r) => r.margin - r.line));
for (const [a, b] of [[2003, 2009], [2010, 2015], [2003, 2015], [2016, 2100]]) {
  const beta = fitResid(rows.filter((r) => inRange(r, [a, b])));
  console.log(`  coefficients fit on ${a}-${b > 2090 ? "now" : b}: passOff ${beta[1].toFixed(2)}, passDef ${beta[2].toFixed(2)}, rushOff ${beta[3].toFixed(2)}, rushDef ${beta[4].toFixed(2)}`);
}
const beta = fitResid(train);
const adj = (r: Row) => lineCols(r).reduce((s, v, i) => s + beta[i] * v, 0);
// Paired bootstrap of the MSE improvement over the closing line on the held-out games.
const diffs = test.map((r) => (r.line - r.margin) ** 2 - (r.line + adj(r) - r.margin) ** 2);
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const boots: number[] = [];
for (let k = 0; k < 2000; k++) {
  let s = 0;
  for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)];
  boots.push(s / diffs.length);
}
boots.sort((x, y) => x - y);
const meanDiff = diffs.reduce((s, v) => s + v, 0) / diffs.length;
console.log(`  MSE improvement over the closing line: ${meanDiff.toFixed(2)} (95% bootstrap ${boots[50].toFixed(2)} to ${boots[1949].toFixed(2)}); share of resamples below 0: ${(boots.filter((b) => b <= 0).length / boots.length * 100).toFixed(1)}%`);
// Betting only when the adjustment is large.
for (const cut of [0, 0.5, 1, 1.5, 2]) {
  let w = 0, n = 0;
  for (const r of test) {
    const e = adj(r);
    const cover = r.margin - r.line;
    if (Math.abs(e) <= cut || !cover) continue;
    n++;
    if (Math.sign(e) === Math.sign(cover)) w++;
  }
  console.log(`  bet when |adjustment| > ${cut}: ${n ? ((w / n) * 100).toFixed(1) : "-"}% over ${n} bets (2016-now)`);
}
