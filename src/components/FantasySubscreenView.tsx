"use client";

import { FantasyCorners, NaviFairy, SlotBrackets } from "@/components/FantasyAccents";
import type { DragEvent, CSSProperties } from "react";
import type { GameLibraryController, LibraryGame } from "@/components/GameLibrary";
import FantasyEquipmentDeck from "@/components/FantasyEquipmentDeck";
import DeckPinButton from "@/components/DeckPinButton";
import SafeForm, { SafeActionButton } from "@/components/SafeForm";
import StarRatingInput from "@/components/StarRatingInput";
import AgentBriefing from "@/components/AgentBriefing";
import { SagaBadge, SagaOrderControls } from "@/components/SagaChains";
import { SagaChronologyDebuggerView } from "@/components/SagaChronologyDebugger";
import { useSubscreen } from "@/components/WorkspaceShell";
import { useUIEffects } from "@/components/ThemeProvider";
import { gameRecordKey } from "@/lib/game-record";
import { buildTrailerUrl } from "@/lib/trailers";

const views = ["Backlog", "Playing", "Completed", "Flatlined", "All"] as const;
const sorts = [
  ["default", "Quest order"], ["custom-priority", "Backlog priority"], ["timeline-asc", "Saga timeline"], ["year-asc", "Oldest chronicle"], ["year-desc", "Newest chronicle"],
  ["title-asc", "Title: A–Z"], ["title-desc", "Title: Z–A"], ["rating-desc", "Highest rated"], ["rating-asc", "Lowest rated"], ["pinned-first", "Equipped first"],
  ["hours-asc", "Shortest journey"], ["hours-desc", "Longest journey"], ["xp-desc", "Highest XP"], ["xp-asc", "Lowest XP"], ["difficulty-desc", "Hardest quest"], ["difficulty-asc", "Easiest quest"],
  ["platform-asc", "Platform: A–Z"], ["platform-desc", "Platform: Z–A"], ["genre-asc", "Genre: A–Z"], ["genre-desc", "Genre: Z–A"], ["status-asc", "Status: active first"], ["status-desc", "Status: shelved first"],
];

function QuestRating({ rating }: { rating: number | null }) {
  return <span className="fantasy-heart-rating" aria-label={rating === null ? "Unrated" : `Rated ${rating} out of 5 stars`} title={rating === null ? "Unrated" : `${rating}/5`}>
    <span aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index} data-filled={index < (rating ?? 0)}>♥</span>)}</span>
  </span>;
}

