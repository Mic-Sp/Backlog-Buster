import "server-only";

import { registeredPlayerWhere } from "@/lib/auth-policy";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedPlayerId, AuthenticationRequiredError } from "@/lib/player";
import { visibleProfileWhere } from "@/lib/profile-privacy";
import { safeActivityPayload } from "@/lib/activity-events";
import { InputError } from "@/lib/action-result";
import type { ActivityFeedCursor, ActivityFeedPage } from "@/lib/activity-types";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function options(value: unknown): { limit: number; cursor: ActivityFeedCursor | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Choose valid feed options.");
  const input = value as Record<string, unknown>, limit = input.limit ?? 20;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new InputError("Choose a feed limit from 1 to 50.");
  let cursor: ActivityFeedCursor | null = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    const candidate = input.cursor as Record<string, unknown>;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || typeof candidate.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(candidate.id) || typeof candidate.createdAt !== "string" || candidate.createdAt.length > 30 ||
      !Number.isFinite(Date.parse(candidate.createdAt))) throw new InputError("Choose a valid feed cursor.");
    cursor = { id: candidate.id, createdAt: new Date(candidate.createdAt).toISOString() };
  }
  return { limit, cursor };
}

/** Fresh authorization in the query itself; never cache a friend list or another viewer's feed. */
export async function getFriendActivityFeed(input: unknown = {}): Promise<ActivityFeedPage> {
  const viewerId = await getAuthenticatedPlayerId();
  const { limit, cursor } = options(input);
  const rows = await prisma.activityEvent.findMany({
    where: {
      actorId: { not: viewerId }, createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
      actor: { AND: [
        { ...registeredPlayerWhere }, visibleProfileWhere(viewerId),
        { OR: [
          { friendshipsLow: { some: { playerHighId: viewerId, status: "accepted" } } },
          { friendshipsHigh: { some: { playerLowId: viewerId, status: "accepted" } } },
        ] },
      ] },
      ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}),
    },
    select: { id: true, type: true, metadata: true, createdAt: true,
      game: { select: { reviewSpoiler: true } },
      actor: { select: { id: true, handle: true, operatorName: true, avatarUrl: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
  });
  if (await getAuthenticatedPlayerId() !== viewerId) throw new AuthenticationRequiredError();
  const page = rows.slice(0, limit), last = page.at(-1);
  return {
    items: page.flatMap(row => {
      const payload = safeActivityPayload(row.type, row.metadata);
      // Marking a review as a spoiler also shields older immutable snapshots.
      if (payload && "review" in payload.metadata && row.game?.reviewSpoiler) payload.metadata.reviewSpoiler = true;
      return payload ? [{ ...payload, id: row.id, createdAt: row.createdAt.toISOString(), actor: {
        id: row.actor.id, handle: row.actor.handle, operatorName: row.actor.operatorName, avatarUrl: row.actor.avatarUrl,
      } }] : [];
    }),
    nextCursor: rows.length > limit && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null,
  };
}
