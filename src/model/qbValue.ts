// Starting-QB values from play-by-play, for adjusting a team's rating when its QB changes.
// A QB's value is his recent EPA per dropback (from who actually played), shrunk toward
// replacement level when he has little history. A team's baseline is the value of its recent
// *starters*, because the ratings are mostly built from lines and lines priced the starter, not
// whoever finished the game. The adjustment is (this starter's value - baseline), in points.
import type { TeamPbp } from "../data/pbp";

export const QB_VALUE = {
  /** Dropbacks per game, to turn EPA per dropback into points per game. */
  dropbacksPerGame: 35,
  /** Shrinkage: a QB is treated as having this many extra dropbacks at the prior. */
  priorDropbacks: 250,
  /** The prior for an unproven QB: this far below league-average EPA per dropback. */
  replacementGap: 0.12,
  /** Each game a QB plays shrinks the weight of his older dropbacks by this factor. */
  qbDecay: 0.96,
  /** Each game a team plays shrinks the weight of its older starters by this factor. */
  teamDecay: 0.6,
};

export class QbTracker {
  private qbs = new Map<string, { ep: number; db: number }>();
  private mix = new Map<string, Map<string, number>>(); // team -> starter -> decayed starts
  private league = { ep: 0, db: 0 };

  private leagueRate() {
    return this.league.db ? this.league.ep / this.league.db : 0;
  }

  /** EPA per dropback, shrunk toward replacement level. */
  value(id: string): number {
    const q = this.qbs.get(id);
    const prior = this.leagueRate() - QB_VALUE.replacementGap;
    const k = QB_VALUE.priorDropbacks;
    return q ? (q.ep + k * prior) / (q.db + k) : prior;
  }

  /** Value of the team's recent starters, or null before it has any history. */
  baseline(team: string): number | null {
    const m = this.mix.get(team);
    if (!m || !m.size) return null;
    let w = 0;
    let v = 0;
    for (const [id, db] of m) {
      w += db;
      v += db * this.value(id);
    }
    return w ? v / w : null;
  }

  /** Points per game this starter adds (or costs) vs the team's recent starters. 0 if unknown. */
  adjustment(team: string, starterId: string | undefined | null): number {
    if (!starterId) return 0;
    const base = this.baseline(team);
    if (base === null) return 0;
    return QB_VALUE.dropbacksPerGame * (this.value(starterId) - base);
  }

  /** Folds in one team's game: every QB's dropbacks for values, the starter for the baseline. */
  addGame(team: string, pbp: TeamPbp) {
    const m = this.mix.get(team) ?? new Map<string, number>();
    for (const [id, w] of m) m.set(id, w * QB_VALUE.teamDecay);
    this.mix.set(team, m);
    for (const [id, , db, ep] of pbp.qbs) {
      const q = this.qbs.get(id) ?? { ep: 0, db: 0 };
      q.ep = q.ep * QB_VALUE.qbDecay + ep;
      q.db = q.db * QB_VALUE.qbDecay + db;
      this.qbs.set(id, q);
      this.league.ep += ep;
      this.league.db += db;
    }
    // Starter: first-snap QB when recorded, else the main passer (older aggregates).
    const starter = pbp.st?.[0] ?? pbp.qbs[0]?.[0];
    if (starter) m.set(starter, (m.get(starter) ?? 0) + 1);
  }

  /** Called once a week so the league average tracks the current era. */
  endWeek() {
    this.league.ep *= 0.99;
    this.league.db *= 0.99;
  }
}
