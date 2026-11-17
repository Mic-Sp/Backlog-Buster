"use client";

import { useLayoutEffect, useState } from "react";
import type { GameLibraryController } from "@/components/GameLibrary";
import HypeMeter, { HypedOnlyFilter } from "@/components/games/HypeMeter";
import { OwnershipFilterControl } from "@/components/Ownership";
import { SocialHubTrigger } from "@/components/SocialHub";
import { UpNextDeckView } from "@/components/UpNextDeck";
import LibraryTelemetry from "@/components/LibraryTelemetry";
import CustomLists from "@/components/CustomLists";
import SagaChains from "@/components/SagaChains";
import SafeForm from "@/components/SafeForm";
import { isUnreleasedYear } from "@/lib/game-release";
import { useLayoutCopy } from "@/components/LayoutText";
import { openStandardAddGame } from "@/components/StandardNavigation";

const views = ["All", "Backlog", "Playing", "Completed", "Flatlined"] as const;
const pageSize = 20;
const sorts = [["default", "Default order"], ["custom-priority", "Backlog priority"], ["title-asc", "Title: A–Z"], ["title-desc", "Title: Z–A"],
  ["hours-asc", "Shortest first"], ["hours-desc", "Longest first"], ["rating-desc", "Highest rated"], ["rating-asc", "Lowest rated"],
  ["year-desc", "Newest releases"], ["year-asc", "Oldest releases"], ["completed-desc", "Recently completed"], ["completed-asc", "Earliest completed"],
  ["pinned-first", "Up Next first"], ["timeline-asc", "Series timeline"], ["xp-desc", "Highest XP"], ["xp-asc", "Lowest XP"],
  ["difficulty-asc", "Easiest first"], ["difficulty-desc", "Hardest first"], ["platform-asc", "Platform: A–Z"], ["platform-desc", "Platform: Z–A"],
  ["genre-asc", "Genre: A–Z"], ["genre-desc", "Genre: Z–A"], ["status-asc", "Status: Playing first"], ["status-desc", "Status: Dropped first"]];

