import { describe, expect, it } from "vitest";
import type { Game } from "../data/types";
import { ComponentRatings, componentDiffs, componentTerms, weighted } from "../model/components";

// Synthetic league: each team's true pass offense / pass defense in EPA per dropback.
const passOff: Record<string, number> = { A: 0.2, B: 0.0, C: -0.1, D: -0.1 };
const passDef: Record<string, number> = { A: -0.1, B: 0.1, C: 0.0, D: 0.0 };
const teams = Object.keys(passOff);

const game = (i: number, home: string, away: string): Game => {
  const side = (off: string, def: string) => {
    const epa = passOff[off] + passDef[def];
    return { pl: 60, ep: 40 * epa, sr: 0, db: 40, dbEp: 40 * epa, plN: 60, epN: 0, qbs: [] };
  };
  return {
    id: `g${i}`, season: 2020, week: 1, type: "REG", date: "2020-09-01", home, away,
    homeScore: 20, awayScore: 17, line: 0, total: 40, neutral: false, homeCoach: "h", awayCoach: "a",
    pbp: { home: side(home, away), away: side(away, home) },
  };
};

describe("efficiency components", () => {
  const r = new ComponentRatings();
  let i = 0;
  for (let rep = 0; rep < 5; rep++) for (const h of teams) for (const a of teams) if (h !== a) r.addGame(game(i++, h, a), rep);
  const fit = r.fit(10, 2020, { halfLifeWeeks: 1e9, seasonCarryover: 1, ridgePlays: 1e-3 });

  it("recovers opponent-adjusted pass offense and defense (up to the league mean)", () => {
    const offMean = teams.reduce((s, t) => s + fit.off("pass", t), 0) / teams.length;
    const trueMean = teams.reduce((s, t) => s + passOff[t], 0) / teams.length;
    for (const t of teams) expect(fit.off("pass", t) - offMean).toBeCloseTo(passOff[t] - trueMean, 4);
    expect(fit.def("pass", "B") - fit.def("pass", "A")).toBeCloseTo(0.2, 4);
  });

  it("game edges are home terms minus away terms", () => {
    const w = { passOff: 0.3, passDef: -0.2, rushOff: 0.1, rushDef: 0.4 };
    const d = componentDiffs(fit, "A", "B");
    const byTerms = weighted(componentTerms(fit, "A"), w) - weighted(componentTerms(fit, "B"), w);
    expect(weighted(d, w)).toBeCloseTo(byTerms, 8);
    expect(d.passOff).toBeGreaterThan(0); // A throws better than B
    expect(d.passDef).toBeGreaterThan(0); // B's pass defense is leakier than A's
  });
});
