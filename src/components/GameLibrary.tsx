"use client";

import useCooldown from "@/components/useCooldown";
import { DEFAULT_COOLDOWN_SECONDS } from "@/lib/cooldown";
import { unwrapActionResult } from "@/lib/action-result";

import SafeForm, { SafeActionButton } from "@/components/SafeForm";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { autoDetectSagaOrder, completeGame, deleteGame, flatlineGame, logPlaySession, reorderBacklogGames, reorderSagaTimeline, returnDeckGameToBacklog, startGame, updateGame } from "@/app/actions";
import type { Achievement } from "@/lib/achievements";
import StarRatingInput from "@/components/StarRatingInput";
import LibraryDataVault from "@/components/LibraryDataVault";
import LibraryTelemetry from "@/components/LibraryTelemetry";
import TrophyRatingEditor from "@/components/TrophyRatingEditor";
import TacticalAdvisor from "@/components/TacticalAdvisor";
import { buildTrailerUrl } from "@/lib/trailers";
import DeckPinButton from "@/components/DeckPinButton";
import UpNextDeck from "@/components/UpNextDeck";
import { DECK_CAPACITY, DECK_DRAG_TYPE, readDeckDrag, type DeckDragGame } from "@/lib/deck";
import { isReleasedYear } from "@/lib/game-release";
import AgentBriefing from "@/components/AgentBriefing";
import SagaChains, { SagaBadge, SagaOrderControls } from "@/components/SagaChains";
import SagaChronologyDebugger from "@/components/SagaChronologyDebugger";
import type { SagaChronologyDebug } from "@/lib/saga-debug";
import { buildSagaChains, compareSagaGames, type SagaOrderMode } from "@/lib/sagas";
import { compareBacklogPriority, getBacklogInsertionOrder } from "@/lib/backlog-order";
import "./BacklogReorder.css";

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

const statuses = ["Backlog", "Playing", "Completed", "Flatlined"];
const views = ["Backlog", "Playing", "Completed", "Flatlined", "All"] as const;
type LibraryView = typeof views[number];
type TimelineOrderState = { key: string; ids: number[]; pending: boolean };
const sagaDragType = "application/x-backlogbuster-saga-game";
const backlogDragType = "application/x-backlogbuster-backlog-game";
type SortColumn = "title" | "platform" | "genre" | "year" | "status" | "hours" | "difficulty" | "xp";
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
const difficultyLabels: Record<number, string> = { 1: "Easy", 2: "Medium", 3: "Tough" };

function sortableXp(game: LibraryGame) {
  return game.status === "Flatlined" ? 0 : game.earnedXp || game.lengthHours * game.difficulty * 10;
}

function comparePinnedGames(left: LibraryGame, right: LibraryGame) {
  const leftSlot = left.status === "Backlog" ? left.pinnedOrder ?? DECK_CAPACITY + 1 : DECK_CAPACITY + 1;
  const rightSlot = right.status === "Backlog" ? right.pinnedOrder ?? DECK_CAPACITY + 1 : DECK_CAPACITY + 1;
  return leftSlot - rightSlot;
}

