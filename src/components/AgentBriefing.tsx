"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./AgentBriefing.css";

type BriefingGame = {
  title: string;
  platform: string;
  genre: string | null;
  releaseYear: number | null;
  lengthHours: number;
  hoursPlayed?: number | null;
};

export default function AgentBriefing({ game }: { game: BriefingGame }) {
  const [isLoading, setIsLoading] = useState(false);
  const [briefing, setBriefing] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const readoutId = useId();

  useEffect(() => () => requestRef.current?.abort(), []);

  async function audit() {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setError("");
    setBriefing("");
    try {
      const response = await fetch("/api/ai-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ title: game.title, platform: game.platform, genre: game.genre, year: game.releaseYear, lengthHours: game.lengthHours, hoursPlayed: game.hoursPlayed ?? null }),
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
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

  return (
    <div className="agent-briefing">
      <button type="button" className="agent-audit-button" disabled={isLoading} onClick={audit} aria-controls={readoutId} aria-expanded={isLoading || Boolean(briefing || error)}>
        {isLoading ? "🤖 AUDITING PLAYTIME…" : "🤖 AGENT PLAYTIME AUDIT"}
      </button>
      <div id={readoutId} className="agent-briefing-readout" hidden={!isLoading && !briefing && !error} aria-live="polite" aria-atomic="true" aria-busy={isLoading}>
        <span className="agent-briefing-eyebrow">AGENT // PLAYTIME &amp; GIG BRIEFING</span>
        <p className="agent-briefing-metrics">Est. completion: {game.lengthHours}h · Logged: {game.hoursPlayed == null ? "Unknown" : `${game.hoursPlayed}h`}</p>
        {isLoading ? <p>Reviewing {game.title} and calibrating your next sessions…</p> : error ? <p className="agent-briefing-error" role="alert">{error}</p> : <p>{briefing}</p>}
      </div>
    </div>
  );
}
