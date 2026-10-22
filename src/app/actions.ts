"use server";

import { getLibraryExport, importLibraryGames } from "@/lib/library-vault";
import type { LibraryImportPayload } from "@/lib/library-import";
import { guardedRequest } from "@/lib/api-resilience";
import { safeAction, InputError } from "@/lib/action-result";
import { validateGameForm } from "@/lib/form-validation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncAndGetAchievements } from "@/lib/achievements";
import { getAuthenticatedPlayerId } from "@/lib/player";
import { AdminRequiredError, requireAdmin } from "@/lib/admin";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { lookupRawgGame, type RawgGameInfo } from "@/lib/rawg";
import { getBacklogRecommendations, getExternalRecommendations } from "@/lib/recommendations";
import { normalizeGameTitle } from "@/lib/game-title";
import { DECK_CAPACITY } from "@/lib/deck";
import type { Prisma } from "@/generated/prisma/client";
import { buildSagaChains, parseChronologicalOrder } from "@/lib/sagas";
import { FRANCHISE_REFRESH_COOLDOWN_MS, inspectSagaChronologyCache, resolveCachedSagaChronology } from "@/lib/saga-chronology-cache";
import { buildSagaChronologyDebug, type SagaCacheSnapshot } from "@/lib/saga-debug";
import { getHybridSagaChronology } from "@/lib/saga-lore";
import { buildAssignedSagaOrder } from "@/lib/saga-chronology";
import { isReleasedYear } from "@/lib/game-release";
import { getBacklogInsertionOrder } from "@/lib/backlog-order";

const allowedStatuses = new Set(["Backlog", "Playing", "Completed", "Flatlined"]);

async function withDeckLock<T>(userId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>, timeout = 5000) {
  return prisma.$transaction(async (tx) => {
    // Serialize changes across tabs and server instances, including an empty deck.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${userId}`}, 0))`;
    return operation(tx);
  }, { timeout });
}

export async function toggleGamePin(gameId: number, shouldPin: boolean) {
  return safeAction(async () => {
    if (!Number.isSafeInteger(gameId) || gameId < 1 || typeof shouldPin !== "boolean") {
      throw new InputError("Please provide a valid game and pin choice.");
    }
    const userId = await getAuthenticatedPlayerId();
    const result = await withDeckLock(userId, async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId, userId }, select: { status: true, pinnedOrder: true, releaseYear: true },
      });
      if (!game) return { error: "This gig is no longer available." };
      if (shouldPin && game.status !== "Backlog") return { error: "Only Backlog gigs can be pinned to your deck." };
      if (shouldPin && !isReleasedYear(game.releaseYear)) return { error: "Only released gigs can be pinned to your deck. Set a valid release year first." };
      if (shouldPin && game.pinnedOrder !== null) return { pinnedOrder: game.pinnedOrder };
      let pinnedOrder: number | null = null;
      if (shouldPin) {
        const pinned = await tx.game.findMany({
          where: { userId, pinnedOrder: { not: null } }, select: { pinnedOrder: true },
        });
        const used = new Set(pinned.map((entry) => entry.pinnedOrder));
        pinnedOrder = Array.from({ length: DECK_CAPACITY }, (_, index) => index + 1).find((slot) => !used.has(slot)) ?? null;
        if (pinnedOrder === null) return { error: "Deck full (3/3). Unpin a gig to make room." };
      }
      await tx.game.update({
        where: { id: gameId, userId, ...(shouldPin ? { status: "Backlog", releaseYear: game.releaseYear } : {}) },
        data: { pinnedOrder },
      });
      return { pinnedOrder };
    });
    revalidatePath("/");
    return result;
  });
}

