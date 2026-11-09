# Steam authentication and automatic library population

## Audit findings

The previous `/api/auth/steam/callback` verified OpenID, resolved or created the player and created a session. Sign-in redirected to `/`; linking redirected to a confirmation page. Neither queued a library import.

`PlayerWorkspace` scheduled the existing `autoSyncSteamLibrary` through Next's `after()`. That path used the editable `steamId`, skipped unplayed games, and attempted at most once per rolling 24 hours. Failures were intentionally silent. Revalidating the server path after completion did not refresh the already displayed workspace, so a new player could keep seeing an empty library.

Manual sync runs through `actions.syncSteamLibrary` → `syncSteamLibraryGames` → `syncSteamLibraryForSession`. The shared pipeline already provides:

- `GetOwnedGames` with app information, lifetime playtime and recent minutes.
- AppID matching first, then normalized title matching for legacy PC copies, preserving console copies.
- Whole-hour playtime updates that only increase saved hours, with existing statuses, reviews, notes, ratings, dates, XP and ownership choices retained.
- Cache-first metadata matching, with at most three bounded RAWG/IGDB lookups per bulk import.
- Six prioritized achievement requests, two workers and a 30-second total budget; private/unavailable achievement stats do not prevent owned-game import.
- A per-player deck lock, live-session recheck, batched writes and a 15-second write transaction.

The previous account-link resolver rejected every Steam identity already linked to another player. That included accidental Steam-only signups with no content or other credentials.

## Implemented flow

Successful Steam signup, sign-in and verification/linking now queue a `SteamAuthSync` row **inside the account/session transaction**, using only the SteamID64 returned by OpenID verification. Both flows redirect straight to the workspace. Provider library requests do not delay the callback.

The workspace renders `SteamLibrarySync` from the durable request. It immediately calls `POST /api/steam/auth-sync`, displays a themed “Syncing Steam library…” state, and refreshes the Server Component library when the request completes. Other tabs poll an already-running request. Reloading the workspace resumes pending/interrupted work. No detached promise or ephemeral in-memory queue is needed to complete the import.

The authenticated POST derives the player and session from the server cookie, checks the request origin, and accepts only the durable request identifier and optional retry flag. It never accepts an account or Steam ID as an authorization source. It uses the existing sync pipeline with `includeUnplayed: true` and `updateHoursPlayed: true`.

Each job has an atomic claim, unique lease ID, 90-second lease and at most three attempts. The route has a 60-second execution allowance. An expired lease can be reclaimed after a serverless termination; already committed games are matched idempotently on retry. Terminal failures require an explicit retry, with a persisted ten-second minimum cooldown. After three attempts, the notice offers a fresh Steam sign-in or manual sync rather than looping forever.

Before importing rows, the write transaction locks the profile and job, checks the live verified identity and session, and verifies the current request/lease and its expiry. Superseded workers cannot commit stale imports or overwrite the newer job's result. The browser follows a superseding request through a workspace refresh. A revoked session stops the progress state and asks the player to sign in again.

The ordinary daily background refresh remains available, prefers the verified identity when present, and skips accounts with an auth-sync request updated within 24 hours. It does not race the initial import or silently retry a privacy failure immediately after authentication. Manual sync keeps its existing options and cooldown.

## Saved manual profiles and telemetry

`Player.steamId` remains the saved manual sync target. Automatic verified imports preserve it, even if it differs from the verified identity. The new nullable `steamLibrarySourceId` records the actual source of the most recent Steam snapshots. Source changes clear old cached telemetry before applying the new account's snapshots. Single-game achievement refresh and library Steam links use the recorded source, falling back to the verified identity and then the manual target for legacy records.

## Private profiles and other failures

A `PRIVATE_LIBRARY` result is persisted as a controlled error code. Both themes explain that **My profile and Game details must be Public** in Steam Privacy Settings, offer retry after the cooldown, and confirm that sign-in and existing games are safe. An explicit public zero-game library succeeds with zero imports; a hidden/unavailable response does not masquerade as an empty success.

Missing/rejected API keys, provider quotas, interrupted requests and generic failures have separate messages. Authentication remains successful when library import fails. Provider URLs, API keys, raw database errors and exception messages are never returned by the sync endpoint. `STEAM_API_KEY` remains required for library import; OpenID sign-in itself works without it.

## Empty Steam-only account reclamation

A signed-in player who proves ownership through a fresh, session-bound Steam callback can reclaim an identity from an empty Steam-only shell. The shared registration lock, shell deck lock and profile row lock coordinate the transfer. The resolver requires:

- No email, password, Google connection, admin/owner role, or protected `default-player` ID.
- No games, achievements, custom lists, activity events, friendships/blocks, recommendation preferences or recovery tokens.
- No separately saved manual Steam profile that differs from the verified identity.

The transfer removes the verified identity from the shell, makes its profile private, revokes **all** shell sessions, removes its internal sync request and links the identity to the main account. It retains the old profile row and profile content, and preserves the main account's credentials, identity and library. Session creation, reclamation, linking and the new import intent commit or roll back together.

Accounts with imported games are populated accounts and retain the existing conflict protection. This change does not automatically merge nonempty libraries or transfer identities away from accounts with other credentials or relationships.

## Migration and checks

Apply before deploying the code:

```sh
npx prisma db execute --file prisma/steam-auth-sync.sql
npx prisma generate
```

The repeatable SQL adds one nullable source column and the durable job table. It was applied to the connected development database; it does not rewrite existing accounts or sessions.

Verification:

- Full unit suite: 74 test files. New coverage includes callback queuing for sign-in/linking, verified-ID imports, unplayed games, duplicate claims, lease recovery, retry bounds, private-profile handling, revoked identities, stale write fences and safe empty-shell reclamation/rollback.
- TypeScript, focused ESLint and production build checks.
- `scripts/check-steam-population.cjs` exercises the real app, OpenID routes, jobs, database writes, sessions and browser refresh with explicit Steam OpenID/Web API fixtures. Both Cyberpunk and Fantasy are checked at 1440px and 390px. The run checks played/unplayed population, playtime, achievements, visible progress/privacy guidance, protected nonempty accounts, empty-shell reclamation, revoked shell sessions, preserved main credentials/progress/manual profile and idempotent subsequent Steam sign-in.
- The browser run preserved all nine original account records and three sampled active sessions, reported no browser runtime errors or horizontal overflow, and cleaned up its disposable accounts and replay records. Report and screenshots: `/tmp/backlog-steam-population-browser/`.

```sh
node scripts/check-steam-population.cjs --playwright-module /path/to/playwright
```

The optional `--library-path` points Chromium at shared libraries in minimal environments. The fixture is explicitly enabled for QA and refuses production mode. A real Steam authorization/import has not been exercised by this fixture check.

Reference: [Valve's GetOwnedGames service documentation](https://partner.steamgames.com/doc/webapi/IPlayerService#GetOwnedGames).
