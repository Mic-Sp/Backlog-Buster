import "server-only";
import { resilientFetch } from "@/lib/api-resilience";
import { RateLimitError } from "@/lib/action-result";
import type { ProviderCatalogGame } from "@/lib/catalog-types";
import { normalizeFeature, normalizeFeatureList } from "@/lib/catalog-vector";

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

// Hints only, derived from provider titles. Affinity neighbors are not series members.
const seriesPrefixes = ["Star Wars Jedi", "Star Wars Knights of the Old Republic", "Resident Evil", "Final Fantasy",
  "Marvels Spider Man", "Marvel s Spider Man", "The Legend of Zelda", "Dark Souls", "God of War", "Horizon",
  "Mass Effect", "Dragon Age", "Dishonored", "Batman Arkham", "The Witcher", "Divinity Original Sin", "Baldurs Gate",
  "Baldur s Gate", "Persona", "Titanfall", "Dead Space", "The Evil Within", "Nioh", "Darksiders", "Tomb Raider",
  "Forza Horizon", "Need for Speed", "Tony Hawk s Pro Skater", "Ori", "Psychonauts", "Portal", "XCOM", "BioShock"];
const ignoredTags = new Set(["steam achievements", "steam cloud", "steam trading cards", "full controller support",
  "partial controller support", "controller", "steam workshop", "captions available", "in app purchases"]);

/** Parse public provider evidence; missing co-op tags never imply a negative capability. */
export function parseRawgCatalogGame(value: unknown): ProviderCatalogGame | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const title = value.name.trim().replace(/\s+/g, " ");
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) return null;
  const names = (entries: unknown, tags = false): string[] => Array.isArray(entries) ? entries.slice(0, 256).flatMap(entry => {
    if (!isRecord(entry) || (tags && typeof entry.language === "string" && entry.language !== "eng" && entry.language !== "en")) return [];
    const name = tags && typeof entry.slug === "string" ? entry.slug : entry.name;
    return typeof name === "string" && name.trim() && name.length <= 120 ? [name.trim()] : [];
  }) : [];
  const genreNames = names(value.genres);
  const genres = normalizeFeatureList(genreNames);
  const tags = normalizeFeatureList(names(value.tags, true)).filter(tag => !ignoredTags.has(tag)).slice(0, 64);
  const tagSet = new Set(tags);
  const has = (...entries: string[]): true | null => entries.some(entry => tagSet.has(entry)) ? true : null;
  const onlineCoop = has("online co op", "online coop");
  const localCoop = has("local co op", "local coop", "couch co op", "couch coop", "split screen co op");
  const coop = onlineCoop || localCoop || has("coop", "cooperative");
  const release = typeof value.released === "string" ? /^(\d{4})-\d{2}-\d{2}$/.exec(value.released) : null;
  const year = release ? Number(release[1]) : 0;
  const platforms = Array.isArray(value.platforms) ? value.platforms.flatMap(entry => {
    const platform = isRecord(entry) && isRecord(entry.platform) ? entry.platform : null;
    return platform && typeof platform.name === "string" && platform.name.trim() ? [platform.name.trim().slice(0, 80)] : [];
  }) : [];
  const normalizedTitle = normalizeFeature(title);
  return {
    title, releaseYear: year >= 1800 && year <= 2100 ? year : null,
    platforms: [...new Set(platforms)], genre: genreNames[0]?.slice(0, 80) ?? null,
    estimatedHours: typeof value.playtime === "number" && Number.isFinite(value.playtime) && value.playtime > 0
      ? Math.min(10000, Math.max(1, Math.round(value.playtime))) : null,
    coverUrl: safeHttpUrl(value.background_image),
    rawgId: typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 && value.id <= 2147483647 ? value.id : null,
    rawgSlug: typeof value.slug === "string" && /^[a-z0-9-]{1,200}$/.test(value.slug) ? value.slug : null,
    genres, tags,
    seriesHints: [...new Set(seriesPrefixes.map(normalizeFeature).filter(prefix => normalizedTitle === prefix || normalizedTitle.startsWith(`${prefix} `)))],
    multiplayer: coop || has("multiplayer", "massively multiplayer", "online multiplayer", "local multiplayer"),
    coop, onlineCoop, localCoop,
  };
}

/** Multi-result title search, separate from the existing single-game enrichment. */
export async function searchRawgGames(title: string, reportErrors = false): Promise<ProviderCatalogGame[]> {
  const apiKey = process.env.RAWG_API_KEY?.trim();
  if (!apiKey) {
    if (reportErrors) throw new Error("RAWG catalog lookup requires server configuration.");
    return [];
  }
  try {
    const query = new URLSearchParams({ key: apiKey, search: title, page_size: "8" });
    const response = await resilientFetch(`https://api.rawg.io/api/games?${query}`, {
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("RAWG catalog lookup unavailable.");
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.results)) throw new Error("Invalid RAWG catalog response.");
    return payload.results.slice(0, 8).flatMap(game => {
      const parsed = parseRawgCatalogGame(game);
      return parsed ? [parsed] : [];
    });
  } catch {
    if (reportErrors) throw new Error("RAWG catalog lookup failed. Check provider availability and configuration.");
    return [];
  }
}

export async function lookupRawgGame(title: string, reportRateLimit = false, signal?: AbortSignal): Promise<RawgGameInfo | null> {
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
      signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
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
    const catalog = parseRawgCatalogGame(game);
    if (catalog?.rawgId) {
      // An optional catalog write never changes the existing Scout/metadata result.
      try { await (await import("@/lib/catalog-store")).tryUpsertCatalogGame(catalog); }
      catch { /* Catalog/schema deployment may lag behind application deployment. */ }
    }
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
