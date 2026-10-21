// The pre-registered stopping rule for the betting idea. Fixed in advance (2026-10-21, with 61
// games in) so the answer can't be tuned after the fact: change it only with a new date and reason.
import type { ModelName } from "./metrics";

export const KILL_RULE = {
  setOn: "2026-10-21",
  /** Play-by-play is the only model with information beyond past lines; Market mostly restates them. */
  model: "pbp" as ModelName,
  season: 2026,
  /** Average points per game the line must move toward the model's side, first log to kickoff. */
  minAvg: 0.15,
};

export interface MoveSummary {
  n: number;
  avg: number;
  /** Share of games the line moved toward the model's side. */
  beat: number;
  /** Share of games it didn't move. */
  same: number;
  /** Standard error of `avg`. */
  se: number;
}

export function summarizeMoves(moves: number[]): MoveSummary | null {
  const n = moves.length;
  if (!n) return null;
  const avg = moves.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(moves.reduce((s, v) => s + (v - avg) ** 2, 0) / (n - 1)) : 0;
  return {
    n,
    avg,
    beat: moves.filter((v) => v > 0).length / n,
    same: moves.filter((v) => v === 0).length / n,
    se: sd / Math.sqrt(n),
  };
}

export type KillStatus = "pending" | "pass" | "fail";

/**
 * Passes only if, once the regular season is over, the line moved toward the model by at least
 * `minAvg` points per game on average AND toward it more often than away from it.
 */
export function killStatus(s: MoveSummary | null, seasonOver: boolean): KillStatus {
  if (!seasonOver) return "pending";
  if (!s) return "fail";
  const against = 1 - s.beat - s.same;
  return s.avg >= KILL_RULE.minAvg && s.beat > against ? "pass" : "fail";
}
