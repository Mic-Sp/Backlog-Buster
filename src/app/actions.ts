"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncAndGetAchievements } from "@/lib/achievements";
import { getCurrentPlayerId } from "@/lib/player";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { lookupRawgGame, type RawgGameInfo } from "@/lib/rawg";
import { getBacklogRecommendations, getExternalRecommendations } from "@/lib/recommendations";
import { normalizeGameTitle } from "@/lib/game-title";

const allowedStatuses = new Set(["Backlog", "Playing", "Completed", "Flatlined"]);

function calculateEarnedXp(
  status: string,
  lengthHours: number,
  difficulty: number,
) {
  return status === "Completed" ? lengthHours * difficulty * 10 : 0;
}

function optionalText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readProgressFields(formData: FormData) {
  const progress: { hoursPlayed?: number; notes?: string | null; rating?: number | null } = {};
  if (formData.has("hoursPlayed")) {
    const value = formData.get("hoursPlayed");
    const hours = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isSafeInteger(hours) || hours < 0 || hours > 10000) {
      throw new Error("Hours played must be a whole number from 0 to 10000.");
    }
    progress.hoursPlayed = hours;
  }
  if (formData.has("notes")) {
    const value = formData.get("notes");
    if (typeof value !== "string" || value.trim().length > 1000) {
      throw new Error("Field log must be at most 1000 characters.");
    }
    progress.notes = value.trim() || null;
  }
  if (formData.has("rating")) {
    const value = formData.get("rating");
    if (typeof value !== "string") {
      throw new Error("Rating must be a whole number from 1 to 5, or unrated.");
    }
    const rating = value === "" ? null : Number(value);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new Error("Rating must be a whole number from 1 to 5, or unrated.");
    }
    progress.rating = rating;
  }
  return progress;
}

function optionalYear(value: string): number | null {
  if (value === "") {
    return null;
  }

  const year = Number(value);
  return Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : null;
}

function optionalHttpUrl(value: string): string | null {
  if (value === "") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
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
  const titleValue = formData.get("title");
  const platformValue = formData.get("platform");
  const lengthHoursValue = formData.get("lengthHours");
  const difficultyValue = formData.get("difficulty");
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
    throw new Error("Please provide valid game details.");
  }

  const title = titleValue.trim();
  const platform = platformValue.trim();
  const submittedLengthHours = lengthHoursValue.trim() === ""
    ? null
    : Number(lengthHoursValue);
  const difficulty = Number(difficultyValue);

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
    throw new Error("Please provide valid game details.");
  }

  const lookup = submittedLengthHours === null ||
    Object.values(manualMetadata).some((value) => value === "")
    ? await lookupRawgGame(title)
    : null;
  const metadata = resolveGameMetadata(manualMetadata, lookup);
  const lengthHours = submittedLengthHours ??
    resolveRawgPlaytime(lookup?.playtime, metadata.genre) ??
    10;
  const status = "Backlog";

  await prisma.game.create({
    data: {
      userId: getCurrentPlayerId(),
      title,
      platform: platform || lookup?.platforms[0] || "PC",
      status,
      lengthHours,
      difficulty,
      earnedXp: calculateEarnedXp(status, lengthHours, difficulty),
      ...metadata,
    },
  });

  revalidatePath("/");
}

export async function searchGameInfo(title: string): Promise<RawgGameInfo | null> {
  const cleanTitle = title.trim();
  return cleanTitle === "" || cleanTitle.length > 120
    ? null
    : lookupRawgGame(cleanTitle);
}

export async function fetchBacklogAdvisor() {
  return getBacklogRecommendations(getCurrentPlayerId());
}

export async function fetchExternalScout() {
  return getExternalRecommendations(getCurrentPlayerId());
}

export async function addExternalScoutGame(formData: FormData) {
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120) {
    throw new Error("Please provide a valid game title.");
  }
  const existing = await prisma.game.findMany({
    where: { userId: getCurrentPlayerId() }, select: { title: true },
  });
  if (existing.some((game) => normalizeGameTitle(game.title) === normalizeGameTitle(title))) {
    revalidatePath("/");
    return;
  }
  await createGame(formData);
}

