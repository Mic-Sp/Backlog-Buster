import { z } from "zod";
import { InputError } from "@/lib/action-result";

export const hypeLevelSchema = z.number().int().min(1).max(3).default(2);

// Shared by creation forms and JSON mutations. PATCH requires an explicit value
// so an omitted field can never reset a player's choice to the creation default.
export const gameHypeSchema = z.strictObject({ hypeLevel: hypeLevelSchema });
export const gameHypePatchSchema = z.strictObject({ hypeLevel: hypeLevelSchema.removeDefault() });

export function readHypeField(data: FormData): { hypeLevel?: number } {
  if (!data.has("hypeLevel")) return {};
  const raw = data.get("hypeLevel");
  const parsed = gameHypePatchSchema.safeParse({
    hypeLevel: typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw,
  });
  if (!parsed.success) throw new InputError("Hype level must be a whole number from 1 to 3.");
  return parsed.data;
}
