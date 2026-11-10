"use client";

import { useRef, useState } from "react";
import type { GameLibraryController, LibraryGame } from "@/components/GameLibrary";
import { useSafeRoom } from "@/components/WorkspaceShell";
import { useUIEffects } from "@/components/ThemeProvider";
import { useLayoutCopy } from "@/components/LayoutText";
import CustomLists from "@/components/CustomLists";
import SafeForm, { SafeActionButton } from "@/components/SafeForm";
import { OwnershipBadge, OwnershipField, OwnershipFilterControl } from "@/components/Ownership";
import { PlayJournalBadges, PlayJournalEditor } from "@/components/PlayJournal";
import { MicroReview, MicroReviewEditor } from "@/components/MicroReview";
import { ReplayBadge, ReplayCountEditor, ReplayLogForm } from "@/components/ReplayTracking";
import { CommunityStatsReadout } from "@/components/CommunityGameStats";
import SteamProgress from "@/components/SteamProgress";
import AgentBriefing from "@/components/AgentBriefing";
import StarRatingInput from "@/components/StarRatingInput";
import DeckPinButton from "@/components/DeckPinButton";
import { SocialHubTrigger } from "@/components/SocialHub";
import { SagaOrderControls } from "@/components/SagaChains";
import { SagaChronologyDebuggerView } from "@/components/SagaChronologyDebugger";
import LibraryTelemetry from "@/components/LibraryTelemetry";
import RadarNotification from "@/components/RadarNotification";
import { gameRecordKey } from "@/lib/game-record";
import { DECK_CAPACITY, DECK_DRAG_TYPE } from "@/lib/deck";
import { buildTrailerUrl } from "@/lib/trailers";

const views = ["Backlog", "Playing", "Completed", "Flatlined", "All"] as const;
const statusName = (value: string) => value === "Flatlined" ? "Archived" : value === "Backlog" ? "Stored" : value === "Playing" ? "Deployed" : value === "Completed" ? "Cleared" : value;
const sorts = [["default", "Record order"], ["custom-priority", "Backlog priority"], ["title-asc", "Title A–Z"], ["title-desc", "Title Z–A"], ["completed-desc", "Recently cleared"], ["completed-asc", "Earliest cleared"], ["timeline-asc", "Saga timeline"], ["year-desc", "Newest release"], ["year-asc", "Oldest release"], ["rating-desc", "Highest rating"], ["rating-asc", "Lowest rating"], ["pinned-first", "Equipped first"], ["hours-asc", "Shortest operation"], ["hours-desc", "Longest operation"], ["xp-desc", "Highest XP"], ["xp-asc", "Lowest XP"], ["difficulty-asc", "Lowest difficulty"], ["difficulty-desc", "Highest difficulty"], ["platform-asc", "Platform A–Z"], ["platform-desc", "Platform Z–A"], ["genre-asc", "Genre A–Z"], ["genre-desc", "Genre Z–A"], ["status-asc", "Active first"], ["status-desc", "Stored first"]];

function ItemArt({ game }: { game: LibraryGame }) {
  return game.coverUrl ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={game.coverUrl} alt="" loading="lazy" decoding="async" width={140} height={140} draggable={false} /> : <span className="bio-item-placeholder" aria-hidden="true">{game.status === "Completed" ? "♜" : "▣"}</span>;
}

