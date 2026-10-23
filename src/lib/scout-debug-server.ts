import "server-only";

// Never capture headers, URLs containing credentials, provider error bodies, or thoughts.
// Redact configured secrets even if untrusted model output happens to echo one.
export function scoutDebugPreview(value: string): string {
  let redacted = value;
  for (const name of ["GEMINI_API_KEY", "RAWG_API_KEY", "IGDB_CLIENT_SECRET", "AUTH_SECRET", "DATABASE_URL"]) {
    const secret = process.env[name]?.trim();
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(/AIza[\w-]{20,}/g, "[REDACTED]")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 3000);
}
