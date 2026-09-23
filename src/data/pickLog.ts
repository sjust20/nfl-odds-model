import type { SidePrediction } from "../model/engine";
import type { GameQbs } from "./qb";

/**
 * A prediction recorded by the nightly job before kickoff, with the line available at that
 * time. These are never recomputed, so they form a true out-of-sample record.
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
  classic: SidePrediction | null;
  reliability: number | null;
  totalReliability: number | null;
  coverRanks: [number, number] | null;
  minGames: number;
  /** Starting QBs as listed when logged, with whether each changed from the team's last game. */
  qb?: GameQbs | null;
}

export interface PickLogFile {
  /** Settings version the picks were made with; bump when defaults change. */
  settingsNote: string;
  picks: LoggedPick[];
}
