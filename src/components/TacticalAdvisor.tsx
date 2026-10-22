"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import { FantasyCorners } from "@/components/FantasyAccents";

import useCooldown from "@/components/useCooldown";
import { DEFAULT_COOLDOWN_SECONDS } from "@/lib/cooldown";
import { actionErrorMessage, ActionFailure, unwrapActionResult } from "@/lib/action-result";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { acceptQuest, addExternalScoutGame, fetchBacklogAdvisor, fetchExternalScout } from "@/app/actions";
import type { BacklogRecommendation, BacklogRecommendations, ExternalRecommendation } from "@/lib/recommendations";
import type { LibraryGame } from "@/components/GameLibrary";
import { normalizeGameTitle } from "@/lib/game-title";
import { buildTrailerUrl } from "@/lib/trailers";
import DeckPinButton from "@/components/DeckPinButton";
import AgentBriefing from "@/components/AgentBriefing";
import { useUIEffects } from "@/components/ThemeProvider";

export function useTacticalAdvisorController({ games }: { games: Pick<LibraryGame, "id" | "title" | "status" | "pinnedOrder" | "hoursPlayed" | "lengthHours">[] }) {
  const copy = useLayoutCopy();
  const { playSfx } = useUIEffects();
  const scoutCooldown = useCooldown();
  const advisorFlight = useRef(false);
  const scoutFlight = useRef(false);
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
  // Keep session history across modal opens; match the action's 30-title cap.
  const seenExternalTitles = useRef(new Map<string, string>());
  const backlogCount = useMemo(() => games.filter((game) => game.status === "Backlog").length, [games]);
  const pinnedCount = games.filter((game) => game.status === "Backlog" && game.pinnedOrder != null).length;
  const ownedTitles = useMemo(() => new Set(games.map((game) => normalizeGameTitle(game.title))), [games]);

  function loadExternalPicks(override = false) {
    if (scoutFlight.current || scoutCooldown.seconds > 0) return;
    if (backlogCount > 5 && !scoutOverride && !override) {
      setScoutUnlocked(false);
      return;
    }
    scoutFlight.current = true;
    playSfx("scan");
    const request = ++scoutRequestId.current;
    setExternalPicks(null);
    setExternalError("");
    startScouting(async () => {
      const startedAt = Date.now();
      try {
        const result = unwrapActionResult(await fetchExternalScout([...seenExternalTitles.current.values()]));
        scoutCooldown.start(DEFAULT_COOLDOWN_SECONDS, startedAt);
        if (request === scoutRequestId.current) {
          for (const pick of result) {
            const key = normalizeGameTitle(pick.title);
            seenExternalTitles.current.delete(key);
            seenExternalTitles.current.set(key, pick.title);
          }
          while (seenExternalTitles.current.size > 30) {
            const oldest = seenExternalTitles.current.keys().next().value;
            if (oldest === undefined) break;
            seenExternalTitles.current.delete(oldest);
          }
          setExternalPicks(result);
        }
      } catch (error) {
        if (error instanceof ActionFailure) scoutCooldown.start(error.retryAfterSeconds);
        if (request === scoutRequestId.current) setExternalError(actionErrorMessage(error, "External scouting failed. Retry the scan to reconnect."));
      } finally { scoutFlight.current = false; }
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
        unwrapActionResult(await addExternalScoutGame(formData));
        playSfx("confirm");
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
    if (advisorFlight.current) return;
    advisorFlight.current = true;
    playSfx("scan");
    const request = ++requestId.current;
    setPicks(null);
    setError("");
    startFetching(async () => {
      try {
        const result = unwrapActionResult(await fetchBacklogAdvisor());
        if (request === requestId.current) setPicks(result);
      } catch (error) {
        if (request === requestId.current) setError(actionErrorMessage(error, "CORTEX could not scan your backlog. Please retry."));
      } finally { advisorFlight.current = false; }
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
        unwrapActionResult(await acceptQuest(gameId));
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
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      // Restore to the current layout's trigger; the previous one may have unmounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      triggerRef.current?.focus();
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
    const heading = variant === "continuation" ? copy("🔗 DIRECT CONTINUATION // SEQUEL & AFFINITY", "THE FAMILIAR PATH · CONTINUE YOUR SAGA") : copy("⚡ PALATE CLEANSER // PACING RESET", "THE WANDERING PATH · A FRESH ADVENTURE");
    return (
      <article className="advisor-card" data-variant={variant}>
        <h3 className="advisor-card-eyebrow">{heading}</h3>
        {pick ? (
          <>
            {pick.game.coverUrl ? (
              // Reuse the library's lazy-loading cover behavior.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="advisor-cover" src={pick.game.coverUrl} alt={`${pick.game.title} cover art`} width={640} height={360} loading="lazy" decoding="async" />
            ) : <div className="advisor-cover advisor-no-cover" role="img" aria-label={`${pick.game.title} cover art unavailable`}>{copy("NO COVER", "NO ARTWORK")}</div>}
            <div className="advisor-card-body">
              <h4>{pick.game.title}</h4>
              <p className="advisor-metadata">{pick.game.platform} · {pick.game.genre?.trim() || "Uncategorized"} · {savedGame?.lengthHours ?? pick.game.lengthHours}h</p>
              <p className="advisor-bounty">+{((savedGame?.lengthHours ?? pick.game.lengthHours) * pick.game.difficulty * 10).toLocaleString("en-US")} POTENTIAL XP</p>
              <div className="advisor-reason"><span>{copy("TACTICAL ASSESSMENT", "A FAIRY’S COUNSEL")}</span><p>{pick.reason}</p></div>
              <div className="advisor-card-actions">
                <button className="advisor-start-button" type="button" disabled={isFetching || isStarting || isAdding} onClick={() => startGig(pick.game.id)}>
                  {startingId === pick.game.id ? copy("ACCEPTING GIG…", "ACCEPTING QUEST…") : copy("▶ START GIG NOW", "▶ BEGIN THIS QUEST")}
                </button>
                <a className="trailer-link-button" href={buildTrailerUrl(pick.game.title, pick.game.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
                {savedGame && <DeckPinButton gameId={savedGame.id} pinnedOrder={savedGame.pinnedOrder} pinnedCount={pinnedCount} releaseYear={pick.game.releaseYear} disabled={isFetching || isStarting || isAdding} />}
              </div>
              <AgentBriefing game={{ ...pick.game, lengthHours: savedGame?.lengthHours ?? pick.game.lengthHours, hoursPlayed: savedGame?.hoursPlayed }} />
            </div>
          </>
        ) : <p className="advisor-empty">{copy("No matching backlog gig available.", "No matching quest awaits in your journal.")}</p>}
      </article>
    );
  }

  return {
    scoutCooldown,
    isOpen,
    picks,
    error,
    isFetching,
    isStarting,
    scoutUnlocked,
    setScoutUnlocked,
    setScoutOverride,
    externalPicks,
    externalError,
    addedTitles,
    addingTitle,
    isScouting,
    isAdding,
    triggerRef,
    dialogRef,
    backlogCount,
    ownedTitles,
    loadExternalPicks,
    openAdvisor,
    addContract,
    loadPicks,
    close,
    renderPick,
  };
}

export type TacticalAdvisorController = ReturnType<typeof useTacticalAdvisorController>;

export default function TacticalAdvisor(props: Parameters<typeof useTacticalAdvisorController>[0]) {
  const controller = useTacticalAdvisorController(props);
  return <TacticalAdvisorView controller={controller} />;
}

export function TacticalAdvisorView({ controller, part = "all" }: { controller: TacticalAdvisorController; part?: "all" | "trigger" | "overlay" }) {
  const copy = useLayoutCopy();
  const {
    scoutCooldown,
    isOpen,
    picks,
    error,
    isFetching,
    isStarting,
    scoutUnlocked,
    setScoutUnlocked,
    setScoutOverride,
    externalPicks,
    externalError,
    addedTitles,
    addingTitle,
    isScouting,
    isAdding,
    triggerRef,
    dialogRef,
    backlogCount,
    ownedTitles,
    loadExternalPicks,
    openAdvisor,
    addContract,
    loadPicks,
    close,
    renderPick,
  } = controller;
  return (
    <>
      {part !== "overlay" && (<button className="advisor-trigger-button" type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={isOpen} onClick={openAdvisor} disabled={isFetching || isScouting}>
        {copy("🧠 CORTEX // ADVISE NEXT GIG", "✧ NAVI // SEEK GUIDANCE")}
      </button>)}
      {part !== "trigger" && isOpen && createPortal(
        <div className="advisor-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div className="advisor-modal" role="dialog" aria-modal="true" aria-labelledby="advisor-title" aria-busy={isFetching || isStarting || isScouting || isAdding} ref={dialogRef} tabIndex={-1}>
            <FantasyCorners />
            <header className="advisor-header">
              <div><p className="eyebrow">{copy("BACKLOG INTELLIGENCE // EXTERNAL SCOUT ONLINE", "A FAIRY’S COUNSEL · THE NEXT CHAPTER AWAITS")}</p><h2 id="advisor-title">{copy("CORTEX // TACTICAL GIG ADVISOR", "Navi Guidance")}</h2></div>
              <button className="advisor-close" type="button" aria-label="Close tactical advisor" disabled={isStarting || isAdding} onClick={close}>✕</button>
            </header>
            <p className="advisor-intro">{copy("Two tactical routes through your saved backlog, informed by your completions, ratings, and current gigs.", "Two paths through your quest journal, guided by your completed adventures, ratings, and current journeys.")}</p>
            {isFetching && <p className="advisor-loading" role="status">{copy("SCANNING LIBRARY // CALIBRATING NEXT GIG…", "CONSULTING THE QUEST SCROLLS…")}</p>}
            {error && <p className="advisor-error" role="alert">{error}</p>}
            {!isFetching && picks && (
              picks.continuationPick || picks.palateCleanserPick ? (
                <div className="advisor-grid">
                  {renderPick(picks.continuationPick, "continuation")}
                  {renderPick(picks.palateCleanserPick, "cleanser")}
                </div>
              ) : <p className="advisor-empty" role="status">{copy("No released backlog gigs are eligible. CORTEX requires a saved release year of this year or earlier.", "No released quests are eligible. Guidance requires a saved release year of this year or earlier.")}</p>
            )}
            {!isFetching && <button className="advisor-refresh" type="button" disabled={isStarting || isAdding} onClick={loadPicks}>{error ? copy("RETRY SCAN", "SEEK GUIDANCE AGAIN") : copy("REFRESH SCAN", "CONSULT THE FAIRY AGAIN")}</button>}
            <section className="advisor-external-section" aria-labelledby="external-scout-title">
              <h3 id="external-scout-title">{copy("02 // EXTERNAL SCOUT (NEW CONTRACTS)", "BEYOND THE MAP · NEW QUESTS")}</h3>
              <p className="advisor-intro">Curated affinity picks from your completed favorites, enriched with RAWG metadata.</p>
              {!scoutUnlocked ? (
                <div className="advisor-scout-locked">
                  <p>{copy(`🔒 EXTERNAL SCOUTING STANDBY // Backlog at ${backlogCount} gigs (Target: <= 5 gigs)`, `✧ Beyond the map is resting · ${backlogCount} quests in your Backlog (Target: <= 5 quests)`)}</p>
                  <button type="button" disabled={isStarting || isAdding || scoutCooldown.seconds > 0 || isScouting} onClick={() => { setScoutOverride(true); setScoutUnlocked(true); loadExternalPicks(true); }}>{scoutCooldown.seconds > 0 ? scoutCooldown.label : copy("⚡ OVERRIDE LOCK & SCAN", "✦ EXPLORE BEYOND THE MAP")}</button>
                </div>
              ) : (
                <>
                  {isScouting && (
                    <div className="advisor-scout-terminal" role="status" aria-live="polite" aria-atomic="true">
                      <span className="advisor-scout-terminal-label" aria-hidden="true">{copy("CORTEX // EXTERNAL SCOUT ONLINE", "NAVI · SCOUTING BEYOND THE MAP")}</span>
                      <p>{copy("SCANNING NEURAL NET // SEARCHING FOR COMPATIBLE CONTRACTS...", "FOLLOWING THE FAIRY LIGHT · SEEKING NEW ADVENTURES…")}<span className="advisor-scout-cursor" aria-hidden="true" /></p>
                    </div>
                  )}
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
                            ) : <div className="advisor-cover advisor-no-cover" role="img" aria-label={`${pick.title} cover art unavailable`}>{copy("NO COVER", "NO ARTWORK")}</div>}
                            <div className="advisor-card-body">
                              <h4>{pick.title}</h4>
                              <p className="advisor-metadata">{pick.platform} · {pick.genre ?? "Genre unknown"} · {pick.releaseYear ?? "Year unknown"}</p>
                              <p className="advisor-bounty">{pick.lengthHours}h EST. // +{(pick.lengthHours * pick.difficulty * 10).toLocaleString("en-US")} POTENTIAL XP</p>
                              <div className="advisor-reason"><span>{copy("ACQUISITION RATIONALE", "WHY THIS QUEST CALLS TO YOU")}</span><p>{pick.reason}</p></div>
                              <div className="advisor-card-actions">
                                <button className="advisor-acquire-button" type="button" data-added={added} disabled={added || isStarting || isAdding} onClick={() => addContract(pick)}>
                                  {added ? "✓ ADDED TO BACKLOG" : addingTitle === key ? copy("ADDING CONTRACT…", "INSCRIBING QUEST…") : "+ ADD TO BACKLOG"}
                                </button>
                                <a className="trailer-link-button" href={buildTrailerUrl(pick.title, pick.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
                              </div>
                              <AgentBriefing game={pick} />
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : <p className="advisor-empty" role="status">{copy("No new affinity picks with a confirmed release year of this year or earlier are available. Complete and rate a gig 4–5 stars to guide scouting; games already in your library are excluded.", "No new released adventures were found. Complete and rate a quest 4–5 stars to guide the fairy; quests already in your journal are excluded.")}</p>)}
                  <button className="advisor-refresh" type="button" disabled={isScouting || isStarting || isAdding || scoutCooldown.seconds > 0} aria-busy={isScouting} onClick={() => loadExternalPicks()}>{isScouting ? copy("SCANNING NEURAL NET…", "FOLLOWING THE FAIRY LIGHT…") : scoutCooldown.seconds > 0 ? scoutCooldown.label : externalError ? copy("RETRY EXTERNAL SCAN", "RETRY THE SEARCH") : copy("RESCAN NEW CONTRACTS", "SEEK NEW QUESTS")}</button>
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
