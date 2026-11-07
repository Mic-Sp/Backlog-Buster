import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getAuthenticatedPlayerId } from "@/lib/player";
import { InputError } from "@/lib/action-result";
import { MAX_CUSTOM_LISTS, MAX_LIST_GAMES, validateListDetails, validateListId, validListGameId, validateListGameIds, type CustomListData } from "@/lib/custom-list-types";

const listSelect = { id: true, title: true, description: true, isRanked: true, isPublic: true,
  entries: { orderBy: [{ position: "asc" }, { gameId: "asc" }], select: { gameId: true } } } satisfies Prisma.CustomListSelect;

/** Internal workspace read; caller supplies the current player's ID, never a client ID. */
export async function readCustomLists(userId: string): Promise<CustomListData[]> {
  const rows = await prisma.customList.findMany({ where: { userId }, select: listSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_CUSTOM_LISTS });
  return rows.map(({ entries, ...list }) => ({ ...list, gameIds: entries.map(entry => entry.gameId) }));
}

async function mutate<T>(work: (tx: Prisma.TransactionClient, userId: string) => Promise<T>) {
  const userId = await getAuthenticatedPlayerId();
  return prisma.$transaction(async tx => {
    // Share the deck/import lock: bounds and membership changes are atomic across tabs.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${userId}`}, 0))`;
    if (await getAuthenticatedPlayerId() !== userId) throw new InputError("Your session changed. Sign in again.");
    return work(tx, userId);
  }, { timeout: 15000 });
}

async function ownedList(tx: Prisma.TransactionClient, userId: string, id: unknown) {
  validateListId(id);
  const list = await tx.customList.findUnique({ where: { id, userId }, select: listSelect });
  if (!list) throw new InputError("This custom list is no longer available. Refresh and try again.");
  return list;
}

export async function createList(input: unknown) {
  const details = validateListDetails(input);
  return mutate(async (tx, userId) => {
    if (await tx.customList.count({ where: { userId } }) >= MAX_CUSTOM_LISTS) throw new InputError("You can keep up to 20 custom lists. Delete one to make room.");
    const list = await tx.customList.create({ data: { ...details, userId }, select: { id: true } });
    return { id: list.id };
  });
}

export async function updateList(id: unknown, input: unknown) {
  const details = validateListDetails(input);
  return mutate(async (tx, userId) => {
    const list = await ownedList(tx, userId, id);
    await tx.customList.update({ where: { id: list.id, userId }, data: details });
  });
}

export async function deleteList(id: unknown) {
  return mutate(async (tx, userId) => {
    const list = await ownedList(tx, userId, id);
    await tx.customList.delete({ where: { id: list.id, userId } });
  });
}

export type ListItemChange = { type: "add"; gameId: number } | { type: "remove"; gameId: number } | { type: "move"; gameId: number; direction: -1 | 1 } | { type: "reorder"; gameIds: number[] };
export async function changeListItems(id: unknown, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InputError("Choose a valid list operation.");
  const change = input as ListItemChange;
  if (change.type === "reorder") validateListGameIds(change.gameIds);
  else if (!["add", "remove", "move"].includes(change.type) || !validListGameId(change.gameId) ||
    (change.type === "move" && change.direction !== -1 && change.direction !== 1)) throw new InputError("Choose a valid list operation.");
  return mutate(async (tx, userId) => {
    const list = await ownedList(tx, userId, id);
    let ids = list.entries.map(entry => entry.gameId);
    if (change.type === "add") {
      if (ids.includes(change.gameId)) return; // Idempotent retry.
      if (ids.length >= MAX_LIST_GAMES) throw new InputError("This list is full (50 games).");
      if (!await tx.game.findUnique({ where: { id: change.gameId, userId }, select: { id: true } })) throw new InputError("Choose a game from your own library.");
      ids.push(change.gameId);
    } else if (change.type === "remove") ids = ids.filter(gameId => gameId !== change.gameId);
    else if (change.type === "move") {
      const index = ids.indexOf(change.gameId), target = index + change.direction;
      if (index < 0) throw new InputError("This game is no longer in the list. Refresh and try again.");
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
    } else {
      if (ids.length !== change.gameIds.length || change.gameIds.some(gameId => !ids.includes(gameId))) throw new InputError("Reorder every current list game. Refresh and try again.");
      ids = change.gameIds;
    }
    // Replace at most 50 rows atomically; avoids temporary unique-position collisions.
    await tx.customListEntry.deleteMany({ where: { listId: list.id, userId } });
    if (ids.length) await tx.customListEntry.createMany({ data: ids.map((gameId, index) => ({ listId: list.id, userId, gameId, position: index + 1 })) });
    await tx.customList.update({ where: { id: list.id, userId }, data: { updatedAt: new Date() } });
  });
}
