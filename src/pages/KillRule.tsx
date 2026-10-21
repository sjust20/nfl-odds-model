import { num, pct, shortDate } from "../format";
import { KILL_RULE, type KillStatus } from "../model/killRule";
import { useKillRule } from "./LabPage";

const STATUS: Record<KillStatus, { label: string; tone: string }> = {
  pending: { label: "Running", tone: "" },
  pass: { label: "Passed", tone: "good" },
  fail: { label: "Shelve it", tone: "bad" },
};

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), 2)}`;

/** The pre-registered stopping rule and where it stands. */
export function KillRuleSection() {
  const k = useKillRule();
  const s = k?.summary;
  const st = STATUS[k?.status ?? "pending"];
  const by = k?.deadline ? shortDate(k.deadline) : `the end of the ${KILL_RULE.season} regular season`;
  return (
    <section className="stack-sm">
      <h2 className="section-title">Kill rule</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Set on {shortDate(KILL_RULE.setOn)}, before the rest of the season's data. If by the end of the{" "}
        {KILL_RULE.season} regular season ({by}) the line hasn't moved toward the play-by-play model's side by at least{" "}
        {signed(KILL_RULE.minAvg)} points per game on average, and toward it more often than away, the betting idea is
        shelved. It's measured on every lined game, from the first log to the last line before kickoff, from the same
        source at both ends. Win-loss records are too noisy to decide this in one season; line movement isn't.
      </p>
      <div className="stat-strip">
        <div className="stat dark">
          <div className="k">Status</div>
          <div className="v">{st.label}</div>
          <div className="n">Decided after {by}</div>
        </div>
        <div className="stat">
          <div className="k">Line moved toward the model</div>
          <div className={`v ${s ? (s.avg >= KILL_RULE.minAvg ? "good" : s.avg < 0 ? "bad" : "") : ""}`}>
            {s ? signed(s.avg) : "—"}
          </div>
          <div className="n">
            {s
              ? `Pts per game, ±${num(1.96 * s.se, 2)} (95%), over ${s.n} games. Needs ${signed(KILL_RULE.minAvg)}`
              : "No finished games yet"}
          </div>
        </div>
        <div className="stat">
          <div className="k">Toward vs away</div>
          <div className="v">{s ? `${pct(s.beat, 0)} / ${pct(1 - s.beat - s.same, 0)}` : "—"}</div>
          <div className="n">{s ? `Didn't move in ${pct(s.same, 0)}. Toward must lead` : "Share of games"}</div>
        </div>
      </div>
    </section>
  );
}

/** One-card version for the This week stat strip. */
export function KillRuleStat() {
  const k = useKillRule();
  const s = k?.summary;
  return (
    <div className="stat">
      <div className="k">Line movement · kill rule</div>
      <div className={`v ${s ? (s.avg >= KILL_RULE.minAvg ? "good" : s.avg < 0 ? "bad" : "") : ""}`}>
        {s ? signed(s.avg) : "—"}
      </div>
      <div className="n">
        {s
          ? `Pts per game toward play-by-play, ${s.n} games (toward ${pct(s.beat, 0)}, away ${pct(1 - s.beat - s.same, 0)}). Needs ${signed(KILL_RULE.minAvg)} by season's end. `
          : "Does the line move toward the model? "}
        {k?.status === "pass" ? "Passed." : k?.status === "fail" ? "Failed: shelve it." : ""}
      </div>
    </div>
  );
}
