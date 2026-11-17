"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { GameLibraryController } from "@/components/GameLibrary";
import { MetadataFields } from "@/components/GameMetadataEditor";
import SafeForm, { SafeActionButton } from "@/components/SafeForm";
import HypeMeter from "@/components/games/HypeMeter";
import SteamProgress from "@/components/SteamProgress";
import { ReplayCountEditor } from "@/components/ReplayTracking";
import { PlayJournalEditor } from "@/components/PlayJournal";
import { MicroReviewEditor } from "@/components/MicroReview";
import StarRatingInput from "@/components/StarRatingInput";
import DeckPinButton from "@/components/DeckPinButton";
import { validSteamAppId } from "@/lib/steam-progress";
import { gameRecordKey } from "@/lib/game-record";
import { logGameReplay } from "@/app/actions";
import { completedRuns, MAX_PLAYTHROUGHS } from "@/lib/playthroughs";

export default function StandardGameDetails({ controller: c }: { controller: GameLibraryController }) {
  const game = c.editingMetaGame;
  return game ? <Details controller={c} key={gameRecordKey(game)} /> : null;
}

function Details({ controller: c }: { controller: GameLibraryController }) {
  const game = c.editingMetaGame!;
  const draft = c.getGameDraft(game);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState(draft.status);
  const position = (c.inTimelineView ? c.visibleTimelinePositions : c.visibleBacklogPositions).get(game.id) ?? -1;
  const count = c.inTimelineView ? c.visibleGames.length : c.visibleBacklogIds.length;
  const canReorder = c.inTimelineView || c.canReorderBacklog && game.pinnedOrder == null;
  return <div className="standard-details-backdrop" onClick={event => { if (event.target === event.currentTarget) c.closeMetadata(); }}>
    <SafeForm className="standard-game-details" role="dialog" aria-modal="true" aria-labelledby="metadata-modal-title" ref={c.metadataModalRef}
      data-game-editor-id={game.id} action={c.actions.updateGame} onSuccess={c.closeMetadata}>
      <header className="standard-details-header"><div><span>Game Details</span><h2 id="metadata-modal-title">{game.title}</h2><p>{game.platform} · {game.genre || "Uncategorized"}</p></div><button type="button" data-details-autofocus aria-label="Close game details" onClick={c.closeMetadata}>✕</button></header>
      <div className="standard-details-body">
        <input type="hidden" name="id" value={game.id} />
        <section className="standard-details-section" aria-label="Progress & rating"><h3>Progress &amp; rating</h3>
          <div className="standard-details-fields">
            <label>Status<select name="status" aria-label={`Status for ${game.title}`} value={status} onChange={event => setStatus(event.target.value)} required>{["Backlog", "Playing", "Completed", "Flatlined"].map(value => <option key={value} value={value}>{value === "Flatlined" ? "Dropped" : value}</option>)}</select></label>
            <label>Estimated hours<input name="lengthHours" type="number" min="1" max="10000" step="1" defaultValue={draft.lengthHours} required /></label>
            <label>Hours played<input name="hoursPlayed" type="number" min="0" max="10000" step="1" defaultValue={draft.hoursPlayed} required /></label>
            <label>Difficulty<select name="difficulty" defaultValue={draft.difficulty} required><option value="1">Easy</option><option value="2">Medium</option><option value="3">Hard</option></select></label>
            <div className="standard-details-hype"><span>Hype Level</span><HypeMeter gameId={game.id} hypeLevel={game.hypeLevel} title={game.title} /></div>
            <div className="standard-details-rating"><span>Your rating</span><StarRatingInput defaultValue={draft.rating === "" ? null : Number(draft.rating)} label={`Rating for ${game.title}`} onChange={rating => c.setGameDraftRating(game, rating)} /></div>
          </div>
          <ReplayCountEditor game={game} value={draft.playthroughCount} />
          <PlayJournalEditor title={game.title} startedAt={draft.startedAt} completedAt={draft.completedAt} originalStartedAt={game.startedAt?.slice(0, 10)} originalCompletedAt={game.completedAt?.slice(0, 10)} />
        </section>
        <section className="standard-details-section" aria-label="Review & notes"><h3>Review &amp; notes</h3>
          <MicroReviewEditor title={game.title} review={draft.review} reviewSpoiler={draft.reviewSpoiler === "true"} />
          <label className="standard-private-notes">Private notes<textarea name="notes" rows={3} maxLength={1000} defaultValue={draft.notes} placeholder="Your checkpoint, plans, or thoughts…" /></label>
        </section>
        <details className="standard-details-section"><summary>Game information</summary><MetadataFields game={game} formRef={c.metadataModalRef} /></details>
        <section className="standard-details-section" aria-label="Steam achievements"><h3>Steam achievements</h3>{validSteamAppId(game.steamAppId) ? <SteamProgress game={game} /> : <p>Import this game from Steam to link its achievements.</p>}</section>
        <section className="standard-details-section standard-details-queue" aria-label="Queue & actions"><h3>Queue &amp; actions</h3>
          {game.status === "Backlog" && <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={c.pinnedCount} releaseYear={game.releaseYear} />}
          {canReorder && <div className="standard-reorder" role="group" aria-label={c.inTimelineView ? "Series order" : "Backlog priority"}><span>{c.inTimelineView ? "Series position" : "Backlog position"}: {position + 1}</span>{[-1, 1].map(direction => <button type="button" key={direction} disabled={c.rowReorderBusy || position < 0 || direction === -1 && position === 0 || direction === 1 && position === count - 1} onClick={() => c.inTimelineView ? c.swapTimelineGame(game.id, direction) : c.swapBacklogGame(game.id, direction)}>{direction === -1 ? "Move earlier" : "Move later"}</button>)}</div>}
          {game.status === "Completed" && <><input type="hidden" name="expectedPlaythroughCount" value={completedRuns(game)} /><SafeActionButton type="submit" formAction={logGameReplay} disabled={completedRuns(game) >= MAX_PLAYTHROUGHS}>Log completed replay</SafeActionButton></>}
          {confirmDelete ? <div className="standard-delete-confirmation"><p>Delete “{game.title}” and its saved progress?</p><SafeActionButton className="standard-danger" type="submit" formAction={c.actions.deleteGame} formNoValidate>Delete permanently</SafeActionButton><button type="button" onClick={() => setConfirmDelete(false)}>Keep Game</button></div> : <button type="button" className="standard-delete-trigger" onClick={() => setConfirmDelete(true)}>Delete Game</button>}
        </section>
      </div>
      <footer className="standard-details-footer"><span>Hype changes save immediately.</span><button type="button" onClick={c.closeMetadata}>Close</button><SaveDetailsButton /></footer>
    </SafeForm>
  </div>;
}

function SaveDetailsButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="standard-primary" disabled={pending}>{pending ? "Saving…" : "Save Changes"}</button>;
}
