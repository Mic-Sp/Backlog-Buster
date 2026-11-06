// Shared by server request protection and client countdowns.
export const DEFAULT_COOLDOWN_SECONDS = 10;
// Scout scans themselves are unrestricted; only the paid discovery fallback uses this window.
export const SCOUT_GEMINI_COOLDOWN_SECONDS = 10;

export function cooldownLabel(seconds: number): string {
  return `COOLDOWN // ${String(Math.max(0, Math.ceil(seconds))).padStart(2, "0")}s`;
}
