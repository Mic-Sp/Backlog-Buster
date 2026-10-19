"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncAndGetAchievements } from "@/lib/achievements";
import { getCurrentPlayerId } from "@/lib/player";
import { resolveRawgPlaytime } from "@/lib/game-playtime";
import { lookupRawgGame, type RawgGameInfo } from "@/lib/rawg";

const allowedStatuses = new Set(["Backlog", "Playing", "Completed"]);

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
  const progress: { hoursPlayed?: number; notes?: string | null } = {};
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
      ...metadata,
      ...progress,
    },
  });

  await syncAndGetAchievements();
  revalidatePath("/");
}

export async function startGame(formData: FormData) {
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
    data: { status: "Playing", lengthHours, difficulty, earnedXp: 0 },
  });

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
