import type { Game } from "./types";

export interface QbStatus {
  name: string;
  /** The team's starter in its previous game with a listed QB. */
  prev: string | null;
  /** Different starter from the previous game (injury, benching, or a starter returning). */
  changed: boolean;
}

export type GameQbs = { home: QbStatus | null; away: QbStatus | null };

/** Starting-QB status for every game with a listed starter, walking each team's games in order. */
export function qbStatus(games: Game[]): Map<string, GameQbs> {
  const last = new Map<string, { id: string; name: string }>();
  const out = new Map<string, GameQbs>();
  const side = (team: string, qb: Game["homeQb"]): QbStatus | null => {
    if (!qb) return null;
    const prev = last.get(team) ?? null;
    last.set(team, qb);
    return { name: qb.name, prev: prev?.name ?? null, changed: prev !== null && prev.id !== qb.id };
  };
  for (const g of games) {
    if (!g.homeQb && !g.awayQb) continue;
    out.set(g.id, { home: side(g.home, g.homeQb), away: side(g.away, g.awayQb) });
  }
  return out;
}

/** True when both starters are known and neither team changed QB. */
export const noQbChange = (q: GameQbs | undefined | null) =>
  !!q && !!q.home && !!q.away && !q.home.changed && !q.away.changed;
