import { NextResponse } from "next/server";
import { beginSteamOpenID } from "@/lib/steam-openid";
import { logSteamAuthFailure } from "@/lib/steam-openid-diagnostics";
import { googleOAuthOrigin as publicAuthOrigin, googleRequestOrigin as publicRequestOrigin } from "@/lib/google-oauth-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let origin: string | undefined;
  let stage = "origin_resolution";
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    origin = publicAuthOrigin(request.url, request.headers);
    if (process.env.APP_URL?.trim() && (request.headers.has("x-forwarded-host") || request.headers.has("host")) && publicRequestOrigin(request.url, request.headers) !== origin) {
      return NextResponse.redirect(new URL(`/api/auth/steam${url.search}`, origin), { headers });
    }
    stage = "begin_authorization";
    return NextResponse.redirect(await beginSteamOpenID(request.url, url.searchParams.get("mode") === "link" ? "link" : "signin",
      url.searchParams.get("theme") === "fantasy" ? "fantasy" : "cyberpunk", request.headers), { headers });
  } catch (error) {
    const status = logSteamAuthFailure(error, "authorize", stage);
    return NextResponse.redirect(new URL(`/steam-auth?status=${status}`, origin ?? url.origin), { headers });
  }
}
