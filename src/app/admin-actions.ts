"use server";

import { revalidatePath } from "next/cache";
import { AdminRequiredError, requireAdmin } from "@/lib/admin";
import { InputError, safeAction } from "@/lib/action-result";
import { normalizeFranchiseKey } from "@/lib/franchise-key";
import { calculateLevelProgress } from "@/lib/player-level";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth-crypto";
import { isValidPassword } from "@/lib/password-validation";
import { isValidEmail, normalizeEmail } from "@/lib/email-validation";
import type { Prisma } from "@/generated/prisma/client";

// Match registration/member counts, excluding unclaimed local archives.
const registeredPlayers = { email: { not: null }, passwordHash: { not: null } };

export async function getAdminSystemOverview() {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const overview = await prisma.$transaction(async tx => {
      const [registeredAccountCount, adminAccountCount, trackedGameCount, cachedSagaCount] = await Promise.all([
        tx.player.count({ where: registeredPlayers }),
        tx.player.count({ where: { ...registeredPlayers, isAdmin: true } }),
        tx.game.count(),
        tx.franchiseChronology.count(),
      ]);
      // FranchiseChronology is the persisted saga/catalog cache; OAuth tokens
      // and auth secrets are credentials and are never telemetry payloads.
      return { registeredAccountCount, adminAccountCount, trackedGameCount, cachedSagaCount };
    }, { isolationLevel: "RepeatableRead" });
    if ((await requireAdmin()).id !== admin.id) throw new AdminRequiredError();
    return overview;
  });
}

export async function getAdminPlayerDirectory(page = 1, pageSize = 50) {
  return safeAction(async () => {
    const admin = await requireAdmin();
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize) || (page - 1) * pageSize > 2_147_483_647) {
      throw new InputError("Choose a valid directory page and page size (1–100).");
    }
    const directory = await prisma.$transaction(async tx => {
      const [totalCount, players] = await Promise.all([
        tx.player.count({ where: registeredPlayers }),
        tx.player.findMany({
          where: registeredPlayers, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * pageSize, take: pageSize,
          select: { id: true, operatorName: true, handle: true, email: true, isAdmin: true, isOwner: true, createdAt: true, updatedAt: true },
        }),
      ]);
      const where = { userId: { in: players.map(player => player.id) } };
      const [games, achievements, sessions, activeSessions] = players.length ? await Promise.all([
        tx.game.groupBy({ by: ["userId"], where, _count: { _all: true }, _sum: { earnedXp: true }, _max: { createdAt: true } }),
        tx.userAchievement.groupBy({ by: ["userId"], where, _sum: { xpAwarded: true }, _max: { unlockedAt: true } }),
        tx.playerSession.groupBy({ by: ["userId"], where, _max: { createdAt: true } }),
        tx.playerSession.groupBy({ by: ["userId"], where: { ...where, expiresAt: { gt: new Date() } }, _count: { _all: true } }),
      ]) : [[], [], [], []];
      const gamesByPlayer = new Map(games.map(row => [row.userId, row]));
      const achievementsByPlayer = new Map(achievements.map(row => [row.userId, row]));
      const sessionsByPlayer = new Map(sessions.map(row => [row.userId, row]));
      const activeSessionsByPlayer = new Map(activeSessions.map(row => [row.userId, row._count._all]));
      return {
        page, pageSize, totalCount, pageCount: Math.ceil(totalCount / pageSize),
        players: players.map(player => {
          const game = gamesByPlayer.get(player.id), achievement = achievementsByPlayer.get(player.id);
          const latestSessionAt = sessionsByPlayer.get(player.id)?._max.createdAt ?? null;
          const totalXp = Math.round((game?._sum.earnedXp ?? 0) + (achievement?._sum.xpAwarded ?? 0));
          // Best available persisted activity, not online status or a complete
          // last-seen history: games lack updatedAt and old sessions get removed.
          const activity = [player.updatedAt, game?._max.createdAt, achievement?._max.unlockedAt, latestSessionAt]
            .filter((date): date is Date => date instanceof Date);
          return {
            id: player.id, operatorName: player.operatorName, handle: player.handle, email: player.email,
            isAdmin: player.isAdmin, isOwner: player.isOwner, gameCount: game?._count._all ?? 0, totalXp, level: calculateLevelProgress(totalXp).level,
            activeSessionCount: activeSessionsByPlayer.get(player.id) ?? 0,
            createdAt: player.createdAt.toISOString(), updatedAt: player.updatedAt.toISOString(),
            latestSessionAt: latestSessionAt?.toISOString() ?? null,
            lastRecordedActivityAt: new Date(Math.max(...activity.map(date => date.getTime()))).toISOString(),
          };
        }),
      };
    }, { isolationLevel: "RepeatableRead" });
    if ((await requireAdmin()).id !== admin.id) throw new AdminRequiredError();
    return directory;
  });
}

