# Beta feedback

The root layout mounts the feedback widget on every page. Reports accept Bug,
Feature Idea, or Other and 10–3,000 trimmed characters. Closing the dialog keeps
the draft in memory; a successful submission clears it after 2.2 seconds. Drafts
do not survive a full reload. Closing during submission does not cancel delivery.

Set `FEEDBACK_EMAIL_TO` to the team's inbox to send plain-text alerts through
the existing `RESEND_API_KEY` and `EMAIL_FROM`. No webhook, new dependency, or
schema migration is required. If any setting is absent or email delivery fails,
the API acknowledges the report after writing a JSON record under
`[beta-feedback]` in server logs. Collect and retain those logs in the hosting
platform if using this fallback; it is not a database or a review inbox.

Context contains only the pathname (no query or hash), user agent, viewport,
and authenticated account ID/email, resolved from the server-side session.
Cookie values, bearer tokens, and raw IP addresses are never added to reports.
Treat report logs as private because they may include user-entered content and
email addresses. The form explains what is included before submission.

`POST /api/feedback` requires JSON and rejects cross-origin requests, unknown
fields, invalid categories, invalid pathname/metadata, and oversized bodies
(20 KB, enforced on the stream). Identity fields supplied by the client are
rejected. Validation failures return 400; cross-origin requests 403; oversized
bodies 413; unsupported content types 415. Successful reports return 201.

Spam protection uses independent `feedback:` buckets in the existing
`AuthRateLimit` table: five attempts per account/IP and 100 globally per ten
minutes. Anonymous IP buckets use a digest of the proxy address; configure the
deployment proxy to overwrite forwarded headers. The global cap remains in
effect regardless of caller-supplied addresses. A 429 includes `Retry-After`.
If no database is configured, bounded process-local buckets apply instead;
these reset on restart and are not shared across instances. With a configured
database, database/session failures return 503 and preserve the browser draft.

Native modal dialogs make the background inert. The form also cycles keyboard
focus, handles Escape/backdrop dismissal, restores trigger focus and scroll
position, and respects reduced motion. The trigger yields to existing dialogs
and notifications; mobile positioning includes clearance for bottom navigation
and device safe areas. A bottom scroll allowance keeps final page actions
reachable above the trigger.
