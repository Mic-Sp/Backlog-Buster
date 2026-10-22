import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resilientFetch } from "@/lib/api-resilience";

const provider = "igdb";
const renewalBufferMs = 10 * 60 * 1000;
const tokenEndpoint = "https://id.twitch.tv/oauth2/token";

type Credentials = { clientId: string; clientSecret: string; key: string };
export type IgdbAuth = { clientId: string; accessToken: string; expiresAt: Date };
export type IgdbHeaders = { "Client-ID": string; Authorization: string };
type TokenRow = { accessToken: string; expiresAt: Date };
let memory: { key: string; auth: IgdbAuth } | null = null;
let inFlight: { key: string; promise: Promise<IgdbAuth | null> } | null = null;

function credentials(): Credentials | null {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || clientId.length > 256 || clientSecret.length > 1024 ||
    /\s/.test(clientId) || /\s/.test(clientSecret)) return null;
  // Keep credential changes from accidentally reusing this process's previous memory entry.
  return { clientId, clientSecret, key: createHash("sha256").update(JSON.stringify([clientId, clientSecret])).digest("hex") };
}
function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}
function reusable(row: TokenRow | null, rejectedToken?: string): row is TokenRow {
  return row !== null && validToken(row.accessToken) && row.accessToken !== rejectedToken &&
    row.expiresAt instanceof Date && row.expiresAt.getTime() > Date.now() + renewalBufferMs;
}
function copy(auth: IgdbAuth): IgdbAuth {
  return { ...auth, expiresAt: new Date(auth.expiresAt) };
}
function headers(auth: IgdbAuth): IgdbHeaders {
  return { "Client-ID": auth.clientId, Authorization: `Bearer ${auth.accessToken}` };
}

async function exchange(config: Credentials): Promise<TokenRow | null> {
  try {
    const requestedAt = Date.now();
    const response = await resilientFetch(tokenEndpoint, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // Secrets belong in the server-side POST body, never a URL or log message.
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "client_credentials" }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const result = data as Record<string, unknown>;
    if (!validToken(result.access_token) || typeof result.expires_in !== "number" ||
      !Number.isSafeInteger(result.expires_in) || result.expires_in <= 0 ||
      typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer") return null;
    // Use the provider's lifetime, conservatively measured from the start of the exchange.
    const expiresAt = new Date(requestedAt + result.expires_in * 1000);
    const token = { accessToken: result.access_token, expiresAt };
    return reusable(token) ? token : null;
  } catch {
    // Missing service, timeout, quota and malformed responses are all safe fallbacks.
    // Never log request bodies, bearer tokens, secrets, or provider error responses.
    return null;
  }
}

async function load(config: Credentials, rejectedToken?: string): Promise<IgdbAuth | null> {
  try {
    if (!rejectedToken) {
      const cached = await prisma.externalOAuthToken.findUnique({ where: { provider }, select: { accessToken: true, expiresAt: true } });
      if (reusable(cached)) return { clientId: config.clientId, ...cached };
    }
    // The process promise deduplicates local bursts. This lock also serializes rare
    // renewals across serverless instances, which recheck the winner's persisted token.
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-oauth:igdb', 0))`;
      const cached = await tx.externalOAuthToken.findUnique({ where: { provider }, select: { accessToken: true, expiresAt: true } });
      if (reusable(cached, rejectedToken)) return { clientId: config.clientId, ...cached };
      if (rejectedToken) await tx.externalOAuthToken.deleteMany({ where: { provider, accessToken: rejectedToken } });
      const token = await exchange(config);
      if (!token || token.accessToken === rejectedToken) return null;
      await tx.externalOAuthToken.upsert({ where: { provider }, create: { provider, ...token }, update: token, select: { provider: true } });
      return { clientId: config.clientId, ...token };
    }, { maxWait: 5000, timeout: 15000 });
  } catch {
    return null;
  }
}

async function obtain(config: Credentials, rejectedToken?: string): Promise<IgdbAuth | null> {
  if (memory?.key === config.key && reusable(memory.auth, rejectedToken)) return copy(memory.auth);
  while (inFlight?.key === config.key) {
    const pending = await inFlight.promise;
    // A delayed 401 must not discard a new token another request just refreshed.
    if (!pending || pending.accessToken !== rejectedToken) return pending ? copy(pending) : null;
  }
  const promise = load(config, rejectedToken);
  inFlight = { key: config.key, promise };
  try {
    const auth = await promise;
    if (auth) memory = { key: config.key, auth: copy(auth) };
    return auth ? copy(auth) : null;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/** Server-only: returns credentials for IGDB or null so callers can use their fallback. */
export async function getIgdbAuth(): Promise<IgdbAuth | null> {
  const config = credentials();
  return config ? obtain(config) : null;
}

export async function getIgdbHeaders(): Promise<IgdbHeaders | null> {
  const auth = await getIgdbAuth();
  return auth ? headers(auth) : null;
}

/** Recover from one rejected token without invalidating a newer cache entry. */
export async function refreshIgdbAuth(rejectedAccessToken: string): Promise<IgdbAuth | null> {
  if (!validToken(rejectedAccessToken)) return null;
  if (memory?.auth.accessToken === rejectedAccessToken) memory = null;
  const config = credentials();
  return config ? obtain(config, rejectedAccessToken) : null;
}

async function invalidate(rejectedAccessToken: string) {
  if (memory?.auth.accessToken === rejectedAccessToken) memory = null;
  try { await prisma.externalOAuthToken.deleteMany({ where: { provider, accessToken: rejectedAccessToken } }); }
  catch { /* Unavailable database must not mask a failed IGDB request. */ }
}

/** Request callbacks must be replayable; a 401 is retried exactly once with fresh auth. */
export async function withIgdbAuth(request: (authHeaders: IgdbHeaders) => Promise<Response>): Promise<Response | null> {
  try {
    let auth = await getIgdbAuth();
    if (!auth) return null;
    const response = await request(headers(auth));
    if (response.status !== 401) return response;
    await response.body?.cancel();
    auth = await refreshIgdbAuth(auth.accessToken);
    if (!auth) return null;
    const retry = await request(headers(auth));
    if (retry.status === 401) await invalidate(auth.accessToken);
    return retry;
  } catch {
    return null;
  }
}
