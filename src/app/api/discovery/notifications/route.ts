import { getOptionalAuthenticatedPlayerId } from "@/lib/player";
import { readDiscoveryNotifications } from "@/lib/discovery-personalization";

/** Cache-only polling: never starts an IGDB/RAWG refresh, even on a cold cache. */
export async function GET() {
  try {
    const userId = await getOptionalAuthenticatedPlayerId();
    return Response.json(userId ? await readDiscoveryNotifications(userId) : { unseenCount: 0 },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ unseenCount: 0 }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
