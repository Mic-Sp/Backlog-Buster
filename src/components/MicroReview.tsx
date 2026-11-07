"use client";

import { useId, useState } from "react";
import { MICRO_REVIEW_LIMIT } from "@/lib/micro-review";
import "./MicroReview.css";

type Review = { review?: string | null; reviewSpoiler?: boolean };

export function MicroReview({ review, reviewSpoiler }: Review) {
  if (!review) return null;
  return <ReviewContent key={`${reviewSpoiler}:${review}`} review={review} reviewSpoiler={reviewSpoiler !== false} />;
}

function ReviewContent({ review, reviewSpoiler }: { review: string; reviewSpoiler: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  const hidden = reviewSpoiler && !revealed;
  return <div className="micro-review" data-spoiler={reviewSpoiler}>
    <span className="micro-review-caption">Micro-review</span>
    <p id={id} className={hidden ? "micro-review-masked" : "micro-review-quote"}>{hidden ? "Spoiler review hidden" : `“${review}”`}</p>
    {reviewSpoiler && <button type="button" className="micro-review-toggle" aria-expanded={revealed} aria-controls={id} onClick={() => setRevealed(value => !value)}>{revealed ? "Hide Spoiler" : "Reveal Spoiler"}</button>}
  </div>;
}

export function MicroReviewEditor({ title, review = "", reviewSpoiler = false }: { title: string; review?: string | null; reviewSpoiler?: boolean }) {
  const [length, setLength] = useState((review ?? "").length);
  const id = useId();
  return <details className="micro-review-editor">
    <summary>{review ? "Edit micro-review" : "Add a micro-review"}</summary>
    <label htmlFor={id}>Personal verdict <span>· optional</span></label>
    <textarea id={id} name="review" aria-label={`Micro-review for ${title}`} aria-describedby={`${id}-help`} maxLength={MICRO_REVIEW_LIMIT} rows={3} defaultValue={review ?? ""} onInput={event => setLength(event.currentTarget.value.length)} placeholder="What stayed with you? A short verdict in your own words…" />
    <div className="micro-review-editor-meta">
      <label className="micro-review-spoiler"><input type="checkbox" name="reviewSpoiler" value="true" defaultChecked={reviewSpoiler} /> Contains Spoilers</label>
      <small aria-live="polite">{length}/{MICRO_REVIEW_LIMIT}</small>
    </div>
    <small id={`${id}-help`}>Shared with friends and on your dossier. Field logs and quest journal notes stay private. Clear the text and save to remove it from this game.</small>
  </details>;
}
