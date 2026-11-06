export function isReleasedYear(releaseYear: number | null | undefined, currentYear = new Date().getFullYear()): releaseYear is number {
  return typeof releaseYear === "number" && Number.isInteger(releaseYear) && releaseYear > 0 && releaseYear <= currentYear;
}

/** Owned games with missing dates remain playable; only an explicit future year seals them. */
export function isUnreleasedYear(releaseYear: number | null | undefined, currentYear = new Date().getFullYear()): boolean {
  return typeof releaseYear === "number" && Number.isFinite(releaseYear) && releaseYear > currentYear;
}
