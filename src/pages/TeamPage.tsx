import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DivergingColumns, Legend, LineChart, StatTile, type ColumnDatum } from "../components/charts";
import { TEAMS, teamName } from "../data/teams";
import { isFinal, type Game } from "../data/types";
import { lineLabel, num, shortDate, signed } from "../format";
import { buildTenures } from "../model/tenure";
import { useApp } from "../state";

const ABBRS = Object.keys(TEAMS).sort((a, b) => teamName(a).localeCompare(teamName(b)));
const MAX_BARS = 40;
const ROLL = 8;

export function TeamPage() {
  const { abbr = "KC" } = useParams();
  const navigate = useNavigate();
  const { run, data } = useApp();
  const coachRuns = useMemo(() => buildTenures(data!.games, true), [data]);
  const r = run!;
  const team = TEAMS[abbr] ? abbr : "KC";
  const t = r.current.find((x) => x.team === team)!;
  const rank = [...r.current].sort((a, b) => b.market - a.market).findIndex((x) => x.team === team) + 1;

  // This coach's completed games, from the team's perspective.
  const tenureGames = data!.games.filter((g): g is Game & { homeScore: number; awayScore: number; line: number } => {
    if (!isFinal(g) || g.line === null) return false;
    const ids = r.tenures.byGame.get(g.id);
    return !!ids && (ids[0] === t.tenure || ids[1] === t.tenure);
  });
  const log = tenureGames.map((g) => {
    const home = g.home === team;
    const homeCover = g.homeScore - g.awayScore - g.line;
    return {
      g,
      opp: home ? g.away : g.home,
      home,
      pf: home ? g.homeScore : g.awayScore,
      pa: home ? g.awayScore : g.homeScore,
      teamLine: home ? -g.line : g.line, // team's spread, + = underdog
      cover: home ? homeCover : -homeCover,
      ou: g.total === null ? null : g.homeScore + g.awayScore - g.total,
    };
  });
  const shown = log.slice(-MAX_BARS);
  const rolling = log.map((_, i) =>
    i + 1 < ROLL ? null : log.slice(i + 1 - ROLL, i + 1).reduce((s, x) => s + x.cover, 0) / ROLL,
  ).slice(-MAX_BARS);
  const columns: ColumnDatum[] = shown.map((x) => ({
    key: `${String(x.g.season).slice(2)}-${x.g.type === "REG" ? x.g.week : x.g.type}`,
    value: x.cover,
    title: `${x.g.season} ${x.g.type === "REG" ? `wk ${x.g.week}` : x.g.type} ${x.home ? "vs" : "at"} ${x.opp}`,
    rows: [
      { label: "cover margin", value: signed(x.cover) },
      { label: "final", value: `${x.pf}–${x.pa}` },
      { label: "spread", value: signed(x.teamLine) },
    ],
  }));

  // Market rating over the last three seasons, marking each season's first week.
  const lastSeasons = new Set([...new Set(r.history.map((h) => h.season))].slice(-3));
  const hist = r.history.filter((h) => lastSeasons.has(h.season) && h.ratings.has(team));
  const points = hist.map((h) => ({ label: `${h.season} week ${h.week}`, value: h.ratings.get(team)!.market }));
  const markers = hist.flatMap((h, i) => (i === 0 || hist[i - 1].season !== h.season ? [{ index: i, label: String(h.season) }] : []));

  // Every coaching tenure this team has had (always split by coach, whatever the reset setting).
  const tenures = [...coachRuns.tenures.values()].filter((x) => x.team === team).reverse();
  const tenureCount = new Map<string, number>();
  for (const g of data!.games) {
    if (!isFinal(g)) continue;
    for (const id of coachRuns.byGame.get(g.id)!) if (id.startsWith(`${team}#`)) tenureCount.set(id, (tenureCount.get(id) ?? 0) + 1);
  }

  return (
    <>
      <div className="page-head">
        <h1>{TEAMS[team].name}</h1>
        <div className="controls">
          <label>
            Team{" "}
            <select value={team} onChange={(e) => navigate(`/team/${e.target.value}`)}>
              {ABBRS.map((a) => (
                <option key={a} value={a}>
                  {teamName(a)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="tiles">
        <StatTile label="Market rating" value={signed(t.market)} note={`#${rank} of 32`} />
        <StatTile
          label="Classic rating"
          value={t.classicBlended === null ? "–" : signed(-t.classicBlended)}
          note={t.classic ? `spreadsheet value ${signed(-t.classic.rating)}` : "no games yet"}
        />
        <StatTile label="Head coach" value={t.coach} note={`since ${shortDate(t.since)} · ${t.games} games`} />
        <StatTile
          label="Cover margin"
          value={t.classic ? signed(t.classic.cover) : "–"}
          note={t.classic ? `SD ${num(t.classic.sdCover)} · consistency rank ${t.coverRank}` : undefined}
        />
      </div>

      <section className="card">
        <h2>Against the spread under {t.coach}</h2>
        <p className="muted small">
          Points above or below the spread each game{log.length > MAX_BARS ? ` (last ${MAX_BARS} of ${log.length})` : ""}.
          The line is the rolling {ROLL}-game average.
        </p>
        {columns.length ? (
          <>
            <Legend
              items={[
                { label: "Covered", kind: "pos" },
                { label: "Didn't cover", kind: "neg" },
                { label: `${ROLL}-game average`, kind: "line" },
              ]}
            />
            <DivergingColumns data={columns} overlay={rolling} overlayLabel={`${ROLL}-game avg`} format={(v) => num(v, 0)} />
          </>
        ) : (
          <p className="muted">No completed games under this coach yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Market rating, last three seasons</h2>
        <LineChart points={points} seriesLabel="Market rating" markers={markers} format={(v) => signed(v)} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Game log</h2>
          <div className="table-wrap">
            <table className="data compact">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Result</th>
                  <th>Line</th>
                  <th className="num">Cover</th>
                  <th className="num">O/U</th>
                </tr>
              </thead>
              <tbody>
                {[...log].reverse().slice(0, 25).map((x) => (
                  <tr key={x.g.id}>
                    <td>
                      {x.g.season} {x.g.type === "REG" ? `wk ${x.g.week}` : x.g.type} {x.home ? "vs" : "at"} {x.opp}
                    </td>
                    <td>
                      {x.pf > x.pa ? "W" : x.pf < x.pa ? "L" : "T"} {x.pf}–{x.pa}
                    </td>
                    <td>{lineLabel(x.g.home, x.g.away, x.g.line)}</td>
                    <td className="num">{signed(x.cover)}</td>
                    <td className="num">{x.ou === null ? "–" : signed(x.ou)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <h2>Coaching history</h2>
          <p className="muted small">Each change, including interim coaches, starts a new history when resets are on.</p>
          {(data!.coachCorrections ?? [])
            .filter((c) => c.team === team && c.kind !== "spelling")
            .map((c) => (
              <p key={`${c.season}${c.now}`} className="small">
                Corrected: nflverse listed {c.was} for {c.season}; using {c.now}
                {c.kind === "espn" ? " (ESPN's current head coach)" : " (manual override)"}.
              </p>
            ))}
          <table className="data compact">
            <thead>
              <tr>
                <th>Coach</th>
                <th>First game</th>
                <th className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {tenures.map((x) => (
                <tr key={x.id}>
                  <td>{x.coach}</td>
                  <td>{shortDate(x.firstDate)}</td>
                  <td className="num">{tenureCount.get(x.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
