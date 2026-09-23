// Walk-forward engine: steps through every week in order, predicts that week's games
// using only earlier data, then folds the week's results in. The same pass produces the
// backtest (completed games) and the live predictions (upcoming games).
import { isFinal, type Game } from "../data/types";
import { ClassicTeam, classicLine, classicTotal, type ClassicStats } from "./classic";
import { fitMarket, marketLine, marketTotal, type MarketFit, type Observation } from "./market";
import type { Settings } from "./settings";
import { buildTenures, type TenureIndex } from "./tenure";

export interface SidePrediction {
  line: number;
  total: number;
}

export interface Prediction {
  game: Game;
  market: SidePrediction;
  classic: SidePrediction | null;
  /** Classic cover-consistency rank sum of the two teams (Sheet3 "Reliability - Spread"); lower = steadier. */
  reliability: number | null;
  totalReliability: number | null;
  /** Each team's cover-consistency rank (1 = steadiest), [home, away]. */
  coverRanks: [number, number] | null;
  /** Fewest games either team has in its current tenure. */
  minGames: number;
}

export interface TeamRating {
  team: string;
  tenure: string;
  coach: string;
  since: string;
  games: number;
  market: number; // points better than average, neutral field
  marketTotal: number;
  classic: ClassicStats | null;
  /** Classic rating after the thin-sample blend toward the market view (same scale as ClassicStats.rating). */
  classicBlended: number | null;
  coverRank: number | null;
  ouRank: number | null;
}

export interface WeekSnapshot {
  season: number;
  week: number;
  ratings: Map<string, { market: number; classic: number | null }>;
}

export interface ModelRun {
  predictions: Prediction[];
  current: TeamRating[];
  history: WeekSnapshot[];
  tenures: TenureIndex;
  hfa: number;
}

const weekKey = (g: Game) => g.season * 100 + g.week;

/** Competition rank (1 = smallest value), as Excel RANK.EQ(..., 1). */
function rankAscending(values: Map<string, number>): Map<string, number> {
  const sorted = [...values.values()].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const [k, v] of values) out.set(k, sorted.indexOf(v) + 1);
  return out;
}

