export function isReleasedYear(releaseYear: number | null | undefined, currentYear = new Date().getFullYear()): releaseYear is number {
  return typeof releaseYear === "number" && Number.isInteger(releaseYear) && releaseYear > 0 && releaseYear <= currentYear;
}
