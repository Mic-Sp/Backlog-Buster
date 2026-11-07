import "server-only";
import { parseCustomListBackup } from "@/lib/custom-list-backup";
import { restoreCustomLists } from "@/lib/custom-lists";
import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";
import { InputError } from "@/lib/action-result";
import { lookupRawgGame } from "@/lib/rawg";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { serializeLibraryBackup } from "@/lib/library-backup";
import { MAX_TITLE_ROWS, parseBackupRecords, sanitizeImportedGame, validateImportPayload, type LibraryImportPayload } from "@/lib/library-import";
import { fetchSteamLibrary, parseSteamIdentifier, type SteamOwnedGame } from "@/lib/steam";
import { guardedRequest } from "@/lib/api-resilience";
import { normalizeGameTitle } from "@/lib/game-title";
import type { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { appendActivityEvents } from "@/lib/activity-events";
import { syncAchievementsForPlayer } from "@/lib/achievements";
import { libraryMetadataKey, loadLibraryMetadata } from "@/lib/library-metadata";

async function requireVaultSession() {
  const tokenHash = await readSessionHash();
  if (!tokenHash) throw new InputError("Sign in to import or export your operator archive.");
  const session = await prisma.playerSession.findUnique({
    where: { tokenHash, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null } } },
    select: { player: { select: { id: true, handle: true, operatorName: true } } },
  });
  if (!session) throw new InputError("Your session expired. Sign in to import or export your operator archive.");
  return { tokenHash, player: session.player };
}

export async function getLibraryExport(format: "json" | "csv") {
  const { player } = await requireVaultSession();
  if (format !== "json" && format !== "csv") throw new InputError("Choose JSON or CSV export.");
  const games = await prisma.game.findMany({
    where: { userId: player.id }, orderBy: { id: "asc" },
    select: {
      title: true, platform: true, status: true, wasFlatlined: true, pinnedOrder: true, backlogOrder: true,
      lengthHours: true, hoursPlayed: true, difficulty: true, earnedXp: true, rating: true, notes: true, review: true, reviewSpoiler: true,
      genre: true, franchise: true, releaseYear: true, chronologicalOrder: true, coverUrl: true,
      startedAt: true, completedAt: true,
      ownershipType: true,
    },
  });
  const customLists = format === "json" ? await prisma.customList.findMany({
    where: { userId: player.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { title: true, description: true, isRanked: true, isPublic: true, entries: { orderBy: [{ position: "asc" }, { gameId: "asc" }], select: { game: { select: { title: true, platform: true } } } } },
  }) : [];
  const gameContent = serializeLibraryBackup(games, format);
  const content = customLists.length ? JSON.stringify({ version: 2, games: JSON.parse(gameContent), customLists: customLists.map(list => ({
    title: list.title, description: list.description, isRanked: list.isRanked, isPublic: list.isPublic, games: list.entries.map(entry => entry.game),
  })) }, null, 2) : gameContent;
  const operator = (player.handle || player.operatorName).normalize("NFKD").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "operator";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return { content, filename: `backlog-buster-archive-${operator}-${timestamp}.${format}` };
}

export async function importLibraryGames(payload: LibraryImportPayload) {
  const { player, tokenHash } = await requireVaultSession();
  validateImportPayload(payload);
  const backupLists = payload.mode === "json" ? parseCustomListBackup(payload.content) : [];
  let invalidCount = 0;
  const records: ReturnType<typeof sanitizeImportedGame>[] = [];
  function addRecord(value: unknown) {
    try { records.push(sanitizeImportedGame(value)); }
    catch { invalidCount++; }
  }
  if (payload.mode === "titles") {
    if (payload.defaultPlatform !== undefined && (typeof payload.defaultPlatform !== "string" || payload.defaultPlatform.trim().length > 80)) throw new InputError("Default platform must be at most 80 characters.");
    const lines = payload.content.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length || lines.length > MAX_TITLE_ROWS) throw new InputError("Import at most 25 title-list rows per batch.");
    const titles: { title: string; platform: string }[] = [];
    for (const line of lines) {
      const [title, platform, ...extra] = line.split("|");
      if (!title.trim() || title.trim().length > 120 || extra.length || (platform?.trim().length ?? 0) > 80) { invalidCount++; continue; }
      titles.push({ title: title.trim(), platform: platform?.trim() || payload.defaultPlatform?.trim() || "" });
    }
    for (let index = 0; index < titles.length; index += 5) {
      await Promise.all(titles.slice(index, index + 5).map(async ({ title, platform }) => {
        // Missing/rate-limited metadata never prevents a valid manual title import.
        const lookup = await lookupRawgGame(title).catch(() => null);
        addRecord({ title, platform: platform || lookup?.platforms[0] || "PC", genre: lookup?.genre,
          releaseYear: lookup?.releaseYear, coverUrl: lookup?.coverUrl,
          lengthHours: resolveRawgPlaytime(lookup?.playtime, lookup?.genre) ?? 10, difficulty: 2 });
      }));
    }
  } else {
    for (const value of parseBackupRecords(payload.content, payload.mode)) addRecord(value);
  }
  const counts = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${player.id}`}, 0))`;
    // Recheck after potentially slow RAWG lookups; logout/account deletion must stop the import.
    const active = await tx.playerSession.findUnique({ where: { tokenHash, userId: player.id, expiresAt: { gt: new Date() } }, select: { tokenHash: true } });
    if (!active) throw new InputError("Your session expired. Sign in again before importing.");
    const existing = await tx.game.findMany({ where: { userId: player.id }, select: { title: true, platform: true, pinnedOrder: true } });
    const pairKey = (game: { title: string; platform: string }) => JSON.stringify([game.title.trim().toLowerCase(), game.platform.trim().toLowerCase()]);
    const seen = new Set(existing.map(pairKey));
    const unique = records.filter(game => { const key = pairKey(game); if (seen.has(key)) return false; seen.add(key); return true; });
    const used = new Set(existing.flatMap(game => game.pinnedOrder === null ? [] : [game.pinnedOrder]));
    for (const game of [...unique].sort((left, right) => (left.pinnedOrder ?? Infinity) - (right.pinnedOrder ?? Infinity))) {
      if (game.pinnedOrder === null) continue;
      const slot = !used.has(game.pinnedOrder) ? game.pinnedOrder : [1, 2, 3].find(slot => !used.has(slot));
      game.pinnedOrder = slot ?? null;
      if (slot !== undefined) used.add(slot);
    }
    // Construct ownership here, after validation; no uploaded ID is ever spread into a write.
    const result = unique.length ? await tx.game.createMany({ data: unique.map(game => ({ ...game, userId: player.id })) }) : { count: 0 };
    if (result.count) {
      await syncAchievementsForPlayer(tx, player.id, false);
      await appendActivityEvents(tx, player.id, [{ type: "library_imported", deduplicationKey: `import:${randomUUID()}`,
        metadata: { source: payload.mode === "titles" ? "titles" : "backup", importedCount: result.count } }]);
    }
    const restoredListCount = await restoreCustomLists(tx, player.id, backupLists);
    const duplicateCount = records.length - unique.length;
    return { importedCount: result.count, duplicateCount, invalidCount, skippedCount: duplicateCount + invalidCount, ...(backupLists.length ? { restoredListCount } : {}) };
  }, { timeout: 15000 });
  return { userId: player.id, counts };
}

