import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { resizeRawgImageUrl } from "@/lib/rawg";
import GameForm from "./GameForm";
import GameLibrary from "@/components/GameLibrary";
import QuestRoulette from "@/components/QuestRoulette";

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

  const serializedGames = games.map((game) => ({
    id: game.id,
    title: game.title,
    platform: game.platform,
    status: game.status,
    lengthHours: game.lengthHours,
    difficulty: game.difficulty,
    earnedXp: game.earnedXp,
    coverUrl: game.coverUrl ? resizeRawgImageUrl(game.coverUrl) : null,
    genre: game.genre,
    releaseYear: game.releaseYear,
  }));

  return (
    <GameLibrary games={serializedGames}>
      <QuestRoulette games={serializedGames.filter((game) => game.status === "Backlog")} />
    </GameLibrary>
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
                Initialize Game Entry
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