export default function GameLibrary({ games: serverGames, achievements = [], children }: { games: LibraryGame[]; achievements?: Achievement[]; children?: ReactNode }) {
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
    const target = Array.from(controls ?? []).find((button) => button.dataset.reorderDirection === String(direction)) ?? controls?.[0];
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
      trigger?.focus();
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
    }
    window.addEventListener("backlogbuster:game-added", showAddedGame);
    return () => window.removeEventListener("backlogbuster:game-added", showAddedGame);
  }, []);

  useEffect(() => {
    if (revealedGameId === null || !visibleGames.some(game => game.id === revealedGameId)) return;
    // Wait for the refreshed library and its selected view to commit before scrolling.
    const frame = requestAnimationFrame(() => {
      const row = collectionRef.current?.querySelector<HTMLElement>(`[data-reorder-row-id="${revealedGameId}"], .spotlight-card[data-game-id="${revealedGameId}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      setRevealedGameId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealedGameId, visibleGames]);

  async function startGameAndShowPlaying(data: FormData) {
    const result = unwrapActionResult(await startGame(data));
    clearFilters();
    setActiveView("Playing");
    setRevealedGameId(Number(data.get("id")));
    return result;
  }

  function selectSaga(key: string) {
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
        if ("debug" in result && result.debug?.status === "refresh-deferred" && result.debug.updatedAt) {
          sagaCooldown.start(300, new Date(result.debug.updatedAt).getTime());
        }
        if (sagaFilterRef.current !== key) return;
        if ("debug" in result && result.debug) {
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
    const row = event.target.closest<HTMLFormElement>("form.game-row");
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

  function startLibraryDrag(event: DragEvent<HTMLFormElement>, fallback: DeckDragGame) {
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
    const source = collectionRef.current?.querySelector<HTMLElement>(fromDeck ? `[data-deck-game-id="${sourceId}"]` : `form[data-reorder-row-id="${sourceId}"]`);
    if (source) event.dataTransfer.setDragImage(source, 16, source.offsetHeight / 2);
    dragSourceRef.current = fromDeck ? null : sourceId;
    setDragSourceId(fromDeck ? null : sourceId);
  }

  function dropRowGame(event: DragEvent<HTMLFormElement>, targetId: number) {
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

  function renderTimelinePill(game: LibraryGame) {
    if (!inTimelineView) return null;
    const position = visibleTimelinePositions.get(game.id) ?? -1;
    const rank = optimisticTimeline.pending && optimisticTimeline.key === selectedSaga?.key
      ? (timelinePositions.get(game.id) ?? 0) + 1 : game.chronologicalOrder;
    return (
      <span className="saga-timeline-ordinal saga-timeline-control" data-assigned={rank != null}>
        <button type="button" className="timeline-swap-button" data-timeline-game-id={game.id} data-timeline-direction="-1" data-reorder-game-id={game.id} data-reorder-direction="-1" disabled={timelineBusy || position <= 0} aria-label={`Move ${game.title} up in saga timeline`} title="Move up in saga timeline" onClick={() => swapTimelineGame(game.id, -1)}>▲</button>
        <span title={rank != null ? "In-universe timeline rank" : "Timeline rank unassigned; using release order"}>{rank != null ? `TL #${String(rank).padStart(2, "0")}` : "TL —"}</span>
        <button type="button" className="timeline-swap-button" data-timeline-game-id={game.id} data-timeline-direction="1" data-reorder-game-id={game.id} data-reorder-direction="1" disabled={timelineBusy || position < 0 || position === visibleGames.length - 1} aria-label={`Move ${game.title} down in saga timeline`} title="Move down in saga timeline" onClick={() => swapTimelineGame(game.id, 1)}>▼</button>
      </span>
    );
  }

  function renderBacklogPriorityPill(game: LibraryGame) {
    if (!canReorderBacklog || game.pinnedOrder != null) return null;
    const position = visibleBacklogPositions.get(game.id) ?? -1;
    const rank = (backlogPositions.get(game.id) ?? 0) + 1;
    return (
      <span className="backlog-priority-control" role="group" aria-label={`Backlog priority ${rank} for ${game.title}`}>
        <button type="button" className="backlog-swap-button" data-reorder-game-id={game.id} data-reorder-direction="-1" disabled={rowReorderBusy || position <= 0} aria-label={`Move ${game.title} up in Backlog priority`} title="Move up in Backlog priority" onClick={() => swapBacklogGame(game.id, -1)}>▲</button>
        <span title="Custom Backlog priority">#{String(rank).padStart(2, "0")}</span>
        <button type="button" className="backlog-swap-button" data-reorder-game-id={game.id} data-reorder-direction="1" disabled={rowReorderBusy || position < 0 || position === visibleBacklogIds.length - 1} aria-label={`Move ${game.title} down in Backlog priority`} title="Move down in Backlog priority" onClick={() => swapBacklogGame(game.id, 1)}>▼</button>
      </span>
    );
  }

  function renderSagaBadge(game: LibraryGame, layout: "default" | "table" | "trophy" = "default") {
    const saga = byGameId.get(game.id);
    return saga ? <SagaBadge saga={saga} onSelect={selectSaga} layout={layout} /> : null;
  }

  function changeView(view: LibraryView) {
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

  function getAriaSort(column: SortColumn) {
    return sortBy === `${column}-asc` ? "ascending"
      : sortBy === `${column}-desc` ? "descending" : "none";
  }

  function getSortIcon(column: SortColumn) {
    const direction = getAriaSort(column);
    return direction === "ascending" ? "▲" : direction === "descending" ? "▼" : "↕";
  }

  function renderSortableHeader(column: SortColumn, label: string) {
    return (
      <span role="columnheader" aria-sort={getAriaSort(column)}>
        <button type="button" className="column-sort-btn" onClick={() => toggleColumnSort(column)}>
          {label} <span aria-hidden="true">{getSortIcon(column)}</span>
        </button>
      </span>
    );
  }

  function renderCardCover(game: LibraryGame, className: string) {
    return game.coverUrl ? (
      // Keep the same lazy thumbnail behavior in every library view.
      // eslint-disable-next-line @next/next/no-img-element
      <img className={className} src={game.coverUrl} alt={`${game.title} cover art`} width={640} height={360} loading="lazy" decoding="async" />
    ) : (
      <div className={`${className} library-card-no-cover`} role="img" aria-label={`${game.title} cover art unavailable`}>NO COVER</div>
    );
  }

  function renderMetadataFields(game: LibraryGame) {
    return (
      <div className="metadata-modal-fields">
        <label>
          Title
          <input name="title" defaultValue={game.title} maxLength={120} required aria-label={`Title for ${game.title}`} />
        </label>
        <label>
          Platform
          <input name="platform" defaultValue={game.platform} maxLength={80} aria-label={`Platform for ${game.title}`} />
        </label>
        <label>
          Genre
          <input name="genre" defaultValue={game.genre ?? ""} aria-label={`Genre for ${game.title}`} />
        </label>
        <label>
          Franchise / Saga Name
          <input name="franchise" defaultValue={game.franchise ?? ""} maxLength={120} placeholder="Auto-detect, or enter a custom saga name" aria-label={`Franchise / Saga Name for ${game.title}`} />
        </label>
        <label>
          Release year
          <input name="releaseYear" type="number" min="1800" max="2100" step="1" defaultValue={game.releaseYear ?? ""} aria-label={`Release year for ${game.title}`} />
        </label>
        <label>
          Timeline / Chronological Order
          <input name="chronologicalOrder" type="number" min="1" max="10000" step="1" defaultValue={game.chronologicalOrder ?? ""} placeholder="Optional · blank uses release order" aria-label={`Timeline / Chronological Order for ${game.title}`} />
        </label>
        <label>
          Cover image URL
          <input name="coverUrl" type="url" defaultValue={game.coverUrl ?? ""} placeholder="https://..." aria-label={`Cover URL for ${game.title}`} />
        </label>
      </div>
    );
  }

  function renderCardControls(game: LibraryGame) {
    return (
      <>
        <input name="id" type="hidden" value={game.id} />
        <div className="library-card-controls">
          <label>
            Status
            <select name="status" defaultValue={game.status} aria-label={`Status for ${game.title}`} required>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Est. Hours
            <input name="lengthHours" type="number" defaultValue={game.lengthHours} aria-label={`Hours for ${game.title}`} min="1" max="10000" step="1" required />
          </label>
          <label>
            Hours Played
            <input name="hoursPlayed" type="number" defaultValue={game.hoursPlayed} aria-label={`Hours played for ${game.title}`} min="0" max="10000" step="1" required />
          </label>
          <label>
            Difficulty
            <select name="difficulty" defaultValue={game.difficulty} aria-label={`Difficulty for ${game.title}`} required>
              {[1, 2, 3].map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty} · {difficultyLabels[difficulty]}</option>)}
            </select>
          </label>
          <div className="star-rating-field">
            <span>Rating</span>
            <StarRatingInput defaultValue={game.rating} label={`Rating for ${game.title}`} />
          </div>
        </div>
        <label className="field-log-label">
          NETRUNNER FIELD LOG
          <textarea className="field-log-textarea" name="notes" rows={3} maxLength={1000} defaultValue={game.notes ?? ""} placeholder="Log current checkpoint, build notes, or session thoughts..." />
        </label>
        <div className="library-card-actions">
          <button className="status-save" type="submit">Save</button>
          <SafeActionButton className="delete-button" formAction={deleteGame} formNoValidate type="submit">Delete</SafeActionButton>
          {game.status === "Playing" && (
            <SafeActionButton className="flatline-gig-button" formAction={flatlineGame} type="submit">💀 FLATLINE GIG</SafeActionButton>
          )}
          {game.status === "Flatlined" && (
            <SafeActionButton className="revive-gig-button" formAction={startGame} type="submit">▶ REVIVE GIG</SafeActionButton>
          )}
          {game.status === "Playing" && (
            <a className="trailer-link-button" href={buildTrailerUrl(game.title, game.releaseYear)} target="_blank" rel="noopener noreferrer">🎬 WATCH TRAILER ↗</a>
          )}
          <button type="button" className="edit-meta-btn" onClick={() => setEditingMetaGame(game)}>⚙ EDIT META</button>
        </div>
      </>
    );
  }

  return (
    <section className="collection" aria-labelledby="collection-title" ref={collectionRef}>
      <div className="collection-heading">
        <div>
          <p className="eyebrow">02 / YOUR LIBRARY</p>
          <h2 id="collection-title">System Playqueue</h2>
        </div>
        <div className="collection-heading-actions">
          <p className="game-count" role="status">
            <strong>{showFilteredCount ? `${visibleGames.length} / ${games.length}` : String(games.length).padStart(2, "0")}</strong>
            <span>{!showFilteredCount && visibleGames.length === 1 ? "game" : "games"}</span>
          </p>
          {children}
          <TacticalAdvisor games={games} />
          <LibraryDataVault games={games} />
        </div>
      </div>

      <LibraryTelemetry games={games} />
      <SagaChains chains={chains} selectedKey={selectedSaga?.key ?? ""} onSelect={selectSaga} {...sagaOrderControls} />

      <div className="library-tabs" role="group" aria-label="Library view">
        {views.map((view) => (
          <button
            key={view}
            type="button"
            data-view={view.toLowerCase()}
            aria-pressed={activeView === view}
            onClick={() => changeView(view)}
          >
            {view.toUpperCase()} <span>{viewCounts[view]}</span>
          </button>
        ))}
      </div>

      <div className="library-toolbar">
        <label className="library-search">
          <span>Search library</span>
          <input
            type="search"
            placeholder="Search title, genre, or platform..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Platform</span>
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
            <option value="">All platforms</option>
            {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
          </select>
        </label>
        <label>
          <span>Genre</span>
          <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)}>
            <option value="">All genres</option>
            {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select className="library-filter-select" aria-label="Sort games" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="default">Default order</option>
            {activeView === "Backlog" && !selectedSaga && <option value="custom-priority">Custom Priority</option>}
            {(selectedSaga || sortBy === "timeline-asc") && <option value="timeline-asc">Saga: timeline order</option>}
            {activeView !== "Backlog" && (
              <>
                <option value="rating-desc">Highest rated</option>
                <option value="rating-asc">Lowest rated</option>
              </>
            )}
            {(activeView === "All" || activeView === "Backlog") && <option value="pinned-first">Pinned first</option>}
            <option value="hours-asc">Hours: shortest first</option>
            <option value="hours-desc">Hours: longest first</option>
            <option value="xp-desc">XP: highest first</option>
            <option value="xp-asc">XP: lowest first</option>
            <option value="year-desc">Year: newest first</option>
            <option value="year-asc">Year: oldest first</option>
            <option value="title-asc">Title: A–Z</option>
            <option value="title-desc">Title: Z–A</option>
            <option value="platform-asc">Platform: A–Z</option>
            <option value="platform-desc">Platform: Z–A</option>
            <option value="genre-asc">Genre: A–Z</option>
            <option value="genre-desc">Genre: Z–A</option>
            <option value="status-asc">Status: Playing → Flatlined</option>
            <option value="status-desc">Status: Flatlined → Playing</option>
            <option value="difficulty-desc">Difficulty: hardest first</option>
            <option value="difficulty-asc">Difficulty: easiest first</option>
          </select>
        </label>
        {hasActiveFilters && (
          <button className="library-clear" type="button" onClick={clearFilters}>CLEAR FILTERS</button>
        )}
      </div>

      {inBacklogPriorityView && backlogNotice && <p className="backlog-order-notice" role="status" data-error={backlogNotice.error}>{backlogNotice.text}</p>}
      {deckReturnNotice && <p className="backlog-order-notice" role="status" data-deck-return-notice="true" data-error={deckReturnNotice.error}>{deckReturnNotice.text}</p>}

      {selectedSaga && (
        <section className="saga-timeline-panel" aria-label={`${selectedSaga.name} saga timeline`}>
          <div className="saga-timeline-heading">
            <div>
              <p className="saga-chain-count">⛓️ SAGA CHAIN // {selectedSaga.completed}/{selectedSaga.total} CLEARED</p>
              <h3>{selectedSaga.name}</h3>
            </div>
            <SagaOrderControls {...sagaOrderControls} />
          </div>
          <p className="saga-chains-hint">Unassigned games follow ranked games in release order. Use ▲ / ▼ to swap visible games, or drag table rows to reorder. Hidden saga games keep their relative positions.</p>
          {sagaNotice?.key === selectedSaga.key && <p className="saga-order-notice" role="status" data-error={sagaNotice.error}>{sagaNotice.text}</p>}
          <SagaChronologyDebugger key={selectedSaga.key} sagaKey={selectedSaga.key} scanDebug={sagaDebug?.key === selectedSaga.key ? sagaDebug.data : null} busy={timelineBusy} cooldownSeconds={sagaProviderCooldown.seconds} onForceRefresh={() => detectSagaOrder(true)} />
        </section>
      )}

      {(activeView === "All" || activeView === "Backlog") && <UpNextDeck startAction={startGameAndShowPlaying} games={games} draggedGame={deckDraggedGame} onDragGameChange={changeDeckDrag} onDragPointerDown={rememberDragOrigin} onGameDragStart={startLibraryDrag} disabled={rowReorderBusy} />}
      <div data-view={activeView.toLowerCase()} className={activeView === "Completed" ? "trophy-room" : undefined}>
        {activeView === "Completed" && (
          <>
            <div className="trophy-room-banner" aria-label="Completed games shown">
              <div>
                <p className="eyebrow">ARCHIVE // ACHIEVEMENTS UNLOCKED</p>
                <h3>Trophy Room</h3>
              </div>
              <dl>
                <div><dt>Gigs cleared</dt><dd>{visibleGames.length.toLocaleString()}</dd></div>
                <div><dt>Hours logged</dt><dd>{visibleGames.reduce((total, game) => total + game.lengthHours, 0).toLocaleString()}h</dd></div>
                <div><dt>XP earned</dt><dd>+{visibleGames.reduce((total, game) => total + game.earnedXp, 0).toLocaleString()} XP</dd></div>
              </dl>
            </div>
            <details className="trophy-milestones-drawer">
              <summary>Milestones · {achievements.filter((achievement) => achievement.unlocked).length} / {achievements.length} unlocked</summary>
              <p className="milestones-hint">Career milestones cover your entire library. Earned badges and their bonus XP are permanent.</p>
              <div className="trophy-milestones-grid">
                {achievements.map((achievement) => (
                  <article className="milestone-card" data-unlocked={achievement.unlocked} key={achievement.key}>
                    <span className="milestone-icon" aria-hidden="true">{achievement.icon}</span>
                    <h3>{achievement.title}</h3>
                    <p>{achievement.description}</p>
                    <p className="milestone-progress">{achievement.current} / {achievement.target} current progress</p>
                    <p className="milestone-bonus">+{achievement.unlocked ? achievement.xpAwarded : achievement.xpBonus} XP {achievement.unlocked ? "awarded" : "bonus"}</p>
                    {achievement.unlockedAt ? (
                      <p className="milestone-unlock-stamp">UNLOCKED <time dateTime={achievement.unlockedAt}>{achievement.unlockedAt.slice(0, 10)}</time></p>
                    ) : <p className="milestone-locked">LOCKED</p>}
                  </article>
                ))}
              </div>
            </details>
          </>
        )}
        {visibleGames.length === 0 ? (
          <div className="empty-state backlog-return-zone" data-deck-return-active={canReturnToBacklog || undefined} data-deck-return-hover={backlogReturnHover || undefined} onDragOver={dragOverBacklog} onDragLeave={leaveBacklog} onDrop={dropDeckIntoBacklog}>
            <span className="empty-mark" aria-hidden="true">+</span>
            <p>{games.length === 0 ? "Your list is clear. Add a game to get started." : "No games match. Try another view or clear your filters."}</p>
          </div>
        ) : activeView === "Playing" || activeView === "Flatlined" ? (
          <div className="playing-spotlight-grid">
            {visibleGames.map((game) => (
              <SafeForm
                action={updateGame}
                className="spotlight-card"
                data-game-id={game.id}
                data-status={game.status}
                key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}`}
              >
                {renderCardCover(game, "spotlight-cover")}
                <div className="spotlight-card-body">
                  <p className="spotlight-badge">{game.status === "Flatlined" ? "💀 FLATLINED // SHELVED" : "LIVE GIG // IN PROGRESS"}</p>
                  <h3>{game.title}{renderTimelinePill(game)}</h3>
                  <p className="library-card-metadata">
                    {game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}
                    {activeView === "Flatlined" && game.rating !== null && (
                      <> <span className="library-rating-badge" aria-label={`Rated ${game.rating} out of 5 stars`}>★ {game.rating}/5</span></>
                    )}
                    {renderSagaBadge(game)}
                  </p>
                  <div className="gig-progress-block">
                    <div className="gig-progress-header">
                      <span>{game.status === "Flatlined" ? "ARCHIVED GIG PROGRESS" : "ACTIVE GIG PROGRESS"}</span>
                      {game.status === "Playing" && (
                        <div className="gig-session-actions">
                          <button type="button" disabled={isLogging} onClick={() => logSession(game.id, 1)} aria-label={`Log one hour for ${game.title}`}>+1H</button>
                          <button type="button" disabled={isLogging} onClick={() => logSession(game.id, 2)} aria-label={`Log two hours for ${game.title}`}>+2H</button>
                        </div>
                      )}
                    </div>
                    <p>{game.hoursPlayed} / {game.lengthHours}h ({Math.min(100, Math.round((game.hoursPlayed / game.lengthHours) * 100))}%)</p>
                    <div className="gig-progress-track" role="progressbar" aria-label={`Progress for ${game.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((game.hoursPlayed / game.lengthHours) * 100))} aria-valuetext={`${game.hoursPlayed} of ${game.lengthHours} hours`}>
                      <span style={{ width: `${Math.min(100, Math.round((game.hoursPlayed / game.lengthHours) * 100))}%` }} />
                    </div>
                    {sessionError?.gameId === game.id && <p role="alert">{sessionError.message}</p>}
                  </div>
                  <div className="spotlight-bounty">
                    <span>{game.status === "Flatlined" ? "Shelved Gig // No Game XP" : "Potential XP Bounty"}</span>
                    <strong>{(game.status === "Flatlined" ? 0 : game.lengthHours * game.difficulty * 10).toLocaleString()} XP</strong>
                  </div>
                  {game.status === "Playing" && <AgentBriefing game={game} />}
                  {renderCardControls(game)}
                  {game.status === "Playing" && (
                    <SafeActionButton type="submit" formAction={completeGame} className="complete-gig-button">
                      🏆 COMPLETE GIG (+{Math.max(game.lengthHours, game.hoursPlayed) * game.difficulty * 10} XP)
                    </SafeActionButton>
                  )}
                </div>
              </SafeForm>
            ))}
          </div>
        ) : activeView === "Completed" ? (
          <div className="trophy-grid">
            {visibleGames.map((game) => (
              <article className="trophy-card" key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}`}>
                <div className="trophy-badge">
                  <span>🏆 GIG CLEARED</span>
                  {renderSagaBadge(game, "trophy")}
                </div>
                {renderCardCover(game, "trophy-cover")}
                <div className="trophy-card-body">
                  <h3>{game.title}{renderTimelinePill(game)}</h3>
                  {game.wasFlatlined && <p className="trophy-revived-badge">⚡ REVIVED FROM FLATLINE</p>}
                  <p className="library-card-metadata">{game.platform} · {game.genre?.trim() || "Unknown genre"} · {game.releaseYear ?? "Unknown year"}</p>
                  <p className="trophy-record">{game.hoursPlayed}h played · {game.lengthHours}h length · Tier {game.difficulty} / {difficultyLabels[game.difficulty]}</p>
                  {game.notes?.trim() && (
                    <div className="trophy-field-log">
                      <span>NETRUNNER FIELD LOG</span>
                      <p>{game.notes}</p>
                    </div>
                  )}
                  <p className="trophy-reward">+{game.earnedXp.toLocaleString()} XP</p>
                  <TrophyRatingEditor game={game} />
                  <details className="trophy-edit-drawer">
                    <summary>Manage Record</summary>
                    <SafeForm action={updateGame} key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}`}>
                      {renderCardControls(game)}
                    </SafeForm>
                  </details>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="game-table backlog-return-zone" role="table" aria-label="Saved games" data-deck-return-active={canReturnToBacklog || undefined} data-deck-return-hover={backlogReturnHover || undefined} aria-busy={isReturningDeck} onDragOver={dragOverBacklog} onDragLeave={leaveBacklog} onDrop={dropDeckIntoBacklog}>
            <div className="game-row game-row-head" role="row">
              {renderSortableHeader("title", "Game")}
              {renderSortableHeader("platform", "Platform")}
              {renderSortableHeader("genre", "Genre")}
              {renderSortableHeader("year", "Year")}
              {renderSortableHeader("status", "Status")}
              {renderSortableHeader("hours", "Hours")}
              {renderSortableHeader("difficulty", "Difficulty")}
              {renderSortableHeader("xp", "Earned XP")}
              <span role="columnheader">Actions</span>
            </div>
            {visibleGames.map((game) => (
              <SafeForm
                action={updateGame}
                className="game-row"
                data-status={game.status}
                draggable={(isReorderableRow(game.id) || canDragToDeck(game)) && !rowReorderBusy}
                data-timeline-draggable={inTimelineView || undefined}
                data-timeline-row-id={game.id}
                data-reorder-row-id={game.id}
                data-backlog-draggable={(canReorderBacklog && game.pinnedOrder == null) || undefined}
                data-backlog-priority={inBacklogPriorityView || undefined}
                data-deck-draggable={canDragToDeck(game) || undefined}
                data-backlog-return-target={backlogReturnTarget === game.id || undefined}
                data-timeline-dragging={dragSourceId === game.id || undefined}
                data-timeline-drop-target={dropTargetId === game.id || undefined}
                onPointerDownCapture={(event) => {
                  rememberDragOrigin({ gameId: game.id, source: "table" }, event.target instanceof Element && Boolean(event.target.closest("button, input, select, textarea, a, summary, [contenteditable='true']")));
                }}
                onDragStart={(event) => startLibraryDrag(event, { gameId: game.id, source: "table" })}
                onDragEnd={endRowDrag}
                onDragOver={(event) => {
                  if (!isReorderableRow(game.id) || rowReorderBusy || dragSourceRef.current === null || !isReorderableRow(dragSourceRef.current) || dragSourceRef.current === game.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetId(game.id);
                }}
                onDragLeave={(event) => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTargetId((current) => current === game.id ? null : current);
                }}
                onDrop={(event) => dropRowGame(event, game.id)}
                key={`${game.id}-${game.status}-${game.lengthHours}-${game.difficulty}-${game.title}-${game.platform}-${game.genre ?? ""}-${game.releaseYear ?? ""}-${game.coverUrl ?? ""}-${game.hoursPlayed}-${game.notes ?? ""}-${game.rating ?? ""}-${game.franchise ?? ""}-${game.chronologicalOrder ?? ""}`}
                role="row"
              >
                <input name="id" type="hidden" value={game.id} />
                <span className="game-name" role="cell">
                  {(isReorderableRow(game.id) || canDragToDeck(game)) && <span className="saga-row-drag-grip" draggable={!rowReorderBusy} aria-hidden="true" title={inTimelineView ? "Drag to reorder this saga or stage a released Backlog gig on deck" : canReorderBacklog ? "Drag to change Backlog priority or stage a released gig on deck" : "Drag to an On Deck slot"}>⋮⋮</span>}
                  <span className="mobile-label">Game</span>
                  <span className="game-identity">
                    <span className="game-cover-wrap">
                      {game.coverUrl ? (
                        <img
                          alt={`${game.title} cover art`}
                          className="game-cover"
                          decoding="async"
                          loading="lazy"
                          draggable={false}
                          src={game.coverUrl}
                        />
                      ) : (
                        <div
                          aria-label={`${game.title} cover art unavailable`}
                          className="game-cover game-cover-placeholder"
                          role="img"
                        >
                          <span>NO<br />COVER</span>
                        </div>
                      )}
                      {game.status === "Backlog" && (
                        <DeckPinButton gameId={game.id} pinnedOrder={game.pinnedOrder} pinnedCount={pinnedCount} releaseYear={game.releaseYear} iconOnly />
                      )}
                    </span>
                    <span className="game-title-stack">
                      <span className="game-title-heading"><strong title={game.title}>{game.title}</strong>{renderTimelinePill(game)}</span>
                      <span className="game-title-actions">
                        {(game.status === "Backlog" || game.status === "Flatlined") && (
                          <SafeActionButton className="start-gig-badge" formAction={startGameAndShowPlaying} type="submit">{game.status === "Flatlined" ? "▶ REVIVE GIG" : "▶ START GIG"}</SafeActionButton>
                        )}
                        <button type="button" className="edit-meta-btn" onClick={() => setEditingMetaGame(game)}>⚙ EDIT META</button>
                        {renderBacklogPriorityPill(game)}
                        {renderSagaBadge(game, "table")}
                      </span>
                    </span>
                  </span>
                </span>
                <span role="cell">
                  <span className="mobile-label">Platform</span>
                  {game.platform}
                </span>
                <span className="genre-cell" role="cell">
                  <span className="mobile-label">Genre</span>
                  <span className="row-game-metadata">
                    <span>{game.genre?.trim() || "—"}</span>
                    {activeView === "All" && game.rating !== null && (
                      <span className="library-rating-badge" aria-label={`Rated ${game.rating} out of 5 stars`}>★ {game.rating}/5</span>
                    )}
                    {game.status === "Backlog" && !isReleasedYear(game.releaseYear, currentYear) && (
                      <span className="unreleased-badge" title="Excluded from Cortex and Roulette until a release year of this year or earlier is saved.">⏳ UNRELEASED</span>
                    )}
                  </span>
                </span>
                <span role="cell">
                  <span className="mobile-label">Year</span>
                  {game.releaseYear ?? "—"}
                </span>
                <label className="row-edit-field" role="cell">
                  <span className="mobile-label">Status</span>
                  <select
                    aria-label={`Status for ${game.title}`}
                    className="status-select"
                    defaultValue={game.status}
                    name="status"
                    required
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="row-edit-field" role="cell">
                  <span className="mobile-label">Hours</span>
                  <input
                    aria-label={`Hours for ${game.title}`}
                    className="row-hours-input"
                    defaultValue={game.lengthHours}
                    max="10000"
                    min="1"
                    name="lengthHours"
                    required
                    step="1"
                    type="number"
                  />
                </label>
                <label className="row-edit-field" role="cell">
                  <span className="mobile-label">Difficulty</span>
                  <select
                    aria-label={`Difficulty for ${game.title}`}
                    className="difficulty-select"
                    defaultValue={game.difficulty}
                    name="difficulty"
                    required
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
                <span className="xp-value" role="cell">
                  <span className="mobile-label">Earned XP</span>
                  {game.earnedXp.toLocaleString()} XP
                </span>
                <span className="row-actions" role="cell">
                  <button className="status-save" type="submit">Save</button>
                  <SafeActionButton
                    className="delete-button"
                    formAction={deleteGame}
                    formNoValidate
                    type="submit"
                  >
                    Delete
                  </SafeActionButton>
                </span>
              </SafeForm>
            ))}
          </div>
        )}
      </div>
      {activeView === "Playing" && <UpNextDeck startAction={startGameAndShowPlaying} games={games} draggedGame={deckDraggedGame} onDragGameChange={changeDeckDrag} onDragPointerDown={rememberDragOrigin} onGameDragStart={startLibraryDrag} disabled={rowReorderBusy} />}
      {editingMetaGame && (
        <div className="metadata-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) setEditingMetaGame(null);
        }}>
          <SafeForm
            className="metadata-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="metadata-modal-title"
            ref={metadataModalRef}
            action={updateGame}
            onSuccess={() => setEditingMetaGame(null)}
            key={`${editingMetaGame.id}-${editingMetaGame.status}-${editingMetaGame.lengthHours}-${editingMetaGame.difficulty}-${editingMetaGame.title}-${editingMetaGame.platform}-${editingMetaGame.genre ?? ""}-${editingMetaGame.releaseYear ?? ""}-${editingMetaGame.coverUrl ?? ""}-${editingMetaGame.hoursPlayed}-${editingMetaGame.notes ?? ""}-${editingMetaGame.rating ?? ""}-${editingMetaGame.franchise ?? ""}-${editingMetaGame.chronologicalOrder ?? ""}`}
          >
            <p className="eyebrow">RECORD // METADATA EDITOR</p>
            <h2 id="metadata-modal-title">Edit Game Metadata</h2>
            <input type="hidden" name="id" value={editingMetaGame.id} />
            <input type="hidden" name="status" value={editingMetaGame.status} />
            <input type="hidden" name="lengthHours" value={editingMetaGame.lengthHours} />
            <input type="hidden" name="difficulty" value={editingMetaGame.difficulty} />
            {renderMetadataFields(editingMetaGame)}
            <div className="metadata-modal-actions">
              <button className="metadata-save-btn" type="submit">SAVE METADATA</button>
              <button className="metadata-cancel-btn" type="button" onClick={() => setEditingMetaGame(null)}>CANCEL</button>
            </div>
          </SafeForm>
        </div>
      )}
    </section>
  );
}
