import { InputError } from "@/lib/action-result";

export const OWNERSHIP_TYPES = ["Digital", "Physical", "Subscription", "Borrowed"] as const;
export type OwnershipType = typeof OWNERSHIP_TYPES[number];
export type OwnershipFilter = OwnershipType | "Unspecified" | "";

export function parseOwnershipType(value: unknown): OwnershipType | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new InputError("Choose a valid ownership / access medium.");
  const clean = value.trim();
  if (!clean) return null;
  const match = OWNERSHIP_TYPES.find(type => type.toLowerCase() === clean.toLowerCase());
  if (!match) throw new InputError("Choose Digital, Physical, Subscription, Borrowed, or Unspecified.");
  return match;
}

export function readOwnershipField(data: FormData): { ownershipType?: OwnershipType | null } {
  return data.has("ownershipType") ? { ownershipType: parseOwnershipType(data.get("ownershipType")) } : {};
}

/** A provider-linked Steam title defaults to Digital only while its medium is unset. */
export function defaultOwnershipType(value: unknown, steamAppId?: unknown): OwnershipType | null {
  return parseOwnershipType(value) ?? (typeof steamAppId === "string" && /^[1-9]\d{0,19}$/.test(steamAppId) ? "Digital" : null);
}

export function matchesOwnership(game: { ownershipType?: OwnershipType | null }, filter: OwnershipFilter): boolean {
  return filter === "" || (filter === "Unspecified" ? game.ownershipType == null : game.ownershipType === filter);
}
