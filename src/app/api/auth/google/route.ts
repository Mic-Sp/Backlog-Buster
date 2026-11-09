import { NextResponse } from "next/server";
import { beginGoogleOAuth } from "@/lib/google-oauth";
import { logGoogleOAuthFailure } from "@/lib/google-oauth-diagnostics";
import { googleOAuthOrigin, googleRequestOrigin } from "@/lib/google-oauth-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let canonicalOrigin: string | undefined;
  let stage = "origin_resolution";
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    canonicalOrigin = googleOAuthOrigin(request.url, request.headers);
    // Move an entry on a preview/deployment host to APP_URL before setting a
    // host-only cookie. Proxy request.url differences alone must not cause loops.
    if (process.env.APP_URL?.trim() && (request.headers.has("x-forwarded-host") || request.headers.has("host")) && googleRequestOrigin(request.url, request.headers) !== canonicalOrigin) {
      return NextResponse.redirect(new URL(`/api/auth/google${url.search}`, canonicalOrigin), { headers });
    }
    stage = "begin_authorization";
    const mode = url.searchParams.get("mode") === "link" ? "link" : "signin";
    const layoutMode = url.searchParams.get("theme") === "fantasy" ? "fantasy" : "cyberpunk";
    return NextResponse.redirect(await beginGoogleOAuth(request.url, mode, layoutMode, request.headers), { headers });
  } catch (error) {
    const reason = logGoogleOAuthFailure(error, { route: "authorize", stage, requestUrl: request.url, canonicalOrigin });
    return NextResponse.redirect(new URL(`/google-auth?status=${reason}`, canonicalOrigin ?? url.origin), { headers });
  }
}
