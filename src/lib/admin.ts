import "server-only";

import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";
import { AuthenticationRequiredError } from "@/lib/player";

export class AdminRequiredError extends Error {
  constructor() { super("Admin access required."); this.name = "AdminRequiredError"; }
}

// Deliberately uncached: every privileged request checks the live session and
// current database flag together. UI props and bootstrap configuration confer no access.
export async function requireAdmin(): Promise<{ id: string; isAdmin: true; isOwner: boolean }> {
  const tokenHash = await readSessionHash();
  if (!tokenHash) throw new AuthenticationRequiredError();
  const session = await prisma.playerSession.findUnique({
    where: { tokenHash, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null } } },
    select: { player: { select: { id: true, isAdmin: true, isOwner: true } } },
  });
  if (!session) throw new AuthenticationRequiredError();
  if (!session.player.isAdmin) throw new AdminRequiredError();
  return { id: session.player.id, isAdmin: true, isOwner: session.player.isOwner === true };
}
