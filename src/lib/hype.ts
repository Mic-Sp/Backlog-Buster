import { completedRuns } from "@/lib/playthroughs";

export type HypeLevel = 1 | 2 | 3;
export type HypeIntent = {
  hypeLevel?: number; status?: string; hoursPlayed?: number; playthroughCount?: number; rating?: number | null;
};

export function normalizeHypeLevel(value: unknown): HypeLevel {
  return value === 1 || value === 3 ? value : 2;
}

export function hypeSimilarityMultiplier(level: unknown): number {
  return normalizeHypeLevel(level) === 3 ? 1.25 : normalizeHypeLevel(level) === 1 ? .8 : 1;
}

/** Positive anticipation, without overriding a low rating or replay history. */
export function isHypedUnplayed(game: HypeIntent): boolean {
  return game.hypeLevel === 3 && game.status === "Backlog" && completedRuns(game) === 0 &&
    (game.hoursPlayed ?? 0) === 0 && (game.rating == null || Number.isInteger(game.rating) && game.rating >= 4 && game.rating <= 5);
}

/** Preserve sign and cosine bounds; a hype boost must not worsen a negative fit. */
export function weightHypeSimilarity(similarity: number, level: unknown): number {
  if (!Number.isFinite(similarity)) return 0;
  const cosine = Math.max(-1, Math.min(1, similarity));
  const multiplier = hypeSimilarityMultiplier(level);
  return Math.max(-1, Math.min(1, cosine >= 0 ? cosine * multiplier : cosine / multiplier));
}
