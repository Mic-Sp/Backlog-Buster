"use client";

import { MicroReview } from "@/components/MicroReview";

import "./SocialHub.css";
import { useCallback, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fetchSocialOverview, fetchCoopMatches } from "@/app/social-actions";
import { searchPlayers } from "@/app/friendship-actions";
import { fetchFriendActivity } from "@/app/activity-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { useLayoutCopy } from "@/components/LayoutText";
import { useUIEffects } from "@/components/ThemeProvider";
import { ProfileVisibilityControl, RelationshipControls } from "@/components/SocialControls";
import OperatorAvatar from "@/components/OperatorAvatar";
import { useFriendRequestNotifications } from "@/components/useFriendRequestNotifications";
import type { SocialConnection, SocialOverview, CoopMatches } from "@/lib/social-types";
import type { DiscoveredPlayer } from "@/lib/friendship-types";
import type { ActivityFeedPage, FriendActivity } from "@/lib/activity-types";

const tabs = [{ key: "friends", label: "Friends & discovery" }, { key: "activity", label: "Activity feed" }, { key: "coop", label: "Co-op backlog" }] as const;
type Tab = typeof tabs[number]["key"];
export function useSocialHubController(enabled = true) {
  const [isOpen, setIsOpen] = useState(false);
  const [requestsView, setRequestsView] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requests = useFriendRequestNotifications(enabled);
  const { dismiss } = requests;
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => { setRequestsView(false); setIsOpen(true); }, []);
  const openRequests = useCallback(() => { dismiss(); setRequestsView(true); setIsOpen(true); }, [dismiss]);
  return { enabled, isOpen, open, close, openRequests, requestsView, requests, triggerRef };
}
type Controller = ReturnType<typeof useSocialHubController>;
export function SocialHubTrigger({ controller }: { controller: Controller }) {
  const copy = useLayoutCopy();
  const { layoutMode } = useUIEffects();
  const { triggerRef, isOpen, openRequests, open, requests } = controller;
  return <button ref={triggerRef} className="social-trigger" data-social-theme={layoutMode} type="button" aria-haspopup="dialog" aria-expanded={isOpen} onClick={requests.count ? openRequests : open}>
    <span aria-hidden="true">♧</span> {copy("SOCIAL HUB", "FELLOWSHIP // SOCIAL HUB")}
    {requests.count > 0 && <span className="social-request-count" aria-label={`${requests.count} incoming friend request${requests.count === 1 ? "" : "s"}`}>{requests.count}</span>}
  </button>;
}
export function SocialHubOverlay({ controller }: { controller: Controller }) {
  const { layoutMode } = useUIEffects();
  if (typeof document === "undefined") return null;
  return createPortal(<>
    {controller.isOpen && <SocialHubDialog enabled={controller.enabled} initialRequests={controller.requestsView} returnFocus={controller.triggerRef} onClose={controller.close} />}
    {!controller.isOpen && controller.requests.notification.length > 0 && <aside className="social-request-toast" data-social-theme={layoutMode} role="status" aria-live="polite" aria-label="New friend requests">
      <button type="button" className="social-request-toast-open" aria-haspopup="dialog" onClick={controller.openRequests}>
        <span className="social-request-toast-icon" aria-hidden="true">♧</span>
        <span><strong>{controller.requests.notification.length === 1 ? "New friend request" : `${controller.requests.notification.length} new friend requests`}</strong>
          <span className="social-request-sender">{controller.requests.notification[0].requester.operatorName}{controller.requests.notification[0].requester.handle && <small> @{controller.requests.notification[0].requester.handle}</small>}</span>
          {controller.requests.notification.length > 1 && <small>and {controller.requests.notification.length - 1} more</small>}
          <span className="social-request-review">Review incoming requests →</span>
        </span>
      </button>
      <button type="button" className="social-request-toast-dismiss" aria-label="Dismiss friend request notification" onClick={controller.requests.dismiss}>✕</button>
    </aside>}
  </>, document.body);
}

