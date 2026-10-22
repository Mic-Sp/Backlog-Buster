"use client";

import { gameRecordKey } from "@/lib/game-record";
import AgentBriefing from "@/components/AgentBriefing";
import DeckPinButton from "@/components/DeckPinButton";
import type { GameLibraryController, LibraryGame, SortColumn } from "@/components/GameLibrary";
import { LibraryDataVaultView } from "@/components/LibraryDataVault";
import LibraryTelemetry from "@/components/LibraryTelemetry";
import { QuestRouletteView } from "@/components/QuestRoulette";
import SafeForm, { SafeActionButton } from "@/components/SafeForm";
import SagaChains, { SagaBadge, SagaOrderControls } from "@/components/SagaChains";
import { SagaChronologyDebuggerView } from "@/components/SagaChronologyDebugger";
import StarRatingInput from "@/components/StarRatingInput";
import { TacticalAdvisorView } from "@/components/TacticalAdvisor";
import TrophyRatingEditor from "@/components/TrophyRatingEditor";
import { UpNextDeckView } from "@/components/UpNextDeck";
import { isReleasedYear } from "@/lib/game-release";
import { buildTrailerUrl } from "@/lib/trailers";
import "./BacklogReorder.css";

const statuses = ["Backlog", "Playing", "Completed", "Flatlined"];
const views = ["Backlog", "Playing", "Completed", "Flatlined", "All"] as const;
const difficultyLabels: Record<number, string> = { 1: "Easy", 2: "Medium", 3: "Tough" };

