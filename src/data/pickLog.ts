import type { ComponentDiffs } from "../model/components";
import type { SidePrediction } from "../model/engine";
import type { GameQbs } from "./qb";

/**
 * A prediction recorded by the nightly job before kickoff, with the line available at that
 * time. These are never recomputed, so they form a true out-of-sample record. The top-level
 * fields refresh each morning until game day (so QB news is in); `first` is frozen at the first
 * log, usually right after the previous week ends, and is what line-movement tests measure from.
 */
export interface LoggedPick {
  id: string;
  season: number;
  week: number;
  date: string;
  home: string;
  away: string;
  loggedAt: string;
  /** nflverse line when logged (tracks the market; becomes the closing line). */
  line: number;
  total: number | null;
  /** Sportsbook median from The Odds API when logged, if available: the number you could bet. */
  bookLine?: number | null;
  bookTotal?: number | null;
  market: SidePrediction;
  /** Play-by-play model (entries logged before it existed have `classic` instead). */
  pbp?: SidePrediction;
  classic?: SidePrediction | null;
  qbAdj?: number;
  /** Efficiency component edges when logged (absent on entries logged before they existed). */
  components?: ComponentDiffs;
  reliability: number | null;
  totalReliability: number | null;
  coverRanks: [number, number] | null;
  minGames: number;
  /** Starting QBs as listed when logged, with whether each changed from the team's last game. */
  qb?: GameQbs | null;
  /**
   * Everything above as of the first time this game was logged, never updated afterwards.
   * Entries from before Sep 24, 2026 have their first snapshot from when this was added.
   */
  first?: PickSnapshot;
}

export type PickSnapshot = Omit<LoggedPick, "first">;

export interface PickLogFile {
  /** Settings version the picks were made with; bump when defaults change. */
  settingsNote: string;
  picks: LoggedPick[];
}
