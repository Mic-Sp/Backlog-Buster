// Serializable diagnostics only; collection and delivery are authorized by the Server Action.
export type ScoutAnchor = { title: string; rating: number | null };
export type ScoutDebug = {
  requestedAt: string;
  source: "live-ai" | "deterministic-fallback" | "mixed" | "none";
  schemaStatus: "not-run" | "passed" | "failed";
  playtimeStatus: string;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  validationIssues: { path: string; message: string }[];
  anchors: ScoutAnchor[];
  excludedCount: number;
  filteredCount: number;
  metadataRejectedCount: number;
  model: string | null;
  liveCallAttempted: boolean;
  inputTokens: number;
  outputTokens: number;
  tokenBasis: "estimate" | "provider";
  estimatedCostUsd: number | null;
  attemptedCallCostUsd: number | null;
  promptPreview: string;
  responsePreview: string;
  picks: { title: string; source: "live-ai" | "deterministic-fallback"; anchor?: ScoutAnchor }[];
};

export function createScoutDebug(): ScoutDebug {
  return {
    requestedAt: new Date().toISOString(), source: "none", schemaStatus: "not-run",
    playtimeStatus: "Not run; playtime comes from RAWG, not Gemini (no 1–500-hour AI check).",
    fallbackTriggered: false, fallbackReason: null, validationIssues: [], anchors: [],
    excludedCount: 0, filteredCount: 0, metadataRejectedCount: 0, model: null,
    liveCallAttempted: false, inputTokens: 0, outputTokens: 0, tokenBasis: "estimate",
    estimatedCostUsd: 0, attemptedCallCostUsd: 0, promptPreview: "", responsePreview: "", picks: [],
  };
}

// Paid standard text rates, USD per million tokens. Unknown model overrides stay unknown.
// https://ai.google.dev/gemini-api/docs/pricing (verified 2026-10-22).
export function estimateScoutCost(model: string, input: number, output: number): number | null {
  if (model !== "gemini-3.5-flash-lite") return null;
  return (input * 0.30 + output * 2.50) / 1_000_000;
}
