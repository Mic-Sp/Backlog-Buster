import "server-only";
import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";
import { AuthenticationRequiredError } from "@/lib/player";
import { InputError } from "@/lib/action-result";
import { parseCustomListCommand } from "@/lib/custom-list-validation";
import { MAX_CUSTOM_LISTS, MAX_CUSTOM_LIST_GAMES, type CustomListData } from "@/lib/custom-list-types";
import type { Prisma } from "@/generated/prisma/client";

export const customListSelect = {
  id: true, title: true, description: true, isRanked: true, isPublic: true, revision: true,
  entries: { orderBy: [{ position: "asc" }, { gameId: "asc" }], select: { gameId: true } },
} satisfies Prisma.CustomListSelect;
export function customListData(row: Prisma.CustomListGetPayload<{ select: typeof customListSelect }>): CustomListData {
  return { id: row.id, title: row.title, description: row.description, isRanked: row.isRanked, isPublic: row.isPublic, revision: row.revision, gameIds: row.entries.map(entry => entry.gameId) };
}
export async function readCustomLists(userId: string): Promise<CustomListData[]> {
  return (await prisma.customList.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_CUSTOM_LISTS, select: customListSelect })).map(customListData);
}

export async function mutateCustomList(value: unknown): Promise<{ list: CustomListData | null }> {
  const command = parseCustomListCommand(value);
  const tokenHash = await readSessionHash();
  if (!tokenHash) throw new AuthenticationRequiredError();
  return prisma.$transaction(async tx => {
    const session = await tx.playerSession.findUnique({
      where: { tokenHash, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null } } }, select: { userId: true },
    });
    if (!session) throw new AuthenticationRequiredError();
    const userId = session.userId;
    // All list writers (including backup restore) share this per-player lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-lists:${userId}`}, 0))`;
    const active = await tx.playerSession.findUnique({ where: { tokenHash, userId, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null } } }, select: { userId: true } });
    if (!active) throw new AuthenticationRequiredError();
    if (command.type === "create") {
      if (await tx.customList.count({ where: { userId } }) >= MAX_CUSTOM_LISTS) throw new InputError("You can keep up to 20 custom lists. Delete one to make room.");
      const fields = { title: command.title, description: command.description, isRanked: command.isRanked, isPublic: command.isPublic };
      const row = await tx.customList.create({ data: { ...fields, userId }, select: customListSelect });
      return { list: customListData(row) };
    }
    const row = await tx.customList.findUnique({ where: { id: command.id, userId }, select: customListSelect });
    if (!row) throw new InputError("This list is no longer available.");
    if (row.revision !== command.revision) throw new InputError("This list changed in another tab. Reload before editing it again.");
    if (command.type === "delete") {
      await tx.customList.delete({ where: { id: row.id, userId, revision: command.revision } });
      return { list: null };
    }
    let gameIds = row.entries.map(entry => entry.gameId);
    if (command.type === "add") {
      if (gameIds.includes(command.gameId)) throw new InputError("That game is already on this list.");
      if (gameIds.length >= MAX_CUSTOM_LIST_GAMES) throw new InputError("Each list supports up to 50 games.");
      if (!await tx.game.findUnique({ where: { id: command.gameId, userId }, select: { id: true } })) throw new InputError("Choose a game from your own library.");
      gameIds = [...gameIds, command.gameId];
    } else if (command.type === "remove") {
      if (!gameIds.includes(command.gameId)) throw new InputError("That game is no longer on this list.");
      gameIds = gameIds.filter(id => id !== command.gameId);
    } else if (command.type === "reorder") {
      if (command.gameIds.length !== gameIds.length || command.gameIds.some(id => !gameIds.includes(id))) throw new InputError("The list contents changed. Reload before reordering.");
      gameIds = command.gameIds;
    }
    if (command.type !== "update") {
      // Replace in one transaction to avoid transient unique-position conflicts.
      await tx.customListEntry.deleteMany({ where: { listId: row.id, userId } });
      if (gameIds.length) await tx.customListEntry.createMany({ data: gameIds.map((gameId, index) => ({ listId: row.id, userId, gameId, position: index + 1 })) });
    }
    const fields = command.type === "update" ? { title: command.title, description: command.description, isRanked: command.isRanked, isPublic: command.isPublic } : {};
    const updated = await tx.customList.update({ where: { id: row.id, userId, revision: command.revision }, data: { ...fields, revision: { increment: 1 } }, select: customListSelect });
    return { list: customListData(updated) };
  });
}

/** Resolve portable title/platform references only against the receiving library. */
export async function restoreCustomLists(tx: Prisma.TransactionClient, userId: string, lists: import("@/lib/custom-list-backup").BackupCustomList[]) {
  if (!lists.length) return 0;
  const { backupGameKey } = await import("@/lib/custom-list-backup");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-lists:${userId}`}, 0))`;
  const [games, existing] = await Promise.all([
    tx.game.findMany({ where: { userId }, select: { id: true, title: true, platform: true }, orderBy: { id: "asc" } }),
    tx.customList.findMany({ where: { userId }, select: customListSelect }),
  ]);
  const byKey = new Map<string, number>();
  for (const game of games) if (!byKey.has(backupGameKey(game))) byKey.set(backupGameKey(game), game.id);
  const signature = (list: CustomListData) => JSON.stringify([list.title, list.description, list.isRanked, list.isPublic, list.gameIds]);
  const seen = new Set(existing.map(row => signature(customListData(row))));
  let count = existing.length;
  for (const list of lists) {
    const { games: refs, ...fields } = list;
    const gameIds = refs.map(ref => {
      const id = byKey.get(backupGameKey(ref));
      if (!id) throw new InputError("A list references a missing or invalid game. No changes were imported.");
      return id;
    });
    const key = signature({ ...fields, id: "", revision: 0, gameIds });
    if (seen.has(key)) continue;
    if (++count > MAX_CUSTOM_LISTS) throw new InputError("Restoring these lists would exceed the 20-list limit. No changes were imported.");
    const created = await tx.customList.create({ data: { ...fields, userId }, select: { id: true } });
    if (gameIds.length) await tx.customListEntry.createMany({ data: gameIds.map((gameId, index) => ({ listId: created.id, gameId, userId, position: index + 1 })) });
    seen.add(key);
  }
  return count - existing.length;
}
