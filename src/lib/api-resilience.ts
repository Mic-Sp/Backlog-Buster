import "server-only";
import { createHash } from "node:crypto";
import { RateLimitError } from "@/lib/action-result";
import { DEFAULT_COOLDOWN_SECONDS } from "@/lib/cooldown";

const flights = new Map<string, Promise<unknown>>();
const cooldowns = new Map<string, number>();
const upstreamCooldowns = new Map<string, number>();

/** Bound waits too (auth, dispatch, shared flights), even when work cannot be cancelled. */
export async function withAbortSignal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([aborted, work()]); }
  finally { signal.removeEventListener("abort", abort); }
}

export function retryAfterSeconds(value: string | null, fallback = 10): number {
  const seconds = value == null ? NaN : /^\d+(\.\d+)?$/.test(value.trim())
    ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : fallback;
}

export async function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = flights.get(key);
  if (existing) return existing as Promise<T>;
  const promise = Promise.resolve().then(work);
  flights.set(key, promise);
  try { return await promise; }
  finally { if (flights.get(key) === promise) flights.delete(key); }
}

// Process-local, bounded protection. A shared store is required across replicas.
export function requestCooldownRemaining(playerId: string, feature: string): number {
  return Math.max(0, Math.ceil(((cooldowns.get(`${playerId}:${feature}`) ?? 0) - Date.now()) / 1000));
}

// Synchronous claim prevents concurrent requests (including different inputs)
// from both dispatching. Zero means claimed; a positive value means skip/retry.
export function claimRequestCooldown(playerId: string, feature: string, seconds = DEFAULT_COOLDOWN_SECONDS): number {
  const key = `${playerId}:${feature}`;
  const now = Date.now();
  const remaining = requestCooldownRemaining(playerId, feature);
  if (remaining) return remaining;
  if (cooldowns.size >= 10000) {
    for (const [id, expiry] of cooldowns) if (expiry <= now) cooldowns.delete(id);
    if (cooldowns.size >= 10000) return seconds;
  }
  cooldowns.set(key, now + seconds * 1000);
  return 0;
}

export function guardedRequest<T>(playerId: string, feature: string, input: string, work: () => Promise<T>, seconds = DEFAULT_COOLDOWN_SECONDS): Promise<T> {
  return coalesce(`player:${playerId}:${feature}:${input}`, async () => {
    const retry = claimRequestCooldown(playerId, feature, seconds);
    if (retry) throw new RateLimitError(retry);
    return work();
  });
}

export async function resilientFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const key = createHash("sha256").update(JSON.stringify([url, options.method, options.headers, options.body])).digest("hex");
  const response = await coalesce(`fetch:${key}`, async () => {
    const origin = new URL(url).origin;
    const until = upstreamCooldowns.get(origin) ?? 0;
    if (until > Date.now()) throw new RateLimitError(Math.ceil((until - Date.now()) / 1000));
    for (let attempt = 0; ; attempt++) {
      const result = await fetch(url, { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(12000)]) });
      if (result.status !== 429 && result.status !== 503) return result;
      const retry = retryAfterSeconds(result.headers.get("Retry-After"));
      const delay = result.headers.has("Retry-After") ? retry * 1000 : Math.random() * 400 * 2 ** attempt;
      await result.body?.cancel();
      // Never hold a request open for a long provider quota window.
      if (attempt >= 2 || delay > 2000) {
        upstreamCooldowns.set(origin, Date.now() + retry * 1000);
        throw new RateLimitError(retry);
      }
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
        if (signal?.aborted) { reject(signal.reason); return; }
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  });
  // Each consumer gets an independently readable body.
  return response.clone();
}
