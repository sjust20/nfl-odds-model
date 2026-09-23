import { describe, expect, it } from "vitest";
import type { Game } from "../data/types";
import { runModels } from "../model/engine";
import { fitMarket, type Observation } from "../model/market";
import { DEFAULT_SETTINGS, type RatingSettings } from "../model/settings";
import { buildTenures } from "../model/tenure";

const flat: RatingSettings = {
  halfLifeWeeks: 1e9,
  seasonCarryover: 1,
  resultWeight: 0,
  efficiencyWeight: 0,
  efficiency: "all",
  coachCarryover: 0,
  ridgeGames: 1e-6,
  qbScale: 0,
};

const ob = (home: string, away: string, line: number, weekIndex: number): Observation => ({
  home, away, line, weekIndex, neutral: false, total: 44, margin: null, points: null, season: 2020,
  effAll: null, effNeutral: null,
});

describe("market ratings", () => {
  it("recovers ratings and home-field advantage from consistent lines", () => {
    const truth: Record<string, number> = { A: 4, B: 1, C: -2, D: -3 };
    const hfa = 2;
    const teams = Object.keys(truth);
    const obs: Observation[] = [];
    let w = 0;
    for (const h of teams) for (const a of teams) if (h !== a) obs.push(ob(h, a, truth[h] - truth[a] + hfa, w++));
    const fit = fitMarket(obs, w, 2020, flat, () => null, teams);
    expect(fit.hfa).toBeCloseTo(hfa, 4);
    for (const t of teams) expect(fit.rating.get(t)!).toBeCloseTo(truth[t], 4);
  });

  it("a hard reset starts a new coach at league average; a soft one inherits", () => {
    const obs = [ob("A#1", "B#1", 10, 0), ob("B#1", "A#1", -6, 1)];
    const prevOf = (t: string) => (t === "A#2" ? "A#1" : null);
    const hard = fitMarket(obs, 2, 2020, { ...flat, ridgeGames: 1 }, prevOf, ["A#2"]);
    const soft = fitMarket(obs, 2, 2020, { ...flat, ridgeGames: 1, coachCarryover: 5 }, prevOf, ["A#2"]);
    expect(hard.rating.get("A#2")).toBeCloseTo(0, 6);
    // Spring = 5 × A#1's 2 games = 10 vs ridge 1, so the new coach keeps 10/11 of the old rating.
    expect(soft.rating.get("A#2")! / soft.rating.get("A#1")!).toBeCloseTo(10 / 11, 3);
  });
});

describe("tenures", () => {
  const g = (id: string, home: string, homeCoach: string): Game => ({
    id, season: 2020, week: Number(id), type: "REG", date: `2020-09-${id.padStart(2, "0")}`,
    away: "X", home, awayScore: 20, homeScore: 17, line: 3, total: 44, neutral: false,
    awayCoach: "Xc", homeCoach,
  });
  const games = [g("1", "A", "Smith"), g("2", "A", "Jones"), g("3", "A", "Smith")];

  it("starts a new tenure on every change, including a returning coach", () => {
    const t = buildTenures(games, true);
    expect(games.map((x) => t.byGame.get(x.id)![0])).toEqual(["A#1", "A#2", "A#3"]);
    expect(t.tenures.get("A#3")!.prev).toBe("A#2");
  });

  it("keeps one franchise tenure when resets are off", () => {
    const t = buildTenures(games, false);
    expect(new Set(games.map((x) => t.byGame.get(x.id)![0]))).toEqual(new Set(["A#1"]));
  });
});

describe("walk-forward engine", () => {
  it("never lets a game's own result into its prediction", () => {
    const mk = (week: number, homeScore: number): Game => ({
      id: `g${week}`, season: 2020, week, type: "REG", date: `2020-09-${String(week).padStart(2, "0")}`,
      away: "B", home: "A", awayScore: 0, homeScore, line: 3, total: 40, neutral: false,
      awayCoach: "b", homeCoach: "a",
    });
    const base = [mk(1, 10), mk(2, 10), mk(3, 10)];
    const blowout = [mk(1, 10), mk(2, 10), mk(3, 60)];
    const p1 = runModels(base, DEFAULT_SETTINGS).predictions[2];
    const p2 = runModels(blowout, DEFAULT_SETTINGS).predictions[2];
    expect(p2.market.line).toBeCloseTo(p1.market.line, 10);
    expect(p2.pbp.line).toBeCloseTo(p1.pbp.line, 10);
  });
});
