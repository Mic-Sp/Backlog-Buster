"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import { FantasyCorners } from "@/components/FantasyAccents";

import { unwrapActionResult } from "@/lib/action-result";

import { useEffect, useRef, useState, useTransition } from "react";
import { acceptQuest } from "@/app/actions";
import { buildTrailerUrl } from "@/lib/trailers";
import { isReleasedYear } from "@/lib/game-release";
import DeckPinButton from "@/components/DeckPinButton";
import { useUIEffects } from "@/components/ThemeProvider";

type QuestGame = {
  id: number;
  title: string;
  platform: string;
  genre: string | null;
  lengthHours: number;
  difficulty: number;
  coverUrl: string | null;
  releaseYear?: number | null;
  pinnedOrder: number | null;
};

export function useQuestRouletteController({ games }: { games: QuestGame[] }) {
  const { playSfx } = useUIEffects();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState("all");
  const [genre, setGenre] = useState("");
  const [platform, setPlatform] = useState("");
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const [cyclingTitle, setCyclingTitle] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isAccepting, startAccepting] = useTransition();
  const lastWinnerId = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);

  const currentYear = new Date().getFullYear();
  const releasedGames = games.filter((game) => isReleasedYear(game.releaseYear, currentYear));
  const genres = [...new Set(releasedGames.flatMap((game) => game.genre?.trim() ? [game.genre.trim()] : []))].sort();
  const platforms = [...new Set(releasedGames.map((game) => game.platform.trim()).filter(Boolean))].sort();
  const matches = releasedGames.filter((game) => (
    (time === "all" ||
      (time === "quick" && game.lengthHours <= 15) ||
      (time === "standard" && game.lengthHours >= 16 && game.lengthHours <= 40) ||
      (time === "epic" && game.lengthHours >= 40)) &&
    (!genre || game.genre?.trim() === genre) &&
    (!platform || game.platform.trim() === platform)
  ));
  const winner = matches.find((game) => game.id === winnerId);
  const isRolling = cyclingTitle !== null;
  const busy = isRolling || isAccepting;
  const pinnedCount = games.filter((game) => game.pinnedOrder != null).length;

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      // Restore to the current layout's trigger; the previous one may have unmounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      triggerRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) setIsOpen(false);
      }
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const controls = dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          dialog.focus();
        } else if (!dialog.contains(document.activeElement) || document.activeElement === dialog ||
          (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, busy]);

  function resetResult() {
    setWinnerId(null);
    setMessage("");
  }

  function roll() {
    if (intervalRef.current !== null || isAccepting || matches.length === 0) return;
    playSfx("roll");
    resetResult();
    const candidates = matches.length > 1
      ? matches.filter((game) => game.id !== lastWinnerId.current)
      : matches;
    let index = 0;
    setCyclingTitle(matches[index].title);
    intervalRef.current = setInterval(() => {
      index = (index + 1) % matches.length;
      setCyclingTitle(matches[index].title);
    }, 75);
    timeoutRef.current = setTimeout(() => {
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = null;
      timeoutRef.current = null;
      lastWinnerId.current = selected.id;
      setWinnerId(selected.id);
      setCyclingTitle(null);
    }, 500);
  }

  function accept() {
    if (!winner || busy) return;
    const selected = winner;
    setMessage("");
    startAccepting(async () => {
      try {
        unwrapActionResult(await acceptQuest(selected.id));
        setWinnerId(null);
        setMessage(`${selected.title} accepted. Now Playing. XP is awarded on completion.`);
      } catch {
        setMessage("Could not accept this gig. It may no longer be in your backlog. Try again or reroll.");
      }
    });
  }

  function open() { setIsOpen(true); }
  function close() { if (!busy) setIsOpen(false); }

  return {
    open,
    close,
    games,
    isOpen,
    setIsOpen,
    triggerRef,
    dialogRef,
    time,
    setTime,
    genre,
    setGenre,
    platform,
    setPlatform,
    cyclingTitle,
    message,
    isAccepting,
    currentYear,
    releasedGames,
    genres,
    platforms,
    matches,
    winner,
    isRolling,
    busy,
    pinnedCount,
    resetResult,
    roll,
    accept,
  };
}

export type QuestRouletteController = ReturnType<typeof useQuestRouletteController>;

export default function QuestRoulette(props: Parameters<typeof useQuestRouletteController>[0]) {
  const controller = useQuestRouletteController(props);
  return <QuestRouletteView controller={controller} />;
}

