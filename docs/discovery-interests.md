# Personalized discovery: audit and implementation

## Architectural audit

| System | Audited behavior | Integration |
| --- | --- | --- |
| Release Radar / Popular | Global public JSON snapshots in `DiscoveryFeed`, an 18-hour TTL, cross-instance refresh leases, exact release dates and local fallback. Personal library/dismissal filtering happened after the shared read. | Keep snapshots public and independent of the player. Add a read-time personalized overlay; scoring and notification reads never refresh providers. |
| Feature vectors | `catalog-features-v1` is a normalized 128-d vector: genres 32 bins (weight 3), tags 48 (2), series hints 32 (2), duration 8 (1), year 8 (0.75). Metadata/vector writes are atomic. `pgvector` uses cosine distance; matching only compares vectors with the current version and valid dimensions. | Load the cached feed candidates' existing vectors in one bounded SQL query, then compute dot products against the same normalized taste vector. No new embeddings, metadata requests or model calls. |
| Taste centroids | `buildPlayerTasteProfile` selects at most eight deduplicated anchors. Explicit Hall of Fame intent receives a 1.35 multiplier, repeat clears 1.15. Completed 4–5-star favorites lead, then active/pinned games, then a generic cold-start prior. Explicit positive intent overrides contradictory negative feedback for the same catalog row. | Reuse this function unchanged. A cold-start prior does not produce personal percentages or High Taste Match notifications. Missing, malformed or stale candidate vectors remain unscored. |
| Negative steering | Low 1–2-star ratings and durable `RecommendationDismissal` records form a normalized negative centroid. Rocchio uses `normalize(P - 0.25 N)` with a cancellation guard. The existing Scout reranker additionally applies feature penalties. | Feed percentages are cosine similarity to the Rocchio-shifted vector, not the Scout reranker's composite score. After dismissal, rebuild the profile and return rescored cards in the same Server Action response. |
| Franchise resolver | `getFranchiseName` / `gameLineage` normalize known aliases, explicit manual franchise names, numerals and subtitle stems. Feature `seriesHints` are affinity hints, not canon membership. Cached `FranchiseChronology` can provide exact normalized title/alias matches with remake/year ambiguity checks. | Reuse local lineage equality or verified cached canon membership. Export and reuse the existing cache validator. No chronology refresh, Gemini ordering or fuzzy vector-neighbor claim is needed. |
| Shared UI | Cyberpunk and Fantasy use one advisor controller and overlay; Fantasy has a separate Navi trigger. Custom Theme Studio resolves terminology through `useLayoutCopy`. | Share counts/state between both trigger implementations and the Radar pill; add custom terminology and palette-aware badges/controls. |

## Scoring and presentation

`discovery-personalization.ts` loads the authenticated player's library, Hall of Fame IDs, permanent dismissals, seen keys, taste anchors and candidate vectors. Candidate vectors have a maximum of 96 distinct keys (Radar plus Popular); the full public title index preserves the recommendation engine's ambiguity checks for same-name remakes. Missing vector support does not disable Saga Follow detection.

High Taste Match requires cosine similarity >= 0.80 and at least one valid personal positive anchor. The displayed percentage is the nonnegative cosine multiplied by 100, floored to an integer; it is not a probability of liking the game or a predicted star rating. Small floating-point threshold tolerance is limited to 1e-12. Lower matches display a quiet percentage. Current vectors, normalized rows and the existing taste-model weights are reused rather than creating another vector space.

Saga Follow applies only within the same recent/upcoming release window as Radar (last 60 through next 90 UTC days). A player's relevant history includes Playing games, completed runs (even if now returned to Backlog), positive hours played, or a rating >=4. Merely owning an unplayed/unrated Backlog title does not imply following it. Membership uses cached canonical matches where available, otherwise the same deterministic franchise resolver used by Saga Chains; unrelated titles sharing genre/tags do not become saga follows. This denotes franchise interest, not story chronology or a prerequisite order. Unknown relationships stay unbadged without fetching canon.

Default Radar order is release date ascending; Popular retains its cached Trending order. Best Match For You sorts by `cosine + 0.15 when Saga Follow`, with stable original-order ties. The saga bonus affects ordering only, not the displayed cosine percentage. Along Your Interests only filters to either qualifying badge. Empty/cold-start states explain how to develop a profile.

