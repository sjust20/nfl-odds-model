// Why a game is or isn't a pick under a strategy, for the This week and How it works pages.
// Mirrors betFor (src/model/metrics.ts); a test checks the two always agree.
import { noQbChange } from "../data/qb";
import type { Prediction } from "./engine";
import { betFor, type Bet, type Strategy } from "./metrics";

/** The checks a game must pass, in the order the page reports them. */
export type Check = "history" | "qb" | "reliability" | "line" | "edge";

export type Explanation = { pick: Bet; failed?: undefined } | { pick?: undefined; failed: Check };

export function explainBet(p: Prediction, s: Strategy): Explanation {
  const bet = betFor(p, { ...s, fromSeason: 0, toSeason: 9999 });
  if (bet) return { pick: bet };
  if (p.minGames < s.minGames) return { failed: "history" };
  if (s.skipQbChange && !noQbChange(p.qb)) return { failed: "qb" };
  const rel = s.market === "spread" ? p.reliability : p.totalReliability;
  if (s.maxReliability !== null && (rel === null || rel > s.maxReliability)) return { failed: "reliability" };
  const offered = s.market === "spread" ? p.game.line : p.game.total;
  if (offered === null) return { failed: "line" };
  return { failed: "edge" };
}

/** The checks this strategy actually applies (a check with a no-op setting isn't shown). */
export function activeChecks(s: Strategy): Check[] {
  const out: Check[] = [];
  if (s.minGames > 0) out.push("history");
  if (s.skipQbChange) out.push("qb");
  if (s.maxReliability !== null) out.push("reliability");
  if (s.minEdge > 0) out.push("edge");
  return out;
}

/**
 * For a pick, the worst number that would still be a pick: the line can move this far before the
 * model no longer disagrees by more than the strategy's minimum edge. Returned as points the home
 * team is favored by, snapped to the half-point grid books use.
 */
export function holdsUntil(p: Prediction, s: Strategy, side: "home" | "away"): { worst: number; gone: number } {
  const m = p[s.model].line;
  // Home bet needs line < m - minEdge; away bet needs line > m + minEdge.
  if (side === "home") {
    const limit = m - s.minEdge;
    const worst = Math.ceil(limit * 2 - 1) / 2; // largest half-point strictly below the limit
    return { worst, gone: worst + 0.5 };
  }
  const limit = m + s.minEdge;
  const worst = Math.floor(limit * 2 + 1) / 2; // smallest half-point strictly above the limit
  return { worst, gone: worst - 0.5 };
}
