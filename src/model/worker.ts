/// <reference lib="webworker" />
// Runs the walk-forward models off the main thread (~1s for the full history).
import type { Game } from "../data/types";
import { runModels } from "./engine";
import type { Settings } from "./settings";

let games: Game[] = [];

self.onmessage = (e: MessageEvent<{ id: number; games?: Game[]; settings: Settings }>) => {
  if (e.data.games) games = e.data.games;
  const run = runModels(games, e.data.settings);
  (self as unknown as Worker).postMessage({ id: e.data.id, run });
};
