"use client";

import { useMemo, useState, type ReactNode } from "react";
import { deleteGame, updateGame } from "@/app/actions";

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
            <option value="year-desc">Year: newest first</option>
            <option value="year-asc">Year: oldest first</option>
            <option value="title-asc">Title: A–Z</option>
          </select>
        </label>
        {hasActiveFilters && (
          <button className="library-clear" type="button" onClick={clearFilters}>CLEAR FILTERS</button>
        )}
      </div>

      <div data-view={activeView.toLowerCase()}>
        {visibleGames.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">+</span>
            <p>{games.length === 0 ? "Your list is clear. Add a game to get started." : "No games match. Try another view or clear your filters."}</p>
          </div>
        ) : (
          <div className="game-table" role="table" aria-label="Saved games">
            <div className="game-row game-row-head" role="row">
              <span role="columnheader">Game</span>
              <span role="columnheader">Platform</span>
              <span role="columnheader">Genre</span>
              <span role="columnheader">Year</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Hours</span>
              <span role="columnheader">Difficulty</span>
              <span role="columnheader">Earned XP</span>
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
