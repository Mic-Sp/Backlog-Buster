"use server";

import { revalidatePath } from "next/cache";
import { InputError, RateLimitError, safeAction } from "@/lib/action-result";
import { consumeCredentialAttempt, credentialSummary, getCredentialSession, readCredentialChanges } from "@/lib/account-security";
import { hashPassword, verifyPassword } from "@/lib/auth-crypto";
import { prisma } from "@/lib/prisma";
import { createPlayerSession, clearPlayerSessionCookie } from "@/lib/auth-session";

export async function getAccountSecuritySummary() {
  return safeAction(async () => {
    const { player, session } = await getCredentialSession();
    return credentialSummary(player, session.expiresAt);
  });
}

export async function updateAccountCredentials(formData: FormData) {
  return safeAction(async () => {
    const { player, tokenHash } = await getCredentialSession();
    const input = readCredentialChanges(formData, player.email!);
    const retryAfter = await consumeCredentialAttempt(player.id);
    if (retryAfter) throw new RateLimitError(retryAfter);
    if (!await verifyPassword(input.currentPassword, player.passwordHash)) throw new InputError("Current password is incorrect.");
    const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null;
    try {
      const refreshed = await createPlayerSession(player.id, async tx => {
        // Share the registration lock to make case-insensitive email claims atomic.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        const active = await tx.playerSession.findUnique({ where: { tokenHash, userId: player.id, expiresAt: { gt: new Date() } }, select: { tokenHash: true } });
        if (!active) throw new InputError("Your session expired. Sign in again to update credentials.");
        if (input.newEmail) {
          const taken = await tx.player.findFirst({ where: {
            email: { equals: input.newEmail.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" }, id: { not: player.id },
          }, select: { id: true } });
          if (taken) throw new InputError("That email address is already in use. Choose another.");
        }
        await tx.player.update({
          where: { id: player.id, passwordHash: player.passwordHash, email: player.email! },
          data: { ...(input.newEmail ? { email: input.newEmail } : {}), ...(passwordHash ? { passwordHash } : {}) }, select: { id: true },
        });
      });
      revalidatePath("/", "layout");
      return { success: true, email: input.newEmail ?? player.email!, sessionExpiresAt: refreshed.expiresAt.toISOString(), message: "SECURITY CREDENTIALS UPDATED // ARCHIVE LOCKED" };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "P2002") throw new InputError("That email address is already in use. Choose another.");
        if (error.code === "P2025") throw new InputError("Credentials changed in another session. Reopen the gateway and try again.");
      }
      throw error;
    }
  });
}


export async function resetOperatorLibrary(formData: FormData) {
  return safeAction(async () => {
    const { player, tokenHash } = await getCredentialSession();
    if (!(formData instanceof FormData)) throw new InputError("Confirm your password and type RESET LIBRARY.");
    const phrase = formData.get("confirmation");
    const password = formData.get("currentPassword");
    if (typeof phrase !== "string" || phrase.trim().toUpperCase() !== "RESET LIBRARY") throw new InputError("Type RESET LIBRARY to confirm the library reset.");
    if (typeof password !== "string" || !password.trim()) throw new InputError("Enter your current password to authorize the library reset.");
    const retryAfter = await consumeCredentialAttempt(player.id);
    if (retryAfter) throw new RateLimitError(retryAfter);
    if (password.length < 8 || password.length > 128 || !await verifyPassword(password, player.passwordHash)) throw new InputError("Current password is incorrect.");
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        const active = await tx.playerSession.findUnique({ where: { tokenHash, userId: player.id, expiresAt: { gt: new Date() } }, select: { tokenHash: true } });
        if (!active) throw new InputError("Your session expired. Sign in again before resetting this archive.");
        // Lock the owner and reject credentials changed since password verification.
        // Everything else on the profile, including every device session, is retained.
        await tx.player.update({ where: { id: player.id, passwordHash: player.passwordHash, email: player.email! }, data: { featuredTrophyIds: [] }, select: { id: true } });
        await tx.game.deleteMany({ where: { userId: player.id } });
        await tx.userAchievement.deleteMany({ where: { userId: player.id } });
      }, { timeout: 15000 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") throw new InputError("Your account changed. Reopen the security gateway and verify again.");
      throw error;
    }
    revalidatePath("/", "layout");
    if (player.handle) revalidatePath(`/dossier/${encodeURIComponent(player.handle)}`);
    return { success: true, message: "ARCHIVE RESET COMPLETE // TELEMETRY RESTORED TO LEVEL 1" };
  });
}

export async function wipeOperatorAccount(formData: FormData) {
  return safeAction(async () => {
    const { player, tokenHash } = await getCredentialSession();
    if (!(formData instanceof FormData)) throw new InputError("Confirm your password and type WIPE ARCHIVE.");
    const phrase = formData.get("confirmation");
    const password = formData.get("currentPassword");
    if (typeof phrase !== "string" || phrase.trim().toUpperCase() !== "WIPE ARCHIVE") throw new InputError("Type WIPE ARCHIVE to confirm account termination.");
    if (typeof password !== "string" || !password.trim()) throw new InputError("Enter your current password to authorize account termination.");
    const retryAfter = await consumeCredentialAttempt(player.id);
    if (retryAfter) throw new RateLimitError(retryAfter);
    if (password.length < 8 || password.length > 128 || !await verifyPassword(password, player.passwordHash)) throw new InputError("Current password is incorrect.");
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        const active = await tx.playerSession.findUnique({ where: { tokenHash, userId: player.id, expiresAt: { gt: new Date() } }, select: { tokenHash: true } });
        if (!active) throw new InputError("Your session expired. Sign in again before terminating this archive.");
        // Database cascades remove this player's games, achievements and every device session.
        await tx.player.delete({ where: { id: player.id, passwordHash: player.passwordHash, email: player.email! }, select: { id: true } });
      }, { timeout: 15000 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") throw new InputError("Your account changed. Reopen the security gateway and verify again.");
      throw error;
    }
    await clearPlayerSessionCookie();
    revalidatePath("/", "layout");
    if (player.handle) revalidatePath(`/dossier/${encodeURIComponent(player.handle)}`);
    return { success: true, redirectTo: "/access?archive=wiped", message: "OPERATOR ARCHIVE WIPED // CONNECTION TERMINATED" };
  });
}
