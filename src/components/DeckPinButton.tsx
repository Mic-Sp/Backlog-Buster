"use client";

import { useLayoutCopy } from "@/components/LayoutText";

import { useContext } from "react";
import { DeckPinsContext, useDeckPins, type DeckPinsController } from "@/components/useDeckPins";
import { DECK_CAPACITY } from "@/lib/deck";
import { isReleasedYear } from "@/lib/game-release";

export type DeckPinButtonProps = {
  gameId: number;
  pinnedOrder: number | null;
  pinnedCount: number;
  releaseYear: number | null | undefined;
  unpinOnly?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
};

export default function DeckPinButton(props: DeckPinButtonProps) {
  const pins = useContext(DeckPinsContext);
  return pins ? <DeckPinControl {...props} pins={pins} /> : <StandaloneDeckPinButton {...props} />;
}

function StandaloneDeckPinButton(props: DeckPinButtonProps) {
  const pins = useDeckPins();
  return <DeckPinControl {...props} pins={pins} />;
}

function DeckPinControl({ gameId, pinnedOrder, pinnedCount, releaseYear, unpinOnly = false, disabled = false, iconOnly = false, pins }: DeckPinButtonProps & { pins: DeckPinsController }) {
  const copy = useLayoutCopy();
  const { isPending } = pins;
  const error = pins.errors[gameId] ?? "";
  const pinned = pinnedOrder !== null;
  const full = !pinned && pinnedCount >= DECK_CAPACITY;
  const unreleased = !pinned && !isReleasedYear(releaseYear);
  const title = unreleased ? copy("Upcoming or undated gigs cannot be pinned. Set a valid release year first.", "Unreleased or undated quests cannot be equipped. Set a valid release year first.")
    : full ? copy("Deck full (3/3). Unpin a gig to make room.", "All 3 C-Buttons are equipped. Unequip a quest to make room.")
    : iconOnly ? (pinned ? copy("Pinned (Click to unpin)", "Equipped (Click to unequip)") : copy("Pin to Up Next Deck", "Equip to a C-Button"))
      : pinned ? copy(`Remove this gig from deck slot ${pinnedOrder}`, `Unequip this quest from C-Button ${pinnedOrder}`) : copy("Stage this Backlog gig for later", "Equip this Backlog quest for your next journey");

  function togglePin() {
    if (isPending || full || disabled || unreleased) return;
    pins.togglePin(gameId, !pinned);
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
        {iconOnly ? "📌" : isPending ? "UPDATING…" : unpinOnly ? copy("✕ UNPIN", "✕ UNEQUIP") : pinned ? copy("📌 PINNED", "✦ EQUIPPED") : copy("📌 PIN TO DECK", "✦ EQUIP QUEST")}
      </button>
      {error && <span className={iconOnly ? "quest-sr-only" : "deck-pin-error"} role="alert">{error}</span>}
    </>
  );
}
