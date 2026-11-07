import { InputError } from "@/lib/action-result";
import { MAX_CUSTOM_LIST_GAMES, type CustomListCommand, type CustomListFields } from "@/lib/custom-list-types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Choose a valid list operation.");
  return value as Record<string, unknown>;
}
export function customListFields(value: unknown): CustomListFields {
  const input = record(value);
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 80) throw new InputError("List titles must contain 1–80 characters.");
  if (input.description != null && (typeof input.description !== "string" || input.description.trim().length > 280)) throw new InputError("List descriptions support up to 280 characters.");
  if (typeof input.isRanked !== "boolean" || typeof input.isPublic !== "boolean") throw new InputError("Choose ranking and visibility for this list.");
  return { title: input.title.trim(), description: typeof input.description === "string" ? input.description.trim() || null : null, isRanked: input.isRanked, isPublic: input.isPublic };
}
export function validGameId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}
export function parseCustomListCommand(value: unknown): CustomListCommand {
  const input = record(value);
  if (input.type === "create") return { type: "create", ...customListFields(input) };
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.id) || typeof input.revision !== "number" || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= 2147483647) throw new InputError("Choose a valid list and revision.");
  const base = { id: input.id, revision: input.revision };
  if (input.type === "update") return { type: "update", ...base, ...customListFields(input) };
  if (input.type === "delete") return { type: "delete", ...base };
  if (input.type === "add" || input.type === "remove") {
    if (!validGameId(input.gameId)) throw new InputError("Choose a valid library game.");
    return { type: input.type, ...base, gameId: input.gameId };
  }
  if (input.type === "reorder") {
    if (!Array.isArray(input.gameIds) || input.gameIds.length > MAX_CUSTOM_LIST_GAMES || !input.gameIds.every(validGameId) || new Set(input.gameIds).size !== input.gameIds.length) throw new InputError("Provide up to 50 unique library games in order.");
    return { type: "reorder", ...base, gameIds: input.gameIds };
  }
  throw new InputError("Choose a valid list operation.");
}
