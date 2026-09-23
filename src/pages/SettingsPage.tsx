import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, SPREADSHEET_CLASSIC, type Settings } from "../model/settings";
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

export function SettingsPage() {
  const { settings, setSettings, running } = useApp();
  const [draft, setDraft] = useState<Settings>(settings);
  useEffect(() => setDraft(settings), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const c = draft.classic;
  const m = draft.market;
  const setC = (patch: Partial<Settings["classic"]>) => setDraft({ ...draft, classic: { ...c, ...patch } });
  const setM = (patch: Partial<Settings["market"]>) => setDraft({ ...draft, market: { ...m, ...patch } });

  return (
    <>
      <div className="page-head">
        <h1>Model settings</h1>
        <p className="muted">
          Changes rerun all 25 seasons in your browser (about a second) and update every page, including the
          strategy lab's backtest. They're saved in this browser only. The nightly pick log always uses the
          recommended defaults.
        </p>
      </div>

      <div className="controls wrap sticky">
        <button type="button" className="primary" disabled={!dirty || running} onClick={() => setSettings(draft)}>
          {running ? "Recalculating…" : "Apply"}
        </button>
        <button type="button" onClick={() => setDraft(DEFAULT_SETTINGS)}>
          Recommended defaults
        </button>
        <button
          type="button"
          onClick={() => setDraft({ ...DEFAULT_SETTINGS, resetOnCoachChange: true, classic: SPREADSHEET_CLASSIC })}
        >
          Classic = spreadsheet exactly
        </button>
        {dirty && <span className="muted small">Unapplied changes</span>}
      </div>

      <section className="card">
        <h2>Coaching changes</h2>
        <Field
          label="Reset history when the head coach changes"
          help="Includes interim coaches. When off, each franchise keeps one continuous history."
        >
          <input
            type="checkbox"
            checked={draft.resetOnCoachChange}
            onChange={(e) => setDraft({ ...draft, resetOnCoachChange: e.target.checked })}
          />
        </Field>
        <Field
          label="Market: carryover to a new coach (0 = hard reset)"
          help="How much of the previous regime's recent evidence a new coach starts with. It fades as fast as old games do. On games where a team has under 8 games with its coach, prediction error was 13.81 with a hard reset, 13.68 at 1, 13.66 at 4, and 13.65 with no reset at all. More carryover consistently helped."
        >
          <NumberInput value={m.coachCarryover} step={0.25} onChange={(v) => setM({ coachCarryover: v })} />
        </Field>
      </section>

      <section className="card">
        <h2>Market model</h2>
        <Field label="Recency half-life (weeks)" help="A game's weight halves every this many weeks. Tuned value: 4.">
          <NumberInput value={m.halfLifeWeeks} min={1} onChange={(v) => setM({ halfLifeWeeks: Math.max(1, v) })} />
        </Field>
        <Field label="Offseason carryover" help="Extra weight multiplier for each offseason crossed. Tuned value: 0.3.">
          <NumberInput value={m.seasonCarryover} step={0.05} max={1} onChange={(v) => setM({ seasonCarryover: Math.min(1, v) })} />
        </Field>
        <Field
          label="Results weight"
          help="0 = fit closing lines only (the market's view), 1 = fit final margins only. Tuned value: 0.3."
        >
          <NumberInput value={m.resultWeight} step={0.05} max={1} onChange={(v) => setM({ resultWeight: Math.min(1, v) })} />
        </Field>
        <Field label="Pull toward average (games)" help="Regularization that keeps thin ratings sensible. Tuned value: 0.25.">
          <NumberInput value={m.ridgeGames} step={0.25} onChange={(v) => setM({ ridgeGames: Math.max(0.01, v) })} />
        </Field>
      </section>

      <section className="card">
        <h2>Classic model (the spreadsheet)</h2>
        <Field label="Averaging" help="EMA = the Output - EMA sheet; plain = the Output sheet.">
          <select value={c.variant} onChange={(e) => setC({ variant: e.target.value as "ema" | "sma" })}>
            <option value="ema">EMA (recent games weigh more)</option>
            <option value="sma">Plain average</option>
          </select>
        </Field>
        <Field label="Home-field advantage (points)" help="Split half to each side, as in Sheet3. Spreadsheet: 3.">
          <NumberInput value={c.hfa} step={0.5} onChange={(v) => setC({ hfa: v })} />
        </Field>
        <Field label="Gap factor, same side of average" help="Multiplier on the rating gap. Spreadsheet: 0.5 (AVERAGE).">
          <NumberInput value={c.sameSignFactor} step={0.05} onChange={(v) => setC({ sameSignFactor: v })} />
        </Field>
        <Field label="Gap factor, opposite sides of average" help="Spreadsheet: 0.55. The best-fit value across all games is about 0.56–0.61.">
          <NumberInput value={c.mixedSignFactor} step={0.05} onChange={(v) => setC({ mixedSignFactor: v })} />
        </Field>
        <Field label="Cover EMA warm-up (games)" help="Plain average until this many games. Spreadsheet: 16.">
          <NumberInput value={c.coverMinGames} onChange={(v) => setC({ coverMinGames: Math.round(v) })} />
        </Field>
        <Field label="Other EMA warm-up (games)" help="Same, for line, total and over/under. Spreadsheet: 7.">
          <NumberInput value={c.otherMinGames} onChange={(v) => setC({ otherMinGames: Math.round(v) })} />
        </Field>
        <Field label="Longest EMA span (games)" help="Spreadsheet: 32.">
          <NumberInput value={c.emaCap} min={1} onChange={(v) => setC({ emaCap: Math.max(1, Math.round(v)) })} />
        </Field>
        <Field
          label="Thin-sample blend (games)"
          help="Blend a team's Classic rating toward the Market view, as if the Market view were worth this many games. 0 = spreadsheet exactly. Best tested value: 4 (small improvement)."
        >
          <NumberInput value={c.shrinkGames} onChange={(v) => setC({ shrinkGames: v })} />
        </Field>
      </section>
    </>
  );
}
