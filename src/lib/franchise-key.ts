/** Stable shared metadata key; punctuation/case/spacing never create separate caches. */
export function normalizeFranchiseKey(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
    .replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
