import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkline } from "../components/charts";
import { teamName } from "../data/teams";
import { num, shortDate, signed } from "../format";
import { useApp } from "../state";

type SortKey = "market" | "classic";

export function RankingsPage() {
  const { run, settings } = useApp();
  const [sort, setSort] = useState<SortKey>("market");
  const r = run!;
  const season = r.history.at(-1)?.season;
  // Trend: this season's weekly snapshots, plus last season's final one as the starting point.
  const trendWeeks = r.history.filter((h, i, all) => h.season === season || (i + 1 < all.length && all[i + 1].season === season));

  // Both columns read as "points better than an average team"; Classic's native scale is the reverse.
  const classicScore = (t: (typeof r.current)[number]) => (t.classicBlended === null ? null : -t.classicBlended);
  const rows = [...r.current].sort((a, b) =>
    sort === "market" ? b.market - a.market : (classicScore(b) ?? -99) - (classicScore(a) ?? -99),
  );

  return (
    <>
      <div className="page-head">
        <h1>Power rankings</h1>
        <p className="muted">
          Ratings are points better than a league-average team on a neutral field. <strong>Market</strong> fits
          recent closing lines (and {Math.round(settings.market.resultWeight * 100)}% actual results) across all
          teams at once, so it adjusts for opponents and home games. <strong>Classic</strong> is the spreadsheet
          formula (average line faced minus average cover)
          {settings.classic.shrinkGames > 0 && `, blended toward Market for teams with few games`}. History
          {settings.resetOnCoachChange ? " resets when the head coach changes." : " spans coaching changes."} Home-field
          advantage is currently {num(r.hfa)} points.
        </p>
      </div>
      <div className="controls">
        <label>
          Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="market">Market rating</option>
            <option value="classic">Classic rating</option>
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
              <th>This season</th>
              <th className="num">Classic</th>
              <th className="num" title="Classic average (or EMA) cover margin under this coach">Avg cover</th>
              <th className="num" title="Standard deviation of cover margin; rank 1 = steadiest">Cover SD (rank)</th>
              <th className="num" title="Classic average over/under margin">Avg O/U</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const trend = trendWeeks.map((h) => h.ratings.get(t.team)?.market).filter((v): v is number => v !== undefined);
              const cs = classicScore(t);
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
                  <td className="num strong">{signed(t.market)}</td>
                  <td>
                    <Sparkline values={trend} />
                  </td>
                  <td className="num" title={t.classic ? `Unblended spreadsheet value: ${signed(-t.classic.rating)}` : undefined}>
                    {cs === null ? "–" : signed(cs)}
                  </td>
                  <td className="num">{t.classic ? signed(t.classic.cover) : "–"}</td>
                  <td className="num">
                    {t.classic ? `${num(t.classic.sdCover)} (${t.coverRank})` : "–"}
                    {t.games > 0 && t.games < 8 && <span className="muted small"> thin</span>}
                  </td>
                  <td className="num">{t.classic ? signed(t.classic.ou) : "–"}</td>
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
