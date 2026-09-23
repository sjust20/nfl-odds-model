import { describe, expect, it } from "vitest";
import { kickoffUtc } from "../data/kickoff";
import { buildPlan, HISTORY_CALL_COST, parseSnapshot, type ApiEvent } from "../data/oddsHistory";
import type { Game } from "../data/types";

const game = (id: string, date: string, time: string, home = "GB", away = "ATL", week = 1): Game => ({
  id, season: 2024, week, type: "REG", date, time, home, away,
  homeScore: 20, awayScore: 17, line: 3, total: 44, neutral: false, homeCoach: "h", awayCoach: "a",
});

describe("kickoff times", () => {
  it("converts Eastern to UTC across daylight saving", () => {
    expect(kickoffUtc("2024-09-08", "13:00").toISOString()).toBe("2024-09-08T17:00:00.000Z"); // EDT
    expect(kickoffUtc("2024-11-10", "13:00").toISOString()).toBe("2024-11-10T18:00:00.000Z"); // EST
    expect(kickoffUtc("2024-11-03", "13:00").toISOString()).toBe("2024-11-03T18:00:00.000Z"); // DST ended that morning
    expect(kickoffUtc("2024-09-05", "20:20").toISOString()).toBe("2024-09-06T00:20:00.000Z"); // Thursday night
  });
});

describe("download plan", () => {
  const games = [
    game("2024_01_BAL_KC", "2024-09-05", "20:20", "KC", "BAL"),
    game("2024_01_PIT_ATL", "2024-09-08", "13:00", "ATL", "PIT"),
    game("2024_01_ARI_BUF", "2024-09-08", "13:00", "BUF", "ARI"),
    game("2024_01_NYJ_SF", "2024-09-09", "20:15", "SF", "NYJ"),
  ];
  const plan = buildPlan(games, 2024, 2024, new Date("2025-01-01T00:00:00Z"));

  it("opens on the Tuesday before the week's first kickoff, at noon Eastern", () => {
    const open = plan.filter((r) => r.kind === "open");
    expect(open).toHaveLength(1);
    expect(open[0].target).toBe("2024-09-03T16:00:00.000Z");
    expect(open[0].games).toHaveLength(4);
  });

  it("closes once per kickoff time, 5 minutes before it", () => {
    const close = plan.filter((r) => r.kind === "close");
    expect(close.map((r) => [r.target, r.games.length])).toEqual([
      ["2024-09-06T00:15:00.000Z", 1],
      ["2024-09-08T16:55:00.000Z", 2],
      ["2024-09-10T00:10:00.000Z", 1],
    ]);
  });

  it("skips games that haven't kicked off, and costs 20 credits per snapshot", () => {
    expect(buildPlan(games, 2024, 2024, new Date("2024-09-07T00:00:00Z")).filter((r) => r.kind === "close")).toHaveLength(1);
    expect(HISTORY_CALL_COST).toBe(20);
  });
});

describe("snapshot parsing", () => {
  const events: ApiEvent[] = [
    {
      id: "e1",
      commence_time: "2024-09-08T17:00:00Z",
      home_team: "Green Bay Packers",
      away_team: "Atlanta Falcons",
      bookmakers: [
        {
          key: "pinnacle",
          last_update: "2024-09-08T16:50:00Z",
          markets: [
            { key: "spreads", outcomes: [{ name: "Green Bay Packers", price: -110, point: -3.5 }, { name: "Atlanta Falcons", price: -110, point: 3.5 }] },
            { key: "totals", outcomes: [{ name: "Over", price: -105, point: 44.5 }, { name: "Under", price: -115, point: 44.5 }] },
          ],
        },
      ],
    },
    { id: "e2", commence_time: "2024-09-08T17:00:00Z", home_team: "Nowhere Nobodies", away_team: "Atlanta Falcons", bookmakers: [] },
  ];

  it("skips games beyond the line horizon (they stay in the raw snapshot)", () => {
    const far = { ...events[0], id: "far", commence_time: "2024-12-22T21:00:00Z" };
    const { rows, unmatched } = parseSnapshot("2024-09-08T16:55:00Z", [far], []);
    expect(rows).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });

  it("stores spreads as points the home team is favored by, and totals as the total", () => {
    const { rows, unmatched } = parseSnapshot("2024-09-08T16:55:00Z", events, [game("2024_01_ATL_GB", "2024-09-08", "13:00")]);
    const spread = rows.find((r) => r.market === "spreads")!;
    expect(spread).toMatchObject({ game_id: "2024_01_ATL_GB", home: "GB", away: "ATL", line: 3.5, home_price: -110 });
    expect(rows.find((r) => r.market === "totals")).toMatchObject({ line: 44.5, over_price: -105, under_price: -115 });
    expect(unmatched).toHaveLength(1);
  });
});
