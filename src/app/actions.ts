"use server";

import { guardedRequest } from "@/lib/api-resilience";
import { safeAction, InputError, RateLimitError } from "@/lib/action-result";
import { validateGameForm } from "@/lib/form-validation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncAndGetAchievements } from "@/lib/achievements";
import { ensurePlayerExists, getCurrentPlayerId } from "@/lib/player";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { lookupRawgGame, type RawgGameInfo } from "@/lib/rawg";
import { getBacklogRecommendations, getExternalRecommendations } from "@/lib/recommendations";
import { normalizeGameTitle } from "@/lib/game-title";
import { DECK_CAPACITY } from "@/lib/deck";
import type { Prisma } from "@/generated/prisma/client";
import { buildSagaChains, parseChronologicalOrder } from "@/lib/sagas";
import { resolveSagaChronology } from "@/lib/saga-chronology";
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
    const userId = await getCurrentPlayerId();
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
  const userId = await getCurrentPlayerId();
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
    const userId = await getCurrentPlayerId();
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
    const userId = await getCurrentPlayerId();
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
    const userId = await getCurrentPlayerId();
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

    const userId = await getCurrentPlayerId();
    const lookup = submittedLengthHours === null ||
      Object.values(manualMetadata).some((value) => value === "")
      ? await lookupRawgGame(title)
      : null;
    const metadata = resolveGameMetadata(manualMetadata, lookup);
    const lengthHours = submittedLengthHours ??
      resolveRawgPlaytime(lookup?.playtime, metadata.genre) ??
      10;
    const status = "Backlog";

    await ensurePlayerExists(userId);
    await prisma.game.create({
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
  });
}

export async function searchGameInfo(title: string) {
  return safeAction(async () => {
    await getCurrentPlayerId();
    if (typeof title !== "string" || !title.trim()) throw new InputError("Please input a valid title.");
    const cleanTitle = title.trim();
    return cleanTitle === "" || cleanTitle.length > 120
      ? null
      : guardedRequest(await getCurrentPlayerId(), "metadata", cleanTitle.toLowerCase(), () => lookupRawgGame(cleanTitle, true));
  });
}

export async function fetchBacklogAdvisor() {
  return safeAction(async () => {
    const playerId = await getCurrentPlayerId();
    return guardedRequest(playerId, "advisor", "backlog", () => getBacklogRecommendations(playerId));
  });
}

export async function fetchExternalScout() {
  return safeAction(async () => {
    const playerId = await getCurrentPlayerId();
    return guardedRequest(playerId, "scout", "external", () => getExternalRecommendations(playerId));
  });
}

export async function autoDetectSagaOrder(sagaKey: string) {
  return safeAction(async () => {
    if (typeof sagaKey !== "string" || !sagaKey.trim() || sagaKey.length > 240) {
      return { updatedCount: 0, error: "Choose a valid saga to scan." };
    }
    const userId = await getCurrentPlayerId();
    const games = await prisma.game.findMany({
      where: { userId },
      select: { id: true, title: true, status: true, franchise: true, chronologicalOrder: true },
    });
    const chain = buildSagaChains(games).chains.find((saga) => saga.key === sagaKey);
    if (!chain) return { updatedCount: 0, error: "This saga is no longer available. Refresh your library and try again." };
    const ids = new Set(chain.gameIds);
    const members = games.filter((game) => ids.has(game.id));
    let order: Record<string, number> | null;
    try {
      order = await guardedRequest(userId, "chronology", sagaKey, () => resolveSagaChronology(chain.name, members.map((game) => game.title)));
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      return { updatedCount: 0, error: error instanceof Error ? error.message : "Canon scan failed. Existing timeline ranks were kept." };
    }
    if (!order) return { updatedCount: 0, message: "No reliable shared canon timeline was found. Existing ranks were kept; unassigned games use release order." };
    try {
      // No network calls inside the transaction. Snapshot guards prevent overwriting
      // metadata or manual ranks edited in another tab while Gemini was responding.
      await prisma.$transaction(members.map((game) => prisma.game.update({
        where: { id: game.id, userId, title: game.title, franchise: game.franchise, chronologicalOrder: game.chronologicalOrder },
        data: { chronologicalOrder: order[game.title.trim()] },
        select: { id: true },
      })));
    } catch {
      return { updatedCount: 0, error: "Your saga changed during the scan. No ranks were saved; please try again." };
    }
    revalidatePath("/");
    return { updatedCount: members.length, message: `Canon order saved for ${members.length} games. You can adjust individual ranks in Edit Metadata.` };
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
      where: { userId: await getCurrentPlayerId() }, select: { title: true },
    });
    if (existing.some((game) => normalizeGameTitle(game.title) === normalizeGameTitle(title))) {
      revalidatePath("/");
      return;
    }
    return await createGame(formData);
  });
}

