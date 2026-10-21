import { describe, expect, it } from "vitest";
import { killStatus, summarizeMoves } from "../model/killRule";

describe("kill rule", () => {
  it("summarizes line moves", () => {
    const s = summarizeMoves([1, -0.5, 0, 0.5])!;
    expect(s.n).toBe(4);
    expect(s.avg).toBeCloseTo(0.25);
    expect(s.beat).toBe(0.5);
    expect(s.same).toBe(0.25);
    expect(summarizeMoves([])).toBeNull();
  });

  it("stays pending until the season is over, then needs both conditions", () => {
    const good = summarizeMoves([0.5, 0.5, -0.5, 0.5])!; // avg +0.25, 3 toward vs 1 away
    expect(killStatus(good, false)).toBe("pending");
    expect(killStatus(good, true)).toBe("pass");
    expect(killStatus(summarizeMoves([0.1, 0.1, -0.05]), true)).toBe("fail"); // avg under 0.15
    expect(killStatus(summarizeMoves([2, -0.5, -0.5]), true)).toBe("fail"); // moved away more often
    expect(killStatus(null, true)).toBe("fail");
  });
});
