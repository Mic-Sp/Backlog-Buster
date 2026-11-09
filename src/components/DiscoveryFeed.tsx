"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { actOnDiscoveryCard, fetchDiscoveryFeed, markRadarViewed } from "@/app/discovery-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { inReleaseWindow, type DiscoveryCard, type DiscoveryKind } from "@/lib/discovery-feed-types";
import { isInterestMatch, sortDiscoveryCards, type DiscoverySort, type PersonalizedDiscoveryFeed } from "@/lib/discovery-personalization-types";
import { announceDiscoveryChange } from "@/lib/discovery-events";
import { normalizeGameTitle } from "@/lib/game-title";
import { useLayoutCopy } from "@/components/LayoutText";
import { buildTrailerUrl } from "@/lib/trailers";

export default function DiscoveryFeed({ kind, hiddenTitles, onAdded, onDismissed, onUnseenChange, revision = 0 }: {
  kind: DiscoveryKind; hiddenTitles: Set<string>;
  onAdded: (title: string) => void; onDismissed: (title: string) => void;
  onUnseenChange: (count: number) => void; revision?: number;
}) {
  const copy = useLayoutCopy();
  const [feed, setFeed] = useState<PersonalizedDiscoveryFeed | null>(null);
  const [sort, setSort] = useState<DiscoverySort>("default");
  const [interestsOnly, setInterestsOnly] = useState(false);
  const sortId = useId();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState(new Set<string>());
  const [pending, setPending] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [, startAction] = useTransition();
  const [, startAcknowledging] = useTransition();
  const actionFlight = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const unseenCallback = useRef(onUnseenChange);
  useEffect(() => { unseenCallback.current = onUnseenChange; }, [onUnseenChange]);
  useEffect(() => {
    let active = true;
    startLoading(async () => {
      try {
        const result = unwrapActionResult(await fetchDiscoveryFeed(kind));
        if (active) { setFeed(result); unseenCallback.current(result.unseenCount); }
      } catch (error) {
        if (active) setError(actionErrorMessage(error, "Could not load discovery. Reopen this tab to try again."));
      }
    });
    return () => { active = false; };
  }, [kind, revision]);

  function act(game: DiscoveryCard, choice: "add" | "dismiss") {
    if (actionFlight.current) return;
    actionFlight.current = true;
    setPending(game.key);
    setError("");
    // Both actions remove the card immediately. Failed writes restore it for retry.
    setRemoved(current => new Set([...current, game.key]));
    setNotice(choice === "add" ? `Adding ${game.title} to your backlog…` : `Saving your preference for ${game.title}…`);
    startAction(async () => {
      try {
        const result = unwrapActionResult(await actOnDiscoveryCard(kind, game.key, choice));
        if (result.personalized) {
          setFeed(result.personalized);
          unseenCallback.current(result.personalized.unseenCount);
        } else setError("Saved your action. Reopen this tab to refresh your taste matches.");
        if (choice === "add") onAdded(game.title); else onDismissed(game.title);
        announceDiscoveryChange(false);
        setNotice(choice === "add" ? `${game.title} added to your backlog / wishlist.` : `${game.title} won’t appear in Scout or discovery feeds.`);
      } catch (error) {
        setRemoved(current => new Set([...current].filter(key => key !== game.key)));
        setNotice("");
        setError(actionErrorMessage(error, "Could not save this action. Please try again."));
      } finally {
        actionFlight.current = false; setPending(null);
        requestAnimationFrame(() => {
          if (document.activeElement === document.body && feedRef.current?.isConnected) {
            const next = feedRef.current.querySelector<HTMLButtonElement>(".advisor-acquire-button:not(:disabled)")
              ?? document.getElementById(`scout-tab-${kind}`);
            next?.focus();
          }
        });
      }
    });
  }
  const cards = sortDiscoveryCards(feed?.items.filter(game => !hiddenTitles.has(normalizeGameTitle(game.title)) && !removed.has(game.key) &&
    (kind !== "radar" || inReleaseWindow(game.releaseDate)) && (!interestsOnly || isInterestMatch(game))) ?? [], sort, kind === "radar");
  // Acknowledgement runs after the cards render, and only sends displayed highlight
  // references. A newer server snapshot can never be acknowledged wholesale.
  const viewedKeys = loading ? "" : JSON.stringify(cards.filter(isInterestMatch).map(game => game.key).sort());
  useEffect(() => {
    if (!viewedKeys || viewedKeys === "[]") return;
    let active = true;
    startAcknowledging(async () => {
      try {
        const result = unwrapActionResult(await markRadarViewed(JSON.parse(viewedKeys) as string[]));
        if (active) { unseenCallback.current(result.unseenCount); announceDiscoveryChange(false); }
      } catch { if (active) setError("Could not mark these releases as viewed. Reopen this tab to retry."); }
    });
    return () => { active = false; };
  }, [viewedKeys]);
  return <div className="discovery-feed" aria-busy={loading} ref={feedRef}>
    <header className="discovery-feed-header">
      <p className="eyebrow">{kind === "radar" ? copy("RELEASE RADAR // MARKET TELEMETRY", "Town Crier’s Board // New Chronicles")
        : copy("POPULAR / TRENDING // MARKET TELEMETRY", "Tales of Renown // Around the Realm")}</p>
      <p className="advisor-intro">{kind === "radar" ? "Notable releases from the last 60 days and adventures arriving in the next 90 days."
        : "Recent releases with strong provider interest, alongside the most logged and active games across Backlog Buster."}</p>
      {feed && <p className="discovery-freshness">{feed.source === "local" ? "Saved catalog · Live release data unavailable" : `${feed.source.toUpperCase()} release interest${kind === "popular" ? " · Backlog Buster activity" : ""}`}
        {feed.refreshedAt ? ` · Updated ${new Date(feed.refreshedAt).toLocaleDateString()} · Refreshes every 18 hours` : " · Local catalog available"}</p>}
    </header>
    <div className="discovery-interest-controls">
      <div><p className="discovery-interest-heading">{copy("ALONG YOUR INTERESTS", "Adventures Close to Your Heart", "alongInterestsTitle")}</p>
        <p className="discovery-interest-hint">{feed?.hasTasteProfile ? "Taste similarity follows your favorites, play history and Not Interested feedback."
          : "Play, complete or rate favorites to develop your taste profile. Saga follows can still appear."}</p></div>
      <label htmlFor={sortId}>Sort by<select id={sortId} value={sort} onChange={event => setSort(event.target.value as DiscoverySort)}>
        <option value="default">{kind === "radar" ? "Release Date" : "Trending"}</option><option value="best-match">Best Match For You</option>
      </select></label>
      <label className="discovery-interest-toggle"><input type="checkbox" checked={interestsOnly} onChange={event => setInterestsOnly(event.target.checked)} />Along Your Interests only</label>
    </div>
    {loading && <p className="advisor-loading" role="status">Loading discovery…</p>}
    {error && <p className="advisor-error" role="alert">{error}</p>}
    <p className="advisor-scout-status discovery-action-status" role="status" aria-live="polite">{notice}</p>
    {!loading && feed && !cards.length && <p className="advisor-empty" role="status">{interestsOnly ? "No high taste matches or saga follows in this feed yet. Show all releases to explore more." : kind === "radar"
      ? "No unseen games with confirmed dates in this release window. Saved games and Not Interested titles are hidden; check Popular / Trending or Scout / Search for more."
      : "No unseen catalog games right now. Saved games and Not Interested titles are hidden; try Scout / Search for more."}</p>}
    <div className="advisor-external-grid">
      {cards.map(game => <article className="advisor-card discovery-card" data-variant="external" key={game.key}>
        {game.coverUrl ?
          // eslint-disable-next-line @next/next/no-img-element
          <img className="advisor-cover" src={game.coverUrl} alt={`${game.title} cover art`} width={640} height={360} loading="lazy" decoding="async" />
          : <div className="advisor-cover advisor-no-cover" role="img" aria-label={`${game.title} cover art unavailable`}>{copy("NO COVER", "NO ARTWORK")}</div>}
        <div className="advisor-card-body">
          <p className="discovery-card-signal">{game.signal === "community" ? copy("PLAYER ACTIVITY", "FAVORED IN THE REALM") : game.signal === "release" ? copy("RELEASE INTEREST", "A NEW CHRONICLE") : "LOCAL CATALOG"}</p>
          <h4>{game.title}</h4>
          <div className="discovery-affinity-badges">
            {game.affinity.highTasteMatch && <span className="discovery-affinity-badge" data-affinity="taste" title="Cosine similarity to your weighted taste profile; not a prediction of your rating.">
              {copy("High Taste Match", "High Taste Match", "highTasteMatchTitle")} ({game.affinity.matchPercent}%)</span>}
            {game.affinity.sagaFollow && <span className="discovery-affinity-badge" data-affinity="saga" title={`Following ${game.affinity.sagaFollow} from your play history`}>
              {copy("Saga Follow", "Saga Follow", "sagaFollowTitle")} · {game.affinity.sagaFollow}</span>}
          </div>
          {!game.affinity.highTasteMatch && game.affinity.matchPercent !== null && <p className="discovery-match-percent">Taste match: {game.affinity.matchPercent}%</p>}
          <p className="advisor-metadata">{game.platforms.slice(0, 3).join(" / ") || "Platform TBA"} · {game.genre || "Genre unknown"}</p>
          <p className="discovery-release-date">{game.releaseDate
            ? <><span>{game.releaseDate > new Date().toISOString().slice(0, 10) ? "Upcoming" : "Released"}</span> · <time dateTime={game.releaseDate}>{game.releaseDate}</time></>
            : game.releaseYear ? `Release year: ${game.releaseYear} · Date unconfirmed` : "Release date unconfirmed"}</p>
          <div className="advisor-card-actions">
            <button className="advisor-acquire-button" type="button" disabled={pending !== null} onClick={() => act(game, "add")}>+ Add to Backlog / Wishlist</button>
            <a className="trailer-link-button" href={buildTrailerUrl(game.title, game.releaseYear)} target="_blank" rel="noopener noreferrer">Watch trailer ↗</a>
            <button className="advisor-dismiss-button" type="button" disabled={pending !== null} aria-label={`Not interested in ${game.title}`} onClick={() => act(game, "dismiss")}>× Not Interested</button>
          </div>
        </div>
      </article>)}
    </div>
  </div>;
}
