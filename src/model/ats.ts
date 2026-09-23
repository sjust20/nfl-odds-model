// Against-the-spread statistics from the original spreadsheet ("NFL Lines.xlsx", Output and
// Output - EMA sheets), kept for the reliability measure (cover-consistency ranks) and the
// cover/over-under columns. The spreadsheet's rating and matchup formula were retired: its
// rating (average line faced minus average cover) is algebraically minus the average margin.

/** Spreadsheet constants: EMA warm-ups (plain average until this many games) and longest span. */
export const COVER_STATS = { coverMinGames: 16, otherMinGames: 7, emaCap: 32 };

/**
 * The spreadsheet's EMA column, computed oldest -> newest. While fewer than `minGames`
 * older games exist it is the plain average; after that it is an EMA whose span grows
 * with the number of older games, capped at `cap`.
 */
export class SheetEma {
  n = 0;
  private sum = 0;
  value = 0;
  constructor(private minGames: number, private cap: number) {}

  push(x: number) {
    if (this.n === 0) this.value = x;
    else if (this.n < this.minGames) this.value = (this.sum + x) / (this.n + 1);
    else {
      const a = 2 / (Math.min(this.n, this.cap) + 1);
      this.value = x * a + this.value * (1 - a);
    }
    this.sum += x;
    this.n++;
  }
}

export interface AtsStats {
  games: number;
  /** EMA of cover margin (Output - EMA "Average Cover"). */
  cover: number;
  /** EMA of over/under margin. */
  ou: number;
  /** Plain averages (Output sheet). */
  avgCover: number;
  avgOu: number;
  /** Spreadsheet St Dev columns: RMS deviation from the plain average. */
  sdCover: number;
  sdOu: number;
}

/** One team's running cover / over-under record within a tenure. */
export class AtsTeam {
  games = 0;
  private sums = { cover: 0, coverSq: 0, ou: 0, ouSq: 0 };
  private ema = {
    cover: new SheetEma(COVER_STATS.coverMinGames, COVER_STATS.emaCap),
    ou: new SheetEma(COVER_STATS.otherMinGames, COVER_STATS.emaCap),
  };

  /**
   * @param cover margin against the spread (positive = covered)
   * @param ou    combined points minus the total line
   */
  push(cover: number, ou: number) {
    this.games++;
    const s = this.sums;
    s.cover += cover;
    s.coverSq += cover * cover;
    s.ou += ou;
    s.ouSq += ou * ou;
    this.ema.cover.push(cover);
    this.ema.ou.push(ou);
  }

  stats(): AtsStats | null {
    const n = this.games;
    if (n === 0) return null;
    const s = this.sums;
    const avgCover = s.cover / n;
    const avgOu = s.ou / n;
    return {
      games: n,
      cover: this.ema.cover.value,
      ou: this.ema.ou.value,
      avgCover,
      avgOu,
      sdCover: Math.sqrt(Math.max(0, s.coverSq / n - avgCover * avgCover)),
      sdOu: Math.sqrt(Math.max(0, s.ouSq / n - avgOu * avgOu)),
    };
  }
}
