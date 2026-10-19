"use client";

import { useMemo, useState } from "react";
import type { LibraryGame } from "@/components/GameLibrary";
import { calculateLibraryTelemetry, sortTelemetryGroups, type TelemetryGroup, type TelemetrySort } from "@/lib/library-telemetry";

export default function LibraryTelemetry({ games }: { games: LibraryGame[] }) {
  const [sortBy, setSortBy] = useState<TelemetrySort>("hours");
  const telemetry = useMemo(() => calculateLibraryTelemetry(games), [games]);
  const breakdowns = useMemo(() => [
    { title: "BY GENRE", groups: sortTelemetryGroups(telemetry.genres, sortBy) },
    { title: "BY PLATFORM", groups: sortTelemetryGroups(telemetry.platforms, sortBy) },
  ], [telemetry, sortBy]);
  const shareUsesHours = sortBy !== "games" && telemetry.activeHours > 0;

  function renderGroup(group: TelemetryGroup) {
    const share = shareUsesHours ? group.hours / telemetry.activeHours * 100
      : telemetry.totalGames > 0 ? group.total / telemetry.totalGames * 100 : 0;
    const completion = group.completed / group.total * 100;
    const shareLabel = shareUsesHours ? "Hours share" : "Games share";
    return (
      <li className="telemetry-group" key={group.name}>
        <div className="telemetry-group-heading">
          <h4>{group.name}</h4>
          <span className="telemetry-completion-badge">{group.completed} / {group.total} cleared</span>
        </div>
        <div className="telemetry-group-stats">
          <span>{group.hours.toLocaleString("en-US")}h logged</span>
          <span className="telemetry-rating-pill" data-rated={group.avgRating !== null}>
            {group.avgRating !== null ? `★ ${group.avgRating.toFixed(1)} (${group.ratedCount})` : "UNRATED"}
          </span>
        </div>
        <div className="telemetry-bar-labels"><span>{shareLabel} {share.toFixed(1)}%</span><span>Completed {completion.toFixed(1)}%</span></div>
        <div className="telemetry-dual-bars" role="img" aria-label={`${group.name}: ${share.toFixed(1)}% ${shareLabel.toLowerCase()}, ${completion.toFixed(1)}% completed`}>
          <div className="telemetry-bar-track"><span className="telemetry-hours-fill" style={{ width: `${share}%` }} /></div>
          <div className="telemetry-bar-track"><span className="telemetry-completion-fill" style={{ width: `${completion}%` }} /></div>
        </div>
      </li>
    );
  }

  return (
    <details className="telemetry-drawer">
      <summary>📊 02 // NETRUNNER TELEMETRY &amp; CRITIC MATRIX</summary>
      <div className="telemetry-content">
        <p className="telemetry-intro">ANALYTICS &amp; CRITIC BREAKDOWN // Entire library · {telemetry.totalGames.toLocaleString("en-US")} games</p>
        <dl className="telemetry-stats-grid">
          <div className="telemetry-stat"><dt>Completion Rate</dt><dd>{telemetry.completionRate.toFixed(1)}%</dd><span>{telemetry.completedCount} / {telemetry.totalGames} gigs cleared</span></div>
          <div className="telemetry-stat"><dt>Active Hours Logged</dt><dd>{telemetry.activeHours.toLocaleString("en-US")}h</dd><span>Completed + playing + flatlined sessions</span></div>
          <div className="telemetry-stat"><dt>Remaining Backlog</dt><dd>{telemetry.backlogHours.toLocaleString("en-US")}h</dd><span>Estimated hours to clear</span></div>
          <div className="telemetry-stat telemetry-critic-stat"><dt>Average Star Rating</dt><dd>{telemetry.avgRating !== null ? `${telemetry.avgRating.toFixed(1)} ★` : "UNRATED"}</dd><span>{telemetry.ratedCount} rated games</span></div>
        </dl>

        <section className="telemetry-distribution" aria-label="Star rating distribution">
          <h3>CRITIC SCORE DISTRIBUTION <span>Share of rated games</span></h3>
          <ul>
            {telemetry.distribution.map(({ rating, count, percentage }) => (
              <li key={rating}>
                <div className="telemetry-distribution-label"><span>{rating}★</span><strong>{count}</strong><span>{percentage.toFixed(1)}%</span></div>
                <div className="telemetry-bar-track" role="img" aria-label={`${rating} stars: ${count} games, ${percentage.toFixed(1)}% of rated games`}>
                  <span className="telemetry-completion-fill" style={{ width: `${percentage}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="telemetry-matrix-heading">
          <h3>LIBRARY BREAKDOWN</h3>
          <div className="telemetry-sort" role="group" aria-label="Sort telemetry breakdowns">
            {([
              ["hours", "Most Hours"], ["rating", "Highest Avg Rating"], ["games", "Most Games"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={sortBy === value} onClick={() => setSortBy(value)}>{label}</button>
            ))}
          </div>
        </div>
        <p className="telemetry-legend">Cyan: share of {shareUsesHours ? "active hours" : "games"} across the library. Gold: completion within each group.</p>
        <div className="telemetry-matrix">
          {breakdowns.map(({ title, groups }) => (
            <section className="telemetry-breakdown" key={title} aria-label={title === "BY GENRE" ? "Genre breakdown" : "Platform breakdown"}>
              <h3>{title}</h3>
              {groups.length > 0 ? <ul>{groups.map(renderGroup)}</ul> : <p className="telemetry-empty">No games yet. Add or import a gig to start tracking.</p>}
            </section>
          ))}
        </div>
      </div>
    </details>
  );
}
