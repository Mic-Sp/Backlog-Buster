import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionSigningKey, readSessionHash } from "@/lib/auth-session";
import { registeredPlayerWhere } from "@/lib/auth-policy";
import { isValidEmail, normalizeEmail } from "@/lib/email-validation";
import { escapeLike } from "@/lib/handle-validation";
import { GoogleOAuthError, googleDiagnosticOrigin, googleOAuthStep, safeGoogleProviderError } from "@/lib/google-oauth-diagnostics";
import { googleOAuthOrigin } from "@/lib/google-oauth-origin";
export { GoogleOAuthError } from "@/lib/google-oauth-diagnostics";

export const googleCookieName = process.env.NODE_ENV === "production" ? "__Host-bb_google_oauth_v1" : "bb_google_oauth_v1";
const lifetimeMs = 10 * 60 * 1000;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 10000 });
export type GoogleContext = {
  state: string; verifier: string; nonce: string; mode: "signin" | "link";
  sessionHash: string | null; userId: string | null; redirectUri: string;
  layoutMode: "cyberpunk" | "fantasy"; expiresAt: number;
};
export type GoogleProfile = { googleId: string; email: string; name: string };

function googleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim(), clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GoogleOAuthError("unavailable", !clientId ? "missing_google_client_id" : "missing_google_client_secret", { stage: "configuration" });
  return { clientId, clientSecret };
}

export function googleConfiguration(requestUrl: string, requestHeaders?: Headers) {
  return { ...googleCredentials(), redirectUri: new URL("/api/auth/google/callback", googleOAuthOrigin(requestUrl, requestHeaders)).toString() };
}

export function googleStateHash(state: string) { return createHash("sha256").update(`google-state-v1:${state}`).digest("hex"); }
export function pkceChallenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

