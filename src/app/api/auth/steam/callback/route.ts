import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createPlayerSession } from "@/lib/auth-session";
import { clearSteamContext, consumeSteamContext, fetchSteamPersona, resolveSteamPlayer, verifySteamAssertion } from "@/lib/steam-openid";
import { logSteamAuthFailure, steamAuthStep } from "@/lib/steam-openid-diagnostics";
import { googleOAuthOrigin as publicAuthOrigin } from "@/lib/google-oauth-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let origin: string | undefined;
  let destination = "/";
  let stage = "origin_resolution";
  try {
    origin = publicAuthOrigin(request.url, request.headers);
    stage = "consume_state";
    const context = await consumeSteamContext(request.url, request.headers);
    stage = "verify_assertion";
    const steamId = await verifySteamAssertion(url.searchParams, context);
    stage = "profile_lookup";
    const persona = await fetchSteamPersona(steamId);
    stage = "create_session";
    await createPlayerSession(tx => steamAuthStep("account_resolution", () => resolveSteamPlayer(tx, steamId, persona, context)));
    stage = "revalidate";
    revalidatePath("/", "layout");
    if (context.mode === "link") destination = "/steam-auth?status=linked";
  } catch (error) {
    destination = `/steam-auth?status=${logSteamAuthFailure(error, "callback", stage)}`;
  }
  try { await clearSteamContext(); }
  catch (error) { logSteamAuthFailure(error, "callback", "clear_cookie"); }
  return NextResponse.redirect(new URL(destination, origin ?? url.origin), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
