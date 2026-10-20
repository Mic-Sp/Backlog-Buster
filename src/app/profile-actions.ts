"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import { publicProfileSelect, serializePlayerProfile, validatePlayerProfile } from "@/lib/player-profile";
import type { PlayerProfileInput } from "@/lib/player-profile-types";

export async function savePlayerProfile(input: PlayerProfileInput) {
  const data = validatePlayerProfile(input);
  const id = getCurrentPlayerId();
  const profile = await prisma.$transaction(async (tx) => {
    const selected = data.featuredTrophyIds.filter((gameId): gameId is number => gameId !== null);
    if (selected.length) {
      const eligible = await tx.game.findMany({
        where: { id: { in: selected }, userId: id, status: "Completed", rating: 5 }, select: { id: true },
      });
      if (eligible.length !== selected.length) throw new Error("Showcase trophies must be your completed, five-star games.");
    }
    return tx.player.upsert({ where: { id }, create: { id, ...data }, update: data, select: publicProfileSelect });
  });
  revalidatePath("/");
  return serializePlayerProfile(profile);
}
