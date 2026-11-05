import "server-only";
import { resilientFetch, retryAfterSeconds } from "@/lib/api-resilience";
import { InputError, RateLimitError } from "@/lib/action-result";

export type SteamErrorCode = "INVALID_IDENTIFIER" | "MISSING_API_KEY" | "API_KEY_REJECTED" |
  "VANITY_NOT_FOUND" | "PRIVATE_LIBRARY" | "INVALID_RESPONSE" | "TIMEOUT" | "UPSTREAM_ERROR";

export class SteamAPIError extends InputError {
  constructor(public code: SteamErrorCode, message: string) {
    super(message);
    this.name = "SteamAPIError";
  }
}

export type SteamIdentifier = { kind: "steamId" | "vanity"; value: string };
export type SteamOwnedGame = {
  steamAppId: string;
  title: string;
  playtimeMinutes: number;
  // Lifetime playtime, not a completion time or a Main Story estimate.
  hoursPlayed: number;
  coverUrl: string;
};
export type SteamLibrary = { steamId: string; games: SteamOwnedGame[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isSteamId(value: string): boolean {
  // Public-universe individual desktop accounts: base + a nonzero uint32 account ID.
  return /^\d{17}$/.test(value) && BigInt(value) > BigInt("76561197960265728") &&
    BigInt(value) <= BigInt("76561202255233023");
}
function invalidIdentifier(): never {
  throw new SteamAPIError("INVALID_IDENTIFIER", "Enter a valid SteamID64, steamcommunity.com profile URL, or custom vanity name.");
}

/** Parse locally; caller-provided URLs are never fetched. Steam IDs stay strings. */
export function parseSteamIdentifier(input: string): SteamIdentifier {
  if (typeof input !== "string") return invalidIdentifier();
  const clean = input.trim();
  if (!clean || clean.length > 512 || /[\u0000-\u001f\u007f\\]/.test(clean)) return invalidIdentifier();
  if (/^\d{17,}$/.test(clean)) {
    if (!isSteamId(clean)) return invalidIdentifier();
    return { kind: "steamId", value: clean };
  }
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(clean)) return { kind: "vanity", value: clean };
  let url: URL;
  try {
    url = new URL(/^(?:www\.)?steamcommunity\.com\//i.test(clean) ? `https://${clean}` : clean);
  } catch { return invalidIdentifier(); }
  if (!["http:", "https:"].includes(url.protocol) ||
    !["steamcommunity.com", "www.steamcommunity.com"].includes(url.hostname) ||
    url.username || url.password || url.port) return invalidIdentifier();
  const match = /^\/(profiles|id)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return invalidIdentifier();
  let value: string;
  try { value = decodeURIComponent(match[2]); } catch { return invalidIdentifier(); }
  if (match[1] === "profiles") {
    if (!isSteamId(value)) return invalidIdentifier();
    return { kind: "steamId", value };
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) return invalidIdentifier();
  return { kind: "vanity", value };
}

/** Preserve sub-hour sessions; leave rounding to the future persistence/UI layer. */
export function steamMinutesToHours(minutes: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 4294967295) {
    throw new SteamAPIError("INVALID_RESPONSE", "Steam returned invalid playtime data. Please retry the sync.");
  }
  return minutes / 60;
}

function apiKey(): string {
  const key = process.env.STEAM_API_KEY?.trim();
  if (!key) throw new SteamAPIError("MISSING_API_KEY", "Steam syncing is unavailable: STEAM_API_KEY is not configured on the server.");
  return key;
}
function invalidResponse(): never {
  throw new SteamAPIError("INVALID_RESPONSE", "Steam returned an unexpected library response. Please retry the sync.");
}

type Endpoint = "ISteamUser/ResolveVanityURL/v1/" | "IPlayerService/GetOwnedGames/v1/";
async function steamRequest(endpoint: Endpoint, params: Record<string, string>, key: string): Promise<Record<string, unknown>> {
  // Fixed API origin and disabled redirects keep the server key away from user URLs.
  const url = new URL(endpoint, "https://api.steampowered.com/");
  url.search = new URLSearchParams({ key, format: "json", ...params }).toString();
  try {
    const response = await resilientFetch(url.toString(), {
      method: "GET", headers: { Accept: "application/json" }, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (response.status === 429) throw new RateLimitError(retryAfterSeconds(response.headers.get("Retry-After")));
    if (response.status === 401 || response.status === 403) {
      throw new SteamAPIError("API_KEY_REJECTED", "Steam rejected the server API key. Check its Steam Web API access.");
    }
    if (!response.ok) throw new SteamAPIError("UPSTREAM_ERROR", "Steam is unavailable. Please retry the sync shortly.");
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) {
      if (error instanceof SyntaxError) return invalidResponse();
      throw error;
    }
    if (!isRecord(payload) || !isRecord(payload.response)) return invalidResponse();
    return payload.response;
  } catch (error) {
    if (error instanceof SteamAPIError || error instanceof RateLimitError) throw error;
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new SteamAPIError("TIMEOUT", "The Steam request timed out. Please retry the sync.");
    }
    // Do not forward provider bodies/errors: request URLs contain the API key.
    throw new SteamAPIError("UPSTREAM_ERROR", "Could not reach Steam. Please retry the sync.");
  }
}

async function resolveIdentifier(identifier: SteamIdentifier, key: string): Promise<string> {
  if (identifier.kind === "steamId") return identifier.value;
  const result = await steamRequest("ISteamUser/ResolveVanityURL/v1/", { vanityurl: identifier.value, url_type: "1" }, key);
  if (result.success === 42) {
    throw new SteamAPIError("VANITY_NOT_FOUND", "No Steam profile matches that vanity name. Check the custom profile URL and try again.");
  }
  if (result.success !== 1 || typeof result.steamid !== "string" || !isSteamId(result.steamid)) return invalidResponse();
  return result.steamid;
}

export async function resolveSteamId(input: string): Promise<string> {
  const identifier = parseSteamIdentifier(input);
  return identifier.kind === "steamId" ? identifier.value : resolveIdentifier(identifier, apiKey());
}

/**
 * Read-only server adapter; the future authenticated sync action must authorize
 * writes and apply per-player request protection. This module never writes games.
 * https://partner.steamgames.com/doc/webapi/IPlayerService#GetOwnedGames
 * Service parameters use input_json as required by Valve's service interface.
 */
export async function fetchSteamLibrary(input: string): Promise<SteamLibrary> {
  const identifier = parseSteamIdentifier(input);
  const key = apiKey();
  const steamId = await resolveIdentifier(identifier, key);
  const result = await steamRequest("IPlayerService/GetOwnedGames/v1/", {
    input_json: JSON.stringify({ steamid: steamId, include_appinfo: true, include_played_free_games: true }),
  }, key);
  if (result.game_count === undefined && result.games === undefined) {
    // Steam does not distinguish a hidden library from an unavailable account here.
    throw new SteamAPIError("PRIVATE_LIBRARY", "Steam did not expose this library. Set the Steam profile and Game details to Public, check the account ID, and try again.");
  }
  if (typeof result.game_count !== "number" || !Number.isSafeInteger(result.game_count) || result.game_count < 0) return invalidResponse();
  if (result.game_count === 0 && result.games === undefined) return { steamId, games: [] };
  if (!Array.isArray(result.games) || result.games.length !== result.game_count) return invalidResponse();
  const seen = new Set<string>();
  const games = result.games.map((game): SteamOwnedGame => {
    if (!isRecord(game) || typeof game.appid !== "number" || !Number.isSafeInteger(game.appid) ||
      game.appid < 1 || game.appid > 4294967295 || typeof game.playtime_forever !== "number") return invalidResponse();
    const steamAppId = String(game.appid);
    if (seen.has(steamAppId)) return invalidResponse();
    seen.add(steamAppId);
    const title = typeof game.name === "string" ? game.name.trim().replace(/\s+/g, " ") : "";
    return {
      steamAppId, title: title || `Steam App ${steamAppId}`,
      playtimeMinutes: game.playtime_forever, hoursPlayed: steamMinutesToHours(game.playtime_forever),
      // Best-effort fallback: GetOwnedGames has icons, not full cover art.
      coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`,
    };
  });
  return { steamId, games };
}
