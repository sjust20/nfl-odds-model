import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkline } from "../components/charts";
import { teamName } from "../data/teams";
import { num, shortDate, signed } from "../format";
import type { ModelKey } from "../model/engine";
import { useApp } from "../state";

export function RankingsPage() {
  const { run, settings, data } = useApp();
  const fixes = (data!.coachCorrections ?? []).filter((c) => c.kind !== "spelling");
  const [sort, setSort] = useState<ModelKey>("pbp");
  const r = run!;
  const season = r.history.at(-1)?.season;
  // Trend: this season's weekly snapshots, plus last season's final one as the starting point.
  const trendWeeks = r.history.filter((h, i, all) => h.season === season || (i + 1 < all.length && all[i + 1].season === season));
  const rows = [...r.current].sort((a, b) => b[sort] - a[sort]);

  return (
    <>
      <div className="page-head">
        <h1>Power rankings</h1>
        <p className="muted">
          Ratings are points better than a league-average team on a neutral field, with the team's recent QB mix.
          Both models fit recent closing lines across all teams at once, so they adjust for opponents and home
          games. <strong>Market</strong> also learns {Math.round(settings.market.resultWeight * 100)}% from final
          margins. <strong>Play-by-play</strong> takes Market and adds each team's opponent-adjusted efficiency
          (expected points added per play) in four parts: pass offense, pass defense, rush offense and rush
          defense. Play-by-play is the default sort: it's slightly closer to final margins (12.85 vs 12.89 pts
          average miss since 2016). History
          {settings.resetOnCoachChange ? " resets when the head coach changes." : " spans coaching changes."} Home-field
          advantage is currently {num(r.hfa.market)} points.
        </p>
      </div>
      {fixes.length > 0 && (
        <div className="callout">
          <strong>Coach data corrected.</strong> nflverse's head-coach column was out of date for{" "}
          {fixes.map((c, i) => (
            <span key={`${c.team}${c.season}`}>
              {i > 0 && (i === fixes.length - 1 ? ", and " : ", ")}
              {teamName(c.team)} ({c.was} → {c.now}, {c.season})
            </span>
          ))}
          . {fixes.some((c) => c.kind === "espn") && "Current coaches are checked against ESPN nightly. "}
          Manual fixes go in <code>data/coach-overrides.json</code>.
        </div>
      )}
      <div className="controls">
        <label>
          Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as ModelKey)}>
            <option value="pbp">Play-by-play rating</option>
            <option value="market">Market rating</option>
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Team</th>
              <th>Head coach</th>
              <th className="num">Market</th>
              <th className="num">Play-by-play</th>
              <th>This season (Market)</th>
              <th className="num" title="EMA of cover margin under this coach (the spreadsheet's Average Cover)">Avg cover</th>
              <th className="num" title="Standard deviation of cover margin; rank 1 = steadiest">Cover SD (rank)</th>
              <th className="num" title="EMA of over/under margin">Avg O/U</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const trend = trendWeeks.map((h) => h.ratings.get(t.team)?.[sort]).filter((v): v is number => v !== undefined);
              return (
                <tr key={t.team}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <Link to={`/team/${t.team}`}>{teamName(t.team)}</Link>
                  </td>
                  <td>
                    <div>{t.coach}</div>
                    <div className="muted small">
                      since {shortDate(t.since)} · {t.games} {t.games === 1 ? "game" : "games"}
                    </div>
                  </td>
                  <td className={`num ${sort === "market" ? "strong" : ""}`}>{signed(t.market)}</td>
                  <td className={`num ${sort === "pbp" ? "strong" : ""}`}>{signed(t.pbp)}</td>
                  <td>
                    <Sparkline values={trend} />
                  </td>
                  <td className="num">{t.ats ? signed(t.ats.cover) : "–"}</td>
                  <td className="num">
                    {t.ats ? `${num(t.ats.sdCover)} (${t.coverRank})` : "–"}
                    {t.games > 0 && t.games < 8 && <span className="muted small"> thin</span>}
                  </td>
                  <td className="num">{t.ats ? signed(t.ats.ou) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        "Thin" marks teams with under 8 games under their coach. Their cover SD is unreliable, and the spreadsheet
        ranks them as the <em>most</em> consistent teams. The strategy lab excludes them by default.
      </p>
    </>
  );
}