export type SteamSyncPayload = {
  identifier: string;
  includeUnplayed?: boolean;
  updateHoursPlayed?: boolean;
};
export type SteamSyncSummary = { steamId: string; addedCount: number; updatedCount: number; skippedCount: number };
export type SteamSyncSession = { userId: string; tokenHash: string };
export type SteamAutoSyncClaim = { steamId: string; attemptedAt: Date };
const STEAM_WRITE_BATCH_SIZE = 500;
const steamExistingSelect = { id: true, title: true, platform: true, steamAppId: true, hoursPlayed: true, ownershipType: true } as const;
type SteamExistingGame = Prisma.GameGetPayload<{ select: typeof steamExistingSelect }>;

function steamMatches(existing: SteamExistingGame[], incoming: SteamOwnedGame[]) {
  const byAppId = new Map(existing.filter(game => game.steamAppId !== null).map(game => [game.steamAppId!, game]));
  const legacy = new Map<string, SteamExistingGame[]>();
  for (const game of [...existing].sort((a, b) => a.id - b.id)) {
    if (game.steamAppId !== null || !["pc", "steam", "windows", "microsoft windows", "pc (windows)", "pc (steam)"].includes(game.platform.trim().toLowerCase())) continue;
    const key = normalizeGameTitle(game.title);
    const copies = legacy.get(key) ?? [];
    copies.push(game);
    legacy.set(key, copies);
  }
  return incoming.map(game => ({ game, existing: byAppId.get(game.steamAppId) ?? legacy.get(normalizeGameTitle(game.title))?.shift() }));
}

/** Lifetime Steam hours are floored/capped to the existing whole-hour progress field. */
function persistedSteamHours(game: SteamOwnedGame) { return Math.min(10000, Math.floor(game.hoursPlayed)); }

export async function syncSteamLibraryGames(payload: SteamSyncPayload): Promise<{ userId: string; summary: SteamSyncSummary }> {
  const { player, tokenHash } = await requireVaultSession();
  return syncSteamLibraryForSession(payload, { userId: player.id, tokenHash });
}

