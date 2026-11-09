import "server-only";

import { registeredPlayerWhere } from "@/lib/auth-policy";

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionSigningKey, readSessionHash } from "@/lib/auth-session";
import { InputError } from "@/lib/action-result";
import { isValidPassword } from "@/lib/password-validation";
import { isValidEmail, normalizeEmail } from "@/lib/email-validation";

export type AccountSecuritySummary = { email: string; emailVerifiedAt: string | null; hasPassword: boolean; googleConnected: boolean; handle: string | null; createdAt: string; sessionExpiresAt: string };

export async function getCredentialSession() {
  const tokenHash = await readSessionHash();
  if (!tokenHash) throw new InputError("Sign in to manage your account security.");
  const session = await prisma.playerSession.findUnique({
    where: { tokenHash, expiresAt: { gt: new Date() }, player: { ...registeredPlayerWhere } },
    select: { expiresAt: true, player: { select: { id: true, email: true, emailVerifiedAt: true, passwordHash: true, googleId: true, handle: true, createdAt: true, isAdmin: true, isOwner: true } } },
  });
  if (!session?.player.email || (!session.player.passwordHash && !session.player.googleId)) throw new InputError("Sign in to manage your account security.");
  return { tokenHash, session, player: session.player };
}

export function credentialSummary(player: { email: string | null; emailVerifiedAt?: Date | null; passwordHash?: string | null; googleId?: string | null; handle: string | null; createdAt: Date }, expiresAt: Date): AccountSecuritySummary {
  return { email: player.email!, emailVerifiedAt: player.emailVerifiedAt?.toISOString() ?? null, hasPassword: Boolean(player.passwordHash), googleConnected: Boolean(player.googleId), handle: player.handle, createdAt: player.createdAt.toISOString(), sessionExpiresAt: expiresAt.toISOString() };
}

export function readCredentialChanges(data: FormData, currentEmail: string, hasPassword = true) {
  if (!(data instanceof FormData)) throw new InputError("Provide your current password and the credentials to update.");
  const currentPassword = data.get("currentPassword");
  const emailValue = data.get("newEmail"), passwordValue = data.get("newPassword");
  if (hasPassword && (typeof currentPassword !== "string" || !currentPassword.trim())) throw new InputError("Enter your current password to authorize changes.");
  if (hasPassword && typeof currentPassword === "string" && (currentPassword.length < 8 || currentPassword.length > 128)) throw new InputError("Current password is incorrect.");
  if ((emailValue !== null && typeof emailValue !== "string") || (passwordValue !== null && typeof passwordValue !== "string")) throw new InputError("Provide valid account credentials.");
  const email = typeof emailValue === "string" ? normalizeEmail(emailValue) : "";
  const newPassword = typeof passwordValue === "string" ? passwordValue : "";
  if (email && !isValidEmail(email)) throw new InputError("Enter a valid new email address.");
  if (newPassword && !isValidPassword(newPassword)) throw new InputError("New passwords must contain 8–128 characters and cannot be only spaces.");
  const newEmail = email && email !== currentEmail.toLowerCase() ? email : null;
  if (!hasPassword && newEmail) throw new InputError("Set a local password before changing your email address.");
  if (!newEmail && !newPassword) throw new InputError("Provide a changed email or a new password.");
  return { currentPassword: typeof currentPassword === "string" ? currentPassword : "", newEmail, newPassword };
}

// Five attempts per minute, per authenticated player, persisted across server instances.
export async function consumeCredentialAttempt(playerId: string): Promise<number> {
  const key = createHmac("sha256", await getSessionSigningKey()).update(`credential-update:${playerId}`).digest("hex");
  const now = new Date();
  const rows = await prisma.$queryRaw<{ attempts: number; resetsAt: Date }[]>`
    INSERT INTO "AuthRateLimit" ("key", "attempts", "resetsAt") VALUES (${key}, 1, ${new Date(now.getTime() + 60000)})
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN 1 ELSE "AuthRateLimit"."attempts" + 1 END,
      "resetsAt" = CASE WHEN "AuthRateLimit"."resetsAt" <= ${now} THEN EXCLUDED."resetsAt" ELSE "AuthRateLimit"."resetsAt" END
    RETURNING "attempts", "resetsAt"
  `;
  return rows[0].attempts > 5 ? Math.max(1, Math.ceil((rows[0].resetsAt.getTime() - Date.now()) / 1000)) : 0;
}
