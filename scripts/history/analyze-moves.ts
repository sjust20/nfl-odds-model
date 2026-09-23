// First look at opening-to-closing line movement (read-only):
//   1b. Is the move worth money? Betting the side the line later moved toward, at the opening
//       number vs at the closing number.
//   1.  Do our models' pre-week opinions point the way the line moves?
//   3.  Betting the model's side at the Tuesday number, median book vs best book.
//   4.  Opening-line uncertainty after in-game QB changes, by starter-minus-backup value.
// Consensus = median across books; Pinnacle reported separately as the sharp benchmark.
//
//   npm run odds-history-analyze
import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { isFinal, type GamesFile } from "../../src/data/types";
import { runModels } from "../../src/model/engine";
import { record } from "../../src/model/metrics";
import { DEFAULT_SETTINGS } from "../../src/model/settings";
import { lineAdjustment } from "../../src/model/tracked";

const sql = neon(process.env.DATABASE_URL!);
const { games }: GamesFile = JSON.parse(await readFile(new URL("../../public/data/games.json", import.meta.url), "utf8"));
const byId = new Map(games.map((g) => [g.id, g]));

type Row = { game_id: string; market: "spreads" | "totals"; open: number; close: number };
const load = async (book: string | null): Promise<Row[]> => {
  const rows = book
    ? await sql`select game_id, market, open_line::float as open, close_line::float as close from game_open_close
        where bookmaker = ${book} and open_line is not null and close_line is not null`
    : await sql`select game_id, market,
          percentile_cont(0.5) within group (order by open_line)::float as open,
          percentile_cont(0.5) within group (order by close_line)::float as close
        from game_open_close where open_line is not null and close_line is not null group by game_id, market`;
  return rows as Row[];
};

const pct = (w: number, n: number) => {
  const r = record(w, n - w);
  return n ? `${(r.pct * 100).toFixed(1)}% (n=${n}, ${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)})` : "-";
};

/** Result of betting in the direction of the move, graded at a given number. 1 win, 0 loss, null push. */
function grade(r: Row, at: number): 1 | 0 | null {
  const g = byId.get(r.game_id)!;
  const dir = Math.sign(r.close - r.open); // spreads: + = toward home; totals: + = toward over
  const outcome = r.market === "spreads" ? g.homeScore! - g.awayScore! - at : g.homeScore! + g.awayScore! - at;
  if (outcome === 0) return null;
  return Math.sign(outcome) === dir ? 1 : 0;
}

for (const [label, book] of [["Consensus (median of books)", null], ["Pinnacle", "pinnacle"]] as const) {
  const rows = (await load(book)).filter((r) => byId.get(r.game_id) && isFinal(byId.get(r.game_id)!));
  console.log(`\n===== ${label}: ${rows.length} game-markets`);
  for (const market of ["spreads", "totals"] as const) {
    const m = rows.filter((r) => r.market === market);
    const moves = m.map((r) => Math.abs(r.close - r.open));
    const moved = m.filter((r) => r.close !== r.open);
    const avg = moves.reduce((s, v) => s + v, 0) / (moves.length || 1);
    console.log(`\n  ${market}: ${m.length} games, ${moved.length} moved (${((moved.length / (m.length || 1)) * 100).toFixed(0)}%), average |move| ${avg.toFixed(2)} pts`);
    console.log("  1b. Bet the side the line moved toward:");
    for (const [lo, hi] of [[0.5, 0.5], [1, 1.5], [2, 99]] as const) {
      const bucket = moved.filter((r) => Math.abs(r.close - r.open) >= lo && Math.abs(r.close - r.open) <= hi);
      const atOpen = bucket.map((r) => grade(r, r.open)).filter((x) => x !== null) as number[];
      const atClose = bucket.map((r) => grade(r, r.close)).filter((x) => x !== null) as number[];
      const w = (xs: number[]) => xs.filter((x) => x === 1).length;
      console.log(
        `     move ${hi === 99 ? `${lo}+` : lo === hi ? lo : `${lo}-${hi}`} pts: at opening number ${pct(w(atOpen), atOpen.length)} | at closing number ${pct(w(atClose), atClose.length)}`,
      );
    }
  }

  // 1. Model opinions (walk-forward, before the week) vs the direction of the move.
  const run = runModels(games, DEFAULT_SETTINGS);
  const pred = new Map(run.predictions.map((p) => [p.game.id, p]));
  const spreads = rows.filter((r) => r.market === "spreads" && r.close !== r.open);
  console.log("\n  1. Does the model's disagreement with the opening line predict the move's direction? (spreads)");
  for (const [name, f] of [
    ["Market model", (r: Row) => pred.get(r.game_id)!.market.line - r.open],
    ["Play-by-play model", (r: Row) => pred.get(r.game_id)!.pbp.line - r.open],
    ["Market model, no QB adjustment", (r: Row) => pred.get(r.game_id)!.market.line - DEFAULT_SETTINGS.market.qbScale * pred.get(r.game_id)!.qbAdj - r.open],
    ["Components adjustment alone", (r: Row) => lineAdjustment(pred.get(r.game_id)!.components)],
  ] as const) {
    for (const minEdge of [0, 1, 2]) {
      let agree = 0;
      let n = 0;
      for (const r of spreads) {
        const e = f(r);
        if (Math.abs(e) <= minEdge || e === 0) continue;
        n++;
        if (Math.sign(e) === Math.sign(r.close - r.open)) agree++;
      }
      console.log(`     ${name.padEnd(32)} |signal| > ${minEdge}: points the way the line moved ${pct(agree, n)}`);
    }
  }
}

