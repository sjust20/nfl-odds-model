import { describe, expect, it } from "vitest";
import type { TeamPbp } from "../data/pbp";
import { QB_VALUE, QbTracker } from "../model/qbValue";

const game = (qbs: TeamPbp["qbs"]): TeamPbp => ({ pl: 60, ep: 0, sr: 0, db: 35, dbEp: 0, plN: 60, epN: 0, qbs });

describe("QB values", () => {
  it("prices a backup replacing an established starter as a downgrade", () => {
    const t = new QbTracker();
    // A good starter (+0.2 EPA/dropback) for a season on CHI; league includes an average QB elsewhere.
    for (let i = 0; i < 17; i++) {
      t.addGame("CHI", game([["starter", "Starter", 35, 7]]));
      t.addGame("PHI", game([["avg", "Average", 35, 0]]));
      t.endWeek();
    }
    expect(t.adjustment("CHI", "starter")).toBeCloseTo(0, 6);
    const backup = t.adjustment("CHI", "unknown-backup");
    expect(backup).toBeLessThan(-4);
    expect(backup).toBeGreaterThan(-12);
  });

  it("baselines on who started, not who finished, after an in-game injury", () => {
    const t = new QbTracker();
    const injured = (): TeamPbp => ({ ...game([["backup", "Backup", 30, -3], ["starter", "Starter", 5, 1]]), st: ["starter", "Starter"] });
    for (let i = 0; i < 10; i++) t.addGame("CIN", game([["starter", "Starter", 35, 7]]));
    t.addGame("CIN", injured()); // starter hurt early; backup took most dropbacks
    // The line priced the starter, so the backup starting next week is still a full downgrade.
    expect(t.baseline("CIN")).toBeCloseTo(t.value("starter"), 6);
    expect(t.adjustment("CIN", "backup")).toBeLessThan(-2);
  });

  it("an unknown QB is valued at replacement level, below league average", () => {
    const t = new QbTracker();
    t.addGame("PHI", game([["avg", "Average", 35, 0]]));
    expect(t.value("nobody")).toBeCloseTo(0 - QB_VALUE.replacementGap, 6);
  });

  it("gives no adjustment without a listed starter or team history", () => {
    const t = new QbTracker();
    expect(t.adjustment("CHI", "someone")).toBe(0);
    t.addGame("CHI", game([["a", "A", 35, 5]]));
    expect(t.adjustment("CHI", null)).toBe(0);
  });
});
