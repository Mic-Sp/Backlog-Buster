# Google OAuth and Account Linking

## Audit and compatibility

The auth audit started from the email-verification/password-reset implementation.
Passwords already used nullable `Player.passwordHash`; adding Google therefore
required no password-column change. Sessions use seven-day signed HttpOnly
cookies and hashed database tokens. This implementation preserves that format,
the signing secret, existing password hashes and verification timestamps.

Login and registration are in `src/app/auth-actions.ts`, with hashing in
`src/lib/auth-crypto.ts`, sessions in `auth-session.ts`, account registration in
`auth-accounts.ts`, and authorization in `player.ts`. Account Security is in
`security-actions.ts` and `account-security.ts`. The shared `AccountControls`
and `AccountSecurity` components render both themes. `src/app/actions.ts` holds
library actions rather than authentication.

The audit found password-only definitions of a registered player in sessions,
Account Security, admin authorization/directory, member counts, recovery,
friends/social/activity queries, Steam synchronization, and the activity-event
database trigger. They now recognize an email plus either a password or Google
ID through `registeredPlayerWhere`, or its SQL equivalent. Verification remains
independent from login and authorization. Unclaimed local profiles stay excluded.
Privacy predicates remain combined with registration checks using AND.

The pre-rollout database baseline contained **eight registered accounts**.
No grandfathering/backfill is run for this rollout: new nullable Google IDs do
not alter any existing account or session. Existing password login stays intact.

## Flow and account resolution

`GET /api/auth/google` begins sign-in/signup; `?mode=link` begins linking from
Account Security. Both redirect to Google with `openid email profile`, random
state and nonce, S256 PKCE, and explicit account selection. No Drive or other
Google API permissions, refresh tokens, or offline access are requested.

The ten-minute browser context is HMAC-signed with a domain-separated signature
and held in an HttpOnly, SameSite=Lax cookie (Secure and `__Host-` in production).
It contains the PKCE verifier, nonce, exact callback URI, theme, mode, and
initiating session hash/player. `GoogleOAuthAttempt` stores only the random
state's digest and expiry. Atomic deletion makes the attempt single-use across
tabs/replicas, even if an old cookie is restored. Starting another flow in the
same browser supersedes its previous context cookie.

`GET /api/auth/google/callback` validates the signed cookie, state, expiry,
callback URI and browser-session binding before exchanging the code. It then
uses `jose` with Google's fixed JWKS endpoint to verify RS256 ID-token signature,
issuer, audience, expiration, issued-at age, nonce, and authorized party. Only a
strict boolean `email_verified === true` and valid email are accepted. Tokens
are not persisted. Error redirects use fixed, local destinations and static
messages; provider error strings are never reflected to the browser.

Account resolution and session creation share one transaction and the existing
account-registration advisory lock:

1. An existing `googleId` wins, even if Google's email changed. Local credentials
   and primary email are left intact.
2. Otherwise, the verified Google email can link an existing player. This is the
   requested email auto-linking policy; it preserves player ID, password, roles,
   name/handle and library. It fills a missing verification timestamp but never
   replaces a different existing Google connection.
3. Otherwise, a new player gets a verified email, Google ID, no password, selected
   theme, trimmed display name, and a normalized handle with a random suffix.
   New Google accounts start with their own empty library; other players are
   never merged or moved.
4. Signed-in linking rechecks the initiating live session in the transaction,
   links only that player, and rejects ownership conflicts. It keeps the local
   primary email even if Google's email differs. That different address does
   not verify the local email.

Linking rotates the current device session; other devices stay connected.
Failure to write the new session rolls back account creation/linking too.
No unlink/replacement feature is provided in this change.

## Account Security

The summary returns only `googleConnected` and `hasPassword`, never the Google
subject or password hash. Both themes show Google connection status and a
Link Google Account action when unlinked. Login and signup show Continue with
Google, using ordinary navigation so browser cookies follow the external flow.

A Google-only player can set a first local password from a live session without
entering a nonexistent current password. Accounts that already have a password
must still enter it. Setting/changing credentials transactionally checks the
old credential snapshot, revokes prior sessions and recovery links, and creates
a new current-device session. It preserves the Google connection.

Google-only users set a password before using the existing password-protected
email-change, library-reset and account-deletion operations. Recovery email
verification/reset tokens also recognize Google-only accounts, so recovery can
establish a local password. Unverified local emails can still log in normally.

## Configuration and deployment

Create a Google OAuth **Web application** client and configure its consent
screen. Register exact authorized redirect URIs:

```text
http://localhost:3000/api/auth/google/callback
https://backlog-buster-chi.vercel.app/api/auth/google/callback
```

Set server-only environment variables:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
APP_URL=https://backlog-buster-chi.vercel.app
```

Use `APP_URL=http://localhost:3000` locally. All OAuth routes use the same origin
precedence: APP_URL, then validated `x-forwarded-proto`/`x-forwarded-host` (or
Host), then the request URL. HTTPS is required except for loopback HTTP.
APP_URL is authoritative when configured; forwarded hosts/protocols must be
single values without credentials or URL paths. Query return URLs are not used.
For a different local port, register that exact callback with Google and set
APP_URL accordingly. Missing credentials show a themed configuration notice;
the email/password routes remain available.

