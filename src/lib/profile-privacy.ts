import "server-only";
import type { Prisma } from "@/generated/prisma/client";

/** Apply in the database query, before retrieving any profile or activity data. */
export function visibleProfileWhere(viewerId: string | null): Prisma.PlayerWhereInput {
  if (!viewerId) return { profileVisibility: "public" };
  return { OR: [
    { id: viewerId },
    { AND: [
      { OR: [
        { profileVisibility: "public" },
        { profileVisibility: "friends", OR: [
          { friendshipsLow: { some: { playerHighId: viewerId, status: "accepted" } } },
          { friendshipsHigh: { some: { playerLowId: viewerId, status: "accepted" } } },
        ] },
      ] },
      { friendshipsLow: { none: { playerHighId: viewerId, status: "blocked" } } },
      { friendshipsHigh: { none: { playerLowId: viewerId, status: "blocked" } } },
    ] },
  ] };
}