## Durable unseen state

`RadarSeen` has a compound primary key `(userId, catalogKey)`, a timestamp, and a cascading Player relation. It deliberately has no foreign key to a potentially evicted public catalog/feed row. A release remains viewed across cache refreshes and score changes. A different canonical title/year key is a different release.

The unseen count is the unique, current Radar keys that have High Taste Match or Saga Follow, minus owned, dismissed and previously viewed games. It does not include all-time Popular favorites or unknown release dates. Both the advisor trigger and Radar pill show this same subtle count; zero has no badge.

The notification GET route authenticates the current session, reads cached Radar metadata only, and returns `private, no-store`. It never claims a feed refresh or invokes IGDB/RAWG. Until a shared Radar snapshot exists there are no release notifications. Initial mount, library updates, focus, same-window feedback events and cross-tab storage events refresh the indicator. Storage carries an anonymous revision token only, never counts, titles or player identity; no polling timer or new notification permission is required.

After highlighted cards render in Radar or Popular, the client submits those keys for acknowledgement. The server intersects them with the current eligible Radar highlights and inserts using `skipDuplicates`. It never acknowledges a whole snapshot timestamp. A new release appearing between render and acknowledgement remains unseen. Highlight cards in Popular that are absent from Radar do not clear unrelated Radar notifications. The tab treats rendering the feed as viewing its displayed card set; it does not require scrolling every card into the viewport.

Adds and dismissals also record their interacted key; ownership/dismissal filtering immediately removes them from notification eligibility. A failed acknowledgement leaves the count intact and displays retry feedback. Personal writes never invalidate or personalize the global cache.

## Reactive negative feedback

Feed actions still accept only kind/key/choice, authenticate, and resolve the card server-side. Add remains idempotent under the existing player/deck lock. On a successful dismissal, the action reads fresh dismissals, builds the same Rocchio profile, and returns the remaining feed's new percentages, highlights and unseen count. The client swaps in that response without document navigation. Switching feeds reads the same updated profile; same-window Scout dismissals and other tabs also request a fresh overlay. The existing optimistic card removal is restored on failed writes.

`alongInterestsTitle`, `highTasteMatchTitle` and `sagaFollowTitle` are optional Theme Studio terminology fields, accepted by import/export/share codecs. Blank values use the selected base layout. Cyberpunk uses telemetry styling, Fantasy uses parchment/green/gold styling, and custom palettes supply their own colors.

## Rollout and verification

Run `npx prisma db execute --file prisma/radar-seen.sql` then `npx prisma generate`. This repeatable additive SQL creates only the player acknowledgement table and foreign key; no player/library/feed data is rewritten. The earlier `prisma/discovery-feeds.sql` rollout remains required.

`tests/discovery-personalization.test.cjs` covers cosine thresholds, invalid/missing vector spaces, cold starts, identical Hall of Fame/replay weighting, Rocchio shifts, local/canonical saga matching, played-history eligibility, ambiguity, sort stability, acknowledgement idempotency, per-player isolation, authentication, new-snapshot races, and add/dismiss responses. Theme-share tests preserve all new terminology fields.

`scripts/check-discovery-interests.cjs` runs the production app with provider keys disabled, disposable accounts, temporary public vector fixtures, and restored shared snapshots. It checks 1440px and 390px across Cyberpunk, Fantasy, and both Theme Studio base layouts; high/saga badges, sort/filter controls, count transitions, cross-tab acknowledgement, a new unseen snapshot entry, persisted state after reload, and negative steering from 80% to 64% without document navigation. Artifacts are under `/tmp/backlog-interests-browser`. Use a test/development database without concurrent feed consumers while its temporary snapshots are installed.

Verification completed: all 80 test files passed, including eight personalized discovery tests; TypeScript and the production build passed. All 16 feed/theme/viewport browser combinations passed, with no page errors or horizontal overflow. The additive SQL was applied, the generated Prisma client refreshed, and browser accounts/catalog fixtures were removed with prior feed snapshots restored. Live provider availability was deliberately excluded from this cache-only personalization check.
