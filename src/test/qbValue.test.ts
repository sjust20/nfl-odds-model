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
