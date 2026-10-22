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
          select: { id: true, operatorName: true, handle: true, email: true, isAdmin: true, createdAt: true, updatedAt: true },
        }),
      ]);
      const where = { userId: { in: players.map(player => player.id) } };
      const [games, achievements, sessions] = players.length ? await Promise.all([
        tx.game.groupBy({ by: ["userId"], where, _count: { _all: true }, _sum: { earnedXp: true }, _max: { createdAt: true } }),
        tx.userAchievement.groupBy({ by: ["userId"], where, _sum: { xpAwarded: true }, _max: { unlockedAt: true } }),
        tx.playerSession.groupBy({ by: ["userId"], where, _max: { createdAt: true } }),
      ]) : [[], [], []];
      const gamesByPlayer = new Map(games.map(row => [row.userId, row]));
      const achievementsByPlayer = new Map(achievements.map(row => [row.userId, row]));
      const sessionsByPlayer = new Map(sessions.map(row => [row.userId, row]));
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
            isAdmin: player.isAdmin, gameCount: game?._count._all ?? 0, totalXp, level: calculateLevelProgress(totalXp).level,
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
        if ((await requireAdmin()).id !== admin.id) throw new AdminRequiredError();
        await tx.player.update({ where: { id, AND: [registeredPlayers] }, data: { passwordHash }, select: { id: true } });
        // Includes every device, even expired records. Hash update and revocation
        // commit together; a revocation failure rolls back the password change.
        await tx.playerSession.deleteMany({ where: { userId: id } });
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
        if ((await requireAdmin()).id !== admin.id) throw new AdminRequiredError();
        const target = await tx.player.findUnique({ where: { id, AND: [registeredPlayers] }, select: { email: true } });
        if (!target?.email) throw new InputError("Choose an existing registered player account. Unclaimed local archives are protected.");
        if (email === target.email.toLowerCase()) throw new InputError("Provide a changed email address.");
        const taken = await tx.player.findFirst({
          // Prisma's case-insensitive PostgreSQL lookup uses ILIKE; escape pattern
          // characters exactly as self-service credential updates do.
          where: { email: { equals: email.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" }, id: { not: id } },
          select: { id: true },
        });
        if (taken) throw new InputError("That email address is already in use. Choose another.");
        await tx.player.update({ where: { id, email: target.email, AND: [registeredPlayers] }, data: { email }, select: { id: true } });
        // An admin cannot rotate another device's cookie. Revoke all target
        // sessions atomically, matching admin password resets and login rechecks.
        await tx.playerSession.deleteMany({ where: { userId: id } });
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
        if ((await requireAdmin()).id !== admin.id) throw new AdminRequiredError();
        const target = await tx.player.findUnique({ where: { id, AND: [registeredPlayers] }, select: { isAdmin: true } });
        if (!target) throw new InputError("Choose an existing registered player account. Unclaimed local archives are protected.");
        if (target.isAdmin) throw new InputError("Admin accounts cannot be deleted.");
        // The predicate also protects an account promoted after the read. Prisma
        // schema cascades delete its sessions, games and achievements atomically.
        return tx.player.delete({ where: { id, isAdmin: false, AND: [registeredPlayers] }, select: { handle: true } });
      }, { timeout: 15000 });
    } catch (error) { accountMutationError(error); }
    revalidatePath("/", "layout");
    if (deleted.handle) revalidatePath(`/dossier/${encodeURIComponent(deleted.handle)}`);
    return { success: true };
  });
}