// 3. Betting the model's side at the Tuesday number: median book vs the best US book (line
//    shopping), with and without the QB adjustment (the listed starter is often not known on
//    Tuesday, so the no-QB versions are the clean ones). Graded at -110.
{
  const run = runModels(games, DEFAULT_SETTINGS);
  const pred = new Map(run.predictions.map((p) => [p.game.id, p]));
  const pb = DEFAULT_SETTINGS.pbp;
  const mq = (id: string) => DEFAULT_SETTINGS.market.qbScale * pred.get(id)!.qbAdj;
  const rows = (await sql`select game_id,
      percentile_cont(0.5) within group (order by open_line)::float as open,
      percentile_cont(0.5) within group (order by close_line)::float as close,
      min(open_line) filter (where bookmaker <> 'pinnacle')::float as open_min,
      max(open_line) filter (where bookmaker <> 'pinnacle')::float as open_max
    from game_open_close where market = 'spreads' and open_line is not null and close_line is not null group by game_id`) as {
    game_id: string; open: number; close: number; open_min: number; open_max: number;
  }[];
  console.log("\n===== 3. Bet the model's side at the Tuesday number (spreads, graded at -110)");
  const signals: [string, (id: string) => number][] = [
    ["Market, no QB adj", (id) => pred.get(id)!.market.line - mq(id)],
    ["Market, with QB adj", (id) => pred.get(id)!.market.line],
    ["Play-by-play, no QB adj", (id) => pred.get(id)!.pbp.line - pb.marketWeight * mq(id)],
    ["Play-by-play, with QB adj", (id) => pred.get(id)!.pbp.line],
  ];
  for (const [label, sig] of signals) {
    console.log(`\n  ${label}`);
    for (const k of [0, 2, 3]) {
      for (const shop of [false, true]) {
        const parts: string[] = [];
        let clv = 0;
        let clvN = 0;
        for (const [era, lo, hi] of [["2020-23", 2020, 2023], ["2024-26", 2024, 2026], ["all", 2020, 2026]] as const) {
          let w = 0;
          let n = 0;
          for (const r of rows) {
            const g = byId.get(r.game_id);
            if (!g || !isFinal(g) || g.season < lo || g.season > hi || !pred.get(r.game_id)) continue;
            const edge = sig(r.game_id) - r.open;
            if (Math.abs(edge) <= k || !edge) continue;
            const side = Math.sign(edge);
            const taken = shop ? (side > 0 ? r.open_min : r.open_max) : r.open;
            if (era === "all") (clv += side * (r.close - taken)), clvN++;
            const cover = g.homeScore - g.awayScore - taken;
            if (cover === 0) continue;
            n++;
            if (Math.sign(cover) === side) w++;
          }
          parts.push(`${era} ${pct(w, n)}`);
        }
        console.log(`    edge > ${k}, ${shop ? "best book" : "median   "}: ${parts.join(" | ")} | CLV ${(clv / (clvN || 1)).toFixed(2)}`);
      }
    }
  }
}

