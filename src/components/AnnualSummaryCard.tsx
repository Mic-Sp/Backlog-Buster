import { useId, type Ref } from "react";
import type { AnnualSummary } from "@/lib/year-in-review";

/** Intrinsic SVG styling keeps downloaded PNGs identical to the preview; no external artwork. */
export default function AnnualSummaryCard({ summary: s, callsign, fantasy, includeStarted, cardRef }: {
  summary: AnnualSummary; callsign: string; fantasy: boolean; includeStarted: boolean; cardRef: Ref<SVGSVGElement>;
}) {
  const id = useId();
  const ink = fantasy ? "#264b3d" : "#e7f8ff", muted = fantasy ? "#665735" : "#9ab5c8";
  const accent = fantasy ? "#386849" : "#65f9d1", line = fantasy ? "#b29960" : "#244c57";
  const tile = fantasy ? "#ecddb4" : "#0f202c";
  const peak = Math.max(1, ...s.months.map(month => month.count));
  const trim = (text: string, length = 43) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
  const hours = includeStarted ? s.hoursIncludingStarts : s.loggedHours;
  const metrics = [
    { label: "TITLES CLEARED", value: String(s.clearedGames) }, { label: "LOGGED HOURS · TITLE TOTALS", value: `${hours.toLocaleString("en-US")}h` },
    { label: "CRITIC AVERAGE", value: s.averageRating === null ? "UNRATED" : `${s.averageRating.toFixed(1)} / 5` },
    { label: "RECORDED REPEAT CLEARS", value: String(s.repeatClears) },
  ];
  const picks = [
    { label: "GAME OF THE YEAR", value: s.highlights.gameOfYear?.title ?? "No dated clears yet" },
    { label: "LONGEST ODYSSEY", value: s.highlights.longest ? `${s.highlights.longest.title} · ${s.highlights.longest.hours}h` : "No hours logged" },
    { label: "FIRST CLEAR", value: s.highlights.first ? `${s.highlights.first.completedAt} · ${s.highlights.first.title}` : "Your first clear awaits" },
    { label: "FINAL CLEAR", value: s.highlights.last ? `${s.highlights.last.completedAt} · ${s.highlights.last.title}` : "Your next story awaits" },
  ];
  return <svg className="annual-summary-card" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 680" width="1000" height="680" ref={cardRef} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>{`${callsign} · ${s.year} ${fantasy ? "Yearly Chronicle" : "Year in Review"}`}</title>
    <desc id={`${id}-desc`}>{s.clearedGames} titles with latest dated clears, {hours} cumulative logged hours on {includeStarted ? "cleared or started" : "cleared"} titles, {s.repeatClears} recorded repeat clears. Earlier run dates are unavailable.</desc>
    <g fontFamily={fantasy ? "Georgia, serif" : "'Courier New', monospace"} fill={ink}>
      <rect width="1000" height="680" fill={fantasy ? "#f5e8c6" : "#080f1a"} />
      <rect x="12" y="12" width="976" height="656" rx={fantasy ? 12 : 0} fill="none" stroke={line} strokeWidth="2" />
      <path d="M32 176H968M32 632H968" stroke={line} />
      <text x="32" y="48" fontSize="14" fill={accent} letterSpacing="1">{fantasy ? "THE YEARLY CHRONICLE · ANNALS OF THE REALM" : "ANNUAL TELEMETRY // YEAR IN REVIEW"}</text>
      <text x="32" y="120" fontSize="64" fontWeight="700">{s.year}</text>
      <text x="32" y="151" fontSize="20" fill={muted}>{trim(callsign, 42)}</text>
      <text x="968" y="100" textAnchor="end" fontSize="32" fill={accent}>{fantasy ? "✧" : "// BB"}</text>
      <text x="968" y="145" textAnchor="end" fontSize="12" fill={muted}>YOUR STORIES. YOUR PACE.</text>
      {metrics.map((metric, index) => <g key={metric.label} transform={`translate(${32 + index * 236} 192)`}>
        <rect width="228" height="90" rx={fantasy ? 5 : 0} fill={tile} stroke={line} />
        <text x="12" y="24" fontSize="10" fill={muted}>{metric.label}</text>
        <text x="12" y="66" fontSize="30" fontWeight="700" fill={accent}>{metric.value}</text>
      </g>)}
      <text x="32" y="307" fontSize="12" fill={muted}>{s.lifetimePlaythroughs} lifetime runs / {s.lifetimeReplays} lifetime replays across cleared titles · {s.startedGames} titles started in {s.year}</text>
      <text x="32" y="337" fontSize="14">PRIMARY DISCIPLINE: {trim(s.topGenre?.name ?? "UNKNOWN", 25)}</text>
      <text x="512" y="337" fontSize="14">PRIMARY {fantasy ? "REALM" : "RIG"}: {trim(s.topPlatform?.name ?? "UNKNOWN", 25)}</text>
      <text x="32" y="369" fontSize="11" fill={muted}>COMPLETION CADENCE · LATEST DATED CLEARS</text>
      {s.months.map((month, index) => <g key={month.month} transform={`translate(${39 + index * 77} 0)`}>
        <rect x="0" y="390" width="54" height="66" rx="2" fill={tile} />
        <rect x="0" y={456 - month.count / peak * 66} width="54" height={month.count / peak * 66} rx="2" fill={accent} />
        <text x="27" y="385" textAnchor="middle" fontSize="11" fill={muted}>{month.count}</text>
        <text x="27" y="474" textAnchor="middle" fontSize="11" fill={muted}>{month.month}</text>
      </g>)}
      {picks.map((pick, index) => <g key={pick.label} transform={`translate(${32 + index % 2 * 480} ${503 + Math.floor(index / 2) * 60})`}>
        <text fontSize="10" fill={accent} fontWeight="700">{pick.label}</text>
        <text y="23" fontSize="14">{trim(pick.value)}</text>
      </g>)}
      <text x="32" y="650" fontSize="10" fill={muted}>Latest clear per title · lifetime run context · cumulative title hours{includeStarted ? " including starts" : ""} · undated clears excluded</text>
    </g>
  </svg>;
}
