import "server-only";
import type { ScoutDebug } from "@/lib/scout-debug";

// Never capture headers, URLs containing credentials, provider error bodies, or thoughts.
// Redact configured secrets even if untrusted model output happens to echo one.
export function scoutDebugPreview(value: string): string {
  let redacted = value;
  for (const name of ["GEMINI_API_KEY", "RAWG_API_KEY", "IGDB_CLIENT_SECRET", "TWITCH_CLIENT_SECRET", "STEAM_API_KEY", "AUTH_SECRET", "DATABASE_URL"]) {
    const secret = process.env[name]?.trim();
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.replace(/AIza[\w-]{20,}/g, "[REDACTED]")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 3000);
}

/** Final transport projection, after the action's live admin recheck. Never serialize raw DB/provider errors. */
export function sanitizeScoutDebug(debug: ScoutDebug): ScoutDebug {
  const clean = (value: string | null) => value === null ? null : scoutDebugPreview(value);
  const anchor = (value: { title: string; rating: number | null }) => ({ ...value, title: scoutDebugPreview(value.title) });
  return { ...debug, playtimeStatus: scoutDebugPreview(debug.playtimeStatus), fallbackReason: clean(debug.fallbackReason),
    model: clean(debug.model), promptPreview: scoutDebugPreview(debug.promptPreview), responsePreview: scoutDebugPreview(debug.responsePreview),
    validationIssues: debug.validationIssues.slice(0, 12).map(issue => ({ path: scoutDebugPreview(issue.path), message: scoutDebugPreview(issue.message) })),
    anchors: debug.anchors.slice(0, 8).map(anchor),
    picks: debug.picks.slice(0, 3).map(pick => ({ ...pick, title: scoutDebugPreview(pick.title), ...(pick.anchor ? { anchor: anchor(pick.anchor) } : {}) })),
    vector: { ...debug.vector, vectorVersion: clean(debug.vector.vectorVersion), fallbackReason: clean(debug.vector.fallbackReason),
      anchors: debug.vector.anchors.slice(0, 8).map(value => ({ ...value, title: scoutDebugPreview(value.title) })),
      picks: debug.vector.picks.slice(0, 3).map(pick => ({ ...pick, title: scoutDebugPreview(pick.title) })) },
  };
}
