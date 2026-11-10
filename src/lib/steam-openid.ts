import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionSigningKey, readSessionHash } from "@/lib/auth-session";
import { registeredPlayerWhere } from "@/lib/auth-policy";
// Use the same public-origin precedence and proxy validation as Google.
import { googleOAuthOrigin as publicAuthOrigin } from "@/lib/google-oauth-origin";
import { escapeLike } from "@/lib/handle-validation";
import { parseSteamIdentifier } from "@/lib/steam";
import { SteamOpenIDError, steamAuthStep } from "@/lib/steam-openid-diagnostics";
import { reclaimEmptySteamShell } from "@/lib/steam-shell";

export const steamCookieName = process.env.NODE_ENV === "production" ? "__Host-bb_steam_openid_v1" : "bb_steam_openid_v1";
export const steamEndpoint = "https://steamcommunity.com/openid/login";
const namespace = "http://specs.openid.net/auth/2.0";
const identifierSelect = "http://specs.openid.net/auth/2.0/identifier_select";
const lifetimeMs = 10 * 60 * 1000;
export type SteamContext = {
  state: string; mode: "signin" | "link"; sessionHash: string | null; userId: string | null;
  returnTo: string; layoutMode: "cyberpunk" | "fantasy" | "biohazard"; expiresAt: number;
};
export type SteamPersona = { name: string; avatarUrl: string | null };
export function steamStateHash(state: string) { return createHash("sha256").update(`steam-state-v1:${state}`).digest("hex"); }
function cookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" }; }