function SocialHubDialog({ enabled, initialRequests, returnFocus, onClose }: { enabled: boolean; initialRequests: boolean; returnFocus: { current: HTMLButtonElement | null }; onClose: () => void }) {
  const copy = useLayoutCopy(), id = useId(), dialog = useRef<HTMLDialogElement>(null);
  const { layoutMode } = useUIEffects();
  const [tab, setTab] = useState<Tab>("friends"), [overview, setOverview] = useState<SocialOverview | null>(null);
  const [error, setError] = useState(""), [revision, setRevision] = useState(0), [loading, startTransition] = useTransition();
  const request = useRef(0);
  const reload = useCallback(() => {
    const ticket = ++request.current;
    startTransition(async () => {
      try { const data = unwrapActionResult(await fetchSocialOverview()); if (ticket === request.current) { setError(""); setOverview(data); setRevision(value => value + 1); } }
      catch (error) { if (ticket === request.current) { setOverview(null); setError(actionErrorMessage(error, "Your social hub is unavailable. Please retry.")); } }
    });
  }, []);
  useEffect(() => {
    const modal = dialog.current, previous = document.activeElement as HTMLElement | null;
    const fallbackFocus = returnFocus.current;
    const overflow = document.body.style.overflow;
    modal?.showModal(); document.body.style.overflow = "hidden";
    return () => { modal?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); else if (fallbackFocus?.isConnected) fallbackFocus.focus(); };
  }, [returnFocus]);
  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);
  function tabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (tabs.findIndex(item => item.key === tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
    setTab(tabs[index].key); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }
  return <dialog ref={dialog} className="social-dialog" data-social-theme={layoutMode} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')]
      .filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0 && (!control.closest("details:not([open])") || control.tagName === "SUMMARY"));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="social-dialog-inner">
      <header className="social-heading"><div><p className="social-eyebrow">{copy("YOUR CREW // YOUR NEXT SESSION", "THE TAVERN · YOUR NEXT ADVENTURE")}</p><h2 id={`${id}-title`}>{copy("Social Hub", "The Fellowship")}</h2><p>Good games. Better company.</p></div><button type="button" className="social-close" aria-label="Close social hub" onClick={onClose}>✕</button></header>
      {!enabled ? <div className="social-empty"><span aria-hidden="true">♧</span><h3>Build your fellowship</h3><p>Register or sign in to add friends, follow their adventures and find your next shared game.</p><a href="/access">Sign in or register →</a></div> : <>
        <div className="social-tabs" role="tablist" aria-label="Social hub views" onKeyDown={tabKey}>{tabs.map(item => <button type="button" role="tab" id={`${id}-${item.key}-tab`} aria-controls={`${id}-panel`} aria-selected={tab === item.key} tabIndex={tab === item.key ? 0 : -1} key={item.key} onClick={() => setTab(item.key)}>{item.label}{item.key === "friends" && Boolean(overview?.connections.some(peer => peer.relationship === "incoming")) && <span className="social-count">{overview!.connections.filter(peer => peer.relationship === "incoming").length}</span>}</button>)}</div>
        <div className="social-content" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}-tab`} aria-busy={loading}>
          {error && <div className="social-error" role="alert"><p>{error}</p><button type="button" onClick={reload}>Retry</button></div>}
          {!overview && !error && <p className="social-loading" role="status">Finding your people…</p>}
          {overview && <>
            {tab === "friends" && <FriendsView overview={overview} initialRequests={initialRequests} onChanged={reload} />}
            {tab === "activity" && <ActivityView key={`activity:${revision}`} />}
            {tab === "coop" && <CoopView key={`coop:${revision}`} overview={overview} />}
          </>}
        </div>
      </>}
      <footer className="social-footer"><span>{copy("CONNECTED BY PLAY", "STRONGER TOGETHER")}</span><span>Privacy is always in your hands.</span></footer>
    </div>
  </dialog>;
}

function PlayerRow({ player, onChanged }: { player: SocialConnection; onChanged: () => void }) {
  return <li className="social-player-row"><OperatorAvatar avatarUrl={player.avatarUrl} className="social-avatar" alt="" />
    <div className="social-player-identity"><strong>{player.operatorName}</strong><span>{player.handle ? `@${player.handle}` : "No handle yet"}</span>
      {player.handle && player.canViewProfile && <a href={`/dossier/${encodeURIComponent(player.handle)}`} target="_blank" rel="noreferrer">Open dossier ↗</a>}
      {!player.canViewProfile && player.relationship === "friends" && <small>Private profile · sharing paused</small>}
    </div>
    <RelationshipControls key={`${player.id}:${player.relationship}`} playerId={player.id} initialState={player.relationship} onChanged={onChanged} />
  </li>;
}

function FriendsView({ overview, initialRequests, onChanged }: { overview: SocialOverview; initialRequests: boolean; onChanged: () => void }) {
  const [query, setQuery] = useState(""), [results, setResults] = useState<DiscoveredPlayer[] | null>(null), [error, setError] = useState("");
  const [searching, startTransition] = useTransition(), request = useRef(0);
  const [group, setGroup] = useState<"friends" | "requests" | "blocked">(initialRequests ? "requests" : "friends");
  const [incomingOnly, setIncomingOnly] = useState(initialRequests);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const ticket = request.current;
    const timer = setTimeout(() => startTransition(async () => {
      try { const data = unwrapActionResult(await searchPlayers(query)); if (ticket === request.current) setResults(data.players); }
      catch (error) { if (ticket === request.current) { setResults([]); setError(actionErrorMessage(error)); } }
    }), 300);
    return () => { clearTimeout(timer); };
  }, [query]);
  const connections = overview.connections.filter(peer => group === "requests" ? peer.relationship === "incoming" || (!incomingOnly && peer.relationship === "outgoing") : peer.relationship === group);
  const count = (key: typeof group) => overview.connections.filter(peer => key === "requests" ? peer.relationship === "incoming" || peer.relationship === "outgoing" : peer.relationship === key).length;
  return <>
    <div className="social-section-heading"><div><p className="social-eyebrow">FRIENDS & DISCOVERY</p><h3>Find your next party.</h3><p>Connect by handle or callsign.</p></div><ProfileVisibilityControl key={overview.profileVisibility} initialValue={overview.profileVisibility} onChanged={onChanged} /></div>
    <label className="social-search"><span>Search players</span><input type="search" maxLength={64} placeholder="Try @night_runner or a callsign…" value={query} onChange={event => { request.current++; setQuery(event.target.value); setResults(null); setError(""); }} /></label>
    {error && <p className="social-error" role="alert">{error}</p>}
    {query.trim().length >= 2 && <section aria-label="Player search results" className="social-discovery"><h4>Discovery</h4>{searching || results === null ? <p role="status">Searching players…</p> : !results.length ? <p className="social-hint">No visible players found. Try another handle or callsign.</p> : <ul className="social-player-list">{results.map(player => <PlayerRow key={player.id} player={overview.connections.find(peer => peer.id === player.id) ?? { ...player, relationship: "none", canViewProfile: true }} onChanged={onChanged} />)}</ul>}</section>}
    <div className="social-list-filters" role="group" aria-label="Relationship lists">{(["friends", "requests", "blocked"] as const).map(key => <button type="button" key={key} aria-pressed={group === key} onClick={() => setGroup(key)}>{key === "friends" ? "Friends" : key === "requests" ? "Requests" : "Blocked"}<span>{count(key)}</span></button>)}</div>
    {group === "requests" && incomingOnly && <div className="social-request-direction"><h4>Incoming requests</h4><button type="button" onClick={() => setIncomingOnly(false)}>Show all requests</button></div>}
    <ul className="social-player-list" aria-label={group === "friends" ? "Your friends" : group === "requests" ? incomingOnly ? "Incoming friend requests" : "Friend requests" : "Blocked players"}>{connections.map(peer => <PlayerRow key={`${peer.id}:${peer.relationship}`} player={peer} onChanged={onChanged} />)}</ul>
    {!connections.length && <div className="social-empty"><span aria-hidden="true">{group === "friends" ? "♧" : "◇"}</span><h4>{group === "friends" ? "Your party starts here." : group === "requests" ? "All caught up." : "No blocked players."}</h4><p>{group === "friends" ? "Search for someone above and send your first friend request." : group === "requests" ? "Incoming and outgoing requests will appear here." : "Players you block will appear here so you can manage them."}</p></div>}
    {overview.truncated && <p className="social-hint">Showing your 500 most recently updated relationships. Use discovery to find another player.</p>}
  </>;
}

function ActivityEntry({ item }: { item: FriendActivity }) {
  const copy = useLayoutCopy();
  let description: string;
  switch (item.type) {
    case "game_started": description = `started ${item.metadata.title}`; break;
    case "game_completed": description = `completed ${item.metadata.title}`; break;
    case "game_flatlined": description = `${copy("shelved", "set aside")} ${item.metadata.title}`; break;
    case "rating_logged": description = `rated ${item.metadata.title} ${item.metadata.rating}/5`; break;
    case "achievement_unlocked": description = `unlocked ${item.metadata.title}`; break;
    case "library_imported": description = `added ${item.metadata.importedCount} games to their library`; break;
  }
  const date = new Date(item.createdAt);
  return <li className="social-activity-row"><OperatorAvatar avatarUrl={item.actor.avatarUrl} className="social-avatar" alt="" /><div>
    <p>{item.actor.handle ? <a href={`/dossier/${encodeURIComponent(item.actor.handle)}`} target="_blank" rel="noreferrer">{item.actor.operatorName}</a> : <strong>{item.actor.operatorName}</strong>} {description}.</p>
    {"review" in item.metadata && <MicroReview review={item.metadata.review} reviewSpoiler={item.metadata.reviewSpoiler} />}
    <time dateTime={item.createdAt}>{date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
  </div><span className="social-activity-icon" aria-hidden="true">{item.type === "achievement_unlocked" ? "✧" : item.type === "game_completed" ? "✓" : item.type === "rating_logged" ? "★" : "◇"}</span></li>;
}
function ActivityView() {
  const [page, setPage] = useState<ActivityFeedPage | null>(null), [error, setError] = useState("");
  const [pending, startTransition] = useTransition(), busy = useRef(false), alive = useRef(true);
  const load = useCallback((cursor?: ActivityFeedPage["nextCursor"]) => {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = unwrapActionResult(await fetchFriendActivity({ limit: 20, cursor }));
        if (alive.current) { setError(""); setPage(previous => ({ ...result, items: cursor && previous ? [...new Map([...previous.items, ...result.items].map(item => [item.id, item])).values()] : result.items })); }
      } catch (error) { if (alive.current) setError(actionErrorMessage(error, "Activity could not be loaded. Please retry.")); }
      finally { busy.current = false; }
    });
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  return <>
    <div className="social-section-heading"><div><p className="social-eyebrow">ACTIVITY FEED</p><h3>A little shared progress.</h3><p>Your friends’ adventures from the last 30 days.</p></div><button type="button" disabled={pending} onClick={() => load()}>Refresh feed</button></div>
    {error && <div role="alert" className="social-error">{error} <button type="button" disabled={pending} onClick={() => load(page?.nextCursor)}>Retry</button></div>}
    {!page && pending && <p className="social-loading" role="status">Loading friend activity…</p>}
    {page && <><ol className="social-activity-list" aria-label="Friend activity">{page.items.map(item => <ActivityEntry item={item} key={item.id} />)}</ol>
      {!page.items.length && <div className="social-empty"><span aria-hidden="true">✧</span><h4>A quiet moment between adventures.</h4><p>When friends start games, finish quests or unlock achievements, you’ll find their progress here.</p></div>}
      {page.nextCursor && <button className="social-load-more" type="button" disabled={pending} onClick={() => load(page.nextCursor)}>{pending ? "Loading…" : "Load more activity"}</button>}
    </>}
  </>;
}

function CoopView({ overview }: { overview: SocialOverview }) {
  const friends = overview.connections.filter(peer => peer.relationship === "friends" && peer.canViewProfile);
  const [selected, setSelected] = useState<string[]>([]), [unknown, setUnknown] = useState(false), [finished, setFinished] = useState(false);
  const [matches, setMatches] = useState<CoopMatches | null>(null), [error, setError] = useState("");
  const [pending, startTransition] = useTransition(), request = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function clear() { request.current++; setMatches(null); setError(""); }
  function compare() {
    const ticket = ++request.current; setError(""); setMatches(null);
    startTransition(async () => {
      try { const result = unwrapActionResult(await fetchCoopMatches({ friendIds: selected, includeUnknown: unknown, includeFinished: finished })); if (alive.current && ticket === request.current) setMatches(result); }
      catch (error) { if (alive.current && ticket === request.current) setError(actionErrorMessage(error)); }
    });
  }
  return <>
    <div className="social-section-heading"><div><p className="social-eyebrow">CO-OP BACKLOG MATCHER</p><h3>What should we play tonight?</h3><p>Shared games. Everyone’s progress. One easier decision.</p></div></div>
    {!friends.length ? <div className="social-empty"><span aria-hidden="true">♧</span><h4>First, gather your party.</h4><p>Add a friend who shares their profile to compare your libraries.</p></div> : <>
      <fieldset className="social-friend-picker" disabled={pending}><legend>Choose up to 4 friends · games must be shared by everyone</legend>{friends.map(friend => <label key={friend.id} data-selected={selected.includes(friend.id)}><input type="checkbox" checked={selected.includes(friend.id)} disabled={!selected.includes(friend.id) && selected.length >= 4} onChange={event => { clear(); setSelected(ids => event.target.checked ? [...ids, friend.id] : ids.filter(id => id !== friend.id)); }} />{friend.operatorName}</label>)}</fieldset>
      <div className="social-match-options"><label><input type="checkbox" checked={unknown} disabled={pending} onChange={event => { clear(); setUnknown(event.target.checked); }} /> Include shared games with unknown co-op info</label><label><input type="checkbox" checked={finished} disabled={pending} onChange={event => { clear(); setFinished(event.target.checked); }} /> Include completed games for a replay</label></div>
      <button className="social-primary social-compare" type="button" disabled={!selected.length || pending} onClick={compare}>{pending ? "Comparing libraries…" : "Find shared games"}</button>
      {error && <p className="social-error" role="alert">{error}</p>}
      {matches && <section className="social-matches" aria-label="Shared game matches"><p className="social-match-count" role="status">{matches.total} shared {matches.total === 1 ? "game" : "games"}{matches.total > matches.games.length ? ` · showing the first ${matches.games.length}` : ""}</p>
        <ul>{matches.games.map(game => <li className="social-match-card" key={game.key}><div className="social-match-title">
          {game.coverUrl && <img src={game.coverUrl} alt="" width={60} height={80} loading="lazy" referrerPolicy="no-referrer" /> /* eslint-disable-line @next/next/no-img-element */}
          <div><h4>{game.title}</h4><span>{game.releaseYear ?? "Release year unknown"}</span><div className="social-capabilities">{game.capabilities.length ? game.capabilities.map(label => <span key={label}>{label}</span>) : <span data-unknown>Co-op unverified</span>}</div></div>
        </div><ul className="social-participants">{game.participants.map(member => <li key={member.playerId}><strong>{member.playerId === overview.viewerId ? "You" : member.operatorName}</strong><span>{member.platform}</span><span>{member.status}</span><span>{member.hoursPlayed}h played</span></li>)}</ul>
          <p className="social-match-note">{!game.samePlatform ? "Different platforms · check cross-play support before starting." : game.capabilities.includes("Local co-op") && !game.capabilities.includes("Online co-op") ? "Local co-op may require playing together on the same device." : "Check player limits, editions and platform compatibility before starting."}</p>
        </li>)}</ul>
        {!matches.games.length && <div className="social-empty"><span aria-hidden="true">◇</span><h4>No shared playable games found.</h4><p>Try including completed games or shared titles with unknown co-op info. Single-player-only and shelved games are excluded.</p></div>}
      </section>}
    </>}
  </>;
}
