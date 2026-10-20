import type { LibraryGame } from "@/components/GameLibrary";

const fields = [
  "title", "platform", "status", "wasFlatlined", "pinnedOrder", "backlogOrder", "lengthHours", "hoursPlayed", "difficulty",
  "earnedXp", "rating", "notes", "genre", "franchise", "releaseYear", "chronologicalOrder", "coverUrl",
] as const;

export function serializeLibraryBackup(games: LibraryGame[], format: "json" | "csv") {
  const records = games.map((game) => Object.fromEntries(fields.map((field) => [
    field, field === "coverUrl"
      ? (game.backupCoverUrl !== undefined ? game.backupCoverUrl : game.coverUrl)
      : game[field],
  ])));
  if (format === "json") return JSON.stringify(records, null, 2);
  const escapeCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [fields.join(","), ...records.map((game) => fields.map((field) => escapeCell(game[field])).join(","))].join("\r\n");
}
