"use client";

import { createContext, useRef, useState, useTransition } from "react";
import { toggleGamePin } from "@/app/actions";

/** Shared by every pin control in a library, including portaled tool results. */
export function useDeckPins() {
  const [isPending, startPinning] = useTransition();
  const inFlight = useRef(new Set<number>());
  const [errors, setErrors] = useState<Record<number, string>>({});

  function togglePin(gameId: number, shouldPin: boolean) {
    if (isPending || inFlight.current.has(gameId)) return;
    inFlight.current.add(gameId);
    setErrors(current => ({ ...current, [gameId]: "" }));
    startPinning(async () => {
      try {
        const result = await toggleGamePin(gameId, shouldPin);
        if (result.error) setErrors(current => ({ ...current, [gameId]: result.error }));
      } catch {
        setErrors(current => ({ ...current, [gameId]: "Could not update your deck. Refresh and try again." }));
      } finally {
        inFlight.current.delete(gameId);
      }
    });
  }

  return { isPending, errors, togglePin };
}

export type DeckPinsController = ReturnType<typeof useDeckPins>;
export const DeckPinsContext = createContext<DeckPinsController | null>(null);
