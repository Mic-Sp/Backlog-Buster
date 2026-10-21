import { getCurrentPlayer } from "@/lib/player";
import { fetchDossierArtwork } from "@/lib/dossier-artwork";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };

export async function POST(request: Request) {
  try {
    if (!await getCurrentPlayer()) return Response.json({ error: "Sign in to load dossier artwork." }, { status: 401, headers });
    if (Number(request.headers.get("content-length")) > 4096) return Response.json({ error: "Artwork request is too long." }, { status: 413, headers });
    // Bound streamed input as well as Content-Length (which callers may omit).
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Provide an artwork URL." }, { status: 400, headers });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return Response.json({ error: "Artwork request is too long." }, { status: 413, headers }); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return Response.json({ error: "Provide a valid artwork request." }, { status: 400, headers }); }
    const url = body && typeof body === "object" && "url" in body ? body.url : null;
    const artwork = await fetchDossierArtwork(url);
    return new Response(new Uint8Array(artwork.bytes), { headers: { ...headers, "Content-Type": artwork.contentType, "Content-Length": String(artwork.bytes.length) } });
  } catch {
    return Response.json({ error: "Artwork unavailable. Your dossier will use its fallback artwork." }, { status: 502, headers });
  }
}
