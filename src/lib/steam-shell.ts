import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { SteamOpenIDError } from "@/lib/steam-openid-diagnostics";

/** Transfer proof of ownership, never merge or delete player-authored data. */
export async function reclaimEmptySteamShell(tx: Prisma.TransactionClient, shellId: string, steamId: string) {
  const conflict = () => { throw new SteamOpenIDError("conflict", "steam_identity_already_linked"); };
  if (shellId === "default-player") return conflict();
  // Coordinate with library writers and lock the profile while checking its contents.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${shellId}`}, 0))`;
  await tx.$queryRaw`SELECT "id" FROM "Player" WHERE "id" = ${shellId} FOR UPDATE`;
  const empty = {
    id: shellId, steamVerifiedId: steamId, email: null, passwordHash: null, googleId: null, isAdmin: false, isOwner: false,
    AND: [{ OR: [{ steamId: null }, { steamId }] }],
    games: { none: {} }, userAchievements: { none: {} }, customLists: { none: {} },
    friendshipsLow: { none: {} }, friendshipsHigh: { none: {} }, activityEvents: { none: {} },
    recommendationDismissals: { none: {} }, authTokens: { none: {} },
  };
  const released = await tx.player.updateMany({ where: empty, data: {
    steamVerifiedId: null, steamVerifiedAt: null, profileVisibility: "private",
  } });
  if (released.count !== 1) return conflict();
  await tx.playerSession.deleteMany({ where: { userId: shellId } });
  await tx.steamAuthSync.deleteMany({ where: { userId: shellId } });
}
