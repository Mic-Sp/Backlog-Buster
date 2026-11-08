"use client";

import { useFormStatus } from "react-dom";
import SafeForm from "@/components/SafeForm";
import { logGameReplay } from "@/app/actions";
import { useLayoutCopy } from "@/components/LayoutText";
import { completedRuns, MAX_PLAYTHROUGHS, replayLabel } from "@/lib/playthroughs";
import "./ReplayTracking.css";

type ReplayGame = { id: number; title: string; status: string; playthroughCount?: number };

export function ReplayBadge({ count, fantasy = false }: { count?: number; fantasy?: boolean }) {
  return (count ?? 0) > 1 ? <span className="replay-badge" data-fantasy={fantasy}>{replayLabel(count!, fantasy)}</span> : null;
}

export function ReplayCountEditor({ game, value }: { game: ReplayGame; value?: string }) {
  const count = completedRuns(game);
  return <label className="replay-count-editor">Completed runs
    <input type="hidden" name="playthroughCountOriginal" value={count} />
    <input name="playthroughCount" type="number" min={0} max={MAX_PLAYTHROUGHS} step="1"
      defaultValue={value ?? count} required aria-label={`Completed runs for ${game.title}`} />
    <small>Lifetime clears · a completed game has at least one.</small>
  </label>;
}

function ReplaySubmit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  const copy = useLayoutCopy();
  return <button type="submit" className="replay-log-button" disabled={pending || count >= MAX_PLAYTHROUGHS}>
    {pending ? copy("LOGGING CLEAR…", "CHRONICLING…") : count >= MAX_PLAYTHROUGHS ? "99 CLEARS LOGGED" : copy("⟳ LOG REPLAY / +1 CLEAR", "✧ CHRONICLE REPLAY / +1 CLEAR")}
  </button>;
}

export function ReplayLogForm({ game }: { game: ReplayGame }) {
  if (game.status !== "Completed") return null;
  return <SafeForm action={logGameReplay} className="replay-log-form" aria-label={`Log replay for ${game.title}`}>
    <input type="hidden" name="id" value={game.id} />
    <input type="hidden" name="expectedPlaythroughCount" value={completedRuns(game)} />
    <ReplaySubmit count={completedRuns(game)} />
  </SafeForm>;
}
