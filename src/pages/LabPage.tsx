import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DivergingColumns, StatTile } from "../components/charts";
import { teamName } from "../data/teams";
import { isFinal, type Game } from "../data/types";
import { lineLabel, num, pct, shortDate } from "../format";
import type { LoggedPick, PickSnapshot } from "../data/pickLog";
import type { ComponentDiffs } from "../model/components";
import type { Prediction, SidePrediction } from "../model/engine";
import {
  accuracy,
  betFor,
  BREAK_EVEN,
  evaluate,
  record,
  strategyGrid,
  type Bet,
  type BetRecord,
  type GridCell,
  type Strategy,
} from "../model/metrics";
import { bigEdgeNoQb, LINE_PLUS_COMPONENTS, LINE_PLUS_COMPONENTS_MIN, lineAdjustment, linePlusComponentsBet } from "../model/tracked";
import { DEFAULT_STRATEGIES, useApp, type BetKind } from "../state";

const RELIABILITY_OPTIONS = [8, 12, 16, 20, 24, 32, 40, 48];
const EDGE_STEPS = [0, 1, 2, 3, 4, 5, 6];
const GAP_STEPS = [1, 4, 8, 12, 16, 20, 24];
const GRID_RELIABILITY: (number | null)[] = [8, 16, 24, 32, 40, null];
const MIN_N_OPTIONS = [50, 100, 200, 400];

export function strategySummary(s: Strategy): string {
  const parts: string[] = [];
  if (s.pick === "model") {
    parts.push(`${s.model === "market" ? "Market" : "Play-by-play"} ${s.market === "spread" ? "sides" : "totals"}`);
    parts.push(s.minEdge > 0 ? `edge > ${s.minEdge}` : "any edge");
  } else {
    parts.push(`${s.pick === "highVariance" ? "high" : "low"}-variance side, rank gap ≥ ${Math.max(1, s.minEdge)}`);
  }
  if (s.maxReliability !== null) parts.push(`reliability ≤ ${s.maxReliability}`);
  if (s.minGames > 0) parts.push(`≥ ${s.minGames} games`);
  if (s.skipQbChange) parts.push("no QB changes");
  return parts.join(", ");
}

function verdict(r: BetRecord) {
  const n = r.wins + r.losses;
  if (n < 30) return { text: "Too few bets to judge", tone: "" };
  if (r.lo > BREAK_EVEN) return { text: "Above break-even, even at the low end of the 95% range", tone: "good" };
  if (r.hi < BREAK_EVEN) return { text: "Below break-even, even at the high end of the 95% range", tone: "bad" };
  return { text: "Can't tell apart from break-even: the 95% range includes 52.4%", tone: "" };
}

/** Diverging fill around break-even: blue arm above, red arm below, gray at the midpoint. */
function cellStyle(c: GridCell) {
  const d = Math.max(-1, Math.min(1, (c.record.pct - BREAK_EVEN) / 0.06));
  const pole = d >= 0 ? "var(--pos)" : "var(--neg)";
  const mix = Math.round(Math.abs(d) * 85);
  return {
    background: `color-mix(in oklab, ${pole} ${mix}%, var(--mid))`,
    color: mix > 55 ? "#fff" : "var(--ink)",
  };
}