export default function BiohazardSubscreenView({ controller: c }: { controller: GameLibraryController }) {
  const copy = useLayoutCopy();
  const { mode, showMode } = useSafeRoom();
  const { playSfx } = useUIEffects();
  const examineRef = useRef<HTMLElement>(null);
  const selected = c.visibleGames.find(game => game.id === c.selectedGameId) ?? c.visibleGames[0];
  const record = c.games.find(game => game.id === c.selectedGameId) ?? selected;
  function inspect(game: LibraryGame, focus = false) {
    if (game.id !== c.selectedGameId) playSfx("cursor");
    c.setSelectedGameId(game.id);
    if (focus) requestAnimationFrame(() => examineRef.current?.focus());
  }
  function reorder(game: LibraryGame) {
    const timeline = c.inTimelineView;
    const position = (timeline ? c.visibleTimelinePositions : c.visibleBacklogPositions).get(game.id) ?? -1;
    const count = timeline ? c.visibleGames.length : c.visibleBacklogIds.length;
    if (!timeline && (!c.canReorderBacklog || game.pinnedOrder !== null)) return null;
    return <div className="bio-order-controls" role="group" aria-label={`${timeline ? "Saga timeline" : "Backlog priority"} for ${game.title}`}>
      <button type="button" disabled={c.rowReorderBusy || position <= 0} aria-label={`Move ${game.title} earlier`} onClick={() => timeline ? c.swapTimelineGame(game.id, -1) : c.swapBacklogGame(game.id, -1)}>↑</button><span>POSITION {position + 1}</span><button type="button" disabled={c.rowReorderBusy || position < 0 || position >= count - 1} aria-label={`Move ${game.title} later`} onClick={() => timeline ? c.swapTimelineGame(game.id, 1) : c.swapBacklogGame(game.id, 1)}>↓</button>
    </div>;
  }
  return <div className="bio-subscreen">
    <div className="bio-toolbar"><span className="bio-kicker">STORAGE FACILITY / PERSONAL EFFECTS</span><div><button ref={c.roulette.triggerRef} type="button" aria-haspopup="dialog" onClick={c.roulette.open}>RANDOM ASSIGNMENT</button><button ref={c.vault.triggerRef} type="button" aria-haspopup="dialog" onClick={c.vault.open}>ARCHIVE TRANSFER</button><SocialHubTrigger controller={c.social} />{c.children}</div></div>

    <section className="bio-loadout" aria-labelledby="bio-loadout-title" hidden={mode !== "box" && mode !== "equipped"} ref={c.deck.sectionRef}>
      <div className="bio-panel-heading"><h2 id="bio-loadout-title">{copy("Equipped loadout", "Equipped loadout", "deckTitle")}</h2><span>QUICK SLOTS / {c.pinnedCount} OF {DECK_CAPACITY}</span></div>
      <div className="bio-loadout-slots">{Array.from({ length: DECK_CAPACITY }, (_, index) => {
        const slot = index + 1, game = c.deck.pinned.find(game => game.pinnedOrder === slot);
        return <div className="bio-weapon-slot" key={slot} data-deck-slot={slot} data-drop-hover={c.deck.hoveredSlot === slot} onDragOver={event => { if (c.deck.acceptsDrop && event.dataTransfer.types.includes(DECK_DRAG_TYPE)) { event.preventDefault(); c.deck.setHoveredSlot(slot); } }} onDragLeave={() => c.deck.setHoveredSlot(null)} onDrop={event => c.deck.dropIntoSlot(event, slot)}>
          <span className="bio-slot-index">EQUIPPED {String(slot).padStart(2, "0")}</span>
          {game ? <><button className="bio-equipped-title" type="button" data-ui-sound="custom" onClick={() => { c.openLibraryInventory(); inspect(game, true); showMode("box"); }}><ItemArt game={game} /><strong>{game.title}</strong><span className="bio-ammo-count">{game.lengthHours}<small> H</small></span></button><div className="bio-slot-actions"><button type="button" disabled={c.deck.busy || slot === 1} aria-label={`Move ${game.title} to previous quick slot`} onClick={() => c.deck.moveSlot(game, -1)}>◀</button><DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={c.pinnedCount} releaseYear={game.releaseYear} disabled={c.deck.busy} unpinOnly /><button type="button" disabled={c.deck.busy || slot === DECK_CAPACITY} aria-label={`Move ${game.title} to next quick slot`} onClick={() => c.deck.moveSlot(game, 1)}>▶</button></div></> : <div className="bio-empty-slot"><span>—</span><small>NO ITEM EQUIPPED<br />Equip from the Item Box or drop a game here.</small></div>}
        </div>;
      })}</div>
      {c.deck.notice && <p role="status">{c.deck.notice.text}</p>}
      <div className="bio-active-operations"><h3>Deployed / Active operations</h3>{c.games.filter(game => game.status === "Playing").map(game => <button key={game.id} type="button" onClick={() => { c.changeView("Playing"); inspect(game); showMode("box"); }}>{game.title} · {game.hoursPlayed}h / {game.lengthHours}h</button>)}{!c.games.some(game => game.status === "Playing") && <p>No operations in progress. Select a stored game and deploy it.</p>}</div>
    </section>

    <section className="bio-item-box" hidden={mode !== "box"} aria-labelledby="collection-title">
      <div className="bio-panel-heading"><h2 id="collection-title">{copy("Item Box", "Item Box", "libraryTitle")}</h2><span>{c.visibleGames.length} / {c.games.length} RECORDS</span></div>
      <div className="bio-storage-tabs" role="group" aria-label="Library status">{views.map(view => <button key={view} type="button" aria-pressed={c.activeView === view} onClick={() => c.changeView(view)}>{statusName(view)} <span>{c.viewCounts[view]}</span></button>)}</div>
      <div className="bio-filters"><label>Search inventory<input type="search" placeholder="Title, platform, genre…" value={c.searchQuery} onChange={event => c.setSearchQuery(event.target.value)} /></label><label>Platform<select value={c.platformFilter} onChange={event => c.setPlatformFilter(event.target.value)}><option value="">All platforms</option>{c.platforms.map(value => <option key={value}>{value}</option>)}</select></label><label>Genre<select value={c.genreFilter} onChange={event => c.setGenreFilter(event.target.value)}><option value="">All genres</option>{c.genres.map(value => <option key={value}>{value}</option>)}</select></label><OwnershipFilterControl value={c.ownershipFilter} onChange={c.setOwnershipFilter} /><label>Arrange<select aria-label="Sort games" value={c.sortBy} onChange={event => c.setSortBy(event.target.value)}>{sorts.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{c.hasActiveFilters && <button type="button" onClick={c.clearFilters}>Clear filters</button>}</div>
      {(c.selectedCustomList || c.selectedSaga) && <p className="bio-filter-notice">Open file: {c.selectedCustomList?.title ?? c.selectedSaga?.name} <button type="button" onClick={c.clearFilters}>Full inventory</button></p>}
      {c.backlogNotice && <p role="status">{c.backlogNotice.text}</p>}{c.deckReturnNotice && <p role="status">{c.deckReturnNotice.text}</p>}
      <div className="bio-box-split">
        <div className="bio-storage-rack" onDragOver={c.dragOverBacklog} onDragLeave={c.leaveBacklog} onDrop={c.dropDeckIntoBacklog} data-drop-hover={c.backlogReturnHover}>
          <ul className="bio-inventory-grid" aria-label="Item Box inventory slots">{c.visibleGames.map((game, index) => <li key={game.id} data-library-game-id={game.id} data-reorder-row-id={game.id} data-selected={game.id === selected?.id} data-drop-target={c.dropTargetId === game.id} draggable={(c.isReorderableRow(game.id) || c.canDragToDeck(game)) && !c.rowReorderBusy} onPointerDownCapture={() => c.rememberDragOrigin({ gameId: game.id, source: "table" }, false)} onDragStart={event => c.startLibraryDrag(event, { gameId: game.id, source: "table" })} onDragEnd={c.endRowDrag} onDragOver={event => c.dragOverLibraryGame(event, game.id)} onDragLeave={event => c.leaveLibraryGame(event, game.id)} onDrop={event => c.dropRowGame(event, game.id)}>
            <button className="bio-inventory-slot" type="button" data-ui-sound="custom" aria-label={`Examine ${game.title}`} aria-pressed={game.id === selected?.id} onClick={() => inspect(game)} onFocus={() => inspect(game)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const grid = event.currentTarget.closest("ul")!;
              const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
              const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
              grid.querySelectorAll<HTMLButtonElement>(".bio-inventory-slot")[Math.max(0, Math.min(c.visibleGames.length - 1, index + offset))]?.focus();
            }}><span className="bio-slot-number">{String(index + 1).padStart(2, "0")}</span><ItemArt game={game} /><span className="bio-ammo-count">{game.hoursPlayed}<small> H</small></span><span className="bio-slot-caption"><strong>{game.title}</strong><small>{game.pinnedOrder !== null ? `EQUIPPED / ${game.pinnedOrder}` : statusName(game.status)}</small></span>{game.steamAchievementsTotal != null && <span className="bio-achievement-count">{game.steamAchievementsUnlocked ?? 0}/{game.steamAchievementsTotal} ◆</span>}</button>
          </li>)}{Array.from({ length: Math.max(0, 8 - c.visibleGames.length) }, (_, index) => <li key={`empty-${index}`} className="bio-unused-slot" aria-hidden="true"><span>EMPTY</span></li>)}</ul>
          {!c.visibleGames.length && <p className="bio-empty-message">{c.games.length ? "No records match. Clear filters to search the full Item Box." : "The Item Box is empty. Use the Typewriter to record your first game."}</p>}
          <p className="bio-inventory-help">SELECT AN ITEM TO EXAMINE · ARROW KEYS TO MOVE</p>
        </div>
        <aside className="bio-examination" ref={examineRef} tabIndex={-1} aria-label="Item examination" aria-live="polite">
          <p className="bio-kicker">EXAMINATION / PERSONAL EFFECT</p>
          {selected ? <><div className="bio-examine-art"><ItemArt game={selected} /><span>{selected.platform}<br />{selected.releaseYear ?? "UNKNOWN YEAR"}</span></div><h3>{selected.title}</h3><p>{selected.genre || "Unclassified"} · {statusName(selected.status)}</p><dl className="bio-examine-facts"><div><dt>PLAY TIME</dt><dd>{selected.hoursPlayed} / {selected.lengthHours}h</dd></div><div><dt>RATING</dt><dd>{selected.rating ?? "—"} / 5</dd></div><div><dt>REWARD</dt><dd>{selected.earnedXp || selected.lengthHours * selected.difficulty * 10} XP</dd></div></dl><OwnershipBadge value={selected.ownershipType} /><ReplayBadge count={selected.playthroughCount} /><SteamProgress game={selected} /><PlayJournalBadges startedAt={selected.startedAt} completedAt={selected.completedAt} /><MicroReview review={selected.review} reviewSpoiler={selected.reviewSpoiler} /><p className="bio-item-notes">{selected.notes || "No field notes recorded. Examine this item at the typewriter to update its record."}</p><CommunityStatsReadout game={selected} />{reorder(selected)}<div className="bio-context-actions">{selected.status === "Backlog" && <DeckPinButton gameId={selected.id} pinnedOrder={selected.pinnedOrder} pinnedCount={c.pinnedCount} releaseYear={selected.releaseYear} disabled={c.rowReorderBusy} />}<button type="button" onClick={() => showMode("save")}>EXAMINE / EDIT</button><QuickGameActions key={selected.id} controller={c} game={selected} /></div></> : <><h3>No item selected</h3><p>Record a game at the Safe Room typewriter.</p><button type="button" onClick={() => showMode("save")}>USE TYPEWRITER</button></>}
        </aside>
      </div>
    </section>

    <section className="bio-files" hidden={mode !== "files"} aria-label="Files and logs">
      <div className="bio-panel-heading"><h2>Files &amp; Logs</h2><span>RESEARCH ARCHIVE / AUTHORIZED PERSONNEL</span></div>
      <div className="bio-folder-layout"><div className="bio-manila-folder"><span className="bio-folder-tab">LAB RESEARCH / CUSTOM LISTS</span><CustomLists controller={c} /><button type="button" onClick={() => showMode("box")}>OPEN SELECTED LIST IN ITEM BOX →</button></div>
      <section className="bio-incident-binder"><span className="bio-folder-tab">INCIDENT BINDERS / SAGA CHAINS</span><h3>Series investigation files</h3><label>Open saga<select aria-label="Filter by saga" value={c.selectedSaga?.key ?? ""} onChange={event => c.selectSaga(event.target.value)}><option value="">Choose a saga…</option>{c.chains.map(chain => <option key={chain.key} value={chain.key}>{chain.name} · {chain.completed}/{chain.total}</option>)}</select></label>{c.selectedSaga ? <><h4>{c.selectedSaga.name}</h4><SagaOrderControls {...c.sagaOrderControls} />{c.sagaNotice && <p role="status">{c.sagaNotice.text}</p>}<ol className="bio-incident-timeline">{c.visibleGames.map(game => <li key={game.id}><button type="button" onClick={() => { inspect(game); showMode("box"); }}>{game.title}</button><small>{game.releaseYear ?? "Unknown"} · {statusName(game.status)}</small>{reorder(game)}</li>)}</ol>{c.isAdmin && <SagaChronologyDebuggerView controller={c.debuggerController} />}</> : <p>Choose a saga to inspect its chronology. Edit a game’s metadata to assign a franchise and timeline rank.</p>}</section></div>
      <LibraryTelemetry games={c.games} />
    </section>

    <section className="bio-recon" hidden={mode !== "radar"} aria-label="Field recon and outbreak radar"><div className="bio-panel-heading"><h2>Field Recon</h2><span>OUTBREAK RADAR / HIGH-THREAT FILES</span></div><div className="bio-recon-body"><div className="bio-radar-scope" aria-hidden="true"><span /><i /><b>＋</b></div><div><p className="bio-kicker">EXTERNAL SCOUT / SECURE CONNECTION</p><h3>Beyond the perimeter</h3><p>Investigate new releases, follow your sagas, and discover games matched to your field record.</p><button type="button" ref={c.advisor.triggerRef} aria-haspopup="dialog" aria-expanded={c.advisor.isOpen} onClick={() => { c.advisor.selectScoutTab("radar"); c.advisor.openAdvisor(); }}>OPEN OUTBREAK RADAR <RadarNotification count={c.advisor.unseenRadarCount} /></button><p>Includes External Scout, Release Radar, Popular / Trending, and personalized recommendations.</p></div></div></section>

    <section className="bio-typewriter" hidden={mode !== "save"} aria-label="Typewriter save station"><div className="bio-panel-heading"><h2>Typewriter // Save station</h2><span>INK RIBBON / READY</span></div><div className="bio-typewriter-intro"><span className="bio-ribbon" aria-hidden="true">◉━━◉</span><div><h3>A moment of safety.</h3><p>Record a new game above, or update the selected field record below. Every save uses your existing library.</p></div></div>{record ? <BioGameRecord key={gameRecordKey(record)} controller={c} game={record} /> : <p>Select a game in the Item Box to edit it, or record a new game above.</p>}</section>
  </div>;
}

