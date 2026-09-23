import { describe, expect, it } from "vitest";
import { ClassicTeam, classicLine, classicTotal } from "../model/classic";
import { SPREADSHEET_CLASSIC } from "../model/settings";
import fixture from "./spreadsheet-fixture.json";

// Expected values are the cached results in "NFL Lines.xlsx" / "NFL Coaching Stats.xlsm"
// (Sep 2025). Fixture rows are each team's games since its hire date, oldest first:
// [cover, over/under, team line (+ = underdog), total line].
const teamFrom = (rows: number[][], variant: "ema" | "sma") => {
  const t = new ClassicTeam({ ...SPREADSHEET_CLASSIC, variant });
  for (const [cover, ou, spread, total] of rows) t.push(cover, ou, spread, total);
  return t.stats(variant)!;
};
const data = fixture as Record<string, number[][]>;

describe("Classic model matches the spreadsheet", () => {
  it("Output sheet (plain averages), Arizona", () => {
    const s = teamFrom(data["Arizona Cardinals"], "sma");
    expect(s.games).toBe(35);
    expect(s.cover).toBeCloseTo(0.8571428571428571, 10);
    expect(s.sdCover).toBeCloseTo(13.52752296435014, 10);
    expect(s.ou).toBeCloseTo(0.2857142857142857, 10);
    expect(s.sdOu).toBeCloseTo(13.175348037845806, 10);
    expect(s.spread).toBeCloseTo(3.6285714285714286, 10);
    expect(s.total).toBeCloseTo(45.34285714285714, 10);
    expect(s.rating).toBeCloseTo(2.7714285714285714, 10);
    expect(s.projTotal).toBeCloseTo(45.628571428571426, 10);
  });

  it("Output - EMA sheet, Arizona", () => {
    const s = teamFrom(data["Arizona Cardinals"], "ema");
    expect(s.cover).toBeCloseTo(1.294315399170771, 10);
    expect(s.ou).toBeCloseTo(-0.5000765228037958, 10);
    expect(s.spread).toBeCloseTo(1.1625822620140798, 10);
    expect(s.total).toBeCloseTo(46.02408903080392, 10);
    expect(s.rating).toBeCloseTo(-0.13173313715669122, 10);
    expect(s.projTotal).toBeCloseTo(45.524012508000126, 10);
  });

  it("Output - EMA sheet, Kansas City (long tenure, capped span)", () => {
    const s = teamFrom(data["Kansas City Chiefs"], "ema");
    expect(s.games).toBe(221);
    expect(s.cover).toBeCloseTo(-0.9293186278540176, 10);
    expect(s.sdCover).toBeCloseTo(11.296929941949116, 10);
    expect(s.ou).toBeCloseTo(-2.0749237786204344, 10);
  });

  it("Sheet3 matchup: Buffalo at Baltimore", () => {
    const line = classicLine(-8.997815642553997, -7.0014259295922034, false, SPREADSHEET_CLASSIC);
    expect(-line).toBeCloseTo(-2.4981948564808967, 10); // sheet shows the home spread
    expect(classicTotal(49.69445567979084, 52.43620623729241)).toBeCloseTo(51.06533095854162, 10);
  });

  it("uses the 0.55 factor when adjusted ratings straddle zero", () => {
    // home -1 - 1.5 = -2.5, away 2 + 1.5 = 3.5 -> (-2.5 - 3.5) * 0.55 = -3.3 -> home favored by 3.3
    expect(classicLine(-1, 2, false, SPREADSHEET_CLASSIC)).toBeCloseTo(3.3, 10);
  });
});
