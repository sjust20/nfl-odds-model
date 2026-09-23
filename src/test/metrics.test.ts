import { describe, expect, it } from "vitest";
import type { Prediction } from "../model/engine";
import { BREAK_EVEN, betFor, evaluate, record, strategyGrid, type Strategy } from "../model/metrics";

// Deterministic pseudo-random predictions.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const preds: Prediction[] = Array.from({ length: 800 }, (_, i) => {
  const line = Math.round((rand() * 20 - 10) * 2) / 2;
  const total = 40 + Math.round(rand() * 20) / 2;
  const hr = 1 + Math.floor(rand() * 32);
  const ar = 1 + Math.floor(rand() * 32);
  return {
    game: {
      id: `g${i}`, season: 2010 + (i % 10), week: 1, type: "REG", date: "2010-09-10",
      away: "A", home: "H", awayScore: Math.floor(rand() * 35), homeScore: Math.floor(rand() * 35),
      line, total, neutral: false, awayCoach: "a", homeCoach: "h",
    },
    market: { line: line + (rand() * 8 - 4), total: total + (rand() * 8 - 4) },
    pbp: { line: line + (rand() * 8 - 4), total: total + (rand() * 8 - 4) },
    qbAdj: 0,
    components: { passOff: 0, passDef: 0, rushOff: 0, rushDef: 0 },
    reliability: hr + ar,
    totalReliability: 2 + Math.floor(rand() * 63),
    coverRanks: [hr, ar],
    minGames: Math.floor(rand() * 30),
    // Every fifth game has a QB change on one side.
    qb: {
      home: { id: "h", name: "H", source: "first snap", prev: "H0", changed: i % 5 === 0 },
      away: { id: "a", name: "A", source: "first snap", prev: "A", changed: false },
    },
  };
});

const base: Strategy = {
  pick: "model", model: "pbp", market: "spread", minEdge: 0, maxReliability: null,
  minGames: 8, fromSeason: 2011, toSeason: 2017,
};

describe("strategy grid", () => {
  for (const variant of [
    base,
    { ...base, model: "market", market: "total" },
    { ...base, pick: "highVariance" },
    { ...base, pick: "lowVariance" },
    { ...base, model: "market", skipQbChange: true },
  ] as Strategy[]) {
    it(`matches evaluate() cell by cell (${variant.pick} ${variant.model} ${variant.market}${variant.skipQbChange ? " skip-QB" : ""})`, () => {
      const steps = variant.pick === "model" ? [0, 1, 2.5, 4] : [1, 4, 8, 16];
      const cells = strategyGrid(preds, variant, steps, [8, 24, 40, null]);
      for (const c of cells) {
        const slow = evaluate(preds, { ...variant, minEdge: c.minEdge, maxReliability: c.maxReliability }).overall;
        expect(c.record).toEqual(slow);
      }
    });
  }
});

describe("bets", () => {
  it("grades a home-side spread bet", () => {
    const p = preds[0];
    const g = { ...p.game, line: 3, homeScore: 24, awayScore: 20 };
    const bet = betFor({ ...p, game: g, pbp: { line: 5, total: 40 }, minGames: 20 }, { ...base, fromSeason: 0, toSeason: 9999 });
    expect(bet?.side).toBe("home");
    expect(bet?.result).toBe(1); // won by 4, laid 3
  });

  it("skipping QB changes drops exactly those games, and unknown starters too", () => {
    const s = { ...base, fromSeason: 0, toSeason: 9999, minGames: 0 };
    const all = preds.filter((p) => betFor(p, s));
    const kept = preds.filter((p) => betFor(p, { ...s, skipQbChange: true }));
    expect(kept.length).toBe(all.filter((p) => !p.qb!.home!.changed).length);
    expect(kept.every((p) => !p.qb!.home!.changed)).toBe(true);
    expect(betFor({ ...all[0], qb: null }, { ...s, skipQbChange: true })).toBeNull();
  });

  it("high- and low-variance picks take opposite sides", () => {
    const s = { ...base, fromSeason: 0, toSeason: 9999, minGames: 0 };
    for (const p of preds.slice(0, 50)) {
      const hi = betFor(p, { ...s, pick: "highVariance", minEdge: 1 });
      const lo = betFor(p, { ...s, pick: "lowVariance", minEdge: 1 });
      expect(hi === null).toBe(lo === null);
      if (hi && lo) expect(hi.side).not.toBe(lo.side);
    }
  });

  it("break-even is 52.38% at -110 and the interval brackets the rate", () => {
    expect(BREAK_EVEN).toBeCloseTo(0.5238, 4);
    const r = record(540, 460);
    expect(r.lo).toBeLessThan(0.54);
    expect(r.hi).toBeGreaterThan(0.54);
    expect(r.units).toBeCloseTo(540 - 460 * 1.1, 10);
  });
});
