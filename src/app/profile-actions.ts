"use server";

import { safeAction, InputError } from "@/lib/action-result";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentPlayerId } from "@/lib/player";
import { publicProfileSelect, serializePlayerProfile, validatePlayerProfile } from "@/lib/player-profile";
import type { PlayerProfileInput } from "@/lib/player-profile-types";

export async function savePlayerProfile(input: PlayerProfileInput) {
  return safeAction(async () => {
    const data = validatePlayerProfile(input);
    const id = await getCurrentPlayerId();
    let profile;
    try {
      profile = await prisma.$transaction(async (tx) => {
        // Share registration's lock so case-insensitive handle claims stay atomic.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('backlogbuster-account-registration', 0))`;
        if (data.handle) {
          const taken = await tx.player.findFirst({ where: {
            handle: { equals: data.handle, mode: "insensitive" }, id: { not: id },
          }, select: { id: true } });
          if (taken) throw new InputError("That handle is already claimed. Try another callsign.");
        }
        const selected = data.featuredTrophyIds.filter((gameId): gameId is number => gameId !== null);
        if (selected.length) {
          const eligible = await tx.game.findMany({
            where: { id: { in: selected }, userId: id, status: "Completed", rating: 5 }, select: { id: true },
          });
          if (eligible.length !== selected.length) throw new InputError("Showcase trophies must be your completed, five-star games.");
        }
        return tx.player.upsert({ where: { id }, create: { id, ...data }, update: data, select: publicProfileSelect });
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new InputError("That handle is already claimed. Try another callsign.");
      }
      throw error;
    }
    revalidatePath("/");
    return serializePlayerProfile(profile);
  });
}