/** Server-only entry for an already authenticated request, including after() work. */
export async function syncSteamLibraryForSession(payload: SteamSyncPayload, session: SteamSyncSession, automatic?: SteamAutoSyncClaim): Promise<{ userId: string; summary: SteamSyncSummary }> {
  const { userId, tokenHash } = session;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    (payload.includeUnplayed !== undefined && typeof payload.includeUnplayed !== "boolean") ||
    (payload.updateHoursPlayed !== undefined && typeof payload.updateHoursPlayed !== "boolean")) {
    throw new InputError("Provide a Steam profile and valid sync options.");
  }
  const identifier = parseSteamIdentifier(payload.identifier);
  const includeUnplayed = payload.includeUnplayed ?? true;
  const updateHoursPlayed = payload.updateHoursPlayed ?? false;
  // Automatic work never consumes the manual vault's short request cooldown.
  return guardedRequest(userId, automatic ? "steam-auto-sync" : "steam-sync", JSON.stringify([identifier, includeUnplayed, updateHoursPlayed]), async () => {
    const [library, initial] = await Promise.all([
      fetchSteamLibrary(payload.identifier),
      prisma.game.findMany({ where: { userId }, select: steamExistingSelect }),
    ]);
    const incoming = library.games.filter(game => (includeUnplayed || game.playtimeMinutes > 0) &&
      game.title.length <= 120 && normalizeGameTitle(game.title));
    const newGames = steamMatches(initial, incoming).filter(match => !match.existing).map(match => match.game);
    const metadata = await loadLibraryMetadata(newGames);
    const summary = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${userId}`}, 0))`;
      const active = await tx.playerSession.findUnique({
        where: { tokenHash, userId, expiresAt: { gt: new Date() }, player: { email: { not: null }, passwordHash: { not: null },
          // A manual relink/logout during the fetch must invalidate this background job.
          ...(automatic ? { steamId: automatic.steamId, steamAutoSyncAttemptedAt: automatic.attemptedAt } : {}),
        } },
        select: { tokenHash: true },
      });
      if (!active) throw new InputError("Your session expired. Sign in again before syncing Steam.");
      // A parallel import may have linked/created rows while metadata was loading.
      const existing = await tx.game.findMany({ where: { userId }, select: steamExistingSelect });
      const additions: Prisma.GameCreateManyInput[] = [];
      const updates: { id: number; steamAppId: string; hoursPlayed: number | null }[] = [];
      for (const match of steamMatches(existing, incoming)) {
        const { game, existing: saved } = match;
        const hoursPlayed = persistedSteamHours(game);
        if (saved) {
          const higherHours = updateHoursPlayed && hoursPlayed > saved.hoursPlayed;
          if (saved.steamAppId === null || higherHours || saved.ownershipType == null) updates.push({ id: saved.id, steamAppId: game.steamAppId, hoursPlayed: higherHours ? hoursPlayed : null });
          continue;
        }
        const info = metadata.get(libraryMetadataKey(game));
        // Steam playtime has no reliable first-play/finish date. Do not infer either.
        additions.push({ userId, steamAppId: game.steamAppId, title: game.title, platform: "PC", ownershipType: "Digital", status: "Backlog", startedAt: null, completedAt: null,
          hoursPlayed, earnedXp: 0, difficulty: 2, lengthHours: resolveRawgPlaytime(info?.estimatedHours, info?.genre) ?? 10,
          genre: info?.genre ?? null, releaseYear: info?.releaseYear ?? null, coverUrl: info?.coverUrl || game.coverUrl });
      }
      let addedCount = 0, updatedCount = 0;
      for (let index = 0; index < additions.length; index += STEAM_WRITE_BATCH_SIZE) {
        addedCount += (await tx.game.createMany({ data: additions.slice(index, index + STEAM_WRITE_BATCH_SIZE) })).count;
      }
      for (let index = 0; index < updates.length; index += STEAM_WRITE_BATCH_SIZE) {
        // One parameterized update per batch. GREATEST preserves concurrently logged
        // hours; COALESCE fills only unset access media, preserving player selections.
        updatedCount += await tx.$executeRaw`
          UPDATE "Game" AS game
          SET "steamAppId" = change."steamAppId",
              "hoursPlayed" = GREATEST(game."hoursPlayed", COALESCE(change."hoursPlayed", game."hoursPlayed")),
              "ownershipType" = COALESCE(game."ownershipType", 'Digital'::"OwnershipType")
          FROM jsonb_to_recordset(${JSON.stringify(updates.slice(index, index + STEAM_WRITE_BATCH_SIZE))}::jsonb)
            AS change("id" integer, "steamAppId" text, "hoursPlayed" integer)
          WHERE game."id" = change."id" AND game."userId" = ${userId}
        `;
      }
      await tx.player.update({ where: { id: userId }, data: { steamId: library.steamId, steamLastSyncedAt: new Date() }, select: { id: true } });
      // Manual and automatic Steam work stay quiet, including newly earned unlocks.
      await syncAchievementsForPlayer(tx, userId, false);
      return { steamId: library.steamId, addedCount, updatedCount, skippedCount: library.games.length - addedCount - updatedCount };
    }, { timeout: 15000 });
    return { userId, summary };
  });
}
