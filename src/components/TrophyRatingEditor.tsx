"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateGame } from "@/app/actions";
import type { LibraryGame } from "@/components/GameLibrary";
import StarRatingInput from "@/components/StarRatingInput";

export default function TrophyRatingEditor({ game }: { game: LibraryGame }) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [isSaving, startSaving] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (isEditing) formRef.current?.querySelector<HTMLButtonElement>(".star-rating-button")?.focus();
    else if (wasEditing.current) triggerRef.current?.focus();
    wasEditing.current = isEditing;
  }, [isEditing]);

  function saveRating(formData: FormData) {
    if (isSaving) return;
    setError("");
    startSaving(async () => {
      try {
        await updateGame(formData);
        setIsEditing(false);
      } catch {
        setError("Could not save your rating. Please try again.");
        setRetryKey((key) => key + 1);
      }
    });
  }

  if (!isEditing) {
    return (
      <button
        className="trophy-rating trophy-rating-trigger"
        type="button"
        ref={triggerRef}
        data-rated={game.rating != null}
        aria-label={`Edit rating for ${game.title}${game.rating != null ? `: ${game.rating} out of 5 stars` : ": unrated"}`}
        aria-expanded={false}
        title="Click to rate this game"
        onClick={() => { setError(""); setIsEditing(true); }}
      >
        {game.rating != null ? (
          <><span className="trophy-rating-stars" aria-hidden="true">{"★".repeat(game.rating) + "☆".repeat(5 - game.rating)}</span> <span>{game.rating}/5</span></>
        ) : "UNRATED"}
      </button>
    );
  }

  return (
    <form
      className="trophy-quick-rating"
      ref={formRef}
      aria-label={`Rate ${game.title}`}
      key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}`}
      action={saveRating}
    >
      <input type="hidden" name="id" value={game.id} />
      <input type="hidden" name="status" value={game.status} />
      <input type="hidden" name="lengthHours" value={game.lengthHours} />
      <input type="hidden" name="difficulty" value={game.difficulty} />
      <fieldset disabled={isSaving}>
        <legend>{isSaving ? "Saving rating…" : "Personal rating"}</legend>
        <StarRatingInput
          key={retryKey}
          defaultValue={game.rating}
          label={`Rating for ${game.title}`}
          onChange={(rating) => {
            if (!formRef.current) return;
            const formData = new FormData(formRef.current);
            // React has not committed the hidden input's new value during this click.
            formData.set("rating", rating === null ? "" : String(rating));
            saveRating(formData);
          }}
        />
      </fieldset>
      {error && <p className="trophy-rating-error" role="alert">{error}</p>}
    </form>
  );
}
