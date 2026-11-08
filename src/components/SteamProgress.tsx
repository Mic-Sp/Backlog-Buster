"use client";

import { useRef, useState } from "react";
import { useLayoutCopy } from "@/components/LayoutText";
import { syncSteamAchievements } from "@/app/actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { steamAchievementProgress, validSteamAppId, type SteamProgressFields } from "@/lib/steam-progress";
import "./SteamProgress.css";

export default function SteamProgress({ game, compact = false }: { game: SteamProgressFields & { id: number; title: string; status: string; hoursPlayed?: number }; compact?: boolean }) {
  const copy = useLayoutCopy();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const inFlight = useRef(false);
  if (!validSteamAppId(game.steamAppId)) return null;
  const progress = steamAchievementProgress(game);
  const minutes = game.steamRecentMinutes ?? 0;
  const synced = game.steamLastSyncedAt ? new Date(game.steamLastSyncedAt).toISOString() : null;
  const checked = game.steamAchievementsSyncedAt ? new Date(game.steamAchievementsSyncedAt).toISOString() : null;
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { const result = unwrapActionResult(await syncSteamAchievements(game.id)); setNotice({ text: result.message, error: !result.updated }); }
    catch (error) { setNotice({ text: actionErrorMessage(error, "Steam refresh unavailable. Try again shortly."), error: true }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (compact) return <span className="steam-progress" data-compact="true" data-mastered={progress?.mastered || undefined} aria-label={`Steam progress for ${game.title}`}>
    <span className={progress?.mastered ? "steam-mastery-badge" : "steam-progress-heading"}>{progress
      ? progress.mastered ? "STEAM · 100% MASTERED" : progress.total ? `STEAM · ${progress.unlocked}/${progress.total} · ${progress.percent}%` : "STEAM · NO ACHIEVEMENTS"
      : "STEAM · NOT SYNCED"}</span>
    {minutes > 0 && <span className="steam-recent" title={synced ? `Two-week activity as of ${synced}` : "Cached two-week activity; sync date unknown"}>{(minutes / 60).toFixed(1)}h {copy("RECENT", "TRAVELS")} · 2W</span>}
  </span>;
  return <span className="steam-progress" data-compact={compact} data-mastered={progress?.mastered || undefined} aria-label={`Steam progress for ${game.title}`}>
    {progress ? <>
      <span className="steam-progress-heading">{progress.total ? `${progress.unlocked}/${progress.total} ${copy("ACHIEVEMENTS", "STEAM DEEDS")} · ${progress.percent}%` : "NO STEAM ACHIEVEMENTS"}</span>
      {progress.total > 0 && <span className="steam-achievement-track" role="progressbar" aria-label={`Steam achievements for ${game.title}`} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.unlocked} aria-valuetext={`${progress.unlocked} of ${progress.total} achievements`}><span style={{ width: `${progress.percent}%` }} /></span>}
      {progress.mastered && <strong className="steam-mastery-badge">{copy("100% MASTERED ON STEAM", "✧ MASTERED ON STEAM · 100%")}</strong>}
    </> : <span className="steam-progress-heading">{copy("STEAM ACHIEVEMENTS · NOT AVAILABLE YET", "STEAM DEEDS · AWAITING THE CHRONICLER")}</span>}
    {minutes > 0 && <span className="steam-recent" title={synced ? `Two-week activity as of ${synced}` : "Cached two-week activity; sync date unknown"}>{(minutes / 60).toFixed(1)}h {copy("RECENT", "RECENT TRAVELS")} · 2 WEEKS</span>}
    {!compact && <>
      {game.status === "Backlog" && minutes > 0 && <span className="steam-start-hint">{copy("Played recently on Steam · still in your Backlog. Start when ready.", "Recent travels on Steam · begin this quest when you are ready.")}</span>}
      <small>{synced ? `Activity snapshot ${synced.slice(0, 10)}` : "Activity not synced"}{checked ? ` · Achievements ${checked.slice(0, 10)}` : ""}</small>
      {!progress && <small>Sync to check achievements. Steam requires both My profile and Game details to be Public.</small>}
      <button type="button" className="steam-refresh-button" disabled={busy} onClick={() => void refresh()}>{busy ? "SYNCING STEAM…" : copy("Sync Steam Achievements", "Chronicle Steam Deeds")}</button>
      {notice && <span role={notice.error ? "alert" : "status"}>{notice.text}</span>}
    </>}
  </span>;
}
