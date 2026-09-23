// Downloads nflverse games.csv and writes the slim JSON the site loads.
// Run: npm run data
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { applyOverrides, reconcileCurrentCoaches, sameCoach, type CoachOverride } from "../src/data/coaches";
import { parseCsv } from "../src/data/csv";
import type { PbpSeasonFile } from "../src/data/pbp";
import { RELOCATED } from "../src/data/teams";
import { currentWeek } from "../src/data/week";
import type { Game, GamesFile, GameType, Qb, QbCheck } from "../src/data/types";

const SOURCE = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const OUT = new URL("../public/data/games.json", import.meta.url);


const OVERRIDES = new URL("../data/coach-overrides.json", import.meta.url);
const ESPN_TEAMS = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const espnCoaches = (season: number, id: string) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${id}/coaches`;
const ESPN_ABBR: Record<string, string> = { WSH: "WAS", LAR: "LA" };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url.replace(/^http:/, "https:"));
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

/**
 * Each team's current head coach from ESPN's (unofficial) API. ESPN only knows the present
 * coach, so this can only check the current season. Teams listing several coaches are skipped.
 */
async function currentCoachesFromEspn(season: number): Promise<{ coaches: Record<string, string>; skipped: string[] }> {
  type Teams = { sports: { leagues: { teams: { team: { id: string; abbreviation: string } }[] }[] }[] };
  const teams = (await getJson<Teams>(ESPN_TEAMS)).sports[0].leagues[0].teams.map((t) => t.team);
  const coaches: Record<string, string> = {};
  const skipped: string[] = [];
  await Promise.all(
    teams.map(async (t) => {
      const abbr = ESPN_ABBR[t.abbreviation] ?? t.abbreviation;
      const list = await getJson<{ items?: { $ref: string }[] }>(espnCoaches(season, t.id));
      const items = list.items ?? [];
      if (items.length !== 1) {
        skipped.push(`${abbr} (${items.length} coaches listed)`);
        return;
      }
      const c = await getJson<{ firstName: string; lastName: string }>(items[0].$ref);
      coaches[abbr] = `${c.firstName} ${c.lastName}`.trim();
    }),
  );
  return { coaches, skipped };
}

/** Each team's QB1 on ESPN's depth chart (offense). */
async function espnQb1(): Promise<Record<string, string>> {
  type Teams = { sports: { leagues: { teams: { team: { id: string; abbreviation: string } }[] }[] }[] };
  type Depth = { depthchart?: { name: string; positions: Record<string, { athletes: { displayName: string }[] }> }[] };
  const teams = (await getJson<Teams>(ESPN_TEAMS)).sports[0].leagues[0].teams.map((t) => t.team);
  const out: Record<string, string> = {};
  await Promise.all(
    teams.map(async (t) => {
      const d = await getJson<Depth>(`${ESPN_TEAMS}/${t.id}/depthcharts`);
      const qb = d.depthchart?.map((c) => c.positions.qb).find(Boolean)?.athletes?.[0]?.displayName;
      if (qb) out[ESPN_ABBR[t.abbreviation] ?? t.abbreviation] = qb;
    }),
  );
  return out;
}

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
    date: col("gameday"), time: col("gametime"), away: col("away_team"), awayScore: col("away_score"),
    home: col("home_team"), homeScore: col("home_score"), location: col("location"),
    line: col("spread_line"), total: col("total_line"),
    awayCoach: col("away_coach"), homeCoach: col("home_coach"),
    awayQbId: col("away_qb_id"), awayQbName: col("away_qb_name"),
    homeQbId: col("home_qb_id"), homeQbName: col("home_qb_name"),
  };
  const qb = (id: string, name: string): Qb | null =>
    name === "" || name === "NA" ? null : { id: id && id !== "NA" ? id : name, name };

  const games: Game[] = rows
    .filter((r) => r.length === header.length)
    .map((r) => ({
      id: r[c.id],
      season: Number(r[c.season]),
      week: Number(r[c.week]),
      type: r[c.type] as GameType,
      date: r[c.date],
      time: r[c.time] && r[c.time] !== "NA" ? r[c.time] : undefined,
      away: RELOCATED[r[c.away]] ?? r[c.away],
      home: RELOCATED[r[c.home]] ?? r[c.home],
      awayScore: num(r[c.awayScore]),
      homeScore: num(r[c.homeScore]),
      line: num(r[c.line]),
      total: num(r[c.total]),
      neutral: r[c.location] === "Neutral",
      awayCoach: r[c.awayCoach],
      homeCoach: r[c.homeCoach],
      awayQb: qb(r[c.awayQbId], r[c.awayQbName]),
      homeQb: qb(r[c.homeQbId], r[c.homeQbName]),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  if (games.length < 7000) throw new Error(`Only ${games.length} games parsed; refusing to publish`);

  // Play-by-play efficiency (data/pbp, built by scripts/build-pbp.ts).
  const pbpDir = new URL("../data/pbp/", import.meta.url);
  const pbp: PbpSeasonFile["games"] = {};
  for (const f of (await readdir(pbpDir)).filter((f) => f.endsWith(".json")))
    Object.assign(pbp, (JSON.parse(await readFile(new URL(f, pbpDir), "utf8")) as PbpSeasonFile).games);
  let withPbp = 0;
  for (const g of games) {
    const p = pbp[g.id];
    if (p?.[g.home] && p[g.away]) {
      g.pbp = { home: p[g.home], away: p[g.away] };
      withPbp++;
    }
  }
  console.log(`Play-by-play attached to ${withPbp} games`);

  // Coach corrections: manual overrides first, then the current season vs ESPN.
  const { overrides }: { overrides: CoachOverride[] } = JSON.parse(await readFile(OVERRIDES, "utf8"));
  const { corrections, locked } = applyOverrides(games, overrides);
  const season = currentWeek(games)?.season ?? games[games.length - 1].season;
  let coachCheck: string;
  try {
    const { coaches, skipped } = await currentCoachesFromEspn(season);
    const known = new Set(games.filter((g) => g.season === season).flatMap((g) => [g.home, g.away]));
    const matched = Object.keys(coaches).filter((t) => known.has(t));
    if (matched.length < 28) throw new Error(`only ${matched.length} teams matched`);
    corrections.push(...reconcileCurrentCoaches(games, season, coaches, locked));
    coachCheck = `ESPN current coaches: ${matched.length} teams checked for ${season}`;
    if (skipped.length) coachCheck += `; skipped ${skipped.join(", ")}`;
  } catch (e) {
    coachCheck = `ESPN coach check skipped: ${e instanceof Error ? e.message : e}`;
    console.log(`::warning::${coachCheck}`);
  }
  for (const c of corrections) {
    const msg = `Coach correction (${c.kind}) ${c.team} ${c.season}: ${c.was} -> ${c.now} (${c.games} games)`;
    console.log(c.kind === "spelling" ? msg : `::notice::${msg}`);
  }
  console.log(coachCheck);

  // This week's projected starters vs ESPN's depth-chart QB1 (a flag only; both sources can lag).
  let qbCheck: GamesFile["qbCheck"];
  const week = currentWeek(games);
  try {
    if (week) {
      const espn = await espnQb1();
      const teams: Record<string, QbCheck> = {};
      for (const g of week.games) {
        if (g.homeScore !== null) continue;
        for (const [team, q] of [[g.home, g.homeQb], [g.away, g.awayQb]] as const) {
          const listed = q?.name ?? null;
          const e = espn[team] ?? null;
          teams[team] = { listed, espn: e, agree: !!listed && !!e && sameCoach(listed, e) };
        }
      }
      qbCheck = { checkedAt: new Date().toISOString(), teams };
      const off = Object.entries(teams).filter(([, c]) => !c.agree);
      console.log(`QB check: ${Object.keys(teams).length} teams, ${off.length} disagree${off.length ? `: ${off.map(([t, c]) => `${t} listed ${c.listed ?? "none"} vs ESPN ${c.espn ?? "none"}`).join("; ")}` : ""}`);
    }
  } catch (e) {
    console.log(`::warning::ESPN QB check skipped: ${e instanceof Error ? e.message : e}`);
  }

  const file: GamesFile = {
    updatedAt: new Date().toISOString(),
    source: SOURCE,
    games,
    coachCorrections: corrections,
    coachCheck,
    qbCheck,
  };
  await mkdir(new URL(".", OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(file));
  const done = games.filter((g) => g.homeScore !== null).length;
  console.log(`Wrote ${games.length} games (${done} final) to ${OUT.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
