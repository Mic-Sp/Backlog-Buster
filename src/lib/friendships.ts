import "server-only";

import { registeredPlayerWhere } from "@/lib/auth-policy";
import type { Friendship, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedPlayerId, AuthenticationRequiredError } from "@/lib/player";
import { InputError } from "@/lib/action-result";
import { escapeLike, isValidHandle } from "@/lib/handle-validation";
import { visibleProfileWhere } from "@/lib/profile-privacy";
import { profileVisibilities, type DiscoveredPlayer, type ProfileVisibility, type RelationshipResult } from "@/lib/friendship-types";

type Command = "send" | "accept" | "decline" | "cancel" | "remove" | "block" | "unblock";
type State = Pick<Friendship, "status" | "requestedById" | "blockedByLow" | "blockedByHigh">;
const registered = { ...registeredPlayerWhere } as const;

export function friendshipPair(actorId: string, targetId: string) {
  if (actorId === targetId) throw new InputError("Choose another player.");
  return actorId < targetId ? { playerLowId: actorId, playerHighId: targetId } : { playerLowId: targetId, playerHighId: actorId };
}

function readTarget(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new InputError("Choose a valid player.");
  return value;
}

/** Discovery returns identity only, with the same audience and block policy as dossiers. */
export async function discoverPlayers(value: unknown): Promise<DiscoveredPlayer[]> {
  const actorId = await getAuthenticatedPlayerId();
  if (typeof value !== "string" || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new InputError("Search by handle or callsign (up to 64 characters).");
  const query = value.trim().replace(/^@/, "");
  if (query.length < 2) return [];
  const pattern = escapeLike(query);
  const players = await prisma.player.findMany({
    where: { AND: [registered, visibleProfileWhere(actorId), { id: { not: actorId } },
      { OR: [{ handle: { contains: pattern, mode: "insensitive" } }, { operatorName: { contains: pattern, mode: "insensitive" } }] }],
    },
    select: { id: true, handle: true, operatorName: true, avatarUrl: true },
    orderBy: [{ handle: "asc" }, { id: "asc" }], take: 20,
  });
  return players.flatMap(player => player.handle === null || isValidHandle(player.handle) ? [{
    id: player.id, handle: player.handle, operatorName: player.operatorName, avatarUrl: player.avatarUrl,
  }] : []);
}

function relationship(state: State | null, actorId: string): RelationshipResult["relationship"] {
  if (!state) return "none";
  if (state.status === "blocked") return "blocked";
  if (state.status === "accepted") return "friends";
  return state.requestedById === actorId ? "outgoing" : "incoming";
}

async function requireLiveActor(actorId: string) {
  // Recheck after waiting for a transaction lock; revoked sessions cannot commit social changes.
  if (await getAuthenticatedPlayerId() !== actorId) throw new AuthenticationRequiredError();
}

/** The session supplies the actor; the client supplies only the other player's ID. */
export async function changeFriendship(value: unknown, command: Command): Promise<RelationshipResult> {
  const actorId = await getAuthenticatedPlayerId(), targetId = readTarget(value);
  const pair = friendshipPair(actorId, targetId);
  const where = { playerLowId_playerHighId: pair };
  const actorIsLow = pair.playerLowId === actorId;
  const ownBlock = actorIsLow ? "blockedByLow" : "blockedByHigh";
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-friendship:${JSON.stringify(pair)}`}, 0))`;
    await requireLiveActor(actorId);
    const players = await tx.player.findMany({ where: { id: { in: [actorId, targetId] }, ...registered }, select: { id: true } });
    if (!players.some(player => player.id === actorId)) throw new AuthenticationRequiredError();
    if (!players.some(player => player.id === targetId)) throw new InputError("Player unavailable.");
    const current = await tx.friendship.findUnique({ where });
    const result = (state: State | null): RelationshipResult => ({ playerId: targetId, relationship: relationship(state, actorId) });
    const write = async (data: State) => {
      if (current) await tx.friendship.update({ where, data });
      else await tx.friendship.create({ data: { ...pair, ...data } });
      return result(data);
    };
    const remove = async () => { if (current) await tx.friendship.delete({ where }); return result(null); };

    if (command === "block") {
      return write({ status: "blocked", requestedById: null,
        blockedByLow: current?.blockedByLow ?? false, blockedByHigh: current?.blockedByHigh ?? false, [ownBlock]: true });
    }
    if (command === "unblock") {
      if (current?.status !== "blocked") return result(current);
      const next = { ...current, [ownBlock]: false };
      if (!next.blockedByLow && !next.blockedByHigh) return remove();
      if (current[ownBlock]) await tx.friendship.update({ where, data: { [ownBlock]: false } });
      // Do not reveal the other player's block or resurrect a previous friendship.
      return result(null);
    }
    if (current?.status === "blocked") throw new InputError("Player unavailable.");
    if (command === "send") {
      // Reciprocal requests stay pending until the recipient explicitly accepts.
      return current ? result(current) : write({ status: "pending", requestedById: actorId, blockedByLow: false, blockedByHigh: false });
    }
    if (command === "accept") {
      if (current?.status === "accepted") return result(current);
      if (!current || current.requestedById === actorId) throw new InputError("Only the recipient can accept a pending request.");
      return write({ status: "accepted", requestedById: current.requestedById, blockedByLow: false, blockedByHigh: false });
    }
    if (!current) return result(null);
    if (command === "decline") {
      if (current.status !== "pending" || current.requestedById === actorId) throw new InputError("Only the recipient can decline a pending request.");
      return remove();
    }
    if (command === "cancel") {
      if (current.status !== "pending" || current.requestedById !== actorId) throw new InputError("Only the sender can cancel a pending request.");
      return remove();
    }
    // Either friend may remove an accepted friendship; senders may also cancel their own request.
    if (current.status === "pending" && current.requestedById !== actorId) throw new InputError("Decline the incoming request instead.");
    return remove();
  });
}

export async function setProfileVisibility(value: unknown): Promise<{ profileVisibility: ProfileVisibility }> {
  const actorId = await getAuthenticatedPlayerId();
  if (typeof value !== "string" || !profileVisibilities.includes(value as ProfileVisibility)) throw new InputError("Choose public, friends or private visibility.");
  const profileVisibility = value as ProfileVisibility;
  await prisma.player.update({ where: { id: actorId, AND: [registered] }, data: { profileVisibility }, select: { id: true } });
  return { profileVisibility };
}
