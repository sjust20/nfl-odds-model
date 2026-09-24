import { useMemo } from "react";
import type { GameOdds } from "../data/odds";
import { isFinal } from "../data/types";
import { currentWeek } from "../data/week";
import type { Prediction } from "../model/engine";
import { explainBet, type Check, type Explanation } from "../model/explain";
import { evaluate, type BetRecord, type Strategy } from "../model/metrics";
import { useApp } from "../state";
import { atBookLine } from "./WeekDetail";

export interface WeekItem {
  /** Prediction priced at the sportsbook median when the odds feed has the game. */
  p: Prediction;
  book: GameOdds | undefined;
  sides: Explanation;
  totals: Explanation | null;
}

export interface RuleRecord {
  all: BetRecord;
  pre: BetRecord; // 2002-2014
  post: BetRecord; // 2015 on
  /** Average picks per week across the backtest. */
  perWeek: number;
}

/** A rule's full backtest, split at 2015 (the era split used throughout the lab). */
export function ruleRecord(preds: Prediction[], s: Strategy): RuleRecord {
  const all = evaluate(preds, { ...s, fromSeason: 2002, toSeason: 2100 });
  const weeks = new Set(preds.filter((p) => p.game.season >= 2002 && isFinal(p.game)).map((p) => `${p.game.season}-${p.game.week}`));
  const n = all.overall.wins + all.overall.losses + all.overall.pushes;
  return {
    all: all.overall,
    pre: evaluate(preds, { ...s, fromSeason: 2002, toSeason: 2014 }).overall,
    post: evaluate(preds, { ...s, fromSeason: 2015, toSeason: 2100 }).overall,
    perWeek: weeks.size ? n / weeks.size : 0,
  };
}

/** Best available number for one side across books (the line-shopping price). */
export function bestNumber(book: GameOdds | undefined, side: "home" | "away") {
  const offers = (book?.books ?? []).flatMap((b) =>
    b.line === null ? [] : [{ line: b.line, price: side === "home" ? b.homePrice : b.awayPrice, title: b.title }],
  );
  if (!offers.length) return null;
  // Home bettors want the smallest "home favored by"; away bettors the largest. Ties: better price.
  offers.sort((a, b) => (side === "home" ? a.line - b.line : b.line - a.line) || (b.price ?? -999) - (a.price ?? -999));
  return offers[0];
}

export function useWeek() {
  const { run, data, odds, strategies } = useApp();
  return useMemo(() => {
    const preds = run!.predictions;
    const week = currentWeek(data!.games);
    const bookFor = new Map(odds?.games.map((o) => [o.gameId, o]) ?? []);
    const totalsOn = strategies.total.enabled !== false;
    const items: WeekItem[] = (week ? preds.filter((p) => p.game.season === week.season && p.game.week === week.week) : []).map((raw) => {
      const book = bookFor.get(raw.game.id);
      const p = atBookLine(raw, book?.line ?? raw.game.line, book?.total ?? raw.game.total);
      return { p, book, sides: explainBet(p, strategies.spread), totals: totalsOn ? explainBet(p, strategies.total) : null };
    });
    const failedBy = (c: Check) => items.filter((i) => i.sides.failed === c);
    return {
      week,
      items,
      picks: items.filter((i) => i.sides.pick),
      totalPicks: items.filter((i) => i.totals?.pick),
      failedBy,
      linesAsOf: odds?.fetchedAt ?? data!.updatedAt,
      fromBooks: !!odds,
      sidesRecord: ruleRecord(preds, strategies.spread),
      totalsRecord: totalsOn ? ruleRecord(preds, strategies.total) : null,
    };
  }, [run, data, odds, strategies]);
}