async function placeGameInDeck(gameId: number, targetSlot: number, swap: boolean) {
  if (!Number.isSafeInteger(gameId) || gameId < 1 || gameId > 2147483647 || !Number.isInteger(targetSlot) || targetSlot < 1 || targetSlot > DECK_CAPACITY) {
    throw new InputError("Choose a valid game and deck slot.");
  }
  const userId = await getAuthenticatedPlayerId();
  await withDeckLock(userId, async (tx) => {
    const source = await tx.game.findUnique({
      where: { id: gameId, userId },
      select: { status: true, pinnedOrder: true, releaseYear: true },
    });
    if (!source || source.status !== "Backlog") throw new InputError("Only your Backlog gigs can be placed on deck.");
    if (!isReleasedYear(source.releaseYear)) throw new InputError("Upcoming or undated gigs cannot be placed on deck.");
    if (swap && (source.pinnedOrder == null || source.pinnedOrder < 1 || source.pinnedOrder > DECK_CAPACITY)) {
      throw new InputError("This game is no longer pinned to your deck.");
    }
    if (source.pinnedOrder === targetSlot) return;
    const pinned = await tx.game.findMany({
      where: { userId, status: "Backlog", pinnedOrder: { not: null } },
      select: { id: true, pinnedOrder: true },
    });
    const target = pinned.find((game) => game.pinnedOrder === targetSlot);
    if (target) await tx.game.update({
      where: { id: target.id, userId, status: "Backlog", pinnedOrder: targetSlot },
      data: { pinnedOrder: swap ? source.pinnedOrder : null },
    });
    await tx.game.update({
      where: { id: gameId, userId, status: "Backlog", pinnedOrder: source.pinnedOrder, releaseYear: source.releaseYear },
      data: { pinnedOrder: targetSlot },
    });
  });
  revalidatePath("/");
}

export async function assignDeckSlot(gameId: number, targetSlot: number) {
  return safeAction(async () => {
    await placeGameInDeck(gameId, targetSlot, false);
  });
}

export async function swapDeckSlot(gameId: number, targetSlot: number) {
  return safeAction(async () => {
    await placeGameInDeck(gameId, targetSlot, true);
  });
}

export async function returnDeckGameToBacklog(gameId: number, beforeGameId: number | null = null) {
  return safeAction(async () => {
    const validId = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
    if (!validId(gameId) || (beforeGameId !== null && (!validId(beforeGameId) || beforeGameId === gameId))) {
      throw new InputError("Choose a valid deck gig and Backlog position.");
    }
    const userId = await getAuthenticatedPlayerId();
    await withDeckLock(userId, async (tx) => {
      const games = await tx.game.findMany({
        where: { userId, status: "Backlog" },
        select: { id: true, status: true, pinnedOrder: true, backlogOrder: true, createdAt: true },
      });
      const source = games.find((game) => game.id === gameId);
      if (!source || source.pinnedOrder == null) throw new InputError("This gig is no longer on your deck. Refresh and try again.");
      const orderedIds = beforeGameId === null ? null : getBacklogInsertionOrder(games, gameId, beforeGameId);
      await tx.game.update({
        where: { id: gameId, userId, status: "Backlog", pinnedOrder: source.pinnedOrder },
        data: { pinnedOrder: null },
      });
      if (orderedIds) {
        for (const [index, id] of orderedIds.entries()) {
          await tx.game.update({
            where: { id, userId, status: "Backlog", pinnedOrder: null },
            data: { backlogOrder: index + 1 },
          });
        }
      }
    }, 15000);
    revalidatePath("/");
  });
}

export async function reorderSagaTimeline(orderedGameIds: string[]) {
  return safeAction(async () => {
    if (!Array.isArray(orderedGameIds) || orderedGameIds.length < 2 || orderedGameIds.length > 10000 ||
      Array.from(orderedGameIds).some((id) => typeof id !== "string" || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647)) {
      throw new InputError("Provide a complete saga sequence of valid game IDs.");
    }
    const ids = orderedGameIds.map(Number);
    if (new Set(ids).size !== ids.length) throw new InputError("A saga sequence cannot contain duplicate games.");
    const userId = await getAuthenticatedPlayerId();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-saga:${userId}`}, 0))`;
      const games = await tx.game.findMany({
        where: { userId }, select: { id: true, title: true, status: true, franchise: true },
      });
      const { byGameId } = buildSagaChains(games);
      const saga = byGameId.get(ids[0]);
      if (!saga || saga.total !== ids.length || ids.some((id) => byGameId.get(id)?.key !== saga.key)) {
        throw new InputError("Reorder every game in one of your sagas. The library may have changed; please refresh and try again.");
      }
      const byId = new Map(games.map((game) => [game.id, game]));
      for (const [index, id] of ids.entries()) {
        const game = byId.get(id)!;
        await tx.game.update({
          where: { id, userId, title: game.title, franchise: game.franchise },
          data: { chronologicalOrder: index + 1 },
        });
      }
    }, { timeout: 15000 });
    revalidatePath("/");
  });
}

