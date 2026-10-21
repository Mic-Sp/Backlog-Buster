import "server-only";

import { prisma } from "@/lib/prisma";
import { achievementDefinitions } from "@/lib/achievements";
import { calculateLevelProgress } from "@/lib/player-level";
import { calculateLibraryTelemetry } from "@/lib/library-telemetry";
import { dossierIdentityFromProfile, type DossierCardData, type DossierIdentity } from "@/lib/dossier";
import { customAvatarUrl } from "@/lib/operator-avatar";
import { fetchDossierArtwork } from "@/lib/dossier-artwork";
import { resizeRawgImageUrl } from "@/lib/rawg";

export type PublicDossier = { identity: DossierIdentity; card: DossierCardData };

export async function getPublicDossier(value: unknown): Promise<PublicDossier | null> {
  if (typeof value !== "string") return null;
  let handle: string;
  try { handle = decodeURIComponent(value).trim().toLowerCase(); }
  catch { return null; }
  // Underscores remain supported for handles created by the original signup form.
  if (!/^[a-z0-9_-]{3,32}$/.test(handle)) return null;
  const lookupHandle = handle.replace(/_/g, "\\_");
  // Explicit projections: never retrieve credentials, sessions, notes, or full library records.
  const profile = await prisma.player.findFirst({
    where: { handle: { equals: lookupHandle, mode: "insensitive" } },
    select: {
      operatorName: true, handle: true, tagline: true, neonAccent: true, avatarUrl: true, featuredTrophyIds: true,
      games: { select: { status: true, lengthHours: true, hoursPlayed: true, rating: true, earnedXp: true } },
      userAchievements: { select: { achievementKey: true, xpAwarded: true, unlockedAt: true } },
    },
  });
  if (!profile || profile.handle?.trim().toLowerCase() !== handle) return null;
  const hasSelections = Array.isArray(profile.featuredTrophyIds) && profile.featuredTrophyIds.length > 0;
  const selectedIds = Array.isArray(profile.featuredTrophyIds) ? profile.featuredTrophyIds.slice(0, 3).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647) : [];
  const trophies = await prisma.game.findMany({
    where: {
      player: { handle: { equals: lookupHandle, mode: "insensitive" } }, status: "Completed", rating: 5,
      ...(hasSelections ? { id: { in: selectedIds } } : {}),
    },
    select: { id: true, title: true, platform: true, coverUrl: true, earnedXp: true },
    orderBy: [{ earnedXp: "desc" }, { title: "asc" }, { id: "asc" }], take: 3,
  });
  const publicTrophies = trophies.map(game => ({ id: game.id, title: game.title, platform: game.platform, earnedXp: game.earnedXp, coverUrl: game.coverUrl ? resizeRawgImageUrl(game.coverUrl) : null }));
  const telemetry = calculateLibraryTelemetry(profile.games.map(game => ({ ...game, genre: null, platform: "" })));
  const totalXp = Math.round(profile.games.reduce((sum, game) => sum + game.earnedXp, 0) + profile.userAchievements.reduce((sum, badge) => sum + badge.xpAwarded, 0));
  const savedBadges = new Map(profile.userAchievements.map(badge => [badge.achievementKey, badge]));
  // Read persisted unlocks only. Public visits must never create badges or award XP.
  const achievements = achievementDefinitions.map(definition => {
    const badge = savedBadges.get(definition.key);
    return { ...definition, current: badge ? definition.target : 0, unlocked: Boolean(badge), unlockedAt: badge?.unlockedAt.toISOString() ?? null, xpAwarded: badge?.xpAwarded ?? 0 };
  });
  const counts = { Backlog: 0, Playing: 0, Completed: 0, Flatlined: 0 };
  for (const game of profile.games) if (Object.hasOwn(counts, game.status)) counts[game.status as keyof typeof counts]++;
  // Build a fresh DTO; neither Prisma's nested results nor internal player identifiers reach the client.
  const identity = dossierIdentityFromProfile({
    operatorName: profile.operatorName, handle: profile.handle,
    tagline: profile.tagline, neonAccent: profile.neonAccent === "GOLD" || profile.neonAccent === "MAGENTA" ? profile.neonAccent : "CYAN",
    avatarUrl: profile.avatarUrl, featuredTrophyIds: hasSelections ? profile.featuredTrophyIds as (number | null)[] : [],
  }, publicTrophies);
  return {
    identity,
    card: { level: calculateLevelProgress(totalXp).level, totalXp, counts, activeHours: telemetry.activeHours,
      completionRate: telemetry.completionRate, avgRating: telemetry.avgRating, achievements, trophies: publicTrophies },
  };
}

export async function getPublicDossierArtwork(dossier: PublicDossier): Promise<Record<string, string | null>> {
  const avatar = customAvatarUrl(dossier.identity.avatarUrl);
  const urls = [...new Set([...(avatar ? [avatar] : []), ...dossier.card.trophies.flatMap(game => game.coverUrl ? [game.coverUrl] : [])])];
  return Object.fromEntries(await Promise.all(urls.map(async url => {
    try {
      // Fetch only this public dossier's selected images; the authenticated arbitrary-URL proxy stays private.
      const image = await fetchDossierArtwork(url);
      return [url, `data:${image.contentType};base64,${image.bytes.toString("base64")}`] as const;
    } catch { return [url, null] as const; }
  })));
}
