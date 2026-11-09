import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncSteamLibraryForSession, type SteamAutoSyncClaim } from "@/lib/library-vault";

/** Called only after the workspace response; no cookies/headers are read here. */
export async function autoSyncSteamLibrary(userId: string, tokenHash: string): Promise<boolean> {
  if (!userId || !tokenHash || !process.env.STEAM_API_KEY?.trim()) return false;
  try {
    // One atomic database claim handles concurrent tabs, replicas and cold starts.
    // Failures retain the attempt timestamp; manual sync never checks this window.
    const claims = await prisma.$queryRaw<SteamAutoSyncClaim[]>`
      UPDATE "Player" AS player
      SET "steamAutoSyncAttemptedAt" = CURRENT_TIMESTAMP
      WHERE player."id" = ${userId}
        AND player."email" IS NOT NULL AND (player."passwordHash" IS NOT NULL OR player."googleId" IS NOT NULL)
        AND player."steamId" IS NOT NULL AND player."steamId" <> ''
        AND (player."steamLastSyncedAt" IS NULL OR player."steamLastSyncedAt" <= CURRENT_TIMESTAMP - INTERVAL '24 hours')
        AND (player."steamAutoSyncAttemptedAt" IS NULL OR player."steamAutoSyncAttemptedAt" <= CURRENT_TIMESTAMP - INTERVAL '24 hours')
        AND EXISTS (
          SELECT 1 FROM "PlayerSession" AS session
          WHERE session."tokenHash" = ${tokenHash} AND session."userId" = player."id" AND session."expiresAt" > CURRENT_TIMESTAMP
        )
      RETURNING player."steamId", player."steamAutoSyncAttemptedAt" AS "attemptedAt"
    `;
    const claim = claims[0];
    if (!claim) return false;
    await syncSteamLibraryForSession({ identifier: claim.steamId, includeUnplayed: false, updateHoursPlayed: true }, { userId, tokenHash }, claim);
    revalidatePath("/");
    return true;
  } catch {
    // Private profiles, missing sessions, provider cooldowns and database outages
    // must never interrupt the normal workspace or leak credentials into logs.
    return false;
  }
}
