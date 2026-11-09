import { requireVaultSession } from "@/lib/library-vault";
import { getSteamAuthSyncView, runSteamAuthSync } from "@/lib/steam-auth-sync";
import { googleOAuthOrigin as publicAuthOrigin } from "@/lib/google-oauth-origin";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const auth = error instanceof Error && /Sign in|session expired/.test(error.message);
  return Response.json({ error: auth ? "Sign in again to sync your Steam library." : "Steam library sync is temporarily unavailable. Please retry." }, { status: auth ? 401 : 503, headers });
}
export async function GET() {
  try { const { player } = await requireVaultSession(); return Response.json({ sync: await getSteamAuthSyncView(player.id) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== publicAuthOrigin(request.url, request.headers)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
    const input = await request.json().catch(() => null);
    if (!input || typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(input.requestId) || (input.retry !== undefined && typeof input.retry !== "boolean")) {
      return Response.json({ error: "Invalid sync request." }, { status: 400, headers });
    }
    const { player, tokenHash } = await requireVaultSession();
    return Response.json({ sync: await runSteamAuthSync({ userId: player.id, tokenHash }, input.requestId, input.retry === true) }, { headers });
  } catch (error) { return failure(error); }
}
