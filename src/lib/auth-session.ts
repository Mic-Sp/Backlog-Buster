import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sessionTokenHash, signSessionToken, verifySessionToken } from "@/lib/auth-crypto";

export const sessionCookieName = process.env.NODE_ENV === "production" ? "__Host-bb_session_v1" : "bb_session_v1";
const sessionSeconds = 7 * 24 * 60 * 60;
let signingKey: Promise<Buffer> | undefined;

export function getSessionSigningKey(): Promise<Buffer> {
  if (!signingKey) {
    signingKey = (async () => {
      const configured = process.env.AUTH_SECRET;
      if (configured) {
        if (Buffer.byteLength(configured) < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes.");
        return Buffer.from(configured);
      }
      // PostgreSQL resolves concurrent first-use initialization to the same key.
      const rows = await prisma.$queryRaw<{ value: string }[]>`
        INSERT INTO "AuthSecret" ("id", "value") VALUES ('session-signing-v1', ${randomBytes(32).toString("hex")})
        ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id" RETURNING "value"
      `;
      return Buffer.from(rows[0].value, "hex");
    })().catch((error) => { signingKey = undefined; throw error; });
  }
  return signingKey;
}

export async function readSessionHash(): Promise<string | null> {
  const value = (await cookies()).get(sessionCookieName)?.value;
  if (!value || value.length > 150) return null;
  return verifySessionToken(value, await getSessionSigningKey());
}

export async function createPlayerSession(userId: string, beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>) {
  const secret = await getSessionSigningKey();
  const previous = await readSessionHash();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionSeconds * 1000);
  if (beforeCreate) {
    // Credential updates and session rotation commit or roll back together.
    await prisma.$transaction(async tx => {
      await beforeCreate(tx);
      await tx.playerSession.deleteMany({ where: { OR: [
        { expiresAt: { lte: new Date() } }, ...(previous ? [{ tokenHash: previous }] : []),
      ] } });
      await tx.playerSession.create({ data: { userId, tokenHash: sessionTokenHash(token), expiresAt } });
    }, { timeout: 15000 });
  } else {
    await prisma.$transaction([
      prisma.playerSession.deleteMany({ where: { OR: [
        { expiresAt: { lte: new Date() } }, ...(previous ? [{ tokenHash: previous }] : []),
      ] } }),
      prisma.playerSession.create({ data: { userId, tokenHash: sessionTokenHash(token), expiresAt } }),
    ]);
  }

  (await cookies()).set(sessionCookieName, signSessionToken(token, secret), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: sessionSeconds, expires: expiresAt, priority: "high",
  });
  return { expiresAt };
}

export async function destroyPlayerSession() {
  const tokenHash = await readSessionHash();
  if (tokenHash) await prisma.playerSession.deleteMany({ where: { tokenHash } });
  (await cookies()).set(sessionCookieName, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0,
  });
}

export async function consumeAuthAttempt(email: string): Promise<boolean> {
  const secret = await getSessionSigningKey();
  const now = new Date();
  // An account limit survives restarts and cannot be bypassed by spoofing proxy headers.
  const account = createHmac("sha256", secret).update(`auth-email:${email}`).digest("hex");
  for (const [key, windowMs, limit] of [[account, 15 * 60 * 1000, 10], ["global", 60 * 1000, 60]] as const) {
    const result = await prisma.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "AuthRateLimit" ("key", "attempts", "resetsAt") VALUES (${key}, 1, ${new Date(now.getTime() + windowMs)})
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN 1 ELSE "AuthRateLimit"."attempts" + 1 END,
        "resetsAt" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN EXCLUDED."resetsAt" ELSE "AuthRateLimit"."resetsAt" END
      RETURNING "attempts"
    `;
    if (result[0].attempts > limit) return false;
  }
  await prisma.authRateLimit.deleteMany({ where: { resetsAt: { lt: now } } });
  return true;
}
