"use client";

import { CButtonBadge } from "@/components/FantasyAccents";
import DeckPinButton from "@/components/DeckPinButton";
import SafeForm from "@/components/SafeForm";
import type { UpNextDeckController } from "@/components/UpNextDeck";
import { DECK_CAPACITY, DECK_DRAG_TYPE } from "@/lib/deck";
import { isReleasedYear } from "@/lib/game-release";

export default function FantasyEquipmentDeck({ deck }: { deck: UpNextDeckController }) {
  const { sectionRef } = deck;
  return <section className="fantasy-equipment" ref={sectionRef} aria-labelledby="fantasy-equipment-title">
    <div className="fantasy-section-heading"><div><p className="fantasy-kicker">READY FOR THE JOURNEY</p><h3 id="fantasy-equipment-title">Prepping For The Next Quest</h3></div><span>{deck.pinned.length} / {DECK_CAPACITY} equipped</span></div>
    <p className="fantasy-hint">Equip a released Backlog quest. Drag to a C-Button, or use its pin.</p>
    <ol className="fantasy-equipment-grid">
      {Array.from({ length: DECK_CAPACITY }, (_, index) => {
        const slot = index + 1;
        const game = deck.pinned.find(game => game.pinnedOrder === slot);
        return <li key={slot} data-deck-slot={slot} data-drop-active={deck.acceptsDrop || undefined} data-drop-hover={deck.hoveredSlot === slot || undefined}
          onDragOver={event => { if (!deck.acceptsDrop || !event.dataTransfer.types.includes(DECK_DRAG_TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; deck.setHoveredSlot(slot); }}
          onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) deck.setHoveredSlot(null); }}
          onDrop={event => deck.dropIntoSlot(event, slot)}>
          <CButtonBadge direction={["◀", "▼", "▶"][index]} />
          {game ? <SafeForm action={deck.startAction} className="fantasy-equipped-quest" data-deck-game-id={game.id} draggable={!deck.busy} aria-busy={deck.busy}
            onPointerDownCapture={event => deck.onDragPointerDown({ gameId: game.id, source: "deck" }, event.target instanceof Element && Boolean(event.target.closest("button, input, a")))}
            onDragStart={event => deck.startDeckDrag(event, game.id)} onDragEnd={deck.endDeckDrag}>
            <input type="hidden" name="id" value={game.id} /><input type="hidden" name="lengthHours" value={game.lengthHours} /><input type="hidden" name="difficulty" value={game.difficulty} />
            <span className="fantasy-equipped-art">{game.coverUrl ?
              // eslint-disable-next-line @next/next/no-img-element
              <img src={game.coverUrl} alt={`${game.title} cover`} loading="lazy" decoding="async" width={96} height={96} draggable={false} /> : <span aria-hidden="true">⚔</span>}</span>
            <h4>{game.title}</h4><p>{game.platform} · {game.lengthHours}h</p>
            <div className="fantasy-slot-order" role="group" aria-label={`Equipment order for ${game.title}`}>
              <button type="button" data-deck-direction="-1" disabled={deck.busy || !isReleasedYear(game.releaseYear) || slot === 1} aria-label={`Move ${game.title} to previous deck slot`} onClick={() => deck.moveSlot(game, -1)}>◀</button>
              <button type="button" data-deck-direction="1" disabled={deck.busy || !isReleasedYear(game.releaseYear) || slot === DECK_CAPACITY} aria-label={`Move ${game.title} to next deck slot`} onClick={() => deck.moveSlot(game, 1)}>▶</button>
            </div>
            <button type="submit" disabled={deck.busy}>Begin quest</button>
            <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={deck.pinned.length} releaseYear={game.releaseYear} disabled={deck.busy} unpinOnly />
          </SafeForm> : <div className="fantasy-empty-equipment"><span aria-hidden="true">◇</span><p>Empty C-Button</p><small>Drop a quest here</small></div>}
        </li>;
      })}
    </ol>
    {deck.notice && <p role="status" className="fantasy-notice" data-error={deck.notice.error}>{deck.notice.text}</p>}
  </section>;
}