function QuickGameActions({ controller: c, game }: { controller: GameLibraryController; game: LibraryGame }) {
  const [discard, setDiscard] = useState(false);
  return <SafeForm action={c.actions.updateGame} className="bio-quick-actions">
    <input type="hidden" name="id" value={game.id} /><input type="hidden" name="lengthHours" value={game.lengthHours} /><input type="hidden" name="difficulty" value={game.difficulty} />
    {(game.status === "Backlog" || game.status === "Flatlined") && <SafeActionButton type="submit" formAction={c.startGameAndShowPlaying}>DEPLOY</SafeActionButton>}
    {game.status === "Playing" && <><SafeActionButton type="submit" formAction={c.completeGameWithSound}>CLEAR</SafeActionButton><SafeActionButton type="submit" formAction={c.actions.flatlineGame}>STORE / ARCHIVE</SafeActionButton></>}
    <button type="button" onClick={() => c.openMetadata(game)}>METADATA</button>
    {!discard ? <button type="button" onClick={() => setDiscard(true)}>DISCARD</button> : <><span>Delete this game permanently?</span><SafeActionButton type="submit" formAction={c.actions.deleteGame} formNoValidate>CONFIRM DISCARD</SafeActionButton><button type="button" onClick={() => setDiscard(false)}>CANCEL</button></>}
  </SafeForm>;
}