export async function bulkImportGames(payload: {
  mode: "titles" | "json";
  content: string;
  defaultPlatform?: string;
}) {
  return safeAction(async () => {
    if (!payload || !["titles", "json"].includes(payload.mode) ||
      typeof payload.content !== "string" || new TextEncoder().encode(payload.content).length > 500000) {
      throw new InputError("Provide a title list or JSON backup under 500 KB.");
    }
    const userId = await getCurrentPlayerId();
    function text(value: unknown, field: string, limit?: number): string {
      if (field === "title" && (typeof value !== "string" || !value.trim())) throw new InputError("Please input a valid title.");
      if (typeof value !== "string" || !value.trim() || (limit && value.trim().length > limit)) {
        throw new InputError(`Invalid ${field}${limit ? ` (1–${limit} characters)` : ""}.`);
      }
      return value.trim();
    }
    function nullableText(value: unknown, field: string, limit?: number): string | null {
      if (value == null || value === "") return null;
      if (typeof value !== "string" || (limit && value.trim().length > limit)) {
        throw new InputError(`Invalid ${field}${limit ? ` (maximum ${limit} characters)` : ""}.`);
      }
      return value.trim() || null;
    }
    function integer(value: unknown, field: string, min: number, max: number, fallback: number): number {
      if (value === undefined || (typeof value === "string" && !value.trim())) return fallback;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new InputError(`${field} must be a whole number from ${min} to ${max}.`);
      }
      return value;
    }
    type ImportedGame = {
      userId: string; title: string; platform: string; status: string;
      wasFlatlined: boolean;
      pinnedOrder: number | null;
      backlogOrder: number | null;
      lengthHours: number; hoursPlayed: number; difficulty: number; earnedXp: number;
      rating: number | null; notes: string | null; genre: string | null; franchise: string | null;
      releaseYear: number | null; chronologicalOrder: number | null; coverUrl: string | null;
    };
    let records: ImportedGame[] = [];
    if (payload.mode === "titles") {
      if (payload.defaultPlatform !== undefined && typeof payload.defaultPlatform !== "string") {
        throw new InputError("Invalid default platform.");
      }
      const defaultPlatform = payload.defaultPlatform?.trim()
        ? text(payload.defaultPlatform, "default platform", 80) : "";
      const lines = payload.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 25);
      if (!lines.length) throw new InputError("Enter at least one game title.");
      const titles = lines.map((line) => {
        const [title, platform, ...extra] = line.split("|");
        if (extra.length) throw new InputError("Use Title or Title | Platform on each line.");
        return { title: text(title, "title", 120), platform: platform?.trim() ? text(platform, "platform", 80) : "" };
      });
      // Resolve a small group at a time rather than issuing 25 RAWG requests together.
      for (let index = 0; index < titles.length; index += 5) {
        const group = await Promise.all(titles.slice(index, index + 5).map(async ({ title, platform }) => {
          const lookup = await lookupRawgGame(title);
          return {
            userId, title,
            platform: platform || defaultPlatform || lookup?.platforms[0] || "PC",
            status: "Backlog",
            wasFlatlined: false,
            pinnedOrder: null,
            backlogOrder: null,
            lengthHours: resolveRawgPlaytime(lookup?.playtime, lookup?.genre) ?? 10,
            hoursPlayed: 0, difficulty: 2, earnedXp: 0, rating: null, notes: null,
            genre: lookup?.genre ?? null, franchise: null, releaseYear: lookup?.releaseYear ?? null, chronologicalOrder: null,
            coverUrl: lookup?.coverUrl ?? null,
          };
        }));
        records.push(...group);
      }
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.content);
      } catch {
        throw new InputError("Invalid JSON. Choose a JSON backup containing an array of games.");
      }
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 200) {
        throw new InputError("A JSON import must contain between 1 and 200 games.");
      }
      records = parsed.map((value: unknown, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new InputError(`Game ${index + 1} must be an object.`);
        }
        const game = value as Record<string, unknown>;
        const status = typeof game.status === "string" ? game.status.trim() || "Backlog" : game.status ?? "Backlog";
        if (typeof status !== "string" || !allowedStatuses.has(status)) {
          throw new InputError(`Game ${index + 1} has an invalid status.`);
        }
        if (game.wasFlatlined !== undefined && typeof game.wasFlatlined !== "boolean") {
          throw new InputError(`Game ${index + 1} has an invalid Flatlined history flag.`);
        }
        const lengthHours = integer(game.lengthHours, "Length hours", 1, 10000, 10);
        const pinnedOrder = game.pinnedOrder == null ? null : integer(game.pinnedOrder, "Deck slot", 1, DECK_CAPACITY, 1);
        const difficulty = integer(game.difficulty, "Difficulty", 1, 3, 2);
        const releaseYear = game.releaseYear == null || (typeof game.releaseYear === "string" && !game.releaseYear.trim()) ? null : integer(game.releaseYear, "Release year", 1800, 2100, 2000);
        const coverUrl = nullableText(game.coverUrl, "cover URL");
        return {
          userId, title: text(game.title, "title", 120), platform: game.platform == null || (typeof game.platform === "string" && !game.platform.trim()) ? "PC" : text(game.platform, "platform", 80),
          status, lengthHours, difficulty,
          wasFlatlined: status === "Flatlined" || game.wasFlatlined === true,
          pinnedOrder: status === "Backlog" && isReleasedYear(releaseYear) ? pinnedOrder : null,
          backlogOrder: game.backlogOrder == null ? null : integer(game.backlogOrder, "Backlog priority", 1, 10000, 1),
          hoursPlayed: integer(game.hoursPlayed, "Hours played", 0, 10000, 0),
          earnedXp: calculateEarnedXp(status, lengthHours, difficulty),
          rating: game.rating == null || (typeof game.rating === "string" && !game.rating.trim()) ? null : integer(game.rating, "Rating", 1, 5, 1),
          notes: nullableText(game.notes, "notes", 1000), genre: nullableText(game.genre, "genre", 80),
          franchise: nullableText(game.franchise, "franchise", 120),
          chronologicalOrder: parseChronologicalOrder(game.chronologicalOrder),
          releaseYear,
          coverUrl: coverUrl ? optionalHttpUrl(coverUrl) : null,
        };
      });
    }
    await ensurePlayerExists(userId);
    const counts = await withDeckLock(userId, async (tx) => {
      const existing = await tx.game.findMany({ where: { userId }, select: { title: true, platform: true, pinnedOrder: true } });
      const pairKey = (game: { title: string; platform: string }) =>
        JSON.stringify([game.title.trim().toLowerCase(), game.platform.trim().toLowerCase()]);
      const seen = new Set(existing.map(pairKey));
      const unique = records.filter((game) => {
        const key = pairKey(game);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const used = new Set(existing.flatMap((game) => game.pinnedOrder === null ? [] : [game.pinnedOrder]));
      // Restore priority only into free slots; every other imported gig remains in Backlog.
      for (const game of [...unique].sort((left, right) => (left.pinnedOrder ?? Infinity) - (right.pinnedOrder ?? Infinity))) {
        if (game.pinnedOrder === null) continue;
        const slot = !used.has(game.pinnedOrder) ? game.pinnedOrder
          : Array.from({ length: DECK_CAPACITY }, (_, index) => index + 1).find((value) => !used.has(value));
        game.pinnedOrder = slot ?? null;
        if (slot !== undefined) used.add(slot);
      }
      const result = unique.length ? await tx.game.createMany({ data: unique }) : { count: 0 };
      return { importedCount: result.count, skippedCount: records.length - unique.length };
    });
    await syncAndGetAchievements();
    revalidatePath("/");
    return counts;
  });
}

