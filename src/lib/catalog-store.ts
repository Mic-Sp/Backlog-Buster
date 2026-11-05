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
  const source = game.metadataSource ?? "rawg";
  const providerId = source === "igdb" ? game.igdbId : game.rawgId;
  if (!Number.isSafeInteger(providerId) || providerId! <= 0 || !game.title.trim()) throw new Error("Catalog ingestion requires a canonical provider game.");
  const key = catalogIdentity(game);
  const now = new Date();
  await prisma.$transaction(async tx => {
    // Serialize same-key updates so concurrent writers cannot leave stale vectors beside new metadata.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-catalog:${key}`}, 0))`;
    // IGDB's sparse autocomplete fields must not erase richer, previously cached evidence.
    const previous = source === "igdb" ? await tx.gameCatalog.findUnique({ where: { key }, select: {
      estimatedHours: true, coverUrl: true, genre: true, genres: true, platforms: true,
      tags: true, seriesHints: true, multiplayer: true, coop: true, onlineCoop: true, localCoop: true,
    } }) : null;
    const merged = previous ? { ...game,
      estimatedHours: game.estimatedHours ?? previous.estimatedHours, coverUrl: game.coverUrl ?? previous.coverUrl,
      genre: game.genre ?? previous.genre, genres: game.genres.length ? game.genres : previous.genres,
      platforms: game.platforms.length ? game.platforms : previous.platforms,
      tags: [...new Set([...previous.tags, ...game.tags])], seriesHints: [...new Set([...previous.seriesHints, ...game.seriesHints])],
      multiplayer: game.multiplayer ?? previous.multiplayer, coop: game.coop ?? previous.coop,
      onlineCoop: game.onlineCoop ?? previous.onlineCoop, localCoop: game.localCoop ?? previous.localCoop,
    } : game;
    const embedding = buildCatalogVector(merged);
    // Explicit projection ensures callers can never spread user IDs, notes, or ratings.
    const data = { ...catalogSuggestion(merged), rawgId: game.rawgId, rawgSlug: game.rawgSlug,
      genres: merged.genres, tags: merged.tags, seriesHints: merged.seriesHints, multiplayer: merged.multiplayer,
      coop: merged.coop, onlineCoop: merged.onlineCoop, localCoop: merged.localCoop,
      metadataSource: source, metadataUpdatedAt: now,
    };
    // IGDB has no RAWG identity: preserve any previously cached RAWG identifiers.
    const { rawgId, rawgSlug, ...publicMetadata } = data;
    await tx.gameCatalog.upsert({ where: { key }, create: { key, ...data },
      update: source === "igdb" ? publicMetadata : { ...publicMetadata, rawgId, rawgSlug } });
    await tx.$executeRaw`
      UPDATE "GameCatalog"
      SET "featureVector" = ${vectorLiteral(embedding.values)}::vector,
          "featureVectorVersion" = ${embedding.version}, "featureContentHash" = ${embedding.contentHash},
          "featureVectorUpdatedAt" = ${now}
      WHERE "key" = ${key}
    `;
  });
}

/** Optional cache writes must not break provider enrichment/autocomplete before schema deployment. */
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
