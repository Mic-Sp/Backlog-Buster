"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedPlayerId } from "@/lib/player";
import { InputError, safeAction } from "@/lib/action-result";
import { getDiscoveryFeed, readCachedDiscoveryFeed } from "@/lib/discovery-feeds";
import type { DiscoveryKind, DiscoveryCard } from "@/lib/discovery-feed-types";
import { saveRecommendationDismissal } from "@/lib/recommendation-dismissals";
import { normalizeGameTitle } from "@/lib/game-title";
import { personalizeDiscoveryFeed, readDiscoveryNotifications, saveRadarSeen } from "@/lib/discovery-personalization";
import { isInterestMatch } from "@/lib/discovery-personalization-types";

function validateKind(kind: DiscoveryKind) {
  if (kind !== "radar" && kind !== "popular") throw new InputError("Choose a discovery tab.");
}
export async function fetchDiscoveryFeed(kind: DiscoveryKind) {
  return safeAction(async () => {
    const userId = await getAuthenticatedPlayerId();
    validateKind(kind);
    const feed = await getDiscoveryFeed(kind);
    return personalizeDiscoveryFeed(userId, kind, feed);
  });
}

export async function actOnDiscoveryCard(kind: DiscoveryKind, key: string, choice: "add" | "dismiss") {
  return safeAction(async () => {
    const userId = await getAuthenticatedPlayerId();
    validateKind(kind);
    if (typeof key !== "string" || !key || key.length > 512 || (choice !== "add" && choice !== "dismiss")) {
      throw new InputError("Choose a valid game and action.");
    }
    // The client supplies only a reference. Never trust client-supplied metadata.
    const feed = await prisma.discoveryFeed.findUnique({ where: { kind }, select: { items: true } });
    const game = (Array.isArray(feed?.items) ? feed.items as DiscoveryCard[] : []).find(item => item.key === key);
    if (!game) throw new InputError("This discovery card has expired. Reopen the tab to refresh it.");
    const result = choice === "dismiss" ? { ...(await saveRecommendationDismissal(game.title)), added: false }
      : await prisma.$transaction(async tx => {
      // Same player lock as imports/deck changes; repeated clicks across tabs are idempotent.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${userId}`}, 0))`;
      const owned = await tx.game.findMany({ where: { userId }, select: { id: true, title: true } });
      const titleKey = normalizeGameTitle(game.title);
      const existing = owned.find(row => normalizeGameTitle(row.title) === titleKey);
      if (existing) return { id: existing.id, titleKey, added: false };
      const created = await tx.game.create({ data: {
        userId, title: game.title, platform: game.platforms[0]?.slice(0, 80) || "PC", status: "Backlog",
        genre: game.genre, releaseYear: game.releaseYear, coverUrl: game.coverUrl,
        lengthHours: game.estimatedHours ?? 10, difficulty: 1, earnedXp: 0,
      }, select: { id: true } });
      return { id: created.id, titleKey, added: true };
    });
    await saveRadarSeen(userId, [key]).catch(() => {});
    // Rebuild the same Rocchio profile after the dismissal commits. No providers,
    // global cache invalidation, or document refresh is needed to rescore the cards.
    const personalized = await readCachedDiscoveryFeed(kind).then(snapshot => personalizeDiscoveryFeed(userId, kind, snapshot)).catch(() => null);
    if (choice === "add") revalidatePath("/");
    return { ...result, personalized };
  });
}

export async function markRadarViewed(keys: readonly string[]) {
  return safeAction(async () => {
    const userId = await getAuthenticatedPlayerId();
    if (!Array.isArray(keys) || keys.length > 48 || keys.some(key => typeof key !== "string" || !key || key.length > 512)) {
      throw new InputError("Choose up to 48 viewed releases.");
    }
    const radar = await personalizeDiscoveryFeed(userId, "radar", await readCachedDiscoveryFeed("radar"));
    const eligible = new Set(radar.items.filter(isInterestMatch).map(game => game.key));
    // A newer snapshot may have arrived since rendering; acknowledge only the
    // submitted, still-eligible keys. Other new releases retain their indicator.
    await saveRadarSeen(userId, keys.filter(key => eligible.has(key)));
    return readDiscoveryNotifications(userId);
  });
}
