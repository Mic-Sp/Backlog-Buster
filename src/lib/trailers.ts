export function buildTrailerUrl(title: string, releaseYear?: number | null) {
  const query = `${title}${releaseYear ?? ""} official game trailer`.trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
