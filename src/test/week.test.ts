import { describe, expect, it } from "vitest";
import { kickoffMs } from "../data/week";

describe("kickoffMs", () => {
  it("converts US Eastern kickoffs to UTC across daylight saving time", () => {
    expect(new Date(kickoffMs({ date: "2026-10-04", time: "13:00" })).toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(new Date(kickoffMs({ date: "2026-10-05", time: "20:15" })).toISOString()).toBe("2026-10-06T00:15:00.000Z");
    expect(new Date(kickoffMs({ date: "2026-11-08", time: "13:00" })).toISOString()).toBe("2026-11-08T18:00:00.000Z");
  });

  it("uses the start of the Eastern game day when the time is unknown", () => {
    expect(new Date(kickoffMs({ date: "2026-10-04" })).toISOString()).toBe("2026-10-04T04:00:00.000Z");
  });
});
