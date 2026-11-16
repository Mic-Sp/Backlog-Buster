"use client";

import { createContext, useMemo, useRef, useState } from "react";

type HypeGame = { id: number; hypeLevel?: number };
type Change = { baseLevel: number; value: number; pending: boolean; error: string };

export function useHypeMeters(games: readonly HypeGame[]) {
  const [changes, setChanges] = useState<Record<number, Change>>({});
  const inFlight = useRef(new Set<number>());
  const levels = useMemo(() => Object.fromEntries(games.map(game => {
    const saved = game.hypeLevel ?? 2;
    const change = changes[game.id];
    // Accept subsequent server edits after our optimistic write is confirmed.
    const value = change && (change.pending || change.baseLevel === saved || change.value === saved) ? change.value : saved;
    return [game.id, value];
  })), [games, changes]);

  async function cycleHype(gameId: number, fallback: number) {
    if (inFlight.current.has(gameId)) return;
    inFlight.current.add(gameId);
    const previous = levels[gameId] ?? fallback;
    const next = previous === 3 ? 1 : previous + 1;
    const baseLevel = games.find(game => game.id === gameId)?.hypeLevel ?? fallback;
    setChanges(current => ({ ...current, [gameId]: { baseLevel, value: next, pending: true, error: "" } }));
    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypeLevel: next }),
      });
      const result = await response.json();
      if (!response.ok || result?.game?.id !== gameId || result.game.hypeLevel !== next) throw new Error("Hype update failed");
      setChanges(current => ({ ...current, [gameId]: { baseLevel, value: next, pending: false, error: "" } }));
    } catch {
      setChanges(current => ({ ...current, [gameId]: {
        baseLevel, value: previous, pending: false, error: "Could not save hype. Your previous tier was restored. Try again.",
      } }));
    } finally { inFlight.current.delete(gameId); }
  }

  return { levels, changes, cycleHype };
}

export type HypeMetersController = ReturnType<typeof useHypeMeters>;
export const HypeMetersContext = createContext<HypeMetersController | null>(null);
