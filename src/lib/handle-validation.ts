export const HANDLE_MAX_LENGTH = 32;
export const HANDLE_INPUT_PATTERN = "[A-Za-z0-9_\\-]{3,32}";
export const HANDLE_HELP = "3–32 letters, numbers, underscores or hyphens.";

export function normalizeHandle(value: string): string { return value.trim().toLowerCase(); }
export function isValidHandle(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{3,32}$/.test(value);
}

/** Prisma's insensitive PostgreSQL filters use LIKE patterns, including equals. */
export function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
