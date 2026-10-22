"use client";

import { useState, type FormEvent } from "react";
import type { LibraryGame } from "@/components/GameLibrary";
import { gameDraftDefaults, gameRecordKey, type GameDraft } from "@/lib/game-record";

export default function useGameDrafts(games: LibraryGame[]) {
  const [drafts, setDrafts] = useState<Record<number, { version: string; fields: GameDraft }>>({});
  function getGameDraft(game: LibraryGame) {
    const saved = drafts[game.id];
    return saved?.version === gameRecordKey(game) ? saved.fields : gameDraftDefaults(game);
  }
  function saveDraft(game: LibraryGame, fields: Partial<GameDraft>) {
    const version = gameRecordKey(game);
    setDrafts(current => ({ ...current, [game.id]: { version, fields: { ...(current[game.id]?.version === version ? current[game.id].fields : gameDraftDefaults(game)), ...fields } } }));
  }
  function captureGameDraft(event: FormEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const form = event.target.closest<HTMLFormElement>("form[data-game-editor-id]");
    if (!form) return;
    const game = games.find(game => game.id === Number(form.dataset.gameEditorId));
    if (!game) return;
    const data = new FormData(form);
    const fields: Partial<GameDraft> = {};
    for (const name of Object.keys(gameDraftDefaults(game)) as (keyof GameDraft)[]) {
      const value = data.get(name);
      if (typeof value === "string") fields[name] = value;
    }
    saveDraft(game, fields);
  }
  return { getGameDraft, captureGameDraft, setGameDraftRating: (game: LibraryGame, rating: number | null) => saveDraft(game, { rating: rating === null ? "" : String(rating) }) };
}
