import "server-only";

import { prisma } from "@/lib/prisma";
import { getAuthenticatedPlayerId } from "@/lib/player";
import { normalizeGameTitle } from "@/lib/game-title";
import { InputError } from "@/lib/action-result";

export async function getDismissedRecommendationTitles(userId: string): Promise<string[]> {
  const rows = await prisma.recommendationDismissal.findMany({
    where: { userId }, select: { titleKey: true },
  });
  return rows.map(row => row.titleKey);
}

export async function saveRecommendationDismissal(title: string) {
  if (typeof title !== "string" || !title.trim() || title.trim().length > 120 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(title)) {
    throw new InputError("Choose a valid recommendation title (up to 120 characters).");
  }
  const titleKey = normalizeGameTitle(title);
  if (!titleKey) throw new InputError("Choose a recommendation title containing letters or numbers.");
  const userId = await getAuthenticatedPlayerId();
  await prisma.recommendationDismissal.upsert({
    where: { userId_titleKey: { userId, titleKey } },
    create: { userId, titleKey }, update: {},
  });
  return { titleKey };
}
