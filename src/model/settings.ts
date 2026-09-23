export interface ClassicSettings {
  /** "ema" = the spreadsheet's `Output - EMA` sheet, "sma" = its plain `Output` sheet. */
  variant: "ema" | "sma";
  /** Home-field advantage in points; the spreadsheet splits it half to each side. */
  hfa: number;
  /** Multiplier on the rating gap when both adjusted ratings share a sign (spreadsheet: AVERAGE = 0.5). */
  sameSignFactor: number;
  /** Multiplier on the rating gap when the adjusted ratings have opposite signs (spreadsheet: 0.55). */
  mixedSignFactor: number;
  /** Games of history before the cover EMA switches from a plain average (spreadsheet: 16). */
  coverMinGames: number;
  /** Same threshold for the spread / total / over-under EMAs (spreadsheet: 7). */
  otherMinGames: number;
  /** Longest EMA span in games (spreadsheet: 32). */
  emaCap: number;
  /**
   * Thin-sample fix: blend the rating toward the Market model's view as if it were
   * worth this many games. 0 reproduces the spreadsheet exactly.
   */
  shrinkGames: number;
}

export interface MarketSettings {
  /** Weight of a game halves every this many weeks. */
  halfLifeWeeks: number;
  /** Extra weight multiplier per offseason crossed (rosters turn over). */
  seasonCarryover: number;
  /**
   * 0 = ratings fit closing lines only (pure market view);
   * 1 = ratings fit final margins only (pure results). In between blends the two.
   */
  resultWeight: number;
  /**
   * Soft coach reset: how much of the previous regime's (decayed) evidence carries over
   * to a new head coach. 0 = hard reset to league average; 1 = roughly as if nothing changed.
   * Only applies when `resetOnCoachChange` is on.
   */
  coachCarryover: number;
  /** Pull toward league average, in games-equivalent. Keeps thin ratings sane. */
  ridgeGames: number;
}

export interface Settings {
  /** Start a new history whenever a team's head coach changes (including interims). */
  resetOnCoachChange: boolean;
  classic: ClassicSettings;
  market: MarketSettings;
}

/** Exactly the spreadsheet's formulas. */
export const SPREADSHEET_CLASSIC: ClassicSettings = {
  variant: "ema",
  hfa: 3,
  sameSignFactor: 0.5,
  mixedSignFactor: 0.55,
  coverMinGames: 16,
  otherMinGames: 7,
  emaCap: 32,
  shrinkGames: 0,
};

// Market defaults were picked by `npm run tune` on 2003-2015 (lowest margin RMSE) and
// checked on 2016+. Classic keeps the spreadsheet formulas plus a light thin-sample blend.
export const DEFAULT_SETTINGS: Settings = {
  resetOnCoachChange: true,
  classic: { ...SPREADSHEET_CLASSIC, shrinkGames: 4 },
  market: {
    halfLifeWeeks: 4,
    seasonCarryover: 0.3,
    resultWeight: 0.3,
    coachCarryover: 1,
    ridgeGames: 0.25,
  },
};