export function QuestRouletteView({ controller, part = "all" }: { controller: QuestRouletteController; part?: "all" | "trigger" | "overlay" }) {
  const copy = useLayoutCopy();
  const {
    open,
    close,
    games,
    isOpen,
    setIsOpen,
    triggerRef,
    dialogRef,
    time,
    setTime,
    genre,
    setGenre,
    platform,
    setPlatform,
    cyclingTitle,
    message,
    isAccepting,
    currentYear,
    releasedGames,
    genres,
    platforms,
    matches,
    winner,
    isRolling,
    busy,
    pinnedCount,
    resetResult,
    roll,
    accept,
  } = controller;
  return (
    <>
      {part !== "overlay" && (<button
        className="quest-trigger-button"
        type="button"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={open}
      >
        {copy("🎲 ROLL RANDOM GIG", "▣ ROLL RANDOM QUEST")}
      </button>)}
      {part !== "trigger" && isOpen && (
        <div
          className="quest-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) setIsOpen(false);
          }}
        >
          <div
            className="quest-roulette quest-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quest-title"
            aria-busy={busy}
            ref={dialogRef}
            tabIndex={-1}
          >
            <FantasyCorners />
            <div className="quest-modal-header">
              <div>
                <p className="eyebrow">{copy("SIDE JOB / RANDOM QUEST GENERATOR", "THE GOSSIP STONE · LET FATE CHOOSE")}</p>
                <h2 id="quest-title">{copy("Backlog Roulette", "The Quest of Chance")}</h2>
              </div>
              <button className="quest-modal-close" type="button" aria-label={copy("Close Backlog Roulette", "Close quest of chance")} disabled={busy} onClick={close}>✕</button>
            </div>
            <p className="quest-intro">{copy("Set your limits. Let the next gig find you.", "Set the bounds of your journey. Let the next quest find you.")}</p>

            <fieldset className="quest-filters" disabled={busy}>
              <legend className="quest-sr-only">Filter backlog games</legend>
              <label>
                Time Commitment
                <select value={time} onChange={(event) => { setTime(event.target.value); resetResult(); }}>
                  <option value="all">All</option>
                  <option value="quick">Quick ≤ 15h</option>
                  <option value="standard">Standard 16–40h</option>
                  <option value="epic">Epic 40h+</option>
                </select>
              </label>
              <label>
                Genre
                <select value={genre} onChange={(event) => { setGenre(event.target.value); resetResult(); }}>
                  <option value="">All</option>
                  {genres.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                Platform
                <select value={platform} onChange={(event) => { setPlatform(event.target.value); resetResult(); }}>
                  <option value="">All</option>
                  {platforms.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </fieldset>

            <p className="quest-match-count">
              {games.length === 0
                ? copy("No backlog gigs yet. Add a game to get started.", "Your quest journal is empty. Inscribe a quest to begin.")
                : releasedGames.length === 0
                  ? copy(`No released gigs available. Roulette requires a release year of ${currentYear} or earlier.`, `No released quests await. The stone requires a release year of ${currentYear} or earlier.`)
                  : matches.length === 0
                    ? copy("No gigs match. Try changing your filters.", "No quests match. Try changing the bounds of your journey.")
                    : copy(`${matches.length} ${matches.length === 1 ? "gig matches" : "gigs match"} your filters.`, `${matches.length} ${matches.length === 1 ? "quest matches" : "quests match"} your filters.`)}
            </p>

            {!winner && (
              <button className="quest-button quest-roll" type="button" disabled={busy || matches.length === 0} onClick={roll}>
                {isRolling ? copy("SCANNING GIGS…", "LISTENING TO THE STONE…") : copy("ROLL RANDOM GIG", "ROLL RANDOM QUEST")}
              </button>
            )}
            {isRolling && <p className="quest-cycling" aria-hidden="true">{cyclingTitle}</p>}

            <div className="quest-result" aria-live="polite" aria-atomic="true">
              {winner && !isRolling && (
                <>
                  <div className="quest-winner">
                    {winner.coverUrl ? (
                      // The roulette uses the same lightweight thumbnails as the library.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="quest-cover" src={winner.coverUrl} alt={`${winner.title} cover art`} width={72} height={96} loading="lazy" decoding="async" />
                    ) : <div className="quest-cover quest-no-cover">{copy("NO COVER", "NO ARTWORK")}</div>}
                    <div>
                      <p className="eyebrow">{copy("GIG FOUND", "A QUEST REVEALED")}</p>
                      <h3>{winner.title}</h3>
                      <p>{winner.platform} · {winner.genre?.trim() || "Unknown genre"} · {winner.lengthHours}h</p>
                      <p className="quest-reward">{(winner.lengthHours * winner.difficulty * 10).toLocaleString("en-US")} XP reward on completion</p>
                    </div>
                  </div>
                  <div className="quest-actions">
                    <button className="quest-button quest-accept" type="button" disabled={busy} onClick={accept}>
                      {isAccepting ? "ACCEPTING…" : copy("ACCEPT GIG", "ACCEPT QUEST")}
                    </button>
                    <button className="quest-button quest-reroll" type="button" disabled={busy} onClick={roll}>REROLL</button>
                    <DeckPinButton gameId={winner.id} pinnedOrder={winner.pinnedOrder} pinnedCount={pinnedCount} releaseYear={winner.releaseYear} disabled={busy} />
                    <a className="trailer-link-button" href={buildTrailerUrl(winner.title, winner.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
                  </div>
                </>
              )}
              {message && <p className="quest-message" role="status">{message}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
