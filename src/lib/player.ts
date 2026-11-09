import "server-only";

import { registeredPlayerWhere } from "@/lib/auth-policy";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";
import { normalizeLayoutMode, type LayoutMode } from "@/lib/appearance";

export type CurrentPlayer = { id: string; operatorName: string; handle: string | null; isLocal: boolean; isAdmin: boolean; isOwner: boolean; preferredLayoutMode: LayoutMode };
export class AuthenticationRequiredError extends Error {
  constructor() { super("Sign in to access your library."); this.name = "AuthenticationRequiredError"; }
}

// React cache shares only within this request, never between different users.
export const getCurrentPlayer = cache(async (): Promise<CurrentPlayer | null> => {
  const tokenHash = await readSessionHash();
  if (tokenHash) {
    const session = await prisma.playerSession.findUnique({
      where: { tokenHash, expiresAt: { gt: new Date() }, player: { ...registeredPlayerWhere } },
      select: { player: { select: { id: true, operatorName: true, handle: true, isAdmin: true, isOwner: true, preferredLayoutMode: true } } },
    });
    if (session) return { ...session.player, preferredLayoutMode: normalizeLayoutMode(session.player.preferredLayoutMode), isLocal: false };
  }
  // A deleted local archive must stay deleted; only explicit registration may recreate it.
  const local = await prisma.player.findUnique({ where: { id: "default-player" },
    select: { id: true, operatorName: true, handle: true, email: true, passwordHash: true, googleId: true, steamVerifiedId: true },
  });
  if (!local || local.email !== null || local.passwordHash !== null || local.googleId || local.steamVerifiedId) return null;
  return { id: local.id, operatorName: local.operatorName, handle: local.handle, isLocal: true, isAdmin: false, isOwner: false, preferredLayoutMode: "cyberpunk" };
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
    where: { tokenHash, expiresAt: { gt: new Date() }, player: { ...registeredPlayerWhere } },
    select: { userId: true },
  });
  if (!session) throw new AuthenticationRequiredError();
  return session.userId;
}

/** Public views may be anonymous, but the unclaimed local archive is never a viewer identity. */
export async function getOptionalAuthenticatedPlayerId(): Promise<string | null> {
  try { return await getAuthenticatedPlayerId(); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError) return null;
    throw error;
  }
}

export async function ensurePlayerExists(id?: string) {
  id ??= await getCurrentPlayerId();
  return prisma.player.upsert({ where: { id }, create: { id }, update: {}, select: { id: true } });
}
