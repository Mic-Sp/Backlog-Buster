export function resolveRawgPlaytime(
  playtime: number | null | undefined,
  genre: string | null | undefined,
): number | null {
  const normalizedGenre = genre?.toLowerCase() ?? "";
  const isRpg = normalizedGenre.includes("rpg") ||
    normalizedGenre.includes("role-playing");
  const isActionAdventure = normalizedGenre.includes("action") ||
    normalizedGenre.includes("adventure");

  // Missing provider estimates follow the same genre floors as low estimates.
  const hours = typeof playtime === "number" && Number.isFinite(playtime) && playtime > 0 ? playtime : 0;

  if (isRpg && hours < 20) {
    return 25;
  }

  if (isActionAdventure && hours < 12) {
    return 15;
  }

  if (hours < 8) {
    return 10;
  }

  return Math.min(10000, Math.max(1, Math.round(hours)));
}
