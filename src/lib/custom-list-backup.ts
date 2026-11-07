import { InputError } from "@/lib/action-result";
import { customListFields } from "@/lib/custom-list-validation";
import { MAX_CUSTOM_LISTS, MAX_CUSTOM_LIST_GAMES, type CustomListFields } from "@/lib/custom-list-types";

export type BackupCustomList = CustomListFields & { games: { title: string; platform: string }[] };
export const backupGameKey = (game: { title: string; platform: string }) => JSON.stringify([game.title.trim().toLowerCase(), game.platform.trim().toLowerCase()]);
export function parseCustomListBackup(content: string): BackupCustomList[] {
  let value;
  try { value = JSON.parse(content); } catch { throw new InputError("Invalid JSON backup."); }
  if (Array.isArray(value)) return [];
  if (!value || value.version !== 2 || !Array.isArray(value.games) || !Array.isArray(value.customLists) || value.customLists.length > MAX_CUSTOM_LISTS) throw new InputError("Choose a version 2 archive with up to 20 custom lists.");
  return value.customLists.map((candidate: unknown) => {
    const fields = customListFields(candidate);
    const games = (candidate as Record<string, unknown>).games;
    if (!Array.isArray(games) || games.length > MAX_CUSTOM_LIST_GAMES) throw new InputError("Backup lists support up to 50 games each.");
    const clean = games.map((game: unknown) => {
      const ref = game as Record<string, unknown> | null;
      if (!ref || typeof ref.title !== "string" || !ref.title.trim() || ref.title.trim().length > 120 || typeof ref.platform !== "string" || !ref.platform.trim() || ref.platform.trim().length > 80) throw new InputError("Invalid backup list game reference.");
      return { title: ref.title.trim(), platform: ref.platform.trim() };
    });
    // Match game restore semantics: copies with the same title/platform merge.
    const seen = new Set<string>();
    return { ...fields, games: clean.filter(game => { const key = backupGameKey(game); if (seen.has(key)) return false; seen.add(key); return true; }) };
  });
}
