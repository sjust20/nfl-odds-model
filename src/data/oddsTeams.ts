// Matching The Odds API's events (full team names, UTC kickoff) to nflverse games.
import { TEAMS } from "./teams";
import type { Game } from "./types";

const abbrByName = new Map(Object.entries(TEAMS).map(([abbr, t]) => [t.name, abbr]));
// Names The Odds API has used over time that differ from ours.
abbrByName.set("Washington Football Team", "WAS");
abbrByName.set("Washington Redskins", "WAS");
abbrByName.set("Oakland Raiders", "LV");
abbrByName.set("San Diego Chargers", "LAC");
abbrByName.set("St. Louis Rams", "LA");

export const oddsTeamAbbr = (name: string) => abbrByName.get(name);

/**
 * The nflverse game for an Odds API event: same home and away teams, within a day and a half of the
 * listed date (the API uses UTC, so night games fall on the next day).
 */
export function matchGame(games: Game[], homeName: string, awayName: string, commenceTime: string): Game | undefined {
  const home = abbrByName.get(homeName);
  const away = abbrByName.get(awayName);
  if (!home || !away) return undefined;
  const t = Date.parse(commenceTime);
  return games.find(
    (g) => g.home === home && g.away === away && Math.abs(Date.parse(`${g.date}T12:00:00Z`) - t) < 1.5 * 86400e3,
  );
}
