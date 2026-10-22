import { calculateLevelProgress } from "@/lib/player-level";
import { cache, Suspense } from "react";
import Link from "next/link";
import { FantasyCorners } from "@/components/FantasyAccents";
import LayoutText from "@/components/LayoutText";
import OperatorAvatar from "@/components/OperatorAvatar";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { resizeRawgImageUrl } from "@/lib/rawg";
import GameForm from "./GameForm";
import MemberCount from "@/components/MemberCount";
import WorkspaceShell from "@/components/WorkspaceShell";
import GameLibrary from "@/components/GameLibrary";
import AchievementToast from "@/components/AchievementToast";
import HudMilestones from "@/components/HudMilestones";
import NetrunnerDossier from "@/components/NetrunnerDossier";
import { calculateLibraryTelemetry } from "@/lib/library-telemetry";
import { syncAndGetAchievements } from "@/lib/achievements";
import { getCurrentPlayer, type CurrentPlayer } from "@/lib/player";
import { getCurrentPlayerProfile } from "@/lib/player-profile";
import AccountControls, { AccountGate } from "@/components/AccountControls";

// Share one sync promise per player during this render, without caching Server Actions.
const getPageAchievements = cache((userId: string) => syncAndGetAchievements(userId));

const statusPriority: Record<string, number> = {
  Playing: 0,
  Backlog: 1,
  Completed: 2,
  Flatlined: 3,
};


async function PlayerSummary({ player }: { player: CurrentPlayer }) {
  await connection();

  const [games, achievements, profile] = await Promise.all([
    prisma.game.findMany({
      where: { userId: player.id },
      select: { id: true, title: true, platform: true, genre: true, coverUrl: true, rating: true, earnedXp: true, status: true, lengthHours: true, hoursPlayed: true },
    }),
    getPageAchievements(player.id),
    getCurrentPlayerProfile(),
  ]);
  const badgeXp = await prisma.userAchievement.aggregate({
    where: { userId: player.id },
    _sum: { xpAwarded: true },
  });
  const totalXp = Math.round(
    games.reduce((total, game) => total + game.earnedXp, 0) +
    (badgeXp._sum.xpAwarded ?? 0),
  );
  const backlogCount = games.filter((game) => game.status === "Backlog").length;
  const playingCount = games.filter((game) => game.status === "Playing").length;
  const completedCount = games.filter(
    (game) => game.status === "Completed",
  ).length;
  const flatlinedCount = games.filter((game) => game.status === "Flatlined").length;
  const progress = calculateLevelProgress(totalXp);
  const telemetry = calculateLibraryTelemetry(games);
  const trophies = games.filter((game) => game.status === "Completed" && game.rating === 5)
    .sort((left, right) => right.earnedXp - left.earnedXp || left.title.localeCompare(right.title) || left.id - right.id)
    .map((game) => ({ id: game.id, title: game.title, platform: game.platform, coverUrl: game.coverUrl ? resizeRawgImageUrl(game.coverUrl) : null, earnedXp: game.earnedXp }));

  return (
    <section className="player-summary" aria-label="Player stats">
      <FantasyCorners />
      <div className="fantasy-status-heading"><p className="fantasy-kicker">QUEST STATUS</p><h2>The Hero’s Record</h2><span aria-hidden="true" className="fantasy-hearts">♥ ♥ ♥ ♥ ♥</span><span className="fantasy-heart-caption">Heart of an adventurer · Rank {progress.level}</span></div>
      <AchievementToast playerId={player.id} achievements={achievements} level={progress.level} totalXp={totalXp} />
      <Link className="hud-brand" href="/" aria-label="Backlog Buster home">
        <span className="wordmark-icon">
          <OperatorAvatar className="hud-brand-logo" fantasyFallback avatarUrl={profile.avatarUrl} alt={`${profile.operatorName} operator avatar`} />
        </span>
      </Link>

      <div className="summary-level">
        <span className="summary-label"><LayoutText cyberpunk="Current level" fantasy="Hero’s rank" /></span>
        <p className="summary-level-value">
          <span>LV</span>
          <strong>{progress.level.toLocaleString("en-US")}</strong>
        </p>
      </div>

      <div className="summary-total-xp">
        <span className="summary-label"><LayoutText cyberpunk="Total lifetime XP" fantasy="Lifetime renown" /></span>
        <strong>{totalXp.toLocaleString("en-US")}</strong>
      </div>

      <div className="summary-progress">
        <div className="summary-progress-heading">
          <span className="summary-label"><LayoutText cyberpunk="Next level" fantasy="Magic meter · Next rank" /></span>
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
          <p data-status="Flatlined"><strong>{flatlinedCount}</strong><span>Flatlined</span></p>
        </div>
      </div>
      <AccountControls player={{ ...player, operatorName: profile.operatorName, handle: profile.handle }} key={`${player.id}-${player.isLocal}`} />
      <div className="hud-career-tools">
        <HudMilestones achievements={achievements} />
        <NetrunnerDossier data={{
          profile,
          level: progress.level, totalXp,
          counts: { Backlog: backlogCount, Playing: playingCount, Completed: completedCount, Flatlined: flatlinedCount },
          activeHours: telemetry.activeHours, completionRate: telemetry.completionRate, avgRating: telemetry.avgRating,
          achievements, trophies,
        }} />
      </div>
    </section>
  );
}

