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

export class GoogleOAuthError extends Error {
  constructor(public reason: "unavailable" | "state" | "cancelled" | "conflict" | "session" | "profile" | "failed") { super(reason); }
}

export const googleCookieName = process.env.NODE_ENV === "production" ? "__Host-bb_google_oauth_v1" : "bb_google_oauth_v1";
const lifetimeMs = 10 * 60 * 1000;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 10000 });
export type GoogleContext = {
  state: string; verifier: string; nonce: string; mode: "signin" | "link";
  sessionHash: string | null; userId: string | null; redirectUri: string;
  layoutMode: "cyberpunk" | "fantasy"; expiresAt: number;
};
export type GoogleProfile = { googleId: string; email: string; name: string };

export function googleConfiguration(requestUrl: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim(), clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GoogleOAuthError("unavailable");
  const url = new URL(process.env.APP_URL || requestUrl);
  // Use APP_URL on hosted environments; local development also works without it.
  // Ignore forwarded headers and never accept a return URL from query parameters.
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new GoogleOAuthError("unavailable");
  return { clientId, clientSecret, redirectUri: new URL("/api/auth/google/callback", url.origin).toString() };
}

export function googleStateHash(state: string) { return createHash("sha256").update(`google-state-v1:${state}`).digest("hex"); }
export function pkceChallenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

