import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withIgdbAuth, type IgdbHeaders } from "@/lib/igdb-auth";
import { coalesce, retryAfterSeconds } from "@/lib/api-resilience";

const base = "https://api.igdb.com/v4";
type Endpoint = "collections" | "franchises" | "games";
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function rateKey(clientId: string) { return `igdb-dispatch:${createHash("sha256").update(clientId).digest("hex")}`; }
async function dispatchSlot(clientId: string, signal: AbortSignal) {
  const key = rateKey(clientId);
  while (!signal.aborted) {
    // Shared across operators and server instances; 300ms spacing stays below 4 requests/s.
    const claimed = await prisma.$queryRaw<{ key: string }[]>`
      INSERT INTO "AuthRateLimit" ("key", "attempts", "resetsAt")
      VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '300 milliseconds')
      ON CONFLICT ("key") DO UPDATE SET "attempts" = 1, "resetsAt" = EXCLUDED."resetsAt"
      WHERE "AuthRateLimit"."resetsAt" <= CURRENT_TIMESTAMP
      RETURNING "key"
    `;
    if (claimed.length) return;
    const limit = await prisma.authRateLimit.findUnique({ where: { key }, select: { resetsAt: true } });
    if (limit && limit.resetsAt.getTime() - Date.now() > 2000) throw new Error("IGDB is cooling down.");
    await pause(300, signal);
  }
  throw signal.reason;
}
async function post(endpoint: Endpoint, body: string, headers: IgdbHeaders, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await dispatchSlot(headers["Client-ID"], signal);
    const response = await fetch(`${base}/${endpoint}`, {
      method: "POST", body, headers: { ...headers, Accept: "application/json", "Content-Type": "text/plain" },
      cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    if (response.status !== 429 && response.status !== 503) return response;
    const retrySeconds = retryAfterSeconds(response.headers.get("Retry-After"));
    const delay = response.headers.has("Retry-After") ? retrySeconds * 1000 : Math.random() * 400 * 2 ** attempt;
    if (attempt >= 2 || delay > 2000) {
      const key = rateKey(headers["Client-ID"]);
      await prisma.$executeRaw`
        INSERT INTO "AuthRateLimit" ("key", "attempts", "resetsAt") VALUES (${key}, 1, CURRENT_TIMESTAMP + ${retrySeconds} * INTERVAL '1 second')
        ON CONFLICT ("key") DO UPDATE SET "resetsAt" = GREATEST("AuthRateLimit"."resetsAt", EXCLUDED."resetsAt")
      `;
      return response;
    }
    await response.body?.cancel();
    await pause(delay, signal);
    // Every retry (including a replay after 401) goes through the global dispatch gate.
  }
}

/** All requests stay on IGDB's fixed origin; never pass a caller-provided URL or credentials. */
export async function queryIgdb(endpoint: Endpoint, body: string, parentSignal?: AbortSignal): Promise<unknown[] | null> {
  if (!["collections", "franchises", "games"].includes(endpoint) || body.length > 30000) return null;
  const signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(20000)]);
  try {
    const rows = await coalesce(`igdb-public:${endpoint}:${body}`, async () => {
      const response = await withIgdbAuth(headers => post(endpoint, body, headers, signal));
      if (!response?.ok) { await response?.body?.cancel(); return null; }
      const result: unknown = await response.json();
      return Array.isArray(result) && result.length <= 500 ? result : null;
    });
    return rows ? structuredClone(rows) : null;
  } catch { return null; }
}
