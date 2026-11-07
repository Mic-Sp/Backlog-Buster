import { InputError } from "@/lib/action-result";

export const MAX_CUSTOM_LISTS = 20;
export const MAX_LIST_GAMES = 50;
export type CustomListDetails = { title: string; description: string | null; isRanked: boolean; isPublic: boolean };
export type CustomListData = CustomListDetails & { id: string; gameIds: number[] };
export type PublicCustomList = Omit<CustomListData, "gameIds" | "isPublic"> & {
  games: { title: string; platform: string; coverUrl: string | null }[];
};

export function validateListDetails(value: unknown): CustomListDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Provide valid list details.");
  const input = value as Record<string, unknown>;
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.title))
    throw new InputError("List titles must contain 1–80 characters.");
  if (input.description != null && (typeof input.description !== "string" || input.description.trim().length > 280 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.description)))
    throw new InputError("Descriptions must be at most 280 characters.");
  if (typeof input.isRanked !== "boolean" || typeof input.isPublic !== "boolean") throw new InputError("Choose valid ranking and visibility options.");
  return { title: input.title.trim(), description: typeof input.description === "string" ? input.description.trim() || null : null,
    isRanked: input.isRanked, isPublic: input.isPublic };
}

export function validateListId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new InputError("Choose a valid custom list.");
}
export function validListGameId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}
export function validateListGameIds(ids: unknown): asserts ids is number[] {
  if (!Array.isArray(ids) || ids.length > MAX_LIST_GAMES || Array.from(ids).some(id => !validListGameId(id)) || new Set(ids).size !== ids.length)
    throw new InputError("Choose up to 50 unique library games.");
}
