import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityPayload } from "@/lib/activity-types";
import { normalizeMicroReview } from "@/lib/micro-review";
import { resolvePlayJournal, type PlayJournalEdits } from "@/lib/play-journal";
import { completedRuns, resolvePlaythroughCount } from "@/lib/playthroughs";

export const activityGameSelect = {
  id: true, title: true, platform: true, status: true, rating: true,
  hoursPlayed: true, pinnedOrder: true, activityRevision: true,
  review: true, reviewSpoiler: true,
  startedAt: true, completedAt: true, playthroughCount: true,
} as const;
export type ActivityGame = Prisma.GameGetPayload<{ select: typeof activityGameSelect }>;
type NewEvent = ActivityPayload & { deduplicationKey: string; gameId?: number; achievementId?: number };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  return clean && clean.length <= max ? clean : null;
}

/** Explicit allowlists at both write and read boundaries; no library notes or uploaded JSON. */
export function safeActivityPayload(type: unknown, value: unknown): ActivityPayload | null {
  if (!record(value)) return null;
  if (type === "library_imported") {
    return (value.source === "backup" || value.source === "titles") && typeof value.importedCount === "number" &&
      Number.isSafeInteger(value.importedCount) && value.importedCount > 0 && value.importedCount <= 10000
      ? { type, metadata: { source: value.source, importedCount: value.importedCount } } : null;
  }
  const title = text(value.title, 120);
  if (!title) return null;
  if (type === "achievement_unlocked") {
    return typeof value.achievementKey === "string" && /^[a-z0-9-]{1,64}$/.test(value.achievementKey)
      ? { type, metadata: { achievementKey: value.achievementKey, title } } : null;
  }
  const platform = text(value.platform, 80);
  if (!platform) return null;
  const clears = typeof value.playthroughCount === "number" && Number.isInteger(value.playthroughCount) &&
    value.playthroughCount >= 1 && value.playthroughCount <= 99 ? { playthroughCount: value.playthroughCount } : {};
  // Missing/malformed flags fail closed. Started/imported events never carry reviews.
  let reviewFields = {};
  if (type === "rating_logged" || type === "game_completed" || type === "game_flatlined") {
    try {
      const review = normalizeMicroReview(value.review);
      if (review) reviewFields = { review, reviewSpoiler: value.reviewSpoiler !== false };
    } catch { /* Drop an invalid optional snippet while preserving the base event. */ }
  }
  if (type === "rating_logged") {
    return typeof value.rating === "number" && Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5
      ? { type, metadata: { title, platform, rating: value.rating, ...reviewFields } } : null;
  }
  return type === "game_started" || type === "game_completed" || type === "game_flatlined"
    ? { type, metadata: { title, platform, ...reviewFields, ...(type === "game_completed" ? clears : {}) } } : null;
}

/** Must run in the source mutation's transaction. Duplicate deliveries never update old events. */
export async function appendActivityEvents(tx: Prisma.TransactionClient, actorId: string, events: NewEvent[]): Promise<number> {
  if (!events.length) return 0;
  const actor = await tx.player.findFirst({ where: { id: actorId, email: { not: null }, passwordHash: { not: null } }, select: { id: true } });
  if (!actor) return 0; // Page-load achievement checks may still serve the unclaimed local archive.
  const data: Prisma.ActivityEventCreateManyInput[] = events.flatMap(event => {
    const payload = safeActivityPayload(event.type, event.metadata);
    if (!payload || !/^[a-zA-Z0-9:_-]{1,200}$/.test(event.deduplicationKey)) return [];
    return [{ actorId, type: payload.type, metadata: payload.metadata, deduplicationKey: event.deduplicationKey,
      gameId: event.gameId ?? null, achievementId: event.achievementId ?? null }];
  });
  return data.length ? (await tx.activityEvent.createMany({ data, skipDuplicates: true })).count : 0;
}

/** Read and compare under the owner's deck lock, then write state and events atomically. */
export async function updateGameWithActivity(tx: Prisma.TransactionClient, actorId: string, before: ActivityGame, data: Prisma.GameUpdateInput) {
  const status = typeof data.status === "string" ? data.status : before.status;
  const playthroughCount = resolvePlaythroughCount(before, status, typeof data.playthroughCount === "number" ? data.playthroughCount : undefined);
  const newClear = playthroughCount > completedRuns(before);
  const edits: PlayJournalEdits = {};
  for (const field of ["startedAt", "completedAt"] as const) {
    if (Object.hasOwn(data, field)) edits[field] = data[field] as Date | null;
  }
  if (newClear && playthroughCount >= 2 && !Object.hasOwn(edits, "completedAt")) {
    edits.completedAt = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  }
  const journal = resolvePlayJournal(before, status, edits);
  const reviewChanged = (Object.hasOwn(data, "review") && data.review !== (before.review ?? null)) ||
    (Object.hasOwn(data, "reviewSpoiler") && data.reviewSpoiler !== (before.reviewSpoiler ?? false));
  const changed = reviewChanged || playthroughCount !== completedRuns(before) || (typeof data.status === "string" && data.status !== before.status) ||
    (Object.hasOwn(data, "rating") && data.rating !== before.rating);
  const after = await tx.game.update({ where: { id: before.id, userId: actorId },
    data: { ...data, ...journal, playthroughCount, ...(changed ? { activityRevision: { increment: 1 } } : {}) }, select: activityGameSelect });
  const events: NewEvent[] = [];
  const metadata = { title: after.title, platform: after.platform,
    ...(after.playthroughCount > 0 ? { playthroughCount: after.playthroughCount } : {}),
    ...(after.review ? { review: after.review, reviewSpoiler: after.reviewSpoiler !== false } : {}) };
  const key = `game:${after.id}:${after.activityRevision}`;
  if (before.status !== after.status) {
    const type = after.status === "Playing" ? "game_started" : after.status === "Completed" ? "game_completed" : after.status === "Flatlined" ? "game_flatlined" : null;
    if (type) events.push({ type, metadata, gameId: after.id, deduplicationKey: `${key}:${type}` });
  }
  if (newClear && after.playthroughCount >= 2 && !events.some(event => event.type === "game_completed")) {
    events.push({ type: "game_completed", metadata, gameId: after.id, deduplicationKey: `${key}:game_completed` });
  }
  // Clearing a rating (including a return to Backlog) stays quiet.
  if (after.rating !== null && after.rating !== before.rating) events.push({ type: "rating_logged",
    metadata: { ...metadata, rating: after.rating }, gameId: after.id, deduplicationKey: `${key}:rating_logged` });
  // A verdict edited after completion/rating is a new immutable snapshot. Clears stay quiet.
  if (!events.length && reviewChanged && after.review) {
    const type = after.rating != null ? "rating_logged" : after.status === "Completed" ? "game_completed" : after.status === "Flatlined" ? "game_flatlined" : null;
    if (type) events.push({ type, metadata: { ...metadata, ...(type === "rating_logged" ? { rating: after.rating! } : {}) },
      gameId: after.id, deduplicationKey: `${key}:${type}` });
  }
  await appendActivityEvents(tx, actorId, events);
  return after;
}
