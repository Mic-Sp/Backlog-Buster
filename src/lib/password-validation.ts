// Validate without trimming or normalizing the password that will be hashed.
export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128 && Boolean(value.trim());
}
