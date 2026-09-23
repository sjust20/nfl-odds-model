import type { Game } from "../data/types";

/** One unbroken run of games for a team under the same head coach. */
export interface Tenure {
  id: string; // `${team}#${n}`
  team: string;
  coach: string;
  /** Previous tenure of the same team, if any. */
  prev: string | null;
  firstGameId: string;
  firstDate: string;
}

export interface TenureIndex {
  tenures: Map<string, Tenure>;
  /** gameId -> [homeTenureId, awayTenureId] */
  byGame: Map<string, [string, string]>;
  /** team -> tenure of its latest scheduled game (the current regime). */
  current: Map<string, string>;
}

/**
 * Splits each team's schedule into coaching tenures. A tenure is a consecutive run,
 * so a coach who returns later (e.g. an interim rehired full-time after a gap) starts a new one.
 * With `resetOnCoachChange` false every team is a single franchise-long tenure.
 */
export function buildTenures(games: Game[], resetOnCoachChange: boolean): TenureIndex {
  const tenures = new Map<string, Tenure>();
  const byGame = new Map<string, [string, string]>();
  const current = new Map<string, string>();
  const counts = new Map<string, number>();

  const tenureFor = (g: Game, team: string, coach: string): string => {
    const cur = current.get(team);
    if (cur && (!resetOnCoachChange || tenures.get(cur)!.coach === coach)) return cur;
    const n = (counts.get(team) ?? 0) + 1;
    counts.set(team, n);
    const id = `${team}#${n}`;
    tenures.set(id, { id, team, coach, prev: cur ?? null, firstGameId: g.id, firstDate: g.date });
    current.set(team, id);
    return id;
  };

  for (const g of games) {
    byGame.set(g.id, [tenureFor(g, g.home, g.homeCoach), tenureFor(g, g.away, g.awayCoach)]);
  }
  return { tenures, byGame, current };
}
