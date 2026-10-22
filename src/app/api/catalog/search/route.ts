import { searchCatalog } from "@/lib/catalog-search";
import { getAuthenticatedPlayerId } from "@/lib/player";

/** GET /api/catalog/search?q=portal -> CatalogSuggestion[] */
export async function GET(request: Request) {
  let suggestions = [] as Awaited<ReturnType<typeof searchCatalog>>;
  try {
    await getAuthenticatedPlayerId();
    suggestions = await searchCatalog(new URL(request.url).searchParams.get("q") ?? "");
  } catch { /* Authentication/storage/provider failures never block manual entry. */ }
  return Response.json(suggestions, { headers: { "Cache-Control": "no-store" } });
}
