"use client";

import { useUIEffects } from "@/components/ThemeProvider";
import useCooldown from "@/components/useCooldown";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { DEFAULT_COOLDOWN_SECONDS } from "@/lib/cooldown";
import { autoDetectSagaOrder, completeGame, logPlaySession, reorderBacklogGames, reorderSagaTimeline, returnDeckGameToBacklog, startGame } from "@/app/actions";
import type { Achievement } from "@/lib/achievements";
import { compareBacklogPriority, getBacklogInsertionOrder } from "@/lib/backlog-order";
import { DECK_CAPACITY, DECK_DRAG_TYPE, readDeckDrag, type DeckDragGame } from "@/lib/deck";
import { isReleasedYear } from "@/lib/game-release";
import type { SagaChronologyDebug } from "@/lib/saga-debug";
import { buildSagaChains, compareSagaGames, type SagaOrderMode } from "@/lib/sagas";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import FantasySubscreenView from "@/components/FantasySubscreenView";
import { useSubscreen } from "@/components/WorkspaceShell";
import useGameDrafts from "@/components/useGameDrafts";
import { updateGame, deleteGame, flatlineGame } from "@/app/actions";
import CyberpunkLibraryView from "@/components/CyberpunkLibraryView";
import GameMetadataEditor from "@/components/GameMetadataEditor";
import { LibraryDataVaultView, useLibraryDataVaultController } from "@/components/LibraryDataVault";
import { QuestRouletteView, useQuestRouletteController } from "@/components/QuestRoulette";
import { useSagaDebuggerController } from "@/components/SagaChronologyDebugger";
import { TacticalAdvisorView, useTacticalAdvisorController } from "@/components/TacticalAdvisor";
import { useUpNextDeckController } from "@/components/UpNextDeck";
import { DeckPinsContext } from "@/components/useDeckPins";

export type LibraryGame = {
  id: number;
  title: string;
  platform: string;
  status: string;
  wasFlatlined: boolean;
  pinnedOrder: number | null;
  backlogOrder: number | null;
  createdAt: string;
  lengthHours: number;
  hoursPlayed: number;
  notes: string | null;
  rating: number | null;
  difficulty: number;
  earnedXp: number;
  coverUrl: string | null;
  backupCoverUrl?: string | null;
  genre: string | null;
  franchise: string | null;
  chronologicalOrder: number | null;
  releaseYear: number | null;
};

type LibraryView = "Backlog" | "Playing" | "Completed" | "Flatlined" | "All";
type TimelineOrderState = { key: string; ids: number[]; pending: boolean };
const sagaDragType = "application/x-backlogbuster-saga-game";
const backlogDragType = "application/x-backlogbuster-backlog-game";
export type SortColumn = "title" | "platform" | "genre" | "year" | "status" | "hours" | "difficulty" | "xp";
const statusPriority: Record<string, number> = { Playing: 0, Backlog: 1, Completed: 2, Flatlined: 3 };
const primaryColumnSort = {
  title: "title-asc",
  platform: "platform-asc",
  genre: "genre-asc",
  year: "year-desc",
  status: "status-asc",
  hours: "hours-asc",
  difficulty: "difficulty-desc",
  xp: "xp-desc",
} as const;

function sortableXp(game: LibraryGame) {
  return game.status === "Flatlined" ? 0 : game.earnedXp || game.lengthHours * game.difficulty * 10;
}

function comparePinnedGames(left: LibraryGame, right: LibraryGame) {
  const leftSlot = left.status === "Backlog" ? left.pinnedOrder ?? DECK_CAPACITY + 1 : DECK_CAPACITY + 1;
  const rightSlot = right.status === "Backlog" ? right.pinnedOrder ?? DECK_CAPACITY + 1 : DECK_CAPACITY + 1;
  return leftSlot - rightSlot;
}


