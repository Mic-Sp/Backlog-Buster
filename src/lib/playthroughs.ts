import { InputError } from "@/lib/action-result";

export const MAX_PLAYTHROUGHS = 99;
export const REPLAY_TASTE_MULTIPLIER = 1.15;
type ClearHistory = { status?: string; playthroughCount?: number };

/** Legacy Completed records represent one clear, including before the backfill. */
export function completedRuns(game: ClearHistory): number {
  const count = Number.isInteger(game.playthroughCount) ? Math.max(0, Math.min(MAX_PLAYTHROUGHS, game.playthroughCount!)) : 0;
  return Math.max(game.status === "Completed" ? 1 : 0, count);
}

export function parsePlaythroughCount(value: unknown): number {
  const count = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_PLAYTHROUGHS) {
    throw new InputError("Completed runs must be a whole number from 0 to 99.");
  }
  return count;
}

/** Unchanged editor values are not overrides of a completion or a fresher count. */
export function readPlaythroughFields(data: FormData): { playthroughCount?: number } {
  if (!data.has("playthroughCount")) return {};
  const count = parsePlaythroughCount(data.get("playthroughCount"));
  return data.has("playthroughCountOriginal") && data.get("playthroughCount") === data.get("playthroughCountOriginal")
    ? {} : { playthroughCount: count };
}

export function resolvePlaythroughCount(before: ClearHistory, status: string, override?: number): number {
  if (override !== undefined) return Math.max(status === "Completed" ? 1 : 0, parsePlaythroughCount(override));
  const previous = completedRuns(before);
  return status === "Completed" && before.status !== "Completed"
    ? parsePlaythroughCount(previous + 1) : previous;
}

export function replayLabel(count: number, fantasy = false): string {
  return fantasy ? `${count}× CHRONICLED · NEW GAME+` : `NG+ // ${count}× CLEARED`;
}
