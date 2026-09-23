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
}

export interface GamesFile {
  updatedAt: string;
  source: string;
  games: Game[];
}

export const isFinal = (g: Game): g is Game & { awayScore: number; homeScore: number } =>
  g.awayScore !== null && g.homeScore !== null;
