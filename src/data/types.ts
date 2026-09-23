import type { CoachCorrection } from "./coaches";

/** A starting quarterback (nflverse lists projected starters for the current week). */
export interface Qb {
  id: string;
  name: string;
}

export type GameType = "REG" | "WC" | "DIV" | "CON" | "SB";

/** One NFL game. `line` is points the home team is favored by (nflverse `spread_line`). */
export interface Game {
  id: string;
  season: number;
  week: number;
  type: GameType;
  date: string; // YYYY-MM-DD
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  line: number | null;
  total: number | null;
  neutral: boolean;
  awayCoach: string;
  homeCoach: string;
  /** Starting QB; null when not yet listed. Absent in files written before QB tracking. */
  awayQb?: Qb | null;
  homeQb?: Qb | null;
}

export interface GamesFile {
  updatedAt: string;
  source: string;
  games: Game[];
  /** Changes made to nflverse's head-coach column (manual overrides and the ESPN check). */
  coachCorrections?: CoachCorrection[];
  /** Outcome of the current-coach check, e.g. "ESPN: 32 teams checked" or why it was skipped. */
  coachCheck?: string;
}

export const isFinal = (g: Game): g is Game & { awayScore: number; homeScore: number } =>
  g.awayScore !== null && g.homeScore !== null;