export async function acceptQuest(gameId: number) {
  return safeAction(async () => {
    if (!Number.isSafeInteger(gameId) || gameId < 1) {
      throw new InputError("Please provide a valid game ID.");
    }

    await prisma.game.update({
      where: { id: gameId, userId: await getCurrentPlayerId(), status: "Backlog" },
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
    const userId = await getCurrentPlayerId();
    const game = await prisma.game.findUniqueOrThrow({
      where: { id: gameId, userId },
      select: { status: true, difficulty: true },
    });
    await prisma.game.update({
      // Fail rather than calculate XP from a status/difficulty changed by another request.
      where: { id: gameId, userId, status: game.status, difficulty: game.difficulty },
      data: { lengthHours: hours, earnedXp: calculateEarnedXp(game.status, hours, game.difficulty) },
    });
    await syncAndGetAchievements();
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

    const existing = await prisma.game.findUniqueOrThrow({
      where: { id, userId: await getCurrentPlayerId() },
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
      where: { id, userId: await getCurrentPlayerId() },
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

    await syncAndGetAchievements();
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

    await prisma.game.update({
      where: { id, userId: await getCurrentPlayerId() },
      data: { status: "Playing", lengthHours, difficulty, earnedXp: 0, pinnedOrder: null, ...progress },
    });

    await syncAndGetAchievements();
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

    const recordedHours = progress.hoursPlayed ?? (await prisma.game.findUniqueOrThrow({
      where: { id, userId: await getCurrentPlayerId() },
      select: { hoursPlayed: true },
    })).hoursPlayed;
    const hoursPlayed = recordedHours === 0 ? lengthHours : recordedHours;
    const finalLengthHours = Math.max(lengthHours, hoursPlayed);

    await prisma.game.update({
      where: { id, userId: await getCurrentPlayerId() },
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

    await syncAndGetAchievements();
    revalidatePath("/");
  });
}

export async function logPlaySession(gameId: number, addHours: number) {
  return safeAction(async () => {
    if (!Number.isSafeInteger(gameId) || gameId < 1 ||
      !Number.isSafeInteger(addHours) || Math.abs(addHours) > 10000) {
      throw new InputError("Please provide a valid game ID and whole session hours.");
    }

    // Clamp and increment in one statement so concurrent sessions cannot overwrite each other.
    const updated = await prisma.$queryRaw<Array<{ id: number }>>`
      UPDATE "Game"
      SET "hoursPlayed" = LEAST(10000, GREATEST(0, "hoursPlayed" + ${addHours}))
      WHERE "id" = ${gameId} AND "userId" = ${await getCurrentPlayerId()}
      RETURNING "id"
    `;
    if (updated.length === 0) throw new InputError("Game not found.");
    await syncAndGetAchievements();
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

    // Capture earned milestones before removing a game that contributed to them.
    await syncAndGetAchievements();
    await prisma.game.delete({ where: { id, userId: await getCurrentPlayerId() } });

    revalidatePath("/");
  });
}
