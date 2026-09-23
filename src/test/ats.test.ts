import { describe, expect, it } from "vitest";
import { AtsTeam } from "../model/ats";
import fixture from "./spreadsheet-fixture.json";

// Expected values are the cached results in "NFL Lines.xlsx" (Sep 2025). Fixture rows are each
// team's games since its hire date, oldest first: [cover, over/under, team line, total line].
const statsFor = (rows: number[][]) => {
  const t = new AtsTeam();
  for (const [cover, ou] of rows) t.push(cover, ou);
  return t.stats()!;
};
const data = fixture as Record<string, number[][]>;

describe("cover stats match the spreadsheet", () => {
  it("Output sheet (plain averages and St Dev), Arizona", () => {
    const s = statsFor(data["Arizona Cardinals"]);
    expect(s.games).toBe(35);
    expect(s.avgCover).toBeCloseTo(0.8571428571428571, 10);
    expect(s.sdCover).toBeCloseTo(13.52752296435014, 10);
    expect(s.avgOu).toBeCloseTo(0.2857142857142857, 10);
    expect(s.sdOu).toBeCloseTo(13.175348037845806, 10);
  });

  it("Output - EMA sheet, Arizona", () => {
    const s = statsFor(data["Arizona Cardinals"]);
    expect(s.cover).toBeCloseTo(1.294315399170771, 10);
    expect(s.ou).toBeCloseTo(-0.5000765228037958, 10);
  });

  it("Output - EMA sheet, Kansas City (long tenure, capped span)", () => {
    const s = statsFor(data["Kansas City Chiefs"]);
    expect(s.games).toBe(221);
    expect(s.cover).toBeCloseTo(-0.9293186278540176, 10);
    expect(s.sdCover).toBeCloseTo(11.296929941949116, 10);
    expect(s.ou).toBeCloseTo(-2.0749237786204344, 10);
  });

  it("the retired Classic rating was minus the average margin (the line cancels)", () => {
    // rating = avg(team line) - avg(cover) and cover = margin + team line.
    const rows = data["Kansas City Chiefs"];
    const avg = (f: (r: number[]) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    const rating = avg((r) => r[2]) - avg((r) => r[0]);
    const margin = avg((r) => r[0] - r[2]);
    expect(rating).toBeCloseTo(-margin, 10);
  });
});
