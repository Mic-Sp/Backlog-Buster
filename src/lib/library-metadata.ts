import "server-only";
import { prisma } from "@/lib/prisma";
import { withAbortSignal } from "@/lib/api-resilience";
import { searchRawgGames } from "@/lib/rawg";
import { lookupIgdbSteamGame, searchIgdbGames } from "@/lib/igdb-catalog";
import { tryUpsertCatalogGame } from "@/lib/catalog-store";
import { normalizeGameTitle } from "@/lib/game-title";
import type { CatalogSuggestion } from "@/lib/catalog-types";

export type LibraryMetadata = Pick<CatalogSuggestion, "genre" | "releaseYear" | "coverUrl" | "estimatedHours">;
type MetadataInput = { title: string; steamAppId?: string | null };
export const libraryMetadataKey = (game: MetadataInput) => game.steamAppId ? `steam:${game.steamAppId}` : normalizeGameTitle(game.title);
const BATCH_SIZE = 500;
const PROVIDER_TIMEOUT_MS = 1000;

/** Exact normalized identities only: never repair a title with a similarly named sequel/remake. */
export function matchLibraryMetadata<T extends LibraryMetadata & { title: string }>(title: string, rows: T[]): T | null {
  const key = normalizeGameTitle(title);
  const matches = rows.filter(row => normalizeGameTitle(row.title) === key);
  const dated = matches.filter(row => row.releaseYear !== null);
  if (new Set(dated.map(row => row.releaseYear)).size > 1) return null;
  return dated[0] ?? matches[0] ?? null;
}

async function attempt<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return withAbortSignal(signal, () => work(signal)).catch(() => null);
}

/** Cache first, then bounded RAWG → IGDB attempts; bulk syncs cap remote work at three titles. */
export async function loadLibraryMetadata(inputs: (string | MetadataInput)[], remoteLimit = 3): Promise<Map<string, LibraryMetadata>> {
  const unique = [...new Map(inputs.map(input => {
    const game = typeof input === "string" ? { title: input } : input;
    return [libraryMetadataKey(game), game];
  })).values()];
  const metadata = new Map<string, LibraryMetadata>();
  for (let index = 0; index < unique.length; index += BATCH_SIZE) {
    const batch = unique.slice(index, index + BATCH_SIZE);
    try {
      const rows = await prisma.gameCatalog.findMany({
        where: { title: { in: [...new Set(batch.flatMap(({ title }) => [title, title.replace(/[™®]/g, "").trim(), normalizeGameTitle(title)]))], mode: "insensitive" } },
        select: { title: true, genre: true, releaseYear: true, coverUrl: true, estimatedHours: true },
      });
      for (const game of batch) {
        const match = matchLibraryMetadata(game.title, rows);
        if (match) metadata.set(libraryMetadataKey(game), match);
      }
    } catch { /* The cache is optional; Steam's native data remains usable. */ }
  }
  const missing = unique.filter(game => {
    const cached = metadata.get(libraryMetadataKey(game));
    return !cached || cached.releaseYear === null || !cached.genre;
  }).slice(0, remoteLimit);
  await Promise.all(missing.map(async game => {
    const { title, steamAppId } = game;
    const key = libraryMetadataKey(game);
    const rawg = await attempt(signal => searchRawgGames(title, true, { signal, retry: false }));
    let match = matchLibraryMetadata(title, rawg ?? []);
    if (!match || match.releaseYear === null || !match.genre) {
      const fallback = await attempt(async signal => {
        if (steamAppId) {
          const exact = await lookupIgdbSteamGame(steamAppId, signal);
          if (exact) return exact;
        }
        return matchLibraryMetadata(title, await searchIgdbGames(title.replace(/[™®]/g, "").trim(), signal));
      });
      // A partial RAWG record must not hide IGDB's release year/genre.
      if (fallback) match = match && (!match.releaseYear || !fallback.releaseYear || match.releaseYear === fallback.releaseYear) ? { ...fallback, releaseYear: match.releaseYear ?? fallback.releaseYear,
        genre: match.genre || fallback.genre, estimatedHours: match.estimatedHours ?? fallback.estimatedHours,
        coverUrl: match.coverUrl || fallback.coverUrl } : fallback;
    }
    if (!match) return;
    const cached = metadata.get(key);
    metadata.set(key, { releaseYear: cached?.releaseYear ?? match.releaseYear, genre: cached?.genre || match.genre,
      estimatedHours: cached?.estimatedHours ?? match.estimatedHours, coverUrl: cached?.coverUrl || match.coverUrl });
    // Cache only canonical provider records. Waiting for a cache write must not extend sync's budget.
    const canonical = match;
    void attempt(() => tryUpsertCatalogGame(canonical));
  }));
  return metadata;
}