export type ChronologyPurgeScope = { kind: "all" } | { kind: "saga"; slug: string };

export async function purgeSagaChronologyCache(scope: ChronologyPurgeScope) {
  return safeAction(async () => {
    await requireAdmin();
    if (!scope || typeof scope !== "object" || Array.isArray(scope) || !["all", "saga"].includes(scope.kind)) {
      throw new InputError("Choose a saga cache or explicitly select all chronology caches.");
    }
    if (scope.kind === "saga" && (typeof scope.slug !== "string" || !scope.slug || scope.slug.length > 240 ||
      scope.slug !== normalizeFranchiseKey(scope.slug))) throw new InputError("Choose a valid cached saga slug.");
    // A single delete is atomic and affects public metadata only. Existing game
    // ranks remain intact; subsequent scans (including in-flight scans) can repopulate.
    const result = await prisma.franchiseChronology.deleteMany({ where: scope.kind === "all" ? {} : { slug: scope.slug } });
    revalidatePath("/", "layout");
    return { success: true, deletedCount: result.count };
  });
}

function readTargetPlayerId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new InputError("Choose a valid registered player account.");
  return value.trim();
}

function accountMutationError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
    throw new InputError("That account is unavailable or changed. Refresh the directory and try again.");
  }
  throw error;
}

// Call only while holding the account-management lock. Owner targets are immune
// even to the Owner's own admin tools; self-service settings handle credentials.
async function manageableTarget(tx: Prisma.TransactionClient, actorId: string, id: string) {
  const actor = await requireAdmin();
  if (actor.id !== actorId) throw new AdminRequiredError();
  const target = await tx.player.findUnique({
    where: { id, AND: [registeredPlayers] }, select: { id: true, email: true, isAdmin: true, isOwner: true },
  });
  if (!target) throw new InputError("Choose an existing registered player account. Unclaimed local archives are protected.");
  if (target.isOwner) throw new InputError("The Owner account is protected. Use normal self-service settings for your own credentials.");
  if (target.isAdmin && !actor.isOwner) throw new InputError("Only the Owner can manage admin accounts.");
  return { actor, target, guard: { isOwner: false, ...(!actor.isOwner ? { isAdmin: false } : {}) } };
}

export async function adminResetPlayerPassword(targetPlayerId: string, newPassword: string) {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const id = readTargetPlayerId(targetPlayerId);
    if (!isValidPassword(newPassword)) throw new InputError("New passwords must contain 8–128 characters and cannot be only spaces.");
    const passwordHash = await hashPassword(newPassword);
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        // Recheck after expensive hashing/lock waits, before changing credentials.
        const { guard } = await manageableTarget(tx, admin.id, id);
        await tx.player.update({ where: { id, ...guard, AND: [registeredPlayers] }, data: { passwordHash }, select: { id: true } });
        // Includes every device, even expired records. Hash update and revocation
        // commit together; a revocation failure rolls back the password change.
        await tx.playerSession.deleteMany({ where: { userId: id, player: guard } });
      }, { timeout: 15000 });
    } catch (error) { accountMutationError(error); }
    revalidatePath("/", "layout");
    return { success: true };
  });
}

