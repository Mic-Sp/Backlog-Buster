# External Scout architecture and discovery feeds

Personalized scoring, saga alerts and unseen state are documented in [Personalized discovery](discovery-interests.md). Shared snapshots remain public; player-specific scores are applied after cache reads.

## Audit

| Layer | Existing behavior | Discovery addition |
| --- | --- | --- |
| UI | `TacticalAdvisor` owns the shared Cyberpunk/Fantasy modal; `FantasySubscreenView` mounts the same controller. Search/scouting uses favorites, current games, deck pins, vectors, AI and deterministic reserves. Its backlog-size guard is specific to scouting. | Three keyboard-accessible sub-tabs inside External Scout. Radar and Popular remain available regardless of the search guard. Existing scouting behavior stays in Scout / Search. |
| Server boundary | `actions.ts` authenticates scouting, normalizes exclusions, and returns optional admin-only diagnostics. Existing acquisitions can call RAWG when metadata is incomplete. | `discovery-actions.ts` authenticates every read/write, validates feed names, reads cached card metadata by key, and creates Backlog entries without provider enrichment. |
| Provider clients | `rawg.ts` parses public metadata and handles search/enrichment. `igdb-catalog.ts` parses IGDB records; `igdb-api.ts` shares Twitch auth, 401 recovery, a database dispatch gate and retry/backoff. | Bounded release-list queries reuse the parsers and IGDB transport. IGDB is primary, RAWG is fallback; no per-card lookup. |
| Catalog | `GameCatalog` has canonical title + year keys, provider metadata, optional gameplay evidence and pgvector features. `catalog-store.ts` uses a per-key transaction lock to update metadata and vectors atomically. Autocomplete is local-first, with a 30-second process cache and provider fallback. | Optional exact release date and an index. Canonical feed records also pass through the existing catalog/vector ingestion path. Sparse metadata does not erase a previously known release date. |
| Personal preferences | `Game` holds each player's library. `RecommendationDismissal` stores normalized per-player titles independently of ownership. Normalization handles punctuation, accents and sequel numerals. | Filter each shared snapshot against the authenticated player's live library and dismissals after refresh, then defensively filter again on the client. Feed preferences also apply to Scout. |
| Themes | `useLayoutCopy` resolves base layout copy and optional Custom Theme Studio terminology. Custom palettes already style the shared modal and cards. | Add `scoutTitle`, `scoutSearchTitle`, `releaseRadarTitle`, `popularFeedTitle`; blank fields retain the selected base layout. Shared pills have explicit selected/focus states in built-in and custom palettes. |

## Feed definitions

Radar includes confirmed release dates from 60 UTC calendar days ago through 90 days ahead, inclusively. Separate recent and upcoming provider slices prevent one group from crowding out the other. Undated/year-only games cannot be represented as confirmed upcoming releases. Date filtering runs again on cache reads, so an aging snapshot cannot extend the window.

Popular interleaves recent provider releases (last 180 days) with community favorites, deduplicates normalized titles and caps the result at 48 cards. Provider rankings are **interest proxies**, not a measured time-series growth rate: IGDB rating counts for released games and pre-release follows for anticipation; RAWG uses its added ordering. See the [IGDB game field reference](https://api-docs.igdb.com/#game) and [RAWG release-list examples](https://rawg.io/apidocs).

Community ranking is distinct players logging a title + twice the distinct players currently Playing or reporting recent Steam minutes + distinct players adding it in the past 30 days. It includes all statuses for total logging. The aggregate joins library rows to public catalog metadata by case-insensitive canonical title and compatible year. Unmatched titles, title spelling variants beyond case/whitespace, and personal notes/ratings/identities never enter the snapshot. Counts and player identities are not exposed. Imports cannot multiply one player's weight through multiple platforms. Old Playing flags and cached Steam snapshots are proxies for activity, rather than a live concurrent-player counter.

## Shared cache and failure behavior

`DiscoveryFeed` has one global row per kind (`radar`, `popular`), public JSON cards, source, refresh/expiry timestamps and a refresh lease. Snapshots contain no player preferences or identities.

1. An unexpired snapshot is served directly from Postgres. Tab switches and other players do not invoke IGDB/RAWG during the 18-hour TTL.
2. The first expired/cold request atomically claims a two-minute database lease with `INSERT ... ON CONFLICT ... WHERE ... RETURNING`. Other instances return the previous snapshot (or a local catalog read during cold initialization). No database transaction is held open over network calls.
3. The lease owner performs one bounded refresh, writes a new 18-hour snapshot, and releases its lease. An interrupted worker's lease expires automatically. Ownership-checked writes prevent an old worker from overwriting a newer owner's snapshot.
4. Missing credentials, quotas, empty results and provider failures preserve the previous snapshot and supplement it from the local catalog. Fallback and empty results receive the same TTL, preventing repeated quota attempts. The source indicates fallback explicitly.
5. If the cache table/coordination is unavailable, serve only the local catalog; do not call providers without durable coordination. A database outage may also make that local result empty. Cache save errors are returned as retryable UI errors and retain the lease until expiry.

“Zero quota burn” applies to warm feed browsing and card actions. A cold/expired feed refresh intentionally spends bounded provider quota; the existing Scout / Search flow has its own provider behavior. Refresh is lazy on the next visit, with no new scheduler requirement.

The advisor retains its selected sub-tab. Reopening Radar or Popular does not eagerly launch the separate Scout provider flow; switching back to Scout / Search starts that flow on demand when needed.

## Card actions

The browser sends only feed kind, card key and action. The server resolves all title/platform/cover/year metadata from the shared snapshot. Add uses the existing per-player deck/import lock and normalized ownership check to make concurrent discovery adds idempotent. Both released and upcoming games are saved with `Backlog` status; Wishlist is the acquisition intent, not a new persisted library status. Missing duration uses the existing 10-hour default without a metadata call.

Dismiss uses the existing durable recommendation-dismissal store. Cards disappear immediately while saving, return on failure with an error, and stay hidden across sub-tabs and Scout after success. Add revalidates the root route through the Server Action response, updating library counts without a document reload. Shared snapshots are not invalidated by personal actions.

## Rollout and verification

Apply `prisma/discovery-feeds.sql` (additive, repeatable), then `npx prisma generate`. The SQL adds only the release-date column/index and the feed-cache table. The repository uses SQL patches / `prisma db push`, not a Prisma migration history. Existing year-only catalog rows remain undated until verified provider ingestion supplies a date.

`tests/discovery-feeds.test.cjs` covers TTL boundaries, independent server instances, leases/stale reads and recovery, fallback/empty caching, missing cache schema, release-window boundaries, normalized exclusions, provider absence/429s, aggregate blending, authenticated actions, duplicate adds, forged references and player isolation. Existing catalog parsing and Scout dismissal tests also cover the integration seams.

`scripts/check-discovery-feeds.cjs` exercises a production build at 1440px and 390px across Cyberpunk, Fantasy and both Custom Theme Studio base layouts. It uses a disposable authenticated account and temporary feed snapshots, restores pre-existing feed rows, and disables provider keys on its test server. Screenshots/results are written under `/tmp/backlog-discovery-browser`. Run against a development/test database with no concurrent feed consumers while the fixture snapshots are active.

Verification completed: all 79 test files passed, TypeScript and the production build passed, and all 16 theme/viewport/feed browser combinations passed. Browser checks also verified keyboard navigation, failure recovery, persistent player filtering after reload, one-click writes without document navigation, unchanged warm snapshots, and real Postgres lease/TTL/fallback/community queries. Live provider availability was not part of browser QA; provider absence and quota failure behavior were tested separately.
