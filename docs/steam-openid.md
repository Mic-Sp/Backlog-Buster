# Steam sign-in and verified linking

## Architectural audit

| Area | Existing architecture | Steam implementation |
| --- | --- | --- |
| Accounts | `Player.email` and `passwordHash` were already nullable. `googleId` is unique. `steamId` is an editable, nonunique public library-sync target. | Add nullable, unique `steamVerifiedId` and nullable `steamVerifiedAt`. Never infer ownership from `steamId`. No existing identity or credential is backfilled or rewritten. |
| Sessions | Seven-day signed opaque cookies; only token digests persist in `PlayerSession`. Production uses a Secure, HttpOnly, SameSite=Lax, host-only `__Host-` cookie. Account writes and session rotation can share one transaction. | Reuse the same sessions and signing key. A successful Steam callback resolves the account and rotates the current browser session atomically. Linking retains other active device sessions. |
| Authorization | `auth-policy.ts` required an email plus password or Google. Player, admin, social, recovery, library-vault and achievement guards reuse this policy. Auto-sync had an additional SQL credential check. | Accept the existing credential predicate **or** a verified Steam identity. Update the SQL check too. Protect the local archive fallback and claim logic from treating a credential-free Steam account as unclaimed. |
| OAuth/origins | Google uses signed browser context, persisted single-use state, session binding, PKCE, nonce/JWT checks and a canonical public-origin resolver. `APP_URL` wins over validated forwarded/request origin. | Reuse origin resolution and transaction/session patterns. Steam uses OpenID assertions and `check_authentication`, with separate cookie/signing labels, attempt and nonce tables. |
| Steam libraries | Public ID/vanity resolution, owned-game import, achievement sync and daily automatic sync use `steamId` and a server API key. They do not establish account ownership. | Keep those sync semantics. Linking fills an empty sync target, preserves a saved one, and shows when it differs from the verified login identity. Editing/importing/syncing a profile cannot change login ownership. |
| Account Security | Google-only users could add a password; UI and helpers assumed a registered email. | Return nullable email, show Steam status, allow Steam-only users to add their first email and/or password, and hide email verification until an address exists. Changes retain rate limits, duplicate-email checks, password hashing, token invalidation and session revocation. |
| Themes | Shared `AccountControls`, `AccountSecurity` and vault controller with Cyberpunk/Fantasy presentations. | Shared Steam button, status and notice components with theme-specific styling/copy. Admin directory recognizes Steam-only registered accounts too. |

The operator-only Owner bootstrap command retains its existing local-credential prerequisite. Request-time admin authorization accepts verified Steam accounts with the appropriate roles.

## Identity and preservation rules

Logged-out sign-in resolves only `steamVerifiedId`. Existing matches retain their account ID, credentials, Google connection, roles, handle, avatar, library and sync target. Otherwise, create a new player with null email/password, the selected theme, and public Steam persona/avatar metadata when available. API failures or missing keys produce a clean `Steam Player` name and unique `steam-player-…` handle. New Steam signups do not claim the local archive or merge manually entered profiles.

Logged-in linking requires the same initiating session and account at callback time. A Steam identity verified by another player, or an attempt to replace this player's different verified Steam identity, fails with a conflict. A shared registration advisory lock serializes account claims; a database unique index prevents duplicate verified owners. There is no automatic merge, transfer or unlink operation.

Adding the first email does not require a local password when the account has a verified Steam session. The address starts unverified and receives the normal verification email. Adding a password alone is also allowed; email/password login becomes usable once both exist. Changing an existing email retains the previous requirement to establish a local password first. Local-password authorization remains required for destructive self-service actions.

## Protocol

