"use server";

import { revalidatePath } from "next/cache";
import { InputError, RateLimitError, safeAction } from "@/lib/action-result";
import { consumeCredentialAttempt, credentialSummary, getCredentialSession, readCredentialChanges } from "@/lib/account-security";
import { hashPassword, verifyPassword } from "@/lib/auth-crypto";
import { createPlayerSession } from "@/lib/auth-session";

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
