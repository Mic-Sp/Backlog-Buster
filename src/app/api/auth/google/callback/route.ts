import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createPlayerSession } from "@/lib/auth-session";
import { clearGoogleContext, consumeGoogleContext, exchangeGoogleCode, GoogleOAuthError, resolveGooglePlayer } from "@/lib/google-oauth";
import { googleOAuthStep, logGoogleOAuthFailure, safeGoogleProviderError } from "@/lib/google-oauth-diagnostics";
import { googleOAuthOrigin } from "@/lib/google-oauth-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let destination = "/";
  let canonicalOrigin: string | undefined;
  let stage = "origin_resolution";
  try {
    canonicalOrigin = googleOAuthOrigin(request.url, request.headers);
    stage = "consume_state";
    const context = await consumeGoogleContext(request.url, request.headers);
    stage = "provider_callback";
    if (url.searchParams.has("error")) throw new GoogleOAuthError("cancelled", "provider_authorization_rejected", { providerError: safeGoogleProviderError(url.searchParams.get("error")) });
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096) throw new GoogleOAuthError("failed", "missing_or_invalid_authorization_code");
    stage = "exchange_code";
    const profile = await exchangeGoogleCode(code, context);
    stage = "create_session";
    await createPlayerSession(tx => googleOAuthStep("account_resolution", () => resolveGooglePlayer(tx, profile, context)));
    stage = "revalidate";
    revalidatePath("/", "layout");
    if (context.mode === "link") destination = "/google-auth?status=linked";
  } catch (error) {
    const reason = logGoogleOAuthFailure(error, { route: "callback", stage, requestUrl: request.url, canonicalOrigin });
    destination = `/google-auth?status=${reason}`;
  }
  try { await clearGoogleContext(); }
  catch (error) { logGoogleOAuthFailure(error, { route: "callback", stage: "clear_cookie", requestUrl: request.url, canonicalOrigin }); }
  return NextResponse.redirect(new URL(destination, canonicalOrigin ?? url.origin), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
