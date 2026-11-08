import "server-only";
import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";
import { getAuthenticatedPlayerId } from "@/lib/player";
import { coalesce, withAbortSignal } from "@/lib/api-resilience";
import { InputError, RateLimitError } from "@/lib/action-result";
import { fetchSteamAchievements, type SteamAchievementCounts } from "@/lib/steam";
import { validSteamAppId } from "@/lib/steam-progress";

export const STEAM_ACHIEVEMENT_BATCH_LIMIT = 6;
export const STEAM_ACHIEVEMENT_REFRESH_MS = 24 * 60 * 60 * 1000;
export const STEAM_ACHIEVEMENT_BATCH_TIMEOUT_MS = 30000;
type Candidate = { steamAppId: string; recentMinutes?: number | null; status?: string; pinnedOrder?: number | null;
  hallOfFame?: boolean; total?: number | null; syncedAt?: Date | null };

export function selectSteamAchievementTargets(games: readonly Candidate[], now = new Date()): Candidate[] {
  const priority = (game: Candidate) => game.status === "Playing" ? 4 : (game.recentMinutes ?? 0) > 0 ? 3 : game.hallOfFame ? 2 : (game.pinnedOrder ?? 0) > 0 ? 1 : 0;
  return [...new Map(games.filter(game => validSteamAppId(game.steamAppId) && priority(game) > 0 &&
    !(game.total != null && game.syncedAt && game.syncedAt.getTime() <= now.getTime() && game.syncedAt.getTime() > now.getTime() - STEAM_ACHIEVEMENT_REFRESH_MS))
    .sort((a, b) => priority(b) - priority(a) || (b.recentMinutes ?? 0) - (a.recentMinutes ?? 0) || Number(a.steamAppId) - Number(b.steamAppId))
    .map(game => [game.steamAppId, game])).values()].slice(0, STEAM_ACHIEVEMENT_BATCH_LIMIT);
}

/** Two workers, six apps, thirty seconds total. Only successful reads become cache entries. */
export async function fetchSteamAchievementBatch(steamId: string, targets: readonly Candidate[]) {
  const result = new Map<string, { checkedAt: Date; counts: SteamAchievementCounts }>();
  if (!targets.length) return result;
  const signal = AbortSignal.timeout(STEAM_ACHIEVEMENT_BATCH_TIMEOUT_MS);
  let next = 0, stopped = false;
  const queue = targets.slice(0, STEAM_ACHIEVEMENT_BATCH_LIMIT);
  async function worker() {
    while (!signal.aborted && !stopped && next < queue.length) {
      const target = queue[next++], checkedAt = new Date();
      try {
        const counts = await withAbortSignal(signal, () => fetchSteamAchievements(steamId, target.steamAppId, signal));
        if (counts) result.set(target.steamAppId, { checkedAt, counts });
      } catch (error) {
        if (error instanceof RateLimitError || (error instanceof Error && "code" in error &&
          ["API_KEY_REJECTED", "MISSING_API_KEY"].includes(String(error.code)))) stopped = true;
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return result;
}

/** Coalesce in-flight requests; cooldown/cache timestamps describe successful reads only. */
export async function refreshSteamGameAchievements(gameId: number) {
  if (!Number.isSafeInteger(gameId) || gameId < 1 || gameId > 2147483647) throw new InputError("Choose a valid Steam-linked game.");
  const userId = await getAuthenticatedPlayerId(), tokenHash = await readSessionHash();
  if (!tokenHash) throw new InputError("Sign in before refreshing Steam progress.");
  return coalesce(`steam-achievements:${userId}:${tokenHash}:${gameId}`, async () => {
    const requestedAt = new Date();
    const [game, session] = await Promise.all([
      prisma.game.findUnique({ where: { id: gameId, userId }, select: { steamAppId: true, steamAchievementsTotal: true, steamAchievementsSyncedAt: true } }),
      prisma.playerSession.findUnique({ where: { tokenHash, userId, expiresAt: { gt: requestedAt },
        player: { email: { not: null }, passwordHash: { not: null } } }, select: { player: { select: { steamId: true } } } }),
    ]);
    if (!session) throw new InputError("Your session expired. Sign in before refreshing Steam progress.");
    const steamId = session.player.steamId;
    if (!game || !validSteamAppId(game.steamAppId) || !steamId) throw new InputError("Link a Steam profile in the Data Vault and sync this game first.");
    const syncedAt = game.steamAchievementsSyncedAt?.getTime();
    if (game.steamAchievementsTotal !== null && syncedAt !== undefined && syncedAt <= requestedAt.getTime() && syncedAt > requestedAt.getTime() - 60000) {
      throw new InputError("Steam achievements were successfully refreshed recently. Wait a minute before refreshing this game again.");
    }
    const appId = game.steamAppId, signal = AbortSignal.timeout(12000);
    let counts: SteamAchievementCounts | null;
    try { counts = await withAbortSignal(signal, () => fetchSteamAchievements(steamId, appId, signal)); }
    catch (error) {
      if (error instanceof InputError || error instanceof RateLimitError) throw error;
      counts = null;
    }
    if (!counts) return { updated: false, message: "Steam achievement progress is unavailable (no stats or a temporary API issue). Last saved progress kept; you can retry now." };
    // Recheck the session/link and prevent an older request overwriting a newer success.
    const saved = await prisma.game.updateMany({ where: { id: gameId, userId, steamAppId: appId,
      OR: [{ steamAchievementsTotal: null }, { steamAchievementsSyncedAt: null }, { steamAchievementsSyncedAt: { lte: requestedAt } }, { steamAchievementsSyncedAt: { gt: new Date(requestedAt.getTime() + 300000) } }],
      player: { steamId, email: { not: null }, passwordHash: { not: null }, sessions: { some: { tokenHash, expiresAt: { gt: new Date() } } } },
    }, data: { steamAchievementsUnlocked: counts.unlocked, steamAchievementsTotal: counts.total,
      steamAchievementsCheckedAt: requestedAt, steamAchievementsSyncedAt: requestedAt } });
    if (!saved.count) throw new InputError("Your session or Steam link changed, or newer progress was saved. Reload before trying again.");
    return { updated: true, message: counts.total ? "Steam achievements synced." : "This game reports no Steam achievements." };
  });
}
