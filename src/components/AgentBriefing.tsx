"use client";

import useCooldown from "@/components/useCooldown";
import { unwrapActionResult } from "@/lib/action-result";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { applyPlaytimeEstimate } from "@/app/actions";
import "./AgentBriefing.css";

type BriefingGame = {
  id?: number;
  title: string;
  platform: string;
  genre: string | null;
  releaseYear: number | null;
  lengthHours: number;
  hoursPlayed?: number | null;
};

export default function AgentBriefing({ game }: { game: BriefingGame }) {
  const cooldown = useCooldown();
  const [isLoading, setIsLoading] = useState(false);
  const [briefing, setBriefing] = useState("");
  const [error, setError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [appliedHours, setAppliedHours] = useState<number | null>(null);
  const [isApplying, startApplying] = useTransition();
  const requestRef = useRef<AbortController | null>(null);
  const readoutId = useId();
  const suggestedHours = Number(briefing.match(/\[REAL TIME:\s*(\d+)h/i)?.[1] ?? 0);
  const canApply = game.id != null && Number.isSafeInteger(suggestedHours) && suggestedHours > 0 &&
    suggestedHours <= 999 && suggestedHours !== game.lengthHours && suggestedHours !== appliedHours;

  useEffect(() => () => requestRef.current?.abort(), []);

  async function audit() {
    if (requestRef.current || isApplying || cooldown.seconds > 0) return;
    if (!game.title.trim()) { setError("Please input a valid title."); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setError("");
    setApplyError("");
    setAppliedHours(null);
    setBriefing("");
    try {
      const response = await fetch("/api/ai-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
        body: JSON.stringify({ title: game.title.trim(), platform: game.platform.trim() || "PC", genre: game.genre?.trim() || null, year: game.releaseYear, lengthHours: game.lengthHours, hoursPlayed: game.hoursPlayed ?? null }),
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 429 || result?.retryAfterSeconds) cooldown.start(result?.retryAfterSeconds ?? (Number(response.headers.get("Retry-After")) || 10));
      if (!response.ok || typeof result?.briefing !== "string" || !result.briefing.trim()) {
        setError(typeof result?.error === "string" ? result.error : "No briefing received. Please try again.");
        return;
      }
      setBriefing(result.briefing);
    } catch {
      if (!controller.signal.aborted) setError("Could not load the agent briefing. Please try again.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }

  function applyEstimate() {
    if (!canApply || isApplying || game.id == null) return;
    const gameId = game.id;
    setApplyError("");
    startApplying(async () => {
      try {
        unwrapActionResult(await applyPlaytimeEstimate(gameId, suggestedHours));
        setAppliedHours(suggestedHours);
      } catch {
        setApplyError("Could not save the estimate. The game may have changed; refresh or try again.");
      }
    });
  }

  return (
    <div className="agent-briefing">
      <button type="button" className="agent-audit-button" disabled={isLoading || isApplying || cooldown.seconds > 0} onClick={audit} aria-controls={readoutId} aria-expanded={isLoading || Boolean(briefing || error)}>
        {cooldown.seconds > 0 ? cooldown.label : isLoading ? "🤖 AUDITING PLAYTIME…" : "🤖 AGENT PLAYTIME AUDIT"}
      </button>
      <div id={readoutId} className="agent-briefing-readout" hidden={!isLoading && !briefing && !error} aria-live="polite" aria-atomic="true" aria-busy={isLoading}>
        <span className="agent-briefing-eyebrow">AGENT // PLAYTIME &amp; GIG BRIEFING</span>
        <p className="agent-briefing-metrics">Est. completion: {game.lengthHours}h · Logged: {game.hoursPlayed == null ? "Unknown" : `${game.hoursPlayed}h`}</p>
        {isLoading ? <p>Reviewing {game.title} and calibrating your next sessions…</p> : error ? <p className="agent-briefing-error" role="alert">{error}</p> : <p>{briefing}</p>}
        {!isLoading && !error && canApply && (
          <button type="button" className="agent-apply-button" disabled={isApplying} onClick={applyEstimate}>
            {isApplying ? "⚡ APPLYING…" : `⚡ APPLY ${suggestedHours}h TO DATABASE`}
          </button>
        )}
        {appliedHours !== null && <p className="agent-briefing-saved" role="status">Saved {appliedHours}h as the estimated completion time.</p>}
        {applyError && <p className="agent-briefing-error" role="alert">{applyError}</p>}
      </div>
    </div>
  );
}
