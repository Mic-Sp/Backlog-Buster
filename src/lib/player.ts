import "server-only";

// Replace this with the authenticated session's user ID when auth is connected.
// Server Actions resolve ownership here rather than trusting a submitted userId.
export function getCurrentPlayerId() {
  return "default-player";
}
