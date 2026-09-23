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
