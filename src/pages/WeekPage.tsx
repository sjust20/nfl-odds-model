import { useMemo } from "react";
import { Link } from "react-router-dom";
import { qbStatus, type QbStatus } from "../data/qb";
import { teamName } from "../data/teams";
import { isFinal } from "../data/types";
import { currentWeek } from "../data/week";
import { lineLabel, num, shortDate, signed } from "../format";
import type { Prediction } from "../model/engine";
import { betFor, type Strategy } from "../model/metrics";
import { bigEdgeNoQb, lineAdjustment, linePlusComponentsBet } from "../model/tracked";
import { useApp } from "../state";
import { strategySummary } from "./LabPage";

/** The prediction with the line replaced by the sportsbook median, when we have one. */
function atBookLine(p: Prediction, bookLine: number | null, bookTotal: number | null): Prediction {
  return {
    ...p,
    game: { ...p.game, line: bookLine ?? p.game.line, total: bookTotal ?? p.game.total },
  };
}

/** "Keenum (was Williams)" for a change, otherwise just the starter's name. */
function QbLine({ team, q }: { team: string; q: QbStatus | null | undefined }) {
  if (!q) return <div className="muted small">{team}: not listed</div>;
  return (
    <div className={`small ${q.changed ? "qb-changed" : ""}`}>
      {team}: {q.name}
      {q.changed && q.prev && <span> (was {q.prev})</span>}
    </div>
  );
}

function PickCell({ p, strategy }: { p: Prediction; strategy: Strategy }) {
  const bet = betFor(p, { ...strategy, fromSeason: 0, toSeason: 9999 });
  if (!bet) return <span className="muted">Pass</span>;
  const g = p.game;
  const label =
    bet.side === "home" || bet.side === "away"
      ? `${bet.side === "home" ? g.home : g.away} ${signed(bet.side === "home" ? -g.line! : g.line!)}`
      : `${bet.side === "over" ? "Over" : "Under"} ${g.total}`;
  const result = bet.result === null ? null : bet.result === 1 ? "Won" : bet.result === 0 ? "Lost" : "Push";
  return (
    <span className="pick">
      <strong>{label}</strong>
      {result && <span className={`result ${result.toLowerCase()}`}>{result}</span>}
    </span>
  );
}

