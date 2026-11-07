import { InputError } from "@/lib/action-result";

export const MICRO_REVIEW_LIMIT = 280;

/** Plain text only: React/SVG escapes markup when displaying it. */
export function normalizeMicroReview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new InputError("Micro-review must be plain text.");
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length > MICRO_REVIEW_LIMIT) throw new InputError(`Micro-review must be at most ${MICRO_REVIEW_LIMIT} characters.`);
  return clean || null;
}

/** Missing fields preserve saved reviews in metadata, queue and quick-rating forms. */
export function readMicroReviewFields(data: FormData): { review?: string | null; reviewSpoiler?: boolean } {
  if (!data.has("review") && !data.has("reviewSpoiler")) return {};
  const flag = data.get("reviewSpoiler");
  if (flag !== null && flag !== "true" && flag !== "false" && flag !== "on") throw new InputError("Choose a valid spoiler setting.");
  if (!data.has("review")) return { reviewSpoiler: flag === "true" || flag === "on" };
  const review = normalizeMicroReview(data.get("review"));
  return { review, reviewSpoiler: Boolean(review) && (flag === "true" || flag === "on") };
}

/** SVG snapshots never contain the text of a spoiler review, even offscreen. */
export function dossierReviewQuote(game: { review?: string | null; reviewSpoiler?: boolean }): string | null {
  if (game.reviewSpoiler === true) return "SPOILER REVIEW · HIDDEN";
  if (!game.review) return null;
  if (game.reviewSpoiler !== false) return "SPOILER REVIEW · HIDDEN";
  const text = game.review.replace(/\s+/g, " ").trim();
  return `“${text.length > 43 ? `${text.slice(0, 42)}…` : text}”`;
}