export function signGoogleContext(context: GoogleContext, secret: Buffer) {
  const payload = Buffer.from(JSON.stringify(context)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`google-context-v1:${payload}`).digest("base64url")}`;
}

export function readGoogleContext(value: string | undefined, state: string | null, secret: Buffer): GoogleContext {
  const fail = () => { throw new GoogleOAuthError("state"); };
  if (!value || value.length > 4096 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return fail();
  const [payload, signature, extra] = value.split(".");
  const expected = createHmac("sha256", secret).update(`google-context-v1:${payload}`).digest("base64url");
  if (extra !== undefined || signature?.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return fail();
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return fail(); }
  if (!parsed || typeof parsed !== "object" || parsed.state !== state || typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now() || parsed.expiresAt > Date.now() + lifetimeMs ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.verifier) || !/^[A-Za-z0-9_-]{43}$/.test(parsed.nonce) ||
      !["signin", "link"].includes(parsed.mode) || !["cyberpunk", "fantasy"].includes(parsed.layoutMode) ||
      !(parsed.sessionHash === null || /^[a-f0-9]{64}$/.test(parsed.sessionHash)) ||
      !(parsed.userId === null || typeof parsed.userId === "string") || typeof parsed.redirectUri !== "string" ||
      (parsed.mode === "link" && (!parsed.userId || !parsed.sessionHash)) || (parsed.mode === "signin" && parsed.userId !== null)) return fail();
  return parsed as GoogleContext;
}

export async function beginGoogleOAuth(requestUrl: string, mode: "signin" | "link", layoutMode: "cyberpunk" | "fantasy") {
  const configuration = googleConfiguration(requestUrl);
  const sessionHash = await readSessionHash();
  const session = sessionHash ? await prisma.playerSession.findUnique({ where: {
    tokenHash: sessionHash, expiresAt: { gt: new Date() }, player: registeredPlayerWhere,
  }, select: { userId: true } }) : null;
  if ((mode === "link" && !session) || (mode === "signin" && session)) throw new GoogleOAuthError("session");
  const context: GoogleContext = {
    state: randomBytes(32).toString("base64url"), verifier: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"),
    mode, sessionHash, userId: mode === "link" ? session!.userId : null, redirectUri: configuration.redirectUri,
    layoutMode, expiresAt: Date.now() + lifetimeMs,
  };
  await prisma.googleOAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.googleOAuthAttempt.create({ data: { stateHash: googleStateHash(context.state), expiresAt: new Date(context.expiresAt) } });
  (await cookies()).set(googleCookieName, signGoogleContext(context, await getSessionSigningKey()), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: lifetimeMs / 1000,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: "code", scope: "openid email profile",
    state: context.state, nonce: context.nonce, code_challenge: pkceChallenge(context.verifier), code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return url.toString();
}

export async function consumeGoogleContext(requestUrl: string) {
  const url = new URL(requestUrl), jar = await cookies();
  const context = readGoogleContext(jar.get(googleCookieName)?.value, url.searchParams.get("state"), await getSessionSigningKey());
  if (googleConfiguration(requestUrl).redirectUri !== context.redirectUri) throw new GoogleOAuthError("state");
  if (await readSessionHash() !== context.sessionHash) throw new GoogleOAuthError("session");
  // Atomic replay prevention, including simultaneous callbacks and restored cookies.
  const consumed = await prisma.googleOAuthAttempt.deleteMany({ where: {
    stateHash: googleStateHash(context.state), expiresAt: { gt: new Date() },
  } });
  if (consumed.count !== 1) throw new GoogleOAuthError("state");
  return context;
}

export async function clearGoogleContext() {
  (await cookies()).set(googleCookieName, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export function googleProfileFromClaims(claims: JWTPayload, nonce: string, clientId: string): GoogleProfile {
  if (claims.nonce !== nonce || (claims.azp !== undefined && claims.azp !== clientId) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) ||
      typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255 || claims.email_verified !== true ||
      typeof claims.email !== "string" || !isValidEmail(normalizeEmail(claims.email))) throw new GoogleOAuthError("profile");
  return { googleId: claims.sub, email: normalizeEmail(claims.email), name: typeof claims.name === "string" ? claims.name : "" };
}

export async function exchangeGoogleCode(code: string, context: GoogleContext): Promise<GoogleProfile> {
  const configuration = googleConfiguration(context.redirectUri);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: configuration.clientId, client_secret: configuration.clientSecret,
      redirect_uri: context.redirectUri, grant_type: "authorization_code", code_verifier: context.verifier }),
    signal: AbortSignal.timeout(10000), cache: "no-store",
  });
  if (!response.ok) throw new GoogleOAuthError("failed");
  const tokens = await response.json();
  if (typeof tokens.id_token !== "string") throw new GoogleOAuthError("profile");
  const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"], audience: configuration.clientId,
    algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce", "email", "email_verified"], maxTokenAge: "10m", clockTolerance: 5,
  });
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
    if (!active) throw new GoogleOAuthError("session");
    const current = await tx.player.findUnique({ where: { id: context.userId! }, select: { id: true, email: true, googleId: true, emailVerifiedAt: true } });
    if (!current) throw new GoogleOAuthError("session");
    if ((linked && linked.id !== current.id) || (current.googleId && current.googleId !== profile.googleId)) throw new GoogleOAuthError("conflict");
    await tx.player.update({ where: { id: current.id }, data: {
      googleId: profile.googleId,
      ...(current.email?.toLowerCase() === profile.email && !current.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
    } });
    return current.id;
  }
  // Reject a session introduced in another tab while Google was open.
  if (context.sessionHash && await tx.playerSession.findUnique({ where: { tokenHash: context.sessionHash, expiresAt: { gt: new Date() } }, select: { userId: true } })) throw new GoogleOAuthError("session");
  if (linked) return linked.id;
  const existing = await tx.player.findFirst({ where: { email: { equals: escapeLike(profile.email), mode: "insensitive" } }, select: { id: true, googleId: true, emailVerifiedAt: true } });
  if (existing) {
    if (existing.googleId && existing.googleId !== profile.googleId) throw new GoogleOAuthError("conflict");
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
  if (!handle) throw new GoogleOAuthError("failed");
  return (await tx.player.create({ data: { email: profile.email, googleId: profile.googleId, emailVerifiedAt: new Date(), passwordHash: null,
    handle, operatorName: name, preferredLayoutMode: context.layoutMode }, select: { id: true } })).id;
}
