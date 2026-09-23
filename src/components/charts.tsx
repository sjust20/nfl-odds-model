// Small hand-rolled SVG charts. Specs follow the dataviz guidance: 2px lines, bars capped
// at 24px with a 4px rounded data end, hairline recessive grid, hover tooltips on every mark.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface TipRow {
  label: string;
  value: string;
  /** CSS color for the line key. */
  key?: string;
}

interface TipState {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  // Measure before first paint, then follow resizes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Tooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), width - 190);
  return (
    <div className="tooltip" style={{ left, top: Math.max(tip.y - 12, 0) }} role="status">
      <div className="tooltip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="tooltip-row" key={r.label}>
          {r.key && <span className="line-key" style={{ background: r.key }} />}
          <strong>{r.value}</strong>
          <span className="muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const niceTicks = (lo: number, hi: number, count = 4) => {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
};

/** Path for a bar with a 4px rounded data end and a square baseline end. */
function barPath(x: number, w: number, yBase: number, yEnd: number) {
  const r = Math.min(4, w / 2, Math.abs(yEnd - yBase));
  if (yEnd < yBase) {
    return `M${x},${yBase}V${yEnd + r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yEnd - r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd - r}V${yBase}Z`;
}

export interface ColumnDatum {
  key: string;
  value: number;
  title: string;
  rows: TipRow[];
}

/**
 * Columns diverging from a baseline (0 for cover margins, break-even for win rates):
 * above = positive pole, below = negative pole. Optional overlay line (e.g. rolling average).
 */
export function DivergingColumns({
  data,
  baseline = 0,
  overlay,
  overlayLabel,
  height = 220,
  format = (v: number) => v.toFixed(1),
  refLabel,
  domain,
}: {
  data: ColumnDatum[];
  baseline?: number;
  overlay?: (number | null)[];
  overlayLabel?: string;
  height?: number;
  format?: (v: number) => string;
  refLabel?: string;
  domain?: [number, number];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 12, right: 12, bottom: 22, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const values = [...data.map((d) => d.value), ...(overlay ?? []).filter((v): v is number => v !== null), baseline];
  const [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  const pad = (hi - lo) * 0.06 || 1;
  const y0 = lo - (domain ? 0 : pad);
  const y1 = hi + (domain ? 0 : pad);
  const y = (v: number) => m.top + ih - ((v - y0) / (y1 - y0)) * ih;
  const band = iw / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(24, band - 2));
  const ticks = niceTicks(y0, y1);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)));

  const show = (i: number, clientX: number, clientY: number, el: Element) => {
    const box = el.closest("svg")!.getBoundingClientRect();
    setHover(i);
    const d = data[i];
    const rows = [...d.rows];
    if (overlay && overlayLabel && overlay[i] !== null && overlay[i] !== undefined)
      rows.push({ label: overlayLabel, value: format(overlay[i]!), key: "var(--ink-2)" });
    setTip({ x: clientX - box.left, y: clientY - box.top, title: d.title, rows });
  };

  return (
    <div className="chart" ref={ref} onPointerLeave={() => (setTip(null), setHover(null))}>
      <svg width={width} height={height} role="img" aria-label={refLabel ?? "Column chart"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = m.left + i * band + (band - bw) / 2;
          const up = d.value >= baseline;
          return (
            <g key={d.key}>
              <path
                d={barPath(x, bw, y(baseline), y(d.value))}
                className={`bar ${up ? "pos" : "neg"} ${hover === i ? "hovered" : ""}`}
              />
              {/* hit target: the full band, full height */}
              <rect
                x={m.left + i * band}
                y={m.top}
                width={band}
                height={ih}
                fill="transparent"
                tabIndex={0}
                onPointerMove={(e) => show(i, e.clientX, e.clientY, e.currentTarget)}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  show(i, r.left + r.width / 2, r.top, e.currentTarget);
                }}
                onBlur={() => (setTip(null), setHover(null))}
              />
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={height - 6} className="tick" textAnchor="middle">
                  {d.key}
                </text>
              )}
            </g>
          );
        })}
        <line x1={m.left} x2={width - m.right} y1={y(baseline)} y2={y(baseline)} className="baseline" />
        {refLabel && (
          <text x={width - m.right} y={y(baseline) - 5} className="tick" textAnchor="end">
            {refLabel}
          </text>
        )}
        {overlay && (
          <path
            className="overlay-line"
            d={overlay
              .map((v, i) => (v === null ? "" : `${i && overlay[i - 1] !== null ? "L" : "M"}${m.left + i * band + band / 2},${y(v)}`))
              .join("")}
          />
        )}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

export interface LinePoint {
  label: string;
  value: number;
}

/** Single-series line with a snapping crosshair. */
export function LineChart({
  points,
  height = 200,
  format = (v: number) => v.toFixed(1),
  seriesLabel,
  markers,
}: {
  points: LinePoint[];
  height?: number;
  format?: (v: number) => string;
  seriesLabel: string;
  /** Indexes to annotate with a vertical hairline (e.g. season starts). */
  markers?: { index: number; label: string }[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const m = { top: 14, right: 16, bottom: 18, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  if (points.length === 0)
    return (
      <div className="chart" ref={ref}>
        <p className="muted">No data yet.</p>
      </div>
    );
  const vals = points.map((p) => p.value);
  const lo = Math.min(0, ...vals);
  const hiV = Math.max(0, ...vals);
  const pad = (hiV - lo) * 0.08 || 1;
  const y = (v: number) => m.top + ih - ((v - (lo - pad)) / (hiV + pad - (lo - pad))) * ih;
  const x = (i: number) => m.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const ticks = niceTicks(lo - pad, hiV + pad);

  const move = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const px = clientX - box.left;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.left) / iw) * (points.length - 1))));
    setHi(i);
    setTip({
      x: x(i),
      y: y(points[i].value),
      title: points[i].label,
      rows: [{ label: seriesLabel, value: format(points[i].value), key: "var(--pos)" }],
    });
  };

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={seriesLabel}
        tabIndex={0}
        onPointerMove={(e) => move(e.clientX, e.currentTarget)}
        onPointerLeave={() => (setTip(null), setHi(null))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          const i = Math.max(0, Math.min(points.length - 1, (hi ?? points.length - 1) + (e.key === "ArrowLeft" ? -1 : 1)));
          const box = e.currentTarget.getBoundingClientRect();
          move(box.left + x(i), e.currentTarget);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? "baseline" : "grid"} />
            <text x={m.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {markers?.map((mk) => (
          <g key={mk.index}>
            <line x1={x(mk.index)} x2={x(mk.index)} y1={m.top} y2={m.top + ih} className="grid" />
            <text x={x(mk.index) + 4} y={height - 4} className="tick">
              {mk.label}
            </text>
          </g>
        ))}
        <path className="series-line" d={points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join("")} />
        <circle cx={x(points.length - 1)} cy={y(vals[vals.length - 1])} r={4} className="end-dot" />
        {hi !== null && (
          <>
            <line x1={x(hi)} x2={x(hi)} y1={m.top} y2={m.top + ih} className="crosshair" />
            <circle cx={x(hi)} cy={y(points[hi].value)} r={4} className="end-dot" />
          </>
        )}
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Inline trend, no axes. */
export function Sparkline({ values, width = 80, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted">–</span>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = (v: number) => height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  return (
    <svg width={width} height={height} aria-hidden="true" className="sparkline">
      <path d={values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("")} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} />
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; kind: "pos" | "neg" | "line" }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span className={`swatch ${i.kind}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="tile-note">{note}</div>}
    </div>
  );
}