export function signSteamContext(context: SteamContext, secret: Buffer) {
  const payload = Buffer.from(JSON.stringify(context)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`steam-context-v1:${payload}`).digest("base64url")}`;
}

export function readSteamContext(value: string | undefined, state: string | null, secret: Buffer): SteamContext {
  const fail = () => { throw new SteamOpenIDError("state", "invalid_or_expired_context", "state_validation"); };
  if (!value || value.length > 4096 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return fail();
  const [payload, signature, extra] = value.split(".");
  const expected = createHmac("sha256", secret).update(`steam-context-v1:${payload}`).digest("base64url");
  if (extra !== undefined || signature?.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return fail();
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return fail(); }
  if (!parsed || parsed.state !== state || !["signin", "link"].includes(parsed.mode) || !["cyberpunk", "fantasy", "biohazard"].includes(parsed.layoutMode) ||
    typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now() || parsed.expiresAt > Date.now() + lifetimeMs ||
    !(parsed.sessionHash === null || (typeof parsed.sessionHash === "string" && /^[a-f0-9]{64}$/.test(parsed.sessionHash))) ||
    !(parsed.userId === null || (typeof parsed.userId === "string" && parsed.userId.length > 0)) ||
    typeof parsed.returnTo !== "string" || (parsed.mode === "link" && (!parsed.sessionHash || !parsed.userId)) ||
    (parsed.mode === "signin" && parsed.userId !== null)) return fail();
  return parsed as SteamContext;
}

export async function beginSteamOpenID(requestUrl: string, mode: SteamContext["mode"], layoutMode: SteamContext["layoutMode"], headers?: Headers) {
  const origin = publicAuthOrigin(requestUrl, headers);
  const sessionHash = await steamAuthStep("session_lookup", readSessionHash);
  const session = sessionHash ? await steamAuthStep("session_lookup", () => prisma.playerSession.findUnique({
    where: { tokenHash: sessionHash, expiresAt: { gt: new Date() }, player: registeredPlayerWhere }, select: { userId: true },
  })) : null;
  if ((mode === "link" && !session) || (mode === "signin" && session)) throw new SteamOpenIDError("session", "invalid_initiating_session", "session_lookup");
  const state = randomBytes(32).toString("base64url");
  const returnTo = new URL("/api/auth/steam/callback", origin); returnTo.searchParams.set("state", state);
  const context: SteamContext = { state, mode, layoutMode, sessionHash, userId: mode === "link" ? session!.userId : null,
    returnTo: returnTo.toString(), expiresAt: Date.now() + lifetimeMs };
  await steamAuthStep("state_persistence", async () => {
    await prisma.steamOpenIDAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await prisma.steamOpenIDAttempt.create({ data: { stateHash: steamStateHash(state), expiresAt: new Date(context.expiresAt) } });
  });
  await steamAuthStep("state_cookie", async () => (await cookies()).set(steamCookieName, signSteamContext(context, await getSessionSigningKey()), { ...cookieOptions(), maxAge: lifetimeMs / 1000 }));
  const url = new URL(steamEndpoint);
  url.search = new URLSearchParams({ "openid.ns": namespace, "openid.mode": "checkid_setup", "openid.return_to": context.returnTo,
    "openid.realm": `${origin}/`, "openid.identity": identifierSelect, "openid.claimed_id": identifierSelect }).toString();
  return url.toString();
}

export async function consumeSteamContext(requestUrl: string, headers?: Headers) {
  const url = new URL(requestUrl);
  // Duplicate parameters are ambiguous to providers, proxies and URL parsers.
  if (url.toString().length > 16384 || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) throw new SteamOpenIDError("state", "ambiguous_callback", "state_validation");
  const context = await steamAuthStep("state_validation", async () => readSteamContext((await cookies()).get(steamCookieName)?.value, url.searchParams.get("state"), await getSessionSigningKey()));
  const expected = new URL("/api/auth/steam/callback", publicAuthOrigin(requestUrl, headers)); expected.searchParams.set("state", context.state);
  if (expected.toString() !== context.returnTo || url.pathname !== expected.pathname) throw new SteamOpenIDError("state", "return_origin_mismatch", "state_validation");
  if (await steamAuthStep("session_validation", readSessionHash) !== context.sessionHash) throw new SteamOpenIDError("session", "browser_session_changed", "session_validation");
  const consumed = await steamAuthStep("state_consumption", () => prisma.steamOpenIDAttempt.deleteMany({ where: { stateHash: steamStateHash(context.state), expiresAt: { gt: new Date() } } }));
  if (consumed.count !== 1) throw new SteamOpenIDError("state", "attempt_missing_expired_or_used", "state_consumption");
  return context;
}

export async function clearSteamContext() { (await cookies()).set(steamCookieName, "", { ...cookieOptions(), maxAge: 0 }); }

/** Steam is the sole trusted OP: pin both endpoint and claimed-ID namespace. */
export async function verifySteamAssertion(params: URLSearchParams, context: SteamContext): Promise<string> {
  const fail = (failure: string): never => { throw new SteamOpenIDError("failed", failure, "assertion_validation"); };
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) fail("duplicate_parameter");
  if (params.get("openid.mode") === "cancel") throw new SteamOpenIDError("cancelled", "provider_cancelled", "provider_callback");
  if (params.get("openid.ns") !== namespace || params.get("openid.mode") !== "id_res" || params.get("openid.op_endpoint") !== steamEndpoint) fail("invalid_provider_assertion");
  if (params.get("openid.return_to") !== context.returnTo) fail("return_to_mismatch");
  const claimed = params.get("openid.claimed_id") ?? "";
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
  if (!match || params.get("openid.identity") !== claimed) return fail("invalid_claimed_identity");
  try { parseSteamIdentifier(match[1]); } catch { return fail("invalid_steam_id"); }
  const signed = (params.get("openid.signed") ?? "").split(",");
  for (const field of ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"]) {
    if (!signed.includes(field) || !params.get(`openid.${field}`)) fail("missing_signed_field");
  }
  if (!params.get("openid.sig")) fail("missing_signature");
  const nonce = params.get("openid.response_nonce")!;
  const timestamp = nonce.slice(0, 20), issuedAt = Date.parse(timestamp), now = Date.now();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.+$/.test(nonce) || nonce.length > 255 || !Number.isFinite(issuedAt) ||
    new Date(issuedAt).toISOString().replace(".000Z", "Z") !== timestamp || issuedAt < now - lifetimeMs || issuedAt > now + 60000) fail("invalid_or_stale_nonce");
  const body = new URLSearchParams();
  for (const [key, value] of params) if (key.startsWith("openid.")) body.set(key, value);
  body.set("openid.mode", "check_authentication");
  const response = await steamAuthStep("check_authentication", () => fetch(steamEndpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/plain" }, body,
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  }));
  if (!response.ok) throw new SteamOpenIDError("failed", "provider_verification_rejected", "check_authentication");
  const result = await steamAuthStep("verification_response", () => response.text());
  const fields = new Map<string, string>();
  for (const line of result.trimEnd().split("\n")) {
    const colon = line.indexOf(":"); const key = line.slice(0, colon);
    if (colon < 1 || fields.has(key)) fail("invalid_verification_response");
    fields.set(key, line.slice(colon + 1));
  }
  if (fields.get("ns") !== namespace || fields.get("is_valid") !== "true") throw new SteamOpenIDError("failed", "assertion_not_verified", "check_authentication");
  await steamAuthStep("nonce_consumption", async () => {
    await prisma.steamOpenIDNonce.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    try { await prisma.steamOpenIDNonce.create({ data: {
      nonceHash: createHash("sha256").update(nonce).digest("hex"), expiresAt: new Date(issuedAt + lifetimeMs + 60000),
    } }); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new SteamOpenIDError("state", "assertion_nonce_reused", "nonce_consumption");
      throw error;
    }
  });
  return match[1];
}

/** Profile metadata is optional and never supplies a login identity or email. */
export async function fetchSteamPersona(steamId: string): Promise<SteamPersona> {
  const fallback = { name: "Steam Player", avatarUrl: null };
  const key = process.env.STEAM_API_KEY?.trim();
  if (!key) return fallback;
  try {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
    url.search = new URLSearchParams({ key, steamids: steamId }).toString();
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return fallback;
    const data = await response.json();
    const profile = data?.response?.players?.find((player: { steamid?: string }) => player.steamid === steamId);
    const name = typeof profile?.personaname === "string" ? profile.personaname.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ").slice(0, 28) : "";
    let avatarUrl: string | null = null;
    if (typeof profile?.avatarfull === "string") {
      const avatar = new URL(profile.avatarfull);
      if (avatar.protocol === "https:" && !avatar.username && !avatar.password && !avatar.port &&
        ["avatars.steamstatic.com", "avatars.akamai.steamstatic.com", "avatars.fastly.steamstatic.com"].includes(avatar.hostname)) avatarUrl = avatar.toString();
    }
    return { name: name || fallback.name, avatarUrl };
  } catch { return fallback; }
}

// Account resolution and session rotation share one transaction. Never match a
// manually entered steamId, persona name or email to an existing account.
export async function resolveSteamPlayer(tx: Prisma.TransactionClient, steamId: string, persona: SteamPersona, context: SteamContext): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
  // Re-read the browser binding inside the transaction, as in the Google flow.
  if (await readSessionHash() !== context.sessionHash) throw new SteamOpenIDError("session", "browser_session_changed");
  const linked = await tx.player.findUnique({ where: { steamVerifiedId: steamId }, select: { id: true } });
  if (context.mode === "link") {
    const active = await tx.playerSession.findUnique({ where: { tokenHash: context.sessionHash!, userId: context.userId!, expiresAt: { gt: new Date() }, player: registeredPlayerWhere }, select: { userId: true } });
    if (!active) throw new SteamOpenIDError("session", "link_session_expired");
    const current = await tx.player.findUnique({ where: { id: context.userId! }, select: { id: true, steamVerifiedId: true, steamId: true } });
    if (!current) throw new SteamOpenIDError("session", "link_player_missing");
    if (current.steamVerifiedId && current.steamVerifiedId !== steamId) throw new SteamOpenIDError("conflict", "player_has_other_steam_identity");
    if (linked && linked.id !== current.id) await reclaimEmptySteamShell(tx, linked.id, steamId);
    await tx.player.update({ where: { id: current.id }, data: { steamVerifiedId: steamId, steamVerifiedAt: new Date(),
      ...(!current.steamId ? { steamId } : {}) } });
    return current.id;
  }
  if (context.sessionHash && await tx.playerSession.findUnique({ where: { tokenHash: context.sessionHash, expiresAt: { gt: new Date() } }, select: { userId: true } })) throw new SteamOpenIDError("session", "signin_session_became_active");
  if (linked) return linked.id;
  const stem = persona.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22) || "steam-player";
  let handle = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${stem}-${randomBytes(4).toString("hex")}`;
    if (!await tx.player.findFirst({ where: { handle: { equals: escapeLike(candidate), mode: "insensitive" } }, select: { id: true } })) { handle = candidate; break; }
  }
  if (!handle) throw new SteamOpenIDError("failed", "unique_handle_unavailable");
  return (await tx.player.create({ data: { steamVerifiedId: steamId, steamVerifiedAt: new Date(), steamId,
    email: null, passwordHash: null, handle, operatorName: persona.name, avatarUrl: persona.avatarUrl, preferredLayoutMode: context.layoutMode }, select: { id: true } })).id;
}
