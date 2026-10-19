"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { completeGame, deleteGame, flatlineGame, logPlaySession, startGame, updateGame } from "@/app/actions";
import type { Achievement } from "@/lib/achievements";
import StarRatingInput from "@/components/StarRatingInput";
import LibraryDataVault from "@/components/LibraryDataVault";
import LibraryTelemetry from "@/components/LibraryTelemetry";
import TrophyRatingEditor from "@/components/TrophyRatingEditor";
import TacticalAdvisor from "@/components/TacticalAdvisor";
import { buildTrailerUrl } from "@/lib/trailers";

export type LibraryGame = {
  id: number;
  title: string;
  platform: string;
  status: string;
  wasFlatlined: boolean;
  lengthHours: number;
  hoursPlayed: number;
  notes: string | null;
  rating: number | null;
  difficulty: number;
  earnedXp: number;
  coverUrl: string | null;
  backupCoverUrl?: string | null;
  genre: string | null;
  releaseYear: number | null;
};

const statuses = ["Backlog", "Playing", "Completed", "Flatlined"];
const views = ["All", "Playing", "Backlog", "Completed", "Flatlined"] as const;
type LibraryView = typeof views[number];
type SortColumn = "title" | "platform" | "genre" | "year" | "status" | "hours" | "difficulty" | "xp";
const statusPriority: Record<string, number> = { Playing: 0, Backlog: 1, Completed: 2, Flatlined: 3 };
const primaryColumnSort = {
  title: "title-asc",
  platform: "platform-asc",
  genre: "genre-asc",
  year: "year-desc",
  status: "status-asc",
  hours: "hours-asc",
  difficulty: "difficulty-desc",
  xp: "xp-desc",
} as const;
const difficultyLabels: Record<number, string> = { 1: "Easy", 2: "Medium", 3: "Tough" };

function sortableXp(game: LibraryGame) {
  return game.status === "Flatlined" ? 0 : game.earnedXp || game.lengthHours * game.difficulty * 10;
}

