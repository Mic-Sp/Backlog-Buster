import type { LibraryGame } from "@/components/GameLibrary";

const fields = [
  "title", "platform", "status", "wasFlatlined", "pinnedOrder", "backlogOrder", "lengthHours", "hoursPlayed", "difficulty",
  "earnedXp", "rating", "notes", "genre", "franchise", "releaseYear", "chronologicalOrder", "coverUrl",
] as const;

export function serializeLibraryBackup(games: (Pick<LibraryGame, typeof fields[number]> & { backupCoverUrl?: string | null })[], format: "json" | "csv") {
  const records = games.map((game) => Object.fromEntries(fields.map((field) => [
    field, field === "coverUrl"
      ? (game.backupCoverUrl !== undefined ? game.backupCoverUrl : game.coverUrl)
      : game[field],
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
