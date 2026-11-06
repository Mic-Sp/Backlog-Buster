import "server-only";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedPlayerId, AuthenticationRequiredError } from "@/lib/player";
import type { IncomingFriendRequests } from "@/lib/social-types";

/** Request identity only. Privacy settings never expose library/profile details here. */
export async function getIncomingFriendRequests(): Promise<IncomingFriendRequests> {
  const viewerId = await getAuthenticatedPlayerId();
  const registered = { email: { not: null }, passwordHash: { not: null } };
  const where = {
    status: "pending" as const, requestedById: { not: viewerId }, blockedByLow: false, blockedByHigh: false,
    OR: [{ playerLowId: viewerId }, { playerHighId: viewerId }], playerLow: registered, playerHigh: registered,
  };
  const identity = { id: true, operatorName: true, handle: true } as const;
  const [total, rows] = await Promise.all([
    prisma.friendship.count({ where }),
    prisma.friendship.findMany({ where, take: 50, orderBy: [{ createdAt: "desc" }, { playerLowId: "asc" }, { playerHighId: "asc" }],
      select: { playerLowId: true, playerHighId: true, createdAt: true,
        playerLow: { select: identity }, playerHigh: { select: identity } },
    }),
  ]);
  if (await getAuthenticatedPlayerId() !== viewerId) throw new AuthenticationRequiredError();
  return { viewerId, total, requests: rows.map(row => ({
    // A cancelled/declined request followed by a new request is a new notification.
    id: `${row.playerLowId}:${row.playerHighId}:${row.createdAt.toISOString()}`,
    requester: row.playerLowId === viewerId ? row.playerHigh : row.playerLow,
  })) };
}
