import { useState } from "react";
import { TEAMS, teamName } from "../data/teams";
import { lineLabel, num, signed } from "../format";
import { useApp } from "../state";

const ABBRS = Object.keys(TEAMS).sort((a, b) => teamName(a).localeCompare(teamName(b)));

export function MatchupPage() {
  const { run } = useApp();
  const [away, setAway] = useState("BUF");
  const [home, setHome] = useState("BAL");
  const [neutral, setNeutral] = useState(false);
  const r = run!;
  const H = r.current.find((t) => t.team === home)!;
  const A = r.current.find((t) => t.team === away)!;
  const line = (k: "market" | "pbp") => H[k] - A[k] + (neutral ? 0 : r.hfa[k]);
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
        <p className="muted">
          Any two teams, using current ratings. These assume each team's recent QB mix. For a game with a
          different starter, see the This week page, which applies the QB adjustment.
        </p>
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
              <div className="tile-value">{lineLabel(home, away, line("market"))}</div>
              <div className="tile-note">Total {num(H.marketTotal + A.marketTotal)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Play-by-play model</div>
              <div className="tile-value">{lineLabel(home, away, line("pbp"))}</div>
              <div className="tile-note">Total {num(H.pbpTotal + A.pbpTotal)}</div>
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
                    ["Play-by-play rating", (t: typeof H) => signed(t.pbp)],
                    ["Avg cover", (t: typeof H) => (t.ats ? signed(t.ats.cover) : "–")],
                    ["Cover SD (rank)", (t: typeof H) => (t.ats ? `${num(t.ats.sdCover)} (${t.coverRank})` : "–")],
                    ["Avg O/U", (t: typeof H) => (t.ats ? signed(t.ats.ou) : "–")],
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
            Line = home rating − away rating + home-field advantage ({num(r.hfa.market)} Market,{" "}
            {num(r.hfa.pbp)} play-by-play; 0 at a neutral site).
          </p>
        </>
      )}
    </>
  );
}
