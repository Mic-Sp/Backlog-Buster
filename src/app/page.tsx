import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { resizeRawgImageUrl } from "@/lib/rawg";
import { deleteGame, updateGame } from "./actions";
import GameForm from "./GameForm";

const statuses = ["Backlog", "Playing", "Completed"];
const statusPriority: Record<string, number> = {
  Playing: 0,
  Backlog: 1,
  Completed: 2,
};

function calculateLevelProgress(totalXp: number) {
  let level = 1;
  let xpForNextLevel = 500;
  let xpTowardNextLevel = totalXp;

  while (xpTowardNextLevel >= xpForNextLevel) {
    xpTowardNextLevel -= xpForNextLevel;
    level += 1;
    xpForNextLevel = Math.round(xpForNextLevel * 1.5);
  }

  return {
    level,
    xpForNextLevel,
    xpTowardNextLevel,
    progressPercent: Math.round((xpTowardNextLevel / xpForNextLevel) * 100),
  };
}

async function PlayerSummary() {
  await connection();

  const games = await prisma.game.findMany({
    select: { earnedXp: true, status: true },
  });
  const totalXp = Math.round(
    games.reduce((total, game) => total + game.earnedXp, 0),
  );
  const backlogCount = games.filter((game) => game.status === "Backlog").length;
  const playingCount = games.filter((game) => game.status === "Playing").length;
  const completedCount = games.filter(
    (game) => game.status === "Completed",
  ).length;
  const progress = calculateLevelProgress(totalXp);

  return (
    <section className="player-summary" aria-label="Player stats">
      <Link className="hud-brand" href="/" aria-label="Backlog Buster home">
        <span className="wordmark-icon" aria-hidden="true">B</span>
      </Link>

      <div className="summary-level">
        <span className="summary-label">Current level</span>
        <p className="summary-level-value">
          <span>LV</span>
          <strong>{progress.level.toLocaleString("en-US")}</strong>
        </p>
      </div>

      <div className="summary-total-xp">
        <span className="summary-label">Total lifetime XP</span>
        <strong>{totalXp.toLocaleString("en-US")}</strong>
      </div>

      <div className="summary-progress">
        <div className="summary-progress-heading">
          <span className="summary-label">Next level</span>
          <strong>
            {progress.xpTowardNextLevel.toLocaleString("en-US")} / {progress.xpForNextLevel.toLocaleString("en-US")} XP
          </strong>
        </div>
        <div
          className="summary-progress-track"
          role="progressbar"
          aria-label="Progress toward next level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.progressPercent}
          aria-valuetext={`${progress.xpTowardNextLevel} of ${progress.xpForNextLevel} XP`}
        >
          <span style={{ width: `${progress.progressPercent}%` }} />
        </div>
        <span className="summary-progress-percent">{progress.progressPercent}%</span>
      </div>

      <div className="summary-counts" aria-label="Game counts by status">
        <span className="summary-label">Games</span>
        <div className="summary-count-items">
          <p><strong>{backlogCount}</strong><span>Backlog</span></p>
          <p><strong>{playingCount}</strong><span>Playing</span></p>
          <p><strong>{completedCount}</strong><span>Completed</span></p>
        </div>
      </div>
    </section>
  );
}

async function SavedGames() {
  await connection();

  const games = await prisma.game.findMany({
    orderBy: { createdAt: "desc" },
  });
  games.sort((left, right) => {
    const priorityDifference =
      (statusPriority[left.status] ?? 3) - (statusPriority[right.status] ?? 3);
    return priorityDifference || right.createdAt.getTime() - left.createdAt.getTime();
  });

  return (
    <section className="collection" aria-labelledby="collection-title">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">02 / YOUR LIBRARY</p>
          <h2 id="collection-title">The stack</h2>
        </div>
        <p className="game-count">
          <strong>{String(games.length).padStart(2, "0")}</strong>
          <span>{games.length === 1 ? "game" : "games"}</span>
        </p>
      </div>

      {games.length === 0 ? (
        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">+</span>
          <p>Your list is clear. Add a game to get started.</p>
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
          {games.map((game) => (
            <form
              action={updateGame}
              className="game-row"
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
                      src={resizeRawgImageUrl(game.coverUrl)}
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
    </section>
  );
}

export default function Home() {
  return (
    <main className="page-shell">
      <Suspense
        fallback={
          <section className="player-summary summary-loading" aria-label="Player stats">
            Loading player stats...
          </section>
        }
      >
        <PlayerSummary />
      </Suspense>

      <section className="add-section" aria-labelledby="add-title">
        <details className="add-disclosure">
          <summary className="section-heading">
            <span className="section-heading-copy">
              <span className="eyebrow">01 / NEW ENTRY</span>
              <span className="section-heading-title" id="add-title">
                Add to the stack
              </span>
            </span>
            <span className="section-index" aria-hidden="true">+</span>
          </summary>
          <GameForm />
        </details>
      </section>

      <Suspense
        fallback={
          <section className="collection" aria-live="polite">
            <p className="loading-state">Loading your library…</p>
          </section>
        }
      >
        <SavedGames />
      </Suspense>

      <footer className="page-footer">
        <span>BACKLOG BUSTER</span>
        <span>YOUR PACE. YOUR PLAYTHROUGH.</span>
      </footer>
    </main>
  );
}
