// Ideas we track but don't bet: fixed rules (no knobs to tune) so their live record stays honest.
import { weighted, type ComponentDiffs } from "./components";
import type { Prediction } from "./engine";
import { betFor, type Bet, type Strategy } from "./metrics";

/**
 * "Big edge, no QB change": the Market model disagrees with the line by more than 6 points and
 * neither team changed starting QB. Most big edges came from QB changes the model couldn't see;
 * the rest went 64.8% over 54 games in 2002-2026 (before the QB adjustment), found by slicing, so
 * it's watched, not bet.
 */
export const BIG_EDGE_NO_QB: Strategy = {
  pick: "model",
  model: "market",
  market: "spread",
  minEdge: 6,
  maxReliability: null,
  minGames: 0,
  skipQbChange: true,
  fromSeason: 0,
  toSeason: 9999,
};

export const bigEdgeNoQb = (p: Prediction): Bet | null => betFor(p, BIG_EDGE_NO_QB);

/**
 * "Line + components": how far efficiency components say the closing line is off, in points for
 * the home team. Weights learned on 2003-2015 (`npm run tune`). Rush offense got positive weight
 * and pass defense negative weight in every period tested, suggesting the market underweights
 * rushing efficiency and overreacts to pass defense. On 2016 onward it cut margin RMSE vs the
 * closing line from 12.709 to 12.694, not statistically significant (24% of bootstrap resamples
 * showed no gain), so it's watched, not bet.
 */
export const LINE_PLUS_COMPONENTS = {
  intercept: 0.01,
  weights: { passOff: 0.09, passDef: -0.07, rushOff: 0.25, rushDef: 0.17 } as ComponentDiffs,
};

/** Points the components say to move the line toward the home team. */
export const lineAdjustment = (d: ComponentDiffs) => LINE_PLUS_COMPONENTS.intercept + weighted(d, LINE_PLUS_COMPONENTS.weights);

/**
 * The tracked bet: back the side the components favor when they'd move the line by more than a
 * point. The threshold was picked after seeing 2016+ results (52.8% over 388 bets there), so only
 * the live record is a clean test.
 */
export const LINE_PLUS_COMPONENTS_MIN = 1;

export function linePlusComponentsBet(p: Prediction): { side: "home" | "away"; adj: number; result: 1 | 0 | 0.5 | null } | null {
  const g = p.game;
  if (g.line === null || !p.components) return null;
  const adj = lineAdjustment(p.components);
  if (Math.abs(adj) <= LINE_PLUS_COMPONENTS_MIN) return null;
  let result: 1 | 0 | 0.5 | null = null;
  if (g.homeScore !== null && g.awayScore !== null) {
    const cover = g.homeScore - g.awayScore - g.line;
    result = cover === 0 ? 0.5 : Math.sign(cover) === Math.sign(adj) ? 1 : 0;
  }
  return { side: adj > 0 ? "home" : "away", adj, result };
}
