"use client";

import { useMemo, useState, type ReactNode } from "react";
import { completeGame, deleteGame, startGame, updateGame } from "@/app/actions";

export type LibraryGame = {
  id: number;
  title: string;
  platform: string;
  status: string;
  lengthHours: number;
  difficulty: number;
  earnedXp: number;
  coverUrl: string | null;
  genre: string | null;
  releaseYear: number | null;
};

const statuses = ["Backlog", "Playing", "Completed"];
const views = ["All", "Playing", "Backlog", "Completed"] as const;
type LibraryView = typeof views[number];
type SortColumn = "title" | "platform" | "genre" | "year" | "status" | "hours" | "difficulty" | "xp";
const statusPriority: Record<string, number> = { Playing: 0, Backlog: 1, Completed: 2 };
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

export default function GameLibrary({ games, children }: { games: LibraryGame[]; children?: ReactNode }) {
  const [activeView, setActiveView] = useState<LibraryView>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [sortBy, setSortBy] = useState("default");

  const { platforms, genres, viewCounts } = useMemo(() => ({
    platforms: [...new Set(games.map((game) => game.platform.trim()).filter(Boolean))].sort(),
    genres: [...new Set(games.flatMap((game) => game.genre?.trim() ? [game.genre.trim()] : []))].sort(),
    viewCounts: {
      All: games.length,
      Playing: games.filter((game) => game.status === "Playing").length,
      Backlog: games.filter((game) => game.status === "Backlog").length,
      Completed: games.filter((game) => game.status === "Completed").length,
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
          return (right.earnedXp || right.lengthHours * right.difficulty * 10) -
            (left.earnedXp || left.lengthHours * left.difficulty * 10);
        case "xp-asc":
          return (left.earnedXp || left.lengthHours * left.difficulty * 10) -
            (right.earnedXp || right.lengthHours * right.difficulty * 10);
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
          return (statusPriority[left.status] ?? 3) - (statusPriority[right.status] ?? 3);
        case "status-desc":
          return (statusPriority[right.status] ?? 3) - (statusPriority[left.status] ?? 3);
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
            Hours
            <input name="lengthHours" type="number" defaultValue={game.lengthHours} aria-label={`Hours for ${game.title}`} min="1" max="10000" step="1" required />
          </label>
          <label>
            Difficulty
            <select name="difficulty" defaultValue={game.difficulty} aria-label={`Difficulty for ${game.title}`} required>
              {[1, 2, 3].map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty} · {difficultyLabels[difficulty]}</option>)}
            </select>
          </label>
        </div>
        <div className="library-card-actions">
          <button className="status-save" type="submit">Save</button>
          <button className="delete-button" formAction={deleteGame} formNoValidate type="submit">Delete</button>
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
        </div>
      </div>

      <div className="library-tabs" role="group" aria-label="Library view">
        {views.map((view) => (
          <button
            key={view}
            type="button"
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
            <option value="status-asc">Status: Playing → Completed</option>
            <option value="status-desc">Status: Completed → Playing</option>
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
        )}
        {visibleGames.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">+</span>
            <p>{games.length === 0 ? "Your list is clear. Add a game to get started." : "No games match. Try another view or clear your filters."}</p>
          </div>
        ) : activeView === "Playing" ? (
          <div className="playing-spotlight-grid">
            {visibleGames.map((game) => (
              <form
                action={updateGame}
                className="spotlight-card"
                key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}`}
              >
                {renderCardCover(game, "spotlight-cover")}
                <div className="spotlight-card-body">
                  <p className="spotlight-badge">LIVE GIG // IN PROGRESS</p>
                  <h3>{game.title}</h3>
                  <p className="library-card-metadata">{game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}</p>
                  <div className="spotlight-bounty">
                    <span>Potential XP Bounty</span>
                    <strong>{(game.lengthHours * game.difficulty * 10).toLocaleString()} XP</strong>
                  </div>
                  {renderCardControls(game)}
                  <button type="submit" formAction={completeGame} className="complete-gig-button">
                    🏆 COMPLETE GIG (+{game.lengthHours * game.difficulty * 10} XP)
                  </button>
                </div>
              </form>
            ))}
          </div>
        ) : activeView === "Completed" ? (
          <div className="trophy-grid">
            {visibleGames.map((game) => (
              <article className="trophy-card" key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}`}>
                <p className="trophy-badge">🏆 GIG CLEARED</p>
                {renderCardCover(game, "trophy-cover")}
                <div className="trophy-card-body">
                  <h3>{game.title}</h3>
                  <p className="library-card-metadata">{game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}</p>
                  <p className="trophy-record">{game.lengthHours}h logged · Tier {game.difficulty} / {difficultyLabels[game.difficulty]}</p>
                  <p className="trophy-reward">+{game.earnedXp.toLocaleString()} XP</p>
                  <details className="trophy-edit-drawer">
                    <summary>Manage Record</summary>
                    <form action={updateGame} key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}`}>
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
                key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}`}
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
                      {game.status === "Backlog" && (
                        <button className="start-gig-badge" formAction={startGame} type="submit">▶ START GIG</button>
                      )}
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
    </section>
  );
}
