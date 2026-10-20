import "server-only";
import { prisma } from "@/lib/prisma";

// Replace this with the authenticated session's user ID when auth is connected.
// Server Actions resolve ownership here rather than trusting a submitted userId.
export function getCurrentPlayerId() {
  return "default-player";
}

// Also covers a future authenticated player whose profile has not been opened yet.
export async function ensurePlayerExists(id = getCurrentPlayerId()) {
  return prisma.player.upsert({ where: { id }, create: { id }, update: {}, select: { id: true } });
}
