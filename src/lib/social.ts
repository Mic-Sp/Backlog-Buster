import "server-only";

import { registeredPlayerWhere } from "@/lib/auth-policy";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedPlayerId, getOptionalAuthenticatedPlayerId, AuthenticationRequiredError } from "@/lib/player";
import { InputError } from "@/lib/action-result";
import { visibleProfileWhere } from "@/lib/profile-privacy";
import { friendshipPair } from "@/lib/friendships";
import { escapeLike, isValidHandle, normalizeHandle } from "@/lib/handle-validation";
import { matchCoopBacklogs, type CoopCatalogGame, type CoopLibrary } from "@/lib/coop-matcher";
import type { SocialConnection, SocialOverview, CoopMatches, DossierSocialContext } from "@/lib/social-types";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeGameTitle } from "@/lib/game-title";

const identitySelect = { id: true, handle: true, operatorName: true, avatarUrl: true } as const;
const registered = { ...registeredPlayerWhere } as const;
function acceptedAudience(viewerId: string): Prisma.PlayerWhereInput {
  return { AND: [registered, visibleProfileWhere(viewerId), { OR: [
    { friendshipsLow: { some: { playerHighId: viewerId, status: "accepted" } } },
    { friendshipsHigh: { some: { playerLowId: viewerId, status: "accepted" } } },
  ] }] };
}
async function recheck(viewerId: string) {
  if (await getAuthenticatedPlayerId() !== viewerId) throw new AuthenticationRequiredError();
}

/** Relationship identity is visible to its participants; private career/library data stays hidden. */
export async function getSocialOverview(): Promise<SocialOverview> {
  const viewerId = await getAuthenticatedPlayerId();
  const [viewer, rows] = await Promise.all([
    prisma.player.findUniqueOrThrow({ where: { id: viewerId }, select: { profileVisibility: true } }),
    prisma.friendship.findMany({ where: { AND: [{ OR: [{ playerLowId: viewerId }, { playerHighId: viewerId }] }, { playerLow: registered }, { playerHigh: registered }] },
      select: { playerLowId: true, status: true, requestedById: true, blockedByLow: true, blockedByHigh: true,
        playerLow: { select: { ...identitySelect, profileVisibility: true } },
        playerHigh: { select: { ...identitySelect, profileVisibility: true } },
      }, orderBy: [{ updatedAt: "desc" }, { playerLowId: "asc" }, { playerHighId: "asc" }], take: 501 }),
  ]);
  const connections: SocialConnection[] = rows.slice(0, 500).flatMap(row => {
    const low = row.playerLowId === viewerId, peer = low ? row.playerHigh : row.playerLow;
    const ownBlock = low ? row.blockedByLow : row.blockedByHigh;
    if (row.status === "blocked" && !ownBlock) return [];
    return [{ id: peer.id, handle: peer.handle, operatorName: peer.operatorName, avatarUrl: peer.avatarUrl,
      relationship: row.status === "blocked" ? "blocked" : row.status === "accepted" ? "friends" : row.requestedById === viewerId ? "outgoing" : "incoming",
      canViewProfile: row.status !== "blocked" && (peer.profileVisibility === "public" || peer.profileVisibility === "friends" && row.status === "accepted"),
    }];
  });
  await recheck(viewerId);
  return { viewerId, profileVisibility: viewer.profileVisibility, connections, truncated: rows.length > 500 };
}

export async function getDossierSocialContext(value: string): Promise<DossierSocialContext | null> {
  const viewerId = await getOptionalAuthenticatedPlayerId();
  if (!viewerId) return null;
  const handle = normalizeHandle(value);
  if (!isValidHandle(handle)) return null;
  const target = await prisma.player.findFirst({ where: { handle: { equals: escapeLike(handle), mode: "insensitive" }, AND: [registered, visibleProfileWhere(viewerId)] }, select: identitySelect });
  if (!target) return null;
  if (target.id === viewerId) return { target, relationship: "self" };
  const pair = await prisma.friendship.findUnique({ where: { playerLowId_playerHighId: friendshipPair(viewerId, target.id) },
    select: { status: true, requestedById: true } });
  if (pair?.status === "blocked") return null;
  return { target, relationship: pair?.status === "accepted" ? "friends" : pair?.status === "pending" ? pair.requestedById === viewerId ? "outgoing" : "incoming" : "none" };
}

export async function getCoopMatches(value: unknown): Promise<CoopMatches> {
  const viewerId = await getAuthenticatedPlayerId();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Choose at least one friend.");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.friendIds) || input.friendIds.length < 1 || input.friendIds.length > 4 ||
    input.friendIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || id === viewerId) ||
    new Set(input.friendIds).size !== input.friendIds.length ||
    [input.includeUnknown, input.includeFinished].some(option => option !== undefined && typeof option !== "boolean")) throw new InputError("Choose up to four different friends and valid matching options.");
  const ids = input.friendIds as string[], audience = acceptedAudience(viewerId);
  const where = { id: { in: ids }, ...audience };
  const friends = await prisma.player.findMany({ where, select: identitySelect });
  if (friends.length !== ids.length) throw new InputError("One of these friends is unavailable or has a private profile. Refresh your friends list.");
  const [viewer, games] = await Promise.all([
    prisma.player.findUniqueOrThrow({ where: { id: viewerId }, select: identitySelect }),
    prisma.game.findMany({ where: { OR: [{ userId: viewerId }, { userId: { in: ids }, player: audience }] },
      select: { id: true, userId: true, title: true, releaseYear: true, steamAppId: true, platform: true, status: true, hoursPlayed: true, coverUrl: true }, take: 50001 }),
  ]);
  if (games.length > 50000) throw new InputError("This group has too many games to compare. Choose fewer friends.");
  const libraries: CoopLibrary[] = [viewer, ...ids.map(id => friends.find(friend => friend.id === id)!)].map(player => ({ player, games: games.filter(game => game.userId === player.id) }));
  const shared = matchCoopBacklogs(libraries, [], { includeUnknown: true, includeFinished: input.includeFinished === true });
  const sharedApps = new Set(shared.flatMap(game => game.key.startsWith("steam:") ? [game.key.slice(6)] : []));
  const sharedNames = new Set(shared.map(game => normalizeGameTitle(game.title)));
  const titles = [...new Set(games.filter(game => sharedNames.has(normalizeGameTitle(game.title)) || game.steamAppId && sharedApps.has(game.steamAppId)).map(game => game.title))];
  const catalog: CoopCatalogGame[] = [];
  try {
    for (let offset = 0; offset < titles.length; offset += 200) catalog.push(...await prisma.gameCatalog.findMany({
      where: { OR: titles.slice(offset, offset + 200).map(title => ({ title: { equals: escapeLike(title), mode: "insensitive" as const } })) },
      select: { title: true, releaseYear: true, coverUrl: true, tags: true, multiplayer: true, coop: true, onlineCoop: true, localCoop: true },
    }));
  } catch { /* Shared titles can still be viewed with capabilities marked unknown. */ }
  // Recheck after all I/O; revocations, blocks and profile changes must not leave stale comparisons.
  await recheck(viewerId);
  const allowed = await prisma.player.findMany({ where, select: { id: true } });
  if (allowed.length !== ids.length) throw new InputError("A friend's sharing settings changed. Refresh the comparison.");
  const matches = matchCoopBacklogs(libraries, catalog, { includeUnknown: input.includeUnknown === true, includeFinished: input.includeFinished === true });
  return { games: matches.slice(0, 100), total: matches.length };
}
