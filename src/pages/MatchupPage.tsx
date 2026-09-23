import { useState } from "react";
import { TEAMS, teamName } from "../data/teams";
import { lineLabel, num, signed } from "../format";
import { classicLine, classicTotal } from "../model/classic";
import { useApp } from "../state";

const ABBRS = Object.keys(TEAMS).sort((a, b) => teamName(a).localeCompare(teamName(b)));

export function MatchupPage() {
  const { run, settings } = useApp();
  const [away, setAway] = useState("BUF");
  const [home, setHome] = useState("BAL");
  const [neutral, setNeutral] = useState(false);
  const r = run!;
  const H = r.current.find((t) => t.team === home)!;
  const A = r.current.find((t) => t.team === away)!;

  const marketLine = H.market - A.market + (neutral ? 0 : r.hfa);
  const marketTotal = H.marketTotal + A.marketTotal;
  const cLine =
    H.classicBlended !== null && A.classicBlended !== null
      ? classicLine(H.classicBlended, A.classicBlended, neutral, settings.classic)
      : null;
  const cTotal = H.classic && A.classic ? classicTotal(H.classic.projTotal, A.classic.projTotal) : null;
  const reliability = H.coverRank !== null && A.coverRank !== null ? H.coverRank + A.coverRank : null;

  const select = (value: string, set: (v: string) => void, label: string) => (
    <label>
      {label}{" "}
      <select value={value} onChange={(e) => set(e.target.value)}>
        {ABBRS.map((a) => (
          <option key={a} value={a}>
            {teamName(a)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="page-head">
        <h1>Matchup predictor</h1>
        <p className="muted">Any two teams, using current ratings.</p>
      </div>
      <div className="controls">
        {select(away, setAway, "Away")}
        {select(home, setHome, "Home")}
        <label className="check">
          <input type="checkbox" checked={neutral} onChange={(e) => setNeutral(e.target.checked)} /> Neutral site
        </label>
      </div>
      {home === away ? (
        <p className="muted">Pick two different teams.</p>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Market model</div>
              <div className="tile-value">{lineLabel(home, away, marketLine)}</div>
              <div className="tile-note">Total {num(marketTotal)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Classic</div>
              <div className="tile-value">{cLine === null ? "–" : lineLabel(home, away, cLine)}</div>
              <div className="tile-note">Total {cTotal === null ? "–" : num(cTotal)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Reliability (rank sum)</div>
              <div className="tile-value">{reliability ?? "–"}</div>
              <div className="tile-note">Lower = steadier cover history; 2 is best, 64 worst</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th className="num">{teamName(away)}</th>
                  <th className="num">{teamName(home)}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Head coach", (t: typeof H) => t.coach],
                    ["Games under coach", (t: typeof H) => String(t.games)],
                    ["Market rating", (t: typeof H) => signed(t.market)],
                    ["Classic rating", (t: typeof H) => (t.classicBlended === null ? "–" : signed(-t.classicBlended))],
                    ["Avg cover", (t: typeof H) => (t.classic ? signed(t.classic.cover) : "–")],
                    ["Cover SD (rank)", (t: typeof H) => (t.classic ? `${num(t.classic.sdCover)} (${t.coverRank})` : "–")],
                    ["Avg O/U", (t: typeof H) => (t.classic ? signed(t.classic.ou) : "–")],
                  ] as const
                ).map(([label, f]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num">{f(A)}</td>
                    <td className="num">{f(H)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Market: home rating − away rating + {neutral ? "0 (neutral)" : `${num(r.hfa)} home field`}. Classic: the
            spreadsheet's Sheet3 formula (half the rating gap, or {settings.classic.mixedSignFactor}× when the teams
            sit on opposite sides of average, with {settings.classic.hfa} points of home field split between them).
          </p>
        </>
      )}
    </>
  );
}
