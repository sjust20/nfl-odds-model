// Walk-forward engine: steps through every week in order, predicts that week's games
// using only earlier data, then folds the week's results in. The same pass produces the
// backtest (completed games) and the live predictions (upcoming games).
import { qbStatus, type GameQbs } from "../data/qb";
import { isFinal, type Game } from "../data/types";
import { AtsTeam, type AtsStats } from "./ats";
import { fitMarket, marketLine, marketTotal, type MarketFit, type Observation } from "./market";
import { QbTracker } from "./qbValue";
import type { RatingSettings, Settings } from "./settings";
import { buildTenures, type TenureIndex } from "./tenure";

export type ModelKey = "market" | "pbp";
export const MODELS: ModelKey[] = ["market", "pbp"];

export interface SidePrediction {
  /** Points the home team is favored by, including any QB adjustment. */
  line: number;
  total: number;
}

export interface Prediction {
  game: Game;
  market: SidePrediction;
  pbp: SidePrediction;
  /**
   * Starting-QB adjustment at full scale, in points for the home team (home starter's value vs
   * its recent QB mix, minus the same for the away team). Each model adds qbScale times this.
   */
  qbAdj: number;
  /** Sum of both teams' cover-consistency ranks (Sheet3 "Reliability - Spread"); lower = steadier. */
  reliability: number | null;
  totalReliability: number | null;
  /** Each team's cover-consistency rank (1 = steadiest), [home, away]. */
  coverRanks: [number, number] | null;
  /** Fewest games either team has in its current tenure. */
  minGames: number;
  /** Starting QBs as listed, with whether each changed from the team's previous game. */
  qb: GameQbs | null;
}

export interface TeamRating {
  team: string;
  tenure: string;
  coach: string;
  since: string;
  games: number;
  /** Points better than an average team on a neutral field, with the team's recent QB mix. */
  market: number;
  pbp: number;
  /** Points this team adds to a game total vs league average (half the league base included). */
  marketTotal: number;
  pbpTotal: number;
  ats: AtsStats | null;
  coverRank: number | null;
  ouRank: number | null;
}

export interface WeekSnapshot {
  season: number;
  week: number;
  ratings: Map<string, { market: number; pbp: number }>;
}

export interface ModelRun {
  predictions: Prediction[];
  current: TeamRating[];
  history: WeekSnapshot[];
  tenures: TenureIndex;
  hfa: { market: number; pbp: number };
}

const weekKey = (g: Game) => g.season * 100 + g.week;

/** Competition rank (1 = smallest value), as Excel RANK.EQ(..., 1). */
function rankAscending(values: Map<string, number>): Map<string, number> {
  const sorted = [...values.values()].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const [k, v] of values) out.set(k, sorted.indexOf(v) + 1);
  return out;
}

/** Efficiency margin for the home team: all plays, and competitive plays scaled to all plays. */
function efficiency(g: Game): { all: number; neutral: number } | null {
  const p = g.pbp;
  if (!p) return null;
  const neutral = (t: typeof p.home) => (t.plN ? (t.epN / t.plN) * t.pl : t.ep);
  return { all: p.home.ep - p.away.ep, neutral: neutral(p.home) - neutral(p.away) };
}