export async function reorderBacklogGames(orderedGameIds: string[]) {
  return safeAction(async () => {
    if (!Array.isArray(orderedGameIds) || orderedGameIds.length < 2 || orderedGameIds.length > 10000 ||
      Array.from(orderedGameIds).some((id) => typeof id !== "string" || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647)) {
      throw new InputError("Provide a complete Backlog priority sequence of valid game IDs.");
    }
    const ids = orderedGameIds.map(Number);
    if (new Set(ids).size !== ids.length) throw new InputError("A Backlog sequence cannot contain duplicate games.");
    const userId = await getAuthenticatedPlayerId();
    await prisma.$transaction(async (tx) => {
      // Use the deck lock so pinning cannot change membership during a reorder.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backlogbuster-deck:${userId}`}, 0))`;
      const games = await tx.game.findMany({
        where: { userId, status: "Backlog", pinnedOrder: null }, select: { id: true },
      });
      const eligibleIds = new Set(games.map((game) => game.id));
      if (games.length !== ids.length || ids.some((id) => !eligibleIds.has(id))) {
        throw new InputError("Reorder all of your unpinned Backlog games. The library may have changed; please refresh and try again.");
      }
      for (const [index, id] of ids.entries()) {
        await tx.game.update({
          where: { id, userId, status: "Backlog", pinnedOrder: null },
          data: { backlogOrder: index + 1 },
        });
      }
    }, { timeout: 15000 });
    revalidatePath("/");
  });
}

function calculateEarnedXp(
  status: string,
  lengthHours: number,
  difficulty: number,
) {
  return status === "Completed" ? lengthHours * difficulty * 10 : 0;
}

function optionalText(formData: FormData, name: string) {
  const value = formData.get(name);
  if (value !== null && typeof value !== "string") throw new InputError("Please provide valid game details.");
  return typeof value === "string" ? value.trim() : "";
}

function readProgressFields(formData: FormData) {
  const progress: { hoursPlayed?: number; notes?: string | null; rating?: number | null } = {};
  if (formData.has("hoursPlayed")) {
    const value = formData.get("hoursPlayed");
    const hours = typeof value === "string" ? (value.trim() === "" ? 0 : Number(value.trim())) : NaN;
    if (!Number.isSafeInteger(hours) || hours < 0 || hours > 10000) {
      throw new InputError("Hours played must be a whole number from 0 to 10000.");
    }
    progress.hoursPlayed = hours;
  }
  if (formData.has("notes")) {
    const value = formData.get("notes");
    if (typeof value !== "string" || value.trim().length > 1000) {
      throw new InputError("Field log must be at most 1000 characters.");
    }
    progress.notes = value.trim() || null;
  }
  if (formData.has("rating")) {
    const value = formData.get("rating");
    if (typeof value !== "string") {
      throw new InputError("Rating must be a whole number from 1 to 5, or unrated.");
    }
    const rating = value.trim() === "" ? null : Number(value.trim());
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new InputError("Rating must be a whole number from 1 to 5, or unrated.");
    }
    progress.rating = rating;
  }
  return progress;
}

function optionalYear(value: string): number | null {
  value = value.trim();
  if (value === "") {
    return null;
  }

  const year = Number(value);
  if (!Number.isInteger(year) || year < 1800 || year > 2100) throw new InputError("Release year must be a whole number from 1800 to 2100.");
  return year;
}

function optionalHttpUrl(value: string): string | null {
  value = value.trim();
  if (value === "") {
    return null;
  }

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new InputError("Use a valid HTTP or HTTPS cover image URL.");
    return url.toString();
  } catch {
    throw new InputError("Use a valid HTTP or HTTPS cover image URL.");
  }
}

