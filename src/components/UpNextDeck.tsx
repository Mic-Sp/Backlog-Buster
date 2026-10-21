"use client";

import { unwrapActionResult } from "@/lib/action-result";

import SafeForm from "@/components/SafeForm";

import { useEffect, useOptimistic, useRef, useState, useTransition, type DragEvent } from "react";
import { assignDeckSlot, startGame, swapDeckSlot } from "@/app/actions";
import type { LibraryGame } from "@/components/GameLibrary";
import DeckPinButton from "@/components/DeckPinButton";
import { DECK_CAPACITY, DECK_DRAG_TYPE, readDeckDrag, type DeckDragGame } from "@/lib/deck";
import { isReleasedYear } from "@/lib/game-release";
import "./DeckReorder.css";

export default function UpNextDeck({ games, draggedGame, onDragGameChange, onDragPointerDown, onGameDragStart, disabled = false, startAction = startGame }: {
  games: LibraryGame[];
  draggedGame: DeckDragGame | null;
  onDragGameChange: (game: DeckDragGame | null) => void;
  onDragPointerDown: (game: DeckDragGame, fromControl: boolean) => void;
  onGameDragStart: (event: DragEvent<HTMLFormElement>, game: DeckDragGame) => void;
  disabled?: boolean;
  startAction?: (data: FormData) => Promise<unknown>;
}) {
  const [isSwapping, startSwapping] = useTransition();
  const swappingRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const focusRef = useRef<{ id: number; direction: number } | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [optimisticGames, moveOptimistically] = useOptimistic<LibraryGame[], { id: number; slot: number; source: DeckDragGame["source"] }>(games, (current, move) => {
    const source = current.find((game) => game.id === move.id && game.status === "Backlog");
    if (!source) return current;
    return current.map((game) => {
      if (game.id === move.id) return { ...game, pinnedOrder: move.slot };
      if (game.status === "Backlog" && game.pinnedOrder === move.slot) return { ...game, pinnedOrder: move.source === "deck" ? source.pinnedOrder : null };
      return game;
    });
  });
  const pinned = optimisticGames.filter((game) => game.status === "Backlog" && game.pinnedOrder != null);
  const busy = isSwapping || disabled;
  const dragSource = games.find((game) => game.id === draggedGame?.gameId && game.status === "Backlog");
  const acceptsDrop = !busy && dragSource != null && isReleasedYear(dragSource.releaseYear) &&
    (draggedGame?.source === "table" || dragSource.pinnedOrder != null);

  useEffect(() => {
    if (isSwapping || !focusRef.current) return;
    const { id, direction } = focusRef.current;
    focusRef.current = null;
    if (document.activeElement !== document.body) return;
    const controls = sectionRef.current?.querySelectorAll<HTMLButtonElement>(`[data-deck-game-id="${id}"] .deck-slot-controls button:not(:disabled)`);
    const target = Array.from(controls ?? []).find((button) => button.dataset.direction === String(direction)) ?? controls?.[0];
    target?.focus();
  }, [isSwapping, games]);

  function moveSlot(game: LibraryGame, direction: number) {
    if (busy || swappingRef.current || game.pinnedOrder == null) return;
    const slot = game.pinnedOrder + direction;
    if (slot < 1 || slot > DECK_CAPACITY) return;
    focusRef.current = { id: game.id, direction };
    saveSlot(game, slot, "deck");
  }

  function saveSlot(game: LibraryGame, slot: number, source: DeckDragGame["source"]) {
    if (busy || swappingRef.current || game.pinnedOrder === slot || !isReleasedYear(game.releaseYear)) return;
    swappingRef.current = true;
    setNotice(null);
    startSwapping(async () => {
      moveOptimistically({ id: game.id, slot, source });
      try {
        if (source === "deck") unwrapActionResult(await swapDeckSlot(game.id, slot));
        else unwrapActionResult(await assignDeckSlot(game.id, slot));
        setNotice({ text: `${game.title} ${source === "deck" ? "moved" : "pinned"} to Slot ${String(slot).padStart(2, "0")}.`, error: false });
      } catch {
        setNotice({ text: "Could not save your deck order. The previous slots have been restored; refresh and try again.", error: true });
      } finally {
        swappingRef.current = false;
      }
    });
  }

  function endDeckDrag() {
    setHoveredSlot(null);
    onDragGameChange(null);
  }

  function dropIntoSlot(event: DragEvent<HTMLLIElement>, slot: number) {
    if (!acceptsDrop) return;
    event.preventDefault();
    event.stopPropagation();
    const drag = readDeckDrag(event.dataTransfer);
    const matchesSource = drag?.gameId === draggedGame?.gameId && drag?.source === draggedGame?.source;
    endDeckDrag();
    if (matchesSource && dragSource && drag) saveSlot(dragSource, slot, drag.source);
  }

  return (
    <section className="up-next-deck" aria-labelledby="deck-title" ref={sectionRef}>
      <div className="deck-heading">
        <h3 id="deck-title">ON DECK // UP NEXT</h3>
        <span>{pinned.length} / {DECK_CAPACITY} SLOTS</span>
      </div>
      <ol className="deck-grid">
        {Array.from({ length: DECK_CAPACITY }, (_, index) => {
          const slot = index + 1;
          const game = pinned.find((entry) => entry.pinnedOrder === slot);
          return (
            <li
              key={slot}
              data-deck-slot={slot}
              aria-label={`On Deck Slot ${String(slot).padStart(2, "0")}: ${game?.title ?? "Empty"}`}
              data-drop-active={acceptsDrop || undefined}
              data-drop-hover={(acceptsDrop && hoveredSlot === slot) || undefined}
              onDragOver={(event) => {
                if (!acceptsDrop || !event.dataTransfer.types.includes(DECK_DRAG_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setHoveredSlot(slot);
              }}
              onDragLeave={(event) => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setHoveredSlot((current) => current === slot ? null : current);
              }}
              onDrop={(event) => dropIntoSlot(event, slot)}
            >
              {game ? (
                <SafeForm
                  action={startAction}
                  className="deck-card"
                  data-deck-game-id={game.id}
                  aria-busy={busy}
                  draggable={!busy}
                  onPointerDownCapture={(event) => {
                    onDragPointerDown({ gameId: game.id, source: "deck" }, event.target instanceof Element && Boolean(event.target.closest("button, input, select, textarea, a, summary, [contenteditable='true']")));
                  }}
                  onDragStart={(event) => {
                    if (busy || swappingRef.current) event.preventDefault();
                    else onGameDragStart(event, { gameId: game.id, source: "deck" });
                  }}
                  onDragEnd={endDeckDrag}
                  key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}`}
                >
                  <input type="hidden" name="id" value={game.id} />
                  <input type="hidden" name="lengthHours" value={game.lengthHours} />
                  <input type="hidden" name="difficulty" value={game.difficulty} />
                  <div className="deck-slot-heading">
                    <p className="deck-slot-badge"><span className="deck-drag-grip" aria-hidden="true">⋮⋮ </span>SLOT {String(slot).padStart(2, "0")}</p>
                    <span className="deck-slot-controls">
                      <button type="button" data-direction="-1" disabled={busy || !isReleasedYear(game.releaseYear) || slot === 1} aria-label={`Move ${game.title} to previous deck slot`} title="Swap with previous slot" onClick={() => moveSlot(game, -1)}>◀</button>
                      <button type="button" data-direction="1" disabled={busy || !isReleasedYear(game.releaseYear) || slot === DECK_CAPACITY} aria-label={`Move ${game.title} to next deck slot`} title="Swap with next slot" onClick={() => moveSlot(game, 1)}>▶</button>
                    </span>
                  </div>
                  <div className="deck-game-info">
                    {game.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="deck-cover" src={game.coverUrl} alt={`${game.title} cover art`} width={64} height={86} loading="lazy" decoding="async" draggable={false} />
                    ) : <div className="deck-cover deck-no-cover" aria-hidden="true">NO COVER</div>}
                    <div>
                      <h4>{game.title}</h4>
                      <p>{game.platform} · {game.genre?.trim() || "Uncategorized"}</p>
                      <p>{game.lengthHours}h · <strong>{(game.lengthHours * game.difficulty * 10).toLocaleString("en-US")} POTENTIAL XP</strong></p>
                    </div>
                  </div>
                  <div className="deck-card-actions">
                    <button className="deck-start-button" type="submit" disabled={busy}>▶ START GIG</button>
                    <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={pinned.length} releaseYear={game.releaseYear} unpinOnly disabled={busy} />
                  </div>
                </SafeForm>
              ) : (
                <div className="deck-empty-slot">
                  <p className="deck-slot-badge">SLOT {String(slot).padStart(2, "0")}</p>
                  <span>[ + DROP GIG INTO SLOT {String(slot).padStart(2, "0")} ]</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {notice && <p className="deck-reorder-notice" role="status" data-error={notice.error}>{notice.text}</p>}
    </section>
  );
}
