# Authentication and Account Security

Audit and implementation: November 8, 2026.

Google-only credentials and logged-in account linking are covered in
[Google OAuth and Account Linking](google-oauth.md), which updates the
registration/session checks described below to accept either sign-in method.

## Audit of the existing architecture

The repository separates authentication across `src/lib/auth-crypto.ts`,
`auth-session.ts`, `auth-accounts.ts`, and `player.ts`. Registration and login
are Server Actions in `src/app/auth-actions.ts`. Account Security is implemented
by `src/app/security-actions.ts`, `src/lib/account-security.ts`, and the shared
`AccountSecurity` component. `AccountControls` renders login and signup in both
Cyberpunk and Fantasy. `src/app/actions.ts` contains library actions, not login.

- Passwords use asynchronous scrypt, N=131072, r=8, p=1, a random 16-byte salt,
  and a 64-byte derived key. Passwords retain exact whitespace. Unknown-account
  login performs a dummy derivation. Comparisons use `timingSafeEqual`.
- Sessions use random 256-bit tokens, SHA-256 digests in `PlayerSession`, and
  HMAC-signed versioned cookies. Production cookies use the `__Host-` prefix,
  Secure, HttpOnly, SameSite=Lax, and Path=/. Sessions expire after seven days.
  Authorization checks the current database session and registered credentials.
- A configured `AUTH_SECRET` must be at least 32 bytes. Without it, a shared
  server-side key is initialized atomically in the database. Changing that key
  would invalidate existing sessions; this rollout does not change it.
- Login/registration limits persist in PostgreSQL, with hashed account keys
  and a global bucket. Account Security has a separate password-attempt limit.
- The first signup claims an unregistered `default-player` in place. Later
  signups create separate profiles. A shared advisory transaction lock protects
  account registration, credential changes, and the final login recheck.
- Credential updates require a live session and the current password. Before
  this change, self-service updates rotated only the current session, leaving
  other devices authenticated. Admin credential changes already revoked sessions.
- The audit found no email verification state, recovery token storage,
  transactional email dispatch, or forgot-password/reset routes.

## Implemented behavior and invariants

`Player.emailVerifiedAt` is optional. Verification status never participates in
login, player lookup, session authorization, admin authorization, or library
access. New signups receive a session immediately. Account Security shows a
verified/pending badge and, when pending, an authenticated resend action.

`PlayerAuthToken` stores a domain-separated SHA-256 hash of a random 32-byte
base64url token, the immutable player ID, current email, purpose, and expiry.
Verification links expire in 24 hours; reset links expire in 30 minutes. There
is at most one outstanding token per player and purpose. Resending replaces the
old link. Raw tokens are never persisted or returned by reset-request actions.

Consumption shares the credential transaction lock. It checks hash, purpose,
expiry and the exact email binding, deletes the token, and applies the change
within one transaction. Concurrent submissions can succeed only once. Failures
roll back consumption and credential/session changes together.

- Verification preserves passwords and sessions. Opening a link is read-only;
  an explicit confirmation submits a Server Action. Email scanners cannot
  accidentally consume links.
- Reset requires matching valid passwords, consumes all outstanding auth links,
  and revokes every session for the target player. It does not automatically
  sign in or clear another player's cookie. The user signs in with the new password.
- Self-service credential updates revoke all existing sessions and auth links,
  then atomically create a fresh session for the current device. Email changes
  clear verification and schedule a new verification email. Password-only
  changes preserve the verification timestamp.
- Admin password/email changes invalidate pending auth links too. Admin email
  changes clear verification and schedule verification for the new address.
- Case-insensitive email lookups escape PostgreSQL ILIKE pattern characters.

The public forgot-password action validates email syntax and returns an
identical message/cooldown without looking up the account. Next.js `after()`
runs lookup, token issuance and delivery after the response. Known, unknown,
throttled and delivery-failed requests have the same response path. Recovery
uses separate persistent limits: one request per address/purpose per minute,
and 30 per purpose globally per minute. These cannot consume login limits.

