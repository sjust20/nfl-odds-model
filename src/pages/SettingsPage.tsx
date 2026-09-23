import { useEffect, useState, type ReactNode } from "react";
import type { ModelKey } from "../model/engine";
import { DEFAULT_SETTINGS, type RatingSettings, type Settings } from "../model/settings";
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

/** The fields shared by both rating models. */
function RatingFields({ model, s, set }: { model: ModelKey; s: RatingSettings; set: (patch: Partial<RatingSettings>) => void }) {
  const d = DEFAULT_SETTINGS[model];
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
        label="Efficiency weight"
        help={`Share taken from play-by-play efficiency (net expected points added). Default: ${d.efficiencyWeight}. Results weight + efficiency weight should stay at or below 1.`}
      >
        <NumberInput value={s.efficiencyWeight} step={0.05} max={1} onChange={(v) => set({ efficiencyWeight: Math.min(1, v) })} />
      </Field>
      <Field label="Efficiency plays" help="Every play, or only while the game was competitive (win probability 10–90%). Every play tested better.">
        <select value={s.efficiency} onChange={(e) => set({ efficiency: e.target.value as RatingSettings["efficiency"] })}>
          <option value="all">Every play</option>
          <option value="neutral">Competitive plays only</option>
        </select>
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

export function SettingsPage() {
  const { settings, setSettings, running } = useApp();
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const setModel = (k: ModelKey) => (patch: Partial<RatingSettings>) => setDraft({ ...draft, [k]: { ...draft[k], ...patch } });

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
        <RatingFields model="market" s={draft.market} set={setModel("market")} />
      </section>

      <section className="card">
        <h2>Play-by-play model</h2>
        <p className="muted small">
          Closing lines, pulled toward efficiency (net expected points added) and final margins, plus the QB
          adjustment. In testing, efficiency added little once the lines were in; the QB adjustment is where
          play-by-play data helped most.
        </p>
        <RatingFields model="pbp" s={draft.pbp} set={setModel("pbp")} />
      </section>
    </>
  );
}
