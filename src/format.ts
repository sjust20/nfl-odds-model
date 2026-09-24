import { teamName } from "./data/teams";

const MINUS = "−";

export const signed = (x: number, digits = 1) =>
  `${x > 0 ? "+" : x < 0 ? MINUS : ""}${Math.abs(x).toFixed(digits)}`;

export const num = (x: number, digits = 1) => (x < 0 ? MINUS : "") + Math.abs(x).toFixed(digits);

/** `line` = points the home team is favored by. Renders like "GB −4.5". */
export function lineLabel(home: string, away: string, line: number, digits = 1): string {
  const r = Math.round(line * 10 ** digits) / 10 ** digits;
  if (r === 0) return "Pick";
  return r > 0 ? `${home} ${MINUS}${r.toFixed(digits)}` : `${away} ${MINUS}${(-r).toFixed(digits)}`;
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const matchup = (away: string, home: string, neutral = false) =>
  `${teamName(away)} ${neutral ? "vs" : "at"} ${teamName(home)}`;

const MINUS_SIGN = "\u2212";
const halfPoints = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** A team's spread in betting style: "+3", "−3.5", "PK". `line` = points the home team is favored by. */
export function teamSpread(line: number, side: "home" | "away"): string {
  const v = side === "home" ? -line : line;
  if (v === 0) return "PK";
  return `${v > 0 ? "+" : MINUS_SIGN}${halfPoints(Math.abs(v))}`;
}

/** American odds: "−110", "+105". */
export const price = (p: number | null | undefined) => (p == null ? "" : p > 0 ? `+${p}` : `${MINUS_SIGN}${Math.abs(p)}`);

/** "Sun Sep 27 · 1:00 PM ET" from nflverse's date and Eastern kickoff time. */
export function kickoffLabel(date: string, time?: string): string {
  const d = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (!time) return d;
  const [h, m] = time.split(":").map(Number);
  return `${d} · ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
}
