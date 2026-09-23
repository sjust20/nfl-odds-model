/**
 * Settings for one rating model. Market and play-by-play are the same weighted least-squares fit
 * (src/model/market.ts); they differ in what each game's target blends in besides the line.
 */
export interface RatingSettings {
  /** Weight of a game halves every this many weeks. */
  halfLifeWeeks: number;
  /** Extra weight multiplier per offseason crossed (rosters turn over). */
  seasonCarryover: number;
  /** Share of each game's target taken from the final margin (the rest from the line). */
  resultWeight: number;
  /** Share taken from the play-by-play efficiency margin (net expected points added). */
  efficiencyWeight: number;
  /** Efficiency from every play, or only while the game was competitive (win prob 10-90%). */
  efficiency: "all" | "neutral";
  /**
   * Soft coach reset: how much of the previous regime's (decayed) evidence carries over
   * to a new head coach. 0 = hard reset to league average; 1 = roughly as if nothing changed.
   * Only applies when `resetOnCoachChange` is on.
   */
  coachCarryover: number;
  /** Pull toward league average, in games-equivalent. Keeps thin ratings sane. */
  ridgeGames: number;
  /** Multiplier on the starting-QB adjustment (0 = ignore who starts at QB). */
  qbScale: number;
}

export interface Settings {
  /** Start a new history whenever a team's head coach changes (including interims). */
  resetOnCoachChange: boolean;
  market: RatingSettings;
  pbp: RatingSettings;
}

// Picked by `npm run tune` on 2003-2015 (lowest margin RMSE) and checked on 2016 onward, where
// margin RMSE was: closing line 12.71, Market 12.90, play-by-play 12.91 (13.01 for both without
// the QB adjustment). On games with a QB change: line 13.13, Market 13.44, without QB adj 13.85.
export const DEFAULT_SETTINGS: Settings = {
  resetOnCoachChange: true,
  market: {
    halfLifeWeeks: 4,
    seasonCarryover: 0.3,
    resultWeight: 0.3,
    efficiencyWeight: 0,
    efficiency: "all",
    coachCarryover: 1,
    ridgeGames: 0.25,
    qbScale: 0.75,
  },
  pbp: {
    halfLifeWeeks: 3,
    seasonCarryover: 0.3,
    resultWeight: 0.1,
    efficiencyWeight: 0.15,
    efficiency: "all",
    coachCarryover: 1,
    ridgeGames: 0.25,
    qbScale: 0.75,
  },
};
