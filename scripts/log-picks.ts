// Records default-settings predictions for games in the next 8 days into
// public/data/pick-log.json (committed to the repo by the nightly workflow).
// A game's entry keeps updating until its game day, then is frozen.
// Run after `npm run data`: npm run log-picks
import { readFile, writeFile } from "node:fs/promises";
import type { OddsFile } from "../src/data/odds";
import type { PickLogFile } from "../src/data/pickLog";
import { isFinal, type GamesFile } from "../src/data/types";
import { runModels } from "../src/model/engine";
import { DEFAULT_SETTINGS } from "../src/model/settings";

const GAMES = new URL("../public/data/games.json", import.meta.url);
const LOG = new URL("../public/data/pick-log.json", import.meta.url);

const { games }: GamesFile = JSON.parse(await readFile(GAMES, "utf8"));
let log: PickLogFile = { settingsNote: JSON.stringify(DEFAULT_SETTINGS), picks: [] };
try {
  log = JSON.parse(await readFile(LOG, "utf8"));
} catch {
  // First run: start a new log.
}

let odds: OddsFile | null = null;
try {
  odds = JSON.parse(await readFile(new URL("../public/data/odds.json", import.meta.url), "utf8"));
} catch {
  // No sportsbook odds this run.
}
const bookFor = new Map(odds?.games.map((o) => [o.gameId, o]) ?? []);

const now = new Date();
const today = now.toISOString().slice(0, 10);
const horizon = new Date(now.getTime() + 8 * 86400e3).toISOString().slice(0, 10);
const byId = new Map(log.picks.map((p) => [p.id, p]));
let changed = 0;

for (const p of runModels(games, DEFAULT_SETTINGS).predictions) {
  const g = p.game;
  if (isFinal(g) || g.line === null || g.date < today || g.date > horizon) continue;
  byId.set(g.id, {
    id: g.id,
    season: g.season,
    week: g.week,
    date: g.date,
    home: g.home,
    away: g.away,
    loggedAt: now.toISOString(),
    line: g.line,
    total: g.total,
    bookLine: bookFor.get(g.id)?.line ?? null,
    bookTotal: bookFor.get(g.id)?.total ?? null,
    market: p.market,
    classic: p.classic,
    reliability: p.reliability,
    totalReliability: p.totalReliability,
    coverRanks: p.coverRanks,
    minGames: p.minGames,
  });
  changed++;
}

log.picks = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
await writeFile(LOG, JSON.stringify(log, null, 1) + "\n");
console.log(`Logged ${changed} upcoming games; ${log.picks.length} total in pick log`);