Apply the Prisma schema and regenerate the client before starting the new code.
Prisma may require `--accept-data-loss` solely because the new nullable Google ID
gets a unique index; inspect the diff first. This rollout's SQL adds a column,
table, and indexes, with no drops or data updates. Prisma's AI safety guard
required fresh explicit approval, which was obtained before applying it.
Reapply `prisma/activity-event-constraints.sql` after the schema so the existing
activity trigger recognizes Google-only actors without weakening ownership
checks. Do not run the previous verification backfill for this rollout.

## Validation and local browser QA

`tests/google-oauth.test.cjs` covers callback account resolution, new profiles,
email auto-linking, signed-in linking, conflicts, concurrency/rollback, state
signatures, expiry/replay, session switching, PKCE, configuration, and ID-token
validation with actual locally signed RSA JWTs. Existing auth, recovery, privacy,
Steam, activity and admin tests exercise the shared registration policy.

`scripts/check-google-oauth.cjs` starts an isolated development server with fake
client credentials and a Node preload from `tests/helpers/google-provider.cjs`.
The preload mocks only Google's token and JWKS HTTPS endpoints, validates the
PKCE verifier and callback, and signs a temporary provider ID token. The app uses
its real routes, database transactions, state checks and JWT verification.
The preload is never imported by production code and refuses production mode.

The browser suite tests both themes at 1440px and 390px: login/signup buttons,
state rejection, new Google-only signup, optional password setup and local login,
repeat Google login, email auto-linking, signed-in linking with a different
Google email, conflicts, connection status, and Google-only activity writes.
It creates/removes unique `example.invalid` fixtures and compares all original
accounts and sessions before/after. Screenshots/report are written to
`/tmp/backlog-google-browser`. Provider fixture keys are deleted after the run.

Run with an installed Playwright module, optionally specifying
`--playwright-module /path/to/playwright` and `--library-path /path/to/chromium/libs`.
The QA build and generated type config use ignored `.next-google-qa` output,
leaving the normal development server's build directory untouched.

No real Google client credentials were configured during implementation. A real
consent/token exchange must be checked after configuring the Google client;
the local provider stub is not evidence of real Google consent-screen setup.

Completed rollout validation: all 72 test files passed, including 13 new Google
OAuth tests. TypeScript and the production build passed. ESLint reported zero
errors and three pre-existing warnings in unrelated files. The full provider-stub
browser suite and the separate missing-configuration checks passed in both
themes at 1440px and 390px, with zero browser runtime errors. A final comparison
against the pre-rollout database fingerprints confirmed all eight original
email/password credentials, verification timestamps and session records are
unchanged. Browser-created accounts and their owned data were removed.

Local evidence: `/tmp/backlog-google-browser/results.json`,
`missing-config-results.json`, and `rollout-preservation.json`. Add
`--missing-config-only` to run the missing-credentials UI checks separately.

## Production callback diagnosis (November 9, 2026)

The original routes ignored proxy headers. Without APP_URL, a Vercel deployment
host in request.url could become the OAuth callback origin. The callback also
constructed its final redirect from that internal URL even when APP_URL was set.
Origin resolution is now shared by authorization, callback validation and every
success/error redirect. An entry on another host is redirected to APP_URL before
setting the host-only OAuth cookie. Token exchange always submits the exact
redirect URI saved in the signed initiating context.

An actual URI mismatch returned `status=state` in the original implementation.
`status=failed` alone cannot establish the production root cause: token endpoint
errors, JWT verification errors and database/session exceptions were all hidden
behind that status. The callback's duration cannot distinguish them reliably.

Both routes now emit `console.error("[google-oauth]", reason, detail)` on failure.
Details identify the route, stage, failure, internal request origin and canonical
origin, plus safe provider HTTP/error codes, Prisma error code/model, or JWT
error code/claim when available. Examples:

| Diagnostic | Check |
| --- | --- |
| `state_validation / missing_state_cookie` | Callback uses the same browser host; the Secure HttpOnly `__Host-` cookie has SameSite=Lax and Path=/ |
| `state_validation / state_signature_mismatch` | Serving deployments use the same AUTH_SECRET or the same shared database AuthSecret |
| `state_validation / redirect_uri_mismatch` | APP_URL and public proxy origin match the initiating callback URI |
| `state_consumption / state_attempt_missing_expired_or_used` | Ten-minute expiry, replay, or different DATABASE_URL across functions |
| `token_exchange / token_endpoint_rejected` | Google's HTTP status and error code, such as invalid_client or invalid_grant; exact redirect URI and client credentials |
| `id_token_verification` | JWT error code/claim, audience, issuer, expiry or JWKS availability |
| `account_resolution` with P2022 / Player | Production database has the Google ID column and matches the generated Prisma client |
| `create_session` with P2021 / PlayerSession | Session table exists in the database used by the production deployment |

Logs omit full URLs/query strings, cookies, state, PKCE verifiers, codes,
tokens, emails, secrets, database queries and raw error messages/stacks. Public
error pages keep their generic status messages. Cookie attributes, signing keys,
state hashing, single-use consumption and session data are unchanged by this fix.

Set Vercel Production APP_URL to `https://backlog-buster-chi.vercel.app` and ensure
Google registers exactly `https://backlog-buster-chi.vercel.app/api/auth/google/callback`.
The forwarded-header behavior follows [Vercel's request-header documentation](https://vercel.com/docs/headers/request-headers).
Regression tests cover differing internal hosts, public aliases, production
cookies/shared state across replicas, canonical entry/success/failure redirects,
saved-URI token exchange, failure-stage logging and secret redaction. Production
success still needs a fresh sign-in after deploying the fix; no private Vercel
runtime logs or real Google consent session were accessed during this code fix.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[jose JWT verification](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md).
