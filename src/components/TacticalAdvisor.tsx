"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { acceptQuest, addExternalScoutGame, fetchBacklogAdvisor, fetchExternalScout } from "@/app/actions";
import type { BacklogRecommendation, BacklogRecommendations, ExternalRecommendation } from "@/lib/recommendations";
import type { LibraryGame } from "@/components/GameLibrary";
import { normalizeGameTitle } from "@/lib/game-title";
import { buildTrailerUrl } from "@/lib/trailers";
import DeckPinButton from "@/components/DeckPinButton";
import AgentBriefing from "@/components/AgentBriefing";

export default function TacticalAdvisor({ games }: { games: Pick<LibraryGame, "id" | "title" | "status" | "pinnedOrder" | "hoursPlayed" | "lengthHours">[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [picks, setPicks] = useState<BacklogRecommendations | null>(null);
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState<number | null>(null);
  const [isFetching, startFetching] = useTransition();
  const [isStarting, startStarting] = useTransition();
  const [scoutUnlocked, setScoutUnlocked] = useState(false);
  const [scoutOverride, setScoutOverride] = useState(false);
  const [externalPicks, setExternalPicks] = useState<ExternalRecommendation[] | null>(null);
  const [externalError, setExternalError] = useState("");
  const [addedTitles, setAddedTitles] = useState<Set<string>>(new Set());
  const [addingTitle, setAddingTitle] = useState<string | null>(null);
  const [isScouting, startScouting] = useTransition();
  const [isAdding, startAdding] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const startingRef = useRef(false);
  const scoutRequestId = useRef(0);
  const backlogCount = useMemo(() => games.filter((game) => game.status === "Backlog").length, [games]);
  const pinnedCount = games.filter((game) => game.status === "Backlog" && game.pinnedOrder != null).length;
  const ownedTitles = useMemo(() => new Set(games.map((game) => normalizeGameTitle(game.title))), [games]);

  function loadExternalPicks(override = false) {
    if (backlogCount > 5 && !scoutOverride && !override) {
      setScoutUnlocked(false);
      return;
    }
    const request = ++scoutRequestId.current;
    setExternalPicks(null);
    setExternalError("");
    startScouting(async () => {
      try {
        const result = await fetchExternalScout();
        if (request === scoutRequestId.current) setExternalPicks(result);
      } catch {
        if (request === scoutRequestId.current) setExternalError("External scouting failed. Retry the scan to reconnect.");
      }
    });
  }

  function openAdvisor() {
    setIsOpen(true);
    setExternalPicks(null);
    setExternalError("");
    setAddedTitles(new Set());
    setScoutOverride(false);
    setScoutUnlocked(backlogCount <= 5);
    scoutRequestId.current++;
    loadPicks();
    if (backlogCount <= 5) loadExternalPicks();
  }

  function addContract(pick: ExternalRecommendation) {
    const key = normalizeGameTitle(pick.title);
    if (startingRef.current || ownedTitles.has(key) || addedTitles.has(key)) return;
    startingRef.current = true;
    setAddingTitle(key);
    setExternalError("");
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      title: pick.title, platform: pick.platform, genre: pick.genre ?? "",
      releaseYear: pick.releaseYear ?? "", coverUrl: pick.coverUrl ?? "",
      lengthHours: pick.lengthHours, difficulty: pick.difficulty,
    })) formData.set(name, String(value));
    startAdding(async () => {
      try {
        await addExternalScoutGame(formData);
        setAddedTitles((current) => new Set([...current, key]));
      } catch {
        setExternalError(`Could not add ${pick.title}. Please try again.`);
      } finally {
        startingRef.current = false;
        setAddingTitle(null);
      }
    });
  }

  function loadPicks() {
    const request = ++requestId.current;
    setPicks(null);
    setError("");
    startFetching(async () => {
      try {
        const result = await fetchBacklogAdvisor();
        if (request === requestId.current) setPicks(result);
      } catch {
        if (request === requestId.current) setError("CORTEX could not scan your backlog. Please retry.");
      }
    });
  }

  function close() {
    if (startingRef.current) return;
    requestId.current++;
    scoutRequestId.current++;
    setIsOpen(false);
  }

  function startGig(gameId: number) {
    if (isFetching || startingRef.current) return;
    startingRef.current = true;
    setStartingId(gameId);
    setError("");
    startStarting(async () => {
      try {
        await acceptQuest(gameId);
        requestId.current++;
        scoutRequestId.current++;
        setIsOpen(false);
        setPicks(null);
      } catch {
        setError("Could not start that gig. It may no longer be in your backlog. Refresh the scan and try again.");
      } finally {
        startingRef.current = false;
        setStartingId(null);
      }
    });
  }

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!startingRef.current) { requestId.current++; scoutRequestId.current++; setIsOpen(false); }
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const controls = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialog?.focus();
      } else if (!dialog?.contains(document.activeElement) || document.activeElement === dialog ||
        (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  function renderPick(pick: BacklogRecommendation | null, variant: "continuation" | "cleanser") {
    const savedGame = games.find((game) => game.id === pick?.game.id && game.status === "Backlog");
    const heading = variant === "continuation" ? "🔗 DIRECT CONTINUATION // SEQUEL & AFFINITY" : "⚡ PALATE CLEANSER // PACING RESET";
    return (
      <article className="advisor-card" data-variant={variant}>
        <h3 className="advisor-card-eyebrow">{heading}</h3>
        {pick ? (
          <>
            {pick.game.coverUrl ? (
              // Reuse the library's lazy-loading cover behavior.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="advisor-cover" src={pick.game.coverUrl} alt={`${pick.game.title} cover art`} width={640} height={360} loading="lazy" decoding="async" />
            ) : <div className="advisor-cover advisor-no-cover" role="img" aria-label={`${pick.game.title} cover art unavailable`}>NO COVER</div>}
            <div className="advisor-card-body">
              <h4>{pick.game.title}</h4>
              <p className="advisor-metadata">{pick.game.platform} · {pick.game.genre?.trim() || "Uncategorized"} · {savedGame?.lengthHours ?? pick.game.lengthHours}h</p>
              <p className="advisor-bounty">+{((savedGame?.lengthHours ?? pick.game.lengthHours) * pick.game.difficulty * 10).toLocaleString("en-US")} POTENTIAL XP</p>
              <div className="advisor-reason"><span>TACTICAL ASSESSMENT</span><p>{pick.reason}</p></div>
              <div className="advisor-card-actions">
                <button className="advisor-start-button" type="button" disabled={isFetching || isStarting || isAdding} onClick={() => startGig(pick.game.id)}>
                  {startingId === pick.game.id ? "ACCEPTING GIG…" : "▶ START GIG NOW"}
                </button>
                <a className="trailer-link-button" href={buildTrailerUrl(pick.game.title, pick.game.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
                {savedGame && <DeckPinButton gameId={savedGame.id} pinnedOrder={savedGame.pinnedOrder} pinnedCount={pinnedCount} disabled={isFetching || isStarting || isAdding} />}
              </div>
              <AgentBriefing game={{ ...pick.game, lengthHours: savedGame?.lengthHours ?? pick.game.lengthHours, hoursPlayed: savedGame?.hoursPlayed }} />
            </div>
          </>
        ) : <p className="advisor-empty">No matching backlog gig available.</p>}
      </article>
    );
  }

  return (
    <>
      <button className="advisor-trigger-button" type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={isOpen} onClick={openAdvisor}>
        🧠 CORTEX // ADVISE NEXT GIG
      </button>
      {isOpen && createPortal(
        <div className="advisor-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div className="advisor-modal" role="dialog" aria-modal="true" aria-labelledby="advisor-title" aria-busy={isFetching || isStarting || isScouting || isAdding} ref={dialogRef} tabIndex={-1}>
            <header className="advisor-header">
              <div><p className="eyebrow">BACKLOG INTELLIGENCE // EXTERNAL SCOUT ONLINE</p><h2 id="advisor-title">CORTEX // TACTICAL GIG ADVISOR</h2></div>
              <button className="advisor-close" type="button" aria-label="Close tactical advisor" disabled={isStarting || isAdding} onClick={close}>✕</button>
            </header>
            <p className="advisor-intro">Two tactical routes through your saved backlog, informed by your completions, ratings, and current gigs.</p>
            {isFetching && <p className="advisor-loading" role="status">SCANNING LIBRARY // CALIBRATING NEXT GIG…</p>}
            {error && <p className="advisor-error" role="alert">{error}</p>}
            {!isFetching && picks && (
              picks.continuationPick || picks.palateCleanserPick ? (
                <div className="advisor-grid">
                  {renderPick(picks.continuationPick, "continuation")}
                  {renderPick(picks.palateCleanserPick, "cleanser")}
                </div>
              ) : <p className="advisor-empty" role="status">No released backlog gigs are eligible. CORTEX requires a saved release year of this year or earlier.</p>
            )}
            {!isFetching && <button className="advisor-refresh" type="button" disabled={isStarting || isAdding} onClick={loadPicks}>{error ? "RETRY SCAN" : "REFRESH SCAN"}</button>}
            <section className="advisor-external-section" aria-labelledby="external-scout-title">
              <h3 id="external-scout-title">02 // EXTERNAL SCOUT (NEW CONTRACTS)</h3>
              <p className="advisor-intro">Curated affinity picks from your completed favorites, enriched with RAWG metadata.</p>
              {!scoutUnlocked ? (
                <div className="advisor-scout-locked">
                  <p>🔒 EXTERNAL SCOUTING STANDBY // Backlog at {backlogCount} gigs (Target: &lt;= 5 gigs)</p>
                  <button type="button" disabled={isStarting || isAdding} onClick={() => { setScoutOverride(true); setScoutUnlocked(true); loadExternalPicks(true); }}>⚡ OVERRIDE LOCK &amp; SCAN</button>
                </div>
              ) : (
                <>
                  {isScouting && <p className="advisor-loading" role="status">EXTERNAL SCOUT // ACQUIRING NEW CONTRACT INTEL…</p>}
                  {externalError && <p className="advisor-error" role="alert">{externalError}</p>}
                  {!isScouting && externalPicks && (externalPicks.length ? (
                    <div className="advisor-external-grid">
                      {externalPicks.map((pick) => {
                        const key = normalizeGameTitle(pick.title);
                        const added = addedTitles.has(key) || ownedTitles.has(key);
                        return (
                          <article className="advisor-card" data-variant="external" key={key}>
                            {pick.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className="advisor-cover" src={pick.coverUrl} alt={`${pick.title} cover art`} width={640} height={360} loading="lazy" decoding="async" />
                            ) : <div className="advisor-cover advisor-no-cover" role="img" aria-label={`${pick.title} cover art unavailable`}>NO COVER</div>}
                            <div className="advisor-card-body">
                              <h4>{pick.title}</h4>
                              <p className="advisor-metadata">{pick.platform} · {pick.genre ?? "Genre unknown"} · {pick.releaseYear ?? "Year unknown"}</p>
                              <p className="advisor-bounty">{pick.lengthHours}h EST. // +{(pick.lengthHours * pick.difficulty * 10).toLocaleString("en-US")} POTENTIAL XP</p>
                              <div className="advisor-reason"><span>ACQUISITION RATIONALE</span><p>{pick.reason}</p></div>
                              <div className="advisor-card-actions">
                                <button className="advisor-acquire-button" type="button" data-added={added} disabled={added || isStarting || isAdding} onClick={() => addContract(pick)}>
                                  {added ? "✓ ADDED TO BACKLOG" : addingTitle === key ? "ADDING CONTRACT…" : "+ ADD TO BACKLOG"}
                                </button>
                                <a className="trailer-link-button" href={buildTrailerUrl(pick.title, pick.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
                              </div>
                              <AgentBriefing game={pick} />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : <p className="advisor-empty" role="status">No new affinity picks with a confirmed release year of this year or earlier are available. Complete and rate a gig 4–5 stars to guide scouting; games already in your library are excluded.</p>)}
                  {!isScouting && <button className="advisor-refresh" type="button" disabled={isStarting || isAdding} onClick={() => loadExternalPicks()}>{externalError ? "RETRY EXTERNAL SCAN" : "RESCAN NEW CONTRACTS"}</button>}
                  <p className="advisor-scout-status" role="status" aria-live="polite">{addedTitles.size > 0 ? `${addedTitles.size} new contract${addedTitles.size === 1 ? "" : "s"} added to backlog.` : ""}</p>
                </>
              )}
            </section>
          </div>
        </div>, document.body,
      )}
    </>
  );
}
