import type { LibraryGame } from "@/components/GameLibrary";

/** Uncontrolled editors reset only when their saved record changes, in either view. */
export function gameRecordKey(game: LibraryGame) {
  return `${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}-${game.review ?? ""}-${game.reviewSpoiler ?? false}-${game.startedAt ?? ""}-${game.completedAt ?? ""}`;
}

export function gameDraftDefaults(game: LibraryGame) {
  return { status: game.status, lengthHours: String(game.lengthHours), hoursPlayed: String(game.hoursPlayed), difficulty: String(game.difficulty), notes: game.notes ?? "", rating: game.rating === null ? "" : String(game.rating), review: game.review ?? "", reviewSpoiler: String(game.reviewSpoiler ?? false), startedAt: game.startedAt?.slice(0, 10) ?? "", completedAt: game.completedAt?.slice(0, 10) ?? "" };
}
export type GameDraft = ReturnType<typeof gameDraftDefaults>;
