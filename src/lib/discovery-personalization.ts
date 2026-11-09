import "server-only";
import { prisma } from "@/lib/prisma";
import { loadTasteCatalog } from "@/lib/taste-catalog";
import { CATALOG_VECTOR_VERSION } from "@/lib/catalog-vector";
import { getDismissedRecommendationTitles } from "@/lib/recommendation-dismissals";
import { readCachedDiscoveryFeed } from "@/lib/discovery-feeds";
import { filterDiscoveryCards, type DiscoveryKind, type DiscoverySnapshot } from "@/lib/discovery-feed-types";
import { scoreDiscoveryCards, sagaHistory, type DiscoveryLibraryGame, type FollowedCanon } from "@/lib/discovery-scoring";
import { unseenRadarKeys, type PersonalizedDiscoveryFeed } from "@/lib/discovery-personalization-types";
import { getFranchiseName } from "@/lib/franchise";
import { normalizeFranchiseKey } from "@/lib/franchise-key";
import { readCanon } from "@/lib/saga-chronology-cache";
import type { StoredTasteGame } from "@/lib/player-taste";

export async function personalizeDiscoveryFeed(userId: string, kind: DiscoveryKind, feed: DiscoverySnapshot): Promise<PersonalizedDiscoveryFeed> {
  const [games, player, dismissed, seen, radar] = await Promise.all([
    prisma.game.findMany({ where: { userId }, select: { id: true, title: true, releaseYear: true, status: true, rating: true,
      pinnedOrder: true, platform: true, franchise: true, earnedXp: true, playthroughCount: true, hoursPlayed: true } }),
    prisma.player.findUnique({ where: { id: userId }, select: { featuredTrophyIds: true } }),
    getDismissedRecommendationTitles(userId),
    prisma.radarSeen.findMany({ where: { userId }, select: { catalogKey: true } }).catch(() => []),
    kind === "radar" ? Promise.resolve(feed) : readCachedDiscoveryFeed("radar"),
  ]);
  const featured = player?.featuredTrophyIds ?? [];
  const excluded = [...games.map(game => game.title), ...dismissed];
  const items = filterDiscoveryCards(feed.items, excluded, kind);
  const radarItems = filterDiscoveryCards(radar.items, excluded, "radar");
  const candidateKeys = [...new Set([...items, ...radarItems].map(game => game.key))];
  const slugs = [...new Set(sagaHistory(games).map(game => normalizeFranchiseKey(getFranchiseName(game) ?? "")).filter(Boolean))];
  const [catalog, candidates, canons] = await Promise.all([
    loadTasteCatalog(games, dismissed, featured).catch(() => ({ titles: [], stored: [] })),
    candidateKeys.length ? prisma.$queryRaw<StoredTasteGame[]>`
      SELECT "key", "title", "releaseYear", "genre", "genres", "seriesHints", "estimatedHours", "featureVectorVersion",
        "featureVector"::text AS "vectorText"
      FROM "GameCatalog" WHERE "key" IN (SELECT jsonb_array_elements_text(${JSON.stringify(candidateKeys)}::jsonb))
        AND "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
        AND vector_dims("featureVector") = 128 AND vector_norm("featureVector") > 0
    `.catch(() => []) : [],
    slugs.length ? prisma.franchiseChronology.findMany({ where: { slug: { in: slugs } },
      select: { slug: true, displayName: true, games: true, source: true } }).catch(() => []) : [],
  ]);
  // The full catalog title index keeps remake ambiguity checks consistent with Scout.
  const rows = [...new Map([...catalog.stored, ...candidates].map(row => [row.key, row])).values()];
  const titles = [...new Map([...catalog.titles, ...candidates.map(({ key, title, releaseYear }) => ({ key, title, releaseYear }))]
    .map(row => [row.key, row])).values()];
  const followed: FollowedCanon[] = canons.flatMap(row => {
    const canon = readCanon(row);
    return canon ? [{ slug: row.slug, displayName: row.displayName, games: canon.games }] : [];
  });
  const score = (cards: typeof items) => scoreDiscoveryCards(cards, games as DiscoveryLibraryGame[], rows, titles, dismissed, featured, followed);
  const scored = score(items);
  return { ...feed, items: scored.cards, hasTasteProfile: scored.hasTasteProfile,
    unseenCount: unseenRadarKeys(kind === "radar" ? scored.cards : score(radarItems).cards, seen.map(row => row.catalogKey)).length };
}

export async function readDiscoveryNotifications(userId: string) {
  const snapshot = await readCachedDiscoveryFeed("radar");
  if (!snapshot.items.length) return { unseenCount: 0 };
  const feed = await personalizeDiscoveryFeed(userId, "radar", snapshot);
  return { unseenCount: feed.unseenCount };
}

export async function saveRadarSeen(userId: string, keys: readonly string[]) {
  if (keys.length) await prisma.radarSeen.createMany({ data: [...new Set(keys)].map(catalogKey => ({ userId, catalogKey })), skipDuplicates: true });
}
