/** Sportsbook numbers for one game, cached daily from The Odds API. */
export interface BookOdds {
  key: string;
  title: string;
  lastUpdate: string;
  /** Points the home team is favored by (same convention as Game.line). */
  line: number | null;
  homePrice: number | null;
  awayPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

export interface GameOdds {
  gameId: string;
  commence: string;
  books: BookOdds[];
  /** Median across books. */
  line: number | null;
  total: number | null;
}

export interface OddsFile {
  fetchedAt: string;
  /** Credits left this month after the pull, from the x-requests-remaining header. */
  remaining: number | null;
  games: GameOdds[];
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
