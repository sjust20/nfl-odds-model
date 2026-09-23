// Market-implied power ratings: weighted least squares over recent closing lines
// (optionally blended with actual results), one rating per coaching tenure.
import { solveSpd } from "./linalg";
import type { MarketSettings } from "./settings";

export interface Observation {
  home: string; // tenure id
  away: string;
  neutral: boolean;
  line: number;
  total: number | null;
  margin: number | null; // home - away, null if not final
  points: number | null;
  /** Index of the game's week in the global chronological week list. */
  weekIndex: number;
  season: number;
}

export interface MarketFit {
  /** tenure id -> points better than a league-average team on a neutral field. */
  rating: Map<string, number>;
  /** tenure id -> points this team adds to a game total vs league average. */
  totalRating: Map<string, number>;
  hfa: number;
  baseTotal: number;
  /** tenure id -> effective number of games behind the rating (sum of weights). */
  weight: Map<string, number>;
}

const MIN_WEIGHT = 1e-3;

/**
 * Fits ratings as of `weekIndex` in `season` using observations strictly before it.
 * `prevOf` links a tenure to the same team's previous regime for the soft coach reset.
 * `required` tenures are always given a rating (e.g. teams playing this week).
 */
export function fitMarket(
  obs: Observation[],
  weekIndex: number,
  season: number,
  s: MarketSettings,
  prevOf: (tenure: string) => string | null,
  required: Iterable<string>,
): MarketFit {
  const decay = Math.LN2 / s.halfLifeWeeks;
  const used: { o: Observation; w: number }[] = [];
  for (let i = obs.length - 1; i >= 0; i--) {
    const o = obs[i];
    if (o.weekIndex >= weekIndex) continue;
    const w =
      Math.exp(-decay * (weekIndex - o.weekIndex)) * s.seasonCarryover ** (season - o.season);
    if (w < MIN_WEIGHT) {
      if (season - o.season > 3) break; // observations are chronological; nothing older matters
      continue;
    }
    used.push({ o, w });
  }

  // Index every tenure involved, plus the predecessors they link to.
  const index = new Map<string, number>();
  const add = (t: string) => {
    if (!index.has(t)) index.set(t, index.size);
  };
  for (const { o } of used) {
    add(o.home);
    add(o.away);
  }
  for (const t of required) add(t);
  for (const t of [...index.keys()]) {
    const p = prevOf(t);
    if (p && s.coachCarryover > 0) add(p);
  }

  const n = index.size;
  const size = n + 1; // last unknown: home-field advantage (spread) / base total (totals)
  const A = new Float64Array(size * size);
  const bSpread = new Float64Array(size);
  const T = new Float64Array(size * size);
  const bTotal = new Float64Array(size);
  const weight = new Map<string, number>();
  const rw = s.resultWeight;

  for (const { o, w } of used) {
    const h = index.get(o.home)!;
    const a = index.get(o.away)!;
    const x = o.neutral ? 0 : 1;
    const y = o.margin === null ? o.line : o.line + rw * (o.margin - o.line);
    // Spread row: r_h - r_a + hfa*x = y
    A[h * size + h] += w;
    A[a * size + a] += w;
    A[h * size + a] -= w;
    A[a * size + h] -= w;
    A[h * size + n] += w * x;
    A[n * size + h] += w * x;
    A[a * size + n] -= w * x;
    A[n * size + a] -= w * x;
    A[n * size + n] += w * x * x;
    bSpread[h] += w * y;
    bSpread[a] -= w * y;
    bSpread[n] += w * x * y;
    // Total row: t_h + t_a + base = y
    if (o.total !== null) {
      const yt = o.points === null ? o.total : o.total + rw * (o.points - o.total);
      T[h * size + h] += w;
      T[a * size + a] += w;
      T[h * size + a] += w;
      T[a * size + h] += w;
      T[h * size + n] += w;
      T[n * size + h] += w;
      T[a * size + n] += w;
      T[n * size + a] += w;
      T[n * size + n] += w;
      bTotal[h] += w * yt;
      bTotal[a] += w * yt;
      bTotal[n] += w * yt;
    }
    weight.set(o.home, (weight.get(o.home) ?? 0) + w);
    weight.set(o.away, (weight.get(o.away) ?? 0) + w);
  }

  // Priors: ridge toward league average, and a spring tying each new regime to the last one.
  for (let i = 0; i < n; i++) {
    A[i * size + i] += s.ridgeGames;
    T[i * size + i] += s.ridgeGames;
  }
  // The spring's strength is a share of the previous regime's (decayed) game weight, so it
  // fades at the same rate as the old games do instead of anchoring the new coach forever.
  if (s.coachCarryover > 0) {
    for (const [t, i] of index) {
      const p = prevOf(t);
      const j = p === null ? undefined : index.get(p);
      if (j === undefined) continue;
      const k = s.coachCarryover * (weight.get(p!) ?? 0);
      if (k <= 0) continue;
      for (const M of [A, T]) {
        M[i * size + i] += k;
        M[j * size + j] += k;
        M[i * size + j] -= k;
        M[j * size + i] -= k;
      }
    }
  }
  // Tiny prior on the intercepts so the very first weeks of data still solve.
  A[n * size + n] += 1e-6;
  T[n * size + n] += 1e-6;
  if (T[n * size + n] < 1) {
    T[n * size + n] += 1;
    bTotal[n] += 44;
  }

  const xs = solveSpd(A, bSpread, size);
  const xt = solveSpd(T, bTotal, size);
  const rating = new Map<string, number>();
  const totalRating = new Map<string, number>();
  for (const [t, i] of index) {
    rating.set(t, xs[i]);
    totalRating.set(t, xt[i]);
  }
  return { rating, totalRating, hfa: xs[n], baseTotal: xt[n], weight };
}

export function marketLine(fit: MarketFit, home: string, away: string, neutral: boolean): number {
  return (fit.rating.get(home) ?? 0) - (fit.rating.get(away) ?? 0) + (neutral ? 0 : fit.hfa);
}

export function marketTotal(fit: MarketFit, home: string, away: string): number {
  return fit.baseTotal + (fit.totalRating.get(home) ?? 0) + (fit.totalRating.get(away) ?? 0);
}
