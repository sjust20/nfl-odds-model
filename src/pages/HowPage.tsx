import { Link } from "react-router-dom";
import { pct } from "../format";
import { activeChecks, type Check } from "../model/explain";
import { BREAK_EVEN } from "../model/metrics";
import { useApp } from "../state";
import { useWeek } from "./useWeek";

const ROUTINE = [
  ["Tuesday", "Last week's games are graded, ratings update, and each new game's first line and prediction are logged and frozen."],
  ["Every morning", "Lines, starting QBs and coaches refresh. Picks can appear or drop off as QB news and line moves come in."],
  ["Game day", "The last morning log before kickoff is the pick of record. The closing line grades it, win or lose."],
] as const;

const CHECK_LABEL: Record<Check, string> = {
  history: "Enough games under the current coach",
  qb: "Same starting QBs as last game",
  reliability: "Both teams steady against the line",
  line: "A line is posted",
  edge: "Model and line disagree enough",
};

const GLOSSARY = [
  ["Line (spread)", "Points the favorite is expected to win by, set by sportsbooks. \"Bills −3\" means the Bills must win by 4+ to cover; by exactly 3 is a push."],
  ["Covering", "Beating the line: the favorite wins by more than the spread, or the underdog loses by less (or wins)."],
  ["Break-even", `At standard −110 odds you risk $110 to win $100, so you need to win ${pct(BREAK_EVEN)} of bets just to break even.`],
  ["Market model", "Rates each team from how the market has priced it under its current head coach, nudged toward actual results and adjusted for the starting QB."],
  ["Play-by-play model", "The Market model's number plus pass and rush efficiency (expected points per play) on offense and defense."],
  ["Reliability", "How steadily a team has beaten or missed the line. Lower is steadier; the rule adds both teams' ranks."],
  ["Closing line value", "Did the line move toward our side after we logged the pick? Beating the closing line is the best early sign of a real edge, long before win-loss records settle."],
  ["Coach reset", "A team's history starts over when its head coach changes, interim coaches included."],
] as const;

export function HowPage() {
  const { strategies } = useApp();
  const w = useWeek();
  const s = strategies.spread;
  // Sequential funnel for this week: how many games are still in after each check.
  // Same order as explainBet, which files each skipped game under its first failed check.
  const order: Check[] = [...activeChecks(s).filter((c) => c !== "edge"), "line", "edge"];
  const total = w.items.length;
  let left = total;
  const funnel = order.map((c) => {
    left -= w.failedBy(c).length;
    return { c, left };
  });

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">How it works</div>
        <h1 className="hero-title small">One fixed rule, run on every game, graded in public.</h1>
        <p className="lede">
          The site rates every team, predicts every game, and applies the same checks each week. Everything is logged
          before kickoff and graded against the closing line, so the record can't be cherry-picked afterwards.
        </p>
      </div>

      <section className="stack-sm">
        <h2 className="section-title">The weekly routine</h2>
        <div className="card-grid">
          {ROUTINE.map(([when, what], i) => (
            <div className="mini-card" key={when}>
              <div className="routine-n">{String(i + 1).padStart(2, "0")}</div>
              <div className="check-title">{when}</div>
              <div className="body">{what}</div>
            </div>
          ))}
        </div>
      </section>

      {total > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">This week, check by check</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {total} games in; each bar is how many are left after that check.
          </p>
          <div className="card stack-sm">
            {funnel.map(({ c, left }) => (
              <div className="funnel-row" key={c}>
                <div className="top">
                  <span>{CHECK_LABEL[c]}</span>
                  <span className="mono">
                    {left} of {total}
                  </span>
                </div>
                <div className="funnel-bar">
                  <div style={{ width: `${(left / total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Words used on this site</h2>
        <div style={{ marginTop: 10 }}>
          {GLOSSARY.map(([term, def]) => (
            <div className="finding" key={term}>
              <div className="head">{term}</div>
              <div className="body">{def}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="dark-panel">
        <div>
          <h2>What this site won't do</h2>
          <p>
            Tell you to bet. The rule hasn't beaten break-even by more than luck, and the closing line still predicts
            games better than either model.
          </p>
        </div>
        <div>
          <p>
            No injury news, weather or motivation goes in beyond the starting QB. No picks are edited after kickoff. No
            results are hidden: losing weeks count the same as winning ones.
          </p>
        </div>
      </div>

      <div>
        <Link className="btn-inverse" to="/">
          See this week's picks →
        </Link>
      </div>
    </div>
  );
}
