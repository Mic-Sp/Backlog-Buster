import { NextResponse } from "next/server";
import { beginGoogleOAuth, GoogleOAuthError } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const mode = url.searchParams.get("mode") === "link" ? "link" : "signin";
    const layoutMode = url.searchParams.get("theme") === "fantasy" ? "fantasy" : "cyberpunk";
    return NextResponse.redirect(await beginGoogleOAuth(request.url, mode, layoutMode), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const reason = error instanceof GoogleOAuthError ? error.reason : "failed";
    return NextResponse.redirect(new URL(`/google-auth?status=${reason}`, request.url), { headers: { "Cache-Control": "no-store" } });
  }
}
