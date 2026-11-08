import { InputError } from "@/lib/action-result";

export type SteamProgressFields = {
  steamAppId?: string | null; steamRecentMinutes?: number | null; steamLastSyncedAt?: string | Date | null;
  steamAchievementsUnlocked?: number | null; steamAchievementsTotal?: number | null;
  steamAchievementsCheckedAt?: string | Date | null; steamAchievementsSyncedAt?: string | Date | null;
};
export const MAX_STEAM_ACHIEVEMENTS = 100000;
export const STEAM_RECENT_WINDOW_MINUTES = 14 * 24 * 60;
export function validSteamAppId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 4294967295;
}
export function steamAchievementProgress(game: SteamProgressFields) {
  const unlocked = game.steamAchievementsUnlocked, total = game.steamAchievementsTotal;
  if (typeof unlocked !== "number" || typeof total !== "number" || !Number.isInteger(unlocked) || !Number.isInteger(total) ||
    unlocked < 0 || total < 0 || unlocked > total || total > MAX_STEAM_ACHIEVEMENTS) return null;
  return { unlocked, total, mastered: total > 0 && unlocked === total, percent: total > 0 ? Math.floor(unlocked / total * 100) : 0 };
}

/** Backups retain cached history, never a Steam account credential or claim of ownership. */
export function importSteamProgress(game: Record<string, unknown>) {
  const number = (name: string, max: number) => {
    const value = game[name];
    if (value == null || value === "") return null;
    const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new InputError("Invalid Steam progress in backup.");
    return parsed;
  };
  const timestamp = (name: string) => {
    const value = game[name];
    if (value == null || value === "") return null;
    const text = value instanceof Date ? value.toISOString() : value;
    if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text.slice(0, 10)) throw new InputError("Invalid Steam sync timestamp in backup.");
    return new Date(text);
  };
  const steamAppId = game.steamAppId == null || game.steamAppId === "" ? null : game.steamAppId;
  if (steamAppId !== null && !validSteamAppId(steamAppId)) throw new InputError("Invalid Steam AppID in backup.");
  const steamAchievementsUnlocked = number("steamAchievementsUnlocked", MAX_STEAM_ACHIEVEMENTS);
  const steamAchievementsTotal = number("steamAchievementsTotal", MAX_STEAM_ACHIEVEMENTS);
  if ((steamAchievementsUnlocked === null) !== (steamAchievementsTotal === null) ||
    (steamAchievementsUnlocked !== null && steamAchievementsUnlocked > steamAchievementsTotal!)) throw new InputError("Invalid Steam achievement counts in backup.");
  return { steamAppId, steamAchievementsUnlocked, steamAchievementsTotal,
    steamRecentMinutes: number("steamRecentMinutes", STEAM_RECENT_WINDOW_MINUTES), steamLastSyncedAt: timestamp("steamLastSyncedAt"),
    steamAchievementsCheckedAt: timestamp("steamAchievementsCheckedAt"), steamAchievementsSyncedAt: timestamp("steamAchievementsSyncedAt") };
}
