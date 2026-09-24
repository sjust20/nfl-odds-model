import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DivergingColumns } from "../components/charts";
import { isFinal } from "../data/types";
import { num, pct } from "../format";
import type { Prediction } from "../model/engine";
import { BREAK_EVEN, evaluate, record, type BetRecord, type Strategy } from "../model/metrics";
import { BIG_EDGE_NO_QB, LINE_PLUS_COMPONENTS_MIN, linePlusComponentsBet } from "../model/tracked";
import { useApp } from "../state";
import { AdvancedLab, useLiveRecord } from "./LabPage";
import { ruleRecord, type RuleRecord } from "./useWeek";

const recordText = (r: BetRecord) => `${r.wins}–${r.losses}${r.pushes ? `–${r.pushes}` : ""}`;
const MODEL_NAME = { market: "Market model", pbp: "Play-by-play model" } as const;

function verdictOf(r: BetRecord): { tone: "good" | "warn" | "bad"; title: string; text: string } {
  const range = `95% range ${pct(r.lo)}–${pct(r.hi)}`;
  if (r.wins + r.losses < 30) return { tone: "warn", title: "Too few bets to judge.", text: `Only ${r.wins + r.losses} graded bets.` };
  if (r.lo > BREAK_EVEN) return { tone: "good", title: "Beating break-even.", text: `Even the low end of the ${range} clears ${pct(BREAK_EVEN)}.` };
  if (r.hi < BREAK_EVEN) return { tone: "bad", title: "Losing.", text: `Even the high end of the ${range} is under ${pct(BREAK_EVEN)}.` };
  return {
    tone: "warn",
    title: "Not proven yet.",
    text: `The ${range} includes the ${pct(BREAK_EVEN)} break-even, so this record could be luck either way.`,
  };
}

/** Plain-language cards for each part of a rule, generated from its settings. */
function ruleParts(s: Strategy): { rule: string; body: string }[] {
  const out: { rule: string; body: string }[] = [
    {
      rule: MODEL_NAME[s.model],
      body:
        s.model === "market"
          ? "Rates teams by how the market has priced them under their current coach, adjusted for results and starting QB."
          : "Starts from the Market model's number and adds pass and rush efficiency on both sides of the ball.",
    },
  ];
  if (s.minGames > 0)
    out.push({ rule: `${s.minGames}+ games`, body: `Both teams need ${s.minGames} games under their current head coach. History resets when the coach changes, interim coaches included.` });
  if (s.skipQbChange)
    out.push({ rule: "Same QBs", body: "Skip games where either team starts a different QB than last game. The ratings can't fully see that change." });
  if (s.maxReliability !== null)
    out.push({ rule: `Reliability ≤ ${s.maxReliability}`, body: "Both teams must miss the line by steady amounts. Erratic teams make any rating noisy." });
  out.push({
    rule: s.minEdge > 0 ? `Edge > ${num(s.minEdge)}` : "Any disagreement",
    body:
      s.minEdge > 0
        ? `Only bet when the model and line differ by more than ${num(s.minEdge)} pts.`
        : "Take whichever side the model prefers, however small the gap. Bigger gaps weren't better: they're mostly news the model hasn't seen.",
  });
  return out;
}

function Seg<T extends string | number | null | boolean>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="stack-sm" style={{ gap: 6 }}>
      <div className="subhead">{label}</div>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function EraStats({ r }: { r: RuleRecord }) {
  return (
    <>
      {([["All seasons since 2002", r.all], ["2002–2014", r.pre], ["2015 on", r.post]] as const).map(([k, rec]) => (
        <div className="stat" key={k}>
          <div className="k">{k}</div>
          <div className={`v ${rec.lo > BREAK_EVEN ? "good" : rec.hi < BREAK_EVEN ? "bad" : ""}`}>{pct(rec.pct)}</div>
          <div className="n">
            {recordText(rec)} · {rec.units >= 0 ? "+" : ""}
            {num(rec.units)} units
          </div>
        </div>
      ))}
    </>
  );
}