// 4. Opening-line uncertainty after a meaningful in-game QB change (starter under 70% of dropbacks,
//    backup at least 8, final margin 17 or less), split by how much better the starter was than the
//    backup at the time (QB values in points per game).
{
  const { QbTracker, QB_VALUE } = await import("../../src/model/qbValue");
  const tracker = new QbTracker();
  const L = new Map(
    ((await sql`select game_id, count(open_line)::int as books, (max(open_line) - min(open_line))::float as range,
        percentile_cont(0.5) within group (order by open_line)::float as open,
        percentile_cont(0.5) within group (order by close_line)::float as close
      from game_open_close where market = 'spreads' group by game_id`) as { game_id: string; books: number; range: number | null; open: number | null; close: number | null }[]).map((r) => [r.game_id, r]),
  );
  const pending = new Map<string, number>(); // team -> starter-minus-backup gap from its last game
  type B = { n: number; missing: number; range: number[]; move: number[] };
  const buckets = new Map<string, B>();
  const bucket = (k: string) => buckets.get(k) ?? (buckets.set(k, { n: 0, missing: 0, range: [], move: [] }), buckets.get(k)!);
  for (const g of games) {
    if (!isFinal(g) || !g.pbp) continue;
    if (g.season >= 2020 && L.has(g.id)) {
      const gaps = [g.home, g.away].map((t) => pending.get(t)).filter((x): x is number => x !== undefined);
      const key = !gaps.length ? "no in-game change" : Math.max(...gaps) < 2 ? "change, gap < 2 pts" : Math.max(...gaps) < 4 ? "change, gap 2-4 pts" : "change, gap 4+ pts";
      const l = L.get(g.id)!;
      const b = bucket(key);
      b.n++;
      if (l.open === null) b.missing++;
      else {
        if (l.books >= 3 && l.range !== null) b.range.push(l.range);
        if (l.close !== null) b.move.push(Math.abs(l.close - l.open));
      }
    }
    for (const [team, side] of [[g.home, "home"], [g.away, "away"]] as const) {
      const p = g.pbp[side];
      tracker.addGame(team, p);
      pending.delete(team);
      const st = p.st?.[0] ?? p.qbs[0]?.[0];
      const starter = p.qbs.find((q) => q[0] === st);
      const backup = p.qbs.filter((q) => q[0] !== st).sort((a, b) => b[2] - a[2])[0];
      if (starter && backup && p.db >= 10 && starter[2] / p.db < 0.7 && backup[2] >= 8 && Math.abs(g.homeScore - g.awayScore) <= 17)
        pending.set(team, QB_VALUE.dropbacksPerGame * (tracker.value(starter[0]) - tracker.value(backup[0])));
    }
    tracker.endWeek();
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const share = (a: number[], f: (v: number) => boolean) => `${((a.filter(f).length / (a.length || 1)) * 100).toFixed(0)}%`;
  console.log("\n===== 4. Next game after a meaningful in-game QB change, by starter-minus-backup value");
  for (const k of ["no in-game change", "change, gap < 2 pts", "change, gap 2-4 pts", "change, gap 4+ pts"]) {
    const b = buckets.get(k);
    if (!b) continue;
    console.log(
      `  ${k.padEnd(20)} games ${String(b.n).padStart(4)} | no Tuesday line ${((b.missing / b.n) * 100).toFixed(1)}% | books' opening range ${mean(b.range).toFixed(2)} | avg |move| ${mean(b.move).toFixed(2)} (2+ pts: ${share(b.move, (v) => v >= 2)}, 3+ pts: ${share(b.move, (v) => v >= 3)})`,
    );
  }
}
