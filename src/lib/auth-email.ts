import "server-only";
import { registeredPlayerWhere } from "@/lib/auth-policy";

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionSigningKey } from "@/lib/auth-session";
import { issueAuthToken } from "@/lib/auth-tokens";
import { sendAuthEmail } from "@/lib/email";
import type { AuthTokenPurpose } from "@/generated/prisma/client";

// A separate bucket from login: recovery requests must never block sign-in.
// All addresses, including unknown ones, claim the same persistent limits.
export async function consumeAuthEmailAttempt(email: string, purpose: AuthTokenPurpose): Promise<boolean> {
  const digest = createHmac("sha256", await getSessionSigningKey()).update(`auth-email:${purpose}:${email}`).digest("hex");
  for (const [key, limit, windowMs] of [[digest, 1, 60000], [`auth-email-global:${purpose}`, 30, 60000]] as const) {
    const now = new Date();
    const rows = await prisma.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "AuthRateLimit" ("key", "attempts", "resetsAt") VALUES (${key}, 1, ${new Date(now.getTime() + windowMs)})
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN 1 ELSE "AuthRateLimit"."attempts" + 1 END,
        "resetsAt" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN EXCLUDED."resetsAt" ELSE "AuthRateLimit"."resetsAt" END
      RETURNING "attempts"
    `;
    if (rows[0].attempts > limit) return false;
  }
  await prisma.authRateLimit.deleteMany({ where: { resetsAt: { lt: new Date() } } });
  return true;
}

// Run via Next's after(): no account-dependent lookup, token write or provider
// latency occurs on the public reset-request response path.
export async function deliverAuthEmail(email: string, purpose: AuthTokenPurpose, userId?: string) {
  try {
    if (!await consumeAuthEmailAttempt(email, purpose)) return;
    const player = await prisma.player.findFirst({ where: {
      ...registeredPlayerWhere,
      ...(userId ? { id: userId } : {}),
      email: { equals: email.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" },
    }, select: { id: true, email: true, preferredLayoutMode: true } });
    if (!player?.email) return;
    const token = await issueAuthToken(player.id, player.email, purpose);
    if (token) await sendAuthEmail(player.email, purpose, token, player.preferredLayoutMode);
  } catch {
    console.error(`[auth-email] ${purpose} delivery unavailable; request a new link after the cooldown.`);
  }
}