Recovery pages support both themes and mobile layouts. They use no-referrer,
no-store and noindex headers. Token query strings are removed from browser
history after hydration; reopening the original email link restores the form.
The token remains in memory for form retries. Server-side checks run after
`connection()` inside Suspense, compatible with Next.js 16 Cache Components.

## Existing-account rollout

Before the schema change the configured database had **seven registered accounts**.
A baseline fingerprint of their IDs/emails/password hashes was recorded outside
the repository. The additive schema was applied with `npx prisma db push`,
followed by `npx prisma generate` and `npm run auth:backfill-verification`.
The backfill reported **seven rows verified**.

The explicit script holds the registration lock and a Player table write lock,
sets `emailVerifiedAt = COALESCE(createdAt, NOW())` for existing non-null emails,
and records `email-verification-grandfather-v1` in `AuthRollout` atomically.
It does not update passwords, email addresses, roles, `updatedAt`, library
data, signing secrets or session records. Reruns are a no-op: future unverified
signups and changed email addresses are never grandfathered by a rerun.

For another environment, apply the schema and run the backfill **before**
deploying the new signup code. Do not invoke backfill from a request handler.

## Transactional email configuration

Set these server-only variables in production:

```dotenv
APP_URL=https://your-public-origin.example
RESEND_API_KEY=your_resend_key
EMAIL_FROM=Backlog Buster <security@your-verified-domain.example>
```

`src/lib/email.ts` uses Resend's HTTPS API with HTML and text templates in the
account's preferred theme. The origin is configured, never derived from request
Host/forwarded headers. Production requires HTTPS and never logs fallback links.
Provider failures log a sanitized operational message without addresses/tokens.
Registration and credential changes remain successful if delivery fails;
Account Security allows resending after the cooldown.

In development/testing, omit `RESEND_API_KEY`. Verification/reset links appear
in the **server terminal only** and UI text explains how to find them. The default
origin is `http://localhost:3000`; set `APP_URL` when using a different port.
Missing production configuration does not silently fall back to token logging.

Delivery uses the request lifetime supported by Next.js `after()`, rather than a
durable message queue. A terminated process can lose a send; resending is the
recovery path. Resend configuration and real mailbox delivery must be validated
with the deployed sender domain; local checks use terminal previews.

## Validation

- `tests/auth-recovery.test.cjs` covers hashes, format, purpose binding, expiry,
  concurrent single-use consumption, rollback, email binding, resend replacement,
  enumeration-safe scheduling, persistent cooldowns, verified/unverified login,
  credential-change re-verification, one-time backfill, templates and HTTP delivery.
- Existing auth, Account Security and admin tests cover current password checks,
  session rotation, rollback, role hierarchy, and login/credential-change races.
- `scripts/check-auth-recovery.cjs` exercises real signup, soft-verification login,
  verification/replay, resend cooldown, email-change re-verification, reset,
  password confirmation errors, old-password rejection, new-password login,
  expired/reused links, generic unknown-account responses and mobile layout in
  both themes. It creates and removes only unique `example.invalid` accounts,
  and compares original credentials, timestamps and sessions before and after.

Completed validation for this rollout: all 71 unit-test files passed, including
13 new recovery tests; production build and TypeScript checks passed. ESLint
reported zero errors and three existing warnings in unrelated files. The full
browser check passed in both themes at desktop and 390px mobile width, with no
browser runtime errors, and preserved all seven original accounts and session
records. The pre-rollout credential fingerprint matched after the backfill.
Response checks confirmed no-store, no-referrer and noindex recovery headers.
Browser findings also fixed the streamed member badge's Fantasy hydration
mismatch and prevented consumed-token warnings from appearing beside success.

To run the browser check, install Playwright separately or set
`PLAYWRIGHT_MODULE` to an existing installation. Start a development server with
`APP_URL` matching `AUTH_BROWSER_BASE_URL`, `RESEND_API_KEY=''`, and server output
redirected to `AUTH_BROWSER_SERVER_LOG`. The default base is
`http://localhost:3011`; default server log is `/tmp/backlog-auth-dev.log`.
Screenshots and the result report go to `/tmp/backlog-auth-browser` by default.

Design references: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
and [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email).
