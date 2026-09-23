// Ideas we track but don't bet: fixed rules (no knobs to tune) so their live record stays honest.
import type { Prediction } from "./engine";
import { betFor, type Bet, type Strategy } from "./metrics";

/**
 * "Big edge, no QB change": the Market model disagrees with the line by more than 6 points and
 * neither team changed starting QB. Most big edges come from QB changes the model can't see;
 * the rest went 64.8% over 54 games in 2002-2026, found by slicing, so it's watched, not bet.
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
