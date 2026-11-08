import { importJournalDate, journalDateInput } from "@/lib/play-journal";
import { completedRuns } from "@/lib/playthroughs";

export type AnnualReviewGame = {
  id: number; title: string; platform: string; genre?: string | null; status: string;
  startedAt?: Date | string | null; completedAt?: Date | string | null;
  playthroughCount?: number; hoursPlayed: number; rating: number | null;
};
export type AnnualHighlight = {
  title: string; platform: string; completedAt: string; hours: number; rating: number | null;
  playthroughCount: number; hallOfFame: boolean;
};
export type AnnualSummary = {
  year: number; clearedGames: number; startedGames: number; repeatClears: number;
  lifetimePlaythroughs: number; lifetimeReplays: number;
  loggedHours: number; hoursIncludingStarts: number; averageRating: number | null; ratedClears: number;
  topGenre: { name: string; count: number } | null; topPlatform: { name: string; count: number } | null;
  months: { month: string; count: number }[]; peakMonths: string[];
  highlights: { gameOfYear: AnnualHighlight | null; longest: AnnualHighlight | null; first: AnnualHighlight | null; last: AnnualHighlight | null };
};
export type AnnualReviewData = { currentYear: number; defaultYear: number; undatedClears: number; summaries: AnnualSummary[] };
export const ANNUAL_REVIEW_BASIS = "Latest-clear view: each title contributes its latest dated clear once. Earlier run dates are not stored. Repeat clears count titles whose latest clear is a replay; lifetime runs/replays belong to those titles, not necessarily this year. Hours are cumulative logged totals for the selected titles, not dated session hours or length estimates. Undated clears are excluded.";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hours = (game: AnnualReviewGame) => Number.isFinite(game.hoursPlayed) && game.hoursPlayed > 0 ? game.hoursPlayed : 0;
const rating = (game: AnnualReviewGame) => Number.isInteger(game.rating) && game.rating! >= 1 && game.rating! <= 5 ? game.rating : null;

function calendar(value: AnnualReviewGame["completedAt"]): string | null {
  try { return journalDateInput(importJournalDate(value)) || null; } catch { return null; }
}
function validYear(year: number) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError("Choose a year from 1 to 9999.");
}

/** Date-only UTC journal attribution; never substitute createdAt or multiply a latest-clear bucket by lifetime runs. */
export function aggregateAnnualSummary(games: readonly AnnualReviewGame[], year: number, featuredTrophyIds: unknown = []): AnnualSummary {
  validYear(year);
  const inYear = (date: string | null) => date !== null && Number(date.slice(0, 4)) === year;
  const clears = games.filter(game => completedRuns(game) > 0 && inYear(calendar(game.completedAt)));
  const starts = games.filter(game => inYear(calendar(game.startedAt)));
  const withStarts = [...new Set([...clears, ...starts])];
  const featured = new Set(Array.isArray(featuredTrophyIds) ? featuredTrophyIds.slice(0, 3) : []);
  const stable = (a: AnnualReviewGame, b: AnnualReviewGame) => compareText(a.title.toLowerCase(), b.title.toLowerCase()) || compareText(a.title, b.title) || a.id - b.id;
  const byDate = (direction: number) => (a: AnnualReviewGame, b: AnnualReviewGame) => direction * compareText(calendar(a.completedAt)!, calendar(b.completedAt)!) || stable(a, b);
  const highlight = (game?: AnnualReviewGame): AnnualHighlight | null => game ? {
    title: game.title, platform: game.platform, completedAt: calendar(game.completedAt)!, hours: hours(game), rating: rating(game),
    playthroughCount: completedRuns(game), hallOfFame: featured.has(game.id),
  } : null;
  const gameOfYear = [...clears].sort((a, b) => (rating(b) ?? 0) - (rating(a) ?? 0) ||
    Number(featured.has(b.id)) - Number(featured.has(a.id)) || completedRuns(b) - completedRuns(a) || hours(b) - hours(a) || stable(a, b))[0];
  function top(field: "genre" | "platform") {
    const groups = new Map<string, { name: string; count: number; hours: number }>();
    for (const game of clears) {
      const name = game[field]?.trim().replace(/\s+/g, " ");
      if (!name) continue;
      const key = name.toLowerCase(), previous = groups.get(key);
      groups.set(key, { name: previous && compareText(previous.name, name) < 0 ? previous.name : name,
        count: (previous?.count ?? 0) + 1, hours: (previous?.hours ?? 0) + hours(game) });
    }
    const winner = [...groups.values()].sort((a, b) => b.count - a.count || b.hours - a.hours || compareText(a.name, b.name))[0];
    return winner ? { name: winner.name, count: winner.count } : null;
  }
  const months = MONTHS.map((month, index) => ({ month, count: clears.filter(game => Number(calendar(game.completedAt)!.slice(5, 7)) === index + 1).length }));
  const peak = Math.max(...months.map(month => month.count));
  const rated = clears.map(rating).filter((value): value is number => value !== null);
  return {
    year, clearedGames: clears.length, startedGames: starts.length,
    repeatClears: clears.filter(game => completedRuns(game) >= 2).length,
    lifetimePlaythroughs: clears.reduce((sum, game) => sum + completedRuns(game), 0),
    lifetimeReplays: clears.reduce((sum, game) => sum + Math.max(0, completedRuns(game) - 1), 0),
    loggedHours: clears.reduce((sum, game) => sum + hours(game), 0),
    hoursIncludingStarts: withStarts.reduce((sum, game) => sum + hours(game), 0),
    averageRating: rated.length ? rated.reduce((sum, value) => sum + value, 0) / rated.length : null, ratedClears: rated.length,
    topGenre: top("genre"), topPlatform: top("platform"), months,
    peakMonths: peak ? months.filter(month => month.count === peak).map(month => month.month) : [],
    highlights: { gameOfYear: highlight(gameOfYear), longest: highlight([...clears].filter(game => hours(game) > 0).sort((a, b) => hours(b) - hours(a) || stable(a, b))[0]),
      first: highlight([...clears].sort(byDate(1))[0]), last: highlight([...clears].sort(byDate(-1))[0]) },
  };
}