export async function bulkImportGames(payload: {
  mode: "titles" | "json";
  content: string;
  defaultPlatform?: string;
}) {
  if (!payload || !["titles", "json"].includes(payload.mode) ||
    typeof payload.content !== "string" || new TextEncoder().encode(payload.content).length > 500000) {
    throw new Error("Provide a title list or JSON backup under 500 KB.");
  }
  const userId = getCurrentPlayerId();
  function text(value: unknown, field: string, limit?: number): string {
    if (typeof value !== "string" || !value.trim() || (limit && value.trim().length > limit)) {
      throw new Error(`Invalid ${field}${limit ? ` (1–${limit} characters)` : ""}.`);
    }
    return value.trim();
  }
  function nullableText(value: unknown, field: string, limit?: number): string | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || (limit && value.trim().length > limit)) {
      throw new Error(`Invalid ${field}${limit ? ` (maximum ${limit} characters)` : ""}.`);
    }
    return value.trim() || null;
  }
  function integer(value: unknown, field: string, min: number, max: number, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${field} must be a whole number from ${min} to ${max}.`);
    }
    return value;
  }
  type ImportedGame = {
    userId: string; title: string; platform: string; status: string;
    wasFlatlined: boolean;
    lengthHours: number; hoursPlayed: number; difficulty: number; earnedXp: number;
    rating: number | null; notes: string | null; genre: string | null;
    releaseYear: number | null; coverUrl: string | null;
  };
  let records: ImportedGame[] = [];
  if (payload.mode === "titles") {
    if (payload.defaultPlatform !== undefined && typeof payload.defaultPlatform !== "string") {
      throw new Error("Invalid default platform.");
    }
    const defaultPlatform = payload.defaultPlatform?.trim()
      ? text(payload.defaultPlatform, "default platform", 80) : "";
    const lines = payload.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 25);
    if (!lines.length) throw new Error("Enter at least one game title.");
    const titles = lines.map((line) => {
      const [title, platform, ...extra] = line.split("|");
      if (extra.length) throw new Error("Use Title or Title | Platform on each line.");
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
          lengthHours: resolveRawgPlaytime(lookup?.playtime, lookup?.genre) ?? 10,
          hoursPlayed: 0, difficulty: 2, earnedXp: 0, rating: null, notes: null,
          genre: lookup?.genre ?? null, releaseYear: lookup?.releaseYear ?? null,
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
      throw new Error("Invalid JSON. Choose a JSON backup containing an array of games.");
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 200) {
      throw new Error("A JSON import must contain between 1 and 200 games.");
    }
    records = parsed.map((value: unknown, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Game ${index + 1} must be an object.`);
      }
      const game = value as Record<string, unknown>;
      const status = game.status ?? "Backlog";
      if (typeof status !== "string" || !allowedStatuses.has(status)) {
        throw new Error(`Game ${index + 1} has an invalid status.`);
      }
      if (game.wasFlatlined !== undefined && typeof game.wasFlatlined !== "boolean") {
        throw new Error(`Game ${index + 1} has an invalid Flatlined history flag.`);
      }
      const lengthHours = integer(game.lengthHours, "Length hours", 1, 10000, 10);
      const difficulty = integer(game.difficulty, "Difficulty", 1, 3, 2);
      const coverUrl = nullableText(game.coverUrl, "cover URL");
      return {
        userId, title: text(game.title, "title", 120), platform: text(game.platform, "platform", 80),
        status, lengthHours, difficulty,
        wasFlatlined: status === "Flatlined" || game.wasFlatlined === true,
        hoursPlayed: integer(game.hoursPlayed, "Hours played", 0, 10000, 0),
        earnedXp: calculateEarnedXp(status, lengthHours, difficulty),
        rating: game.rating == null ? null : integer(game.rating, "Rating", 1, 5, 1),
        notes: nullableText(game.notes, "notes", 1000), genre: nullableText(game.genre, "genre"),
        releaseYear: game.releaseYear == null ? null : integer(game.releaseYear, "Release year", 1800, 2100, 2000),
        coverUrl: coverUrl ? optionalHttpUrl(coverUrl) : null,
      };
    });
  }
  const existing = await prisma.game.findMany({ where: { userId }, select: { title: true, platform: true } });
  const pairKey = (game: { title: string; platform: string }) =>
    JSON.stringify([game.title.trim().toLowerCase(), game.platform.trim().toLowerCase()]);
  const seen = new Set(existing.map(pairKey));
  const unique = records.filter((game) => {
    const key = pairKey(game);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const result = unique.length ? await prisma.game.createMany({ data: unique }) : { count: 0 };
  await syncAndGetAchievements();
  revalidatePath("/");
  return { importedCount: result.count, skippedCount: records.length - unique.length };
}

export async function acceptQuest(gameId: number) {
  if (!Number.isSafeInteger(gameId) || gameId < 1) {
    throw new Error("Please provide a valid game ID.");
  }

  await prisma.game.update({
    where: { id: gameId, userId: getCurrentPlayerId(), status: "Backlog" },
    data: { status: "Playing", earnedXp: 0 },
  });

  revalidatePath("/");
}

export async function updateGame(formData: FormData) {
  const progress = readProgressFields(formData);
  const idValue = formData.get("id");
  const statusValue = formData.get("status");
  const lengthHoursValue = formData.get("lengthHours");
  const difficultyValue = formData.get("difficulty");
  const metadata: {
    title?: string;
    platform?: string;
    genre?: string | null;
    releaseYear?: number | null;
    coverUrl?: string | null;
  } = {};

  for (const name of ["title", "platform", "genre", "releaseYear", "coverUrl"]) {
    if (formData.has(name) && typeof formData.get(name) !== "string") {
      throw new Error("Please provide valid game metadata.");
    }
  }
  for (const name of ["title", "platform"] as const) {
    if (formData.has(name)) {
      const value = optionalText(formData, name);
      if (!value || value.length > (name === "title" ? 120 : 80)) {
        throw new Error("Please provide a valid game title and platform.");
      }
      metadata[name] = value;
    }
  }
  if (formData.has("genre")) metadata.genre = optionalText(formData, "genre") || null;
  if (formData.has("releaseYear")) metadata.releaseYear = optionalYear(optionalText(formData, "releaseYear"));
  if (formData.has("coverUrl")) metadata.coverUrl = optionalHttpUrl(optionalText(formData, "coverUrl"));

  if (
    typeof idValue !== "string" ||
    typeof statusValue !== "string" ||
    typeof lengthHoursValue !== "string" ||
    typeof difficultyValue !== "string"
  ) {
    throw new Error("Please provide valid game details.");
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
    throw new Error("Please provide valid game details.");
  }

  const existing = await prisma.game.findUniqueOrThrow({
    where: { id, userId: getCurrentPlayerId() },
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
    where: { id, userId: getCurrentPlayerId() },
    data: {
      status: statusValue,
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
}

export async function flatlineGame(formData: FormData) {
  formData.set("status", "Flatlined");
  await updateGame(formData);
}

export async function startGame(formData: FormData) {
  const progress = readProgressFields(formData);
  const idValue = formData.get("id");
  const lengthHoursValue = formData.get("lengthHours");
  const difficultyValue = formData.get("difficulty");

  if (
    typeof idValue !== "string" ||
    typeof lengthHoursValue !== "string" ||
    typeof difficultyValue !== "string"
  ) {
    throw new Error("Please provide valid game details.");
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
    throw new Error("Please provide valid game details.");
  }

  await prisma.game.update({
    where: { id, userId: getCurrentPlayerId() },
    data: { status: "Playing", lengthHours, difficulty, earnedXp: 0, ...progress },
  });

  await syncAndGetAchievements();
  revalidatePath("/");
}

export async function completeGame(formData: FormData) {
  const progress = readProgressFields(formData);
  const idValue = formData.get("id");
  const lengthHoursValue = formData.get("lengthHours");
  const difficultyValue = formData.get("difficulty");

  if (
    typeof idValue !== "string" ||
    typeof lengthHoursValue !== "string" ||
    typeof difficultyValue !== "string"
  ) {
    throw new Error("Please provide valid game details.");
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
    throw new Error("Please provide valid game details.");
  }

  const recordedHours = progress.hoursPlayed ?? (await prisma.game.findUniqueOrThrow({
    where: { id, userId: getCurrentPlayerId() },
    select: { hoursPlayed: true },
  })).hoursPlayed;
  const hoursPlayed = recordedHours === 0 ? lengthHours : recordedHours;
  const finalLengthHours = Math.max(lengthHours, hoursPlayed);

  await prisma.game.update({
    where: { id, userId: getCurrentPlayerId() },
    data: {
      status: "Completed",
      lengthHours: finalLengthHours,
      difficulty,
      earnedXp: calculateEarnedXp("Completed", finalLengthHours, difficulty),
      ...progress,
      hoursPlayed,
    },
  });

  await syncAndGetAchievements();
  revalidatePath("/");
}

export async function logPlaySession(gameId: number, addHours: number) {
  if (!Number.isSafeInteger(gameId) || gameId < 1 ||
    !Number.isSafeInteger(addHours) || Math.abs(addHours) > 10000) {
    throw new Error("Please provide a valid game ID and whole session hours.");
  }

  // Clamp and increment in one statement so concurrent sessions cannot overwrite each other.
  const updated = await prisma.$queryRaw<Array<{ id: number }>>`
    UPDATE "Game"
    SET "hoursPlayed" = LEAST(10000, GREATEST(0, "hoursPlayed" + ${addHours}))
    WHERE "id" = ${gameId} AND "userId" = ${getCurrentPlayerId()}
    RETURNING "id"
  `;
  if (updated.length === 0) throw new Error("Game not found.");
  await syncAndGetAchievements();
  revalidatePath("/");
}

export async function deleteGame(formData: FormData) {
  const idValue = formData.get("id");

  if (typeof idValue !== "string") {
    throw new Error("Please provide a valid game ID.");
  }

  const id = Number(idValue);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Please provide a valid game ID.");
  }

  // Capture earned milestones before removing a game that contributed to them.
  await syncAndGetAchievements();
  await prisma.game.delete({ where: { id, userId: getCurrentPlayerId() } });

  revalidatePath("/");
}
