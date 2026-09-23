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