export function WeekPage() {
  const { run, odds, strategies, data, settings } = useApp();
  const sides = strategies.spread;
  const totals = strategies.total;
  const showTotals = totals.enabled !== false;
  const preds = run!.predictions;
  const week = currentWeek(data!.games);
  const next = week ? preds.find((p) => p.game.season === week.season && p.game.week === week.week) : undefined;
  const qbs = useMemo(() => qbStatus(data!.games), [data]);
  const bookFor = new Map(odds?.games.map((o) => [o.gameId, o]) ?? []);

  const upcoming = next ? preds.filter((p) => p.game.season === next.game.season && p.game.week === next.game.week) : [];
  // Most recent completed week before the one in play (a played Thursday game doesn't count).
  const lastFinal = [...preds]
    .reverse()
    .find((p) => isFinal(p.game) && !(week && p.game.season === week.season && p.game.week === week.week));
  const previous = lastFinal
    ? preds.filter((p) => p.game.season === lastFinal.game.season && p.game.week === lastFinal.game.week)
    : [];

  const title = next ? `${next.game.season} · ${next.game.type === "REG" ? `Week ${next.game.week}` : next.game.type}` : "No upcoming games";
  const oddsAge = odds ? (Date.now() - Date.parse(odds.fetchedAt)) / 3.6e6 : null;

  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
        <p className="muted">
          The book line is what sportsbooks are offering (median across US books). Model lines use only games
          before this week. <strong>Edge</strong> = model minus book, in points for the home team: positive means
          the model likes the home side more than the books do.
        </p>
      </div>

      <div className="chips">
        <span className="chip">
          {odds ? (
            <>
              Sportsbook odds from {new Date(odds.fetchedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
              {oddsAge !== null && oddsAge > 30 && " (stale)"}
            </>
          ) : (
            <>No sportsbook feed configured; showing the nflverse consensus line</>
          )}
        </span>
        <span className="chip">
          Sides: {strategySummary(sides)} · <Link to="/lab">change</Link>
        </span>
        <span className="chip">
          Totals: {totals.enabled === false ? "off" : strategySummary(totals)} · <Link to="/lab?bet=total">change</Link>
        </span>
      </div>

      {next && next.game.week <= 4 && next.game.type === "REG" && (
        <div className="callout">
          Early season: ratings still lean on last year and move a lot week to week. Historically the model's
          disagreement with the line is ~40% larger in weeks 1–2 than from week 4 on.
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Game</th>
                <th title="Starting QBs as listed by nflverse; highlighted when different from the team's last game">
                  Starting QBs
                </th>
                <th>Book line</th>
                <th>Market model</th>
                <th>Play-by-play</th>
                <th className="num">Edge (M / P)</th>
                <th>Total: book / M / P</th>
                <th className="num" title="Sum of both teams' consistency ranks (cover for sides, over/under for totals); lower = steadier">
                  Reliability (S / T)
                </th>
                <th>Side pick</th>
                {showTotals && <th>Total pick</th>}
              </tr>
            </thead>
            <tbody>
              {upcoming.map((p) => {
                const g = p.game;
                const book = bookFor.get(g.id);
                const line = book?.line ?? g.line;
                const total = book?.total ?? g.total;
                const lines = book?.books.flatMap((b) => (b.line === null ? [] : [b.line])) ?? [];
                const lo = lines.length ? Math.min(...lines) : null;
                const hi = lines.length ? Math.max(...lines) : null;
                return (
                  <tr key={g.id}>
                    <td>
                      <div>
                        <Link to={`/team/${g.away}`}>{teamName(g.away)}</Link> {g.neutral ? "vs" : "at"}{" "}
                        <Link to={`/team/${g.home}`}>{teamName(g.home)}</Link>
                      </div>
                      <div className="muted small">{shortDate(g.date)}</div>
                    </td>
                    <td>
                      <QbLine team={g.away} q={qbs.get(g.id)?.away} />
                      <QbLine team={g.home} q={qbs.get(g.id)?.home} />
                      {Math.abs(p.qbAdj * settings.market.qbScale) >= 0.5 && (
                        <div className="muted small" title="Points the QB adjustment moves the model lines toward the home team">
                          QB adjustment: {g.home} {signed(p.qbAdj * settings.market.qbScale)}
                        </div>
                      )}
                    </td>
                    <td>
                      {line === null ? (
                        <span className="muted">Not posted</span>
                      ) : (
                        <>
                          <div>{lineLabel(g.home, g.away, line)}</div>
                          {book && lo !== null && hi !== null && lo !== hi && (
                            <div className="muted small">
                              {lineLabel(g.home, g.away, lo)} to {lineLabel(g.home, g.away, hi)}, {lines.length} books
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td>{lineLabel(g.home, g.away, p.market.line)}</td>
                    <td>{lineLabel(g.home, g.away, p.pbp.line)}</td>
                    <td className="num">
                      {line === null ? "–" : `${signed(p.market.line - line)} / ${signed(p.pbp.line - line)}`}
                      {line !== null && bigEdgeNoQb(atBookLine(p, line, total)) && (
                        <div>
                          <Link to="/lab" className="tag" title="Tracked, not bet: Market edge over 6 with no QB change">
                            tracked: big edge
                          </Link>
                        </div>
                      )}
                      <div className="muted small" title="How far efficiency components say the line is off, in points for the home team (tracked idea)">
                        components {signed(lineAdjustment(p.components))}
                      </div>
                      {line !== null && linePlusComponentsBet(atBookLine(p, line, total)) && (
                        <div>
                          <Link to="/lab" className="tag" title="Tracked, not bet: closing line + efficiency components, adjustment over 1 point">
                            tracked: {linePlusComponentsBet(atBookLine(p, line, total))!.side === "home" ? g.home : g.away}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>
                      {total ?? "–"} / {num(p.market.total)} / {num(p.pbp.total)}
                    </td>
                    <td className="num">
                      {p.reliability ?? "–"} / {p.totalReliability ?? "–"}
                      {p.minGames < Math.max(sides.minGames, totals.minGames) && (
                        <div className="muted small" title="A team has few games under its current coach">
                          thin ({p.minGames}g)
                        </div>
                      )}
                    </td>
                    <td>
                      {line === null ? <span className="muted">–</span> : <PickCell p={atBookLine(p, line, total)} strategy={sides} />}
                    </td>
                    {showTotals && (
                      <td>
                        {total === null ? <span className="muted">–</span> : <PickCell p={atBookLine(p, line, total)} strategy={totals} />}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {previous.length > 0 && (
        <>
          <h2>
            Last results · {previous[0].game.season} {previous[0].game.type === "REG" ? `week ${previous[0].game.week}` : previous[0].game.type}
          </h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Final</th>
                  <th>Closing line</th>
                  <th className="num">Home cover</th>
                  <th>Market model</th>
                  <th>Play-by-play</th>
                  <th>Final total</th>
                  <th>Side pick</th>
                  {showTotals && <th>Total pick</th>}
                </tr>
              </thead>
              <tbody>
                {previous.map((p) => {
                  const g = p.game;
                  if (!isFinal(g)) return null;
                  const cover = g.line === null ? null : g.homeScore - g.awayScore - g.line;
                  return (
                    <tr key={g.id}>
                      <td>
                        {teamName(g.away)} {g.neutral ? "vs" : "at"} {teamName(g.home)}
                      </td>
                      <td>
                        {g.away} {g.awayScore}, {g.home} {g.homeScore}
                      </td>
                      <td>{g.line === null ? "–" : lineLabel(g.home, g.away, g.line)}</td>
                      <td className="num">{cover === null ? "–" : signed(cover)}</td>
                      <td>{lineLabel(g.home, g.away, p.market.line)}</td>
                      <td>{lineLabel(g.home, g.away, p.pbp.line)}</td>
                      <td>
                        {g.homeScore + g.awayScore}
                        {g.total !== null && <span className="muted small"> (line {g.total})</span>}
                      </td>
                      <td>{g.line === null ? "–" : <PickCell p={p} strategy={sides} />}</td>
                      {showTotals && <td>{g.total === null ? "–" : <PickCell p={p} strategy={totals} />}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Last results are graded against the closing line from nflverse.</p>
        </>
      )}
    </>
  );
}