function Variation({ preds, rule, base }: { preds: Prediction[]; rule: Strategy; base: RuleRecord }) {
  const { setStrategy } = useApp();
  const [v, setV] = useState<Strategy>(rule);
  const r = useMemo(() => ruleRecord(preds, v), [preds, v]);
  const set = <K extends keyof Strategy>(k: K) => (x: Strategy[K]) => setV({ ...v, [k]: x });
  const verdict = verdictOf(r.all);
  const delta = (r.all.pct - base.all.pct) * 100;
  const same = JSON.stringify(v) === JSON.stringify(rule);
  return (
    <section className="group">
      <div className="group-head">
        <span className="title">Test a variation</span>
        <span className="count">sides</span>
        <span className="why">
          Change one part and see the full backtest. Trying many settings until one looks good is how backtests lie, so
          a better number here is weak evidence on its own.
        </span>
      </div>
      <div className="variation">
        <div>
          <Seg label="Model" value={v.model} options={[["market", "Market"], ["pbp", "Play-by-play"]]} onChange={set("model")} />
          <Seg label="Reliability limit" value={v.maxReliability} options={[[16, "16"], [24, "24"], [32, "32"], [null, "Any"]]} onChange={set("maxReliability")} />
          <Seg label="Games under coach" value={v.minGames} options={[[0, "0"], [8, "8"], [16, "16"]]} onChange={set("minGames")} />
          <Seg label="QB changes" value={!!v.skipQbChange} options={[[true, "Skip"], [false, "Include"]]} onChange={set("skipQbChange")} />
          <Seg label="Minimum disagreement (pts)" value={v.minEdge} options={[[0, "Any"], [1, "1"], [2, "2"], [3, "3"]]} onChange={set("minEdge")} />
        </div>
        <div>
          <div className="stat-strip">
            <EraStats r={r} />
          </div>
          <div className="small">
            {same ? (
              "This is the current rule."
            ) : (
              <>
                {Math.abs(delta) < 0.05 ? "Same win rate as" : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta).toFixed(1)} percentage points from`} the
                current rule, over {r.all.wins + r.all.losses} bets instead of {base.all.wins + base.all.losses} (about{" "}
                {r.perWeek.toFixed(1)} a week).
              </>
            )}
          </div>
          <div className={`verdict-box ${verdict.tone}`}>
            <strong>{verdict.title}</strong> {verdict.text}
          </div>
          {!same && (
            <div>
              <button type="button" onClick={() => setStrategy("spread", { ...rule, ...v })}>
                Make this the active rule
              </button>{" "}
              <button type="button" onClick={() => setV(rule)}>
                Reset
              </button>
              <div className="muted small" style={{ marginTop: 6 }}>
                Saved in this browser only. It changes the picks on This week and how the live log is scored here.
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function useWatchList(preds: Prediction[]) {
  return useMemo(() => {
    const tally = (rs: (1 | 0 | 0.5 | null)[]) =>
      record(rs.filter((x) => x === 1).length, rs.filter((x) => x === 0).length, rs.filter((x) => x === 0.5).length);
    const big = evaluate(preds, { ...BIG_EDGE_NO_QB, fromSeason: 2002 }).overall;
    // Weights were learned on 2003-2015, so only later seasons are out of sample.
    const lpc = tally(
      preds.filter((p) => isFinal(p.game) && p.game.season >= 2016).map((p) => linePlusComponentsBet(p)?.result ?? null).filter((x) => x !== null),
    );
    return { big, lpc };
  }, [preds]);
}

export function LabPage() {
  const { run, strategies } = useApp();
  const preds = run!.predictions;
  const s = strategies.spread;
  const r = useMemo(() => ruleRecord(preds, s), [preds, s]);
  const seasons = useMemo(() => evaluate(preds, { ...s, fromSeason: 2002, toSeason: 2100 }).bySeason, [preds, s]);
  const live = useLiveRecord(s);
  const watch = useWatchList(preds);
  const verdict = verdictOf(r.all);
  const totalsOn = strategies.total.enabled !== false;

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Strategy lab · sides rule · backtest 2002 to now</div>
        <h1 className="hero-title small">
          Is the rule any good? <span className={verdict.tone === "good" ? "" : "warn-accent"}>{verdict.title}</span>
        </h1>
        <p className="lede">
          Every game since 2002 is predicted using only what was known before it, then graded against the closing line.
          At standard −110 odds you need {pct(BREAK_EVEN)} to break even. {verdict.text}
        </p>
      </div>

      <div className="stat-strip">
        <EraStats r={r} />
        <div className="stat dark">
          <div className="k">Live, logged before kickoff</div>
          <div className="v">{live && live.rec.wins + live.rec.losses ? recordText(live.rec) : "—"}</div>
          <div className="n">
            {live?.earlyClv
              ? `Closing line value ${live.earlyClv.avg > 0 ? "+" : ""}${num(live.earlyClv.avg, 2)} pts per pick`
              : "No graded picks yet"}
          </div>
        </div>
      </div>

      <section className="stack-sm">
        <h2 className="section-title">Win rate by season</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Bars above the line beat break-even. Single seasons swing a lot; look for a lasting run, not a good year.
        </p>
        <div className="card">
          <DivergingColumns
            data={seasons.map((x) => ({
              key: String(x.season).slice(2),
              value: x.pct,
              title: String(x.season),
              rows: [
                { label: "win rate", value: pct(x.pct) },
                { label: "record", value: recordText(x) },
              ],
            }))}
            baseline={BREAK_EVEN}
            domain={[0.25, 0.75]}
            format={(x) => pct(x, 0)}
            refLabel="break-even 52.4%"
          />
        </div>
      </section>

      <section className="stack-sm">
        <h2 className="section-title">The rule, part by part</h2>
        <div className="card-grid">
          {ruleParts(s).map((c) => (
            <div className="mini-card" key={c.rule}>
              <div className="rule">{c.rule}</div>
              <div className="body">{c.body}</div>
            </div>
          ))}
        </div>
      </section>

      <Variation key={JSON.stringify(s)} preds={preds} rule={s} base={r} />

      <section className="stack-sm">
        <h2 className="section-title">On watch, not bet</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Ideas found by slicing the data. They're fixed in place and tracked live until there's enough evidence either way.
        </p>
        <div className="card-grid">
          <div className="mini-card">
            <div className="rule">Big disagreement, same QBs</div>
            <div className="body">
              Market model differs from the line by more than {BIG_EDGE_NO_QB.minEdge} pts and neither team changed QB.
              Backtest {recordText(watch.big)} ({pct(watch.big.pct)}).
            </div>
          </div>
          <div className="mini-card">
            <div className="rule">Line + efficiency</div>
            <div className="body">
              Adjusts the closing line with pass and rush efficiency; bets when the adjustment tops{" "}
              {LINE_PLUS_COMPONENTS_MIN} pt. Since 2016, out of sample: {recordText(watch.lpc)} ({pct(watch.lpc.pct)}).
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-title">What the research found</h2>
        <div style={{ marginTop: 10 }}>
          {[
            [
              "The closing line is the best predictor.",
              "Average miss on the final margin since 2016: closing line 12.71 pts, play-by-play model 12.85, Market model 12.89. Neither model beats the line; play-by-play gets closest.",
            ],
            [
              "Shopping for the best number helps.",
              "Taking the best line across ten books instead of the typical one is worth about 0.4 pts per bet early in the week, which is more than most filters add.",
            ],
            [
              "QB changes are where models miss most.",
              "The QB adjustment cuts the error on QB-change games from 13.85 to 13.34 pts. The rule still skips them: listed starters are wrong about 1 time in 15, and the adjustment was fit on the same history it's scored on.",
            ],
            [
              "Reliability needs a sample.",
              "Early in a coach's tenure, a team looks steady just because it has few games. Requiring 8 games under the coach guards against that.",
            ],
            [
              "Totals stopped working.",
              "The same filters on totals won 52.4% before 2015 and 45.8% since, so the totals rule is off.",
            ],
          ].map(([head, body]) => (
            <div className="finding" key={head}>
              <div className="head">{head}</div>
              <div className="body">{body}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="notice">
        <span className="badge">{totalsOn ? "TOTALS ON" : "TOTALS OFF"}</span>
        <span>
          {totalsOn
            ? "The totals rule is making picks in this browser. Its backtest is under Advanced."
            : "The totals rule makes no picks. Its backtest is still under Advanced."}{" "}
          Rating settings (half-life, coach carryover, QB weight) are in <Link to="/settings">Model settings</Link>.
        </span>
      </div>

      <details className="more">
        <summary>Advanced: rule editor, edge × reliability grids, tracked ideas in detail</summary>
        <AdvancedLab />
      </details>
    </div>
  );
}
