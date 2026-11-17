"use client";

import { useState, type FormEvent } from "react";
import type { LibraryGame } from "@/components/GameLibrary";
import { gameDraftDefaults, mergeGameDraft, updateGameDraft, type GameDraft } from "@/lib/game-record";

export default function useGameDrafts(games: LibraryGame[]) {
  const [drafts, setDrafts] = useState<Record<number, Partial<GameDraft>>>({});
  function getGameDraft(game: LibraryGame) {
    return mergeGameDraft(game, drafts[game.id]);
  }
  function saveDraft(game: LibraryGame, fields: Partial<GameDraft>) {
    setDrafts(current => ({ ...current, [game.id]: updateGameDraft(game, current[game.id] ?? {}, fields) }));
  }
  function clearGameDraft(gameId: number) {
    setDrafts(current => {
      const next = { ...current };
      delete next[gameId];
      return next;
    });
  }
  function captureGameDraft(event: FormEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const form = event.target.closest<HTMLFormElement>("form[data-game-editor-id]");
    if (!form) return;
    const game = games.find(game => game.id === Number(form.dataset.gameEditorId));
    if (!game) return;
    // Capture after the child's onChange, and only the edited field. Snapshotting
    // the whole form would turn untouched/stale inputs into dirty overrides.
    const name = event.target.getAttribute("name");
    if (!name || !Object.hasOwn(gameDraftDefaults(game), name)) return;
    const value = new FormData(form).get(name);
    if (name === "reviewSpoiler") saveDraft(game, { reviewSpoiler: value === "true" ? "true" : "false" });
    else if (typeof value === "string") saveDraft(game, { [name]: value });
  }
  return { getGameDraft, captureGameDraft, clearGameDraft, setGameDraftFields: saveDraft, setGameDraftRating: (game: LibraryGame, rating: number | null) => saveDraft(game, { rating: rating === null ? "" : String(rating) }) };
}
