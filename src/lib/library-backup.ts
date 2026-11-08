import type { LibraryGame } from "@/components/GameLibrary";
import { journalDateInput } from "@/lib/play-journal";
import type { CustomListData } from "@/lib/custom-list-types";

const fields = [
  "title", "platform", "status", "wasFlatlined", "pinnedOrder", "backlogOrder", "lengthHours", "hoursPlayed", "difficulty",
  "earnedXp", "rating", "notes", "review", "reviewSpoiler", "genre", "franchise", "releaseYear", "chronologicalOrder", "coverUrl",
  "startedAt", "completedAt", "ownershipType", "playthroughCount",
  "steamAppId", "steamRecentMinutes", "steamLastSyncedAt", "steamAchievementsUnlocked", "steamAchievementsTotal", "steamAchievementsCheckedAt", "steamAchievementsSyncedAt",
] as const;

export function serializeLibraryBackup(games: (Omit<Pick<LibraryGame, typeof fields[number]>, "startedAt" | "completedAt"> & { startedAt?: Date | string | null; completedAt?: Date | string | null; backupCoverUrl?: string | null })[], format: "json" | "csv") {
  const records = games.map((game) => Object.fromEntries(fields.map((field) => [
    field, field === "coverUrl"
      ? (game.backupCoverUrl !== undefined ? game.backupCoverUrl : game.coverUrl)
      : field === "startedAt" || field === "completedAt" ? journalDateInput(game[field]) || null
      : game[field] instanceof Date ? game[field].toISOString() : game[field],
  ])));
  if (format === "json") return JSON.stringify(records, null, 2);
  const escapeCell = (value: unknown) => {
    // Prevent spreadsheet formula execution when a shared CSV is opened in Excel/Sheets.
    const cell = String(value ?? "");
    const safe = typeof value === "string" && /^(?:\s*[=+@-]|[\t\r])/.test(cell) ? `'${cell}` : cell;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [fields.join(","), ...records.map((game) => fields.map((field) => escapeCell(game[field])).join(","))].join("\r\n");
}

/** Portable references are array offsets, never account IDs or database game IDs. */
export function serializeLibraryArchive(games: (Parameters<typeof serializeLibraryBackup>[0][number] & { id: number })[], lists: CustomListData[]) {
  const gameIndexes = new Map(games.map((game, index) => [game.id, index]));
  if (!lists.length) return serializeLibraryBackup(games, "json");
  return JSON.stringify({ format: "backlog-buster", version: 2, games: JSON.parse(serializeLibraryBackup(games, "json")),
    customLists: lists.map(list => ({ title: list.title, description: list.description, isRanked: list.isRanked, isPublic: list.isPublic,
      gameIndexes: list.gameIds.flatMap(id => gameIndexes.has(id) ? [gameIndexes.get(id)!] : []) })) }, null, 2);
}
