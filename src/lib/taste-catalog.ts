import "server-only";
import { prisma } from "@/lib/prisma";
import { CATALOG_VECTOR_VERSION } from "@/lib/catalog-vector";
import { matchNegativeTasteCatalogGames, matchTasteCatalogGame, potentialTasteGames,
  type StoredTasteGame, type TasteLibraryGame } from "@/lib/player-taste";

/** Read public stored metadata only. No embedding/provider work on an advisor scan.
 * Keep the full title index for ambiguity checks, but load vectors only for matches.
 */
export async function loadTasteCatalog(games: readonly TasteLibraryGame[], dismissedTitles: readonly string[] = [],
  featuredTrophyIds: unknown = [], includeOwnedGames = false) {
  const titles = await prisma.gameCatalog.findMany({
    where: { featureVectorVersion: CATALOG_VECTOR_VERSION }, select: { key: true, title: true, releaseYear: true },
  });
  const keys = [...new Set([...(includeOwnedGames ? games : potentialTasteGames(games, featuredTrophyIds)).flatMap(game => {
    const match = matchTasteCatalogGame(game, titles);
    return match ? [match.key] : [];
  }), ...matchNegativeTasteCatalogGames(games, titles, dismissedTitles).map(({ row }) => row.key)])];
  const stored = keys.length ? await prisma.$queryRaw<StoredTasteGame[]>`
    SELECT "key", "title", "releaseYear", "genre", "genres", "seriesHints", "estimatedHours", "featureVectorVersion",
      "featureVector"::text AS "vectorText"
    FROM "GameCatalog"
    WHERE "key" IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
      AND "featureVector" IS NOT NULL AND "featureVectorVersion" = ${CATALOG_VECTOR_VERSION}
  ` : [];
  return { titles, stored };
}
