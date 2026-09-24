import { useState } from "react";
import { Link } from "react-router-dom";
import { nickname, teamName } from "../data/teams";
import { isFinal, type Game } from "../data/types";
import { kickoffLabel, num, pct, price, shortDate, teamSpread } from "../format";
import type { Prediction } from "../model/engine";
import { activeChecks, holdsUntil, type Check } from "../model/explain";
import { BREAK_EVEN, type Bet, type BetRecord, type Strategy } from "../model/metrics";
import { useApp } from "../state";
import { useLiveRecord } from "./LabPage";
import { bestNumber, useWeek, type RuleRecord, type WeekItem } from "./useWeek";
import { WeekDetail } from "./WeekDetail";

const GUIDE_KEY = "guide.dismissed.v1";
const MODEL_NAME = { market: "Market model", pbp: "Play-by-play model" } as const;
const ROUND_NAME: Record<Game["type"], string> = { REG: "", WC: "Wild Card", DIV: "Divisional", CON: "Conference", SB: "Super Bowl" };

const GROUPS: Record<Check, { title: string; why: (s: Strategy) => string }> = {
  history: {
    title: "Too early to trust",
    why: (s) => `A team has fewer than ${s.minGames} games under its current head coach, so its numbers are too thin to read.`,
  },
  qb: {
    title: "Quarterback changed",
    why: () => "A team starts a different QB than last game, or the starter isn't listed yet. The rule sits these out.",
  },
  reliability: {
    title: "Too erratic",
    why: (s) =>
      `These teams miss the line by wildly different amounts week to week. The rule needs a combined reliability rank of ${s.maxReliability} or less.`,
  },
  line: { title: "No line yet", why: () => "No sportsbook has posted a number for these games." },
  edge: {
    title: "Model agrees with the line",
    why: (s) =>
      s.minEdge > 0
        ? `The model is within ${num(s.minEdge)} pts of the line, which the rule doesn't count as a disagreement.`
        : "The model lands exactly on the line, so there's no side to take.",
  },
};

const ORDER: Check[] = ["history", "qb", "reliability", "line", "edge"];

