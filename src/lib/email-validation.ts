export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// Keep registration, self-service credential changes and admin updates aligned.
export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
