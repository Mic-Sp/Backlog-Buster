import type { LibraryGame } from "@/components/GameLibrary";

type Props = { game: Pick<LibraryGame, "title" | "lengthHours" | "communityStats"> };
const formatHours = (hours: number) => Number.isInteger(hours) ? String(hours) : hours.toFixed(1);

export function CommunityStatsReadout({ game }: Props) {
  const stats = game.communityStats;
  return <span className="community-readout" role="group" aria-label={`Community stats for ${game.title}`}>
    <span className="community-readout-label">Community</span>
    <span>{stats && stats.completionCount > 0 && stats.completionAvgHours !== null && stats.completionMedianHours !== null
      ? `Avg ${formatHours(stats.completionAvgHours)}h · Median ${formatHours(stats.completionMedianHours)}h · ${stats.completionCount} ${stats.completionCount === 1 ? "completion" : "completions"}`
      : `Est. ${formatHours(game.lengthHours)}h · No community completions`}</span>
    <span className="community-rating-average">{stats && stats.ratingCount > 0 && stats.ratingAvg !== null
      ? `★ ${stats.ratingAvg.toFixed(1)}/5 · ${stats.ratingCount} ${stats.ratingCount === 1 ? "rating" : "ratings"}`
      : "No community ratings yet"}</span>
  </span>;
}

export function CommunityRatingDistribution({ game }: Props) {
  const stats = game.communityStats;
  return <section className="community-rating-chart" aria-label={`Community rating distribution for ${game.title}`}>
    <h3>Community ratings</h3>
    {!stats || stats.ratingCount === 0 ? <p className="community-rating-note">No community ratings yet.</p> : <>
      <p className="community-rating-note">{stats.ratingCount} {stats.ratingCount === 1 ? "rating · Early sample" : "ratings"}</p>
      <ul>
        {stats.ratingDistribution.map(({ rating, count, percentage }) => <li key={rating}>
          <span className="community-star-label">{rating}★</span>
          <div className="telemetry-bar-track" role="img" aria-label={`${rating} stars: ${count} ratings, ${percentage.toFixed(1)}% of community ratings`}>
            <span className="telemetry-completion-fill" style={{ width: `${percentage}%` }} />
          </div>
          <span className="community-rating-count">{count} <span>({percentage.toFixed(1)}%)</span></span>
        </li>)}
      </ul>
    </>}
  </section>;
}
