import type { Game } from "./types";

/**
 * A team's starting QB for one game. For played games that's the QB on the team's first dropback
 * (who the market priced; it also corrects nflverse's occasional wrong listings). For upcoming
 * games it's nflverse's listed (projected) starter.
 */
export interface QbStatus {
  id: string;
  name: string;
  source: "first snap" | "listed";
  /** The team's starter in its previous game. */
  prev: string | null;
  /** Different starter from the previous game (injury, benching, or a starter returning). */
  changed: boolean;
}

export type GameQbs = { home: QbStatus | null; away: QbStatus | null };

/** Starting-QB status for every game with a known starter, walking each team's games in order. */
export function qbStatus(games: Game[]): Map<string, GameQbs> {
  // Full names from the listings, keyed by player id (play-by-play only has "C.Rush"-style names).
  const names = new Map<string, string>();
  for (const g of games) for (const q of [g.homeQb, g.awayQb]) if (q) names.set(q.id, q.name);

  const last = new Map<string, { id: string; name: string }>();
  const out = new Map<string, GameQbs>();
  const side = (g: Game, s: "home" | "away"): QbStatus | null => {
    const team = g[s];
    const st = g.pbp?.[s]?.st;
    const listed = s === "home" ? g.homeQb : g.awayQb;
    const starter =
      g.homeScore !== null && st
        ? { id: st[0], name: names.get(st[0]) ?? st[1], source: "first snap" as const }
        : listed
          ? { id: listed.id, name: listed.name, source: "listed" as const }
          : null;
    if (!starter) return null;
    const prev = last.get(team) ?? null;
    last.set(team, starter);
    return { ...starter, prev: prev?.name ?? null, changed: prev !== null && prev.id !== starter.id };
  };
  for (const g of games) {
    const home = side(g, "home");
    const away = side(g, "away");
    if (home || away) out.set(g.id, { home, away });
  }
  return out;
}

/** True when both starters are known and neither team changed QB. */
export const noQbChange = (q: GameQbs | undefined | null) =>
  !!q && !!q.home && !!q.away && !q.home.changed && !q.away.changed;
