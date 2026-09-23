// Opponent-adjusted efficiency components: each team's pass offense, pass defense, rush offense
// and rush defense, as expected points added per play, fitted by weighted least squares from
// earlier games only (y = league mean + offense[team] + defense[opponent], weighted by plays and
// recency, pulled toward average by a ridge measured in plays).
import type { Game } from "../data/types";
import { solveSpd } from "./linalg";

export interface ComponentFitSettings {
  /** A game's weight halves every this many weeks. */
  halfLifeWeeks: number;
  /** Extra weight multiplier per offseason crossed. */
  seasonCarryover: number;
  /** Pull toward league average, in plays. */
  ridgePlays: number;
}

/** Home-minus-away component edges for one game, in points (per-play EPA × typical volume). */
export interface ComponentDiffs {
  passOff: number;
  /** Positive when the away pass defense is leakier than the home one. */
  passDef: number;
  rushOff: number;
  rushDef: number;
}

export const COMPONENT_KEYS: (keyof ComponentDiffs)[] = ["passOff", "passDef", "rushOff", "rushDef"];

/** Typical dropbacks and rushes per team-game, so component edges read in points. */
export const COMPONENT_VOLUME = { pass: 36, rush: 26 };

type Kind = "pass" | "rush";
interface Obs {
  off: string;
  def: string;
  plays: number;
  epaPerPlay: number;
  week: number;
  season: number;
}

export interface ComponentFit {
  off: (kind: Kind, team: string) => number;
  def: (kind: Kind, team: string) => number;
}

function fitKind(obs: Obs[], week: number, season: number, s: ComponentFitSettings) {
  const decay = Math.LN2 / s.halfLifeWeeks;
  const idx = new Map<string, number>();
  const used: { o: Obs; w: number }[] = [];
  for (let i = obs.length - 1; i >= 0; i--) {
    const o = obs[i];
    if (o.week >= week) continue;
    const w = Math.exp(-decay * (week - o.week)) * s.seasonCarryover ** (season - o.season) * o.plays;
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
      b[i] += w * o.epaPerPlay;
      for (const j of cols) A[i * n + j] += w;
    }
  }
  for (let i = 0; i < n - 1; i++) A[i * n + i] += s.ridgePlays;
  A[(n - 1) * n + n - 1] += 1e-6;
  const x = solveSpd(A, b, n);
  return (key: string) => (idx.has(key) ? x[idx.get(key)!] : 0);
}

/** Walk-forward store of per-game observations, fitted on demand. */
export class ComponentRatings {
  private obs: Record<Kind, Obs[]> = { pass: [], rush: [] };

  addGame(g: Game, week: number) {
    if (!g.pbp) return;
    for (const [off, def, t] of [
      [g.home, g.away, g.pbp.home],
      [g.away, g.home, g.pbp.away],
    ] as const) {
      const rush = t.pl - t.db;
      if (t.db) this.obs.pass.push({ off, def, plays: t.db, epaPerPlay: t.dbEp / t.db, week, season: g.season });
      if (rush) this.obs.rush.push({ off, def, plays: rush, epaPerPlay: (t.ep - t.dbEp) / rush, week, season: g.season });
    }
  }

  /** Ratings as of `week`, from earlier games only. */
  fit(week: number, season: number, s: ComponentFitSettings): ComponentFit {
    const pass = fitKind(this.obs.pass, week, season, s);
    const rush = fitKind(this.obs.rush, week, season, s);
    const get = (kind: Kind) => (kind === "pass" ? pass : rush);
    return { off: (kind, team) => get(kind)(`o:${team}`), def: (kind, team) => get(kind)(`d:${team}`) };
  }
}

export function componentDiffs(f: ComponentFit, home: string, away: string): ComponentDiffs {
  const v = COMPONENT_VOLUME;
  return {
    passOff: v.pass * (f.off("pass", home) - f.off("pass", away)),
    passDef: v.pass * (f.def("pass", away) - f.def("pass", home)),
    rushOff: v.rush * (f.off("rush", home) - f.off("rush", away)),
    rushDef: v.rush * (f.def("rush", away) - f.def("rush", home)),
  };
}

/** One team's contribution to each component edge (so a game's diff = home terms - away terms). */
export function componentTerms(f: ComponentFit, team: string): ComponentDiffs {
  const v = COMPONENT_VOLUME;
  return {
    passOff: v.pass * f.off("pass", team),
    passDef: -v.pass * f.def("pass", team),
    rushOff: v.rush * f.off("rush", team),
    rushDef: -v.rush * f.def("rush", team),
  };
}

/** Linear combination of component edges with the given weights. */
export const weighted = (d: ComponentDiffs, w: ComponentDiffs) =>
  COMPONENT_KEYS.reduce((s, k) => s + w[k] * d[k], 0);
