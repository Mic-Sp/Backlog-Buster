import "server-only";
import { resilientFetch } from "@/lib/api-resilience";
import { RateLimitError } from "@/lib/action-result";

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
