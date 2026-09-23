import { Link } from "react-router-dom";
import { teamName } from "../data/teams";
import { isFinal } from "../data/types";
import { lineLabel, num, shortDate, signed } from "../format";
import type { Prediction } from "../model/engine";
import { betFor, type Strategy } from "../model/metrics";
import { useApp } from "../state";
import { strategySummary } from "./LabPage";

/** The prediction with the line replaced by the sportsbook median, when we have one. */
function atBookLine(p: Prediction, bookLine: number | null, bookTotal: number | null): Prediction {
  return {
    ...p,
    game: { ...p.game, line: bookLine ?? p.game.line, total: bookTotal ?? p.game.total },
  };
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
  const { run, odds, strategy } = useApp();
  const preds = run!.predictions;
  const next = preds.find((p) => !isFinal(p.game));
  const bookFor = new Map(odds?.games.map((o) => [o.gameId, o]) ?? []);

  const upcoming = next ? preds.filter((p) => p.game.season === next.game.season && p.game.week === next.game.week) : [];
  const lastFinal = [...preds].reverse().find((p) => isFinal(p.game));
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
          Picks use: {strategySummary(strategy)} · <Link to="/lab">change</Link>
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
                <th>Book line</th>
                <th>Market model</th>
                <th>Classic</th>
                <th className="num">Edge (M / C)</th>
                <th>Total: book / M / C</th>
                <th className="num" title="Sum of both teams' cover-consistency ranks; lower = steadier">Reliability</th>
                <th>Pick</th>
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
                    <td>{p.classic ? lineLabel(g.home, g.away, p.classic.line) : <span className="muted">–</span>}</td>
                    <td className="num">
                      {line === null ? "–" : `${signed(p.market.line - line)} / ${p.classic ? signed(p.classic.line - line) : "–"}`}
                    </td>
                    <td>
                      {total ?? "–"} / {num(p.market.total)} / {p.classic ? num(p.classic.total) : "–"}
                    </td>
                    <td className="num">
                      {p.reliability ?? "–"}
                      {p.minGames < strategy.minGames && (
                        <div className="muted small" title="A team has few games under its current coach">
                          thin ({p.minGames}g)
                        </div>
                      )}
                    </td>
                    <td>
                      {line === null ? <span className="muted">–</span> : <PickCell p={atBookLine(p, line, total)} strategy={strategy} />}
                    </td>
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
                  <th>Classic</th>
                  <th>Strategy pick</th>
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
                      <td>{p.classic ? lineLabel(g.home, g.away, p.classic.line) : "–"}</td>
                      <td>{g.line === null ? "–" : <PickCell p={p} strategy={strategy} />}</td>
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
