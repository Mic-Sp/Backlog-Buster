import type { LibraryGame } from "@/components/GameLibrary";

/** Remount uncontrolled editors on server changes, restoring their dirty fields. */
export function gameRecordKey(game: LibraryGame) {
  return `${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}-${game.review ?? ""}-${game.reviewSpoiler ?? false}-${game.startedAt ?? ""}-${game.completedAt ?? ""}-${game.ownershipType ?? ""}-${game.playthroughCount ?? 0}`;
}

export function gameDraftDefaults(game: LibraryGame) {
  return {
    playthroughCount: String(Math.max(game.status === "Completed" ? 1 : 0, game.playthroughCount ?? 0)),
    status: game.status,
    lengthHours: String(game.lengthHours),
    hoursPlayed: String(game.hoursPlayed),
    difficulty: String(game.difficulty),
    notes: game.notes ?? "",
    rating: game.rating == null ? "" : String(game.rating),
    review: game.review ?? "",
    reviewSpoiler: String(game.reviewSpoiler ?? false),
    startedAt: game.startedAt?.slice(0, 10) ?? "",
    completedAt: game.completedAt?.slice(0, 10) ?? "",
    ownershipType: game.ownershipType ?? "",
    title: game.title,
    platform: game.platform,
    genre: game.genre ?? "",
    franchise: game.franchise ?? "",
    releaseYear: game.releaseYear == null ? "" : String(game.releaseYear),
    chronologicalOrder: game.chronologicalOrder == null ? "" : String(game.chronologicalOrder),
    coverUrl: game.coverUrl ?? "",
  };
}
export type GameDraft = ReturnType<typeof gameDraftDefaults>;

/** Only user-edited fields override refreshed server values. Empty strings are edits too. */
export function mergeGameDraft(game: LibraryGame, edits: Partial<GameDraft> = {}): GameDraft {
  return { ...gameDraftDefaults(game), ...edits };
}

export function updateGameDraft(game: LibraryGame, edits: Partial<GameDraft>, changes: Partial<GameDraft>): Partial<GameDraft> {
  const defaults = gameDraftDefaults(game);
  const next = { ...edits };
  for (const name of Object.keys(changes) as (keyof GameDraft)[]) {
    const value = changes[name];
    if (value === undefined) continue;
    if (value === defaults[name]) delete next[name];
    else next[name] = value;
  }
  return next;
}
