/** Public catalog metadata; no library state or provider credentials. */
export type CatalogSuggestion = {
  title: string;
  releaseYear: number | null;
  platforms: string[];
  genre: string | null;
  estimatedHours: number | null;
  coverUrl: string | null;
};