export default function CyberpunkLibraryView({ controller }: { controller: GameLibraryController }) {
  const {
    completeGameWithSound,
    games,
    isReturningDeck,
    deckReturnNotice,
    backlogReturnHover,
    backlogReturnTarget,
    activeView,
    searchQuery,
    setSearchQuery,
    platformFilter,
    setPlatformFilter,
    genreFilter,
    setGenreFilter,
    sortBy,
    setSortBy,
    sagaNotice,
    backlogNotice,
    dragSourceId,
    dropTargetId,
    openMetadata,
    isLogging,
    sessionError,
    pinnedCount,
    currentYear,
    chains,
    byGameId,
    selectedSaga,
    optimisticTimeline,
    timelinePositions,
    inTimelineView,
    timelineBusy,
    backlogPositions,
    inBacklogPriorityView,
    canReorderBacklog,
    rowReorderBusy,
    canReturnToBacklog,
    logSession,
    platforms,
    genres,
    viewCounts,
    visibleGames,
    visibleTimelinePositions,
    visibleBacklogIds,
    visibleBacklogPositions,
    hasActiveFilters,
    showFilteredCount,
    clearFilters,
    startGameAndShowPlaying,
    selectSaga,
    sagaOrderControls,
    swapTimelineGame,
    swapBacklogGame,
    isReorderableRow,
    canDragToDeck,
    endRowDrag,
    rememberDragOrigin,
    dragOverBacklog,
    leaveBacklog,
    dropDeckIntoBacklog,
    startLibraryDrag,
    dropRowGame,
    changeView,
    toggleColumnSort,
    achievements,
    isAdmin,
    children,
    advisor,
    vault,
    roulette,
    deck,
    debuggerController,
  } = controller;

  function renderTimelinePill(game: LibraryGame) {
    if (!inTimelineView) return null;
    const position = visibleTimelinePositions.get(game.id) ?? -1;
    const rank = optimisticTimeline.pending && optimisticTimeline.key === selectedSaga?.key
      ? (timelinePositions.get(game.id) ?? 0) + 1 : game.chronologicalOrder;
    return (
      <span className="saga-timeline-ordinal saga-timeline-control" data-assigned={rank != null}>
        <button type="button" className="timeline-swap-button" data-timeline-game-id={game.id} data-timeline-direction="-1" data-reorder-game-id={game.id} data-reorder-direction="-1" disabled={timelineBusy || position <= 0} aria-label={`Move ${game.title} up in saga timeline`} title="Move up in saga timeline" onClick={() => swapTimelineGame(game.id, -1)}>▲</button>
        <span title={rank != null ? "In-universe timeline rank" : "Timeline rank unassigned; using release order"}>{rank != null ? `TL #${String(rank).padStart(2, "0")}` : "TL —"}</span>
        <button type="button" className="timeline-swap-button" data-timeline-game-id={game.id} data-timeline-direction="1" data-reorder-game-id={game.id} data-reorder-direction="1" disabled={timelineBusy || position < 0 || position === visibleGames.length - 1} aria-label={`Move ${game.title} down in saga timeline`} title="Move down in saga timeline" onClick={() => swapTimelineGame(game.id, 1)}>▼</button>
      </span>
    );
  }

  function renderBacklogPriorityPill(game: LibraryGame) {
    if (!canReorderBacklog || game.pinnedOrder != null) return null;
    const position = visibleBacklogPositions.get(game.id) ?? -1;
    const rank = (backlogPositions.get(game.id) ?? 0) + 1;
    return (
      <span className="backlog-priority-control" role="group" aria-label={`Backlog priority ${rank} for ${game.title}`}>
        <button type="button" className="backlog-swap-button" data-reorder-game-id={game.id} data-reorder-direction="-1" disabled={rowReorderBusy || position <= 0} aria-label={`Move ${game.title} up in Backlog priority`} title="Move up in Backlog priority" onClick={() => swapBacklogGame(game.id, -1)}>▲</button>
        <span title="Custom Backlog priority">#{String(rank).padStart(2, "0")}</span>
        <button type="button" className="backlog-swap-button" data-reorder-game-id={game.id} data-reorder-direction="1" disabled={rowReorderBusy || position < 0 || position === visibleBacklogIds.length - 1} aria-label={`Move ${game.title} down in Backlog priority`} title="Move down in Backlog priority" onClick={() => swapBacklogGame(game.id, 1)}>▼</button>
      </span>
    );
  }

  function renderSagaBadge(game: LibraryGame, layout: "default" | "table" | "trophy" = "default") {
    const saga = byGameId.get(game.id);
    return saga ? <SagaBadge saga={saga} onSelect={selectSaga} layout={layout} /> : null;
  }

  function getAriaSort(column: SortColumn) {
    return sortBy === `${column}-asc` ? "ascending"
      : sortBy === `${column}-desc` ? "descending" : "none";
  }

  function getSortIcon(column: SortColumn) {
    const direction = getAriaSort(column);
    return direction === "ascending" ? "▲" : direction === "descending" ? "▼" : "↕";
  }

  function renderSortableHeader(column: SortColumn, label: string) {
    return (
      <span role="columnheader" aria-sort={getAriaSort(column)}>
        <button type="button" className="column-sort-btn" onClick={() => toggleColumnSort(column)}>
          {label} <span aria-hidden="true">{getSortIcon(column)}</span>
        </button>
      </span>
    );
  }

  function renderCardCover(game: LibraryGame, className: string) {
    return game.coverUrl ? (
      // Keep the same lazy thumbnail behavior in every library view.
      // eslint-disable-next-line @next/next/no-img-element
      <img className={className} src={game.coverUrl} alt={`${game.title} cover art`} width={640} height={360} loading="lazy" decoding="async" />
    ) : (
      <div className={`${className} library-card-no-cover`} role="img" aria-label={`${game.title} cover art unavailable`}>NO COVER</div>
    );
  }

  function renderCardControls(game: LibraryGame) {
    return (
      <>
        <input name="id" type="hidden" value={game.id} />
        <div className="library-card-controls">
          <label>
            Status
            <select name="status" defaultValue={controller.getGameDraft(game).status} aria-label={`Status for ${game.title}`} required>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Est. Hours
            <input name="lengthHours" type="number" defaultValue={controller.getGameDraft(game).lengthHours} aria-label={`Hours for ${game.title}`} min="1" max="10000" step="1" required />
          </label>
          <label>
            Hours Played
            <input name="hoursPlayed" type="number" defaultValue={controller.getGameDraft(game).hoursPlayed} aria-label={`Hours played for ${game.title}`} min="0" max="10000" step="1" required />
          </label>
          <label>
            Difficulty
            <select name="difficulty" defaultValue={controller.getGameDraft(game).difficulty} aria-label={`Difficulty for ${game.title}`} required>
              {[1, 2, 3].map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty} · {difficultyLabels[difficulty]}</option>)}
            </select>
          </label>
          <div className="star-rating-field">
            <span>Rating</span>
            <StarRatingInput defaultValue={controller.getGameDraft(game).rating === "" ? null : Number(controller.getGameDraft(game).rating)} onChange={rating => controller.setGameDraftRating(game, rating)} label={`Rating for ${game.title}`} />
          </div>
        </div>
        <label className="field-log-label">
          NETRUNNER FIELD LOG
          <textarea className="field-log-textarea" name="notes" rows={3} maxLength={1000} defaultValue={controller.getGameDraft(game).notes} placeholder="Log current checkpoint, build notes, or session thoughts..." />
        </label>
        <div className="library-card-actions">
          <button className="status-save" type="submit">Save</button>
          <SafeActionButton className="delete-button" formAction={controller.actions.deleteGame} formNoValidate type="submit">Delete</SafeActionButton>
          {game.status === "Playing" && (
            <SafeActionButton className="flatline-gig-button" formAction={controller.actions.flatlineGame} type="submit">💀 FLATLINE GIG</SafeActionButton>
          )}
          {game.status === "Flatlined" && (
            <SafeActionButton className="revive-gig-button" formAction={startGameAndShowPlaying} type="submit">▶ REVIVE GIG</SafeActionButton>
          )}
          {game.status === "Playing" && (
            <a className="trailer-link-button" href={buildTrailerUrl(game.title, game.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
          )}
          <button type="button" className="edit-meta-btn" data-metadata-trigger-id={game.id} onClick={() => openMetadata(game)}>⚙ EDIT META</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="collection-heading">
        <div>
          <p className="eyebrow">02 / YOUR LIBRARY</p>
          <h2 id="collection-title">System Playqueue</h2>
        </div>
        <div className="collection-heading-actions">
          <p className="game-count" role="status">
            <strong>{showFilteredCount ? `${visibleGames.length} / ${games.length}` : String(games.length).padStart(2, "0")}</strong>
            <span>{!showFilteredCount && visibleGames.length === 1 ? "game" : "games"}</span>
          </p>
          {children}
          <QuestRouletteView controller={roulette} part="trigger" />
          <TacticalAdvisorView controller={advisor} part="trigger" />
          <LibraryDataVaultView controller={vault} part="trigger" />
        </div>
      </div>

      <LibraryTelemetry games={games} />
      <SagaChains chains={chains} selectedKey={selectedSaga?.key ?? ""} onSelect={selectSaga} {...sagaOrderControls} />

      <div className="library-tabs" role="group" aria-label="Library view">
        {views.map((view) => (
          <button
            key={view}
            type="button"
            data-view={view.toLowerCase()}
            aria-pressed={activeView === view}
            onClick={() => changeView(view)}
          >
            {view.toUpperCase()} <span>{viewCounts[view]}</span>
          </button>
        ))}
      </div>

      <div className="library-toolbar">
        <label className="library-search">
          <span>Search library</span>
          <input
            type="search"
            placeholder="Search title, genre, or platform..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Platform</span>
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
          </select>
        </label>
        <label>
          <span>Genre</span>
          <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)}>
            <option value="">All genres</option>
            {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select className="library-filter-select" aria-label="Sort games" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="default">Default order</option>
            {activeView === "Backlog" && !selectedSaga && <option value="custom-priority">Custom Priority</option>}
            {(selectedSaga || sortBy === "timeline-asc") && <option value="timeline-asc">Saga: timeline order</option>}
            {activeView !== "Backlog" && (
              <>
                <option value="rating-desc">Highest rated</option>
                <option value="rating-asc">Lowest rated</option>
              </>
            )}
            {(activeView === "All" || activeView === "Backlog") && <option value="pinned-first">Pinned first</option>}
            <option value="hours-asc">Hours: shortest first</option>
            <option value="hours-desc">Hours: longest first</option>
            <option value="xp-desc">XP: highest first</option>
            <option value="xp-asc">XP: lowest first</option>
            <option value="year-desc">Year: newest first</option>
            <option value="year-asc">Year: oldest first</option>
            <option value="title-asc">Title: A–Z</option>
            <option value="title-desc">Title: Z–A</option>
            <option value="platform-asc">Platform: A–Z</option>
            <option value="platform-desc">Platform: Z–A</option>
            <option value="genre-asc">Genre: A–Z</option>
            <option value="genre-desc">Genre: Z–A</option>
            <option value="status-asc">Status: Playing → Flatlined</option>
            <option value="status-desc">Status: Flatlined → Playing</option>
            <option value="difficulty-desc">Difficulty: hardest first</option>
            <option value="difficulty-asc">Difficulty: easiest first</option>
          </select>
        </label>
        {hasActiveFilters && (
          <button className="library-clear" type="button" onClick={clearFilters}>CLEAR FILTERS</button>
        )}
      </div>

      {inBacklogPriorityView && backlogNotice && <p className="backlog-order-notice" role="status" data-error={backlogNotice.error}>{backlogNotice.text}</p>}
      {deckReturnNotice && <p className="backlog-order-notice" role="status" data-deck-return-notice="true" data-error={deckReturnNotice.error}>{deckReturnNotice.text}</p>}

      {selectedSaga && (
        <section className="saga-timeline-panel" aria-label={`${selectedSaga.name} saga timeline`}>
          <div className="saga-timeline-heading">
            <div>
              <p className="saga-chain-count">⛓️ SAGA CHAIN // {selectedSaga.completed}/{selectedSaga.total} CLEARED</p>
              <h3>{selectedSaga.name}</h3>
            </div>
            <SagaOrderControls {...sagaOrderControls} />
          </div>
          <p className="saga-chains-hint">Unassigned games follow ranked games in release order. Use ▲ / ▼ to swap visible games, or drag table rows to reorder. Hidden saga games keep their relative positions.</p>
          {sagaNotice?.key === selectedSaga.key && <p className="saga-order-notice" role="status" data-error={sagaNotice.error}>{sagaNotice.text}</p>}
          {isAdmin && <SagaChronologyDebuggerView controller={debuggerController} />}
        </section>
      )}

      {(activeView === "All" || activeView === "Backlog") && <UpNextDeckView controller={deck} />}
      <div data-view={activeView.toLowerCase()} className={activeView === "Completed" ? "trophy-room" : undefined}>
        {activeView === "Completed" && (
          <>
            <div className="trophy-room-banner" aria-label="Completed games shown">
              <div>
                <p className="eyebrow">ARCHIVE // ACHIEVEMENTS UNLOCKED</p>
                <h3>Trophy Room</h3>
              </div>
              <dl>
                <div><dt>Gigs cleared</dt><dd>{visibleGames.length.toLocaleString()}</dd></div>
                <div><dt>Hours logged</dt><dd>{visibleGames.reduce((total, game) => total + game.lengthHours, 0).toLocaleString()}h</dd></div>
                <div><dt>XP earned</dt><dd>+{visibleGames.reduce((total, game) => total + game.earnedXp, 0).toLocaleString()} XP</dd></div>
              </dl>
            </div>
            <details className="trophy-milestones-drawer">
              <summary>Milestones · {achievements.filter((achievement) => achievement.unlocked).length} / {achievements.length} unlocked</summary>
              <p className="milestones-hint">Career milestones cover your entire library. Earned badges and their bonus XP are permanent.</p>
              <div className="trophy-milestones-grid">
                {achievements.map((achievement) => (
                  <article className="milestone-card" data-unlocked={achievement.unlocked} key={achievement.key}>
                    <span className="milestone-icon" aria-hidden="true">{achievement.icon}</span>
                    <h3>{achievement.title}</h3>
                    <p>{achievement.description}</p>
                    <p className="milestone-progress">{achievement.current} / {achievement.target} current progress</p>
                    <p className="milestone-bonus">+{achievement.unlocked ? achievement.xpAwarded : achievement.xpBonus} XP {achievement.unlocked ? "awarded" : "bonus"}</p>
                    {achievement.unlockedAt ? (
                      <p className="milestone-unlock-stamp">UNLOCKED <time dateTime={achievement.unlockedAt}>{achievement.unlockedAt.slice(0, 10)}</time></p>
                    ) : <p className="milestone-locked">LOCKED</p>}
                  </article>
                ))}
              </div>
            </details>
          </>
        )}
        {visibleGames.length === 0 ? (
          <div className="empty-state backlog-return-zone" data-deck-return-active={canReturnToBacklog || undefined} data-deck-return-hover={backlogReturnHover || undefined} onDragOver={dragOverBacklog} onDragLeave={leaveBacklog} onDrop={dropDeckIntoBacklog}>
            <span className="empty-mark" aria-hidden="true">+</span>
            <p>{games.length === 0 ? "Your list is clear. Add a game to get started." : "No games match. Try another view or clear your filters."}</p>
          </div>
        ) : activeView === "Playing" || activeView === "Flatlined" ? (
          <div className="playing-spotlight-grid">
            {visibleGames.map((game) => (
              <SafeForm
                action={controller.actions.updateGame}
                data-game-editor-id={game.id}
                className="spotlight-card"
                data-game-id={game.id}
                data-library-game-id={game.id}
                data-status={game.status}
                key={gameRecordKey(game)}
              >
                {renderCardCover(game, "spotlight-cover")}
                <div className="spotlight-card-body">
                  <p className="spotlight-badge">{game.status === "Flatlined" ? "💀 FLATLINED // SHELVED" : "LIVE GIG // IN PROGRESS"}</p>
                  <h3>{game.title}{renderTimelinePill(game)}</h3>
                  <p className="library-card-metadata">
                    {game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}
                    {activeView === "Flatlined" && game.rating !== null && (
                      <> <span className="library-rating-badge" aria-label={`Rated ${game.rating} out of 5 stars`}>★ {game.rating}/5</span></>
                    )}
                    {renderSagaBadge(game)}
                  </p>
                  <div className="gig-progress-block">
                    <div className="gig-progress-header">
                      <span>{game.status === "Flatlined" ? "ARCHIVED GIG PROGRESS" : "ACTIVE GIG PROGRESS"}</span>
                      {game.status === "Playing" && (
                        <div className="gig-session-actions">
                          <button type="button" disabled={isLogging} onClick={() => logSession(game.id, 1)} aria-label={`Log one hour for ${game.title}`}>+1H</button>
                          <button type="button" disabled={isLogging} onClick={() => logSession(game.id, 2)} aria-label={`Log two hours for ${game.title}`}>+2H</button>
                        </div>
                      )}
                    </div>
                    <p>{game.hoursPlayed} / {game.lengthHours}h ({Math.min(100, Math.round((game.hoursPlayed / game.lengthHours) * 100))}%)</p>
                    <div className="gig-progress-track" role="progressbar" aria-label={`Progress for ${game.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((game.hoursPlayed / game.lengthHours) * 100))} aria-valuetext={`${game.hoursPlayed} of ${game.lengthHours} hours`}>
                      <span style={{ width: `${Math.min(100, Math.round((game.hoursPlayed / game.lengthHours) * 100))}%` }} />
                    </div>
                    {sessionError?.gameId === game.id && <p role="alert">{sessionError.message}</p>}
                  </div>
                  <div className="spotlight-bounty">
                    <span>{game.status === "Flatlined" ? "Shelved Gig // No Game XP" : "Potential XP Bounty"}</span>
                    <strong>{(game.status === "Flatlined" ? 0 : game.lengthHours * game.difficulty * 10).toLocaleString()} XP</strong>
                  </div>
                  {game.status === "Playing" && <AgentBriefing game={game} />}
                  {renderCardControls(game)}
                  {game.status === "Playing" && (
                    <SafeActionButton type="submit" formAction={completeGameWithSound} className="complete-gig-button">
                      🏆 COMPLETE GIG (+{Math.max(game.lengthHours, game.hoursPlayed) * game.difficulty * 10} XP)
                    </SafeActionButton>
                  )}
                </div>
              </SafeForm>
            ))}
          </div>
        ) : activeView === "Completed" ? (
          <div className="trophy-grid">
            {visibleGames.map((game) => (
              <article className="trophy-card" data-library-game-id={game.id} key={gameRecordKey(game)}>
                <div className="trophy-badge">
                  <span>🏆 GIG CLEARED</span>
                  {renderSagaBadge(game, "trophy")}
                </div>
                {renderCardCover(game, "trophy-cover")}
                <div className="trophy-card-body">
                  <h3>{game.title}{renderTimelinePill(game)}</h3>
                  {game.wasFlatlined && <p className="trophy-revived-badge">⚡ REVIVED FROM FLATLINE</p>}
                  <p className="library-card-metadata">{game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}</p>
                  <p className="trophy-record">{game.hoursPlayed}h played · {game.lengthHours}h length · Tier {game.difficulty} / {difficultyLabels[game.difficulty]}</p>
                  {game.notes?.trim() && (
                    <div className="trophy-field-log">
                      <span>NETRUNNER FIELD LOG</span>
                      <p>{game.notes}</p>
                    </div>
                  )}
                  <p className="trophy-reward">+{game.earnedXp.toLocaleString()} XP</p>
                  <TrophyRatingEditor game={game} />
                  <details className="trophy-edit-drawer">
                    <summary>Manage Record</summary>
                    <SafeForm action={controller.actions.updateGame}
                data-game-editor-id={game.id} key={gameRecordKey(game)}>
                      {renderCardControls(game)}
                    </SafeForm>
                  </details>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="game-table backlog-return-zone" role="table" aria-label="Saved games" data-deck-return-active={canReturnToBacklog || undefined} data-deck-return-hover={backlogReturnHover || undefined} aria-busy={isReturningDeck} onDragOver={dragOverBacklog} onDragLeave={leaveBacklog} onDrop={dropDeckIntoBacklog}>
            <div className="game-row game-row-head" role="row">
              {renderSortableHeader("title", "Game")}
              {renderSortableHeader("platform", "Platform")}
              {renderSortableHeader("genre", "Genre")}
              {renderSortableHeader("year", "Year")}
              {renderSortableHeader("status", "Status")}
              {renderSortableHeader("hours", "Hours")}
              {renderSortableHeader("difficulty", "Difficulty")}
              {renderSortableHeader("xp", "Earned XP")}
              <span role="columnheader">Actions</span>
            </div>
            {visibleGames.map((game) => (
              <SafeForm
                action={controller.actions.updateGame}
                data-game-editor-id={game.id}
                className="game-row"
                data-status={game.status}
                draggable={(isReorderableRow(game.id) || canDragToDeck(game)) && !rowReorderBusy}
                data-timeline-draggable={inTimelineView || undefined}
                data-timeline-row-id={game.id}
                data-reorder-row-id={game.id}
                data-library-game-id={game.id}
                data-backlog-draggable={(canReorderBacklog && game.pinnedOrder == null) || undefined}
                data-backlog-priority={inBacklogPriorityView || undefined}
                data-deck-draggable={canDragToDeck(game) || undefined}
                data-backlog-return-target={backlogReturnTarget === game.id || undefined}
                data-timeline-dragging={dragSourceId === game.id || undefined}
                data-timeline-drop-target={dropTargetId === game.id || undefined}
                onPointerDownCapture={(event) => {
                  rememberDragOrigin({ gameId: game.id, source: "table" }, event.target instanceof Element && Boolean(event.target.closest("button, input, select, textarea, a, summary, [contenteditable='true']")));
                }}
                onDragStart={(event) => startLibraryDrag(event, { gameId: game.id, source: "table" })}
                onDragEnd={endRowDrag}
                onDragOver={event => controller.dragOverLibraryGame(event, game.id)}
                onDragLeave={event => controller.leaveLibraryGame(event, game.id)}
                onDrop={(event) => dropRowGame(event, game.id)}
                key={gameRecordKey(game)}
                role="row"
              >
                <input name="id" type="hidden" value={game.id} />
                <span className="game-name" role="cell">
                  {(isReorderableRow(game.id) || canDragToDeck(game)) && <span className="saga-row-drag-grip" draggable={!rowReorderBusy} aria-hidden="true" title={inTimelineView ? "Drag to reorder this saga or stage a released Backlog gig on deck" : canReorderBacklog ? "Drag to change Backlog priority or stage a released gig on deck" : "Drag to an On Deck slot"}>⋮⋮</span>}
                  <span className="mobile-label">Game</span>
                  <span className="game-identity">
                    <span className="game-cover-wrap">
                      {game.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`${game.title} cover art`}
                          className="game-cover"
                          decoding="async"
                          loading="lazy"
                          draggable={false}
                          src={game.coverUrl}
                        />
                      ) : (
                        <div
                          aria-label={`${game.title} cover art unavailable`}
                          className="game-cover game-cover-placeholder"
                          role="img"
                        >
                          <span>NO<br />COVER</span>
                        </div>
                      )}
                      {game.status === "Backlog" && (
                        <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={pinnedCount} releaseYear={game.releaseYear} iconOnly />
                      )}
                    </span>
                    <span className="game-title-stack">
                      <span className="game-title-heading"><strong title={game.title}>{game.title}</strong>{renderTimelinePill(game)}</span>
                      <span className="game-title-actions">
                        {(game.status === "Backlog" || game.status === "Flatlined") && (
                          <SafeActionButton className="start-gig-badge" formAction={startGameAndShowPlaying} type="submit">{game.status === "Flatlined" ? "▶ REVIVE GIG" : "▶ START GIG"}</SafeActionButton>
                        )}
                        <button type="button" className="edit-meta-btn" data-metadata-trigger-id={game.id} onClick={() => openMetadata(game)}>⚙ EDIT META</button>
                        {renderBacklogPriorityPill(game)}
                        {renderSagaBadge(game, "table")}
                      </span>
                    </span>
                  </span>
                </span>
                <span role="cell">
                  <span className="mobile-label">Platform</span>
                  {game.platform}
                </span>
                <span className="genre-cell" role="cell">
                  <span className="mobile-label">Genre</span>
                  <span className="row-game-metadata">
                    <span>{game.genre?.trim() || "—"}</span>
                    {activeView === "All" && game.rating !== null && (
                      <span className="library-rating-badge" aria-label={`Rated ${game.rating} out of 5 stars`}>★ {game.rating}/5</span>
                    )}
                    {game.status === "Backlog" && !isReleasedYear(game.releaseYear, currentYear) && (
                      <span className="unreleased-badge" title="Excluded from Cortex and Roulette until a release year of this year or earlier is saved.">⏳ UNRELEASED</span>
                    )}
                  </span>
                </span>
                <span role="cell">
                  <span className="mobile-label">Year</span>
                  {game.releaseYear ?? "—"}
                </span>
                <label className="row-edit-field" role="cell">
                  <span className="mobile-label">Status</span>
                  <select
                    aria-label={`Status for ${game.title}`}
                    className="status-select"
                    defaultValue={controller.getGameDraft(game).status}
                    name="status"
                    required
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="row-edit-field" role="cell">
                  <span className="mobile-label">Hours</span>
                  <input
                    aria-label={`Hours for ${game.title}`}
                    className="row-hours-input"
                    defaultValue={controller.getGameDraft(game).lengthHours}
                    max="10000"
                    min="1"
                    name="lengthHours"
                    required
                    step="1"
                    type="number"
                  />
                </label>
                <label className="row-edit-field" role="cell">
                  <span className="mobile-label">Difficulty</span>
                  <select
                    aria-label={`Difficulty for ${game.title}`}
                    className="difficulty-select"
                    defaultValue={controller.getGameDraft(game).difficulty}
                    name="difficulty"
                    required
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
                <span className="xp-value" role="cell">
                  <span className="mobile-label">Earned XP</span>
                  {game.earnedXp.toLocaleString()} XP
                </span>
                <span className="row-actions" role="cell">
                  <button className="status-save" type="submit">Save</button>
                  <SafeActionButton
                    className="delete-button"
                    formAction={controller.actions.deleteGame}
                    formNoValidate
                    type="submit"
                  >
                    Delete
                  </SafeActionButton>
                </span>
              </SafeForm>
            ))}
          </div>
        )}
      </div>
      {activeView === "Playing" && <UpNextDeckView controller={deck} />}

    </>
  );
}
