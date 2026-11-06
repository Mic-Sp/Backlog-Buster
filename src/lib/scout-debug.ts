// Serializable diagnostics only; collection and delivery are authorized by the Server Action.
export type ScoutAnchor = { title: string; rating: number | null };
export type ScoutVectorDebug = {
  status: "not-run" | "passed" | "failed";
  latencyMs: number | null;
  queryLatencyMs: number | null;
  vectorVersion: string | null;
  tasteSource: "completed-favorites" | "active-pinned" | "cold-start" | null;
  anchorCount: number;
  negativeAnchorCount: number;
  candidateCount: number;
  filteredCount: number;
  returnedCount: number;
  coverage: { total: number; embedded: number; current: number; released: number; eligible: number } | null;
  fallbackReason: string | null;
  picks: { title: string; cosineSimilarity: number; score: number;
    scores: { cosine: number; series: number; genre: number; playtime: number; negative: number } }[];
};
export type ScoutDebug = {
  requestedAt: string;
  source: "vector" | "live-ai" | "deterministic-fallback" | "mixed" | "none";
  engineSource: "vector" | "gemini-fallback" | "local-fallback" | "mixed" | "none";
  vector: ScoutVectorDebug;
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
  geminiCooldownSkipped: boolean;
  geminiCooldownRemainingSeconds: number;
  inputTokens: number;
  outputTokens: number;
  tokenBasis: "estimate" | "provider";
  estimatedCostUsd: number | null;
  attemptedCallCostUsd: number | null;
  promptPreview: string;
  responsePreview: string;
  picks: { title: string; source: "vector" | "live-ai" | "deterministic-fallback"; anchor?: ScoutAnchor }[];
};

export function createScoutVectorDebug(): ScoutVectorDebug {
  return { status: "not-run", latencyMs: null, queryLatencyMs: null, vectorVersion: null, tasteSource: null,
    anchorCount: 0, negativeAnchorCount: 0, candidateCount: 0, filteredCount: 0, returnedCount: 0, coverage: null, fallbackReason: null, picks: [] };
}

export function createScoutDebug(): ScoutDebug {
  return {
    requestedAt: new Date().toISOString(), source: "none", schemaStatus: "not-run",
    engineSource: "none", vector: createScoutVectorDebug(),
    playtimeStatus: "Not run; catalog/RAWG estimates are normalized with genre floors; Gemini estimates are not accepted.",
    fallbackTriggered: false, fallbackReason: null, validationIssues: [], anchors: [],
    excludedCount: 0, filteredCount: 0, metadataRejectedCount: 0, model: null,
    liveCallAttempted: false, geminiCooldownSkipped: false, geminiCooldownRemainingSeconds: 0,
    inputTokens: 0, outputTokens: 0, tokenBasis: "estimate",
    estimatedCostUsd: 0, attemptedCallCostUsd: 0, promptPreview: "", responsePreview: "", picks: [],
  };
}

// Paid standard text rates, USD per million tokens. Unknown model overrides stay unknown.
// https://ai.google.dev/gemini-api/docs/pricing (verified 2026-10-22).
export function estimateScoutCost(model: string, input: number, output: number): number | null {
  if (model !== "gemini-3.5-flash-lite") return null;
  return (input * 0.30 + output * 2.50) / 1_000_000;
}
