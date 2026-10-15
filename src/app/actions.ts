"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

const allowedPlatforms = new Set(["PC", "Switch", "PS5", "Retro"]);
const allowedStatuses = new Set(["Backlog", "Playing", "Completed"]);

function calculateEarnedXp(
  status: string,
  lengthHours: number,
  difficulty: number,
) {
  return status === "Completed" ? lengthHours * difficulty * 10 : 0;
}

export async function createGame(formData: FormData) {
  const titleValue = formData.get("title");
  const platformValue = formData.get("platform");
  const lengthHoursValue = formData.get("lengthHours");
  const difficultyValue = formData.get("difficulty");

  if (
    typeof titleValue !== "string" ||
    typeof platformValue !== "string" ||
    typeof lengthHoursValue !== "string" ||
    typeof difficultyValue !== "string"
  ) {
    throw new Error("Please provide valid game details.");
  }

  const title = titleValue.trim();
  const lengthHours = Number(lengthHoursValue);
  const difficulty = Number(difficultyValue);

  if (
    title.length === 0 ||
    title.length > 120 ||
    !allowedPlatforms.has(platformValue) ||
    !Number.isSafeInteger(lengthHours) ||
    lengthHours < 1 ||
    lengthHours > 10000 ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 3
  ) {
    throw new Error("Please provide valid game details.");
  }

  const status = "Backlog";

  await prisma.game.create({
    data: {
      title,
      platform: platformValue,
      status,
      lengthHours,
      difficulty,
      earnedXp: calculateEarnedXp(status, lengthHours, difficulty),
    },
  });

  revalidatePath("/");
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