export function signGoogleContext(context: GoogleContext, secret: Buffer) {
  const payload = Buffer.from(JSON.stringify(context)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`google-context-v1:${payload}`).digest("base64url")}`;
}

export function readGoogleContext(value: string | undefined, state: string | null, secret: Buffer): GoogleContext {
  const fail = (failure: string) => { throw new GoogleOAuthError("state", failure, { stage: "state_validation", cookiePresent: Boolean(value), statePresent: Boolean(state) }); };
  if (!value) return fail("missing_state_cookie");
  if (value.length > 4096) return fail("invalid_state_cookie");
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return fail("missing_or_invalid_state");
  const [payload, signature, extra] = value.split(".");
  const expected = createHmac("sha256", secret).update(`google-context-v1:${payload}`).digest("base64url");
  if (extra !== undefined || signature?.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return fail("state_signature_mismatch");
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return fail("invalid_state_payload"); }
  if (!parsed || typeof parsed !== "object") return fail("invalid_state_payload");
  if (parsed.state !== state) return fail("state_mismatch");
  if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now() || parsed.expiresAt > Date.now() + lifetimeMs) return fail("state_expired");
  if (
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(parsed.nonce) ||
      !["signin", "link"].includes(parsed.mode) || !["cyberpunk", "fantasy"].includes(parsed.layoutMode) ||
      !(parsed.sessionHash === null || /^[a-f0-9]{64}$/.test(parsed.sessionHash)) ||
      !(parsed.userId === null || typeof parsed.userId === "string") || typeof parsed.redirectUri !== "string" ||
      (parsed.mode === "link" && (!parsed.userId || !parsed.sessionHash)) || (parsed.mode === "signin" && parsed.userId !== null)) return fail("invalid_state_payload");
  return parsed as GoogleContext;
}

export async function beginGoogleOAuth(requestUrl: string, mode: "signin" | "link", layoutMode: "cyberpunk" | "fantasy", requestHeaders?: Headers) {
  const configuration = googleConfiguration(requestUrl, requestHeaders);
  const sessionHash = await googleOAuthStep("session_lookup", readSessionHash);
  const session = sessionHash ? await googleOAuthStep("session_lookup", () => prisma.playerSession.findUnique({ where: {
    tokenHash: sessionHash, expiresAt: { gt: new Date() }, player: registeredPlayerWhere,
  }, select: { userId: true } })) : null;
  if ((mode === "link" && !session) || (mode === "signin" && session)) throw new GoogleOAuthError("session", "invalid_initiating_session", { stage: "session_lookup" });
  const context: GoogleContext = {
    state: randomBytes(32).toString("base64url"), verifier: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"),
    mode, sessionHash, userId: mode === "link" ? session!.userId : null, redirectUri: configuration.redirectUri,
    layoutMode, expiresAt: Date.now() + lifetimeMs,
  };
  await googleOAuthStep("state_persistence", () => prisma.googleOAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } }));
  await googleOAuthStep("state_persistence", () => prisma.googleOAuthAttempt.create({ data: { stateHash: googleStateHash(context.state), expiresAt: new Date(context.expiresAt) } }));
  await googleOAuthStep("state_cookie", async () => { (await cookies()).set(googleCookieName, signGoogleContext(context, await getSessionSigningKey()), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: lifetimeMs / 1000,
  }); });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: "code", scope: "openid email profile",
    state: context.state, nonce: context.nonce, code_challenge: pkceChallenge(context.verifier), code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function consumeGoogleContext(requestUrl: string, requestHeaders?: Headers) {
  const url = new URL(requestUrl);
  const context = await googleOAuthStep("state_validation", async () => readGoogleContext((await cookies()).get(googleCookieName)?.value, url.searchParams.get("state"), await getSessionSigningKey()));
  const expectedRedirectUri = googleConfiguration(requestUrl, requestHeaders).redirectUri;
  if (expectedRedirectUri !== context.redirectUri) throw new GoogleOAuthError("state", "redirect_uri_mismatch", {
    stage: "state_validation", expectedOrigin: googleDiagnosticOrigin(expectedRedirectUri), storedOrigin: googleDiagnosticOrigin(context.redirectUri),
  });
  if (await googleOAuthStep("session_validation", readSessionHash) !== context.sessionHash) throw new GoogleOAuthError("session", "browser_session_changed", { stage: "session_validation" });
  // Atomic replay prevention, including simultaneous callbacks and restored cookies.
  const consumed = await googleOAuthStep("state_consumption", () => prisma.googleOAuthAttempt.deleteMany({ where: {
    stateHash: googleStateHash(context.state), expiresAt: { gt: new Date() },
  } }));
  if (consumed.count !== 1) throw new GoogleOAuthError("state", "state_attempt_missing_expired_or_used", { stage: "state_consumption" });
  return context;
}

export async function clearGoogleContext() {
  (await cookies()).set(googleCookieName, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export function googleProfileFromClaims(claims: JWTPayload, nonce: string, clientId: string): GoogleProfile {
  const fail = (failure: string) => { throw new GoogleOAuthError("profile", failure, { stage: "profile_validation" }); };
  if (claims.nonce !== nonce) fail("nonce_mismatch");
  if ((claims.azp !== undefined && claims.azp !== clientId) || (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId)) fail("authorized_party_mismatch");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return fail("invalid_google_subject");
  if (claims.email_verified !== true) fail("google_email_unverified");
  if (typeof claims.email !== "string" || !isValidEmail(normalizeEmail(claims.email))) return fail("invalid_google_email");
  return { googleId: claims.sub, email: normalizeEmail(claims.email), name: typeof claims.name === "string" ? claims.name : "" };
}

export async function exchangeGoogleCode(code: string, context: GoogleContext): Promise<GoogleProfile> {
  const configuration = googleCredentials();
  const response = await googleOAuthStep("token_exchange", () => fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: configuration.clientId, client_secret: configuration.clientSecret,
      redirect_uri: context.redirectUri, grant_type: "authorization_code", code_verifier: context.verifier }),
    signal: AbortSignal.timeout(10000), cache: "no-store",
  }));
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new GoogleOAuthError("failed", "token_endpoint_rejected", { stage: "token_exchange", httpStatus: response.status, providerError: safeGoogleProviderError(body?.error) });
  }
  const tokens = await googleOAuthStep("token_response", () => response.json());
  if (typeof tokens?.id_token !== "string") throw new GoogleOAuthError("profile", "missing_id_token", { stage: "token_response" });
  const { payload } = await googleOAuthStep("id_token_verification", () => jwtVerify(tokens.id_token, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"], audience: configuration.clientId,
    algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce", "email", "email_verified"], maxTokenAge: "10m", clockTolerance: 5,
  }));
  // Neither access/refresh tokens nor ID tokens are persisted or logged.
  return googleProfileFromClaims(payload, context.nonce, configuration.clientId);
}

// Called inside createPlayerSession's transaction so account resolution/linking
// and the new session either all commit or all roll back.
export async function resolveGooglePlayer(tx: Prisma.TransactionClient, profile: GoogleProfile, context: GoogleContext): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
  const linked = await tx.player.findUnique({ where: { googleId: profile.googleId }, select: { id: true } });
  if (context.mode === "link") {
    const active = await tx.playerSession.findUnique({ where: { tokenHash: context.sessionHash!, userId: context.userId!, expiresAt: { gt: new Date() }, player: registeredPlayerWhere }, select: { userId: true } });
    if (!active) throw new GoogleOAuthError("session", "link_session_expired");
    const current = await tx.player.findUnique({ where: { id: context.userId! }, select: { id: true, email: true, googleId: true, emailVerifiedAt: true } });
    if (!current) throw new GoogleOAuthError("session", "link_player_missing");
    if (linked && linked.id !== current.id) throw new GoogleOAuthError("conflict", "google_identity_already_linked");
    if (current.googleId && current.googleId !== profile.googleId) throw new GoogleOAuthError("conflict", "player_has_other_google_identity");
    await tx.player.update({ where: { id: current.id }, data: {
      googleId: profile.googleId,
      ...(current.email?.toLowerCase() === profile.email && !current.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
    } });
    return current.id;
  }
  // Reject a session introduced in another tab while Google was open.
  if (context.sessionHash && await tx.playerSession.findUnique({ where: { tokenHash: context.sessionHash, expiresAt: { gt: new Date() } }, select: { userId: true } })) throw new GoogleOAuthError("session", "sign_in_session_became_active");
  if (linked) return linked.id;
  const existing = await tx.player.findFirst({ where: { email: { equals: escapeLike(profile.email), mode: "insensitive" } }, select: { id: true, googleId: true, emailVerifiedAt: true } });
  if (existing) {
    if (existing.googleId && existing.googleId !== profile.googleId) throw new GoogleOAuthError("conflict", "email_already_has_other_google_identity");
    await tx.player.update({ where: { id: existing.id }, data: { googleId: profile.googleId, ...(!existing.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}) } });
    return existing.id;
  }
  const name = profile.name.trim().replace(/\s+/g, " ").slice(0, 28) || profile.email.split("@")[0].slice(0, 28);
  const stem = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22) || "player";
  let handle = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${stem}-${randomBytes(4).toString("hex")}`;
    if (!await tx.player.findFirst({ where: { handle: { equals: escapeLike(candidate), mode: "insensitive" } }, select: { id: true } })) { handle = candidate; break; }
  }
  if (!handle) throw new GoogleOAuthError("failed", "unique_handle_unavailable");
  return (await tx.player.create({ data: { email: profile.email, googleId: profile.googleId, emailVerifiedAt: new Date(), passwordHash: null,
    handle, operatorName: name, preferredLayoutMode: context.layoutMode }, select: { id: true } })).id;
}
