"use client";

import { useId } from "react";
import { journalDateLabel } from "@/lib/play-journal";
import "./PlayJournal.css";

type Dates = { startedAt?: string | null; completedAt?: string | null };

export function PlayJournalBadges({ startedAt, completedAt }: Dates) {
  const started = journalDateLabel(startedAt), completed = journalDateLabel(completedAt);
  if (!started && !completed) return null;
  return <div className="play-journal-badges" aria-label="Play journal">
    {started && <span>Started <time dateTime={startedAt!.slice(0, 10)}>{started}</time></span>}
    {completed && <span>Cleared <time dateTime={completedAt!.slice(0, 10)}>{completed}</time></span>}
  </div>;
}

export function PlayJournalEditor({ title, startedAt = "", completedAt = "", originalStartedAt = "", originalCompletedAt = "" }: Dates & { title: string; originalStartedAt?: string; originalCompletedAt?: string }) {
  const id = useId();
  return <fieldset className="play-journal-editor">
    <legend>Play Journal</legend>
    <input type="hidden" name="startedAtOriginal" value={originalStartedAt} />
    <input type="hidden" name="completedAtOriginal" value={originalCompletedAt} />
    <div className="play-journal-inputs">
      <label>Started<input type="date" name="startedAt" aria-label={`Start date for ${title}`} aria-describedby={`${id}-help`} defaultValue={startedAt?.slice(0, 10) ?? ""} min="0001-01-01" max="9999-12-31" /></label>
      <label>Completed<input type="date" name="completedAt" aria-label={`Completion date for ${title}`} aria-describedby={`${id}-help`} defaultValue={completedAt?.slice(0, 10) ?? ""} min="0001-01-01" max="9999-12-31" /></label>
    </div>
    <small id={`${id}-help`}>Start and completion actions fill missing dates. You can backdate or clear either field. Changing status preserves recorded history. Unknown import dates stay blank.</small>
  </fieldset>;
}
