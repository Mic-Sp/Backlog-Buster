import "server-only";
import { prisma } from "@/lib/prisma";
import { coalesce, withAbortSignal } from "@/lib/api-resilience";
import { searchRawgGames } from "@/lib/rawg";
import { searchIgdbGames } from "@/lib/igdb-catalog";
import type { CatalogSuggestion } from "@/lib/catalog-types";
import { catalogIdentity, catalogSuggestion, tryUpsertCatalogGame } from "@/lib/catalog-store";

export type { CatalogSuggestion } from "@/lib/catalog-types";

const LIMIT = 8;
const TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 256;
const PROVIDER_TIMEOUT_MS = 2000;
function providerAttempt<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return withAbortSignal(signal, () => work(signal));
}
// Process-local by design; bounds memory and shares work across players on this instance.
const cache = new Map<string, { expiresAt: number; items: CatalogSuggestion[] }>();
const select = { title: true, releaseYear: true, platforms: true, genre: true, estimatedHours: true, coverUrl: true } as const;
const identity = catalogIdentity;

export async function searchCatalog(query: string): Promise<CatalogSuggestion[]> {
  if (typeof query !== "string") return [];
  const clean = query.trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 120 || /[\u0000-\u001f\u007f]/.test(clean)) return [];
  const key = clean.toLowerCase();
  try {
    const items = await coalesce(`catalog-search:${key}`, async () => {
      const now = Date.now();
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) return hit.items;
      let local: CatalogSuggestion[] = [];
      try {
        local = await prisma.gameCatalog.findMany({
          where: { title: { contains: clean, mode: "insensitive" } },
          select, take: LIMIT, orderBy: [{ title: "asc" }, { releaseYear: "desc" }],
        });
      } catch { /* A missing table or offline database must not block search. */ }
      let remote = [] as Awaited<ReturnType<typeof searchRawgGames>>;
      if (local.length < LIMIT) {
        remote = await providerAttempt(signal => searchRawgGames(clean, true, { signal, retry: false })).catch(() => []);
        if (!remote.length) {
          remote = await providerAttempt(signal => searchIgdbGames(clean, signal)).catch(() => []);
        }
      }
      const unique = new Map<string, CatalogSuggestion>();
      for (const game of [...local, ...remote]) {
        if (!unique.has(identity(game))) unique.set(identity(game), game);
      }
      // Exact and prefix matches lead; ties preserve local/provider relevance order.
      const rank = (game: CatalogSuggestion) => game.title.toLowerCase() === key ? 0 : game.title.toLowerCase().startsWith(key) ? 1 : 2;
      const results = [...unique.values()].sort((a, b) => rank(a) - rank(b)).slice(0, LIMIT);
      if (remote.length) {
        try {
          // Only canonical provider results are persisted, never player library data.
          // Bounded batches; metadata and each vector commit together.
          for (let offset = 0; offset < remote.length; offset += 3) {
            await Promise.all(remote.slice(offset, offset + 3).map(tryUpsertCatalogGame));
          }
        } catch { /* Cache writes are optional, including before schema deployment. */ }
      }
      for (const [entry, value] of cache) if (value.expiresAt <= now) cache.delete(entry);
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      // Cache fallbacks and empty results too, avoiding retries on every backspace.
      const suggestions = results.map(catalogSuggestion);
      cache.set(key, { expiresAt: Date.now() + TTL_MS, items: suggestions });
      return suggestions;
    });
    return structuredClone(items);
  } catch { return []; }
}
