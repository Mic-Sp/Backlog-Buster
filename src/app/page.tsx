import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGame, deleteGame, updateGame } from "./actions";

const platforms = ["PC", "Switch", "PS5", "Retro"];
const statuses = ["Backlog", "Playing", "Completed"];

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
            <span role="columnheader">Status</span>
            <span role="columnheader">Hours</span>
            <span role="columnheader">Difficulty</span>
            <span role="columnheader">Earned XP</span>
            <span role="columnheader">Change status</span>
          </div>
          {games.map((game) => (
            <div className="game-row" role="row" key={game.id}>
              <span className="game-name" role="cell">
                <span className="mobile-label">Game</span>
                <strong>{game.title}</strong>
              </span>
              <span role="cell">
                <span className="mobile-label">Platform</span>
                {game.platform}
              </span>
              <span role="cell">
                <span className="mobile-label">Status</span>
                <span className="status-value">
                  <span className="status-dot" aria-hidden="true" />
                  {game.status}
                </span>
              </span>
              <span role="cell">
                <span className="mobile-label">Hours</span>
                {game.lengthHours} hrs
              </span>
              <span role="cell">
                <span className="mobile-label">Difficulty</span>
                {game.difficulty} / 3
              </span>
              <span className="xp-value" role="cell">
                <span className="mobile-label">Earned XP</span>
                {game.earnedXp.toLocaleString()} XP
              </span>
              <form action={updateGame} className="status-update-form" role="cell">
                <input name="id" type="hidden" value={game.id} />
                <span className="mobile-label">Change status</span>
                <select
                  aria-label={`New status for ${game.title}`}
                  className="status-select"
                  defaultValue={game.status}
                  name="status"
                  required
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <button className="status-save" type="submit">Save</button>
                <button
                  className="delete-button"
                  formAction={deleteGame}
                  formNoValidate
                  type="submit"
                >
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  return (
    <main className="page-shell">
      <header className="masthead">
        <Link className="wordmark" href="/" aria-label="Backlog Buster home">
          <span className="wordmark-icon" aria-hidden="true">B</span>
          <span>BACKLOG<br />BUSTER</span>
        </Link>
        <p className="masthead-note">A little progress, every session.</p>
      </header>

      <Suspense
        fallback={
          <section className="player-summary summary-loading" aria-label="Player stats">
            Loading player stats...
          </section>
        }
      >
        <PlayerSummary />
      </Suspense>

      <section className="intro">
        <p className="eyebrow">PLAYER 01 <span>•</span> SAVE FILE ACTIVE</p>
        <h1>Make room<br />for <em>one more.</em></h1>
        <p className="intro-copy">
          Keep your next adventure in sight. One game at a time.
        </p>
      </section>

      <section className="add-section" aria-labelledby="add-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / NEW ENTRY</p>
            <h2 id="add-title">Add to the stack</h2>
          </div>
          <span className="section-index" aria-hidden="true">+</span>
        </div>

        <form action={createGame} className="game-form">
          <label className="field field-title">
            <span>Game title</span>
            <input
              autoComplete="off"
              maxLength={120}
              name="title"
              placeholder="What are you playing next?"
              required
            />
          </label>

          <label className="field">
            <span>Platform</span>
            <select name="platform" defaultValue="PC" required>
              {platforms.map((platform) => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </select>
          </label>

          <label className="field field-hours">
            <span>Length <small>(hours)</small></span>
            <input
              inputMode="numeric"
              max="10000"
              min="1"
              name="lengthHours"
              placeholder="10"
              required
              step="1"
              type="number"
            />
          </label>

          <label className="field">
            <span>Difficulty</span>
            <select name="difficulty" defaultValue="1" required>
              <option value="1">1 · Easy</option>
              <option value="2">2 · Medium</option>
              <option value="3">3 · Tough</option>
            </select>
          </label>

          <button className="add-button" type="submit">
            <span aria-hidden="true">+</span> Add game
          </button>
        </form>
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
