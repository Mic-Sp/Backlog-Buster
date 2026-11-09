import "server-only";
import { registeredPlayerWhere } from "@/lib/auth-policy";

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { InputError } from "@/lib/action-result";
import type { AuthTokenPurpose } from "@/generated/prisma/client";

export const authTokenLifetime = { verify_email: 24 * 60 * 60 * 1000, reset_password: 30 * 60 * 1000 };
export const invalidLinkMessage = "This link is invalid, expired, or already used. Please request a new one.";

export function authTokenHash(token: string): string {
  // Domain separation prevents treating a recovery token as a session token.
  return createHash("sha256").update(`backlogbuster-auth-link-v1:${token}`).digest("hex");
}

export function isAuthToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function issueAuthToken(userId: string, email: string, purpose: AuthTokenPurpose) {
  const token = randomBytes(32).toString("base64url");
  const issued = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
    const player = await tx.player.findUnique({ where: { ...registeredPlayerWhere, id: userId, email }, select: { emailVerifiedAt: true } });
    if (!player || (purpose === "verify_email" && player.emailVerifiedAt)) return false;
    await tx.playerAuthToken.deleteMany({ where: { userId, purpose } });
    await tx.playerAuthToken.create({ data: {
      tokenHash: authTokenHash(token), userId, email, purpose,
      expiresAt: new Date(Date.now() + authTokenLifetime[purpose]),
    } });
    return true;
  });
  return issued ? token : null;
}

export async function isAuthLinkValid(token: unknown, purpose: AuthTokenPurpose): Promise<boolean> {
  if (!isAuthToken(token)) return false;
  return Boolean(await prisma.playerAuthToken.findFirst({ where: {
    tokenHash: authTokenHash(token), purpose, expiresAt: { gt: new Date() },
    // The consuming transaction checks the exact email binding too.
  }, select: { tokenHash: true } }));
}

export async function consumeAuthToken(token: unknown, purpose: AuthTokenPurpose, passwordHash?: string) {
  if (!isAuthToken(token) || (purpose === "reset_password" && !passwordHash)) throw new InputError(invalidLinkMessage);
  return prisma.$transaction(async tx => {
    // Shared with login, issuance, self-service and admin credential changes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
    const now = new Date();
    const where = { tokenHash: authTokenHash(token), purpose, expiresAt: { gt: now } };
    const link = await tx.playerAuthToken.findFirst({ where });
    if (!link) throw new InputError(invalidLinkMessage);
    const claimed = await tx.playerAuthToken.deleteMany({ where });
    if (claimed.count !== 1) throw new InputError(invalidLinkMessage);
    const updated = await tx.player.updateMany({
      where: { ...registeredPlayerWhere, id: link.userId, email: link.email },
      data: purpose === "verify_email" ? { emailVerifiedAt: now } : { passwordHash },
    });
    if (updated.count !== 1) throw new InputError(invalidLinkMessage);
    if (purpose === "reset_password") {
      await tx.playerAuthToken.deleteMany({ where: { userId: link.userId } });
      await tx.playerSession.deleteMany({ where: { userId: link.userId } });
    }
    return { userId: link.userId };
  }, { timeout: 15000 });
}
