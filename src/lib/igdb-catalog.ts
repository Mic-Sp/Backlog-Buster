import "server-only";
import { queryIgdb } from "@/lib/igdb-api";
import type { ProviderCatalogGame } from "@/lib/catalog-types";
import { normalizeFeatureList } from "@/lib/catalog-vector";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function names(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.slice(0, 256).flatMap(entry =>
    record(entry) && typeof entry.name === "string" && entry.name.trim() && entry.name.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(entry.name) ? [entry.name.trim()] : []))] : [];
}

/** Only public IGDB evidence; unknown duration and co-op capabilities stay null. */
export function parseIgdbCatalogGame(value: unknown): ProviderCatalogGame | null {
  if (!record(value) || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0 ||
    typeof value.name !== "string" || /[\u0000-\u001f\u007f]/.test(value.name)) return null;
  const title = value.name.trim().replace(/\s+/g, " ");
  if (!title || title.length > 120) return null;
  const genres = names(value.genres);
  const date = typeof value.first_release_date === "number" && Number.isSafeInteger(value.first_release_date)
    ? new Date(value.first_release_date * 1000).getUTCFullYear() : NaN;
  const imageId = record(value.cover) ? value.cover.image_id : null;
  return {
    title, releaseYear: date >= 1800 && date <= 2100 ? date : null,
    releaseDate: date >= 1800 && date <= 2100 ? new Date((value.first_release_date as number) * 1000).toISOString().slice(0, 10) : null,
    platforms: names(value.platforms), genre: genres[0] ?? null, genres: normalizeFeatureList(genres),
    coverUrl: typeof imageId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(imageId)
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg` : null,
    estimatedHours: null, metadataSource: "igdb", igdbId: value.id, rawgId: null, rawgSlug: null,
    tags: [], seriesHints: [], multiplayer: null, coop: null, onlineCoop: null, localCoop: null,
  };
}

/** Reuses Twitch auth, 401 recovery and the shared IGDB dispatch gate. */
export async function searchIgdbGames(title: string, signal: AbortSignal): Promise<ProviderCatalogGame[]> {
  const rows = await queryIgdb("games",
    `search ${JSON.stringify(title)}; fields id,name,cover.image_id,first_release_date,genres.name,platforms.name; limit 8;`, signal);
  return (rows ?? []).slice(0, 8).flatMap(row => {
    const game = parseIgdbCatalogGame(row);
    return game ? [game] : [];
  });
}

/** Resolve same-name ports/remakes by Steam identity rather than search ranking. */
export async function lookupIgdbSteamGame(steamAppId: string, signal: AbortSignal): Promise<ProviderCatalogGame | null> {
  if (!/^[1-9]\d{0,19}$/.test(steamAppId)) return null;
  // https://api-docs.igdb.com/#external-game — external_game_source replaces category.
  const rows = await queryIgdb("external_games",
    `where external_game_source = 1 & uid = ${JSON.stringify(steamAppId)}; fields game.id,game.name,game.cover.image_id,game.first_release_date,game.genres.name,game.platforms.name; limit 2;`, signal);
  const games = new Map((rows ?? []).flatMap(row => {
    const game = record(row) ? parseIgdbCatalogGame(row.game) : null;
    return game ? [[game.igdbId!, game] as const] : [];
  }));
  return games.size === 1 ? [...games.values()][0] : null;
}
