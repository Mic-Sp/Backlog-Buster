import "server-only";

import { GoogleOAuthError } from "@/lib/google-oauth-diagnostics";

function checkedOrigin(value: string, failure: string): string {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error();
    return url.origin;
  } catch { throw new GoogleOAuthError("unavailable", failure, { stage: "origin_resolution" }); }
}

/** Public proxy origin, independently of APP_URL, for canonical entry redirects. */
export function googleRequestOrigin(requestUrl: string, requestHeaders?: Headers): string {
  const host = requestHeaders?.get("x-forwarded-host") ?? requestHeaders?.get("host");
  const proto = requestHeaders?.get("x-forwarded-proto");
  if (host !== null && host !== undefined) {
    // Vercel supplies a single host/protocol. Reject ambiguous lists, credentials,
    // paths and control characters rather than interpreting them as redirect URLs.
    if (!host || /[\s\\/@?#,]/.test(host) || [...host].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || (proto !== null && proto !== undefined && !["https", "http"].includes(proto))) {
      throw new GoogleOAuthError("unavailable", "invalid_forwarded_origin", { stage: "origin_resolution" });
    }
    return checkedOrigin(`${proto ?? new URL(requestUrl).protocol.slice(0, -1)}://${host}`, "invalid_forwarded_origin");
  }
  return checkedOrigin(requestUrl, "invalid_request_origin");
}

/** One precedence rule for authorization, callback validation and final redirects. */
export function googleOAuthOrigin(requestUrl: string, requestHeaders?: Headers): string {
  const configured = process.env.APP_URL?.trim();
  return configured ? checkedOrigin(configured, "invalid_app_url") : googleRequestOrigin(requestUrl, requestHeaders);
}