export default function FantasySubscreenView({ controller: c }: { controller: GameLibraryController }) {
  const { advisor, roulette, vault } = c;
  const { triggerRef: advisorTriggerRef } = advisor;
  const { triggerRef: rouletteTriggerRef } = roulette;
  const { triggerRef: vaultTriggerRef } = vault;
  const { showPane } = useSubscreen();
  const { playSfx } = useUIEffects();
  const selected = c.visibleGames.find(game => game.id === c.selectedGameId) ?? c.visibleGames[0];
  function selectGame(game: LibraryGame) {
    if (game.id !== (c.selectedGameId ?? selected?.id)) playSfx("click");
    c.setSelectedGameId(game.id);
  }
  function selectSaga(key: string) { c.selectSaga(key); showPane("chronicle"); }
  function dragOver(event: DragEvent<HTMLElement>, game: LibraryGame) { c.dragOverLibraryGame(event, game.id); }
  const unlocked = c.achievements.filter(achievement => achievement.unlocked);

  return <>
    <header className="fantasy-library-heading">
      <div><p className="fantasy-kicker">THE ROYAL ADVENTURER’S ARCHIVE</p><h2 id="collection-title">Your Quest Journal</h2><p>{c.games.length} stories gathered · {c.viewCounts.Completed} adventures completed</p></div>
      <div className="fantasy-tool-bar" aria-label="Royal archive tools">
        <button type="button" className="fantasy-fairy-button" ref={advisorTriggerRef} aria-haspopup="dialog" aria-expanded={advisor.isOpen} onClick={advisor.openAdvisor} disabled={advisor.isFetching || advisor.isScouting}><NaviFairy /> NAVI // SEEK GUIDANCE</button>
        <button type="button" ref={rouletteTriggerRef} aria-haspopup="dialog" aria-expanded={roulette.isOpen} onClick={roulette.open}><span aria-hidden="true">▣</span> ROLL RANDOM QUEST</button>
        <button type="button" ref={vaultTriggerRef} aria-haspopup="dialog" aria-expanded={vault.isOpen} onClick={vault.open}><span aria-hidden="true">♜</span> ROYAL ARCHIVE</button>
        {c.children}
      </div>
    </header>

    <section className="fantasy-quest-pane fantasy-panel" data-workspace-pane="quest" aria-label="Quest status and medallions"><FantasyCorners />
      <section className="fantasy-medallions" aria-labelledby="fantasy-medallions-title"><div className="fantasy-section-heading"><div><p className="fantasy-kicker">TOKENS OF YOUR TRAVELS</p><h3 id="fantasy-medallions-title">Sage Medallions</h3></div><span>{unlocked.length} / {c.achievements.length} awakened</span></div>
        {c.achievements.length ? <ul className="fantasy-medallion-grid">{c.achievements.map((achievement, index) => <li key={achievement.key} data-unlocked={achievement.unlocked} style={{ "--medallion-hue": `${index * 47 % 360}` } as CSSProperties}>
          <span className="fantasy-medallion" aria-hidden="true">{achievement.unlocked ? achievement.icon : "◇"}</span><h4>{achievement.title}</h4><p>{achievement.description}</p><small>{achievement.unlocked ? `Awakened · +${achievement.xpAwarded} XP` : `${achievement.current} / ${achievement.target} · sleeping`}</small>
        </li>)}</ul> : <p className="fantasy-hint">Your first medallion awaits. Complete quests to awaken your collection.</p>}
      </section>
      <FantasyEquipmentDeck deck={c.deck} />
    </section>

    <section className="fantasy-item-pane fantasy-panel" data-workspace-pane="items" aria-labelledby="fantasy-inventory-title"><FantasyCorners />
      <div className="fantasy-section-heading"><div><p className="fantasy-kicker">ITEM SUBSCREEN</p><h3 id="fantasy-inventory-title">The Adventurer’s Inventory</h3></div><span role="status">{c.visibleGames.length} / {c.games.length} quests</span></div>
      <div className="fantasy-status-tabs" role="group" aria-label="Library view">{views.map(view => <button key={view} type="button" data-ui-sound="custom" aria-pressed={c.activeView === view} onClick={() => c.changeView(view)}>{view === "Flatlined" ? "Abandoned" : view} <span>{c.viewCounts[view]}</span></button>)}</div>
      <div className="fantasy-scroll-filters">
        <label>Search quests<input type="search" value={c.searchQuery} placeholder="Find a title, realm, or genre…" onChange={event => c.setSearchQuery(event.target.value)} /></label>
        <label>Realm<select value={c.platformFilter} onChange={event => c.setPlatformFilter(event.target.value)}><option value="">All platforms</option>{c.platforms.map(platform => <option key={platform}>{platform}</option>)}</select></label>
        <label>Discipline<select value={c.genreFilter} onChange={event => c.setGenreFilter(event.target.value)}><option value="">All genres</option>{c.genres.map(genre => <option key={genre}>{genre}</option>)}</select></label>
        <label>Arrange<select aria-label="Sort games" value={c.sortBy} onChange={event => c.setSortBy(event.target.value)}>{sorts.filter(([value]) => value !== "custom-priority" || c.activeView === "Backlog" && !c.selectedSaga).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {c.hasActiveFilters && <button type="button" onClick={c.clearFilters}>Clear filters</button>}
      </div>
      {c.backlogNotice && <p className="fantasy-notice" role="status" data-error={c.backlogNotice.error}>{c.backlogNotice.text}</p>}
      {c.deckReturnNotice && <p className="fantasy-notice" role="status" data-error={c.deckReturnNotice.error}>{c.deckReturnNotice.text}</p>}
      <div className="fantasy-inventory-return" data-deck-return-active={c.canReturnToBacklog || undefined} data-deck-return-hover={c.backlogReturnHover || undefined} onDragOver={c.dragOverBacklog} onDragLeave={c.leaveBacklog} onDrop={c.dropDeckIntoBacklog} aria-busy={c.rowReorderBusy}>
        <ul className="fantasy-inventory-grid" aria-label="Quest inventory slots">{c.visibleGames.map(game => <li key={game.id}
          data-library-game-id={game.id} data-reorder-row-id={game.id} data-status={game.status} data-selected={selected?.id === game.id} data-equipped={game.pinnedOrder !== null} data-active={game.status === "Playing"}
          data-dragging={c.dragSourceId === game.id || undefined} data-drop-target={c.dropTargetId === game.id || c.backlogReturnTarget === game.id || undefined}
          draggable={(c.isReorderableRow(game.id) || c.canDragToDeck(game)) && !c.rowReorderBusy}
          onPointerDownCapture={event => c.rememberDragOrigin({ gameId: game.id, source: "table" }, event.target instanceof Element && Boolean(event.target.closest(".fantasy-inventory-quick-pin")))} onDragStart={event => c.startLibraryDrag(event, { gameId: game.id, source: "table" })} onDragEnd={c.endRowDrag}
          onDragOver={event => dragOver(event, game)} onDragLeave={event => c.leaveLibraryGame(event, game.id)} onDrop={event => c.dropRowGame(event, game.id)}>
          <button type="button" className="fantasy-inventory-slot" data-ui-sound="custom" aria-pressed={selected?.id === game.id} aria-label={`Inspect ${game.title}${game.pinnedOrder !== null ? `, equipped C-Button ${game.pinnedOrder}` : ""}${game.status === "Playing" ? ", active quest" : ""}`} onClick={() => selectGame(game)} onMouseEnter={() => selectGame(game)} onFocus={() => selectGame(game)}>
            {game.coverUrl ?
              // eslint-disable-next-line @next/next/no-img-element
              <img src={game.coverUrl} alt="" loading="lazy" decoding="async" width={160} height={160} draggable={false} /> : <span className="fantasy-item-icon" aria-hidden="true">{game.status === "Completed" ? "♜" : game.status === "Flatlined" ? "☠" : "⚔"}</span>}
            <span className="fantasy-slot-title">{game.title}</span><span className="fantasy-slot-status">{game.pinnedOrder !== null ? `C ${game.pinnedOrder} · Equipped` : game.status === "Playing" ? "Active quest" : game.status === "Backlog" && !c.canDragToDeck(game) ? "Sealed · Unreleased" : game.status}</span>
            <QuestRating rating={game.rating} />
          </button>
          {c.canDragToDeck(game) && <span className="fantasy-inventory-quick-pin" onClick={event => event.stopPropagation()} onFocus={() => selectGame(game)}>
            <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={c.pinnedCount} releaseYear={game.releaseYear} disabled={c.rowReorderBusy} />
          </span>}
          <SlotBrackets />
        </li>)}</ul>
        {c.visibleGames.length === 0 && <p className="fantasy-empty-inventory">{c.games.length === 0 ? "Your satchel is empty. Inscribe your first quest in the Chronicle." : "No quests match this scroll. Clear your filters to reveal more."}</p>}
        {c.canReturnToBacklog && <p className="fantasy-drop-hint">Release your equipped quest here to return it to the Backlog.</p>}
      </div>
      {selected ? <FantasyQuestDialogue controller={c} game={selected} onSelectSaga={selectSaga} key={gameRecordKey(selected)} /> : <div className="fantasy-dialogue fantasy-dialogue-empty"><span aria-hidden="true">◇</span><p>Select a quest to read its story and choose your next action.</p></div>}
    </section>

    <section className="fantasy-chronicle-pane fantasy-panel" data-workspace-pane="chronicle" aria-labelledby="fantasy-chronicle-title"><FantasyCorners />
      <div className="fantasy-section-heading"><div><p className="fantasy-kicker">CHRONICLE & INSCRIBE</p><h3 id="fantasy-chronicle-title">The Hylian Chronicle</h3></div><span aria-hidden="true">◇ ─ ◇ ─ ◇</span></div>
      <label className="fantasy-saga-select">Open a saga scroll<select aria-label="Filter by saga" value={c.selectedSaga?.key ?? ""} onChange={event => c.selectSaga(event.target.value)}><option value="">Choose a saga…</option>{c.chains.map(chain => <option value={chain.key} key={chain.key}>{chain.name} · {chain.completed}/{chain.total} cleared</option>)}</select></label>
      {c.selectedSaga ? <>
        <div className="fantasy-map-heading"><h4>{c.selectedSaga.name}</h4><SagaOrderControls {...c.sagaOrderControls} /></div>
        <p className="fantasy-hint">Follow the dungeon’s path in release or story order. Drag a floor to reorder its timeline, or use its arrows. Hidden quests keep their positions.</p>
        {c.sagaNotice?.key === c.selectedSaga.key && <p role="status" className="fantasy-notice" data-error={c.sagaNotice.error}>{c.sagaNotice.text}</p>}
        <ol className="fantasy-dungeon-map" aria-label={`${c.selectedSaga.name} saga timeline`}>{c.visibleGames.map((game, index) => <li key={game.id} data-reorder-row-id={game.id} data-library-game-id={game.id} data-cleared={game.status === "Completed"} data-drop-target={c.dropTargetId === game.id || undefined} draggable={c.inTimelineView && !c.rowReorderBusy}
          onPointerDownCapture={event => c.rememberDragOrigin({ gameId: game.id, source: "table" }, event.target instanceof Element && Boolean(event.target.closest("button, a")))}
          onDragStart={event => c.startLibraryDrag(event, { gameId: game.id, source: "table" })} onDragOver={event => dragOver(event, game)} onDragLeave={event => c.leaveLibraryGame(event, game.id)} onDragEnd={c.endRowDrag} onDrop={event => c.dropRowGame(event, game.id)}>
          <span className="fantasy-floor-number">{String(index + 1).padStart(2, "0")}F</span><div><strong>{game.title}</strong><p>{game.releaseYear ?? "Year unknown"} · {game.status} · {game.chronologicalOrder === null ? "Unassigned timeline" : `Canon rank ${game.chronologicalOrder}`}</p></div><button type="button" onClick={() => { c.setSelectedGameId(game.id); showPane("items"); }}>Inspect quest</button>
          {c.inTimelineView && <QuestReorderControls controller={c} game={game} />}
        </li>)}</ol>
        {c.visibleGames.length === 0 && <p className="fantasy-hint">No saga quests match your current inventory filters. Clear filters or choose this saga again.</p>}
        {c.isAdmin && <SagaChronologyDebuggerView controller={c.debuggerController} />}
      </> : <p className="fantasy-hint">Choose a saga to reveal its dungeon map. Assign a franchise in Edit Metadata to connect your quests.</p>}
      <p className="fantasy-inscribe-pointer">✎ Continue below to inscribe a new quest in your journal.</p>
    </section>
  </>;
}

function QuestReorderControls({ controller: c, game }: { controller: GameLibraryController; game: LibraryGame }) {
  const timeline = c.inTimelineView;
  const position = (timeline ? c.visibleTimelinePositions : c.visibleBacklogPositions).get(game.id) ?? -1;
  const count = timeline ? c.visibleGames.length : c.visibleBacklogIds.length;
  if (!timeline && (!c.canReorderBacklog || game.pinnedOrder !== null)) return null;
  return <div className="fantasy-reorder-controls" role="group" aria-label={`${timeline ? "Timeline" : "Backlog priority"} for ${game.title}`}>
    <button type="button" data-reorder-game-id={game.id} data-reorder-direction="-1" disabled={c.rowReorderBusy || position <= 0} aria-label={`Move ${game.title} up in ${timeline ? "saga timeline" : "Backlog priority"}`} onClick={() => timeline ? c.swapTimelineGame(game.id, -1) : c.swapBacklogGame(game.id, -1)}>▲</button>
    <span>{timeline ? "Timeline" : "Priority"} {position + 1}</span>
    <button type="button" data-reorder-game-id={game.id} data-reorder-direction="1" disabled={c.rowReorderBusy || position < 0 || position >= count - 1} aria-label={`Move ${game.title} down in ${timeline ? "saga timeline" : "Backlog priority"}`} onClick={() => timeline ? c.swapTimelineGame(game.id, 1) : c.swapBacklogGame(game.id, 1)}>▼</button>
  </div>;
}

function FantasyQuestDialogue({ controller: c, game, onSelectSaga }: { controller: GameLibraryController; game: LibraryGame; onSelectSaga: (key: string) => void }) {
  const draft = c.getGameDraft(game);
  const saga = c.byGameId.get(game.id);
  return <section className="fantasy-dialogue" aria-label={`Quest details for ${game.title}`}>
    <div className="fantasy-dialogue-heading"><span className="fantasy-dialogue-gem" aria-hidden="true">◆</span><div><p className="fantasy-kicker">YOU FOUND A QUEST</p><h4>{game.title}</h4><p>{game.platform} · {game.genre?.trim() || "Unknown discipline"} · {game.releaseYear ?? "Year unknown"} · {game.status === "Flatlined" ? "Abandoned" : game.status}</p></div><QuestRating rating={game.rating} /></div>
    <div className="fantasy-quest-facts"><span>{game.hoursPlayed} / {game.lengthHours}h played</span><span>Difficulty {game.difficulty}</span><span>{game.status === "Completed" ? game.earnedXp : game.status === "Flatlined" ? 0 : game.lengthHours * game.difficulty * 10} {game.status === "Completed" ? "XP earned" : "potential XP"}</span>{game.wasFlatlined && <span>Revived from abandonment</span>}</div>
    {saga && <SagaBadge saga={saga} onSelect={onSelectSaga} />}
    <QuestReorderControls controller={c} game={game} />
    {game.status === "Playing" && <div className="fantasy-session-log"><span>Record your journey</span><button type="button" disabled={c.isLogging} onClick={() => c.logSession(game.id, 1)}>+1H</button><button type="button" disabled={c.isLogging} onClick={() => c.logSession(game.id, 2)}>+2H</button>{c.sessionError?.gameId === game.id && <p role="alert">{c.sessionError.message}</p>}</div>}
    <SafeForm className="fantasy-quest-editor" action={c.actions.updateGame} data-game-editor-id={game.id}>
      <input type="hidden" name="id" value={game.id} />
      <div className="fantasy-editor-fields">
        <label>Status<select name="status" defaultValue={draft.status} aria-label={`Status for ${game.title}`}>{views.filter(view => view !== "All").map(status => <option key={status} value={status}>{status === "Flatlined" ? "Abandoned" : status}</option>)}</select></label>
        <label>Est. hours<input name="lengthHours" type="number" min="1" max="10000" step="1" defaultValue={draft.lengthHours} required aria-label={`Hours for ${game.title}`} /></label>
        <label>Hours played<input name="hoursPlayed" type="number" min="0" max="10000" step="1" defaultValue={draft.hoursPlayed} required aria-label={`Hours played for ${game.title}`} /></label>
        <label>Difficulty<select name="difficulty" defaultValue={draft.difficulty} aria-label={`Difficulty for ${game.title}`}><option value="1">1 · Easy</option><option value="2">2 · Medium</option><option value="3">3 · Tough</option></select></label>
      </div>
      <StarRatingInput glyph="heart" defaultValue={draft.rating === "" ? null : Number(draft.rating)} label={`Rating for ${game.title}`} onChange={rating => c.setGameDraftRating(game, rating)} />
      <label className="fantasy-journal-notes">Quest journal<textarea name="notes" maxLength={1000} rows={2} defaultValue={draft.notes} placeholder="Your latest checkpoint, discoveries, and tales…" /></label>
      <div className="fantasy-quest-actions">
        <button type="submit">Save record</button>
        {(game.status === "Backlog" || game.status === "Flatlined") && <SafeActionButton type="submit" formAction={c.startGameAndShowPlaying}>{game.status === "Flatlined" ? "Revive quest" : "Begin quest"}</SafeActionButton>}
        {game.status === "Playing" && <><SafeActionButton type="submit" formAction={c.completeGameWithSound}>Complete quest</SafeActionButton><SafeActionButton type="submit" formAction={c.actions.flatlineGame}>Abandon quest</SafeActionButton></>}
        <button type="button" data-metadata-trigger-id={game.id} onClick={() => c.openMetadata(game)}>Edit metadata</button>
        {game.status === "Backlog" && <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={c.pinnedCount} releaseYear={game.releaseYear} disabled={c.rowReorderBusy} />}
        <a href={buildTrailerUrl(game.title, game.releaseYear)} target="_blank" rel="noopener noreferrer">View trailer ↗</a>
        <SafeActionButton type="submit" formAction={c.actions.deleteGame} formNoValidate>Delete quest</SafeActionButton>
      </div>
    </SafeForm>
    {game.status === "Playing" && <AgentBriefing game={game} />}
  </section>;
}
