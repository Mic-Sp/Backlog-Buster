"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import WorkspaceSection from "@/components/WorkspaceSection";
import { useMemo, useState } from "react";
import type { LibraryGame } from "@/components/GameLibrary";
import { calculateLibraryTelemetry, sortTelemetryGroups, type TelemetryGroup, type TelemetrySort } from "@/lib/library-telemetry";

export default function LibraryTelemetry({ games }: { games: LibraryGame[] }) {
  const copy = useLayoutCopy();
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
    <WorkspaceSection sectionKey="telemetry" className="telemetry-drawer" label="telemetry" title={copy("Netrunner Telemetry & Critic Matrix", "Library records & ratings")} defaultOpen={false}
      summary={<span className="workspace-section-count">{telemetry.totalGames} games</span>}>
      <div className="telemetry-content">
        <p className="telemetry-intro">ANALYTICS &amp; CRITIC BREAKDOWN // Entire library · {telemetry.totalGames.toLocaleString("en-US")} games</p>
        <WorkspaceSection sectionKey="telemetry-stats" className="telemetry-subsection" label="library stats" title="Library stats" headingLevel={4}
          summary={<span className="workspace-section-count">{telemetry.completedCount} cleared</span>}>
        <dl className="telemetry-stats-grid">
          <div className="telemetry-stat"><dt>Completion Rate</dt><dd>{telemetry.completionRate.toFixed(1)}%</dd><span>{telemetry.completedCount} / {telemetry.totalGames} {copy("gigs cleared", "games cleared")}</span></div>
          <div className="telemetry-stat"><dt>Active Hours Logged</dt><dd>{telemetry.activeHours.toLocaleString("en-US")}h</dd><span>Completed + playing + flatlined sessions</span></div>
          <div className="telemetry-stat"><dt>Remaining Backlog</dt><dd>{telemetry.backlogHours.toLocaleString("en-US")}h</dd><span>Estimated hours to clear</span></div>
          <div className="telemetry-stat telemetry-critic-stat"><dt>Average Star Rating</dt><dd>{telemetry.avgRating !== null ? `${telemetry.avgRating.toFixed(1)} ★` : "UNRATED"}</dd><span>{telemetry.ratedCount} rated games</span></div>
        </dl>
        </WorkspaceSection>

        <WorkspaceSection sectionKey="rating-distribution" className="telemetry-distribution" label="star rating distribution" title="Critic score distribution" headingLevel={4}
          summary={<span className="workspace-section-count">{telemetry.ratedCount} rated</span>}>
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
        </WorkspaceSection>

        <WorkspaceSection sectionKey="library-breakdown" className="telemetry-library-breakdown" label="library breakdown" title="Library breakdown" headingLevel={4}
          summary={<span className="workspace-section-count">{telemetry.genres.length} genres · {telemetry.platforms.length} platforms</span>}>
          <div className="telemetry-sort" role="group" aria-label="Sort telemetry breakdowns">
            {([
              ["hours", "Most Hours"], ["rating", "Highest Avg Rating"], ["games", "Most Games"],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={sortBy === value} onClick={() => setSortBy(value)}>{label}</button>
            ))}
          </div>
        <p className="telemetry-legend">{copy("Cyan: share of", "First bar: share of")} {shareUsesHours ? "active hours" : "games"} {copy("across the library. Gold: completion within each group.", "across the library. Second bar: completion within each group.")}</p>
        <div className="telemetry-matrix">
          {breakdowns.map(({ title, groups }) => (
            <WorkspaceSection sectionKey={title === "BY GENRE" ? "genre-breakdown" : "platform-breakdown"} className="telemetry-breakdown" key={title} label={title === "BY GENRE" ? "genre breakdown" : "platform breakdown"} title={title} headingLevel={4}
              summary={<span className="workspace-section-count">{groups.length} groups</span>}>
              {groups.length > 0 ? <ul>{groups.map(renderGroup)}</ul> : <p className="telemetry-empty">No games yet. Add or import a gig to start tracking.</p>}
            </WorkspaceSection>
          ))}
        </div>
        </WorkspaceSection>
      </div>
    </WorkspaceSection>
  );
}
