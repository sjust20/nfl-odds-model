import type { CoachCorrection } from "./coaches";
import type { TeamPbp } from "./pbp";

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
  /** Kickoff time, US Eastern (HH:MM), as nflverse lists it. */
  time?: string;
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
  /** Play-by-play efficiency for each offense, once the game has been played. */
  pbp?: { home: TeamPbp; away: TeamPbp };
}

export interface GamesFile {
  updatedAt: string;
  source: string;
  games: Game[];
  /** Changes made to nflverse's head-coach column (manual overrides and the ESPN check). */
  coachCorrections?: CoachCorrection[];
  /** Outcome of the current-coach check, e.g. "ESPN: 32 teams checked" or why it was skipped. */
  coachCheck?: string;
  /**
   * This week's projected starters (nflverse) against ESPN's depth-chart QB1, per team. Both can be
   * stale, so a disagreement is a flag to check, not a correction.
   */
  qbCheck?: { checkedAt: string; teams: Record<string, QbCheck> };
}

export interface QbCheck {
  listed: string | null;
  espn: string | null;
  agree: boolean;
}

export const isFinal = (g: Game): g is Game & { awayScore: number; homeScore: number } =>
  g.awayScore !== null && g.homeScore !== null;
