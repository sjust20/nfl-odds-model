// Historical NFL odds from The Odds API into Neon Postgres (sql/schema.sql).
// Needs ODDS_API_KEY and DATABASE_URL, e.g. in .env.local (git-ignored):
//
//   npx tsx --env-file=.env.local scripts/history/odds-history.ts <command> [options]
//
// Commands:
//   migrate                         create or update the tables and view
//   plan [--from 2020] [--to 2026]  queue opening + closing snapshots for games already played; prints the cost
//   status                          progress, credits, and coverage
//   run [--limit N] [--season S] [--week W] [--reserve 200] [--dry-run]
//                                   download pending snapshots in order (resumable; stops at the credit reserve)
//   live-test                       store one live (current) snapshot to test the whole path (~2 credits)
//
// Historical calls need a paid plan. Each costs HISTORY_CALL_COST credits (20: two markets, ten books).
import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import {
  buildPlan,
  HISTORY_BOOKMAKERS,
  HISTORY_CALL_COST,
  HISTORY_MARKETS,
  parseSnapshot,
  type ApiEvent,
} from "../../src/data/oddsHistory";
import type { Game, GamesFile } from "../../src/data/types";

const API = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_nfl";

const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const need = (name: string) => {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set (put it in .env.local and run with --env-file=.env.local)`);
    process.exit(1);
  }
  return v;
};
const sql = neon(need("DATABASE_URL"));

async function loadGames(): Promise<Game[]> {
  const file: GamesFile = JSON.parse(await readFile(new URL("../../public/data/games.json", import.meta.url), "utf8"));
  return file.games;
}

interface Fetched {
  events: ApiEvent[];
  snapshotTs: string;
  previousTs: string | null;
  nextTs: string | null;
  cost: number | null;
  remaining: number | null;
}

/** Calls the API without ever logging the key. */
async function fetchOdds(historicalDate: string | null): Promise<Fetched> {
  const key = need("ODDS_API_KEY");
  const path = historicalDate ? `/historical/sports/${SPORT}/odds` : `/sports/${SPORT}/odds`;
  const url = new URL(API + path);
  url.search = new URLSearchParams({
    apiKey: key,
    bookmakers: HISTORY_BOOKMAKERS.join(","),
    markets: HISTORY_MARKETS.join(","),
    oddsFormat: "american",
    dateFormat: "iso",
    // The API rejects fractional seconds ("Invalid date parameter"), so send e.g. 2024-09-03T16:00:00Z.
    ...(historicalDate ? { date: historicalDate.replace(/\.\d{3}Z$/, "Z") } : {}),
  }).toString();
  const res = await fetch(url);
  const header = (n: string) => (res.headers.get(n) === null ? null : Number(res.headers.get(n)));
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  const events: ApiEvent[] = historicalDate ? body.data : body;
  return {
    events,
    snapshotTs: historicalDate ? body.timestamp : new Date().toISOString(),
    previousTs: historicalDate ? body.previous_timestamp ?? null : null,
    nextTs: historicalDate ? body.next_timestamp ?? null : null,
    cost: header("x-requests-last"),
    remaining: header("x-requests-remaining"),
  };
}

/** Stores a snapshot and its lines in one transaction. Re-storing the same snapshot is a no-op. */
async function store(f: Fetched, source: "historical" | "live", requestedFor: string | null, games: Game[]) {
  const { rows, unmatched } = parseSnapshot(f.snapshotTs, f.events, games);
  await sql.transaction([
    sql`insert into odds_snapshots
          (snapshot_ts, source, requested_for, previous_ts, next_ts, markets, bookmakers, credits_cost, credits_remaining, event_count, raw)
        values (${f.snapshotTs}, ${source}, ${requestedFor}, ${f.previousTs}, ${f.nextTs}, ${HISTORY_MARKETS.join(",")},
                ${HISTORY_BOOKMAKERS.join(",")}, ${f.cost}, ${f.remaining}, ${f.events.length}, ${JSON.stringify(f.events)})
        on conflict (snapshot_ts) do nothing`,
    sql`insert into odds_lines
        select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(
          snapshot_ts timestamptz, event_id text, game_id text, commence_time timestamptz, home text, away text,
          bookmaker text, market text, last_update timestamptz, line numeric, home_price int, away_price int,
          over_price int, under_price int)
        on conflict do nothing`,
  ]);
  return { rows, unmatched };
}

async function migrate() {
  const schema = await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8");
  const statements = schema
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  for (const s of statements) await sql.query(s);
  console.log(`Applied ${statements.length} statements.`);
}

async function plan() {
  const from = Number(opt("from") ?? 2020);
  const to = Number(opt("to") ?? new Date().getUTCFullYear());
  const rows = buildPlan(await loadGames(), from, to);
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await sql.query(
      `insert into download_plan (target_ts, kind, season, week, games)
       select target, kind, season, week, games from jsonb_to_recordset($1::jsonb)
         as x(target timestamptz, kind text, season int, week int, games text[])
       on conflict (target_ts) do nothing
       returning 1`,
      [JSON.stringify(batch)],
    );
    added += res.length;
  }
  const opens = rows.filter((r) => r.kind === "open").length;
  console.log(`Plan ${from}-${to}: ${rows.length} snapshots (${opens} opening, ${rows.length - opens} closing); ${added} newly queued.`);
  await status();
}

async function status() {
  const byStatus = await sql`select status, count(*)::int as n from download_plan group by status order by status`;
  const pending = byStatus.find((r) => r.status === "pending")?.n ?? 0;
  const [credits] = await sql`select min(credits_remaining) as remaining, count(*)::int as snapshots from odds_snapshots where source = 'historical'`;
  const [coverage] = await sql`select count(distinct game_id)::int as games,
      count(distinct game_id) filter (where open_line is not null and close_line is not null)::int as both
    from game_open_close where market = 'spreads'`;
  console.log("Plan:", Object.fromEntries(byStatus.map((r) => [r.status, r.n])));
  console.log(`Pending cost: ${pending} x ${HISTORY_CALL_COST} = ${pending * HISTORY_CALL_COST} credits`);
  console.log(`Historical snapshots stored: ${credits.snapshots}; credits remaining at last call: ${credits.remaining ?? "?"}`);
  console.log(`Games with spreads: ${coverage.games} (${coverage.both} with both opening and closing lines)`);
}

async function run() {
  const limit = Number(opt("limit") ?? Infinity);
  const reserve = Number(opt("reserve") ?? 200);
  const season = opt("season");
  const week = opt("week");
  const dryRun = flag("dry-run");
  const games = await loadGames();
  const todo = await sql.query(
    `select target_ts, kind, season, week, games from download_plan
     where status <> 'done' and ($1::int is null or season = $1::int) and ($2::int is null or week = $2::int)
     order by target_ts`,
    [season ?? null, week ?? null],
  );
  const batch = todo.slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`${batch.length} snapshots to fetch (${batch.length * HISTORY_CALL_COST} credits)${dryRun ? " [dry run]" : ""}`);
  if (dryRun) {
    for (const r of batch.slice(0, 20)) console.log(`  ${new Date(r.target_ts).toISOString()} ${r.kind.padEnd(5)} ${r.season} wk ${r.week}: ${r.games.length} games`);
    return;
  }

  let remaining: number | null = null;
  for (const r of batch) {
    if (remaining !== null && remaining < reserve + HISTORY_CALL_COST) {
      console.log(`Stopping: ${remaining} credits left (reserve ${reserve}).`);
      break;
    }
    const target = new Date(r.target_ts).toISOString();
    try {
      const f = await fetchOdds(target);
      remaining = f.remaining;
      const { rows, unmatched } = await store(f, "historical", target, games);
      const found = new Set(rows.map((x) => x.game_id));
      const missing = (r.games as string[]).filter((g) => !found.has(g));
      await sql`update download_plan
        set status = 'done', snapshot_ts = ${f.snapshotTs}, attempts = attempts + 1, updated_at = now(),
            error = ${missing.length ? `no lines for ${missing.join(", ")}` : null}
        where target_ts = ${target}`;
      console.log(
        `${target} ${r.kind.padEnd(5)} -> snapshot ${f.snapshotTs}: ${f.events.length} events, ${rows.length} lines` +
          `${missing.length ? `, MISSING ${missing.length}/${r.games.length} planned games` : ""}` +
          `${unmatched.length ? `, ${unmatched.length} unmatched events` : ""} | cost ${f.cost}, left ${f.remaining}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`update download_plan set status = 'error', attempts = attempts + 1, error = ${msg}, updated_at = now() where target_ts = ${target}`;
      console.log(`${target} ${r.kind} FAILED: ${msg}`);
      if (/HTTP 4\d\d|quota|UNAVAILABLE|INVALID/i.test(msg)) {
        console.log("Stopping on a request, access or quota error (it would repeat for every snapshot).");
        break;
      }
    }
  }
  await status();
}

async function liveTest() {
  const games = await loadGames();
  const f = await fetchOdds(null);
  const { rows, unmatched } = await store(f, "live", null, games);
  const books = new Set(rows.map((r) => r.bookmaker));
  console.log(`Live snapshot ${f.snapshotTs}: ${f.events.length} events, ${rows.length} lines from ${books.size} books (${[...books].join(", ")})`);
  if (unmatched.length) console.log(`Unmatched events: ${unmatched.join("; ")}`);
  console.log(`Cost ${f.cost}, credits left ${f.remaining}`);
  const sample = await sql`select home, away, bookmaker, market, line, home_price, over_price
    from odds_lines where snapshot_ts = ${f.snapshotTs} and game_id is not null order by commence_time, market, bookmaker limit 8`;
  console.table(sample);
}

const commands: Record<string, () => Promise<void>> = { migrate, plan, status, run, "live-test": liveTest };
if (!commands[command]) {
  console.error(`Usage: odds-history.ts <${Object.keys(commands).join("|")}> [options]`);
  process.exit(1);
}
commands[command]().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
