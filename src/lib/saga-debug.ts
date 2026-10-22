import { explainChronologyMatch, type CanonicalGame } from "@/lib/chronology-titles";
import { isReleasedYear } from "@/lib/game-release";

export type SagaGeminiPayload = {
  candidates: { title: string; originalReleaseYear: number | null }[];
  attemptedAt: string | null;
  requestBody: string | null;
  rawResponse: string | null;
  rawTimeline: string | null;
  httpStatus: number | null;
  truncated: boolean;
  redacted: boolean;
};

export type SagaCacheSnapshot = {
  status: "hit" | "miss" | "refreshed" | "refresh-deferred" | "fallback";
  source: string;
  updatedAt: string | null;
  canonicalGames: CanonicalGame[];
  geminiError?: string;
  geminiPayload?: SagaGeminiPayload;
};
export type SagaChronologyDebug = SagaCacheSnapshot & {
  mappings: {
    id: number;
    title: string;
    releaseYear: number | null;
    matchedTitle: string | null;
    anchorYear: number | null;
    canonicalRank: number | null;
    assignedRank: number | null;
    reason: string;
  }[];
};

export function buildSagaChronologyDebug(
  snapshot: SagaCacheSnapshot,
  games: { id: number; title: string; releaseYear: number | null; chronologicalOrder: number | null }[],
  localFallback = false,
): SagaChronologyDebug {
  return {
    ...snapshot,
    ...(localFallback ? { status: "fallback" as const, source: "fallback" } : {}),
    mappings: games.map(game => {
      const { match, reason } = explainChronologyMatch(snapshot.canonicalGames, game);
      return {
        id: game.id, title: game.title, releaseYear: game.releaseYear,
        matchedTitle: match?.title ?? null, anchorYear: match?.releaseYear ?? null,
        canonicalRank: match?.chronologicalRank ?? null, assignedRank: game.chronologicalOrder,
        reason: !isReleasedYear(game.releaseYear)
          ? `${reason} Unreleased or undated: release order tail after ranked games.`
          : localFallback ? `${reason} Assigned sequentially by local release-year / normalized-title order.`
          : !match && game.chronologicalOrder == null ? `${reason} Release order tail after ranked games.` : reason,
      };
    }),
  };
}