function readGuideDismissed() {
  try {
    return localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function Guide() {
  const [hidden, setHidden] = useState(readGuideDismissed);
  if (hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      /* private mode: just hide for this visit */
    }
    setHidden(true);
  };
  return (
    <div className="guide" role="note">
      <p>
        New here? This page runs one fixed rule over every game and shows what it would pick, and why each other game
        was skipped. It's a paper-trade record, not a tip sheet.
      </p>
      <div className="btns">
        <Link className="btn-inverse" to="/how" onClick={close}>
          How it works
        </Link>
        <button type="button" className="btn-ghost-inverse" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}

const recordText = (r: BetRecord) => `${r.wins}–${r.losses}${r.pushes ? `–${r.pushes}` : ""}`;

/** Where each number sits on a shared axis. x = −line so the home favorite is on the left. */
function NumberLine({ p, model, bookLabel }: { p: Prediction; model: number; bookLabel: string }) {
  const book = p.game.line!;
  const span = Math.max(7, Math.abs(book) + 3, Math.abs(model) + 3);
  const x = (line: number) => `${((-line + span) / (2 * span)) * 100}%`;
  const [a, b] = [x(book), x(model)];
  const left = Math.min(parseFloat(a), parseFloat(b));
  const width = Math.abs(parseFloat(a) - parseFloat(b));
  return (
    <div>
      <div className="numline" aria-label={`${bookLabel} ${num(book)}, model ${num(model)}`}>
        <div className="track" />
        <div className="gap" style={{ left: `${left}%`, width: `${width}%` }} />
        <div className="tick" style={{ left: a, background: "var(--ink)" }} />
        <div className="tick" style={{ left: b, background: "var(--accent)" }} />
        <div className="tag-label" style={{ left: a }}>
          {bookLabel}
        </div>
        <div className="tag-label" style={{ left: b, color: "var(--accent)", top: 46 }}>
          Model
        </div>
      </div>
      <div className="numline-axis">
        <span>← {p.game.home} favored</span>
        <span>{p.game.away} favored →</span>
      </div>
    </div>
  );
}

function QbConflict({ g }: { g: Game }) {
  const { data } = useApp();
  const teams = data?.qbCheck?.teams ?? {};
  const bad = [g.away, g.home].filter((t) => teams[t] && !teams[t].agree && teams[t].espn);
  if (!bad.length) return null;
  return (
    <div className="warn-text small">
      {bad.map((t) => `${t}: listed ${teams[t].listed ?? "no one"}, ESPN has ${teams[t].espn}`).join(" · ")}. Check
      the starter before trusting this.
    </div>
  );
}

function PassedCheck({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="check">
      <div className="check-dot" aria-hidden>
        ✓
      </div>
      <div>
        <div className="check-title">{title}</div>
        <div className="check-body">{children}</div>
      </div>
    </div>
  );
}

function PickCard({ item, bet, s, rec }: { item: WeekItem; bet: Bet; s: Strategy; rec: RuleRecord }) {
  const { p, book } = item;
  const g = p.game;
  const spread = s.market === "spread";
  const side = bet.side as "home" | "away";
  const team = spread ? (side === "home" ? g.home : g.away) : "";
  const model = p[s.model];
  const label = spread
    ? `${nickname(team)} ${teamSpread(g.line!, side)}`
    : `${bet.side === "over" ? "Over" : "Under"} ${g.total}`;
  const hold = spread ? holdsUntil(p, s, side) : null;
  const best = spread ? bestNumber(book, side) : null;
  const checks = activeChecks(s);
  const final = isFinal(g);

  return (
    <article className="pick-card">
      <div className="pick-head">
        <span className="label">{spread ? "PICK · SIDE" : "PICK · TOTAL"}</span>
        <span>
          {teamName(g.away)} at {teamName(g.home)} · {kickoffLabel(g.date, g.time)}
        </span>
      </div>
      <div className="pick-grid">
        <div className="pick-main">
          <div>
            <div className="pick-bet">{label}</div>
            <div className="pick-sub">
              {spread ? (
                <>
                  The line has {nickname(team)} at <strong>{teamSpread(g.line!, side)}</strong>; the {MODEL_NAME[s.model]}{" "}
                  makes it <strong>{teamSpread(model.line, side)}</strong>, a {num(Math.abs(bet.edge))}-pt disagreement.
                </>
              ) : (
                <>
                  The total is <strong>{g.total}</strong>; the {MODEL_NAME[s.model]} makes it <strong>{num(model.total)}</strong>,
                  a {num(Math.abs(bet.edge))}-pt disagreement.
                </>
              )}
            </div>
          </div>
          {spread && <NumberLine p={p} model={model.line} bookLabel={book ? "Books" : "Line"} />}
          {hold && (
            <div className="small">
              Still a pick at <strong className="mono">{teamSpread(hold.worst, side)}</strong>; skip it at{" "}
              <strong className="mono">{teamSpread(hold.gone, side)}</strong> or worse.
              {best && (
                <>
                  {" "}
                  Best number now: <strong className="mono">{teamSpread(best.line, side)}</strong>
                  {best.price !== null && <span className="mono"> ({price(best.price)})</span>} at {best.title}.
                </>
              )}
            </div>
          )}
          {final && (
            <div className="small">
              Final: {g.away} {g.awayScore}, {g.home} {g.homeScore}.{" "}
              <strong className={`result ${bet.result === 1 ? "won" : bet.result === 0 ? "lost" : "push"}`}>
                {bet.result === 1 ? "Won" : bet.result === 0 ? "Lost" : "Push"}
              </strong>
            </div>
          )}
        </div>
        <div className="pick-side">
          <div className="subhead">Why it passed</div>
          {checks.includes("history") && (
            <PassedCheck title="Enough history">
              Both teams have {s.minGames}+ games under their current coach (fewest: {p.minGames}).
            </PassedCheck>
          )}
          {checks.includes("qb") && (
            <PassedCheck title="Same quarterbacks">
              {p.qb?.away?.name} and {p.qb?.home?.name} both started last game too.
            </PassedCheck>
          )}
          {checks.includes("reliability") && (
            <PassedCheck title="Steady teams">
              Reliability {spread ? p.reliability : p.totalReliability} (limit {s.maxReliability}): both teams miss the
              line by consistent amounts.
            </PassedCheck>
          )}
          {checks.includes("edge") && (
            <PassedCheck title="Real disagreement">
              The gap is more than the rule's {num(s.minEdge)}-pt minimum.
            </PassedCheck>
          )}
          <QbConflict g={g} />
          <div className="pick-foot">
            This rule since 2002: <span className="mono">{recordText(rec.all)}</span> ({pct(rec.all.pct)}); 2002–14{" "}
            {pct(rec.pre.pct)}, 2015 on {pct(rec.post.pct)}. Break-even is {pct(BREAK_EVEN)}.{" "}
            {rec.all.lo > BREAK_EVEN ? "" : "Not proven: that record is within luck of break-even."}
          </div>
        </div>
      </div>
    </article>
  );
}

function passNote(check: Check, p: Prediction, s: Strategy): string {
  const g = p.game;
  switch (check) {
    case "history":
      return `Fewest games under current coach: ${p.minGames} (${g.homeCoach} / ${g.awayCoach}).`;
    case "qb": {
      const q = p.qb;
      const parts = (["away", "home"] as const).flatMap((k) => {
        const qb = q?.[k];
        if (!qb) return [`${g[k]}: starter not listed`];
        return qb.changed ? [`${g[k]}: ${qb.name} (last game ${qb.prev})`] : [];
      });
      return parts.join(" · ");
    }
    case "reliability": {
      const r = s.market === "spread" ? p.reliability : p.totalReliability;
      return r === null ? "Not enough games to rank." : `Reliability ${r} (limit ${s.maxReliability}).`;
    }
    case "line":
      return "No number posted.";
    case "edge":
      return "";
  }
}

function PassGroup({ check, items, s }: { check: Check; items: WeekItem[]; s: Strategy }) {
  const { data } = useApp();
  const conflicts = data?.qbCheck?.teams ?? {};
  return (
    <section className="group">
      <div className="group-head">
        <span className="title">{GROUPS[check].title}</span>
        <span className="count">
          {items.length} {items.length === 1 ? "game" : "games"}
        </span>
        <span className="why">{GROUPS[check].why(s)}</span>
      </div>
      {items.map(({ p }) => {
        const g = p.game;
        const model = p[s.model].line;
        const warn = [g.away, g.home].filter((t) => conflicts[t] && !conflicts[t].agree && conflicts[t].espn);
        return (
          <div className="group-row" key={g.id}>
            <div>
              <div>
                {teamName(g.away)} at {teamName(g.home)}
              </div>
              <div className="note">
                {kickoffLabel(g.date, g.time)}
                {passNote(check, p, s) && <> · {passNote(check, p, s)}</>}
                {warn.length > 0 && <span className="warn-text"> · ESPN disagrees on {warn.join(", ")} QB</span>}
              </div>
            </div>
            <div className="nums">
              <span>Line {g.line === null ? "—" : `${g.home} ${teamSpread(g.line, "home")}`}</span>
              <span>Model {g.home} {teamSpread(Math.round(model * 2) / 2, "home")}</span>
              {g.line !== null && model !== g.line && (
                <span className="lean">leans {model > g.line ? g.home : g.away}</span>
              )}
              {isFinal(g) && (
                <span>
                  Final {g.awayScore}–{g.homeScore}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function WeekPage() {
  const { strategies } = useApp();
  const w = useWeek();
  const s = strategies.spread;
  const live = useLiveRecord(s);
  const totalsOn = strategies.total.enabled !== false;

  if (!w.week) {
    return (
      <div className="stack">
        <Guide />
        <div>
          <div className="eyebrow">Offseason</div>
          <h1 className="hero-title">No games scheduled.</h1>
          <p className="lede">
            The schedule for next season isn't in the data yet. The <Link to="/lab">strategy lab</Link> and{" "}
            <Link to="/rankings">rankings</Link> still work on every past season.
          </p>
        </div>
      </div>
    );
  }

  const g0 = w.items[0]?.p.game;
  const round = g0 && g0.type !== "REG" ? ROUND_NAME[g0.type] : `Week ${w.week.week}`;
  const n = w.picks.length;
  const passed = w.items.length - n;
  const asOf = new Date(w.linesAsOf).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const early = w.week.week <= 6 && g0?.type === "REG" && w.failedBy("history").length > 0;

  return (
    <div className="stack">
      <Guide />
      <div>
        <div className="eyebrow">
          {w.week.season} {round} · {w.fromBooks ? "Lines" : "nflverse lines"} as of {asOf} · {w.items.length} games
        </div>
        <h1 className="hero-title">{n === 0 ? "No picks this week." : `${n} ${n === 1 ? "pick" : "picks"} this week.`}</h1>
        <p className="lede">
          {passed} of {w.items.length} games failed at least one check. The rule averages {w.sidesRecord.perWeek.toFixed(1)}{" "}
          picks a week, so {n === 0 ? "a quiet week is normal" : "most games being skipped is normal"}. Treat picks as a
          paper trade: the rule hasn't beaten the {pct(BREAK_EVEN)} break-even by more than luck yet.
        </p>
      </div>

      {early && (
        <div className="notice">
          <span className="badge">EARLY SEASON</span>
          <span>
            Teams with a new head coach need {s.minGames} games before the rule trusts their numbers, so expect fewer
            picks until around mid-season.
          </span>
        </div>
      )}

      {w.picks.map((i) => (
        <PickCard key={i.p.game.id} item={i} bet={i.sides.pick!} s={s} rec={w.sidesRecord} />
      ))}
      {totalsOn &&
        w.totalPicks.map((i) => (
          <PickCard key={`t-${i.p.game.id}`} item={i} bet={i.totals!.pick!} s={strategies.total} rec={w.totalsRecord!} />
        ))}

      {passed > 0 && (
        <div className="stack-sm">
          <h2 className="section-title">Skipped, and why</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Each game is listed under the first check it failed.
          </p>
          {ORDER.map((c) => {
            const items = w.failedBy(c);
            return items.length ? <PassGroup key={c} check={c} items={items} s={s} /> : null;
          })}
        </div>
      )}

      <div className="stat-strip">
        <div className="stat dark">
          <div className="k">Live record</div>
          <div className="v">{live && live.rec.wins + live.rec.losses ? recordText(live.rec) : "—"}</div>
          <div className="n">
            {live?.since ? `Logged before kickoff since ${shortDate(live.since)}` : "Starts once picks are logged"}
          </div>
        </div>
        <div className="stat">
          <div className="k">Closing line value</div>
          <div className={`v ${live?.earlyClv ? (live.earlyClv.avg > 0 ? "good" : live.earlyClv.avg < 0 ? "bad" : "") : ""}`}>
            {live?.earlyClv ? `${live.earlyClv.avg > 0 ? "+" : ""}${num(live.earlyClv.avg, 2)}` : "—"}
          </div>
          <div className="n">
            {live?.earlyClv
              ? `Pts per pick, first log vs close (${live.earlyClv.n} picks)`
              : "Did the line move our way after we logged it?"}
          </div>
        </div>
        <div className="stat">
          <div className="k">Rule since 2002</div>
          <div className="v">{pct(w.sidesRecord.all.pct)}</div>
          <div className="n">
            {recordText(w.sidesRecord.all)} · break-even {pct(BREAK_EVEN)}
          </div>
        </div>
        <div className="stat">
          <div className="k">Totals</div>
          <div className="v">{totalsOn ? w.totalPicks.length : "Off"}</div>
          <div className="n">
            {totalsOn ? "Total picks this week" : "The rule stopped working on totals after 2015."}{" "}
            <Link to="/lab">Strategy lab →</Link>
          </div>
        </div>
      </div>

      <details className="more">
        <summary>Every game with all model numbers</summary>
        <WeekDetail />
      </details>
    </div>
  );
}
