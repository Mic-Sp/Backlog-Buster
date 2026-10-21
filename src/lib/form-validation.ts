import { InputError } from "@/lib/action-result";

// Share the same normalization and bounds in browser forms and Server Actions.
export function validateGameForm(data: FormData, deleting = false) {
  if (!(data instanceof FormData)) throw new InputError("Please provide valid game details.");
  if (deleting) return;
  for (const [name, value] of data.entries()) {
    if (typeof value !== "string") throw new InputError("Please provide valid game details.");
    data.set(name, value.trim());
  }
  const text = (name: string) => String(data.get(name) ?? "");
  if (data.has("title") && !text("title")) throw new InputError("Please input a valid title.");
  for (const [name, limit] of [["title", 120], ["platform", 80], ["genre", 80], ["franchise", 120], ["coverUrl", 2048], ["notes", 1000]] as const) {
    if (text(name).length > limit) throw new InputError(`${name} must be at most ${limit} characters.`);
  }
  for (const [name, min, max] of [["lengthHours", 1, 10000], ["hoursPlayed", 0, 10000], ["difficulty", 1, 3], ["releaseYear", 1800, 2100], ["chronologicalOrder", 1, 10000], ["rating", 1, 5]] as const) {
    const value = text(name);
    if (value && (!Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)) {
      throw new InputError(`${name} must be a whole number from ${min} to ${max}.`);
    }
  }
  if (text("coverUrl")) {
    let url: URL;
    try { url = new URL(text("coverUrl")); } catch { throw new InputError("Use a valid HTTP or HTTPS cover image URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new InputError("Use a valid HTTP or HTTPS cover image URL.");
  }
}