function resolveGameMetadata(
  manual: { coverUrl: string; genre: string; releaseYear: string },
  lookup: RawgGameInfo | null,
) {
  return {
    coverUrl: manual.coverUrl === ""
      ? lookup?.coverUrl ?? null
      : optionalHttpUrl(manual.coverUrl),
    genre: manual.genre || lookup?.genre || null,
    releaseYear: manual.releaseYear === ""
      ? lookup?.releaseYear ?? null
      : optionalYear(manual.releaseYear),
  };
}

export async function createGame(formData: FormData) {
  return safeAction(async () => {
    validateGameForm(formData);
    const titleValue = formData.get("title");
    const platformValue = optionalText(formData, "platform");
    const lengthHoursValue = optionalText(formData, "lengthHours");
    const difficultyValue = optionalText(formData, "difficulty");
    const manualMetadata = {
      coverUrl: optionalText(formData, "coverUrl"),
      genre: optionalText(formData, "genre"),
      releaseYear: optionalText(formData, "releaseYear"),
    };

    if (
      typeof titleValue !== "string" ||
      typeof platformValue !== "string" ||
      typeof lengthHoursValue !== "string" ||
      typeof difficultyValue !== "string"
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const title = titleValue.trim();
    if (!title) throw new InputError("Please input a valid title.");
    const platform = platformValue.trim();
    const submittedLengthHours = lengthHoursValue.trim() === ""
      ? null
      : Number(lengthHoursValue);
    const difficulty = difficultyValue.trim() === "" ? 1 : Number(difficultyValue);

    if (
      title.length === 0 ||
      title.length > 120 ||
      platform.length > 80 ||
      (submittedLengthHours !== null &&
        (!Number.isSafeInteger(submittedLengthHours) ||
          submittedLengthHours < 1 ||
          submittedLengthHours > 10000)) ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 3
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const userId = await getAuthenticatedPlayerId();
    const lookup = submittedLengthHours === null ||
      Object.values(manualMetadata).some((value) => value === "")
      ? await lookupRawgGame(title)
      : null;
    const metadata = resolveGameMetadata(manualMetadata, lookup);
    const lengthHours = submittedLengthHours ??
      resolveRawgPlaytime(lookup?.playtime, metadata.genre) ??
      10;
    const status = "Backlog";

    const game = await prisma.game.create({
      data: {
        userId,
        title,
        platform: platform || lookup?.platforms[0] || "PC",
        status,
        lengthHours,
        difficulty,
        earnedXp: calculateEarnedXp(status, lengthHours, difficulty),
        ...metadata,
        franchise: optionalText(formData, "franchise") || null,
      },
    });

    revalidatePath("/");
    return { success: true, gameId: game.id };
  });
}

export async function searchGameInfo(title: string) {
  return safeAction(async () => {
    await getAuthenticatedPlayerId();
    if (typeof title !== "string" || !title.trim()) throw new InputError("Please input a valid title.");
    const cleanTitle = title.trim();
    return cleanTitle === "" || cleanTitle.length > 120
      ? null
      : guardedRequest(await getAuthenticatedPlayerId(), "metadata", cleanTitle.toLowerCase(), () => lookupRawgGame(cleanTitle, true));
  });
}

export async function fetchBacklogAdvisor() {
  return safeAction(async () => {
    const playerId = await getAuthenticatedPlayerId();
    return guardedRequest(playerId, "advisor", "backlog", () => getBacklogRecommendations(playerId));
  });
}

export async function fetchExternalScout(excludedTitles: readonly string[] = []) {
  return safeAction(async () => {
    const playerId = await getAuthenticatedPlayerId();
    if (!Array.isArray(excludedTitles) || excludedTitles.length > 30 ||
      excludedTitles.some((title) => typeof title !== "string")) {
      throw new InputError("Provide up to 30 excluded game titles as strings.");
    }
    const seen = new Set<string>();
    const sanitizedTitles = excludedTitles.map((title) => title.trim().slice(0, 120).trim())
      .filter((title) => {
        const key = normalizeGameTitle(title);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    // Distinct exclusions must not share an in-flight response. The feature key
    // stays "scout", preserving the per-player cooldown across all lists.
    const input = sanitizedTitles.length ? JSON.stringify(sanitizedTitles) : "external";
    return guardedRequest(playerId, "scout", input, () => getExternalRecommendations(playerId, sanitizedTitles));
  });
}

async function loadOwnedSaga(sagaKey: string) {
  if (typeof sagaKey !== "string" || !sagaKey.trim() || sagaKey.length > 240) {
    throw new InputError("Choose a valid saga to scan.");
  }
  const userId = await getAuthenticatedPlayerId();
  const games = await prisma.game.findMany({
    where: { userId },
    select: { id: true, title: true, status: true, franchise: true, releaseYear: true, chronologicalOrder: true },
  });
  const chain = buildSagaChains(games).chains.find((saga) => saga.key === sagaKey);
  if (!chain) throw new InputError("This saga is no longer available. Refresh your library and try again.");
  const ids = new Set(chain.gameIds);
  const members = games.filter((game) => ids.has(game.id));
  return { userId, chain, members };
}

export async function getSagaChronologyDebug(sagaKey: string) {
  return safeAction(async () => {
    await requireAdmin();
    const { userId, chain, members } = await loadOwnedSaga(sagaKey);
    const cache = await inspectSagaChronologyCache(chain.name);
    if ((await requireAdmin()).id !== userId) throw new InputError("Sign in again to inspect saga chronology.");
    return { debug: buildSagaChronologyDebug(cache, members) };
  });
}

export async function autoDetectSagaOrder(sagaKey: string, forceRefresh = false) {
  return safeAction(async () => {
    if (typeof forceRefresh !== "boolean") throw new InputError("Choose a valid cache refresh option.");
    // Check before any cache/provider access; a forged client flag grants nothing.
    if (forceRefresh) await requireAdmin();
    const { userId, chain, members } = await loadOwnedSaga(sagaKey);
    let localFallback = false;
    let providerNotice: string | undefined;
    let retryAfterSeconds: number | undefined;
    let cacheDebug: SagaCacheSnapshot = { status: "fallback", source: "fallback", updatedAt: null, canonicalGames: [] };
    let fallbackMessage = "No IGDB franchise timeline found — sorted matching games by release year.";
    try {
      const result = await resolveCachedSagaChronology(chain.name, members.map(game => ({ title: game.title, releaseYear: game.releaseYear })),
        previous => getHybridSagaChronology(chain.name, members.map(({ title, releaseYear }) => ({ title, releaseYear })), userId, previous, { forceRefresh }), { forceRefresh });
      cacheDebug = result.debug;
      providerNotice = result.notice;
      retryAfterSeconds = result.retryAfterSeconds;
      localFallback = result.localFallback === true;
    } catch {
      localFallback = true;
      fallbackMessage = "Shared chronology unavailable — sorted matching games by release year.";
    }
    // A slow provider request must not authorize writes after logout/session expiry.
    if (await getAuthenticatedPlayerId() !== userId) throw new InputError("Sign in again before saving saga chronology.");
    if (forceRefresh && (await requireAdmin()).id !== userId) throw new InputError("Sign in again before refreshing saga chronology.");
    const assignedOrder = buildAssignedSagaOrder(members, cacheDebug.canonicalGames, localFallback);
    try {
      // No network calls inside the transaction. Snapshot guards prevent overwriting
      // metadata or manual ranks edited in another tab while the provider was responding.
      // Include the tail in the same atomic update, clearing every stale unmatched rank.
      await prisma.$transaction(members.map((game) => prisma.game.update({
        where: { id: game.id, userId, title: game.title, franchise: game.franchise, releaseYear: game.releaseYear, chronologicalOrder: game.chronologicalOrder },
        data: { chronologicalOrder: assignedOrder.get(game.id) ?? null },
        select: { id: true },
      })));
    } catch {
      return { updatedCount: 0, error: "Your saga changed during the scan. No ranks were saved; please try again." };
    }
    revalidatePath("/");
    // Recheck after slow provider/database work. Demoted users can still perform
    // normal scans, but must never receive prompts, raw responses, or mappings.
    let includeDebug = false;
    try { includeDebug = (await requireAdmin()).id === userId; }
    catch (error) { if (!(error instanceof AdminRequiredError)) throw error; }
    const diagnostics = includeDebug ? { debug: buildSagaChronologyDebug(cacheDebug, members.map(game => ({ ...game,
      chronologicalOrder: assignedOrder.get(game.id) ?? null,
    })), localFallback) } : {};
    // Expose only the remaining user-facing refresh cooldown, not cache metadata.
    const refreshRetryAfterSeconds = cacheDebug.status === "refresh-deferred" && cacheDebug.updatedAt
      ? Math.max(0, Math.ceil((Date.parse(cacheDebug.updatedAt) + FRANCHISE_REFRESH_COOLDOWN_MS - Date.now()) / 1000)) : 0;
    const rankedCount = [...assignedOrder.values()].filter(rank => rank !== null).length;
    const tailCount = members.length - rankedCount;
    const tailNotice = tailCount ? ` ${tailCount} unmatched or unreleased games had stale ranks cleared and follow in release order.` : "";
    if (localFallback) return { updatedCount: members.length, message: (providerNotice ?? fallbackMessage) + tailNotice, ...diagnostics, retryAfterSeconds, refreshRetryAfterSeconds };
    return { updatedCount: members.length, ...diagnostics, retryAfterSeconds, refreshRetryAfterSeconds,
      message: (providerNotice ? `${providerNotice} ` : "") + `Library timeline saved with ${rankedCount} sequential ranks${rankedCount ? ` (1–${rankedCount})` : ""}.` + tailNotice };
  });
}

export async function addExternalScoutGame(formData: FormData) {
  return safeAction(async () => {
    validateGameForm(formData);
    const title = formData.get("title");
    if (typeof title !== "string" || !title.trim() || title.trim().length > 120) {
      throw new InputError("Please input a valid title.");
    }
    const existing = await prisma.game.findMany({
      where: { userId: await getAuthenticatedPlayerId() }, select: { title: true },
    });
    if (existing.some((game) => normalizeGameTitle(game.title) === normalizeGameTitle(title))) {
      revalidatePath("/");
      return;
    }
    return await createGame(formData);
  });
}

export async function exportLibraryBackup(format: "json" | "csv") {
  return safeAction(() => getLibraryExport(format));
}

export async function bulkImportGames(payload: LibraryImportPayload) {
  return safeAction(async () => {
    const { userId, counts } = await importLibraryGames(payload);
    await syncAndGetAchievements(userId);
    revalidatePath("/");
    return counts;
  });
}

export async function acceptQuest(gameId: number) {
  return safeAction(async () => {
    if (!Number.isSafeInteger(gameId) || gameId < 1) {
      throw new InputError("Please provide a valid game ID.");
    }

    const userId = await getAuthenticatedPlayerId();
    await prisma.game.update({
      where: { id: gameId, userId, status: "Backlog" },
      data: { status: "Playing", earnedXp: 0, pinnedOrder: null },
    });

    revalidatePath("/");
  });
}

export async function applyPlaytimeEstimate(gameId: number, newHours: unknown) {
  return safeAction(async () => {
    const hours = typeof newHours === "number" || typeof newHours === "string"
      ? Math.round(Number(newHours)) : NaN;
    if (!Number.isSafeInteger(gameId) || gameId < 1 ||
      !Number.isInteger(hours) || hours < 1 || hours > 999) {
      throw new InputError("Please provide a valid game ID and a whole-hour estimate from 1 to 999.");
    }
    const userId = await getAuthenticatedPlayerId();
    const game = await prisma.game.findUniqueOrThrow({
      where: { id: gameId, userId },
      select: { status: true, difficulty: true },
    });
    await prisma.game.update({
      // Fail rather than calculate XP from a status/difficulty changed by another request.
      where: { id: gameId, userId, status: game.status, difficulty: game.difficulty },
      data: { lengthHours: hours, earnedXp: calculateEarnedXp(game.status, hours, game.difficulty) },
    });
    await syncAndGetAchievements(userId);
    revalidatePath("/");
  });
}

export async function updateGame(formData: FormData) {
  return safeAction(async () => {
    validateGameForm(formData);
    const progress = readProgressFields(formData);
    const idValue = formData.get("id");
    const statusValue = optionalText(formData, "status");
    const lengthHoursValue = formData.get("lengthHours");
    const difficultyValue = formData.get("difficulty");
    const metadata: {
      title?: string;
      platform?: string;
      genre?: string | null;
      franchise?: string | null;
      chronologicalOrder?: number | null;
      releaseYear?: number | null;
      coverUrl?: string | null;
    } = {};

    for (const name of ["title", "platform", "genre", "franchise", "releaseYear", "coverUrl", "chronologicalOrder"]) {
      if (formData.has(name) && typeof formData.get(name) !== "string") {
        throw new InputError("Please provide valid game metadata.");
      }
    }
    for (const name of ["title", "platform"] as const) {
      if (formData.has(name)) {
        const value = optionalText(formData, name);
        if (name === "title" && !value) throw new InputError("Please input a valid title.");
        if (value.length > (name === "title" ? 120 : 80)) {
          throw new InputError("Please provide a valid game title and platform.");
        }
        metadata[name] = value || "PC";
      }
    }
    if (formData.has("genre")) metadata.genre = optionalText(formData, "genre") || null;
    if (formData.has("franchise")) {
      const franchise = optionalText(formData, "franchise");
      if (franchise.length > 120) throw new InputError("Franchise / Saga name must be at most 120 characters.");
      metadata.franchise = franchise || null;
    }
    if (formData.has("releaseYear")) metadata.releaseYear = optionalYear(optionalText(formData, "releaseYear"));
    if (formData.has("chronologicalOrder")) metadata.chronologicalOrder = parseChronologicalOrder(formData.get("chronologicalOrder"));
    if (formData.has("coverUrl")) metadata.coverUrl = optionalHttpUrl(optionalText(formData, "coverUrl"));

    if (
      typeof idValue !== "string" ||
      typeof statusValue !== "string" ||
      typeof lengthHoursValue !== "string" ||
      typeof difficultyValue !== "string"
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const id = Number(idValue);
    const lengthHours = Number(lengthHoursValue);
    const difficulty = Number(difficultyValue);

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !allowedStatuses.has(statusValue) ||
      !Number.isSafeInteger(lengthHours) ||
      lengthHours < 1 ||
      lengthHours > 10000 ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 3
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const userId = await getAuthenticatedPlayerId();
    const existing = await prisma.game.findUniqueOrThrow({
      where: { id, userId },
      select: { status: true, hoursPlayed: true },
    });
    if (statusValue === "Backlog") {
      progress.hoursPlayed = 0;
      progress.rating = null;
    } else if (statusValue === "Completed" && existing.status !== "Completed") {
      progress.hoursPlayed = Math.max(lengthHours, progress.hoursPlayed ?? existing.hoursPlayed);
    } else if (statusValue === "Playing" && existing.status === "Completed" &&
      (progress.hoursPlayed === undefined || progress.hoursPlayed === existing.hoursPlayed)) {
      progress.hoursPlayed = 0;
    }

    await prisma.game.update({
      where: { id, userId },
      data: {
        status: statusValue,
        ...(statusValue !== "Backlog" || (metadata.releaseYear !== undefined && !isReleasedYear(metadata.releaseYear)) ? { pinnedOrder: null } : {}),
        lengthHours,
        difficulty,
        earnedXp: calculateEarnedXp(statusValue, lengthHours, difficulty),
        ...(statusValue === "Flatlined" ? { wasFlatlined: true } : {}),
        ...metadata,
        ...progress,
      },
    });

    await syncAndGetAchievements(userId);
    revalidatePath("/");
  });
}

export async function flatlineGame(formData: FormData) {
  return safeAction(async () => {
    formData.set("status", "Flatlined");
    return await updateGame(formData);
  });
}

export async function startGame(formData: FormData) {
  return safeAction(async () => {
    validateGameForm(formData);
    const progress = readProgressFields(formData);
    const idValue = formData.get("id");
    const lengthHoursValue = formData.get("lengthHours");
    const difficultyValue = formData.get("difficulty");

    if (
      typeof idValue !== "string" ||
      typeof lengthHoursValue !== "string" ||
      typeof difficultyValue !== "string"
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const id = Number(idValue);
    const lengthHours = Number(lengthHoursValue);
    const difficulty = Number(difficultyValue);

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !Number.isSafeInteger(lengthHours) ||
      lengthHours < 1 ||
      lengthHours > 10000 ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 3
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const userId = await getAuthenticatedPlayerId();
    await withDeckLock(userId, async tx => {
      const game = await tx.game.findUniqueOrThrow({ where: { id, userId }, select: { pinnedOrder: true } });
      await tx.game.update({
        where: { id, userId },
        data: { status: "Playing", lengthHours, difficulty, earnedXp: 0, pinnedOrder: null, ...progress },
      });
      if (game.pinnedOrder !== null) {
        const remaining = await tx.game.findMany({
          where: { userId, status: "Backlog", pinnedOrder: { not: null } },
          orderBy: [{ pinnedOrder: "asc" }, { id: "asc" }], select: { id: true },
        });
        for (const [index, entry] of remaining.entries()) {
          await tx.game.update({ where: { id: entry.id, userId, status: "Backlog" }, data: { pinnedOrder: index + 1 } });
        }
      }
    });

    await syncAndGetAchievements(userId);
    revalidatePath("/");
  });
}

export async function completeGame(formData: FormData) {
  return safeAction(async () => {
    validateGameForm(formData);
    const progress = readProgressFields(formData);
    const idValue = formData.get("id");
    const lengthHoursValue = formData.get("lengthHours");
    const difficultyValue = formData.get("difficulty");

    if (
      typeof idValue !== "string" ||
      typeof lengthHoursValue !== "string" ||
      typeof difficultyValue !== "string"
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const id = Number(idValue);
    const lengthHours = Number(lengthHoursValue);
    const difficulty = Number(difficultyValue);

    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !Number.isSafeInteger(lengthHours) ||
      lengthHours < 1 ||
      lengthHours > 10000 ||
      !Number.isInteger(difficulty) ||
      difficulty < 1 ||
      difficulty > 3
    ) {
      throw new InputError("Please provide valid game details.");
    }

    const userId = await getAuthenticatedPlayerId();
    const recordedHours = progress.hoursPlayed ?? (await prisma.game.findUniqueOrThrow({
      where: { id, userId },
      select: { hoursPlayed: true },
    })).hoursPlayed;
    const hoursPlayed = recordedHours === 0 ? lengthHours : recordedHours;
    const finalLengthHours = Math.max(lengthHours, hoursPlayed);

    await prisma.game.update({
      where: { id, userId },
      data: {
        status: "Completed",
        pinnedOrder: null,
        lengthHours: finalLengthHours,
        difficulty,
        earnedXp: calculateEarnedXp("Completed", finalLengthHours, difficulty),
        ...progress,
        hoursPlayed,
      },
    });

    await syncAndGetAchievements(userId);
    revalidatePath("/");
  });
}

export async function logPlaySession(gameId: number, addHours: number) {
  return safeAction(async () => {
    if (!Number.isSafeInteger(gameId) || gameId < 1 ||
      !Number.isSafeInteger(addHours) || Math.abs(addHours) > 10000) {
      throw new InputError("Please provide a valid game ID and whole session hours.");
    }

    const userId = await getAuthenticatedPlayerId();
    // Clamp and increment in one statement so concurrent sessions cannot overwrite each other.
    const updated = await prisma.$queryRaw<Array<{ id: number }>>`
      UPDATE "Game"
      SET "hoursPlayed" = LEAST(10000, GREATEST(0, "hoursPlayed" + ${addHours}))
      WHERE "id" = ${gameId} AND "userId" = ${userId}
      RETURNING "id"
    `;
    if (updated.length === 0) throw new InputError("Game not found.");
    await syncAndGetAchievements(userId);
    revalidatePath("/");
  });
}

export async function deleteGame(formData: FormData) {
  return safeAction(async () => {
    const idValue = formData.get("id");

    if (typeof idValue !== "string") {
      throw new InputError("Please provide a valid game ID.");
    }

    const id = Number(idValue);

    if (!Number.isSafeInteger(id) || id < 1) {
      throw new InputError("Please provide a valid game ID.");
    }

    const userId = await getAuthenticatedPlayerId();
    await prisma.game.findUniqueOrThrow({ where: { id, userId }, select: { id: true } });
    // Capture earned milestones before removing a game that contributed to them.
    await syncAndGetAchievements(userId);
    await prisma.game.delete({ where: { id, userId } });

    revalidatePath("/");
  });
}
