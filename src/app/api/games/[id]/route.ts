import { revalidatePath } from "next/cache";
import { gameHypePatchSchema } from "@/lib/game-mutation-schema";
import { AuthenticationRequiredError, getAuthenticatedPlayerId } from "@/lib/player";
import { googleOAuthOrigin as publicAuthOrigin } from "@/lib/google-oauth-origin";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store" };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== publicAuthOrigin(request.url, request.headers)) || request.headers.get("sec-fetch-site") === "cross-site") {
      return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
    }
    const userId = await getAuthenticatedPlayerId();
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id) || id > 2147483647) {
      return Response.json({ error: "Choose a valid game." }, { status: 400, headers });
    }
    const parsed = gameHypePatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Provide a hypeLevel integer from 1 to 3." }, { status: 400, headers });
    }
    // Scope the write itself to the session owner; no client-supplied user IDs.
    const game = await prisma.game.update({
      where: { id, userId }, data: parsed.data, select: { id: true, hypeLevel: true },
    });
    revalidatePath("/");
    return Response.json({ game }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json({ error: "Sign in to access your library." }, { status: 401, headers });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return Response.json({ error: "Game not found." }, { status: 404, headers });
    }
    return Response.json({ error: "Could not save your changes. Please try again." }, { status: 503, headers });
  }
}
