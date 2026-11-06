import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityPayload } from "@/lib/activity-types";

export const activityGameSelect = {
  id: true, title: true, platform: true, status: true, rating: true,
  hoursPlayed: true, pinnedOrder: true, activityRevision: true,
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
  if (type === "rating_logged") {
    return typeof value.rating === "number" && Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5
      ? { type, metadata: { title, platform, rating: value.rating } } : null;
  }
  return type === "game_started" || type === "game_completed" || type === "game_flatlined"
    ? { type, metadata: { title, platform } } : null;
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
  const changed = (typeof data.status === "string" && data.status !== before.status) ||
    (Object.hasOwn(data, "rating") && data.rating !== before.rating);
  const after = await tx.game.update({ where: { id: before.id, userId: actorId },
    data: { ...data, ...(changed ? { activityRevision: { increment: 1 } } : {}) }, select: activityGameSelect });
  const events: NewEvent[] = [];
  const metadata = { title: after.title, platform: after.platform };
  const key = `game:${after.id}:${after.activityRevision}`;
  if (before.status !== after.status) {
    const type = after.status === "Playing" ? "game_started" : after.status === "Completed" ? "game_completed" : after.status === "Flatlined" ? "game_flatlined" : null;
    if (type) events.push({ type, metadata, gameId: after.id, deduplicationKey: `${key}:${type}` });
  }
  // Clearing a rating (including a return to Backlog) stays quiet.
  if (after.rating !== null && after.rating !== before.rating) events.push({ type: "rating_logged",
    metadata: { ...metadata, rating: after.rating }, gameId: after.id, deduplicationKey: `${key}:rating_logged` });
  await appendActivityEvents(tx, actorId, events);
  return after;
}
