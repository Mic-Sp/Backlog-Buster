import { feedbackSchema } from "@/lib/feedback-schema";
import { consumeFeedbackAttempt, deliverFeedback, feedbackIdentity } from "@/lib/feedback";

const maxBodyBytes = 20_000;

function reply(body: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}

function requestOrigin(request: Request): string | null {
  const url = new URL(request.url);
  // Next's internal URL can use localhost/an upstream host. Compare with the
  // public origin, following the app's existing auth proxy convention.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  if (!host || /[\s\\/@?#,\u0000-\u001f\u007f]/.test(host) || !["http", "https"].includes(protocol)) return null;
  try { return new URL(`${protocol}://${host}`).origin; }
  catch { return null; }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = requestOrigin(request);
  // This public endpoint accepts anonymous reports but never cross-site posts.
  if (!expectedOrigin || (origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "Please send feedback from this app." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply({ error: "Send feedback as JSON." }, 415);
  }
  if (Number(request.headers.get("content-length")) > maxBodyBytes) return reply({ error: "Feedback is too large." }, 413);

  let raw: unknown;
  try {
    // Bound streamed bodies too; Content-Length is optional and untrusted.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Feedback is required." }, 400);
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBodyBytes) {
          await reader.cancel();
          return reply({ error: "Feedback is too large." }, 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      raw = JSON.parse(text + decoder.decode());
    } finally { reader.releaseLock(); }
  } catch { return reply({ error: "Feedback must be valid JSON." }, 400); }

  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) return reply({ error: "Choose a category and include 10–3000 characters with a valid page path." }, 400);
  try {
    const identity = await feedbackIdentity();
    const retryAfter = await consumeFeedbackAttempt(request.headers, identity?.userId);
    if (retryAfter) return reply({ error: "You’ve sent several reports. Please try again after the cooldown." }, 429, { "Retry-After": String(retryAfter) });
    const id = await deliverFeedback(parsed.data, identity);
    return reply({ ok: true, id }, 201);
  } catch {
    console.error("[beta-feedback] Submission unavailable; no report acknowledged.");
    return reply({ error: "Feedback is unavailable right now. Your draft is safe; please try again." }, 503);
  }
}
