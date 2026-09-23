import type { ComponentDiffs, ComponentFitSettings } from "./components";

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

/**
 * The play-by-play model stacks efficiency components on top of the Market model:
 *   line = intercept + marketWeight × Market line + Σ weights × component edges
 * where each component edge (pass/rush offense/defense) is a home-minus-away difference in
 * opponent-adjusted EPA per play, times typical volume (src/model/components.ts).
 */
export interface PbpSettings extends ComponentFitSettings {
  intercept: number;
  marketWeight: number;
  weights: ComponentDiffs;
}

export interface Settings {
  /** Start a new history whenever a team's head coach changes (including interims). */
  resetOnCoachChange: boolean;
  market: RatingSettings;
  pbp: PbpSettings;
}

// Market: picked by `npm run tune` on 2003-2015 (lowest margin RMSE), checked on 2016 onward.
// Play-by-play: component fit settings chosen on 2003-2015 (scripts/research-components.ts), and
// stacking weights learned by regression on 2003-2015 (`npm run tune` prints them).
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
    halfLifeWeeks: 10,
    seasonCarryover: 0.5,
    ridgePlays: 100,
    intercept: -0.2,
    marketWeight: 1.07,
    weights: { passOff: 0.06, passDef: -0.18, rushOff: 0.23, rushDef: 0.12 },
  },
};
