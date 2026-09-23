import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { OddsFile } from "./data/odds";
import type { PickLogFile } from "./data/pickLog";
import type { GamesFile } from "./data/types";
import type { ModelRun } from "./model/engine";
import type { Strategy } from "./model/metrics";
import { DEFAULT_SETTINGS, type Settings } from "./model/settings";

// Per-viewer preferences only; the site never depends on storage working.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: private mode or storage disabled.
  }
}

/** Files that may legitimately be missing (no odds key configured, no picks logged yet). */
const optional = <T,>(url: string): Promise<T | null> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);

export type BetKind = Strategy["market"];

/** One strategy for sides and one for totals; each drives its own pick column. */
export const DEFAULT_STRATEGIES: Record<BetKind, Strategy> = {
  spread: {
    pick: "model",
    model: "classic",
    market: "spread",
    minEdge: 0,
    maxReliability: 24,
    minGames: 8,
    fromSeason: 2002,
    toSeason: 2100,
  },
  // Mirrors the sides default, using the totals reliability (Sheet3 "Reliability - Total").
  total: {
    pick: "model",
    model: "classic",
    market: "total",
    minEdge: 0,
    maxReliability: 24,
    minGames: 8,
    fromSeason: 2002,
    toSeason: 2100,
  },
};

function loadStrategies(): Record<BetKind, Strategy> {
  const saved = load<Partial<Record<BetKind, Strategy>>>("strategies", {});
  // Earlier versions saved a single (sides) strategy under "strategy".
  const legacy = load<Partial<Strategy>>("strategy", {});
  const spread = { ...DEFAULT_STRATEGIES.spread, ...(saved.spread ?? (legacy.market === "spread" ? legacy : {})) };
  const total = { ...DEFAULT_STRATEGIES.total, ...(saved.total ?? (legacy.market === "total" ? legacy : {})) };
  return { spread: { ...spread, market: "spread" }, total: { ...total, market: "total", pick: "model" } };
}

interface AppState {
  data: GamesFile | null;
  pickLog: PickLogFile | null;
  odds: OddsFile | null;
  run: ModelRun | null;
  running: boolean;
  error: string | null;
  settings: Settings;
  setSettings: (s: Settings) => void;
  strategies: Record<BetKind, Strategy>;
  setStrategy: (kind: BetKind, s: Strategy) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<GamesFile | null>(null);
  const [pickLog, setPickLog] = useState<PickLogFile | null>(null);
  const [odds, setOdds] = useState<OddsFile | null>(null);
  const [run, setRun] = useState<ModelRun | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<Settings>(() => {
    const s = load("settings", DEFAULT_SETTINGS);
    return { ...s, classic: { ...DEFAULT_SETTINGS.classic, ...s.classic }, market: { ...DEFAULT_SETTINGS.market, ...s.market } };
  });
  const [strategies, setStrategies] = useState<Record<BetKind, Strategy>>(loadStrategies);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);

  useEffect(() => {
    Promise.all([
      fetch("data/games.json").then((r) => {
        if (!r.ok) throw new Error(`games.json: ${r.status}`);
        return r.json() as Promise<GamesFile>;
      }),
      optional<PickLogFile>("data/pick-log.json"),
      optional<OddsFile>("data/odds.json"),
    ])
      .then(([games, log, book]) => {
        setData(games);
        setPickLog(log);
        setOdds(book);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!data) return;
    let w = worker.current;
    const first = !w;
    if (!w) {
      w = worker.current = new Worker(new URL("./model/worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; run: ModelRun }>) => {
        if (e.data.id !== request.current) return; // a newer request superseded this one
        setRun(e.data.run);
        setRunning(false);
      };
      w.onerror = (e) => setError(e.message);
    }
    setRunning(true);
    const id = ++request.current;
    w.postMessage(first ? { id, games: data.games, settings } : { id, settings });
  }, [data, settings]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const value: AppState = {
    data,
    pickLog,
    odds,
    run,
    running,
    error,
    settings,
    setSettings: (s) => {
      setSettingsState(s);
      save("settings", s);
    },
    strategies,
    setStrategy: (kind, s) => {
      const next = { ...strategies, [kind]: { ...s, market: kind } };
      setStrategies(next);
      save("strategies", next);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
