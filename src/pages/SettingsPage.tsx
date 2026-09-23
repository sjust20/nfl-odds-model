import { useEffect, useState, type ReactNode } from "react";
import { COMPONENT_KEYS, type ComponentDiffs } from "../model/components";
import { DEFAULT_SETTINGS, type PbpSettings, type RatingSettings, type Settings } from "../model/settings";
import { useApp } from "../state";

function Field({ label, help, children }: { label: string; help: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        <span className="field-label">{label}</span>
        {children}
      </label>
      <p className="muted small">{help}</p>
    </div>
  );
}

function NumberInput({ value, onChange, step = 1, min = 0, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

/** Market model fields. */
function MarketFields({ s, set }: { s: RatingSettings; set: (patch: Partial<RatingSettings>) => void }) {
  const d = DEFAULT_SETTINGS.market;
  return (
    <>
      <Field label="Recency half-life (weeks)" help={`A game's weight halves every this many weeks. Default: ${d.halfLifeWeeks}.`}>
        <NumberInput value={s.halfLifeWeeks} min={1} onChange={(v) => set({ halfLifeWeeks: Math.max(1, v) })} />
      </Field>
      <Field label="Offseason carryover" help={`Extra weight multiplier for each offseason crossed. Default: ${d.seasonCarryover}.`}>
        <NumberInput value={s.seasonCarryover} step={0.05} max={1} onChange={(v) => set({ seasonCarryover: Math.min(1, v) })} />
      </Field>
      <Field
        label="Results weight"
        help={`Share of each game's target taken from the final margin; the rest comes from the closing line. Default: ${d.resultWeight}.`}
      >
        <NumberInput value={s.resultWeight} step={0.05} max={1} onChange={(v) => set({ resultWeight: Math.min(1, v) })} />
      </Field>
      <Field
        label="QB adjustment scale"
        help={`How much of the starting-QB adjustment to apply: the starter's value vs the team's recent QB mix, from play-by-play. 0 ignores who starts. Default: ${d.qbScale}.`}
      >
        <NumberInput value={s.qbScale} step={0.25} onChange={(v) => set({ qbScale: v })} />
      </Field>
      <Field label="Pull toward average (games)" help={`Regularization that keeps thin ratings sensible. Default: ${d.ridgeGames}.`}>
        <NumberInput value={s.ridgeGames} step={0.25} onChange={(v) => set({ ridgeGames: Math.max(0.01, v) })} />
      </Field>
      <Field
        label="Carryover to a new coach (0 = hard reset)"
        help="How much of the previous regime's recent evidence a new coach starts with; it fades as fast as old games do. More carryover consistently predicted new coaches' games better."
      >
        <NumberInput value={s.coachCarryover} step={0.25} onChange={(v) => set({ coachCarryover: v })} />
      </Field>
    </>
  );
}

const WEIGHT_LABELS: Record<keyof ComponentDiffs, string> = {
  passOff: "Pass offense",
  passDef: "Pass defense",
  rushOff: "Rush offense",
  rushDef: "Rush defense",
};

/** Play-by-play model fields: how the components are fitted, and how they're stacked on Market. */
function PbpFields({ s, set }: { s: PbpSettings; set: (patch: Partial<PbpSettings>) => void }) {
  const d = DEFAULT_SETTINGS.pbp;
  return (
    <>
      <Field label="Component half-life (weeks)" help={`Weight on a game's efficiency halves every this many weeks. Default: ${d.halfLifeWeeks}.`}>
        <NumberInput value={s.halfLifeWeeks} min={1} onChange={(v) => set({ halfLifeWeeks: Math.max(1, v) })} />
      </Field>
      <Field label="Component offseason carryover" help={`Default: ${d.seasonCarryover}.`}>
        <NumberInput value={s.seasonCarryover} step={0.05} max={1} onChange={(v) => set({ seasonCarryover: Math.min(1, v) })} />
      </Field>
      <Field label="Component pull toward average (plays)" help={`Default: ${d.ridgePlays}.`}>
        <NumberInput value={s.ridgePlays} step={25} onChange={(v) => set({ ridgePlays: Math.max(1, v) })} />
      </Field>
      <Field label="Weight on the Market line" help={`Default: ${d.marketWeight}.`}>
        <NumberInput value={s.marketWeight} step={0.01} onChange={(v) => set({ marketWeight: v })} />
      </Field>
      <Field label="Intercept (points)" help={`Default: ${d.intercept}.`}>
        <NumberInput value={s.intercept} step={0.05} min={-10} onChange={(v) => set({ intercept: v })} />
      </Field>
      {COMPONENT_KEYS.map((k) => (
        <Field key={k} label={`${WEIGHT_LABELS[k]} weight`} help={`Default: ${d.weights[k]}.`}>
          <NumberInput value={s.weights[k]} step={0.01} min={-5} onChange={(v) => set({ weights: { ...s.weights, [k]: v } })} />
        </Field>
      ))}
    </>
  );
}

export function SettingsPage() {
  const { settings, setSettings, running } = useApp();
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const setMarket = (patch: Partial<RatingSettings>) => setDraft({ ...draft, market: { ...draft.market, ...patch } });
  const setPbp = (patch: Partial<PbpSettings>) => setDraft({ ...draft, pbp: { ...draft.pbp, ...patch } });

  return (
    <>
      <div className="page-head">
        <h1>Model settings</h1>
        <p className="muted">
          Changes rerun all 25 seasons in your browser (a second or two) and update every page, including the
          strategy lab's backtest. They're saved in this browser only. The nightly pick log always uses the
          defaults, which were tuned on 2003–2015 and checked on 2016 onward (<code>npm run tune</code>).
        </p>
      </div>

      <div className="controls wrap sticky">
        <button type="button" className="primary" disabled={!dirty || running} onClick={() => setSettings(draft)}>
          {running ? "Recalculating…" : "Apply"}
        </button>
        <button type="button" onClick={() => setDraft(DEFAULT_SETTINGS)}>
          Defaults
        </button>
        {dirty && <span className="muted small">Unapplied changes</span>}
      </div>

      <section className="card">
        <h2>Coaching changes</h2>
        <Field
          label="Reset history when the head coach changes"
          help="Includes interim coaches. When off, each franchise keeps one continuous history. On games where a team has under 8 games with its coach, prediction error was 13.81 with a hard reset, 13.68 with carryover 1, and 13.65 with no reset at all."
        >
          <input
            type="checkbox"
            checked={draft.resetOnCoachChange}
            onChange={(e) => setDraft({ ...draft, resetOnCoachChange: e.target.checked })}
          />
        </Field>
      </section>

      <section className="card">
        <h2>Market model</h2>
        <p className="muted small">Closing lines, pulled 30% toward final margins, plus the QB adjustment.</p>
        <MarketFields s={draft.market} set={setMarket} />
      </section>

      <section className="card">
        <h2>Play-by-play model</h2>
        <p className="muted small">
          The Market line plus four efficiency components: each team's opponent-adjusted expected points added
          per play on pass offense, pass defense, rush offense and rush defense. The weights were learned by
          regression on 2003–2015 and belong with the default component settings; if you change how the
          components are fitted, the weights no longer match. On 2016 onward: margin RMSE 12.86 vs 12.90 for
          Market and 12.71 for the closing line. Totals use Market's.
        </p>
        <PbpFields s={draft.pbp} set={setPbp} />
      </section>
    </>
  );
}
