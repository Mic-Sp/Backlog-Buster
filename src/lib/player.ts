import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";

export type CurrentPlayer = { id: string; operatorName: string; handle: string | null; isLocal: boolean };
export class AuthenticationRequiredError extends Error {
  constructor() { super("Sign in to access your library."); this.name = "AuthenticationRequiredError"; }
}

// React cache shares only within this request, never between different users.
export const getCurrentPlayer = cache(async (): Promise<CurrentPlayer | null> => {
  const tokenHash = await readSessionHash();
  if (tokenHash) {
    const session = await prisma.playerSession.findUnique({
      where: { tokenHash, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null } } },
      select: { player: { select: { id: true, operatorName: true, handle: true } } },
    });
    if (session) return { ...session.player, isLocal: false };
  }
  // A deleted local archive must stay deleted; only explicit registration may recreate it.
  const local = await prisma.player.findUnique({ where: { id: "default-player" },
    select: { id: true, operatorName: true, handle: true, email: true, passwordHash: true },
  });
  if (!local || local.email !== null || local.passwordHash !== null) return null;
  return { id: local.id, operatorName: local.operatorName, handle: local.handle, isLocal: true };
});

export async function getCurrentPlayerId(): Promise<string> {
  const player = await getCurrentPlayer();
  if (!player) throw new AuthenticationRequiredError();
  return player.id;
}

// Mutations must never inherit the read-only, unclaimed local-profile fallback.
export async function getAuthenticatedPlayerId(): Promise<string> {
  const tokenHash = await readSessionHash();
  if (!tokenHash) throw new AuthenticationRequiredError();
  const session = await prisma.playerSession.findUnique({
    where: { tokenHash, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null } } },
    select: { userId: true },
  });
  if (!session) throw new AuthenticationRequiredError();
  return session.userId;
}

export async function ensurePlayerExists(id?: string) {
  id ??= await getCurrentPlayerId();
  return prisma.player.upsert({ where: { id }, create: { id }, update: {}, select: { id: true } });
}
