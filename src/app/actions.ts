"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
  const rawgPlaytime = lookup?.playtime;
  const lengthHours = submittedLengthHours ?? (
    rawgPlaytime !== null && rawgPlaytime !== undefined && rawgPlaytime > 0
      ? Math.min(10000, Math.max(1, Math.round(rawgPlaytime)))
      : 10
  );
  const status = "Backlog";

  await prisma.game.create({
    data: {
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

export async function updateGame(formData: FormData) {
  const idValue = formData.get("id");
  const statusValue = formData.get("status");

  if (typeof idValue !== "string" || typeof statusValue !== "string") {
    throw new Error("Please provide a valid game and status.");
  }

  const id = Number(idValue);

  if (!Number.isSafeInteger(id) || id < 1 || !allowedStatuses.has(statusValue)) {
    throw new Error("Please provide a valid game and status.");
  }

  const game = await prisma.game.findUnique({
    where: { id },
    select: { lengthHours: true, difficulty: true },
  });

  if (!game) {
    throw new Error("That game could not be found.");
  }

  await prisma.game.update({
    where: { id },
    data: {
      status: statusValue,
      earnedXp: calculateEarnedXp(
        statusValue,
        game.lengthHours,
        game.difficulty,
      ),
    },
  });

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

  await prisma.game.delete({ where: { id } });

  revalidatePath("/");
}