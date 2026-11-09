import "server-only";
import { queryIgdb } from "@/lib/igdb-api";
import { parseIgdbCatalogGame } from "@/lib/igdb-catalog";
import { parseRawgCatalogGame } from "@/lib/rawg";
import { releaseWindow, type DiscoveryKind } from "@/lib/discovery-feed-types";
import type { ProviderCatalogGame } from "@/lib/catalog-types";

/** One bounded refresh, using existing IGDB OAuth/dispatch/backoff infrastructure. */
export async function fetchDiscoveryProvider(kind: DiscoveryKind, now: Date): Promise<{ games: ProviderCatalogGame[]; source: string }> {
  const window = releaseWindow(now, kind === "popular" ? 180 : 60);
  const today = Math.floor(window.today / 1000) + 86399;
  const start = Math.floor(window.start.getTime() / 1000);
  const end = Math.floor(window.end.getTime() / 1000) + 86399;
  const signal = AbortSignal.timeout(25_000);
  if (process.env.TWITCH_CLIENT_ID?.trim() && process.env.TWITCH_CLIENT_SECRET?.trim()) {
    const fields = "fields id,name,cover.image_id,first_release_date,genres.name,platforms.name;";
    // Separate upcoming/recent slices keep established releases from crowding out anticipation.
    const queries = kind === "radar" ? [
      `${fields} where first_release_date >= ${start} & first_release_date <= ${today} & total_rating_count > 0; sort total_rating_count desc; limit 24;`,
      `${fields} where first_release_date > ${today} & first_release_date <= ${end} & hypes > 0; sort hypes desc; limit 24;`,
    ] : [`${fields} where first_release_date >= ${start} & first_release_date <= ${today} & total_rating_count > 0; sort total_rating_count desc; limit 36;`];
    const rows = await Promise.all(queries.map(query => queryIgdb("games", query, signal)));
    const games = rows.flatMap(result => (result ?? []).flatMap(row => {
      const parsed = parseIgdbCatalogGame(row);
      return parsed ? [parsed] : [];
    }));
    if (games.length) return { games, source: "igdb" };
  }
  const key = process.env.RAWG_API_KEY?.trim();
  if (key && !signal.aborted) {
    try {
      const date = (value: Date) => value.toISOString().slice(0, 10);
      const ranges = kind === "radar" ? [[window.start, new Date(window.today)], [new Date(window.today + 86400000), window.end]]
        : [[window.start, new Date(window.today)]];
      const results = await Promise.all(ranges.map(async ([from, to]) => {
        const query = new URLSearchParams({ key, dates: `${date(from)},${date(to)}`, ordering: "-added", page_size: "24" });
        // No per-card calls or retries on quota errors; failures are cached for the full TTL.
        const response = await fetch(`https://api.rawg.io/api/games?${query}`, {
          cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) { await response.body?.cancel(); return []; }
        const payload: unknown = await response.json();
        const rows = payload && typeof payload === "object" && "results" in payload ? payload.results : null;
        return Array.isArray(rows) ? rows.slice(0, 24).flatMap(row => {
          const game = parseRawgCatalogGame(row);
          return game?.rawgId ? [{ ...game, metadataSource: "rawg" as const }] : [];
        }) : [];
      }));
      if (results.flat().length) return { games: results.flat(), source: "rawg" };
    } catch { /* Offline, unconfigured or rate-limited: use the catalog snapshot. */ }
  }
  return { games: [], source: "local" };
}
