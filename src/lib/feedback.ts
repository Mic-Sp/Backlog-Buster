import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getOptionalAuthenticatedPlayerId } from "@/lib/player";
import { feedbackCategories, type FeedbackPayload } from "@/lib/feedback-schema";

const windowMs = 10 * 60 * 1000;
const localBuckets = new Map<string, { attempts: number; resetsAt: number }>();

export async function feedbackIdentity(): Promise<{ userId: string; email: string | null } | null> {
  const userId = await getOptionalAuthenticatedPlayerId();
  if (!userId) return null;
  const player = await prisma.player.findUnique({ where: { id: userId }, select: { email: true } });
  return { userId, email: player?.email ?? null };
}

// Separate keys keep feedback throttling independent of sign-in/recovery. The
// global bucket also caps anonymous traffic if proxy IP headers are spoofed.
export async function consumeFeedbackAttempt(headers: Headers, userId?: string): Promise<number> {
  const ip = (headers.get("x-vercel-forwarded-for") || headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 128);
  const digest = createHash("sha256").update(userId ? `player:${userId}` : `ip:${ip}`).digest("hex");
  for (const [key, limit] of [[`feedback:${digest}`, 5], ["feedback:global", 100]] as const) {
    const now = new Date();
    let bucket: { attempts: number; resetsAt: Date };
    if (process.env.DATABASE_URL) {
      const rows = await prisma.$queryRaw<{ attempts: number; resetsAt: Date }[]>`
        INSERT INTO "AuthRateLimit" ("key", "attempts", "resetsAt") VALUES (${key}, 1, ${new Date(now.getTime() + windowMs)})
        ON CONFLICT ("key") DO UPDATE SET
          "attempts" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN 1 ELSE "AuthRateLimit"."attempts" + 1 END,
          "resetsAt" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN EXCLUDED."resetsAt" ELSE "AuthRateLimit"."resetsAt" END
        RETURNING "attempts", "resetsAt"
      `;
      bucket = rows[0];
    } else {
      // No database configured: bounded process-local protection for log-only use.
      for (const [entry, value] of localBuckets) if (value.resetsAt <= now.getTime()) localBuckets.delete(entry);
      if (!localBuckets.has(key) && localBuckets.size >= 2000) return 600;
      const current = localBuckets.get(key) ?? { attempts: 0, resetsAt: now.getTime() + windowMs };
      current.attempts++;
      localBuckets.set(key, current);
      bucket = { attempts: current.attempts, resetsAt: new Date(current.resetsAt) };
    }
    if (bucket.attempts > limit) return Math.max(1, Math.ceil((bucket.resetsAt.getTime() - now.getTime()) / 1000));
  }
  if (process.env.DATABASE_URL) await prisma.authRateLimit.deleteMany({ where: { key: { startsWith: "feedback:" }, resetsAt: { lt: new Date() } } });
  return 0;
}

export async function deliverFeedback(payload: FeedbackPayload, identity: Awaited<ReturnType<typeof feedbackIdentity>>) {
  const record = { id: randomUUID(), receivedAt: new Date().toISOString(), ...payload, identity };
  const recipient = process.env.FEEDBACK_EMAIL_TO?.trim();
  if (recipient && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM, to: [recipient],
          subject: `[Beta feedback] ${feedbackCategories[payload.category]}`,
          text: `${payload.message}\n\n--- Context ---\n${JSON.stringify({ ...record, message: undefined }, null, 2)}`,
        }),
      });
      if (response.ok) return record.id;
    } catch { /* Preserve the report in server logs if delivery times out or fails. */ }
    // Never print provider responses or credentials.
    console.warn("[beta-feedback] Email delivery unavailable; saving report to server logs.");
  }
  // JSON encoding prevents user text from forging additional log lines. Do not
  // include cookies, session tokens, query strings, or raw network addresses.
  console.info("[beta-feedback]", JSON.stringify(record));
  return record.id;
}
