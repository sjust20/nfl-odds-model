// Pulls current NFL spreads and totals from The Odds API into public/data/odds.json.
// Cost: 2 credits per pull (2 markets × 1 region). To stay within the free tier this reuses
// the copy already deployed at SITE_URL when it is under MAX_AGE_HOURS old, so extra builds are free.
//
// Env: ODDS_API_KEY (skips quietly when unset), SITE_URL (optional, the deployed site root).
// Run after `npm run data`: npm run odds
import { readFile, writeFile } from "node:fs/promises";
import { median, type BookOdds, type GameOdds, type OddsFile } from "../src/data/odds";
import { TEAMS } from "../src/data/teams";
import type { GamesFile } from "../src/data/types";
import { currentWeek } from "../src/data/week";

const OUT = new URL("../public/data/odds.json", import.meta.url);
const GAMES = new URL("../public/data/games.json", import.meta.url);
const MAX_AGE_HOURS = 20;
const API = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/";

interface ApiOutcome {
  name: string;
  price: number;
  point?: number;
}
interface ApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    title: string;
    last_update: string;
    markets: { key: string; outcomes: ApiOutcome[] }[];
  }[];
}

const abbrByName = new Map(Object.entries(TEAMS).map(([abbr, t]) => [t.name, abbr]));
// Names The Odds API has used that differ from ours.
abbrByName.set("Washington Football Team", "WAS");
abbrByName.set("Oakland Raiders", "LV");
abbrByName.set("San Diego Chargers", "LAC");
abbrByName.set("St. Louis Rams", "LA");

async function reuseDeployed(): Promise<boolean> {
  const site = process.env.SITE_URL;
  if (!site) return false;
  try {
    const res = await fetch(new URL("data/odds.json", site.endsWith("/") ? site : `${site}/`));
    if (!res.ok) return false;
    const cached: OddsFile = await res.json();
    const ageHours = (Date.now() - Date.parse(cached.fetchedAt)) / 3.6e6;
    if (!(ageHours < MAX_AGE_HOURS)) return false;
    await writeFile(OUT, JSON.stringify(cached));
    console.log(`Reused deployed odds from ${cached.fetchedAt} (${ageHours.toFixed(1)}h old); no API call`);
    return true;
  } catch {
    return false;
  }
}

function toBook(b: ApiEvent["bookmakers"][number], ev: ApiEvent): BookOdds {
  const spreads = b.markets.find((m) => m.key === "spreads")?.outcomes ?? [];
  const totals = b.markets.find((m) => m.key === "totals")?.outcomes ?? [];
  const home = spreads.find((o) => o.name === ev.home_team);
  const away = spreads.find((o) => o.name === ev.away_team);
  const over = totals.find((o) => o.name === "Over");
  const under = totals.find((o) => o.name === "Under");
  return {
    key: b.key,
    title: b.title,
    lastUpdate: b.last_update,
    // A home spread point of -3.5 means home favored by 3.5.
    line: home?.point !== undefined ? -home.point : null,
    homePrice: home?.price ?? null,
    awayPrice: away?.price ?? null,
    total: over?.point ?? under?.point ?? null,
    overPrice: over?.price ?? null,
    underPrice: under?.price ?? null,
  };
}

async function main() {
  if (await reuseDeployed()) return;
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    console.log("ODDS_API_KEY not set; skipping sportsbook odds");
    return;
  }

  // Only the current NFL week: from now through a day after its last game.
  const { games }: GamesFile = JSON.parse(await readFile(GAMES, "utf8"));
  const week = currentWeek(games);
  if (!week) {
    console.log("No upcoming games; skipping sportsbook odds");
    return;
  }
  const thisWeek = new Set(week.games.map((g) => g.id));
  const lastDate = week.games.reduce((m, g) => (g.date > m ? g.date : m), week.games[0].date);
  const from = new Date();
  const to = new Date(Date.parse(`${lastDate}T00:00:00Z`) + 2 * 86400e3);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const url = new URL(API);
  url.search = new URLSearchParams({
    apiKey: key,
    regions: "us",
    markets: "spreads,totals",
    oddsFormat: "american",
    commenceTimeFrom: iso(from),
    commenceTimeTo: iso(to),
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The Odds API: ${res.status} ${await res.text()}`);
  const events: ApiEvent[] = await res.json();
  const remaining = Number(res.headers.get("x-requests-remaining"));

  // Match to this week's nflverse game ids by teams, allowing a day either side (UTC vs US dates).
  const out: GameOdds[] = [];
  for (const ev of events) {
    const home = abbrByName.get(ev.home_team);
    const away = abbrByName.get(ev.away_team);
    const t = Date.parse(ev.commence_time);
    const game = week.games.find(
      (g) => g.home === home && g.away === away && Math.abs(Date.parse(`${g.date}T12:00:00Z`) - t) < 1.5 * 86400e3,
    );
    if (!game || !thisWeek.has(game.id)) {
      console.warn(`No schedule match for ${ev.away_team} at ${ev.home_team} (${ev.commence_time})`);
      continue;
    }
    const books = ev.bookmakers.map((b) => toBook(b, ev));
    out.push({
      gameId: game.id,
      commence: ev.commence_time,
      books,
      line: median(books.flatMap((b) => (b.line === null ? [] : [b.line]))),
      total: median(books.flatMap((b) => (b.total === null ? [] : [b.total]))),
    });
  }

  const file: OddsFile = {
    fetchedAt: new Date().toISOString(),
    remaining: Number.isFinite(remaining) ? remaining : null,
    games: out,
  };
  await writeFile(OUT, JSON.stringify(file));
  console.log(`Fetched odds for ${out.length} of ${week.games.length} games in ${week.season} week ${week.week}; ${file.remaining ?? "?"} credits left`);
}

// Odds are a nice-to-have: warn (GitHub annotation) but never block the nightly data refresh.
main().catch((e) => {
  console.log(`::warning::Sportsbook odds not updated: ${e instanceof Error ? e.message : e}`);
});
