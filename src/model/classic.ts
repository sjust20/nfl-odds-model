// Port of the "NFL Lines.xlsx" Output / Output - EMA sheets and the matchup
// formula from "NFL Coaching Stats.xlsm" (Sheet3!N2:P8).
import type { ClassicSettings } from "./settings";

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

/** One team's running totals within a tenure. All values are from that team's perspective. */
export class ClassicTeam {
  games = 0;
  private sums = { cover: 0, coverSq: 0, ou: 0, ouSq: 0, spread: 0, total: 0 };
  private ema: Record<"cover" | "ou" | "spread" | "total", SheetEma>;

  constructor(s: ClassicSettings) {
    this.ema = {
      cover: new SheetEma(s.coverMinGames, s.emaCap),
      ou: new SheetEma(s.otherMinGames, s.emaCap),
      spread: new SheetEma(s.otherMinGames, s.emaCap),
      total: new SheetEma(s.otherMinGames, s.emaCap),
    };
  }

  /**
   * @param cover  margin against the spread (positive = covered)
   * @param ou     combined points minus the total line
   * @param spread the team's line, positive = underdog
   * @param total  the total line
   */
  push(cover: number, ou: number, spread: number, total: number) {
    this.games++;
    const s = this.sums;
    s.cover += cover;
    s.coverSq += cover * cover;
    s.ou += ou;
    s.ouSq += ou * ou;
    s.spread += spread;
    s.total += total;
    this.ema.cover.push(cover);
    this.ema.ou.push(ou);
    this.ema.spread.push(spread);
    this.ema.total.push(total);
  }

  stats(variant: ClassicSettings["variant"]): ClassicStats | null {
    const n = this.games;
    if (n === 0) return null;
    const s = this.sums;
    const avgCover = s.cover / n;
    const avgOu = s.ou / n;
    // Spreadsheet St Dev columns: RMS deviation from the current (plain) average.
    const sdCover = Math.sqrt(Math.max(0, s.coverSq / n - avgCover * avgCover));
    const sdOu = Math.sqrt(Math.max(0, s.ouSq / n - avgOu * avgOu));
    const cover = variant === "ema" ? this.ema.cover.value : avgCover;
    const ou = variant === "ema" ? this.ema.ou.value : avgOu;
    const spread = variant === "ema" ? this.ema.spread.value : s.spread / n;
    const total = variant === "ema" ? this.ema.total.value : s.total / n;
    return {
      games: n,
      cover,
      ou,
      spread,
      total,
      sdCover,
      sdOu,
      rating: spread - cover,
      projTotal: total + ou,
    };
  }
}

export interface ClassicStats {
  games: number;
  /** Average (or EMA) cover margin. */
  cover: number;
  /** Average (or EMA) over/under margin. */
  ou: number;
  /** Average (or EMA) line the team faced, positive = underdog. */
  spread: number;
  /** Average (or EMA) total line. */
  total: number;
  sdCover: number;
  sdOu: number;
  /** "Projected Spread": points the team would be an underdog by vs an average team. Lower is better. */
  rating: number;
  /** "Projected Total". */
  projTotal: number;
}

/**
 * Sheet3!P5: predicted spread from the home side (negative = home favored),
 * returned here as points the home team is favored by, to match `Game.line`.
 */
export function classicLine(
  homeRating: number,
  awayRating: number,
  neutral: boolean,
  s: ClassicSettings,
): number {
  const half = neutral ? 0 : s.hfa / 2;
  const home = homeRating - half;
  const away = awayRating + half;
  const factor = Math.sign(home) === Math.sign(away) ? s.sameSignFactor : s.mixedSignFactor;
  return -(home - away) * factor;
}

/** Sheet3!O6: average of the two projected totals. */
export const classicTotal = (homeProjTotal: number, awayProjTotal: number) =>
  (homeProjTotal + awayProjTotal) / 2;
