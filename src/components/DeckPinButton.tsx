"use client";

import { useState, useTransition } from "react";
import { toggleGamePin } from "@/app/actions";
import { DECK_CAPACITY } from "@/lib/deck";
import { isReleasedYear } from "@/lib/game-release";

export default function DeckPinButton({ gameId, pinnedOrder, pinnedCount, releaseYear, unpinOnly = false, disabled = false, iconOnly = false }: {
  gameId: number;
  pinnedOrder: number | null;
  pinnedCount: number;
  releaseYear: number | null | undefined;
  unpinOnly?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  const [isPending, startPinning] = useTransition();
  const [error, setError] = useState("");
  const pinned = pinnedOrder !== null;
  const full = !pinned && pinnedCount >= DECK_CAPACITY;
  const unreleased = !pinned && !isReleasedYear(releaseYear);
  const title = unreleased ? "Upcoming or undated gigs cannot be pinned. Set a valid release year first."
    : full ? "Deck full (3/3). Unpin a gig to make room."
    : iconOnly ? (pinned ? "Pinned (Click to unpin)" : "Pin to Up Next Deck")
      : pinned ? `Remove this gig from deck slot ${pinnedOrder}` : "Stage this Backlog gig for later";

  function togglePin() {
    if (isPending || full || disabled || unreleased) return;
    setError("");
    startPinning(async () => {
      try {
        const result = await toggleGamePin(gameId, !pinned);
        if (result.error) setError(result.error);
      } catch {
        setError("Could not update your deck. Refresh and try again.");
      }
    });
  }

  return (
    <>
      <button
        className="deck-pin-button"
        type="button"
        data-pinned={pinned}
        data-icon-only={iconOnly || undefined}
        aria-label={iconOnly ? title : undefined}
        aria-pressed={pinned}
        aria-busy={isPending}
        disabled={disabled || isPending || full || unreleased}
        title={iconOnly && error ? error : title}
        onClick={togglePin}
      >
        {iconOnly ? "📌" : isPending ? "UPDATING…" : unpinOnly ? "✕ UNPIN" : pinned ? "📌 PINNED" : "📌 PIN TO DECK"}
      </button>
      {error && <span className={iconOnly ? "quest-sr-only" : "deck-pin-error"} role="alert">{error}</span>}
    </>
  );
}
