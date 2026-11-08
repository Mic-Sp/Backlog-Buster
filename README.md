# Backlog Buster

A gamified video game backlog tracker. Track games across status stages (*Backlog*, *Playing*, *Completed*), earn XP based on game length and difficulty, level up, and automatically pull game metadata and box art using the RAWG API.

## Tech Stack

- **Framework:** Next.js (App Router, Server Actions)
- **Language & Styling:** TypeScript, Tailwind CSS
- **Database & ORM:** PostgreSQL (Neon Serverless), Prisma ORM
- **Integrations:** [RAWG Video Games Database API](https://rawg.io/apidocs)

## Prerequisites

- Node.js 20+
- A PostgreSQL database (e.g. [Neon](https://neon.tech))
- A RAWG API key (optional, for automatic game metadata lookup)

## Getting Started

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd backlogbuster
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB_NAME?sslmode=require"
RAWG_API_KEY="your_rawg_api_key" # optional
```

### 3. Sync Database Schema

Enable the catalog's vector type before pushing the Prisma schema:

```bash
npx prisma db execute --file prisma/game-catalog.sql
npx prisma db execute --file prisma/catalog-vectors.sql
npx prisma db push
npx prisma db execute --file prisma/playthrough-backfill.sql
npx prisma db execute --file prisma/friendship-constraints.sql
npx prisma db execute --file prisma/activity-event-constraints.sql
npx prisma generate
```

The additive SQL scripts can be rerun; they preserve existing library/catalog rows.
The playthrough backfill sets legacy Completed games to one clear, leaves journal dates
and activity untouched, and enforces counts from 0–99 (Completed requires at least 1).
Restart a running development server after regenerating the Prisma client.
The friendship CHECK constraints enforce sorted, distinct player pairs and valid
request/block states. Reapply `friendship-constraints.sql` after each schema sync.
`vector` must be available on the PostgreSQL server. Prisma 7 represents the optional
128-dimensional column as `Unsupported("vector(128)")`; catalog writes use parameterized
SQL in the same transaction as metadata updates. No vector preview feature is needed.

Run `npm run catalog:seed` with a RAWG key to ingest the curated Scout titles, provider
matches for existing library titles, and refresh existing catalog records. It processes
up to 250 inputs per run (override with `-- --limit 5000`) and prints `nextAfter` when
more remain. Continue with `npm run catalog:seed -- --after 'CURSOR'`. Rerunning from the
start retries unmatched titles. Only exact normalized title/year matches are seeded;
unmatched/ambiguous titles stay out rather than copying player-entered metadata.
Provider outages fail the command promptly instead of reporting every title as unmatched.
Metadata lookups and autocomplete also save canonical RAWG metadata and vectors.
Autocomplete responses and Scout ranking/cards remain unchanged.

`npm run catalog:backfill` regenerates missing/stale vectors for existing catalog rows
without RAWG calls. Both commands require Node 22.18+ and the development dependencies.
The deterministic `catalog-features-v1` layout uses separate genre/tag/series hash
segments, log-scaled duration and an era segment, then unit normalization. Hash collisions
are possible; these vectors are a baseline, not semantic embeddings. Bump its version
and backfill after changing the layout, normalization, or weights. A typed semantic
provider hook is reserved for later work; no Gemini embedding requests are made.

RAWG genres/tags and title-derived curated series hints remain public catalog metadata.
Nullable multiplayer/co-op flags encode positive tag evidence only, not platform-specific
compatibility or crossplay. Missing evidence remains unknown. Personal notes, ratings,
progress, player IDs and personal duration estimates are never copied into the catalog.

The server-only `getVectorRecommendations` entry point in `src/lib/recommendations.ts`
is now Scout's primary discovery source. Catalog metadata is projected to the existing
card interface without provider calls. When fewer than three eligible vector picks remain,
Gemini/RAWG fills the open slots, followed by the curated fallback. Provider outages retain
successful vector picks; insufficient verified coverage can still yield fewer than three.
Taste uses up to eight matched catalog anchors. Explicit Hall of Fame favorites from
`Player.featuredTrophyIds` get priority within that cap regardless of status or rating.
Their base weight is 2 for five stars and 1 otherwise, multiplied by **1.35** uniformly
across all three slots. Other anchors use completed games rated 4–5 first
(5 stars carry twice the weight of 4), otherwise active/queue-pinned games with no low
rating, otherwise fixed broad defaults. Hall of Fame weights shape the positive centroid,
genre/series affinity and preferred duration; those favorites also take precedence over
negative feedback and can supply recommendation reason attribution.
Missing/stale vectors and ambiguous title/year
matches are skipped; duplicate platform copies count once. Unrated completions alone
do not establish a positive taste profile unless explicitly pinned in the Hall of Fame.
No player profile vectors are persisted.

Multiple clears add a fixed **1.15×** positive-anchor weight bonus, compounded with
the Hall of Fame multiplier. Low-rated games still follow the normal negative-feedback
rules unless explicitly selected as a Hall of Fame favorite.

Replay tracking keeps lifetime completed runs separate from current status. In the Trophy
Room or Fantasy quest inspection, **Log Replay / +1 Clear** records an additional clear
without changing the start date, rating, review or base completion XP. The normal status
editor can move a completed title to Playing for another run; completing it increments
the count once and updates the latest completion date. Repeated Complete submissions do
not increment again. Counts can also be corrected in the game or metadata editor (0–99;
Completed games retain at least one clear). Explicit journal edits take precedence.

The twelfth milestone, **New Game+** / **The Eternal Return · New Game+**, unlocks at
two clears on any title and awards 300 XP once. Standard milestones still count distinct
games, not clears. Multi-clear badges appear in both library themes and private/public
dossier trophies, including exported cards. Completion activity snapshots carry the clear
count without publishing private notes. JSON and CSV backups retain counts; older backups
default Completed to one and other statuses to zero, without inventing completion dates.

Retrieval uses pgvector cosine distance, the current feature-vector version, released
years, and normalized ownership/recent-history exclusions before SQL's result limit.
The initial small catalog uses a JS title index to share the existing normalization
rules exactly. A reserve pool is reranked with 70% cosine, 15% series/title-lineage,
10% genre continuity and 5% playtime fit; results include score components and reasons.
Year-only eligibility has the same precision as the existing release-year helper.
Database errors propagate to the caller rather than silently masquerading as cold start.

Admin Scout diagnostics include vector/cosine and total latency, taste source, per-pick
cosine/hybrid scores and weighted components, plus catalog embedding/version/release coverage.
They also show the matched Hall of Fame anchor count, multiplier and each positive anchor's
final weight, rating and Hall of Fame designation.
Coverage queries are admin-only and optional; their failure never discards successful picks.
The action rechecks admin access after discovery, then redacts all diagnostic text before
delivery. Ordinary Scout responses contain only the original recommendation card fields.

Run `npm run catalog:verify-vectors` for read-only live integration checks: compare
database cosine distances with a JS reference, verify owned/seen/release filtering,
hybrid ordering and cold/active/pinned fallback profiles. It makes no provider calls
and writes no player or catalog data. `npm test` runs the offline unit suite.

### One-time Owner bootstrap

After syncing the schema, use Node.js 22.18+ to run
`OWNER_BOOTSTRAP_PLAYER_ID="existing-player-id" npm run admin:bootstrap`.
The optional identifier can also be supplied through `.env`; it must identify an
existing account with email/password credentials. The command accepts no email or
handle fallback and never runs during login or profile changes.

After each schema sync, apply the PostgreSQL Owner constraints before bootstrap:
`npx prisma db execute --file prisma/owner-constraints.sql`. The partial unique
index permits only one Owner; a check requires the Owner to remain an Admin; the
trigger prevents deleting the Owner or removing/transferring its Owner status.
Normal self-service credential changes remain available.

Bootstrap uses a transaction, a database lock, and a separate permanent
`initial-owner-v1` marker in `AdminBootstrap`. It upgrades the selected existing
account to Owner and Admin even if the legacy admin bootstrap already completed.
An existing Owner seals the latch without transferring ownership. The legacy
`ADMIN_BOOTSTRAP_PLAYER_ID` remains an optional command-only fallback identifier.
Neither bootstrap runs during login or profile edits.

Server-only `requireAdmin()` checks active sessions and database flags. Admin
mutations reject Owner targets, standard admins cannot manage peer admins, and
only the Owner can promote or demote admins. Client role props are for display only;
there is no application action to transfer or remove Owner status.

For an existing database created before Player profiles, run the additive backfill
before `db push` so every game and achievement owner has a Player record:

```bash
npx prisma db execute --file prisma/backfill-player-profiles.sql
npx prisma db push
npx prisma generate
```

The backfill preserves the existing `userId` columns, links them to `Player.id`,
and checks every game and achievement row before committing. It is safe to rerun.
Restart the development server after generating the updated Prisma Client.

Dossier identity settings autosave to the current Player profile in PostgreSQL.
Pinned favorites must belong to that player; unpinned slots use completed five-star trophies.

### Year in Review

Open the annual recap inside the personal Dossier / Adventurer’s Codex, or beneath the
card on `/dossier/[handle]`. Both themes offer year selection, a Jan–Dec cadence chart
and table, genre/platform leaders, critic average, and Game of the Year, Longest Odyssey,
First Clear and Final Clear highlights. Copy the formatted text or download an intrinsic
SVG-based 2000 × 1360 PNG; the readable data view accompanies the compact share card.

`src/lib/year-in-review.ts` is a pure aggregation engine. Calendar attribution uses valid
UTC journal `completedAt` dates and a positive completed-run count, even if a title is
currently being replayed. No library-added or estimated dates substitute for missing
history. The selector includes dated completion/start years and the current UTC year;
it defaults to the current year with clears, otherwise the most recent past clear year.

The schema retains only the latest clear date, lifetime runs and cumulative hours.
Each title therefore contributes **one known dated clear**; recorded repeat clears count
titles whose latest clear is a replay. Lifetime run/replay totals across those titles are
labeled separately. Replaying or editing a journal can change an older recap: this is a
live latest-clear snapshot, not an immutable archive of every playthrough. Undated clears
are counted separately and excluded from annual metrics. Empty years remain selectable.

Hours use actual saved `hoursPlayed`, without duration-estimate substitution or multiplying
by run counts. The optional started-title toggle adds cumulative hours from titles with
`startedAt` in the year, counting overlapping titles once. It does not change completion
cadence, rating or clear highlights. Exact calendar-year session hours and annual XP cannot
be reconstructed from these records. Existing lifetime XP and achievement behavior is unchanged.

Game of the Year ties use rating, Hall of Fame selection, lifetime runs, logged hours,
title and ID. Genre/platform leaders rank by cleared-title count, then logged hours and
name. First/final dates use title and ID for ties; Longest Odyssey requires logged hours.
Public recaps are built inside the existing visibility/block-authorized dossier query and
return aggregates and highlight projections, never raw library rows, notes or reviews.

### Friendships and profile privacy

Handles use 3–32 letters, numbers, underscores or hyphens and are saved lowercase.
`src/app/friendship-actions.ts` exposes authenticated discovery, request sending,
acceptance, decline/cancellation, removal, blocking/unblocking and visibility updates.
Only registered sessions can use these actions; a claimed `default-player` account
qualifies, while its unclaimed local archive does not.

`Player.profileVisibility` defaults to `public` and defines the audience for the
dossier and future activity: `friends` requires an accepted relationship, and
`private` permits only the owner. Discovery uses the same audience rules and returns
minimal identities. A block from either side hides both profiles from the other
authenticated player and prevents requests. Public profiles remain visible to
anonymous visitors. Both players can hold their own block; unblocking clears only
the caller's block and never restores a previous request or friendship.

Each unordered pair has one canonical `Friendship` row, serialized under a database
lock and protected by a composite primary key plus the PostgreSQL checks above.
Reciprocal requests remain pending until explicitly accepted. Account deletion
cascades relationships. Restricted dossiers return generic share metadata without
profile details or indexing. The Social Hub exposes these controls in both workspace layouts.

### Friend activity events and reader

`ActivityEvent` records immutable public snapshots for status transitions, new star
ratings and newly inserted achievement unlocks. Events and source writes commit
together. Per-game revisions distinguish replay cycles from repeated submissions;
actor/deduplication keys make duplicate deliveries harmless. Notes, uploaded backup
contents, credentials and Steam identifiers never enter the payload. Reapply
`activity-event-constraints.sql` after schema syncs to preserve append-only and
source-ownership enforcement.

Backup/title imports emit one count summary for each batch that adds games. Steam
syncs stay quiet. Both paths award achievements inside the import transaction
without emitting unlock activity, so later page checks cannot republish them.
Library resets remove all of the actor's events, including import summaries;
deleting a source game, unlock or account cascades its events.

`getFriendActivityFeed` and `fetchFriendActivity` return accepted friends' activity
from the last 30 days, with a default limit of 20 (maximum 50) and a timestamp/ID
cursor. Audience, registration and block rules are checked in each query. Private
profiles, nonfriends, pending requests and the viewer's own events are excluded.
No personalized feed cache is used.

### Social Hub and shared co-op backlog

Open **SOCIAL HUB** from the Cyberpunk library header or **FELLOWSHIP // SOCIAL HUB**
from the Fantasy archive tools. Its Friends, Activity and Co-op tabs share one
responsive dialog with keyboard navigation and focus containment. Friends & Discovery
supports callsign/handle search, requests, blocks, dossier links and profile visibility.
The personal dossier also exposes visibility settings; registered visitors see
relationship controls on visible public dossiers. Unclaimed archives receive a
sign-in prompt and never load social data.

The co-op matcher compares the caller with up to four accepted, visible friends.
Each result must exist in every selected library. Steam AppIDs establish the
strongest identity, followed by normalized title/year; missing-year fallback is
allowed only when known releases/editions are unambiguous. Duplicate copies prefer
a common platform, then an active copy. Defaults include Backlog/Playing games
released by the current year and positive multiplayer/co-op evidence from the
local catalog or its tags. Completed replays and games with unknown capabilities
are explicit options; Flatlined games and known single-player-only titles stay out.

Results show each participant's platform, status and played hours. Capability
labels describe catalog evidence, not verified cross-play, player limits or device
compatibility. Matching makes no provider calls and rechecks friendship/privacy
before returning. Private friends can remain in the relationship list, but their
career and library data are unavailable for viewing or comparison.

### Accounts and Sessions

Use **CLAIM NETRUNNER ACCOUNT // SIGN IN** in the player HUD to register or log in.
The first registration upgrades the unclaimed `default-player` row in place,
preserving its games, achievements, XP, and profile. Later registrations create
independent empty libraries. Anonymous access is available only while the local
profile has no credentials; after claiming it, logging out shows the sign-in screen.

- Passwords use Node's salted `scrypt` (`N=131072`, `r=8`, `p=1`), following the
  [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).
  Registration and login accept 8–128 characters; passwords are never trimmed or stored as plaintext.
- Sessions last seven days and use HMAC-signed, HTTP-only, SameSite=Lax cookies.
  Only the session token hash is stored in `PlayerSession`. Logging out revokes the
  database session, preventing replay. Production cookies use `Secure` and the
  `__Host-` prefix, so production must be served over HTTPS.
- Without an externally supplied `AUTH_SECRET`, a cryptographically random signing
  key is generated once in the server-only `AuthSecret` table and shared by app
  instances. No additional environment configuration is required. An optional
  `AUTH_SECRET` must contain at least 32 bytes and be consistent across instances;
  changing it invalidates existing cookies.
- Email and handles are normalized to lowercase. Signup claims and duplicate
  checks are serialized in a database transaction. Persistent throttles allow ten
  attempts per email per fifteen minutes and sixty attempts globally per minute.
- `getCurrentPlayer()` and `getCurrentPlayerId()` resolve ownership on the server
  from the active session. Game actions, dossier saves, recommendations, and
  achievement calculations never accept a browser-supplied owner ID. Browser
  achievement/level notification history is scoped to each account.

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Builds the production bundle |
| `npm run start` | Runs the production build |
| `npm run lint` | Runs ESLint |
| `npm run test:auth` | Runs isolated authentication and archive-claim regression tests (no database required) |
