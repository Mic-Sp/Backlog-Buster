import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, SteamAuthSync } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { SteamAPIError } from "@/lib/steam";
import { RateLimitError } from "@/lib/action-result";
import { syncSteamLibraryForSession, type SteamSyncSession } from "@/lib/library-vault";

const MAX_ATTEMPTS = 3;
const LEASE_MS = 90000;
export type SteamAuthSyncView = {
  requestId: string; status: "pending" | "running" | "completed" | "failed";
  linked: boolean; errorCode: string | null; addedCount: number; updatedCount: number;
  canRetry: boolean; retryAfterSeconds: number;
};

/** Commit the sync intent with account resolution and session creation. No provider I/O here. */
export async function queueSteamAuthSync(tx: Prisma.TransactionClient, userId: string, steamId: string, mode: "signin" | "link") {
  const data = { requestId: randomUUID(), steamId, mode, status: "pending", attempts: 0, leaseId: null, leaseUntil: null,
    errorCode: null, addedCount: 0, updatedCount: 0 };
  await tx.steamAuthSync.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export function steamAuthSyncView(row: SteamAuthSync | null): SteamAuthSyncView | null {
  if (!row) return null;
  const expired = row.status === "running" && (!row.leaseUntil || row.leaseUntil.getTime() <= Date.now());
  const exhausted = expired && row.attempts >= MAX_ATTEMPTS;
  const status = exhausted ? "failed" : expired ? "pending" : row.status as SteamAuthSyncView["status"];
  return { requestId: row.requestId, status, linked: row.mode === "link", errorCode: exhausted ? "TIMEOUT" : row.errorCode,
    addedCount: row.addedCount, updatedCount: row.updatedCount, canRetry: status === "failed" && row.attempts < MAX_ATTEMPTS,
    retryAfterSeconds: status === "failed" ? Math.max(0, Math.ceil((row.updatedAt.getTime() + 10000 - Date.now()) / 1000)) : 0 };
}

export async function getSteamAuthSyncView(userId: string) {
  return steamAuthSyncView(await prisma.steamAuthSync.findUnique({ where: { userId } }));
}

/** A request-bound worker: durable claim, bounded provider work, and fenced writes. */
export async function runSteamAuthSync(session: SteamSyncSession, requestId: string, retry = false): Promise<SteamAuthSyncView | null> {
  const row = await prisma.steamAuthSync.findUnique({ where: { userId: session.userId } });
  if (!row || row.requestId !== requestId) return steamAuthSyncView(row);
  const now = new Date(), leaseId = randomUUID();
  const claimed = await prisma.steamAuthSync.updateMany({ where: {
    userId: session.userId, requestId, attempts: { lt: MAX_ATTEMPTS },
    player: { steamVerifiedId: row.steamId, sessions: { some: { tokenHash: session.tokenHash, expiresAt: { gt: now } } } },
    OR: [{ status: "pending" }, { status: "running", leaseUntil: { lte: now } },
      ...(retry ? [{ status: "failed", updatedAt: { lte: new Date(now.getTime() - 10000) } }] : [])],
  }, data: { status: "running", leaseId, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, errorCode: null } });
  if (!claimed.count) return getSteamAuthSyncView(session.userId);
  try {
    // Ignore editable/manual IDs and include never-played owned games on auth imports.
    const { summary } = await syncSteamLibraryForSession({ identifier: row.steamId, includeUnplayed: true, updateHoursPlayed: true },
      { ...session, verifiedSteamId: row.steamId, authSync: { requestId, leaseId } });
    await prisma.steamAuthSync.updateMany({ where: { userId: session.userId, requestId, leaseId, status: "running" },
      data: { status: "completed", leaseUntil: null, leaseId: null, addedCount: summary.addedCount, updatedCount: summary.updatedCount } });
  } catch (error) {
    // Never expose provider URLs/API keys, DB messages or raw exception text.
    const errorCode = error instanceof SteamAPIError ? error.code : error instanceof RateLimitError ? "RATE_LIMIT" : "SYNC_FAILED";
    await prisma.steamAuthSync.updateMany({ where: { userId: session.userId, requestId, leaseId, status: "running" },
      data: { status: "failed", leaseUntil: null, leaseId: null, errorCode } });
  }
  return getSteamAuthSyncView(session.userId);
}