export function runModels(games: Game[], settings: Settings): ModelRun {
  const tenures = buildTenures(games, settings.resetOnCoachChange);
  const prevOf = (t: string) => tenures.tenures.get(t)?.prev ?? null;
  const classic = new Map<string, ClassicTeam>();
  const classicOf = (t: string) => {
    let c = classic.get(t);
    if (!c) classic.set(t, (c = new ClassicTeam(settings.classic)));
    return c;
  };
  const cs = settings.classic;

  // Group games into weeks, in order.
  const weeks: Game[][] = [];
  let lastKey = -1;
  for (const g of games) {
    if (weekKey(g) !== lastKey) {
      weeks.push([]);
      lastKey = weekKey(g);
    }
    weeks[weeks.length - 1].push(g);
  }

  const obs: Observation[] = [];
  const predictions: Prediction[] = [];
  const history: WeekSnapshot[] = [];
  let fit: MarketFit | null = null;
  let lastCompleted = -1;

  // Tenure currently active for each team as of the week being processed.
  const active = new Map<string, string>();

  const blended = (tenure: string, f: MarketFit): number | null => {
    const st = classicOf(tenure).stats(cs.variant);
    const marketAsClassic = -(f.rating.get(tenure) ?? 0);
    if (!st) return cs.shrinkGames > 0 ? marketAsClassic : null;
    if (cs.shrinkGames <= 0) return st.rating;
    return (st.games * st.rating + cs.shrinkGames * marketAsClassic) / (st.games + cs.shrinkGames);
  };

  const classicRanks = () => {
    const sd = new Map<string, number>();
    const sdOu = new Map<string, number>();
    for (const t of active.values()) {
      const st = classicOf(t).stats(cs.variant);
      if (st) {
        sd.set(t, st.sdCover);
        sdOu.set(t, st.sdOu);
      }
    }
    return { cover: rankAscending(sd), ou: rankAscending(sdOu) };
  };

  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi];
    const { season } = week[0];
    for (const g of week) {
      const [h, a] = tenures.byGame.get(g.id)!;
      active.set(g.home, h);
      active.set(g.away, a);
    }
    const required = new Set(week.flatMap((g) => tenures.byGame.get(g.id)!));
    fit = fitMarket(obs, wi, season, settings.market, prevOf, required);
    const ranks = classicRanks();

    for (const g of week) {
      const [h, a] = tenures.byGame.get(g.id)!;
      const hc = classicOf(h).stats(cs.variant);
      const ac = classicOf(a).stats(cs.variant);
      const hr = blended(h, fit);
      const ar = blended(a, fit);
      const cTotalH = hc?.projTotal ?? (cs.shrinkGames > 0 ? marketTotal(fit, h, h) / 2 : null);
      const cTotalA = ac?.projTotal ?? (cs.shrinkGames > 0 ? marketTotal(fit, a, a) / 2 : null);
      predictions.push({
        game: g,
        market: { line: marketLine(fit, h, a, g.neutral), total: marketTotal(fit, h, a) },
        classic:
          hr === null || ar === null || cTotalH === null || cTotalA === null
            ? null
            : { line: classicLine(hr, ar, g.neutral, cs), total: classicTotal(cTotalH, cTotalA) },
        reliability:
          ranks.cover.has(h) && ranks.cover.has(a) ? ranks.cover.get(h)! + ranks.cover.get(a)! : null,
        totalReliability:
          ranks.ou.has(h) && ranks.ou.has(a) ? ranks.ou.get(h)! + ranks.ou.get(a)! : null,
        coverRanks: ranks.cover.has(h) && ranks.cover.has(a) ? [ranks.cover.get(h)!, ranks.cover.get(a)!] : null,
        minGames: Math.min(classicOf(h).games, classicOf(a).games),
      });
    }

    // Fold this week in: lines for the market model, final results for Classic.
    let anyFinal = false;
    for (const g of week) {
      if (g.line === null) continue;
      const [h, a] = tenures.byGame.get(g.id)!;
      const final = isFinal(g);
      obs.push({
        home: h,
        away: a,
        neutral: g.neutral,
        line: g.line,
        total: g.total,
        margin: final ? g.homeScore - g.awayScore : null,
        points: final ? g.homeScore + g.awayScore : null,
        weekIndex: wi,
        season,
      });
      if (final && g.total !== null) {
        anyFinal = true;
        const homeCover = g.homeScore - g.line - g.awayScore;
        const ou = g.homeScore + g.awayScore - g.total;
        classicOf(h).push(homeCover, ou, -g.line, g.total);
        classicOf(a).push(-homeCover, ou, g.line, g.total);
      }
    }
    if (anyFinal) {
      lastCompleted = wi;
      const after = fitMarket(obs, wi + 1, season, settings.market, prevOf, active.values());
      const ratings = new Map<string, { market: number; classic: number | null }>();
      for (const [team, t] of active) {
        ratings.set(team, { market: after.rating.get(t) ?? 0, classic: blended(t, after) });
      }
      history.push({ season, week: week[0].week, ratings });
    }
  }

  // Current ratings: everything completed so far, each team under its latest regime.
  const now = lastCompleted + 1;
  const nowSeason = weeks[Math.min(now, weeks.length - 1)][0].season;
  const currentTenures = [...tenures.current.values()];
  const finalFit = fitMarket(obs, now, nowSeason, settings.market, prevOf, currentTenures);
  for (const [team, t] of tenures.current) active.set(team, t);
  const ranks = classicRanks();
  const current: TeamRating[] = [...tenures.current].map(([team, t]) => {
    const info = tenures.tenures.get(t)!;
    const st = classicOf(t).stats(cs.variant);
    return {
      team,
      tenure: t,
      coach: info.coach,
      since: info.firstDate,
      games: classicOf(t).games,
      market: finalFit.rating.get(t) ?? 0,
      marketTotal: finalFit.baseTotal / 2 + (finalFit.totalRating.get(t) ?? 0),
      classic: st,
      classicBlended: blended(t, finalFit),
      coverRank: ranks.cover.get(t) ?? null,
      ouRank: ranks.ou.get(t) ?? null,
    };
  });

  return { predictions, current, history, tenures, hfa: finalFit.hfa };
}
