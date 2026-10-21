import "server-only";
import { prisma } from "@/lib/prisma";
import { readSessionHash } from "@/lib/auth-session";
import { InputError } from "@/lib/action-result";
import { lookupRawgGame } from "@/lib/rawg";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { serializeLibraryBackup } from "@/lib/library-backup";
import { MAX_TITLE_ROWS, parseBackupRecords, sanitizeImportedGame, validateImportPayload, type LibraryImportPayload } from "@/lib/library-import";

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
      lengthHours: true, hoursPlayed: true, difficulty: true, earnedXp: true, rating: true, notes: true,
      genre: true, franchise: true, releaseYear: true, chronologicalOrder: true, coverUrl: true,
    },
  });
  const operator = (player.handle || player.operatorName).normalize("NFKD").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "operator";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return { content: serializeLibraryBackup(games, format), filename: `backlog-buster-archive-${operator}-${timestamp}.${format}` };
}

export async function importLibraryGames(payload: LibraryImportPayload) {
  const { player, tokenHash } = await requireVaultSession();
  validateImportPayload(payload);
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
    const duplicateCount = records.length - unique.length;
    return { importedCount: result.count, duplicateCount, invalidCount, skippedCount: duplicateCount + invalidCount };
  }, { timeout: 15000 });
  return { userId: player.id, counts };
}