1. `GET /api/auth/steam?mode=signin&theme=fantasy` begins signup/sign-in; `mode=link` begins Account Security linking. An entry on a deployment host is redirected to `APP_URL` before setting its host-only cookie.
2. Persist a digest of random 256-bit state for ten minutes. Sign an HttpOnly browser context containing the exact return URL, flow mode, theme, initiating session digest and link account ID. Send OpenID 2.0 `checkid_setup` to `https://steamcommunity.com/openid/login`, using identifier selection and the canonical origin as realm.
3. `/api/auth/steam/callback` rejects ambiguous/duplicate query parameters, missing/tampered/expired state, changed canonical origins and changed browser sessions. Atomically consume state, including simultaneous callbacks and restored cookies.
4. Require the OpenID 2.0 namespace, positive assertion, exact Steam endpoint, exact saved `return_to`, identical claimed/local identity and a valid SteamID64 under `https://steamcommunity.com/openid/id/`. Require signed identity, endpoint, return URL, association and nonce fields. Check nonce timestamp freshness with bounded clock tolerance.
5. POST the full OpenID assertion, changing only mode to `check_authentication`, to the fixed HTTPS Steam endpoint. No caller URL is fetched. Disable redirects, use a ten-second timeout and require an exact successful direct response. Provider rejection, cancellation, transport failure and malformed replies cannot authenticate.
6. Persist a unique nonce digest with expiry after verification, preventing signed-assertion reuse across attempts and replicas. Resolve/link and create the normal application session in one transaction; failure rolls back account changes. Clear the flow cookie and redirect to the library or `/steam-auth` notice.

Profile enrichment is optional, uses a fixed Steam API endpoint and five-second timeout, validates the returned Steam ID and restricts avatar hosts. No OpenID assertions, Steam API keys, access tokens or raw nonces are stored in player records.

`[steam-openid]` failures log only route, stage, controlled status and controlled failure code. Stages distinguish origin/session/state validation, state consumption, assertion validation, provider verification, nonce consumption, account resolution and session creation. Raw URLs, cookies, signatures, provider bodies, exception messages and database queries are excluded. Next development access logs omit Google/Steam callback URLs and server-function argument logging is disabled. Production ingress/access logging should likewise omit authentication callback query strings.

## Configuration and additive rollout

```sh
npx prisma db execute --file prisma/steam-openid.sql
npx prisma generate
```

Apply the SQL before deploying code that selects the new fields. The script is additive and repeatable: two nullable columns, one unique index and two replay-protection tables with expiry indexes. It contains no player updates/deletes, session changes or manual-profile backfill. It was applied to the connected development database on November 9, 2026.

```dotenv
APP_URL="https://your-canonical-public-host.example"
AUTH_SECRET="at-least-32-bytes-shared-by-all-instances"
STEAM_API_KEY="optional-for-persona-enrichment-required-for-library-sync"
```

Steam OpenID does not require a Google-style OAuth client ID, client secret, Steam API key or registered callback allowlist. The callback path is `/api/auth/steam/callback`. Without an API key, verified sign-in and linking work with fallback profile details; the existing library API still requires its key and public library privacy settings.

## Verification

- `npm test`: all 73 test files pass, including the new OpenID tests and updated credential-policy fixtures.
- `npm run typecheck`, focused ESLint and `npm run build`: pass.
- `tests/steam-openid.test.cjs`: signup resolution, stable verified identity, manual-profile preservation, linking/session checks, conflicts, concurrent signup, rollback, signed-state tampering/expiry, canonical proxy routing, secure cookies, atomic state consumption, duplicate parameters, forged assertions, required signed fields, return URL checks, stale/future nonces, cross-attempt nonce replay, provider failure/cancellation, metadata fallback and safe diagnostic stages.
- Additional regression coverage checks Steam-only auto-sync and social access.
- `scripts/check-steam-openid.cjs`: real Next app/routes, database and sessions with an explicit local fixture replacing **only Steam's external verification endpoint**. Exercises both themes at 1440px and 390px: login/register buttons, Steam-only signup, adding email then password, local and Steam login, wrong state, forged assertion, callback replay, verified linking, conflict handling, saved-profile preservation, Account Security and Steam sync settings. No horizontal overflow or browser runtime errors. The run preserved all eight original players and both sampled active sessions, and removed its disposable accounts and replay records.
- Browser report/screenshots: `/tmp/backlog-steam-openid-browser/results.json` and adjacent PNGs. This is provider-fixture QA, not a live Steam account authorization test.

Repeat browser QA with a locally installed Playwright package:

```sh
node scripts/check-steam-openid.cjs --playwright-module /path/to/playwright
```

An optional `--library-path` supplies Chromium shared libraries in minimal Linux environments. QA uses an isolated `.next-steam-qa` build and port 3013, and does not replace the developer's running server. The provider preload is opt-in and refuses production mode.

Protocol references: [Steam's OpenID documentation](https://steamcommunity.com/dev), [OpenID Authentication 2.0 verification requirements](https://openid.net/specs/openid-authentication-2_0.html#verification).