function Grid({ cells, gapMode, title, minN }: { cells: GridCell[]; gapMode: boolean; title: string; minN: number }) {
  const rows = [...new Set(cells.map((c) => c.minEdge))];
  return (
    <div className="grid-panel">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th>{gapMode ? "Rank gap ≥" : "Edge >"}</th>
              {GRID_RELIABILITY.map((r) => (
                <th key={String(r)}>{r === null ? "Any" : `≤ ${r}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e}>
                <th>{e}</th>
                {cells
                  .filter((c) => c.minEdge === e)
                  .map((c) => {
                    const n = c.record.wins + c.record.losses;
                    // Too few bets: leave the cell blank so noise can't read as a signal.
                    if (n < minN)
                      return (
                        <td key={String(c.maxReliability)} className="blank" title={`Only ${n} bets (minimum ${minN})`}>
                          <div className="heat-n">n {n}</div>
                        </td>
                      );
                    return (
                      <td
                        key={String(c.maxReliability)}
                        style={cellStyle(c)}
                        title={`${c.record.wins}-${c.record.losses}-${c.record.pushes}, 95% range ${pct(c.record.lo)}–${pct(c.record.hi)}`}
                      >
                        <div className="heat-pct">{pct(c.record.pct)}</div>
                        <div className="heat-n">n {n}</div>
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A logged pick as a prediction, graded at the number available when it was logged (the
 * sportsbook median when the odds feed was on). Picks logged before the play-by-play model
 * existed have no `pbp` entry, so rules using that model skip them.
 */
function fromLog(lp: PickSnapshot, g: Game): Prediction {
  return {
    game: { ...g, line: lp.bookLine ?? lp.line, total: lp.bookTotal ?? lp.total },
    market: lp.market,
    pbp: lp.pbp as SidePrediction,
    qbAdj: lp.qbAdj ?? 0,
    components: lp.components as ComponentDiffs,
    reliability: lp.reliability,
    totalReliability: lp.totalReliability,
    coverRanks: lp.coverRanks,
    minGames: lp.minGames,
    qb: lp.qb ?? null,
  };
}

/**
 * Closing line value in points: how far the closing number moved toward the side we took.
 * Positive means we got a better number than the market closed at.
 */
function clv(bet: Bet, closing: Game): number | null {
  const taken = bet.prediction.game;
  if (bet.side === "home" || bet.side === "away") {
    if (closing.line === null || taken.line === null) return null;
    return bet.side === "home" ? closing.line - taken.line : taken.line - closing.line;
  }
  if (closing.total === null || taken.total === null) return null;
  return bet.side === "over" ? closing.total - taken.total : taken.total - closing.total;
}

function ClvLine({ c }: { c: { n: number; avg: number; beat: number; same: number } | null }) {
  if (!c) return <span className="muted">none yet (needs logged games that have closed)</span>;
  return (
    <>
      {c.avg >= 0 ? "+" : "−"}
      {Math.abs(c.avg).toFixed(2)} pts per bet; beat the close on {pct(c.beat, 0)} of {c.n} (same number{" "}
      {pct(c.same, 0)})
    </>
  );
}

/** Grades logged (pre-kickoff) picks using the line available when they were logged. */
function useLiveRecord(strategy: Strategy) {
  const { pickLog, data } = useApp();
  return useMemo(() => {
    if (!pickLog || !data) return null;
    const games = new Map(data.games.map((g) => [g.id, g]));
    const bets: { p: Prediction; result: 1 | 0 | 0.5 | null; label: string; clv: number | null }[] = [];
    // CLV had you bet this rule when each game was first logged (usually right after the previous
    // week): the line has most of the week to move, so this is the informative version.
    const earlyClvs: number[] = [];
    for (const lp of pickLog.picks) {
      const g = games.get(lp.id);
      if (!g) continue;
      if (lp.first && isFinal(g)) {
        const early = betFor(fromLog(lp.first, g), { ...strategy, fromSeason: 0, toSeason: 9999 });
        const v = early ? clv(early, g) : null;
        if (v !== null) earlyClvs.push(v);
      }
      const p = fromLog(lp, g);
      const bet = betFor(p, { ...strategy, fromSeason: 0, toSeason: 9999 });
      if (!bet) continue;
      const label =
        bet.side === "home" || bet.side === "away"
          ? `${bet.side === "home" ? g.home : g.away} (${lineLabel(g.home, g.away, p.game.line!)})`
          : `${bet.side === "over" ? "Over" : "Under"} ${p.game.total}`;
      // nflverse's line becomes the closing line once the game has been played.
      bets.push({ p, result: bet.result, label, clv: isFinal(g) ? clv(bet, g) : null });
    }
    const graded = bets.filter((b) => b.result !== null);
    const rec = record(
      graded.filter((b) => b.result === 1).length,
      graded.filter((b) => b.result === 0).length,
      graded.filter((b) => b.result === 0.5).length,
    );
    const summarize = (clvs: number[]) =>
      clvs.length
        ? {
            n: clvs.length,
            avg: clvs.reduce((s, v) => s + v, 0) / clvs.length,
            beat: clvs.filter((v) => v > 0).length / clvs.length,
            same: clvs.filter((v) => v === 0).length / clvs.length,
          }
        : null;
    return {
      bets,
      rec,
      clv: summarize(bets.flatMap((b) => (b.clv === null ? [] : [b.clv]))),
      earlyClv: summarize(earlyClvs),
      since: pickLog.picks[0]?.date ?? null,
    };
  }, [pickLog, data, strategy]);
}

/** Backtest and live record for the tracked "big edge, no QB change" idea. */
/** Backtest, live record, and line-movement check for the tracked "line + components" idea. */
function LinePlusComponentsIdea({ preds }: { preds: Prediction[] }) {
  const { data, pickLog } = useApp();
  const result = useMemo(() => {
    const tally = (rs: (1 | 0 | 0.5 | null)[]) =>
      record(rs.filter((r) => r === 1).length, rs.filter((r) => r === 0).length, rs.filter((r) => r === 0.5).length);
    const hist = (from: number, to: number) =>
      tally(
        preds
          .filter((p) => isFinal(p.game) && p.game.season >= from && p.game.season <= to)
          .map((p) => linePlusComponentsBet(p)?.result ?? null)
          .filter((r) => r !== null),
      );
    const games = new Map(data!.games.map((g) => [g.id, g]));
    const live: { lp: LoggedPick; bet: NonNullable<ReturnType<typeof linePlusComponentsBet>> }[] = [];
    // Line movement: did the line move from when we logged it to the close in the direction the
    // components pointed? Every logged game counts here, not just the bets.
    let agree = 0;
    let moved = 0;
    let closed = 0;
    let towardSum = 0;
    for (const lp of pickLog?.picks ?? []) {
      const g = games.get(lp.id);
      // Measured from the first time each game was logged, so the line has most of the week to move.
      const snap = lp.first ?? lp;
      if (!g || !snap.components) continue;
      const p = fromLog(snap, g);
      const bet = linePlusComponentsBet(p);
      if (bet) live.push({ lp, bet });
      if (isFinal(g) && g.line !== null && p.game.line !== null) {
        closed++;
        const move = g.line - p.game.line;
        const adj = lineAdjustment(snap.components);
        if (move !== 0 && adj !== 0) {
          moved++;
          if (Math.sign(move) === Math.sign(adj)) agree++;
        }
        towardSum += Math.sign(adj) * move;
      }
    }
    return {
      early: hist(2003, 2015),
      late: hist(2016, 9999),
      live,
      liveRecord: tally(live.map((x) => x.bet.result).filter((r) => r !== null)),
      movement: { closed, moved, agree, avgToward: closed ? towardSum / closed : 0 },
    };
  }, [preds, data, pickLog]);
  const line = (r: BetRecord) =>
    r.wins + r.losses ? `${r.wins}–${r.losses}–${r.pushes} · ${pct(r.pct)} (95% range ${pct(r.lo)}–${pct(r.hi)})` : "no bets";
  const w = LINE_PLUS_COMPONENTS.weights;
  const m = result.movement;
  return (
    <section className="card">
      <h2>Tracked, not bet: closing line + efficiency components</h2>
      <p className="muted small">
        How far pass/rush offense/defense efficiency says the line is off, with weights learned on 2003–2015: rush
        offense {w.rushOff}, rush defense {w.rushDef}, pass offense {w.passOff}, pass defense {w.passDef}. Rush
        offense got positive weight and pass defense negative weight in every period tested. That suggests the
        market underweights rushing efficiency and overreacts to pass defense. Across 2016 onward it improved on
        the closing line only slightly (margin RMSE 12.709 → 12.694), and not significantly. The bet backs the
        favored side when the adjustment exceeds {LINE_PLUS_COMPONENTS_MIN} point. That threshold was picked after
        seeing 2016+ results, so only the live record below is a clean test.
      </p>
      <table className="data compact">
        <tbody>
          <tr><td>Backtest 2003–2015 (weights fitted here)</td><td>{line(result.early)}</td></tr>
          <tr><td>Backtest 2016–now (threshold chosen here)</td><td>{line(result.late)}</td></tr>
          <tr><td><strong>Live (bet at the first-logged line)</strong></td><td><strong>{line(result.liveRecord)}</strong></td></tr>
          <tr>
            <td><strong>Line movement toward the adjustment, first log to close</strong></td>
            <td>
              {m.moved ? (
                <>
                  {pct(m.agree / m.moved)} of {m.moved} logged games whose line moved went in the components&apos;
                  direction; average move {m.avgToward >= 0 ? "+" : "−"}
                  {Math.abs(m.avgToward).toFixed(2)} pts toward them ({m.closed} games closed)
                </>
              ) : (
                <span className="muted">none yet (needs logged games that have closed)</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        The line-movement row is the fastest honest test: it covers every logged game, not just bets. If the market
        really underprices rushing efficiency, lines should drift toward the adjustment well over half the time.
      </p>
      {result.live.length > 0 && (
        <table className="data compact">
          <tbody>
            {result.live.slice(-10).reverse().map(({ lp, bet }) => (
              <tr key={lp.id}>
                <td>{teamName(lp.away)} at {teamName(lp.home)}</td>
                <td>
                  {bet.side === "home" ? lp.home : lp.away} ({lineLabel(lp.home, lp.away, (lp.first ?? lp).bookLine ?? (lp.first ?? lp).line)}), adjustment{" "}
                  {bet.adj >= 0 ? "+" : "−"}
                  {Math.abs(bet.adj).toFixed(1)}
                </td>
                <td>
                  {bet.result === null ? (
                    <span className="muted">Pending</span>
                  ) : (
                    <span className={`result ${bet.result === 1 ? "won" : bet.result === 0 ? "lost" : "push"}`}>
                      {bet.result === 1 ? "Won" : bet.result === 0 ? "Lost" : "Push"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TrackedIdea({ preds }: { preds: Prediction[] }) {
  const { data, pickLog } = useApp();
  const result = useMemo(() => {
    const tally = (bets: (1 | 0 | 0.5 | null)[]) =>
      record(bets.filter((b) => b === 1).length, bets.filter((b) => b === 0).length, bets.filter((b) => b === 0.5).length);
    const hist = preds.filter((p) => isFinal(p.game) && p.game.season >= 2002);
    const results = (from: number, to: number) =>
      tally(
        hist
          .filter((p) => p.game.season >= from && p.game.season <= to)
          .map((p) => bigEdgeNoQb(p)?.result ?? null)
          .filter((r) => r !== null),
      );
    const games = new Map(data!.games.map((g) => [g.id, g]));
    const live = (pickLog?.picks ?? []).flatMap((lp) => {
      const g = games.get(lp.id);
      if (!g) return [];
      const bet = bigEdgeNoQb(fromLog(lp, g));
      return bet ? [{ lp, bet }] : [];
    });
    return {
      all: results(2002, 9999),
      early: results(2002, 2014),
      late: results(2015, 9999),
      live,
      liveRecord: tally(live.map((x) => x.bet.result).filter((r) => r !== null)),
    };
  }, [preds, data, pickLog]);
  const line = (r: BetRecord) =>
    r.wins + r.losses ? `${r.wins}–${r.losses}–${r.pushes} · ${pct(r.pct)} (95% range ${pct(r.lo)}–${pct(r.hi)})` : "no bets";
  return (
    <section className="card">
      <h2>Tracked, not bet: big edge with no QB change</h2>
      <p className="muted small">
        Market model sides where the model and the line disagree by more than 6 points and neither team changed
        starting QB from its previous game. Most big edges come from QB changes the model can't see; this is what's
        left. It was found by slicing the data, so it's fixed here (no settings) and watched until the live record
        says whether it's real. Uses the default model settings.
      </p>
      <table className="data compact">
        <tbody>
          <tr><td>Backtest 2002–2014</td><td>{line(result.early)}</td></tr>
          <tr><td>Backtest 2015–now</td><td>{line(result.late)}</td></tr>
          <tr><td>Backtest, all</td><td>{line(result.all)}</td></tr>
          <tr><td><strong>Live (logged before kickoff)</strong></td><td><strong>{line(result.liveRecord)}</strong></td></tr>
        </tbody>
      </table>
      {result.live.length > 0 && (
        <table className="data compact">
          <tbody>
            {result.live.slice(-10).reverse().map(({ lp, bet }) => (
              <tr key={lp.id}>
                <td>{teamName(lp.away)} at {teamName(lp.home)}</td>
                <td>{bet.side === "home" ? lp.home : lp.away} ({lineLabel(lp.home, lp.away, lp.bookLine ?? lp.line)}), edge {num(Math.abs(bet.edge))}</td>
                <td>{bet.result === null ? <span className="muted">Pending</span> : <span className={`result ${bet.result === 1 ? "won" : bet.result === 0 ? "lost" : "push"}`}>{bet.result === 1 ? "Won" : bet.result === 0 ? "Lost" : "Push"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function LabPage() {
  const { run, strategies, setStrategy } = useApp();
  const [params, setParams] = useSearchParams();
  const kind: BetKind = params.get("bet") === "total" ? "total" : "spread";
  const preds = run!.predictions;
  const s = strategies[kind];
  const gapMode = s.pick !== "model";
  const set = (patch: Partial<Strategy>) => setStrategy(kind, { ...s, ...patch });
  const [minN, setMinN] = useState(100);

  const lastSeason = preds.filter((p) => isFinal(p.game)).at(-1)?.game.season ?? 2026;
  const from = Math.max(2002, s.fromSeason);
  const to = Math.min(lastSeason, s.toSeason);
  const mid = Math.floor((from + to) / 2);

  const result = useMemo(() => evaluate(preds, s), [preds, s]);
  const grids = useMemo(() => {
    const steps = gapMode ? GAP_STEPS : EDGE_STEPS;
    return [
      { title: `${from}–${mid}`, cells: strategyGrid(preds, { ...s, fromSeason: from, toSeason: mid }, steps, GRID_RELIABILITY) },
      { title: `${mid + 1}–${to}`, cells: strategyGrid(preds, { ...s, fromSeason: mid + 1, toSeason: to }, steps, GRID_RELIABILITY) },
    ];
  }, [preds, s, gapMode, from, mid, to]);
  const acc = useMemo(
    () => ({
      spread: accuracy(preds, s.model, "spread", from, to),
      total: accuracy(preds, s.model, "total", from, to),
    }),
    [preds, s.model, from, to],
  );
  const live = useLiveRecord(s);
  const recent = useMemo(() => evaluate(preds, { ...s, fromSeason: 2015 }).overall, [preds, s]);
  const earlier = useMemo(() => evaluate(preds, { ...s, toSeason: 2014 }).overall, [preds, s]);
  const v = verdict(result.overall);
  const o = result.overall;

  return (
    <>
      <div className="page-head">
        <h1>Strategy lab</h1>
        <p className="muted">
          Every game from {from} on is predicted using only information from before it was played, then graded
          against the closing line. Break-even at standard −110 odds is <strong>{pct(BREAK_EVEN)}</strong>. There are
          two rules, one for sides and one for totals. Each drives its own pick column on the This week page.
        </p>
      </div>

      <div className="tabs" role="tablist" aria-label="Bet type">
        {(["spread", "total"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? "active" : ""}
            onClick={() => setParams(k === "total" ? { bet: "total" } : {})}
          >
            {k === "spread" ? "Sides" : "Totals"}
          </button>
        ))}
      </div>

      <div className="controls wrap">
        {kind === "spread" && (
          <label>
            Pick{" "}
            <select
              value={s.pick}
              onChange={(e) =>
                set({ pick: e.target.value as Strategy["pick"], ...(e.target.value !== "model" ? { minEdge: Math.max(1, s.minEdge) } : {}) })
              }
            >
              <option value="model">Model vs line</option>
              <option value="highVariance">High-variance team</option>
              <option value="lowVariance">Low-variance team</option>
            </select>
          </label>
        )}
        <label>
          Model{" "}
          <select value={s.model} disabled={gapMode} onChange={(e) => set({ model: e.target.value as Strategy["model"] })}>
            <option value="pbp">Play-by-play</option>
            <option value="market">Market</option>
          </select>
        </label>
        <label>
          {gapMode ? "Min rank gap" : "Min edge (pts)"}{" "}
          <input
            type="number"
            min={0}
            step={gapMode ? 1 : 0.5}
            value={s.minEdge}
            onChange={(e) => set({ minEdge: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label title={kind === "total" ? "Sum of both teams' over/under consistency ranks" : "Sum of both teams' cover consistency ranks"}>
          Max reliability{" "}
          <select
            value={s.maxReliability ?? ""}
            onChange={(e) => set({ maxReliability: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">Any</option>
            {RELIABILITY_OPTIONS.map((r) => (
              <option key={r} value={r}>
                ≤ {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min games{" "}
          <input type="number" min={0} value={s.minGames} onChange={(e) => set({ minGames: Math.max(0, Number(e.target.value)) })} />
        </label>
        <label className="check" title="Skip games where either team's starter differs from its previous game (or isn't listed yet)">
          <input type="checkbox" checked={!!s.skipQbChange} onChange={(e) => set({ skipQbChange: e.target.checked })} /> Skip QB changes
        </label>
        <label>
          Seasons{" "}
          <input type="number" min={2002} max={lastSeason} value={from} onChange={(e) => set({ fromSeason: Number(e.target.value) })} />
          –
          <input type="number" min={2002} max={lastSeason} value={to} onChange={(e) => set({ toSeason: Number(e.target.value) })} />
        </label>
        <button type="button" className="link" onClick={() => setStrategy(kind, DEFAULT_STRATEGIES[kind])}>
          Reset
        </button>
      </div>

      {kind === "total" && (
        <div className={`callout ${s.enabled === false ? "" : "bad"}`}>
          <label className="check">
            <input type="checkbox" checked={s.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />{" "}
            <strong>Show totals picks on This week</strong>
          </label>
          <div className="small">
            Off by default: totals rules have done worse since 2015 than before. This rule since 2015:{" "}
            {recent.wins}–{recent.losses} ({pct(recent.pct)}); before: {earlier.wins}–{earlier.losses} (
            {pct(earlier.pct)}). The backtest below and the live record still work while it's off.
          </div>
        </div>
      )}

      <div className="tiles">
        <StatTile label="Record" value={`${o.wins}–${o.losses}–${o.pushes}`} note={strategySummary(s)} />
        <StatTile label="Win rate" value={pct(o.pct)} note={`95% range ${pct(o.lo)} to ${pct(o.hi)}`} />
        <StatTile label="Units at −110" value={`${o.units >= 0 ? "+" : "−"}${Math.abs(o.units).toFixed(1)}`} note="risking 1.1 to win 1 per bet" />
        <StatTile label="Verdict" value={<span className={`verdict ${v.tone}`}>{v.text}</span>} />
      </div>

      <section className="card">
        <h2>Win rate by season</h2>
        <DivergingColumns
          data={result.bySeason.map((r) => ({
            key: String(r.season).slice(2),
            value: r.pct,
            title: String(r.season),
            rows: [
              { label: "win rate", value: pct(r.pct) },
              { label: "record", value: `${r.wins}–${r.losses}–${r.pushes}` },
            ],
          }))}
          baseline={BREAK_EVEN}
          domain={[0.3, 0.7]}
          format={(v) => pct(v, 0)}
          refLabel="break-even 52.4%"
          height={200}
        />
      </section>

      <section className="card">
        <h2>{gapMode ? "Rank gap" : "Edge"} × reliability, split into two eras</h2>
        <p className="muted small">
          Holding your other filters fixed. Blue beats break-even and red loses to it, with full color at ±6 points.
          Cells with fewer bets than the minimum are left blank. A real effect should look similar in both eras;
          a lone bright cell is usually luck.
        </p>
        <div className="controls">
          <label>
            Minimum bets per cell{" "}
            <select value={minN} onChange={(e) => setMinN(Number(e.target.value))}>
              {MIN_N_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grids">
          {grids.map((g) => (
            <Grid key={g.title} cells={g.cells} gapMode={gapMode} title={g.title} minN={minN} />
          ))}
        </div>
      </section>

      {kind === "spread" && <TrackedIdea preds={preds} />}
      {kind === "spread" && <LinePlusComponentsIdea preds={preds} />}

      <div className="two-col">
        <section className="card">
          <h2>Live record</h2>
          {!live || live.bets.length === 0 ? (
            <p className="muted">
              No logged picks match this rule yet. The nightly job logs each upcoming game's prediction before
              kickoff. Those entries are never recomputed, so this becomes a true out-of-sample record.
            </p>
          ) : (
            <>
              <p className="muted small">
                Picks logged since {live.since ? shortDate(live.since) : "–"} with default model settings, graded at
                the line available when logged (sportsbook median when the odds feed is on).
              </p>
              <p>
                <strong>
                  {live.rec.wins}–{live.rec.losses}–{live.rec.pushes}
                </strong>
                {live.rec.wins + live.rec.losses > 0 && <> · {pct(live.rec.pct)}</>}
              </p>
              <table className="data compact">
                <tbody>
                  <tr>
                    <td>
                      <strong>Closing line value, bet when first logged</strong>
                    </td>
                    <td><ClvLine c={live.earlyClv} /></td>
                  </tr>
                  <tr>
                    <td>Closing line value, bet on game morning</td>
                    <td><ClvLine c={live.clv} /></td>
                  </tr>
                </tbody>
              </table>
              <p className="muted small">
                Closing line value compares the number you'd have bet with where the market closed. It's a
                faster check than wins and losses: after a few hundred bets, a real edge shows up as consistently
                positive CLV. The first-logged version is the informative one (the line has most of the week to
                move); by game morning there are only hours left, so that version sits near zero. The closing
                number is nflverse's, which can differ from the books' median by a half point.
              </p>
              <table className="data compact">
                <tbody>
                  {live.bets.slice(-12).reverse().map((b) => (
                    <tr key={b.p.game.id}>
                      <td>
                        {teamName(b.p.game.away)} at {teamName(b.p.game.home)}
                      </td>
                      <td>{b.label}</td>
                      <td>
                        {b.result === null ? (
                          <span className="muted">Pending</span>
                        ) : (
                          <span className={`result ${b.result === 1 ? "won" : b.result === 0 ? "lost" : "push"}`}>
                            {b.result === 1 ? "Won" : b.result === 0 ? "Lost" : "Push"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
        <section className="card">
          <h2>Prediction accuracy, {from}–{to}</h2>
          <p className="muted small">Average miss vs the actual result (RMSE, points). Lower is better.</p>
          <table className="data compact">
            <thead>
              <tr>
                <th />
                <th className="num">{s.model === "market" ? "Market" : "Play-by-play"}</th>
                <th className="num">Closing line</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Margin</td>
                <td className="num">{num(acc.spread.rmseModel, 2)}</td>
                <td className="num">{num(acc.spread.rmseLine, 2)}</td>
              </tr>
              <tr>
                <td>Total points</td>
                <td className="num">{num(acc.total.rmseModel, 2)}</td>
                <td className="num">{num(acc.total.rmseLine, 2)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            If the closing line misses by less than the model, the market already knows more than the model on
            average. Any edge has to come from specific situations.
          </p>
        </section>
      </div>

      <section className="card">
        <h2>What the backtests have shown so far</h2>
        <ul className="findings">
          <li>
            The spreadsheet rule (bet when the model disagrees with the line) wins about 50.5–51% on its own, whatever
            the edge threshold.
          </li>
          <li>
            The default sides rule (Market model, both teams ≥ 8 games, reliability ≤ 24, no QB changes, any edge)
            was chosen for reasons rather than tuned, and is fixed for the 2026 season: 50.7% over 883 bets in
            2002–2026 (48.2% before 2015, 53.7% since). The play-by-play model under the same rule: 52.0% (51.1%,
            then 53.0%). Both are around break-even, so treat them as paper trading until the live record and
            closing line value say otherwise.
          </li>
          <li>
            Play-by-play efficiency added almost nothing once closing lines were in: on 2016 onward, margin error
            was 12.90 for Market and 12.91 for play-by-play, vs 12.71 for the closing line. The real gain from
            play-by-play data was the QB adjustment, which cut error on QB-change games from 13.85 to 13.44.
            A model built only from play-by-play, with no lines, did worse (13.22) than one built only from final
            margins (13.00).
          </li>
          <li>
            Before the QB adjustment, the Market model's biggest edges were mostly QB changes it couldn't see (69% of edges over 6 points), so
            skipping those games removes uninformed picks. It doesn't create an edge by itself. Edge cutoffs
            between 1.5 and 3 points didn't help this model either.
          </li>
          <li>
            Reliability only means something once both teams have played at least ~8 games under their coach.
            Before that, a near-zero SD makes thin samples look like the steadiest teams. With that filter,
            reliability ≤ ~24 has been the most promising lead: about 52% overall, and 53–54% since 2015 but only
            about 51% before. The 95% range still includes break-even, and the rule came out of a search over
            many combinations, so the live record is the real test.
          </li>
          <li>Betting the high- or low-variance team (sides only) shows no consistent edge at any rank gap.</li>
          <li>Totals did well before 2014 and badly since. Large model edges on totals have lost recently.</li>
          <li>
            Coach resets: for the Market model, carrying some prior-regime evidence forward predicts better than a
            hard reset. Keeping all history predicted best of all. Compare them yourself in Model settings.
          </li>
        </ul>
      </section>
    </>
  );
}
