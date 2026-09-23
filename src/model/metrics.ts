import { noQbChange } from "../data/qb";
import { isFinal } from "../data/types";
import type { Prediction } from "./engine";

export type ModelName = "market" | "pbp";
export type BetMarket = "spread" | "total";

export interface Strategy {
  /**
   * "model": bet the side the model prefers vs the line.
   * "highVariance" / "lowVariance": sides only - bet the more (or less) volatile team by
   * cover-consistency rank, ignoring the model; `minEdge` then means the minimum rank gap.
   */
  pick: "model" | "highVariance" | "lowVariance";
  model: ModelName;
  market: BetMarket;
  /** Only bet when |model - line| exceeds this many points. */
  minEdge: number;
  /** Only bet when the reliability rank sum is at most this (null = ignore reliability). */
  maxReliability: number | null;
  /** Both teams need at least this many games in their current tenure. */
  minGames: number;
  /**
   * Skip games where either team's starting QB differs from its previous game (or isn't listed).
   * The models can't see QB changes, so their opinion on those games is uninformed.
   */
  skipQbChange?: boolean;
  /** Whether this rule makes picks on the This week page (its backtest is shown either way). */
  enabled?: boolean;
  fromSeason: number;
  toSeason: number;
}

export interface BetRecord {
  wins: number;
  losses: number;
  pushes: number;
  /** Win rate excluding pushes. */
  pct: number;
  /** 95% Wilson interval for the win rate. */
  lo: number;
  hi: number;
  /** Profit in units risking 1.1 to win 1 (standard -110). */
  units: number;
}

/** Break-even win rate at -110. */
export const BREAK_EVEN = 110 / 210;

export function record(wins: number, losses: number, pushes = 0): BetRecord {
  const n = wins + losses;
  const p = n ? wins / n : 0;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = n ? (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom : 0;
  return {
    wins,
    losses,
    pushes,
    pct: p,
    lo: n ? center - half : 0,
    hi: n ? center + half : 0,
    units: wins - losses * 1.1,
  };
}

export interface Bet {
  prediction: Prediction;
  /** Model number minus market number (spread: home favored by; total: points). */
  edge: number;
  /** "home"/"away" for spreads, "over"/"under" for totals. */
  side: "home" | "away" | "over" | "under";
  /** 1 win, 0 loss, 0.5 push, null if the game is not final. */
  result: 1 | 0 | 0.5 | null;
}

/** The bet a strategy would make on a game, or null if it passes. */
export function betFor(p: Prediction, s: Strategy): Bet | null {
  const g = p.game;
  const m = p[s.model];
  if (!m) return null;
  if (g.season < s.fromSeason || g.season > s.toSeason) return null;
  if (p.minGames < s.minGames) return null;
  if (s.skipQbChange && !noQbChange(p.qb)) return null;
  const rel = s.market === "spread" ? p.reliability : p.totalReliability;
  if (s.maxReliability !== null && (rel === null || rel > s.maxReliability)) return null;

  const offered = s.market === "spread" ? g.line : g.total;
  if (offered === null) return null;
  let edge = (s.market === "spread" ? m.line : m.total) - offered;
  if (s.pick !== "model") {
    if (s.market !== "spread" || !p.coverRanks) return null;
    const [hr, ar] = p.coverRanks;
    if (Math.abs(hr - ar) < Math.max(1, s.minEdge)) return null;
    const homeIsVolatile = hr > ar;
    // Positive edge = bet home.
    edge = homeIsVolatile === (s.pick === "highVariance") ? 1 : -1;
  } else if (Math.abs(edge) <= s.minEdge || edge === 0) {
    return null;
  }

  let result: Bet["result"] = null;
  if (isFinal(g)) {
    const margin =
      s.market === "spread" ? g.homeScore - g.awayScore - offered : g.homeScore + g.awayScore - offered;
    result = margin === 0 ? 0.5 : Math.sign(margin) === Math.sign(edge) ? 1 : 0;
  }
  const side =
    s.market === "spread" ? (edge > 0 ? "home" : "away") : edge > 0 ? "over" : "under";
  return { prediction: p, edge, side, result };
}

export function evaluate(preds: Prediction[], s: Strategy) {
  const bets: Bet[] = [];
  const seasons = new Map<number, [number, number, number]>();
  for (const p of preds) {
    const b = betFor(p, s);
    if (!b || b.result === null) continue;
    bets.push(b);
    const row = seasons.get(p.game.season) ?? [0, 0, 0];
    row[b.result === 1 ? 0 : b.result === 0 ? 1 : 2]++;
    seasons.set(p.game.season, row);
  }
  const total = [...seasons.values()].reduce(
    (acc, r) => [acc[0] + r[0], acc[1] + r[1], acc[2] + r[2]],
    [0, 0, 0],
  );
  return {
    overall: record(total[0], total[1], total[2]),
    bySeason: [...seasons].sort((a, b) => a[0] - b[0]).map(([season, r]) => ({ season, ...record(r[0], r[1], r[2]) })),
    bets,
  };
}

/** Prediction error vs actual outcomes, for the model and for the closing number. */
export function accuracy(preds: Prediction[], model: ModelName, market: BetMarket, from: number, to: number) {
  let n = 0;
  let seModel = 0;
  let seLine = 0;
  for (const p of preds) {
    const g = p.game;
    if (!isFinal(g) || g.season < from || g.season > to) continue;
    const m = p[model];
    const offered = market === "spread" ? g.line : g.total;
    if (!m || offered === null) continue;
    const actual = market === "spread" ? g.homeScore - g.awayScore : g.homeScore + g.awayScore;
    const pred = market === "spread" ? m.line : m.total;
    seModel += (pred - actual) ** 2;
    seLine += (offered - actual) ** 2;
    n++;
  }
  return { n, rmseModel: Math.sqrt(seModel / n), rmseLine: Math.sqrt(seLine / n) };
}

export interface GridCell {
  minEdge: number;
  maxReliability: number | null;
  record: BetRecord;
}

/** Every edge × reliability combination for a strategy, holding its other filters fixed. */
export function strategyGrid(
  preds: Prediction[],
  base: Strategy,
  edges: number[],
  reliabilities: (number | null)[],
): GridCell[] {
  // One pass: find every bet with the loosest thresholds, then bucket by edge and reliability.
  const loose: Strategy = { ...base, minEdge: 0, maxReliability: null };
  const graded: { size: number; rel: number | null; result: 1 | 0 | 0.5 }[] = [];
  for (const p of preds) {
    const b = betFor(p, loose);
    if (!b || b.result === null) continue;
    const rel = base.market === "spread" ? p.reliability : p.totalReliability;
    // Model mode: size is |edge| (strictly greater than threshold). Variance mode: the rank gap (at least).
    const size = base.pick === "model" ? Math.abs(b.edge) : Math.abs(p.coverRanks![0] - p.coverRanks![1]);
    graded.push({ size, rel, result: b.result });
  }
  const cells: GridCell[] = [];
  for (const minEdge of edges) {
    for (const maxReliability of reliabilities) {
      let w = 0;
      let l = 0;
      let push = 0;
      for (const g of graded) {
        if (base.pick === "model" ? g.size <= minEdge : g.size < Math.max(1, minEdge)) continue;
        if (maxReliability !== null && (g.rel === null || g.rel > maxReliability)) continue;
        if (g.result === 1) w++;
        else if (g.result === 0) l++;
        else push++;
      }
      cells.push({ minEdge, maxReliability, record: record(w, l, push) });
    }
  }
  return cells;
}
