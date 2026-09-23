// Planning and parsing for the historical odds download (scripts/history/odds-history.ts).
// Pure functions, so they can be tested without the API or the database.
import { kickoffUtc } from "./kickoff";
import { matchGame } from "./oddsTeams";
import type { Game } from "./types";

/** Ten books count as one region, so this set costs the same as one region per market. */
export const HISTORY_BOOKMAKERS = [
  "pinnacle", // sharp benchmark (EU region; from Pinnacle's public site, may lag slightly)
  "draftkings",
  "fanduel",
  "betmgm",
  "williamhill_us", // Caesars
  "fanatics",
  "betrivers",
  "bovada",
  "betonlineag",
  "lowvig",
];
export const HISTORY_MARKETS = ["spreads", "totals"];
/** Historical calls cost 10 per market per bookmaker group of up to 10. */
export const HISTORY_CALL_COST = 10 * HISTORY_MARKETS.length * Math.ceil(HISTORY_BOOKMAKERS.length / 10);
/** Featured markets are available from this date. */
export const HISTORY_START = "2020-06-06T00:00:00Z";

export interface PlanRow {
  target: string; // ISO UTC
  kind: "open" | "close";
  season: number;
  week: number;
  games: string[];
}

/** Minutes before kickoff for the closing snapshot (snapshots are every 5-10 minutes). */
export const CLOSE_LEAD_MINUTES = 5;

/**
 * One opening snapshot per week (16:00 UTC, noon Eastern, on the last Tuesday before the week's
 * first kickoff) and one closing snapshot per kickoff time (5 minutes before it).
 */
export function buildPlan(games: Game[], fromSeason: number, toSeason: number, now = new Date()): PlanRow[] {
  const eligible = games.filter(
    (g) =>
      g.season >= fromSeason &&
      g.season <= toSeason &&
      g.time &&
      kickoffUtc(g.date, g.time).getTime() < now.getTime() &&
      kickoffUtc(g.date, g.time).toISOString() > HISTORY_START,
  );
  const rows = new Map<string, PlanRow>();
  const add = (target: Date, kind: PlanRow["kind"], g: Game) => {
    const key = target.toISOString();
    const row = rows.get(key) ?? { target: key, kind, season: g.season, week: g.week, games: [] };
    if (!row.games.includes(g.id)) row.games.push(g.id);
    rows.set(key, row);
  };

  const weeks = new Map<string, Game[]>();
  for (const g of eligible) {
    const k = `${g.season}-${g.week}`;
    weeks.set(k, [...(weeks.get(k) ?? []), g]);
  }
  for (const week of weeks.values()) {
    const first = week.reduce((a, b) => (kickoffUtc(a.date, a.time!) <= kickoffUtc(b.date, b.time!) ? a : b));
    const firstKick = kickoffUtc(first.date, first.time!);
    // Last Tuesday strictly before the first kickoff, at 16:00 UTC.
    const open = new Date(Date.UTC(firstKick.getUTCFullYear(), firstKick.getUTCMonth(), firstKick.getUTCDate(), 16));
    do open.setUTCDate(open.getUTCDate() - 1);
    while (open.getUTCDay() !== 2 || open >= firstKick);
    for (const g of week) add(open, "open", g);
  }
  for (const g of eligible) add(new Date(kickoffUtc(g.date, g.time!).getTime() - CLOSE_LEAD_MINUTES * 60e3), "close", g);
  return [...rows.values()].sort((a, b) => a.target.localeCompare(b.target));
}

interface ApiOutcome {
  name: string;
  price: number;
  point?: number;
}
export interface ApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: { key: string; last_update: string; markets: { key: string; last_update?: string; outcomes: ApiOutcome[] }[] }[];
}

export interface LineRow {
  snapshot_ts: string;
  event_id: string;
  game_id: string | null;
  commence_time: string;
  home: string;
  away: string;
  bookmaker: string;
  market: "spreads" | "totals";
  last_update: string | null;
  line: number | null;
  home_price: number | null;
  away_price: number | null;
  over_price: number | null;
  under_price: number | null;
}

/**
 * Line rows are kept only for games kicking off within this many days of the snapshot. Books post
 * lines for the whole season in advance (a Tuesday snapshot in September can hold 270+ games);
 * those far-off lines stay in the raw snapshot and can be re-parsed later if needed.
 */
export const LINE_HORIZON_DAYS = 10;

/** Flattens a snapshot's events into one row per game, book and market. */
export function parseSnapshot(snapshotTs: string, events: ApiEvent[], games: Game[]): { rows: LineRow[]; unmatched: string[] } {
  const rows: LineRow[] = [];
  const unmatched: string[] = [];
  const horizon = Date.parse(snapshotTs) + LINE_HORIZON_DAYS * 86400e3;
  for (const ev of events) {
    if (Date.parse(ev.commence_time) > horizon) continue;
    const game = matchGame(games, ev.home_team, ev.away_team, ev.commence_time);
    if (!game) unmatched.push(`${ev.away_team} at ${ev.home_team} (${ev.commence_time})`);
    const base = {
      snapshot_ts: snapshotTs,
      event_id: ev.id,
      game_id: game?.id ?? null,
      commence_time: ev.commence_time,
      home: game?.home ?? ev.home_team,
      away: game?.away ?? ev.away_team,
    };
    for (const b of ev.bookmakers ?? []) {
      for (const m of b.markets ?? []) {
        const updated = m.last_update ?? b.last_update ?? null;
        if (m.key === "spreads") {
          const home = m.outcomes.find((o) => o.name === ev.home_team);
          const away = m.outcomes.find((o) => o.name === ev.away_team);
          rows.push({
            ...base, bookmaker: b.key, market: "spreads", last_update: updated,
            // A home spread of -3.5 means the home team is favored by 3.5.
            line: home?.point !== undefined ? -home.point : away?.point !== undefined ? away.point : null,
            home_price: home?.price ?? null, away_price: away?.price ?? null, over_price: null, under_price: null,
          });
        } else if (m.key === "totals") {
          const over = m.outcomes.find((o) => o.name === "Over");
          const under = m.outcomes.find((o) => o.name === "Under");
          rows.push({
            ...base, bookmaker: b.key, market: "totals", last_update: updated,
            line: over?.point ?? under?.point ?? null,
            home_price: null, away_price: null, over_price: over?.price ?? null, under_price: under?.price ?? null,
          });
        }
      }
    }
  }
  return { rows, unmatched };
}