export function runModels(games: Game[], settings: Settings): ModelRun {
  const tenures = buildTenures(games, settings.resetOnCoachChange);
  const qbs = qbStatus(games);
  const prevOf = (t: string) => tenures.tenures.get(t)?.prev ?? null;
  const ats = new Map<string, AtsTeam>();
  const atsOf = (t: string) => {
    let c = ats.get(t);
    if (!c) ats.set(t, (c = new AtsTeam()));
    return c;
  };
  const qbTracker = new QbTracker();
  const cfg: Record<ModelKey, RatingSettings> = { market: settings.market, pbp: settings.pbp };

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
  let lastCompleted = -1;

  // Tenure currently active for each team as of the week being processed.
  const active = new Map<string, string>();

  const ranks = () => {
    const sd = new Map<string, number>();
    const sdOu = new Map<string, number>();
    for (const t of active.values()) {
      const st = atsOf(t).stats();
      if (st) {
        sd.set(t, st.sdCover);
        sdOu.set(t, st.sdOu);
      }
    }
    return { cover: rankAscending(sd), ou: rankAscending(sdOu) };
  };

  const fitBoth = (weekIndex: number, season: number, required: Iterable<string>) => {
    const req = [...required];
    return {
      market: fitMarket(obs, weekIndex, season, cfg.market, prevOf, req),
      pbp: fitMarket(obs, weekIndex, season, cfg.pbp, prevOf, req),
    };
  };

  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi];
    const { season } = week[0];
    for (const g of week) {
      const [h, a] = tenures.byGame.get(g.id)!;
      active.set(g.home, h);
      active.set(g.away, a);
    }
    const fits = fitBoth(wi, season, week.flatMap((g) => tenures.byGame.get(g.id)!));
    const r = ranks();

    for (const g of week) {
      const [h, a] = tenures.byGame.get(g.id)!;
      const qbAdj = qbTracker.adjustment(g.home, g.homeQb?.id) - qbTracker.adjustment(g.away, g.awayQb?.id);
      const side = (k: ModelKey): SidePrediction => ({
        line: marketLine(fits[k], h, a, g.neutral) + cfg[k].qbScale * qbAdj,
        total: marketTotal(fits[k], h, a),
      });
      predictions.push({
        game: g,
        market: side("market"),
        pbp: side("pbp"),
        qbAdj,
        reliability: r.cover.has(h) && r.cover.has(a) ? r.cover.get(h)! + r.cover.get(a)! : null,
        totalReliability: r.ou.has(h) && r.ou.has(a) ? r.ou.get(h)! + r.ou.get(a)! : null,
        coverRanks: r.cover.has(h) && r.cover.has(a) ? [r.cover.get(h)!, r.cover.get(a)!] : null,
        minGames: Math.min(atsOf(h).games, atsOf(a).games),
        qb: qbs.get(g.id) ?? null,
      });
    }

    // Fold this week in: lines (and results) for the ratings, results for cover stats and QBs.
    let anyFinal = false;
    for (const g of week) {
      if (g.line === null) continue;
      const [h, a] = tenures.byGame.get(g.id)!;
      const final = isFinal(g);
      const eff = final ? efficiency(g) : null;
      obs.push({
        home: h,
        away: a,
        neutral: g.neutral,
        line: g.line,
        total: g.total,
        margin: final ? g.homeScore - g.awayScore : null,
        points: final ? g.homeScore + g.awayScore : null,
        effAll: eff?.all ?? null,
        effNeutral: eff?.neutral ?? null,
        weekIndex: wi,
        season,
      });
      if (final && g.total !== null) {
        anyFinal = true;
        const homeCover = g.homeScore - g.line - g.awayScore;
        const ou = g.homeScore + g.awayScore - g.total;
        atsOf(h).push(homeCover, ou);
        atsOf(a).push(-homeCover, ou);
      }
      if (final && g.pbp) {
        qbTracker.addGame(g.home, g.pbp.home);
        qbTracker.addGame(g.away, g.pbp.away);
      }
    }
    if (anyFinal) {
      qbTracker.endWeek();
      lastCompleted = wi;
      const after = fitBoth(wi + 1, season, active.values());
      const ratings = new Map<string, { market: number; pbp: number }>();
      for (const [team, t] of active) {
        ratings.set(team, { market: after.market.rating.get(t) ?? 0, pbp: after.pbp.rating.get(t) ?? 0 });
      }
      history.push({ season, week: week[0].week, ratings });
    }
  }

  // Current ratings: everything completed so far, each team under its latest regime.
  const now = lastCompleted + 1;
  const nowSeason = weeks[Math.min(now, weeks.length - 1)][0].season;
  const finalFits = fitBoth(now, nowSeason, tenures.current.values());
  for (const [team, t] of tenures.current) active.set(team, t);
  const r = ranks();
  const teamTotal = (f: MarketFit, t: string) => f.baseTotal / 2 + (f.totalRating.get(t) ?? 0);
  const current: TeamRating[] = [...tenures.current].map(([team, t]) => {
    const info = tenures.tenures.get(t)!;
    return {
      team,
      tenure: t,
      coach: info.coach,
      since: info.firstDate,
      games: atsOf(t).games,
      market: finalFits.market.rating.get(t) ?? 0,
      pbp: finalFits.pbp.rating.get(t) ?? 0,
      marketTotal: teamTotal(finalFits.market, t),
      pbpTotal: teamTotal(finalFits.pbp, t),
      ats: atsOf(t).stats(),
      coverRank: r.cover.get(t) ?? null,
      ouRank: r.ou.get(t) ?? null,
    };
  });

  return {
    predictions,
    current,
    history,
    tenures,
    hfa: { market: finalFits.market.hfa, pbp: finalFits.pbp.hfa },
  };
}
