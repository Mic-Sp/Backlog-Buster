import "server-only";
import { prisma } from "@/lib/prisma";
import { searchRawgGames } from "@/lib/rawg";
import { getScoutCatalogTitles } from "@/lib/scout-catalog";
import { normalizeGameTitle } from "@/lib/game-title";
import { backfillCatalogVectors, catalogIdentity, upsertCatalogGame } from "@/lib/catalog-store";

/** Operator-only, resumable ingestion. Library titles are lookup inputs, never global metadata. */
export async function seedRecommendationCatalog(options: { limit?: number; after?: string } = {}) {
  const limit = options.limit ?? 250;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error("Seed limit must be from 1 to 5000.");
  if (!process.env.RAWG_API_KEY?.trim()) throw new Error("Catalog seeding requires RAWG_API_KEY.");
  const [library, catalog] = await Promise.all([
    prisma.game.findMany({ select: { title: true, releaseYear: true }, distinct: ["title", "releaseYear"] }),
    prisma.gameCatalog.findMany({ select: { title: true, releaseYear: true } }),
  ]);
  const inputs = new Map<string, { title: string; releaseYear: number | null }>();
  for (const game of [...getScoutCatalogTitles().map(title => ({ title, releaseYear: null })), ...library, ...catalog]) {
    if (typeof game.title !== "string" || !game.title.trim() || game.title.length > 120) continue;
    inputs.set(catalogIdentity(game), game);
  }
  const remaining = [...inputs.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .filter(([key]) => options.after === undefined || key > options.after);
  const batch = remaining.slice(0, limit);
  let seeded = 0, unmatched = 0;
  // Sequential requests bound RAWG traffic; shared resilience handles provider backoff.
  for (const [, input] of batch) {
    const results = await searchRawgGames(input.title, true);
    const matches = new Map(results.filter(game => game.rawgId && normalizeGameTitle(game.title) === normalizeGameTitle(input.title) &&
      (input.releaseYear === null || game.releaseYear === input.releaseYear)).map(game => [game.rawgId, game]));
    const match = matches.size === 1 ? [...matches.values()][0] : null;
    if (!match) { unmatched++; continue; }
    // Fail on persistence errors; do not report a partially committed batch as success.
    await upsertCatalogGame(match);
    seeded++;
  }
  const backfilled = await backfillCatalogVectors();
  return { attempted: batch.length, seeded, unmatched, backfilled,
    // A full rerun retries unmatched inputs. Cursor continuation processes the remaining input set.
    nextAfter: remaining.length > batch.length ? batch[batch.length - 1][0] : null };
}