export default function GameLibrary({ games, achievements = [], children }: { games: LibraryGame[]; achievements?: Achievement[]; children?: ReactNode }) {
  const [activeView, setActiveView] = useState<LibraryView>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [editingMetaGame, setEditingMetaGame] = useState<LibraryGame | null>(null);
  const metadataModalRef = useRef<HTMLFormElement>(null);
  const [isLogging, startLogging] = useTransition();
  const [sessionError, setSessionError] = useState<{ gameId: number; message: string } | null>(null);

  function logSession(gameId: number, addHours: number) {
    setSessionError(null);
    startLogging(async () => {
      try {
        await logPlaySession(gameId, addHours);
      } catch {
        setSessionError({ gameId, message: "Could not log this session. Please try again." });
      }
    });
  }

  useEffect(() => {
    if (!editingMetaGame) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = metadataModalRef.current;
    modal?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setEditingMetaGame(null);
      }
      if (event.key === "Tab" && modal) {
        const controls = modal.querySelectorAll<HTMLElement>('input:not([type="hidden"]), button');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [editingMetaGame]);

  const { platforms, genres, viewCounts } = useMemo(() => ({
    platforms: [...new Set(games.map((game) => game.platform.trim()).filter(Boolean))].sort(),
    genres: [...new Set(games.flatMap((game) => game.genre?.trim() ? [game.genre.trim()] : []))].sort(),
    viewCounts: {
      All: games.length,
      Playing: games.filter((game) => game.status === "Playing").length,
      Backlog: games.filter((game) => game.status === "Backlog").length,
      Completed: games.filter((game) => game.status === "Completed").length,
      Flatlined: games.filter((game) => game.status === "Flatlined").length,
    },
  }), [games]);

  const visibleGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = games.filter((game) => (
      (activeView === "All" || game.status === activeView) &&
      (!platformFilter || game.platform.trim() === platformFilter) &&
      (!genreFilter || game.genre?.trim() === genreFilter) &&
      (!query || [game.title, game.genre, game.platform].some((value) => value?.toLowerCase().includes(query)))
    ));
    if (sortBy === "default") return filtered;

    return [...filtered].sort((left, right) => {
      switch (sortBy) {
        case "hours-asc":
          return left.lengthHours - right.lengthHours;
        case "hours-desc":
          return right.lengthHours - left.lengthHours;
        case "xp-desc":
          return sortableXp(right) - sortableXp(left);
        case "xp-asc":
          return sortableXp(left) - sortableXp(right);
        case "year-desc":
        case "year-asc":
          if (left.releaseYear === null && right.releaseYear === null) return 0;
          if (left.releaseYear === null) return 1;
          if (right.releaseYear === null) return -1;
          return sortBy === "year-desc"
            ? right.releaseYear - left.releaseYear
            : left.releaseYear - right.releaseYear;
        case "title-asc":
          return left.title.localeCompare(right.title);
        case "title-desc":
          return right.title.localeCompare(left.title);
        case "platform-asc":
          return left.platform.localeCompare(right.platform);
        case "platform-desc":
          return right.platform.localeCompare(left.platform);
        case "genre-asc":
        case "genre-desc": {
          const leftGenre = left.genre?.trim() || "";
          const rightGenre = right.genre?.trim() || "";
          if (!leftGenre && !rightGenre) return 0;
          if (!leftGenre) return 1;
          if (!rightGenre) return -1;
          return sortBy === "genre-asc"
            ? leftGenre.localeCompare(rightGenre)
            : rightGenre.localeCompare(leftGenre);
        }
        case "status-asc":
          return (statusPriority[left.status] ?? 4) - (statusPriority[right.status] ?? 4);
        case "status-desc":
          return (statusPriority[right.status] ?? 4) - (statusPriority[left.status] ?? 4);
        case "difficulty-desc":
          return right.difficulty - left.difficulty;
        case "difficulty-asc":
          return left.difficulty - right.difficulty;
        default:
          return 0;
      }
    });
  }, [games, activeView, searchQuery, platformFilter, genreFilter, sortBy]);
  const hasActiveFilters = activeView !== "All" || searchQuery !== "" || platformFilter !== "" || genreFilter !== "" || sortBy !== "default";

  function clearFilters() {
    setActiveView("All");
    setSearchQuery("");
    setPlatformFilter("");
    setGenreFilter("");
    setSortBy("default");
  }

  function toggleColumnSort(column: SortColumn) {
    const primary = primaryColumnSort[column];
    const reverse = primary.endsWith("asc") ? `${column}-desc` : `${column}-asc`;
    setSortBy((current) => current === primary ? reverse : primary);
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

  function renderMetadataFields(game: LibraryGame) {
    return (
      <div className="metadata-modal-fields">
        <label>
          Title
          <input name="title" defaultValue={game.title} maxLength={120} required aria-label={`Title for ${game.title}`} />
        </label>
        <label>
          Platform
          <input name="platform" defaultValue={game.platform} maxLength={80} required aria-label={`Platform for ${game.title}`} />
        </label>
        <label>
          Genre
          <input name="genre" defaultValue={game.genre ?? ""} aria-label={`Genre for ${game.title}`} />
        </label>
        <label>
          Release year
          <input name="releaseYear" type="number" min="1800" max="2100" step="1" defaultValue={game.releaseYear ?? ""} aria-label={`Release year for ${game.title}`} />
        </label>
        <label>
          Cover image URL
          <input name="coverUrl" type="url" defaultValue={game.coverUrl ?? ""} placeholder="https://..." aria-label={`Cover URL for ${game.title}`} />
        </label>
      </div>
    );
  }

  function renderCardControls(game: LibraryGame) {
    return (
      <>
        <input name="id" type="hidden" value={game.id} />
        <div className="library-card-controls">
          <label>
            Status
            <select name="status" defaultValue={game.status} aria-label={`Status for ${game.title}`} required>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Est. Hours
            <input name="lengthHours" type="number" defaultValue={game.lengthHours} aria-label={`Hours for ${game.title}`} min="1" max="10000" step="1" required />
          </label>
          <label>
            Hours Played
            <input name="hoursPlayed" type="number" defaultValue={game.hoursPlayed} aria-label={`Hours played for ${game.title}`} min="0" max="10000" step="1" required />
          </label>
          <label>
            Difficulty
            <select name="difficulty" defaultValue={game.difficulty} aria-label={`Difficulty for ${game.title}`} required>
              {[1, 2, 3].map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty} · {difficultyLabels[difficulty]}</option>)}
            </select>
          </label>
          <div className="star-rating-field">
            <span>Rating</span>
            <StarRatingInput defaultValue={game.rating} label={`Rating for ${game.title}`} />
          </div>
        </div>
        <label className="field-log-label">
          NETRUNNER FIELD LOG
          <textarea className="field-log-textarea" name="notes" rows={3} maxLength={1000} defaultValue={game.notes ?? ""} placeholder="Log current checkpoint, build notes, or session thoughts..." />
        </label>
        <div className="library-card-actions">
          <button className="status-save" type="submit">Save</button>
          <button className="delete-button" formAction={deleteGame} formNoValidate type="submit">Delete</button>
          {game.status === "Playing" && (
            <button className="flatline-gig-button" formAction={flatlineGame} type="submit">💀 FLATLINE GIG</button>
          )}
          {game.status === "Flatlined" && (
            <button className="revive-gig-button" formAction={startGame} type="submit">▶ REVIVE GIG</button>
          )}
          {game.status === "Playing" && (
            <a className="trailer-link-button" href={buildTrailerUrl(game.title, game.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
          )}
          <button type="button" className="edit-meta-btn" onClick={() => setEditingMetaGame(game)}>⚙ EDIT META</button>
        </div>
      </>
    );
  }

  return (
    <section className="collection" aria-labelledby="collection-title">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">02 / YOUR LIBRARY</p>
          <h2 id="collection-title">System Playqueue</h2>
        </div>
        <div className="collection-heading-actions">
          <p className="game-count" role="status">
            <strong>{hasActiveFilters ? `${visibleGames.length} / ${games.length}` : String(games.length).padStart(2, "0")}</strong>
            <span>{!hasActiveFilters && visibleGames.length === 1 ? "game" : "games"}</span>
          </p>
          {children}
          <TacticalAdvisor games={games} />
          <LibraryDataVault games={games} />
        </div>
      </div>

      <LibraryTelemetry games={games} />

      <div className="library-tabs" role="group" aria-label="Library view">
        {views.map((view) => (
          <button
            key={view}
            type="button"
            data-view={view.toLowerCase()}
            aria-pressed={activeView === view}
            onClick={() => setActiveView(view)}
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
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">+</span>
            <p>{games.length === 0 ? "Your list is clear. Add a game to get started." : "No games match. Try another view or clear your filters."}</p>
          </div>
        ) : activeView === "Playing" || activeView === "Flatlined" ? (
          <div className="playing-spotlight-grid">
            {visibleGames.map((game) => (
              <form
                action={updateGame}
                className="spotlight-card"
                data-status={game.status}
                key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}`}
              >
                {renderCardCover(game, "spotlight-cover")}
                <div className="spotlight-card-body">
                  <p className="spotlight-badge">{game.status === "Flatlined" ? "💀 FLATLINED // SHELVED" : "LIVE GIG // IN PROGRESS"}</p>
                  <h3>{game.title}</h3>
                  <p className="library-card-metadata">{game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}</p>
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
                  {renderCardControls(game)}
                  {game.status === "Playing" && (
                    <button type="submit" formAction={completeGame} className="complete-gig-button">
                      🏆 COMPLETE GIG (+{Math.max(game.lengthHours, game.hoursPlayed) * game.difficulty * 10} XP)
                    </button>
                  )}
                </div>
              </form>
            ))}
          </div>
        ) : activeView === "Completed" ? (
          <div className="trophy-grid">
            {visibleGames.map((game) => (
              <article className="trophy-card" key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}`}>
                <p className="trophy-badge">🏆 GIG CLEARED</p>
                {renderCardCover(game, "trophy-cover")}
                <div className="trophy-card-body">
                  <h3>{game.title}</h3>
                  {game.wasFlatlined && <p className="trophy-revived-badge">⚡ REVIVED FROM FLATLINE</p>}
                  <p className="library-card-metadata">{game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}</p>
                  <p className="trophy-record">{game.hoursPlayed}h played · {game.lengthHours}h length · Tier {game.difficulty} / {difficultyLabels[game.difficulty]}</p>
                  <p className="trophy-reward">+{game.earnedXp.toLocaleString()} XP</p>
                  <TrophyRatingEditor game={game} />
                  {game.notes?.trim() && (
                    <div className="trophy-field-log">
                      <span>NETRUNNER FIELD LOG</span>
                      <p>{game.notes}</p>
                    </div>
                  )}
                  <details className="trophy-edit-drawer">
                    <summary>Manage Record</summary>
                    <form action={updateGame} key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}`}>
                      {renderCardControls(game)}
                    </form>
                  </details>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="game-table" role="table" aria-label="Saved games">
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
              <form
                action={updateGame}
                className="game-row"
                data-status={game.status}
                key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}`}
                role="row"
              >
                <input name="id" type="hidden" value={game.id} />
                <span className="game-name" role="cell">
                  <span className="mobile-label">Game</span>
                  <span className="game-identity">
                    {game.coverUrl ? (
                      <img
                        alt={`${game.title} cover art`}
                        className="game-cover"
                        decoding="async"
                        loading="lazy"
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
                    <span className="game-title-stack">
                      <strong>{game.title}</strong>
                      <span className="game-title-actions">
                        {(game.status === "Backlog" || game.status === "Flatlined") && (
                          <button className="start-gig-badge" formAction={startGame} type="submit">{game.status === "Flatlined" ? "▶ REVIVE GIG" : "▶ START GIG"}</button>
                        )}
                        <button type="button" className="edit-meta-btn" onClick={() => setEditingMetaGame(game)}>⚙ EDIT META</button>
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
                  {game.genre?.trim() || "—"}
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
                    defaultValue={game.status}
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
                    defaultValue={game.lengthHours}
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
                    defaultValue={game.difficulty}
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
                  <button
                    className="delete-button"
                    formAction={deleteGame}
                    formNoValidate
                    type="submit"
                  >
                    Delete
                  </button>
                </span>
              </form>
            ))}
          </div>
        )}
      </div>
      {editingMetaGame && (
        <div className="metadata-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) setEditingMetaGame(null);
        }}>
          <form
            className="metadata-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="metadata-modal-title"
            ref={metadataModalRef}
            action={updateGame}
            onSubmit={() => setEditingMetaGame(null)}
            key={`${editingMetaGame.id}-${editingMetaGame.status}-${editingMetaGame.lengthHours}-${editingMetaGame.difficulty}-${editingMetaGame.title}-${editingMetaGame.platform}-${editingMetaGame.genre ?? ""}-${editingMetaGame.releaseYear ?? ""}-${editingMetaGame.coverUrl ?? ""}-${editingMetaGame.hoursPlayed}-${editingMetaGame.notes ?? ""}-${editingMetaGame.rating ?? ""}`}
          >
            <p className="eyebrow">RECORD // METADATA EDITOR</p>
            <h2 id="metadata-modal-title">Edit Game Metadata</h2>
            <input type="hidden" name="id" value={editingMetaGame.id} />
            <input type="hidden" name="status" value={editingMetaGame.status} />
            <input type="hidden" name="lengthHours" value={editingMetaGame.lengthHours} />
            <input type="hidden" name="difficulty" value={editingMetaGame.difficulty} />
            {renderMetadataFields(editingMetaGame)}
            <div className="metadata-modal-actions">
              <button className="metadata-save-btn" type="submit">SAVE METADATA</button>
              <button className="metadata-cancel-btn" type="button" onClick={() => setEditingMetaGame(null)}>CANCEL</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