async function SavedGames({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  await connection();

  const [games, achievements] = await Promise.all([
    prisma.game.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    getPageAchievements(userId),
  ]);
  games.sort((left, right) => {
    const priorityDifference =
      (statusPriority[left.status] ?? 4) - (statusPriority[right.status] ?? 4);
    return priorityDifference || right.createdAt.getTime() - left.createdAt.getTime();
  });

  const serializedGames = games.map((game) => ({
    id: game.id,
    title: game.title,
    platform: game.platform,
    status: game.status,
    wasFlatlined: game.wasFlatlined,
    pinnedOrder: game.pinnedOrder,
    backlogOrder: game.backlogOrder,
    createdAt: game.createdAt.toISOString(),
    lengthHours: game.lengthHours,
    hoursPlayed: game.hoursPlayed,
    notes: game.notes,
    rating: game.rating,
    difficulty: game.difficulty,
    earnedXp: game.earnedXp,
    coverUrl: game.coverUrl ? resizeRawgImageUrl(game.coverUrl) : null,
    backupCoverUrl: game.coverUrl,
    genre: game.genre,
    franchise: game.franchise,
    chronologicalOrder: game.chronologicalOrder,
    releaseYear: game.releaseYear,
  }));

  return (
    <GameLibrary games={serializedGames} achievements={achievements} isAdmin={isAdmin} />
  );
}

async function PlayerWorkspace() {
  await connection();
  const player = await getCurrentPlayer();
  if (!player) return <main className="page-shell"><AccountGate /><MemberCount /></main>;
  return (
    <WorkspaceShell key={`${player.id}-${player.isLocal}`}>
      <Suspense
        fallback={
          <section className="player-summary summary-loading" aria-label="Player stats">
            Loading player stats...
          </section>
        }
      >
        <PlayerSummary player={player} />
      </Suspense>

      <section className="add-section" data-workspace-pane="chronicle" aria-labelledby="add-title">
        <FantasyCorners />
        <details className="add-disclosure">
          <summary className="section-heading">
            <span className="section-heading-copy">
              <span className="eyebrow">01 / NEW ENTRY</span>
              <span className="section-heading-title" id="add-title">
                <span className="cyberpunk-label">Initialize Game Entry</span><span className="fantasy-label">Inscribe New Quest</span>
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
        <SavedGames userId={player.id} isAdmin={!player.isLocal && player.isAdmin} />
      </Suspense>

      <MemberCount />
      <footer className="page-footer">
        <span>BACKLOG BUSTER</span>
        <span>YOUR PACE. YOUR PLAYTHROUGH.</span>
      </footer>
    </WorkspaceShell>
  );
}

export default function Home() {
  return <Suspense fallback={<main className="page-shell"><p className="loading-state">VERIFYING OPERATOR SESSION…</p></main>}><PlayerWorkspace /></Suspense>;
}
