// Downloads nflverse games.csv and writes the slim JSON the site loads.
// Run: npm run data
import { mkdir, writeFile } from "node:fs/promises";
import { parseCsv } from "../src/data/csv";
import type { Game, GamesFile, GameType } from "../src/data/types";

const SOURCE = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const OUT = new URL("../public/data/games.json", import.meta.url);

// Relocated franchises use their current abbreviation throughout.
const RELOCATED: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };

const num = (s: string): number | null => (s === "" || s === "NA" ? null : Number(s));

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`nflverse download failed: ${res.status} ${res.statusText}`);
  const [header, ...rows] = parseCsv(await res.text());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`games.csv is missing column "${name}"`);
    return i;
  };
  const c = {
    id: col("game_id"), season: col("season"), type: col("game_type"), week: col("week"),
    date: col("gameday"), away: col("away_team"), awayScore: col("away_score"),
    home: col("home_team"), homeScore: col("home_score"), location: col("location"),
    line: col("spread_line"), total: col("total_line"),
    awayCoach: col("away_coach"), homeCoach: col("home_coach"),
  };

  const games: Game[] = rows
    .filter((r) => r.length === header.length)
    .map((r) => ({
      id: r[c.id],
      season: Number(r[c.season]),
      week: Number(r[c.week]),
      type: r[c.type] as GameType,
      date: r[c.date],
      away: RELOCATED[r[c.away]] ?? r[c.away],
      home: RELOCATED[r[c.home]] ?? r[c.home],
      awayScore: num(r[c.awayScore]),
      homeScore: num(r[c.homeScore]),
      line: num(r[c.line]),
      total: num(r[c.total]),
      neutral: r[c.location] === "Neutral",
      awayCoach: r[c.awayCoach],
      homeCoach: r[c.homeCoach],
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  if (games.length < 7000) throw new Error(`Only ${games.length} games parsed; refusing to publish`);

  const file: GamesFile = { updatedAt: new Date().toISOString(), source: SOURCE, games };
  await mkdir(new URL(".", OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(file));
  const done = games.filter((g) => g.homeScore !== null).length;
  console.log(`Wrote ${games.length} games (${done} final) to ${OUT.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
