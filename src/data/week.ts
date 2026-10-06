import type { Game } from "./types";

/**
 * The NFL week in play: the week of the earliest unplayed game. Unplayed games more than a few
 * days in the past (cancelled or never scored) are skipped so they can't pin the week.
 */
export function currentWeek(games: Game[], today = new Date().toISOString().slice(0, 10)) {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400e3).toISOString().slice(0, 10);
  const unplayed = games.filter((g) => g.homeScore === null);
  const next = unplayed.find((g) => g.date >= cutoff) ?? unplayed[0];
  if (!next) return null;
  return {
    season: next.season,
    week: next.week,
    games: games.filter((g) => g.season === next.season && g.week === next.week),
  };
}

/** UTC offset of US Eastern time at a given instant, in minutes (-240 in summer, -300 in winter). */
function easternOffsetMinutes(ms: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(ms)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name && /GMT([+-])(\d+)(?::(\d+))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : -300;
}

/**
 * Kickoff as epoch milliseconds, from nflverse's US Eastern date and time. Without a time, the
 * start of the game day (Eastern) is used, so an unknown kickoff never counts as still upcoming.
 */
export function kickoffMs(g: Pick<Game, "date" | "time">): number {
  const naive = Date.parse(`${g.date}T${g.time ?? "00:00"}:00Z`);
  return naive - easternOffsetMinutes(naive) * 60e3;
}
