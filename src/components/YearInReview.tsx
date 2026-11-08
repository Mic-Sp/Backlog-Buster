"use client";

import { useRef, useState } from "react";
import { useUIEffects } from "@/components/ThemeProvider";
import AnnualSummaryCard from "@/components/AnnualSummaryCard";
import { ANNUAL_REVIEW_BASIS, annualSummaryText, type AnnualReviewData } from "@/lib/year-in-review";
import { captureDossierPng, downloadSnapshot } from "@/lib/dossier-snapshot";
import "./YearInReview.css";

export default function YearInReview({ data, callsign }: { data: AnnualReviewData; callsign: string }) {
  const fantasy = useUIEffects().layoutMode === "fantasy";
  const [selectedYear, setSelectedYear] = useState(data.defaultYear);
  const [includeStarted, setIncludeStarted] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const exporting = useRef(false), cardRef = useRef<SVGSVGElement>(null);
  const summary = data.summaries.find(summary => summary.year === selectedYear) ?? data.summaries.find(summary => summary.year === data.defaultYear)!;
  const copy = (cyberpunk: string, parchment: string) => fantasy ? parchment : cyberpunk;
  const text = annualSummaryText(summary, callsign, fantasy, includeStarted);
  async function share(action: "copy" | "download") {
    if (exporting.current) return;
    exporting.current = true; setBusy(true); setFeedback(null);
    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(text);
        setFeedback({ text: "Annual summary copied to clipboard.", error: false });
      } else {
        if (!cardRef.current) throw new Error("Snapshot unavailable");
        const name = callsign.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "player";
        downloadSnapshot(await captureDossierPng(cardRef.current), `${fantasy ? "yearly-chronicle" : "year-in-review"}-${summary.year}-${name}.png`);
        setFeedback({ text: "Annual snapshot downloaded · 2000 × 1360 PNG.", error: false });
      }
    } catch {
      setFeedback({ text: action === "copy" ? "Clipboard access unavailable. Open Share text below to select and copy your recap." : "Snapshot export failed. You can still copy the text summary.", error: true });
    } finally { exporting.current = false; setBusy(false); }
  }
  return <details className="year-review" data-year-review data-fantasy={fantasy}>
    <summary>{copy("ANNUAL TELEMETRY // YEAR IN REVIEW", "THE YEARLY CHRONICLE · ANNALS OF THE REALM")} <span>{summary.year} · {summary.clearedGames} clears</span></summary>
    <section className="year-review-content" aria-label="Year in Review" aria-busy={busy}>
      <div className="year-review-controls">
        <label>Review year<select aria-label="Review year" value={summary.year} disabled={busy} onChange={event => { setSelectedYear(Number(event.target.value)); setFeedback(null); }}>
          {data.summaries.map(summary => <option key={summary.year} value={summary.year}>{summary.year}</option>)}
        </select></label>
        <label className="year-review-starts"><input type="checkbox" checked={includeStarted} disabled={busy} onChange={event => { setIncludeStarted(event.target.checked); setFeedback(null); }} />Include games started this year in hours</label>
      </div>
      {!summary.clearedGames && <p className="year-review-empty" role="status">No dated clears in {summary.year}. {summary.startedGames ? `${summary.startedGames} titles were started; include starts to see their logged hours.` : "Completions without a recorded date are outside annual totals."}</p>}
      <AnnualSummaryCard summary={summary} callsign={callsign} fantasy={fantasy} includeStarted={includeStarted} cardRef={cardRef} />
      <dl className="year-review-stats">
        <div><dt>Titles with dated clears</dt><dd>{summary.clearedGames}</dd></div>
        <div><dt>Recorded repeat clears</dt><dd>{summary.repeatClears}</dd></div>
        <div><dt>{includeStarted ? "Cleared + started title hours" : "Cleared title hours"}</dt><dd>{(includeStarted ? summary.hoursIncludingStarts : summary.loggedHours).toLocaleString("en-US")}h</dd></div>
        <div><dt>Average critic rating</dt><dd>{summary.averageRating === null ? "Unrated" : `${summary.averageRating.toFixed(1)} / 5 · ${summary.ratedClears} rated`}</dd></div>
        <div><dt>Primary Discipline</dt><dd>{summary.topGenre?.name ?? "Unknown"}</dd></div>
        <div><dt>{copy("Primary Rig", "Primary Realm")}</dt><dd>{summary.topPlatform?.name ?? "Unknown"}</dd></div>
      </dl>
      <p>{summary.lifetimePlaythroughs} lifetime runs · {summary.lifetimeReplays} lifetime replays across this year’s cleared titles. Peak months: {summary.peakMonths.join(", ") || "No dated clears"}.</p>
      <div className="year-review-data">
        <table><caption>Monthly completion cadence · {summary.year}</caption><thead><tr><th scope="col">Month</th><th scope="col">Latest dated clears</th></tr></thead>
          <tbody>{summary.months.map(month => <tr key={month.month}><th scope="row">{month.month}</th><td>{month.count}</td></tr>)}</tbody>
        </table>
        <dl className="year-review-highlights">
          {([
            ["Game of the Year", summary.highlights.gameOfYear], ["Longest Odyssey", summary.highlights.longest],
            ["First Clear", summary.highlights.first], ["Final Clear", summary.highlights.last],
          ] as const).map(([label, game]) => <div key={label}><dt>{label}</dt><dd>{game ? <><strong>{game.title}</strong><span>{game.platform} · {game.completedAt} · {game.hours}h logged · {game.rating === null ? "Unrated" : `${game.rating}/5`}{game.hallOfFame ? " · Hall of Fame" : ""}</span></> : label === "Longest Odyssey" ? "No hours logged" : "No dated clear"}</dd></div>)}
        </dl>
      </div>
      <details className="year-review-method"><summary>How this recap is counted</summary><p>{ANNUAL_REVIEW_BASIS}</p><p>{data.undatedClears} titles have no valid clear date and are outside the annual totals. Including starts adds hours once per title; clear counts, rating, disciplines and highlights still use completion dates. Game of the Year ranks by rating, then Hall of Fame, lifetime runs, hours and title. Group ties use cleared-title count, then hours and name.</p></details>
      <div className="year-review-share"><button type="button" disabled={busy} onClick={() => void share("copy")}>Copy annual summary</button><button type="button" disabled={busy} onClick={() => void share("download")}>{copy("Download annual snapshot", "Download chronicle snapshot")}</button></div>
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      <details className="year-review-text"><summary>Share text</summary><textarea readOnly value={text} aria-label="Annual summary share text" rows={10} /></details>
    </section>
  </details>;
}