export async function adminUpdatePlayerEmail(targetPlayerId: string, newEmail: string) {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const id = readTargetPlayerId(targetPlayerId);
    if (typeof newEmail !== "string") throw new InputError("Enter a valid new email address.");
    const email = normalizeEmail(newEmail);
    if (!isValidEmail(email)) throw new InputError("Enter a valid new email address.");
    try {
      await prisma.$transaction(async tx => {
        // Share registration/credential-update serialization across server instances.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        const { target, guard } = await manageableTarget(tx, admin.id, id);
        if (!target?.email) throw new InputError("Choose an existing registered player account. Unclaimed local archives are protected.");
        if (email === target.email.toLowerCase()) throw new InputError("Provide a changed email address.");
        const taken = await tx.player.findFirst({
          // Prisma's case-insensitive PostgreSQL lookup uses ILIKE; escape pattern
          // characters exactly as self-service credential updates do.
          where: { email: { equals: email.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" }, id: { not: id } },
          select: { id: true },
        });
        if (taken) throw new InputError("That email address is already in use. Choose another.");
        await tx.player.update({ where: { id, email: target.email, ...guard, AND: [registeredPlayers] }, data: { email }, select: { id: true } });
        // An admin cannot rotate another device's cookie. Revoke all target
        // sessions atomically, matching admin password resets and login rechecks.
        await tx.playerSession.deleteMany({ where: { userId: id, player: guard } });
      }, { timeout: 15000 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new InputError("That email address is already in use. Choose another.");
      }
      accountMutationError(error);
    }
    revalidatePath("/", "layout");
    return { success: true, email };
  });
}

export async function adminDeletePlayerAccount(targetPlayerId: string) {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const id = readTargetPlayerId(targetPlayerId);
    if (id === admin.id) throw new InputError("You cannot delete your own active admin account.");
    let deleted;
    try {
      deleted = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        const { guard } = await manageableTarget(tx, admin.id, id);
        // The predicate also protects an account promoted after the read. Prisma
        // schema cascades delete its sessions, games and achievements atomically.
        return tx.player.delete({ where: { id, ...guard, AND: [registeredPlayers] }, select: { handle: true } });
      }, { timeout: 15000 });
    } catch (error) { accountMutationError(error); }
    revalidatePath("/", "layout");
    if (deleted.handle) revalidatePath(`/dossier/${encodeURIComponent(deleted.handle)}`);
    return { success: true };
  });
}

export async function adminRevokePlayerSessions(targetPlayerId: string) {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const id = readTargetPlayerId(targetPlayerId);
    if (id === admin.id) throw new InputError("Use Log Out to end your own session. Admin force sign-out is for other accounts.");
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
      const { guard } = await manageableTarget(tx, admin.id, id);
      return tx.playerSession.deleteMany({ where: { userId: id, player: guard, expiresAt: { gt: new Date() } } });
    }, { timeout: 15000 });
    revalidatePath("/", "layout");
    return { success: true, revokedCount: result.count };
  });
}

export async function adminPruneExpiredSessions() {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
      if ((await requireAdmin()).id !== admin.id) throw new AdminRequiredError();
      return tx.playerSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    }, { timeout: 15000 });
    revalidatePath("/", "layout");
    return { success: true, deletedCount: result.count };
  });
}

// Set the intended role explicitly so retries never toggle an account twice.
export async function adminSetPlayerAdmin(targetPlayerId: string, isAdmin: boolean) {
  return safeAction(async () => {
    const admin = await requireAdmin();
    const id = readTargetPlayerId(targetPlayerId);
    if (typeof isAdmin !== "boolean") throw new InputError("Choose a valid admin role.");
    if (id === admin.id && !isAdmin) throw new InputError("You cannot demote your own active admin account.");
    let changed = false;
    try {
      changed = await prisma.$transaction(async tx => {
        // All app role changes and account deletions share this lock. An admin
        // demoted while waiting must fail the fresh authorization check below.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        const { actor, target, guard } = await manageableTarget(tx, admin.id, id);
        if (!actor.isOwner) throw new InputError("Only the Owner can promote or demote admins.");
        if (target.isAdmin === isAdmin) return false;
        if (!isAdmin && await tx.player.count({ where: { ...registeredPlayers, isAdmin: true } }) <= 1) {
          throw new InputError("At least one registered admin account must remain.");
        }
        await tx.player.update({ where: { id, ...guard, isAdmin: target.isAdmin, AND: [registeredPlayers] }, data: { isAdmin }, select: { id: true } });
        // Privilege changes require a fresh sign-in; role and session updates
        // commit together and preserve the caller's own active session.
        await tx.playerSession.deleteMany({ where: { userId: id, player: guard } });
        return true;
      }, { timeout: 15000 });
    } catch (error) { accountMutationError(error); }
    revalidatePath("/", "layout");
    return { success: true, isAdmin, changed };
  });
}
