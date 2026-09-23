// First look at opening-to-closing line movement (read-only):
//   1b. Is the move worth money? Betting the side the line later moved toward, at the opening
//       number vs at the closing number.
//   1.  Do our models' pre-week opinions point the way the line moves?
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
