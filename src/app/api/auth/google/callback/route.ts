import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createPlayerSession } from "@/lib/auth-session";
import { clearGoogleContext, consumeGoogleContext, exchangeGoogleCode, GoogleOAuthError, resolveGooglePlayer } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let destination = "/";
  try {
    const context = await consumeGoogleContext(request.url);
    if (url.searchParams.has("error")) throw new GoogleOAuthError("cancelled");
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096) throw new GoogleOAuthError("failed");
    const profile = await exchangeGoogleCode(code, context);
    await createPlayerSession(tx => resolveGooglePlayer(tx, profile, context));
    revalidatePath("/", "layout");
    if (context.mode === "link") destination = "/google-auth?status=linked";
  } catch (error) {
    const reason = error instanceof GoogleOAuthError ? error.reason : "failed";
    destination = `/google-auth?status=${reason}`;
  }
  await clearGoogleContext();
  return NextResponse.redirect(new URL(destination, request.url), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
