import { describe, expect, it } from "vitest";
import type { Prediction } from "../model/engine";
import { activeChecks, explainBet, holdsUntil } from "../model/explain";
import { betFor, type Strategy } from "../model/metrics";

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const preds: Prediction[] = Array.from({ length: 600 }, (_, i) => {
  const line = i % 17 === 0 ? null : Math.round((rand() * 20 - 10) * 2) / 2;
  const hr = 1 + Math.floor(rand() * 32);
  const ar = 1 + Math.floor(rand() * 32);
  return {
    game: {
      id: `g${i}`, season: 2026, week: 3, type: "REG", date: "2026-09-27", away: "A", home: "H",
      awayScore: null, homeScore: null, line, total: 44, neutral: false, awayCoach: "a", homeCoach: "h",
    },
    market: { line: (line ?? 0) + (rand() * 8 - 4), total: 44 },
    pbp: { line: (line ?? 0) + (rand() * 8 - 4), total: 44 },
    components: { passOff: 0, passDef: 0, rushOff: 0, rushDef: 0 },
    qbAdj: 0,
    reliability: i % 13 === 0 ? null : hr + ar,
    totalReliability: 30,
    coverRanks: [hr, ar],
    minGames: Math.floor(rand() * 20),
    qb: i % 23 === 0 ? null : {
      home: { id: "h", name: "H", source: "listed", prev: "H", changed: i % 7 === 0 },
      away: { id: "a", name: "A", source: "listed", prev: "A", changed: false },
    },
  };
});
const rule: Strategy = {
  pick: "model", model: "market", market: "spread", minEdge: 0, maxReliability: 24, minGames: 8,
  skipQbChange: true, fromSeason: 2002, toSeason: 2100,
};

describe("explainBet", () => {
  for (const s of [rule, { ...rule, minEdge: 2 }, { ...rule, maxReliability: null, skipQbChange: false, minGames: 0 }] as Strategy[]) {
    it(`agrees with betFor on every game (minEdge ${s.minEdge}, reliability ${s.maxReliability})`, () => {
      for (const p of preds) {
        const e = explainBet(p, s);
        expect(!!e.pick).toBe(!!betFor(p, { ...s, fromSeason: 0, toSeason: 9999 }));
      }
    });
  }

  it("reports the first failing check in page order", () => {
    const p = preds.find((x) => x.minGames < 8 && x.qb && x.qb.home?.changed)!;
    expect(explainBet(p, rule).failed).toBe("history");
  });

  it("lists only the checks a strategy applies", () => {
    expect(activeChecks(rule)).toEqual(["history", "qb", "reliability"]);
    expect(activeChecks({ ...rule, minEdge: 1, maxReliability: null })).toEqual(["history", "qb", "edge"]);
  });
});

describe("holdsUntil", () => {
  const p = (model: number): Prediction => ({ ...preds[1], market: { line: model, total: 44 } });
  it("home bet: the pick survives while the line stays below the model", () => {
    // Model has home favored by 0.5 (NE -0.5 in the design's example, NE at home).
    expect(holdsUntil(p(0.5), rule, "home")).toEqual({ worst: 0, gone: 0.5 });
    expect(holdsUntil(p(3), rule, "home")).toEqual({ worst: 2.5, gone: 3 });
  });
  it("away bet: the pick survives while the line stays above the model", () => {
    expect(holdsUntil(p(-0.46), rule, "away")).toEqual({ worst: 0, gone: -0.5 });
    expect(holdsUntil(p(-3), { ...rule, minEdge: 1 }, "away")).toEqual({ worst: -1.5, gone: -2 });
  });
});
