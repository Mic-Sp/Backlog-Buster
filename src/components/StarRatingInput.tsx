"use client";

import { useState } from "react";

export default function StarRatingInput({ defaultValue, label = "Personal rating", onChange, glyph = "star" }: {
  glyph?: "star" | "heart";
  defaultValue: number | null;
  label?: string;
  onChange?: (rating: number | null) => void;
}) {
  const [rating, setRating] = useState(defaultValue ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const activeStars = hoverRating || rating;

  return (
    <div className="star-rating-selector" role="group" aria-label={label}>
      <input type="hidden" name="rating" value={rating > 0 ? rating : ""} />
      {[1, 2, 3, 4, 5].map((starValue) => (
        <button
          key={starValue}
          type="button"
          className="star-rating-button"
          data-filled={starValue <= activeStars}
          aria-label={`Rate ${starValue} out of 5 stars`}
          aria-pressed={rating === starValue}
          title={rating === starValue ? "Click again to clear rating" : `${starValue}/5`}
          onMouseEnter={() => setHoverRating(starValue)}
          onMouseLeave={() => setHoverRating(0)}
          onClick={() => {
            const nextRating = rating === starValue ? 0 : starValue;
            setRating(nextRating);
            onChange?.(nextRating > 0 ? nextRating : null);
          }}
        >
          {glyph === "heart" ? starValue <= activeStars ? "♥" : "♡" : starValue <= activeStars ? "★" : "☆"}
        </button>
      ))}
      <span className="star-rating-readout">{activeStars > 0 ? `${activeStars}/5` : "UNRATED"}</span>
    </div>
  );
}
