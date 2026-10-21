import { InputError } from "@/lib/action-result";
import { isReleasedYear } from "@/lib/game-release";

export const MAX_IMPORT_BYTES = 500000;
export const MAX_IMPORT_ROWS = 200;
export const MAX_TITLE_ROWS = 25;
export type LibraryImportPayload = { mode: "titles" | "json" | "csv"; content: string; defaultPlatform?: string };

export function validateImportPayload(payload: LibraryImportPayload) {
  if (!payload || !["titles", "json", "csv"].includes(payload.mode) || typeof payload.content !== "string" ||
    new TextEncoder().encode(payload.content).length > MAX_IMPORT_BYTES) {
    throw new InputError("Provide a title list, JSON or CSV backup under 500 KB.");
  }
}

function text(value: unknown, limit: number, required = false): string | null {
  if (value == null) { if (required) throw new InputError("Please input a valid title."); return null; }
  if (typeof value !== "string" || value.trim().length > limit) throw new InputError("Invalid text field.");
  const clean = value.trim();
  if (!clean && required) throw new InputError("Please input a valid title.");
  return clean || null;
}

function number(value: unknown): number | null {
  if (typeof value === "string") {
    value = value.trim();
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(value as string)) return null;
    value = Number(value);
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function integer(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = number(value);
  return parsed === null ? fallback : Math.max(min, Math.min(max, Math.round(parsed)));
}
function optionalInteger(value: unknown, min: number, max: number): number | null {
  return number(value) === null ? null : integer(value, min, max, min);
}

export function sanitizeImportedGame(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Each game must be an object.");
  const game = value as Record<string, unknown>;
  const title = text(game.title, 120, true)!;
  const platform = text(game.platform, 80) ?? "PC";
  const candidate = typeof game.status === "string" ? game.status.trim().toLowerCase() : "";
  const status = ["Backlog", "Playing", "Completed", "Flatlined"].find(status => status.toLowerCase() === candidate) ?? "Backlog";
  const lengthHours = integer(game.lengthHours, 1, 10000, 10);
  const difficulty = integer(game.difficulty, 1, 3, 2);
  const releaseYear = optionalInteger(game.releaseYear, 1800, 2100);
  const rawCover = text(game.coverUrl, 2048);
  let coverUrl: string | null = null;
  if (rawCover) {
    const url = new URL(rawCover);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new InputError("Use a valid HTTP or HTTPS cover URL.");
    coverUrl = url.toString();
  }
  // Deliberate allowlist: uploaded primary keys, ownership and XP are never trusted.
  return {
    title, platform, status, lengthHours, difficulty,
    hoursPlayed: integer(game.hoursPlayed, 0, 10000, 0),
    earnedXp: status === "Completed" ? lengthHours * difficulty * 10 : 0,
    wasFlatlined: status === "Flatlined" || game.wasFlatlined === true || game.wasFlatlined === "true",
    pinnedOrder: status === "Backlog" && isReleasedYear(releaseYear) ? optionalInteger(game.pinnedOrder, 1, 3) : null,
    backlogOrder: optionalInteger(game.backlogOrder, 1, 10000),
    rating: optionalInteger(game.rating, 1, 5),
    notes: text(game.notes, 1000), genre: text(game.genre, 80), franchise: text(game.franchise, 120),
    releaseYear, chronologicalOrder: optionalInteger(game.chronologicalOrder, 1, 10000), coverUrl,
  };
}

// RFC 4180-style reader: quoted commas, escaped quotes and multiline field logs.
export function parseBackupCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ""; closed = false; };
  const finishRow = () => {
    finishCell(); rows.push(row); row = [];
    if (rows.length > MAX_IMPORT_ROWS + 1) throw new InputError("CSV imports support at most 200 games.");
  };
  const input = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ",") finishCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      finishRow();
    } else if (closed || char === '"') throw new InputError("Invalid CSV quoting.");
    else cell += char;
  }
  if (quoted) throw new InputError("Invalid CSV: unterminated quoted field.");
  if (cell || row.length || closed) finishRow();
  const headers = rows.shift()?.map(header => header.trim());
  if (!headers?.includes("title") || new Set(headers).size !== headers.length) throw new InputError("CSV needs a unique title column and no duplicate column names.");
  return rows.map(values => values.length !== headers.length ? {} : Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

export function parseBackupRecords(content: string, mode: "json" | "csv"): unknown[] {
  let parsed: unknown;
  if (mode === "csv") parsed = parseBackupCsv(content);
  else {
    try { parsed = JSON.parse(content); }
    catch { throw new InputError("Invalid JSON. Choose a backup containing an array of games."); }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_IMPORT_ROWS) throw new InputError("A backup import must contain between 1 and 200 games.");
  return parsed;
}
