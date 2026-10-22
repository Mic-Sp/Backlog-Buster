"use server";

import { revalidatePath } from "next/cache";
import { actionErrorMessage, InputError, RateLimitError } from "@/lib/action-result";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { readCredentials, registerPlayer } from "@/lib/auth-accounts";
import { hashPassword, verifyPassword } from "@/lib/auth-crypto";
import { consumeAuthAttempt, createPlayerSession, destroyPlayerSession } from "@/lib/auth-session";

export type AuthState = { error?: string; mode?: "login" | "register"; retryAfterSeconds?: number };

export async function authenticate(mode: "login" | "register", _previous: AuthState, formData: FormData): Promise<AuthState> {
  if (mode !== "login" && mode !== "register") return { error: "Choose login or register." };
  let input;
  try { input = readCredentials(formData, mode === "register"); }
  catch (error) { return { mode, error: actionErrorMessage(error, "Check your account details.") }; }
  try {
    if (!await consumeAuthAttempt(input.email)) return { mode, error: "Too many account attempts. Wait for the cooldown before retrying.", retryAfterSeconds: 900 };
    let playerId: string;
    let verifiedHash: string;
    let verifiedEmail = input.email;
    if (mode === "register") {
      const passwordHash = await hashPassword(input.password);
      verifiedHash = passwordHash;
      try { playerId = (await registerPlayer(input, passwordHash)).id; }
      catch (error) {
        if (error instanceof Error && /^(That email|That handle)/.test(error.message)) return { mode, error: error.message };
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") return { mode, error: "That email or handle is already registered." };
        throw error;
      }
    } else {
      const player = await prisma.player.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true, passwordHash: true, email: true },
      });
      if (!await verifyPassword(input.password, player?.passwordHash ?? null) || !player) return { mode, error: "Incorrect email or password." };
      playerId = player.id;
      verifiedHash = player.passwordHash!;
      verifiedEmail = player.email!;
    }
    await createPlayerSession(playerId, async tx => {
      // Serialize with password resets/credential updates. A login verified before
      // a reset must not create a fresh session using the superseded password.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
      const current = await tx.player.findUnique({
        where: { id: playerId, email: verifiedEmail, passwordHash: verifiedHash }, select: { id: true },
      });
      if (!current) throw new InputError("Credentials changed. Sign in again with your current password.");
    });
  } catch (error) {
    if (error instanceof RateLimitError) return { mode, error: "Too many account attempts. Wait for the cooldown before retrying.", retryAfterSeconds: error.retryAfterSeconds };
    if (error instanceof InputError) return { mode, error: error.message };
    return { mode, error: "Account service unavailable. Please try again shortly." };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  try {
    await destroyPlayerSession();
    revalidatePath("/", "layout");
  } catch { return { error: "Could not log out. Please try again." }; }
  redirect("/");
}
