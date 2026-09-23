import { describe, expect, it } from "vitest";
import { noQbChange, qbStatus } from "../data/qb";
import type { Game, Qb } from "../data/types";

const g = (id: string, home: string, away: string, homeQb: Qb | null, awayQb: Qb | null): Game => ({
  id, season: 2026, week: Number(id), type: "REG", date: `2026-09-${id.padStart(2, "0")}`,
  home, away, homeScore: null, awayScore: null, line: 3, total: 44, neutral: false,
  homeCoach: "h", awayCoach: "a", homeQb, awayQb,
});
const williams = { id: "w", name: "Caleb Williams" };
const keenum = { id: "k", name: "Case Keenum" };
const hurts = { id: "h", name: "Jalen Hurts" };

describe("QB status", () => {
  it("flags a new starter against the team's previous game, home or away", () => {
    const s = qbStatus([
      g("1", "CHI", "MIN", williams, null),
      g("2", "DET", "CHI", null, williams),
      g("3", "CHI", "PHI", keenum, hurts),
    ]);
    expect(s.get("3")!.home).toEqual({ name: "Case Keenum", prev: "Caleb Williams", changed: true });
    expect(s.get("3")!.away).toEqual({ name: "Jalen Hurts", prev: null, changed: false });
    expect(s.get("2")!.away!.changed).toBe(false);
  });

  it("skips games without listed starters instead of treating them as changes", () => {
    const s = qbStatus([g("1", "CHI", "MIN", williams, null), g("2", "CHI", "MIN", null, null), g("3", "CHI", "MIN", williams, null)]);
    expect(s.has("2")).toBe(false);
    expect(s.get("3")!.home!.changed).toBe(false);
  });

  it("counts a game as clean only when both starters are known and unchanged", () => {
    const s = qbStatus([g("1", "CHI", "PHI", williams, hurts), g("2", "CHI", "PHI", williams, hurts), g("3", "CHI", "PHI", keenum, hurts)]);
    expect(noQbChange(s.get("1"))).toBe(true); // first sighting isn't a change
    expect(noQbChange(s.get("2"))).toBe(true);
    expect(noQbChange(s.get("3"))).toBe(false);
    expect(noQbChange(undefined)).toBe(false);
  });
});
