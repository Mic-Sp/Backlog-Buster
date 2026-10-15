export function resolveRawgPlaytime(
  playtime: number | null | undefined,
  genre: string | null | undefined,
): number | null {
  const normalizedGenre = genre?.toLowerCase() ?? "";
  const isRpg = normalizedGenre.includes("rpg") ||
    normalizedGenre.includes("role-playing");
  const isActionAdventure = normalizedGenre.includes("action") ||
    normalizedGenre.includes("adventure");

  if (
    playtime === null ||
    playtime === undefined ||
    !Number.isFinite(playtime) ||
    playtime <= 0
  ) {
    return 10;
  }

  if (isRpg && playtime < 20) {
    return 25;
  }

  if (isActionAdventure && playtime < 12) {
    return 15;
  }

  if (playtime < 8) {
    return 10;
  }

  return Math.min(10000, Math.max(1, Math.round(playtime)));
}