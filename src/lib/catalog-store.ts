import "server-only";
import { prisma } from "@/lib/prisma";
import { buildCatalogVector, vectorLiteral } from "@/lib/catalog-vector";
import type { CatalogSuggestion, ProviderCatalogGame } from "@/lib/catalog-types";

export const catalogIdentity = (game: Pick<CatalogSuggestion, "title" | "releaseYear">) => JSON.stringify([game.title.toLowerCase(), game.releaseYear]);

export function catalogSuggestion(game: CatalogSuggestion): CatalogSuggestion {
  return { title: game.title, releaseYear: game.releaseYear, platforms: game.platforms,
    genre: game.genre, estimatedHours: game.estimatedHours, coverUrl: game.coverUrl };
}

/** Only call with parsed, canonical provider records, never with player-entered metadata. */
export async function upsertCatalogGame(game: ProviderCatalogGame): Promise<void> {
  if (!Number.isSafeInteger(game.rawgId) || game.rawgId! <= 0 || !game.title.trim()) throw new Error("Catalog ingestion requires a canonical RAWG game.");
  const key = catalogIdentity(game);
  const embedding = buildCatalogVector(game);
  const now = new Date();
  // Explicit projection ensures callers can never accidentally spread user IDs, notes, or ratings.
  const data = { ...catalogSuggestion(game), rawgId: game.rawgId, rawgSlug: game.rawgSlug,
    genres: game.genres, tags: game.tags, seriesHints: game.seriesHints, multiplayer: game.multiplayer,
    coop: game.coop, onlineCoop: game.onlineCoop, localCoop: game.localCoop,
    metadataSource: "rawg", metadataUpdatedAt: now,
  };
  await prisma.$transaction(async tx => {
    // Serialize same-key updates so concurrent writers cannot leave stale vectors beside new metadata.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-catalog:${key}`}, 0))`;
    await tx.gameCatalog.upsert({ where: { key }, create: { key, ...data }, update: data });
    await tx.$executeRaw`
      UPDATE "GameCatalog"
      SET "featureVector" = ${vectorLiteral(embedding.values)}::vector,
          "featureVectorVersion" = ${embedding.version}, "featureContentHash" = ${embedding.contentHash},
          "featureVectorUpdatedAt" = ${now}
      WHERE "key" = ${key}
    `;
  });
}

/** Optional cache writes must not break RAWG enrichment/autocomplete before schema deployment. */
export async function tryUpsertCatalogGame(game: ProviderCatalogGame): Promise<boolean> {
  try { await upsertCatalogGame(game); return true; }
  catch { return false; }
}

/** Upgrade legacy vectors without provider calls or copying private library metadata. */
export async function backfillCatalogVectors(): Promise<number> {
  let cursor: string | undefined;
  let count = 0;
  for (;;) {
    const rows = await prisma.gameCatalog.findMany({
      orderBy: { key: "asc" }, take: 100,
      ...(cursor === undefined ? {} : { cursor: { key: cursor }, skip: 1 }),
      select: { key: true },
    });
    if (!rows.length) return count;
    for (const row of rows) {
      // Lock and reread: a concurrent RAWG enrichment must not be overwritten with this page's snapshot.
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-catalog:${row.key}`}, 0))`;
        const fresh = await tx.gameCatalog.findUnique({ where: { key: row.key },
          select: { genre: true, genres: true, tags: true, seriesHints: true, estimatedHours: true, releaseYear: true } });
        if (!fresh) return;
        const embedding = buildCatalogVector(fresh);
        const changed = await tx.$executeRaw`
          UPDATE "GameCatalog"
          SET "featureVector" = ${vectorLiteral(embedding.values)}::vector,
              "featureVectorVersion" = ${embedding.version}, "featureContentHash" = ${embedding.contentHash},
              "featureVectorUpdatedAt" = ${new Date()}
          WHERE "key" = ${row.key} AND ("featureVector" IS NULL OR
            "featureVectorVersion" IS DISTINCT FROM ${embedding.version} OR "featureContentHash" IS DISTINCT FROM ${embedding.contentHash})
        `;
        count += changed;
      });
    }
    cursor = rows[rows.length - 1].key;
  }
}