function BioGameRecord({ controller: c, game }: { controller: GameLibraryController; game: LibraryGame }) {
  const draft = c.getGameDraft(game);
  return <div className="bio-record-sheet"><h3>{game.title} / Field record</h3>{game.status === "Playing" && <div className="bio-session-log"><span>PLAY JOURNAL / SESSION LOG</span><button type="button" disabled={c.isLogging} onClick={() => c.logSession(game.id, 1)}>LOG +1H</button><button type="button" disabled={c.isLogging} onClick={() => c.logSession(game.id, 2)}>LOG +2H</button>{c.sessionError?.gameId === game.id && <p role="alert">{c.sessionError.message}</p>}</div>}<ReplayLogForm game={game} /><SafeForm className="bio-record-editor" action={c.actions.updateGame} data-game-editor-id={game.id}>
    <input type="hidden" name="id" value={game.id} /><div className="bio-editor-fields"><label>Status<select name="status" defaultValue={draft.status}>{views.filter(view => view !== "All").map(status => <option key={status} value={status}>{statusName(status)}</option>)}</select></label><label>Estimated hours<input name="lengthHours" type="number" min="1" max="10000" step="1" defaultValue={draft.lengthHours} required /></label><label>Hours played<input name="hoursPlayed" type="number" min="0" max="10000" step="1" defaultValue={draft.hoursPlayed} required /></label><label>Difficulty<select name="difficulty" defaultValue={draft.difficulty}><option value="1">1 · Easy</option><option value="2">2 · Medium</option><option value="3">3 · Tough</option></select></label></div>
    <StarRatingInput defaultValue={draft.rating === "" ? null : Number(draft.rating)} label={`Rating for ${game.title}`} onChange={rating => c.setGameDraftRating(game, rating)} /><ReplayCountEditor game={game} value={draft.playthroughCount} /><OwnershipField title={game.title} value={draft.ownershipType} /><PlayJournalEditor title={game.title} startedAt={draft.startedAt} completedAt={draft.completedAt} originalStartedAt={game.startedAt?.slice(0, 10)} originalCompletedAt={game.completedAt?.slice(0, 10)} /><MicroReviewEditor title={game.title} review={draft.review} reviewSpoiler={draft.reviewSpoiler === "true"} /><label>Field notes<textarea name="notes" defaultValue={draft.notes} rows={3} maxLength={1000} placeholder="Last checkpoint, discoveries, supplies…" /></label>
    <div className="bio-record-actions"><button type="submit">SAVE FIELD RECORD</button><button type="button" onClick={() => c.openMetadata(game)}>EDIT METADATA</button><a href={buildTrailerUrl(game.title, game.releaseYear)} target="_blank" rel="noopener noreferrer">VIEW TRAILER ↗</a><SafeActionButton type="submit" formAction={c.actions.deleteGame} formNoValidate>DISCARD RECORD</SafeActionButton></div>
  </SafeForm>{game.status === "Playing" && <AgentBriefing game={game} />}</div>;
}