function useGameLibraryController({ games: serverGames, achievements = [], isAdmin = false, children }: { games: LibraryGame[]; achievements?: Achievement[]; isAdmin?: boolean; children?: ReactNode }) {
  const { playSfx, layoutMode } = useUIEffects();
  const { showPane } = useSubscreen();
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [gameActionError, setGameActionError] = useState("");
  async function mutateGame<T>(action: (data: FormData) => Promise<T>, data: FormData) {
    setGameActionError("");
    try {
      const result = await action(data);
      unwrapActionResult(result);
      return result;
    } catch (error) {
      setGameActionError(actionErrorMessage(error));
      throw error;
    }
  }
  async function completeGameWithSound(data: FormData) {
    const result = unwrapActionResult(await mutateGame(completeGame, data));
    playSfx("confirm");
    return result;
  }
  const sagaCooldown = useCooldown();
  const sagaProviderCooldown = useCooldown();
  const sagaScanRef = useRef(false);
  const [sagaDebug, setSagaDebug] = useState<{ key: string; data: SagaChronologyDebug } | null>(null);
  const [games, returnToBacklogOptimistically] = useOptimistic<LibraryGame[], { gameId: number; orderedIds: number[] | null }>(serverGames, (current, move) => {
    const ranks = new Map(move.orderedIds?.map((id, index) => [id, index + 1]));
    return current.map((game) => game.id === move.gameId || ranks.has(game.id) ? {
      ...game,
      ...(game.id === move.gameId ? { pinnedOrder: null } : {}),
      ...(ranks.has(game.id) ? { backlogOrder: ranks.get(game.id)! } : {}),
    } : game);
  });
  const [isReturningDeck, startReturningDeck] = useTransition();
  const returningDeckRef = useRef(false);
  const [deckReturnNotice, setDeckReturnNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [backlogReturnHover, setBacklogReturnHover] = useState(false);
  const [backlogReturnTarget, setBacklogReturnTarget] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<LibraryView>("Backlog");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [sagaFilter, setSagaFilter] = useState("");
  const sagaFilterRef = useRef("");
  const [sortBy, setSortBy] = useState("default");
  const [revealedGameId, setRevealedGameId] = useState<number | null>(null);
  const [isDetectingSaga, startDetectingSaga] = useTransition();
  const [sagaNotice, setSagaNotice] = useState<{ key: string; text: string; error: boolean } | null>(null);
  const [isReorderingTimeline, startReorderingTimeline] = useTransition();
  const [isReorderingBacklog, startReorderingBacklog] = useTransition();
  const [backlogNotice, setBacklogNotice] = useState<{ text: string; error: boolean } | null>(null);
  const reorderInFlightRef = useRef(false);
  const collectionRef = useRef<HTMLElement>(null);
  const reorderFocusRef = useRef<{ id: number; direction: number } | null>(null);
  const dragSourceRef = useRef<number | null>(null);
  const dragPointerGameRef = useRef<DeckDragGame | null>(null);
  const dragFromControlRef = useRef(false);
  const [dragSourceId, setDragSourceId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [deckDraggedGame, setDeckDraggedGame] = useState<DeckDragGame | null>(null);
  const [editingMetaGame, setEditingMetaGame] = useState<LibraryGame | null>(null);
  const metadataModalRef = useRef<HTMLFormElement>(null);
  const [isLogging, startLogging] = useTransition();
  const [sessionError, setSessionError] = useState<{ gameId: number; message: string } | null>(null);
  const pinnedCount = games.filter((game) => game.status === "Backlog" && game.pinnedOrder != null).length;
  const currentYear = new Date().getFullYear();
  const { chains, byGameId } = useMemo(() => buildSagaChains(games), [games]);
  const selectedSaga = chains.find((chain) => chain.key === sagaFilter);
  const serverTimelineIds = useMemo(() => {
    const ids = new Set(selectedSaga?.gameIds);
    return games.filter((game) => ids.has(game.id)).sort((left, right) => compareSagaGames(left, right, "timeline")).map((game) => game.id);
  }, [games, selectedSaga]);
  const [optimisticTimeline, setOptimisticTimeline] = useOptimistic<TimelineOrderState, TimelineOrderState>(
    { key: selectedSaga?.key ?? "", ids: serverTimelineIds, pending: false },
    (_previous, next) => next,
  );
  const timelineIds = optimisticTimeline.key === selectedSaga?.key ? optimisticTimeline.ids : serverTimelineIds;
  const timelinePositions = useMemo(() => new Map(timelineIds.map((id, index) => [id, index])), [timelineIds]);
  const inTimelineView = Boolean(selectedSaga) && sortBy === "timeline-asc";
  const timelineBusy = isReorderingTimeline || isDetectingSaga;
  const serverBacklogIds = useMemo(() => games
    .filter((game) => game.status === "Backlog" && game.pinnedOrder == null)
    .sort(compareBacklogPriority).map((game) => game.id), [games]);
  const [backlogIds, setOptimisticBacklog] = useOptimistic<number[], number[]>(serverBacklogIds, (_previous, next) => next);
  const backlogPositions = useMemo(() => new Map(backlogIds.map((id, index) => [id, index])), [backlogIds]);
  const inBacklogPriorityView = activeView === "Backlog" && !sagaFilter && (sortBy === "default" || sortBy === "custom-priority");
  const canReorderBacklog = inBacklogPriorityView && !searchQuery.trim();
  const rowReorderBusy = timelineBusy || isReorderingBacklog || isReturningDeck;
  const returningGame = deckDraggedGame?.source === "deck" ? games.find((game) => game.id === deckDraggedGame.gameId && game.status === "Backlog" && game.pinnedOrder != null) : null;
  const canReturnToBacklog = (activeView === "All" || activeView === "Backlog") && Boolean(returningGame) && !rowReorderBusy;

  useEffect(() => {
    if (isReorderingTimeline || isReorderingBacklog || !reorderFocusRef.current) return;
    const { id, direction } = reorderFocusRef.current;
    reorderFocusRef.current = null;
    if (document.activeElement !== document.body) return;
    const controls = collectionRef.current?.querySelectorAll<HTMLButtonElement>(`button[data-reorder-game-id="${id}"]:not(:disabled)`);
    const visibleControls = Array.from(controls ?? []).filter(button => button.getClientRects().length > 0);
    const target = visibleControls.find(button => button.dataset.reorderDirection === String(direction)) ?? visibleControls[0];
    target?.focus();
  }, [isReorderingTimeline, isReorderingBacklog, games]);

  function logSession(gameId: number, addHours: number) {
    setSessionError(null);
    startLogging(async () => {
      try {
        unwrapActionResult(await logPlaySession(gameId, addHours));
      } catch {
        setSessionError({ gameId, message: "Could not log this session. Please try again." });
      }
    });
  }

  useEffect(() => {
    if (!editingMetaGame) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = metadataModalRef.current;
    modal?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setEditingMetaGame(null);
      }
      if (event.key === "Tab" && modal) {
        const controls = modal.querySelectorAll<HTMLElement>('input:not([type="hidden"]), button');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (trigger?.isConnected) trigger.focus();
      // Locate the replacement trigger if switching views removed the original.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      else collectionRef.current?.querySelector<HTMLButtonElement>(`[data-metadata-trigger-id="${editingMetaGame?.id}"]`)?.focus();
    };
  }, [editingMetaGame]);

  const { platforms, genres, viewCounts } = useMemo(() => ({
    platforms: [...new Set(games.map((game) => game.platform.trim()).filter(Boolean))].sort(),
    genres: [...new Set(games.flatMap((game) => game.genre?.trim() ? [game.genre.trim()] : []))].sort(),
    viewCounts: {
      All: games.length,
      Playing: games.filter((game) => game.status === "Playing").length,
      Backlog: games.filter((game) => game.status === "Backlog").length,
      Completed: games.filter((game) => game.status === "Completed").length,
      Flatlined: games.filter((game) => game.status === "Flatlined").length,
    },
  }), [games]);

  const visibleGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = games.filter((game) => (
      (activeView === "All" || game.status === activeView) &&
      (!platformFilter || game.platform.trim() === platformFilter) &&
      (!genreFilter || game.genre?.trim() === genreFilter) &&
      (!selectedSaga || byGameId.get(game.id)?.key === selectedSaga.key) &&
      (!query || [game.title, game.genre, game.platform].some((value) => value?.toLowerCase().includes(query)))
    ));
    if (inBacklogPriorityView) {
      return [...filtered].sort((left, right) => comparePinnedGames(left, right) ||
        (backlogPositions.get(left.id) ?? Infinity) - (backlogPositions.get(right.id) ?? Infinity));
    }
    if (sortBy === "default") {
      return activeView === "Backlog" ? [...filtered].sort(comparePinnedGames) : filtered;
    }

    return [...filtered].sort((left, right) => {
      switch (sortBy) {
        case "timeline-asc":
          return selectedSaga
            ? (timelinePositions.get(left.id) ?? Infinity) - (timelinePositions.get(right.id) ?? Infinity)
            : compareSagaGames(left, right, "release");
        case "rating-desc":
        case "rating-asc":
          if (left.rating === null && right.rating === null) return 0;
          if (left.rating === null) return 1;
          if (right.rating === null) return -1;
          return sortBy === "rating-desc" ? right.rating - left.rating : left.rating - right.rating;
        case "pinned-first":
          return comparePinnedGames(left, right);
        case "hours-asc":
          return left.lengthHours - right.lengthHours;
        case "hours-desc":
          return right.lengthHours - left.lengthHours;
        case "xp-desc":
          return sortableXp(right) - sortableXp(left);
        case "xp-asc":
          return sortableXp(left) - sortableXp(right);
        case "year-desc":
        case "year-asc":
          if (left.releaseYear === null && right.releaseYear === null) return 0;
          if (left.releaseYear === null) return 1;
          if (right.releaseYear === null) return -1;
          return sortBy === "year-desc"
            ? right.releaseYear - left.releaseYear
            : left.releaseYear - right.releaseYear;
        case "title-asc":
          return left.title.localeCompare(right.title);
        case "title-desc":
          return right.title.localeCompare(left.title);
        case "platform-asc":
          return left.platform.localeCompare(right.platform);
        case "platform-desc":
          return right.platform.localeCompare(left.platform);
        case "genre-asc":
        case "genre-desc": {
          const leftGenre = left.genre?.trim() || "";
          const rightGenre = right.genre?.trim() || "";
          if (!leftGenre && !rightGenre) return 0;
          if (!leftGenre) return 1;
          if (!rightGenre) return -1;
          return sortBy === "genre-asc"
            ? leftGenre.localeCompare(rightGenre)
            : rightGenre.localeCompare(leftGenre);
        }
        case "status-asc":
          return (statusPriority[left.status] ?? 4) - (statusPriority[right.status] ?? 4);
        case "status-desc":
          return (statusPriority[right.status] ?? 4) - (statusPriority[left.status] ?? 4);
        case "difficulty-desc":
          return right.difficulty - left.difficulty;
        case "difficulty-asc":
          return left.difficulty - right.difficulty;
        default:
          return 0;
      }
    });
  }, [games, activeView, searchQuery, platformFilter, genreFilter, selectedSaga, byGameId, sortBy, timelinePositions, inBacklogPriorityView, backlogPositions]);
  const visibleTimelinePositions = useMemo(() => new Map(visibleGames.map((game, index) => [game.id, index])), [visibleGames]);
  const visibleBacklogIds = useMemo(() => visibleGames.filter((game) => game.pinnedOrder == null).map((game) => game.id), [visibleGames]);
  const visibleBacklogPositions = useMemo(() => new Map(visibleBacklogIds.map((id, index) => [id, index])), [visibleBacklogIds]);
  const hasLibraryFilters = searchQuery !== "" || platformFilter !== "" || genreFilter !== "" || Boolean(selectedSaga) || sortBy !== "default";
  const hasActiveFilters = activeView !== "Backlog" || hasLibraryFilters;
  const showFilteredCount = activeView !== "All" || hasLibraryFilters;

  function clearFilters() {
    setActiveView("Backlog");
    setSearchQuery("");
    setPlatformFilter("");
    setGenreFilter("");
    setSagaFilter("");
    sagaFilterRef.current = "";
    setSagaNotice(null);
    setSortBy("default");
  }

  useEffect(() => {
    function showAddedGame(event: Event) {
      const id: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return;
      setActiveView("Backlog");
      setSearchQuery("");
      setPlatformFilter("");
      setGenreFilter("");
      setSagaFilter("");
      sagaFilterRef.current = "";
      setSagaNotice(null);
      setSortBy("default");
      setRevealedGameId(id);
      setSelectedGameId(id);
      showPane("items");
    }
    window.addEventListener("backlogbuster:game-added", showAddedGame);
    return () => window.removeEventListener("backlogbuster:game-added", showAddedGame);
  }, [showPane]);

  useEffect(() => {
    if (revealedGameId === null || !visibleGames.some(game => game.id === revealedGameId)) return;
    // Wait for the refreshed library and its selected view to commit before scrolling.
    const frame = requestAnimationFrame(() => {
      const matches = collectionRef.current?.querySelectorAll<HTMLElement>(`[data-library-game-id="${revealedGameId}"]`);
      const row = Array.from(matches ?? []).find(element => element.getClientRects().length > 0);
      if (!row) return;
      row.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      setRevealedGameId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealedGameId, visibleGames]);

  async function startGameAndShowPlaying(data: FormData) {
    const result = unwrapActionResult(await mutateGame(startGame, data));
    clearFilters();
    setActiveView("Playing");
    showPane("items");
    setRevealedGameId(Number(data.get("id")));
    setSelectedGameId(Number(data.get("id")));
    return result;
  }

  function selectSaga(key: string) {
    if (key !== sagaFilter) playSfx("page");
    setSagaFilter(key);
    sagaFilterRef.current = key;
    setSagaNotice(null);
    if (!key) {
      setActiveView("Backlog");
      setSortBy("default");
      return;
    }
    setActiveView("All");
    setSearchQuery("");
    setPlatformFilter("");
    setGenreFilter("");
    setSortBy("year-asc");
  }

  function changeSagaOrder(order: SagaOrderMode) {
    playSfx("page");
    setSortBy(order === "timeline" ? "timeline-asc" : "year-asc");
  }

  function detectSagaOrder(forceRefresh = false) {
    if (!selectedSaga || timelineBusy || reorderInFlightRef.current || sagaScanRef.current || sagaProviderCooldown.seconds > 0 || (!forceRefresh && sagaCooldown.seconds > 0)) return;
    const key = selectedSaga.key;
    setSagaNotice(null);
    sagaScanRef.current = true;
    startDetectingSaga(async () => {
      const startedAt = Date.now();
      try {
        const result = await autoDetectSagaOrder(key, forceRefresh);
        if (!result.error) {
          sagaCooldown.start(DEFAULT_COOLDOWN_SECONDS, startedAt);
          sagaProviderCooldown.start(DEFAULT_COOLDOWN_SECONDS, startedAt);
        }
        if ("retryAfterSeconds" in result && typeof result.retryAfterSeconds === "number") {
          sagaCooldown.start(result.retryAfterSeconds);
          sagaProviderCooldown.start(result.retryAfterSeconds);
        }
        if ("refreshRetryAfterSeconds" in result && result.refreshRetryAfterSeconds > 0) {
          sagaCooldown.start(result.refreshRetryAfterSeconds);
        }
        if (sagaFilterRef.current !== key) return;
        if (isAdmin && "debug" in result && result.debug) {
          const debug = result.debug;
          setSagaDebug(current => ({ key, data: { ...debug,
            geminiPayload: debug.geminiPayload ?? (current?.key === key ? current.data.geminiPayload : undefined),
          } }));
        }
        setSagaNotice({ key, text: "retryAfterSeconds" in result && result.retryAfterSeconds
          ? "Canon provider is cooling down. Available ranks were preserved; wait for the countdown before retrying."
          : result.error ?? result.message ?? "Canon scan complete.", error: Boolean(result.error) });
        if ("updatedCount" in result && result.updatedCount > 0) setSortBy("timeline-asc");
      } catch {
        if (sagaFilterRef.current === key) setSagaNotice({ key, text: "Canon scan failed. Existing ranks were kept; unassigned games use release order.", error: true });
      } finally { sagaScanRef.current = false; }
    });
  }

  const sagaOrder: SagaOrderMode | null = sortBy === "timeline-asc" ? "timeline" : sortBy === "year-asc" ? "release" : null;
  const sagaOrderControls = { order: sagaOrder, onOrderChange: changeSagaOrder, onAutoDetect: () => detectSagaOrder(), isDetecting: isDetectingSaga, cooldownSeconds: sagaCooldown.seconds, disabled: isReorderingTimeline };

  function persistVisibleTimeline(orderedVisibleIds: number[]) {
    if (!selectedSaga || !inTimelineView || timelineBusy || reorderInFlightRef.current) return;
    const key = selectedSaga.key;
    const visibleIds = new Set(visibleGames.map((game) => game.id));
    let index = 0;
    // Reorder only visible positions; preserve hidden games and send the full saga.
    const orderedIds = timelineIds.map((id) => visibleIds.has(id) ? orderedVisibleIds[index++] : id);
    if (orderedIds.every((id, position) => id === timelineIds[position])) return;
    reorderInFlightRef.current = true;
    setSagaNotice(null);
    startReorderingTimeline(async () => {
      setOptimisticTimeline({ key, ids: orderedIds, pending: true });
      try {
        unwrapActionResult(await reorderSagaTimeline(orderedIds.map(String)));
        if (sagaFilterRef.current === key) setSagaNotice({ key, text: "Timeline order saved.", error: false });
      } catch {
        if (sagaFilterRef.current === key) setSagaNotice({ key, text: "Could not save timeline order. Your previous order has been restored; refresh and try again.", error: true });
      } finally {
        reorderInFlightRef.current = false;
      }
    });
  }

  function swapTimelineGame(gameId: number, direction: number) {
    const ids = visibleGames.map((game) => game.id);
    const from = ids.indexOf(gameId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length || timelineBusy || reorderInFlightRef.current) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorderFocusRef.current = { id: gameId, direction };
    persistVisibleTimeline(ids);
  }

  function persistVisibleBacklog(orderedVisibleIds: number[]) {
    if (!canReorderBacklog || rowReorderBusy || reorderInFlightRef.current) return;
    const visibleIds = new Set(visibleBacklogIds);
    let index = 0;
    // Keep hidden games in place and persist the entire unpinned priority queue.
    const orderedIds = backlogIds.map((id) => visibleIds.has(id) ? orderedVisibleIds[index++] : id);
    if (orderedIds.every((id, position) => id === backlogIds[position])) return;
    reorderInFlightRef.current = true;
    setBacklogNotice(null);
    startReorderingBacklog(async () => {
      setOptimisticBacklog(orderedIds);
      try {
        unwrapActionResult(await reorderBacklogGames(orderedIds.map(String)));
        setBacklogNotice({ text: "Backlog priority saved.", error: false });
      } catch {
        setBacklogNotice({ text: "Could not save Backlog priority. Your previous order has been restored; refresh and try again.", error: true });
      } finally {
        reorderInFlightRef.current = false;
      }
    });
  }

  function swapBacklogGame(gameId: number, direction: number) {
    const ids = [...visibleBacklogIds];
    const from = ids.indexOf(gameId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length || rowReorderBusy || reorderInFlightRef.current) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorderFocusRef.current = { id: gameId, direction };
    persistVisibleBacklog(ids);
  }

  function isReorderableRow(gameId: number) {
    return inTimelineView || (canReorderBacklog && visibleBacklogPositions.has(gameId));
  }

  function canDragToDeck(game: LibraryGame) {
    return game.status === "Backlog" && isReleasedYear(game.releaseYear, currentYear);
  }

  function endRowDrag() {
    dragSourceRef.current = null;
    dragPointerGameRef.current = null;
    setDragSourceId(null);
    setDropTargetId(null);
    setDeckDraggedGame(null);
    setBacklogReturnHover(false);
    setBacklogReturnTarget(null);
  }

  function changeDeckDrag(game: DeckDragGame | null) {
    if (game) setDeckDraggedGame(game);
    else endRowDrag();
  }

  function rememberDragOrigin(game: DeckDragGame, fromControl: boolean) {
    dragPointerGameRef.current = game;
    dragFromControlRef.current = fromControl;
  }

  function backlogTargetFromEvent(event: DragEvent<HTMLElement>) {
    if (!inBacklogPriorityView || !(event.target instanceof Element)) return null;
    const row = event.target.closest<HTMLElement>("[data-reorder-row-id]");
    const id = Number(row?.dataset.reorderRowId);
    return visibleGames.some((game) => game.id === id && game.status === "Backlog" && game.pinnedOrder == null) ? id : null;
  }

  function dragOverBacklog(event: DragEvent<HTMLElement>) {
    if (!canReturnToBacklog || !event.dataTransfer.types.includes(DECK_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setBacklogReturnHover(true);
    setBacklogReturnTarget(backlogTargetFromEvent(event));
  }

  function leaveBacklog(event: DragEvent<HTMLElement>) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      setBacklogReturnHover(false);
      setBacklogReturnTarget(null);
    }
  }

  function dropDeckIntoBacklog(event: DragEvent<HTMLElement>) {
    if (!canReturnToBacklog || !returningGame || returningDeckRef.current || reorderInFlightRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const drag = readDeckDrag(event.dataTransfer);
    const beforeGameId = backlogTargetFromEvent(event);
    const source = returningGame;
    endRowDrag();
    if (drag?.source !== "deck" || drag.gameId !== source.id) return;
    const orderedIds = beforeGameId === null ? null : getBacklogInsertionOrder(games, source.id, beforeGameId);
    returningDeckRef.current = true;
    setDeckReturnNotice(null);
    startReturningDeck(async () => {
      returnToBacklogOptimistically({ gameId: source.id, orderedIds });
      try {
        unwrapActionResult(await returnDeckGameToBacklog(source.id, beforeGameId));
        setDeckReturnNotice({ text: `${source.title} returned to Backlog${beforeGameId === null ? "." : " at the selected priority position."}`, error: false });
      } catch {
        setDeckReturnNotice({ text: "Could not return this gig to Backlog. Its deck slot and previous queue order have been restored; refresh and try again.", error: true });
      } finally {
        returningDeckRef.current = false;
      }
    });
  }

  function startLibraryDrag(event: DragEvent<HTMLElement>, fallback: DeckDragGame) {
    if (rowReorderBusy || reorderInFlightRef.current || dragFromControlRef.current) {
      event.preventDefault();
      return;
    }
    // Auto-scrolling between pointerdown and dragstart can retarget the native
    // event. Keep the source anchored to the row the player actually grabbed.
    const origin = dragPointerGameRef.current ?? fallback;
    const sourceId = origin.gameId;
    const fromDeck = origin.source === "deck";
    const sourceGame = games.find((game) => game.id === sourceId);
    if (!sourceGame || (fromDeck
      ? sourceGame.status !== "Backlog" || sourceGame.pinnedOrder == null
      : !isReorderableRow(sourceId) && !canDragToDeck(sourceGame))) {
      event.preventDefault();
      return;
    }
    if (!fromDeck && isReorderableRow(sourceId)) event.dataTransfer.setData(inTimelineView ? sagaDragType : backlogDragType, String(sourceId));
    if (fromDeck || canDragToDeck(sourceGame)) {
      event.dataTransfer.setData(DECK_DRAG_TYPE, JSON.stringify(origin));
      setDeckDraggedGame(origin);
    }
    event.dataTransfer.effectAllowed = "move";
    const sources = collectionRef.current?.querySelectorAll<HTMLElement>(fromDeck ? `[data-deck-game-id="${sourceId}"]` : `[data-reorder-row-id="${sourceId}"]`);
    const source = Array.from(sources ?? []).find(element => element.getClientRects().length > 0);
    if (source) event.dataTransfer.setDragImage(source, 16, source.offsetHeight / 2);
    dragSourceRef.current = fromDeck ? null : sourceId;
    setDragSourceId(fromDeck ? null : sourceId);
  }

  function dropRowGame(event: DragEvent<HTMLElement>, targetId: number) {
    if (!isReorderableRow(targetId) || rowReorderBusy || dragSourceRef.current === null) return;
    event.preventDefault();
    const sourceId = dragSourceRef.current;
    const matchesSource = event.dataTransfer.getData(inTimelineView ? sagaDragType : backlogDragType) === String(sourceId);
    endRowDrag();
    if (!isReorderableRow(sourceId) || !matchesSource || sourceId === targetId) return;
    const ids = inTimelineView ? visibleGames.map((game) => game.id) : [...visibleBacklogIds];
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    if (inTimelineView) persistVisibleTimeline(ids);
    else persistVisibleBacklog(ids);
  }

  function dragOverLibraryGame(event: DragEvent<HTMLElement>, targetId: number) {
    if (!isReorderableRow(targetId) || rowReorderBusy || dragSourceRef.current === null || !isReorderableRow(dragSourceRef.current) || dragSourceRef.current === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
  }

  function leaveLibraryGame(event: DragEvent<HTMLElement>, targetId: number) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTargetId(current => current === targetId ? null : current);
  }

  function changeView(view: LibraryView) {
    if (view !== activeView) playSfx("page");
    setActiveView(view);
    if ((view === "Backlog" && sortBy.startsWith("rating-")) ||
      (view !== "All" && view !== "Backlog" && sortBy === "pinned-first") ||
      (view !== "Backlog" && sortBy === "custom-priority")) {
      setSortBy("default");
    }
  }

  function toggleColumnSort(column: SortColumn) {
    const primary = primaryColumnSort[column];
    const reverse = primary.endsWith("asc") ? `${column}-desc` : `${column}-asc`;
    setSortBy((current) => current === primary ? reverse : primary);
  }

  function openMetadata(game: LibraryGame) { setEditingMetaGame(game); }
  function closeMetadata() { setEditingMetaGame(null); }

  const drafts = useGameDrafts(games);
  const advisor = useTacticalAdvisorController({ games });
  const vault = useLibraryDataVaultController({ games });
  const roulette = useQuestRouletteController({ games: games.filter(game => game.status === "Backlog") });
  const deck = useUpNextDeckController({ startAction: startGameAndShowPlaying, games, draggedGame: deckDraggedGame, onDragGameChange: changeDeckDrag, onDragPointerDown: rememberDragOrigin, onGameDragStart: startLibraryDrag, disabled: rowReorderBusy });
  const debuggerController = useSagaDebuggerController({ enabled: isAdmin && Boolean(selectedSaga), sagaKey: selectedSaga?.key ?? "", scanDebug: sagaDebug?.key === selectedSaga?.key ? sagaDebug?.data ?? null : null, busy: timelineBusy, cooldownSeconds: sagaProviderCooldown.seconds, onForceRefresh: () => detectSagaOrder(true) });
  const controller = {
    ...drafts,
    gameActionError,
    actions: {
      updateGame: (data: FormData) => mutateGame(updateGame, data),
      deleteGame: (data: FormData) => mutateGame(deleteGame, data),
      flatlineGame: (data: FormData) => mutateGame(flatlineGame, data),
    },
    selectedGameId,
    setSelectedGameId,
    completeGameWithSound,
    games,
    isReturningDeck,
    deckReturnNotice,
    backlogReturnHover,
    backlogReturnTarget,
    activeView,
    searchQuery,
    setSearchQuery,
    platformFilter,
    setPlatformFilter,
    genreFilter,
    setGenreFilter,
    sortBy,
    setSortBy,
    sagaNotice,
    backlogNotice,
    dragSourceRef,
    dragSourceId,
    dropTargetId,
    setDropTargetId,
    openMetadata,
    closeMetadata,
    editingMetaGame,
    setEditingMetaGame,
    metadataModalRef,
    isLogging,
    sessionError,
    pinnedCount,
    currentYear,
    chains,
    byGameId,
    selectedSaga,
    optimisticTimeline,
    timelinePositions,
    inTimelineView,
    timelineBusy,
    backlogPositions,
    inBacklogPriorityView,
    canReorderBacklog,
    rowReorderBusy,
    canReturnToBacklog,
    logSession,
    platforms,
    genres,
    viewCounts,
    visibleGames,
    visibleTimelinePositions,
    visibleBacklogIds,
    visibleBacklogPositions,
    hasActiveFilters,
    showFilteredCount,
    clearFilters,
    startGameAndShowPlaying,
    selectSaga,
    sagaOrderControls,
    swapTimelineGame,
    swapBacklogGame,
    isReorderableRow,
    canDragToDeck,
    endRowDrag,
    rememberDragOrigin,
    dragOverBacklog,
    leaveBacklog,
    dropDeckIntoBacklog,
    startLibraryDrag,
    dropRowGame,
    dragOverLibraryGame,
    leaveLibraryGame,
    changeView,
    toggleColumnSort,
    achievements,
    isAdmin,
    children,
    collectionRef,
    layoutMode,
    advisor,
    vault,
    roulette,
    deck,
    debuggerController,
  };

  return controller;
}

export type GameLibraryController = ReturnType<typeof useGameLibraryController>;

export default function GameLibrary(props: Parameters<typeof useGameLibraryController>[0]) {
  const controller = useGameLibraryController(props);
  const {
    collectionRef,
    layoutMode,
    advisor,
    vault,
    roulette,
  } = controller;
  return <DeckPinsContext.Provider value={controller.deck.pins}>
    <section className="collection" aria-labelledby="collection-title" ref={collectionRef} data-library-layout={layoutMode} onInputCapture={controller.captureGameDraft} onChangeCapture={controller.captureGameDraft}>
    {layoutMode === "fantasy" ? <FantasySubscreenView controller={controller} /> : <CyberpunkLibraryView controller={controller} />}
    <TacticalAdvisorView controller={advisor} part="overlay" />
    <LibraryDataVaultView controller={vault} part="overlay" />
    <QuestRouletteView controller={roulette} part="overlay" />
    <GameMetadataEditor controller={controller} />
    {controller.gameActionError && <p className="form-action-error library-action-error" role="alert">{controller.gameActionError}</p>}
    </section>
  </DeckPinsContext.Provider>;
}