export default function StandardLibraryView({ controller: c }: { controller: GameLibraryController }) {
  const copy = useLayoutCopy();
  return <div className="standard-library-view">
    <UpNextDeckView controller={c.deck} />
    <header className="standard-library-heading">
      <div><h2 id="collection-title">{copy("System Playqueue", "Your Quest Journal", "libraryTitle")}</h2><p>{c.games.length} {c.games.length === 1 ? "game" : "games"} · Your next favorite is in here.</p></div>
      <div className="standard-library-tools"><SocialHubTrigger controller={c.social} /><button type="button" className="standard-primary" onClick={openStandardAddGame}>+ Add Game</button></div>
    </header>
    <div className="standard-library-controls">
      <div className="standard-status-tabs" role="group" aria-label="Library view">{views.map(view => <button type="button" key={view} aria-pressed={c.activeView === view} onClick={() => c.changeView(view)}>{view === "Flatlined" ? "Dropped" : view === "All" ? "All Games" : view}<span>{c.viewCounts[view]}</span></button>)}</div>
      <div className="standard-search-toolbar">
        <label className="standard-search"><span>Search library</span><input type="search" value={c.searchQuery} placeholder="Search games, platforms, or genres…" onChange={event => c.setSearchQuery(event.target.value)} /></label>
        <label><span>Sort by</span><select aria-label="Sort games" value={c.sortBy} onChange={event => c.setSortBy(event.target.value)}>{sorts.filter(([value]) => value !== "custom-priority" || c.activeView === "Backlog" && !c.selectedSaga).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <details className="standard-filters"><summary>Filters</summary><div className="standard-filter-fields">
          <label>Platform<select value={c.platformFilter} onChange={event => c.setPlatformFilter(event.target.value)}><option value="">All platforms</option>{c.platforms.map(platform => <option key={platform}>{platform}</option>)}</select></label>
          <label>Genre<select value={c.genreFilter} onChange={event => c.setGenreFilter(event.target.value)}><option value="">All genres</option>{c.genres.map(genre => <option key={genre}>{genre}</option>)}</select></label>
          <OwnershipFilterControl value={c.ownershipFilter} onChange={c.setOwnershipFilter} />
          <HypedOnlyFilter active={c.hypedOnly} onChange={c.setHypedOnly} />
        </div></details>
      </div>
      {c.hasActiveFilters && <div className="standard-filter-summary"><span>{c.visibleGames.length} matching games{c.selectedCustomList ? ` in ${c.selectedCustomList.title}` : ""}{c.selectedSaga ? ` in ${c.selectedSaga.name}` : ""}</span><button type="button" onClick={c.clearFilters}>Clear filters</button></div>}
    </div>
    {c.backlogNotice && <p role="status">{c.backlogNotice.text}</p>}{c.deckReturnNotice && <p role="status">{c.deckReturnNotice.text}</p>}
    <StandardGameGrid controller={c} key={JSON.stringify([c.activeView, c.searchQuery, c.platformFilter, c.genreFilter, c.ownershipFilter, c.hypedOnly, c.sortBy, c.selectedCustomList?.id, c.selectedSaga?.key])} />
    <div className="standard-library-extras" aria-label="More library tools">
      <LibraryTelemetry games={c.games} />
      <CustomLists controller={c} />
      <SagaChains chains={c.chains} selectedKey={c.selectedSaga?.key ?? ""} onSelect={c.selectSaga} {...c.sagaOrderControls} />
    </div>
  </div>;
}

function StandardGameGrid({ controller: c }: { controller: GameLibraryController }) {
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    if (c.revealedGameId == null) return;
    const position = c.visibleGames.findIndex(game => game.id === c.revealedGameId);
    if (position >= 0) setPage(Math.floor(position / pageSize));
  }, [c.revealedGameId, c.visibleGames]);
  const pages = Math.ceil(c.visibleGames.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  const start = currentPage * pageSize;
  const games = c.visibleGames.slice(start, start + pageSize);
  function turnPage(next: number) {
    setPage(next);
    requestAnimationFrame(() => document.getElementById("standard-game-grid")?.focus());
  }
  return <>
    <ul className="standard-game-grid" id="standard-game-grid" aria-label="Game library" tabIndex={-1}
      onDragOver={c.dragOverBacklog} onDragLeave={c.leaveBacklog} onDrop={c.dropDeckIntoBacklog}>
      {games.map(game => <li className="standard-game-card" key={game.id} data-library-game-id={game.id} data-status={game.status}
        data-reorder-row-id={game.id} data-deck-draggable={c.canDragToDeck(game) || undefined}
        data-dragging={c.dragSourceId === game.id || undefined}
        data-drop-target={c.dropTargetId === game.id || undefined} draggable={(c.canDragToDeck(game) || c.isReorderableRow(game.id)) && !c.rowReorderBusy}
        onPointerDownCapture={event => c.rememberDragOrigin({ gameId: game.id, source: "table" }, event.target instanceof Element && Boolean(event.target.closest(".hype-meter, button:not(.standard-card-cover), input, select, textarea, a, summary, [contenteditable='true']")))}
        onDragStart={event => c.startLibraryDrag(event, { gameId: game.id, source: "table" })} onDragEnd={c.endRowDrag}
        onDragOver={event => c.dragOverLibraryGame(event, game.id)} onDragLeave={event => c.leaveLibraryGame(event, game.id)} onDrop={event => c.dropRowGame(event, game.id)}>
        <button className="standard-card-cover" type="button" aria-label={`View details for ${game.title}`} data-metadata-trigger-id={game.id} onClick={() => c.openMetadata(game)}>
          {game.coverUrl ? <StandardCover src={game.coverUrl} /> : <span className="standard-cover-placeholder" aria-hidden="true"><span>◇</span>No cover art</span>}
          <span className="standard-status-badge" data-status={game.status}>{game.status === "Flatlined" ? "Dropped" : game.status}</span>
        </button>
        <div className="standard-card-content"><h3 title={game.title}>{game.title}</h3><p className="standard-card-meta">{game.platform || "No platform"}<span aria-hidden="true"> · </span>Est. {game.lengthHours}h</p>
          <div className="standard-card-footer"><HypeMeter gameId={game.id} hypeLevel={game.hypeLevel} title={game.title} compact />
          {game.status === "Backlog" && !isUnreleasedYear(game.releaseYear, c.currentYear) ? <SafeForm action={c.startGameAndShowPlaying} className="standard-quick-start"><input type="hidden" name="id" value={game.id} /><input type="hidden" name="lengthHours" value={game.lengthHours} /><input type="hidden" name="difficulty" value={game.difficulty} /><button type="submit" className="standard-primary" aria-label={`Start playing ${game.title}`}>Start Playing</button></SafeForm>
            : <button className="standard-card-action" type="button" onClick={() => c.openMetadata(game)}>{isUnreleasedYear(game.releaseYear, c.currentYear) ? "Upcoming · View Details" : "Edit / Details"}</button>}
          </div>
        </div>
      </li>)}
    </ul>
    {!games.length && <div className="standard-library-empty"><span aria-hidden="true">◇</span><h3>{c.games.length ? "No matching games" : "Make room for your next adventure"}</h3><p>{c.games.length ? "Try another search or clear your filters." : "Add your first game to start building your library."}</p><button type="button" className="standard-primary" onClick={c.games.length ? c.clearFilters : openStandardAddGame}>{c.games.length ? "Clear filters" : "+ Add Game"}</button></div>}
    {pages > 1 && <nav className="standard-pagination" aria-label="Library pages"><span>{start + 1}–{start + games.length} of {c.visibleGames.length} games</span><button type="button" disabled={currentPage === 0} onClick={() => turnPage(currentPage - 1)}>Previous</button><span aria-live="polite">Page {currentPage + 1} of {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => turnPage(currentPage + 1)}>Next</button></nav>}
  </>;
}

function StandardCover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="standard-cover-placeholder" aria-hidden="true"><span>◇</span>Cover unavailable</span> :
    // eslint-disable-next-line @next/next/no-img-element -- Preserve the existing lazy catalog thumbnails.
    <img src={src} alt="" width={320} height={180} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}
