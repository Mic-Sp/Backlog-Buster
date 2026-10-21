import "server-only";
import { InputError } from "@/lib/action-result";

import { prisma } from "@/lib/prisma";

export type Registration = { email: string; password: string; handle: string | null; operatorName: string | null };

export function readCredentials(form: FormData, register = false): Registration {
  const emailValue = form.get("email"), password = form.get("password");
  if (typeof emailValue !== "string" || typeof password !== "string") throw new InputError("Enter your email and password.");
  const email = emailValue.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Enter a valid email address.");
  if (!password.trim()) throw new InputError("Please enter a password.");
  if (password.length < 8 || password.length > 128) throw new InputError(register ? "Use a password of 8–128 characters." : "Incorrect email or password.");
  let handle: string | null = null, operatorName: string | null = null;
  if (register) {
    const handleValue = form.get("handle"), nameValue = form.get("operatorName");
    if (typeof handleValue === "string" && handleValue !== "" && !handleValue.trim()) throw new InputError("Enter a valid handle or leave it empty.");
    if (typeof nameValue === "string" && nameValue !== "" && !nameValue.trim()) throw new InputError("Enter a valid operator name or leave it empty.");
    if ((handleValue !== null && typeof handleValue !== "string") || (nameValue !== null && typeof nameValue !== "string")) throw new InputError("Enter a valid handle and operator name.");
    handle = typeof handleValue === "string" ? handleValue.trim().toLowerCase() || null : null;
    operatorName = typeof nameValue === "string" ? nameValue.trim() || null : null;
    if (handle && !/^[a-z0-9][a-z0-9_-]{2,23}$/.test(handle)) throw new InputError("Handles use 3–24 letters, numbers, underscores or hyphens.");
    if (operatorName && operatorName.length > 28) throw new InputError("Operator names can have up to 28 characters.");
  }
  return { email, password, handle, operatorName };
}

// Kept separate from cookies so the in-place claim can be tested in a rollback-only transaction.
export async function registerPlayer(input: Omit<Registration, "password">, passwordHash: string) {
  return prisma.$transaction(async (tx) => {
    // Serialize first claims and normalized email/handle checks across server instances.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
    const local = await tx.player.findUnique({ where: { id: "default-player" } });
    const claimLocal = !local || (local.email === null && local.passwordHash === null);
    const emailTaken = await tx.player.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true } });
    if (emailTaken) throw new InputError("That email is already registered. Sign in instead.");
    if (input.handle) {
      const handleTaken = await tx.player.findFirst({ where: {
        handle: { equals: input.handle, mode: "insensitive" }, ...(claimLocal ? { id: { not: "default-player" } } : {}),
      }, select: { id: true } });
      if (handleTaken) throw new InputError("That handle is already in use. Choose another.");
    }
    const data = {
      email: input.email, passwordHash,
      handle: input.handle ?? (claimLocal ? local?.handle ?? null : null),
      operatorName: input.operatorName ?? (claimLocal ? local?.operatorName : input.handle) ?? "ANONYMOUS NETRUNNER",
    };
    if (local && claimLocal) {
      return tx.player.update({ where: { id: "default-player", AND: [{ email: null }, { passwordHash: null }] }, data, select: { id: true } });
    }
    return tx.player.create({ data: { ...(claimLocal ? { id: "default-player" } : {}), ...data }, select: { id: true } });
  }, { timeout: 15000 });
}
