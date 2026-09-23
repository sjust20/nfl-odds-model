/** One team's offense in one game, aggregated from nflverse play-by-play (pass and run plays). */
export interface TeamPbp {
  /** Plays. */
  pl: number;
  /** Total expected points added. */
  ep: number;
  /** Successful plays (EPA > 0). */
  sr: number;
  /** QB dropbacks, and the EPA on them. */
  db: number;
  dbEp: number;
  /** Same as pl/ep but only while the game was competitive (win probability 10-90%). */
  plN: number;
  epN: number;
  /** QBs who dropped back: [gsis id, name, dropbacks, EPA on those dropbacks], most dropbacks first. */
  qbs: [string, string, number, number][];
  /**
   * The starter: the QB on the team's first dropback of the game, [gsis id, name]. This is who the
   * market priced; `qbs` is who actually played (they differ after an in-game injury).
   */
  st?: [string, string];
}

export type GamePbp = Record<string, TeamPbp>; // keyed by team

export interface PbpSeasonFile {
  season: number;
  builtAt: string;
  source: string;
  games: Record<string, GamePbp>; // keyed by nflverse game_id
}
