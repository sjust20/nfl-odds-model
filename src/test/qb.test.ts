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
    expect(s.get("3")!.home).toMatchObject({ name: "Case Keenum", prev: "Caleb Williams", changed: true, source: "listed" });
    expect(s.get("3")!.away).toMatchObject({ name: "Jalen Hurts", prev: null, changed: false });
    expect(s.get("2")!.away!.changed).toBe(false);
  });

  it("skips games without listed starters instead of treating them as changes", () => {
    const s = qbStatus([g("1", "CHI", "MIN", williams, null), g("2", "CHI", "MIN", null, null), g("3", "CHI", "MIN", williams, null)]);
    expect(s.has("2")).toBe(false);
    expect(s.get("3")!.home!.changed).toBe(false);
  });

  it("uses the first-snap starter for played games, correcting a wrong listing", () => {
    const played = (id: string, listed: Qb, starter: [string, string], week: number): Game => ({
      ...g(id, "ATL", "CAR", listed, null),
      week, homeScore: 20, awayScore: 17,
      pbp: {
        home: { pl: 60, ep: 0, sr: 0, db: 35, dbEp: 0, plN: 60, epN: 0, qbs: [[starter[0], starter[1], 35, 0]], st: starter },
        away: { pl: 60, ep: 0, sr: 0, db: 35, dbEp: 0, plN: 60, epN: 0, qbs: [] },
      },
    });
    const tua = { id: "t", name: "Tua Tagovailoa" };
    const rush = { id: "r", name: "Cooper Rush" };
    const penix = { id: "p", name: "Michael Penix Jr." };
    const s = qbStatus([
      played("1", tua, ["t", "T.Tagovailoa"], 1),
      played("2", tua, ["r", "C.Rush"], 2), // listed Tua, but Rush took the first snap
      g("3", "ATL", "CAR", penix, null),
      g("4", "ATL", "CAR", rush, null), // unrelated listing so Rush's full name is known
    ]);
    expect(s.get("2")!.home).toMatchObject({ name: "Cooper Rush", source: "first snap", prev: "Tua Tagovailoa", changed: true });
    expect(s.get("3")!.home).toMatchObject({ name: "Michael Penix Jr.", source: "listed", prev: "Cooper Rush", changed: true });
  });

  it("counts a game as clean only when both starters are known and unchanged", () => {
    const s = qbStatus([g("1", "CHI", "PHI", williams, hurts), g("2", "CHI", "PHI", williams, hurts), g("3", "CHI", "PHI", keenum, hurts)]);
    expect(noQbChange(s.get("1"))).toBe(true); // first sighting isn't a change
    expect(noQbChange(s.get("2"))).toBe(true);
    expect(noQbChange(s.get("3"))).toBe(false);
    expect(noQbChange(undefined)).toBe(false);
  });
});