/** Safe aggregate DTO shared by owner and public views; no IDs, notes, reviews, ownership or raw library rows. */
export function buildAnnualReview(games: readonly AnnualReviewGame[], featuredTrophyIds: unknown = [], currentYear = new Date().getUTCFullYear()): AnnualReviewData {
  validYear(currentYear);
  const clearYears = games.filter(game => completedRuns(game) > 0).flatMap(game => {
    const date = calendar(game.completedAt); return date ? [Number(date.slice(0, 4))] : [];
  });
  const startYears = games.flatMap(game => { const date = calendar(game.startedAt); return date ? [Number(date.slice(0, 4))] : []; });
  const years = [...new Set([currentYear, ...clearYears, ...startYears])].sort((a, b) => b - a);
  return { currentYear, defaultYear: clearYears.includes(currentYear) ? currentYear : Math.max(0, ...clearYears.filter(year => year <= currentYear)) || currentYear,
    undatedClears: games.filter(game => completedRuns(game) > 0 && !calendar(game.completedAt)).length,
    summaries: years.map(year => aggregateAnnualSummary(games, year, featuredTrophyIds)) };
}

export function annualSummaryText(summary: AnnualSummary, callsign: string, fantasy = false, includeStarted = false): string {
  const pick = (value: AnnualHighlight | null) => value ? `${value.title} (${value.platform})` : "No dated clear";
  return [
    `${summary.year} · ${fantasy ? "THE YEARLY CHRONICLE · ANNALS OF THE REALM" : "ANNUAL TELEMETRY // YEAR IN REVIEW"}`,
    callsign,
    `${summary.clearedGames} titles with dated clears · ${summary.repeatClears} recorded repeat clears · ${summary.startedGames} titles started`,
    `${summary.lifetimePlaythroughs} lifetime runs / ${summary.lifetimeReplays} lifetime replays across these cleared titles`,
    `${includeStarted ? summary.hoursIncludingStarts : summary.loggedHours}h logged on ${includeStarted ? "cleared or started" : "cleared"} titles · critic average ${summary.averageRating === null ? "unrated" : `${summary.averageRating.toFixed(1)}/5 (${summary.ratedClears} rated)`}`,
    `Primary Discipline: ${summary.topGenre?.name ?? "Unknown"} · Primary ${fantasy ? "Realm" : "Rig"}: ${summary.topPlatform?.name ?? "Unknown"}`,
    `Game of the Year: ${pick(summary.highlights.gameOfYear)}`,
    `Longest Odyssey: ${summary.highlights.longest ? `${pick(summary.highlights.longest)} · ${summary.highlights.longest.hours}h logged` : "No logged hours"}`,
    `First clear: ${pick(summary.highlights.first)} · Final clear: ${pick(summary.highlights.last)}`,
    summary.months.map(month => `${month.month} ${month.count}`).join(" · "),
    ANNUAL_REVIEW_BASIS,
  ].join("\n");
}
