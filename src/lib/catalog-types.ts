/** Public catalog metadata; no library state or provider credentials. */
export type CatalogSuggestion = {
  title: string;
  releaseYear: number | null;
  platforms: string[];
  genre: string | null;
  estimatedHours: number | null;
  coverUrl: string | null;
};

/** Server catalog ingestion only. Project to CatalogSuggestion before returning autocomplete results. */
export type ProviderCatalogGame = CatalogSuggestion & {
  metadataSource?: "rawg" | "igdb";
  igdbId?: number;
  rawgId: number | null;
  rawgSlug: string | null;
  genres: string[];
  tags: string[];
  seriesHints: string[];
  multiplayer: boolean | null;
  coop: boolean | null;
  onlineCoop: boolean | null;
  localCoop: boolean | null;
};
