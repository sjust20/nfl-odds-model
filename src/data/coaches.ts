// Corrections to nflverse's head-coach column. nflverse sometimes carries last season's coach
// forward after an offseason hire (2026: ARI, ATL, BUF), which would silently skip a
// coaching reset. Two layers fix that:
//   1. Manual overrides (data/coach-overrides.json): date ranges, always win.
//   2. A nightly check of the current season against ESPN's current head coach.
import type { Game } from "./types";

export interface CoachOverride {
  team: string;
  coach: string;
  /** First game date (inclusive, YYYY-MM-DD). */
  from: string;
  /** Last game date (inclusive); open-ended when omitted. */
  to?: string;
  note?: string;
}

export interface CoachCorrection {
  team: string;
  season: number;
  /** Name(s) nflverse listed. */
  was: string;
  now: string;
  kind: "override" | "espn" | "spelling";
  games: number;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Same person, allowing for small spelling differences ("Klint Kubliak" vs "Klint Kubiak"). */
export function sameCoach(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || editDistance(x, y) <= 2;
}

type Side = "home" | "away";
const coachKey = (s: Side): "homeCoach" | "awayCoach" => (s === "home" ? "homeCoach" : "awayCoach");
const sidesOf = (g: Game, team: string): Side[] =>
  [g.home === team ? "home" : null, g.away === team ? "away" : null].filter((s): s is Side => s !== null);

/** Applies manual overrides in place. Returns what changed and the game sides it now owns. */
export function applyOverrides(games: Game[], overrides: CoachOverride[]) {
  const corrections: CoachCorrection[] = [];
  const locked = new Set<string>(); // `${gameId}:${side}`
  for (const o of overrides) {
    const was = new Set<string>();
    let n = 0;
    let season = 0;
    for (const g of games) {
      if (g.date < o.from || (o.to && g.date > o.to)) continue;
      for (const side of sidesOf(g, o.team)) {
        const k = coachKey(side);
        if (g[k] !== o.coach) was.add(g[k]);
        g[k] = o.coach;
        locked.add(`${g.id}:${side}`);
        n++;
        season = g.season;
      }
    }
    if (was.size) corrections.push({ team: o.team, season, was: [...was].join(", "), now: o.coach, kind: "override", games: n });
  }
  return { corrections, locked };
}

/**
 * Reconciles one season against each team's current head coach (e.g. from ESPN), in place.
 * - Same person spelled differently: respell across all seasons, so no false reset.
 * - Different person: assign them to the team's games from nflverse's last listed change this
 *   season onward (the whole season when nflverse shows one coach throughout).
 */
export function reconcileCurrentCoaches(
  games: Game[],
  season: number,
  current: Record<string, string>,
  locked: Set<string> = new Set(),
): CoachCorrection[] {
  const corrections: CoachCorrection[] = [];
  for (const [team, coach] of Object.entries(current)) {
    const slots = games
      .filter((g) => g.season === season)
      .flatMap((g) => sidesOf(g, team).map((side) => ({ g, side })))
      .filter(({ g, side }) => !locked.has(`${g.id}:${side}`));
    if (!slots.length) continue;
    const names = [...new Set(slots.map(({ g, side }) => g[coachKey(side)]))];
    if (names.includes(coach)) continue;

    const variant = names.find((n) => sameCoach(n, coach));
    if (variant) {
      let n = 0;
      for (const g of games)
        for (const side of sidesOf(g, team))
          if (g[coachKey(side)] === variant && !locked.has(`${g.id}:${side}`)) {
            g[coachKey(side)] = coach;
            n++;
          }
      corrections.push({ team, season, was: variant, now: coach, kind: "spelling", games: n });
      continue;
    }

    // Start of nflverse's last coaching run this season (chronological order).
    const lastName = slots[slots.length - 1].g[coachKey(slots[slots.length - 1].side)];
    let start = slots.length - 1;
    while (start > 0 && slots[start - 1].g[coachKey(slots[start - 1].side)] === lastName) start--;
    const target = slots.slice(start);
    for (const { g, side } of target) g[coachKey(side)] = coach;
    corrections.push({ team, season, was: lastName, now: coach, kind: "espn", games: target.length });
  }
  return corrections;
}
