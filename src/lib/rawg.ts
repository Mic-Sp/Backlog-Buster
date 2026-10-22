import "server-only";
import { resilientFetch } from "@/lib/api-resilience";
import { RateLimitError } from "@/lib/action-result";
import type { CatalogSuggestion } from "@/lib/catalog-types";

export type RawgGameInfo = {
  coverUrl: string | null;
  genre: string | null;
  releaseYear: number | null;
  playtime: number | null;
  platforms: string[];
};

type RawgPlatform = {
  platform?: {
    name?: unknown;
  } | null;
};

type RawgGenre = {
  name?: unknown;
};

type RawgGame = {
  background_image?: unknown;
  genres?: unknown;
  platforms?: unknown;
  playtime?: unknown;
  released?: unknown;
};

type RawgSearchResponse = {
  results?: unknown;
};

export function resizeRawgImageUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.origin === "https://media.rawg.io" &&
      url.pathname.startsWith("/media/") &&
      !url.pathname.startsWith("/media/resize/")
    ) {
      url.pathname = `/media/resize/640/-/${url.pathname.slice("/media/".length)}`;
      return url.toString();
    }
    return value;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? resizeRawgImageUrl(url.toString())
      : null;
  } catch {
    return null;
  }
}

/** Multi-result title search, separate from the existing single-game enrichment. */
export async function searchRawgGames(title: string): Promise<CatalogSuggestion[]> {
  const apiKey = process.env.RAWG_API_KEY?.trim();
  if (!apiKey) return [];
  try {
    const query = new URLSearchParams({ key: apiKey, search: title, page_size: "8" });
    const response = await resilientFetch(`https://api.rawg.io/api/games?${query}`, {
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
    return payload.results.slice(0, 8).flatMap((game): CatalogSuggestion[] => {
      if (!isRecord(game) || typeof game.name !== "string") return [];
      const canonicalTitle = game.name.trim().replace(/\s+/g, " ");
      if (!canonicalTitle || canonicalTitle.length > 120) return [];
      const genres: unknown[] = Array.isArray(game.genres) ? game.genres : [];
      const genre = genres.find((entry) => isRecord(entry) && typeof entry.name === "string" && entry.name.trim());
      const releaseMatch = typeof game.released === "string" ? /^(\d{4})-\d{2}-\d{2}$/.exec(game.released) : null;
      const year = releaseMatch ? Number(releaseMatch[1]) : 0;
      const platforms = Array.isArray(game.platforms) ? game.platforms.flatMap((entry) => {
        const platform = isRecord(entry) && isRecord(entry.platform) ? entry.platform : null;
        return platform && typeof platform.name === "string" && platform.name.trim() ? [platform.name.trim()] : [];
      }) : [];
      return [{
        title: canonicalTitle,
        releaseYear: year >= 1800 && year <= 2100 ? year : null,
        platforms: [...new Set<string>(platforms)],
        genre: isRecord(genre) && typeof genre.name === "string" ? genre.name.trim().slice(0, 80) : null,
        estimatedHours: typeof game.playtime === "number" && Number.isFinite(game.playtime) && game.playtime > 0
          ? Math.min(10000, Math.max(1, Math.round(game.playtime))) : null,
        coverUrl: safeHttpUrl(game.background_image),
      }];
    });
  } catch { return []; }
}

export async function lookupRawgGame(title: string, reportRateLimit = false): Promise<RawgGameInfo | null> {
  const apiKey = process.env.RAWG_API_KEY;

  if (!apiKey || title.trim() === "") {
    return null;
  }

  try {
    const query = new URLSearchParams({
      key: apiKey,
      search: title,
      page_size: "1",
    });
    const response = await resilientFetch(`https://api.rawg.io/api/games?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return null;
    }

    const results = (payload as RawgSearchResponse).results;
    if (!Array.isArray(results) || results.length === 0 || !isRecord(results[0])) {
      return null;
    }

    const game = results[0] as RawgGame;
    const genres = Array.isArray(game.genres) ? game.genres as RawgGenre[] : [];
    const platforms = Array.isArray(game.platforms)
      ? game.platforms as RawgPlatform[]
      : [];
    const releaseMatch = typeof game.released === "string"
      ? /^(\d{4})/.exec(game.released)
      : null;

    return {
      coverUrl: safeHttpUrl(game.background_image),
      genre: typeof genres[0]?.name === "string" ? genres[0].name : null,
      releaseYear: releaseMatch ? Number(releaseMatch[1]) : null,
      playtime: typeof game.playtime === "number" && Number.isFinite(game.playtime)
        ? game.playtime
        : null,
      platforms: platforms.flatMap((entry) => {
        const name = entry?.platform?.name;
        return typeof name === "string" && name.trim() !== ""
          ? [name.trim()]
          : [];
      }),
    };
  } catch (error) {
    if (reportRateLimit && error instanceof RateLimitError) throw error;
    return null;
  }
}
