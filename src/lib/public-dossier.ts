import "server-only";

import { prisma } from "@/lib/prisma";
import { achievementDefinitions } from "@/lib/achievements";
import { calculateLevelProgress } from "@/lib/player-level";
import { calculateLibraryTelemetry } from "@/lib/library-telemetry";
import { dossierIdentityFromProfile, resolveDossierShowcase, type DossierCardData, type DossierIdentity } from "@/lib/dossier";
import { customAvatarUrl } from "@/lib/operator-avatar";
import { fetchDossierArtwork } from "@/lib/dossier-artwork";
import { resizeRawgImageUrl } from "@/lib/rawg";
import { escapeLike, isValidHandle, normalizeHandle } from "@/lib/handle-validation";
import { getOptionalAuthenticatedPlayerId } from "@/lib/player";
import { visibleProfileWhere } from "@/lib/profile-privacy";
import type { ProfileVisibility } from "@/lib/friendship-types";

export type PublicDossier = { identity: DossierIdentity; card: DossierCardData; visibility: ProfileVisibility };

export async function getPublicDossier(value: unknown): Promise<PublicDossier | null> {
  if (typeof value !== "string") return null;
  let handle: string;
  try { handle = normalizeHandle(decodeURIComponent(value)); }
  catch { return null; }
  if (!isValidHandle(handle)) return null;
  const lookupHandle = escapeLike(handle);
  const viewerId = await getOptionalAuthenticatedPlayerId();
  const audience = visibleProfileWhere(viewerId);
  // Explicit projections: never retrieve credentials, sessions, notes, or full library records.
  const profile = await prisma.player.findFirst({
    where: { handle: { equals: lookupHandle, mode: "insensitive" }, ...audience },
    select: {
      profileVisibility: true,
      operatorName: true, handle: true, tagline: true, neonAccent: true, avatarUrl: true, featuredTrophyIds: true,
      games: { select: { status: true, lengthHours: true, hoursPlayed: true, rating: true, earnedXp: true } },
      userAchievements: { select: { achievementKey: true, xpAwarded: true, unlockedAt: true } },
    },
  });
  if (!profile || profile.handle?.trim().toLowerCase() !== handle) return null;
  const selectedIds = Array.isArray(profile.featuredTrophyIds) ? profile.featuredTrophyIds.slice(0, 3).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647) : [];
  const owner = { player: { handle: { equals: lookupHandle, mode: "insensitive" as const }, ...audience } };
  const select = { id: true, title: true, platform: true, coverUrl: true, earnedXp: true, review: true, reviewSpoiler: true } as const;
  const [favorites, trophies] = await Promise.all([
    selectedIds.length ? prisma.game.findMany({ where: { ...owner, id: { in: selectedIds } }, select, take: 3 }) : [],
    prisma.game.findMany({ where: { ...owner, status: "Completed", rating: 5 }, select,
      orderBy: [{ earnedXp: "desc" }, { title: "asc" }, { id: "asc" }], take: 3 }),
  ]);
  // Return only the three displayed games, never the rest of the player's library.
  const slots = resolveDossierShowcase(Array.isArray(profile.featuredTrophyIds) ? profile.featuredTrophyIds : [], favorites, trophies);
  const publicGames = slots.flatMap(slot => slot ? [{ id: slot.game.id, title: slot.game.title, platform: slot.game.platform, earnedXp: slot.game.earnedXp, coverUrl: slot.game.coverUrl ? resizeRawgImageUrl(slot.game.coverUrl) : null,
    // Spoiler text is omitted from the public DTO and exported SVG entirely.
    review: slot.game.reviewSpoiler === false ? slot.game.review ?? null : null,
    reviewSpoiler: Boolean(slot.game.review) && slot.game.reviewSpoiler !== false,
  }] : []);
  const publicTrophies = publicGames.filter(game => slots.some(slot => slot?.game.id === game.id && !slot.pinned));
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
    avatarUrl: profile.avatarUrl, featuredTrophyIds: slots.map(slot => slot?.pinned ? slot.game.id : null),
  }, publicGames);
  return {
    visibility: profile.profileVisibility,
    identity,
    card: { level: calculateLevelProgress(totalXp).level, totalXp, counts, activeHours: telemetry.activeHours,
      completionRate: telemetry.completionRate, avgRating: telemetry.avgRating, achievements, trophies: publicTrophies, showcaseGames: publicGames },
  };
}

export async function getPublicDossierArtwork(dossier: PublicDossier): Promise<Record<string, string | null>> {
  const avatar = customAvatarUrl(dossier.identity.avatarUrl);
  const slots = resolveDossierShowcase(dossier.identity.showcase ?? [], dossier.card.showcaseGames ?? dossier.card.trophies, dossier.card.trophies);
  const urls = [...new Set([...(avatar ? [avatar] : []), ...slots.flatMap(slot => slot?.game.coverUrl ? [slot.game.coverUrl] : [])])];
  return Object.fromEntries(await Promise.all(urls.map(async url => {
    try {
      // Fetch only this public dossier's selected images; the authenticated arbitrary-URL proxy stays private.
      const image = await fetchDossierArtwork(url);
      return [url, `data:${image.contentType};base64,${image.bytes.toString("base64")}`] as const;
    } catch { return [url, null] as const; }
  })));
}
