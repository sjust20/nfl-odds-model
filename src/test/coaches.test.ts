import { describe, expect, it } from "vitest";
import { applyOverrides, reconcileCurrentCoaches, sameCoach } from "../data/coaches";
import type { Game } from "../data/types";
import { currentWeek } from "../data/week";
import { buildTenures } from "../model/tenure";

const game = (id: string, season: number, week: number, date: string, homeCoach: string, final = true): Game => ({
  id, season, week, date, type: "REG", home: "BUF", away: "X", neutral: false,
  homeScore: final ? 20 : null, awayScore: final ? 17 : null, line: 3, total: 44,
  homeCoach, awayCoach: "Other",
});

const buffalo = () => [
  game("a", 2025, 17, "2025-12-28", "Sean McDermott"),
  game("b", 2025, 18, "2026-01-04", "Sean McDermott"),
  game("c", 2026, 1, "2026-09-13", "Sean McDermott"),
  game("d", 2026, 2, "2026-09-20", "Sean McDermott"),
  game("e", 2026, 3, "2026-09-27", "Sean McDermott", false),
];

describe("coach corrections", () => {
  it("fixes a stale offseason carry-forward for the whole current season only", () => {
    const games = buffalo();
    const fixes = reconcileCurrentCoaches(games, 2026, { BUF: "Joe Brady" });
    expect(games.map((g) => g.homeCoach)).toEqual([
      "Sean McDermott", "Sean McDermott", "Joe Brady", "Joe Brady", "Joe Brady",
    ]);
    expect(fixes).toEqual([{ team: "BUF", season: 2026, was: "Sean McDermott", now: "Joe Brady", kind: "espn", games: 3 }]);
    // ...which gives Buffalo its coaching reset at 2026 week 1.
    const t = buildTenures(games, true);
    expect(t.byGame.get("c")![0]).not.toBe(t.byGame.get("b")![0]);
  });

  it("respells a near-identical name everywhere without creating a reset", () => {
    const games = buffalo().map((g) => ({ ...g, homeCoach: "Klint Kubliak" }));
    const fixes = reconcileCurrentCoaches(games, 2026, { BUF: "Klint Kubiak" });
    expect(new Set(games.map((g) => g.homeCoach))).toEqual(new Set(["Klint Kubiak"]));
    expect(fixes[0].kind).toBe("spelling");
    expect(new Set(games.map((g) => buildTenures(games, true).byGame.get(g.id)![0])).size).toBe(1);
  });

  it("after a listed mid-season change, only reassigns the latest run", () => {
    const games = buffalo();
    games[3].homeCoach = "Interim Guy";
    games[4].homeCoach = "Interim Guy";
    reconcileCurrentCoaches(games, 2026, { BUF: "Joe Brady" });
    expect(games.map((g) => g.homeCoach).slice(2)).toEqual(["Sean McDermott", "Joe Brady", "Joe Brady"]);
  });

  it("leaves correct data alone", () => {
    const games = buffalo();
    expect(reconcileCurrentCoaches(games, 2026, { BUF: "Sean McDermott" })).toEqual([]);
  });

  it("manual overrides win over the automatic check", () => {
    const games = buffalo();
    const { corrections, locked } = applyOverrides(games, [
      { team: "BUF", coach: "Someone Else", from: "2026-09-20", to: "2026-09-20" },
    ]);
    expect(corrections[0]).toMatchObject({ kind: "override", games: 1 });
    reconcileCurrentCoaches(games, 2026, { BUF: "Joe Brady" }, locked);
    expect(games.map((g) => g.homeCoach).slice(2)).toEqual(["Joe Brady", "Someone Else", "Joe Brady"]);
  });

  it("matches spelling variants but not different people", () => {
    expect(sameCoach("Klint Kubliak", "Klint Kubiak")).toBe(true);
    expect(sameCoach("Kevin O'Connell", "Kevin OConnell")).toBe(true);
    expect(sameCoach("Sean McDermott", "Joe Brady")).toBe(false);
    expect(sameCoach("Jim Harbaugh", "John Harbaugh")).toBe(false);
  });
});

describe("current week", () => {
  it("is the week of the next unplayed game, ignoring long-stale unplayed ones", () => {
    const games = [
      game("old", 2022, 17, "2023-01-02", "C", false), // e.g. a cancelled game
      ...buffalo(),
      game("next", 2026, 4, "2026-10-01", "C", false),
    ];
    const w = currentWeek(games, "2026-09-23")!;
    expect([w.season, w.week]).toEqual([2026, 3]);
    expect(w.games.map((g) => g.id)).toEqual(["e"]);
  });
});
