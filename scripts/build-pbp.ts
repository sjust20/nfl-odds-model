// Aggregates nflverse play-by-play into per-game team efficiency: data/pbp/<season>.json.
// Past seasons are built once and committed; the nightly job rebuilds only the current season.
//
//   npm run pbp                             # current season only (runs before `npm run data`)
//   npx tsx scripts/build-pbp.ts 1999 2025  # a range (the one-time backfill)
import { mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { CsvStream } from "../src/data/csv";
import type { PbpSeasonFile, TeamPbp } from "../src/data/pbp";
import { RELOCATED } from "../src/data/teams";

const url = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
const OUT_DIR = new URL("../data/pbp/", import.meta.url);

const round = (x: number) => Math.round(x * 1000) / 1000;

async function buildSeason(season: number): Promise<PbpSeasonFile | null> {
  const res = await fetch(url(season));
  if (res.status === 404) return null; // season hasn't started (no file published yet)
  if (!res.ok || !res.body) throw new Error(`play-by-play ${season}: ${res.status}`);

  const games: PbpSeasonFile["games"] = {};
  const qbTotals = new Map<string, Map<string, [string, number, number]>>(); // gameTeam -> qbId -> [name, db, epa]
  let col: Record<string, number> | null = null;
  let plays = 0;

  const parser = new CsvStream((r) => {
    if (!col) {
      col = Object.fromEntries(r.map((name, i) => [name, i]));
      return;
    }
    const c = col;
    const type = r[c.play_type];
    if (type !== "pass" && type !== "run") return;
    if (r[c.two_point_attempt] === "1") return;
    const epa = Number(r[c.epa]);
    if (r[c.epa] === "NA" || r[c.epa] === "" || !Number.isFinite(epa)) return;
    const gameId = r[c.game_id];
    const team = RELOCATED[r[c.posteam]] ?? r[c.posteam];
    if (!team) return;
    const g = (games[gameId] ??= {});
    const t: TeamPbp = (g[team] ??= { pl: 0, ep: 0, sr: 0, db: 0, dbEp: 0, plN: 0, epN: 0, qbs: [] });
    t.pl++;
    t.ep += epa;
    if (r[c.success] === "1") t.sr++;
    const wp = Number(r[c.wp]);
    if (Number.isFinite(wp) && wp >= 0.1 && wp <= 0.9) {
      t.plN++;
      t.epN += epa;
    }
    if (r[c.qb_dropback] === "1") {
      t.db++;
      t.dbEp += epa;
      const id = r[c.id] && r[c.id] !== "NA" ? r[c.id] : r[c.passer_player_id];
      const name = r[c.name] && r[c.name] !== "NA" ? r[c.name] : r[c.passer_player_name];
      // Rows arrive in play order, so the first dropback QB seen is the starter.
      if (id && id !== "NA" && !t.st) t.st = [id, name];
      if (id && id !== "NA") {
        const key = `${gameId}|${team}`;
        const m = qbTotals.get(key) ?? new Map();
        qbTotals.set(key, m);
        const q = m.get(id) ?? [name, 0, 0];
        q[1]++;
        q[2] += epa;
        m.set(id, q);
      }
    }
    plays++;
  });

  const text = Readable.fromWeb(res.body as never).pipe(createGunzip());
  text.setEncoding("utf8");
  for await (const chunk of text) parser.push(chunk as string);
  parser.end();

  for (const [key, m] of qbTotals) {
    const [gameId, team] = key.split("|");
    games[gameId][team].qbs = [...m]
      .sort((a, b) => b[1][1] - a[1][1])
      .map(([id, [name, db, epa]]) => [id, name, db, round(epa)]);
  }
  for (const g of Object.values(games))
    for (const t of Object.values(g)) {
      t.ep = round(t.ep);
      t.dbEp = round(t.dbEp);
      t.epN = round(t.epN);
    }
  console.log(`${season}: ${plays} plays, ${Object.keys(games).length} games`);
  return { season, builtAt: new Date().toISOString(), source: url(season), games };
}

async function main() {
  // NFL seasons start in September and end in February: before March it's still last season.
  const now = new Date();
  const current = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const [from, to] = process.argv.length > 2 ? [Number(process.argv[2]), Number(process.argv[3] ?? process.argv[2])] : [current, current];
  await mkdir(OUT_DIR, { recursive: true });
  for (let season = from; season <= to; season++) {
    const file = await buildSeason(season);
    if (!file) {
      console.log(`${season}: no play-by-play published yet; skipping`);
      continue;
    }
    await writeFile(new URL(`${season}.json`, OUT_DIR), JSON.stringify(file));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
