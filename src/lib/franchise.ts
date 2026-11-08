import { baseChronologyTitle, normalizeChronologyTitle } from "@/lib/chronology-titles";
import { normalizeFranchiseKey } from "@/lib/franchise-key";

export type FranchiseGame = { title: string; franchise?: string | null };

// Shared by client-side Saga Chains and server-side taste/eligibility. These
// aliases identify a franchise, never assert that two games tell the same story.
const knownSeries: [RegExp, string][] = [
  [/^(?:the )?legend of zelda\b|^zelda\b/, "Legend of Zelda"],
  [/^final fantasy\b|^ff\s*(?:\d+|[ivxl]+)\b/, "Final Fantasy"],
  [/^resident evil\b|^biohazard\b/, "Resident Evil"],
  [/^batman arkham\b/, "Batman: Arkham"],
  [/^alan wakes?\b/, "Alan Wake"],
  [/^kingdom hearts\b/, "Kingdom Hearts"],
  [/^star wars jedi\b/, "Star Wars Jedi"],
  [/^(?:the )?witcher\b/, "The Witcher"],
  [/^mass effect\b/, "Mass Effect"],
  [/^assassins creed\b/, "Assassin's Creed"],
  [/^super mario\b/, "Super Mario"],
  [/^mario kart\b/, "Mario Kart"],
  [/^metroid\b/, "Metroid"],
  [/^(?:the )?last of us\b/, "The Last of Us"],
  [/^yakuza\b|^like a dragon\b/, "Yakuza / Like a Dragon"],
];

export function getFranchiseName(game: FranchiseGame): string | null {
  const manual = game.franchise?.trim().replace(/\s+/g, " ");
  if (manual) {
    // Canonicalize known franchise aliases while retaining literal custom names.
    const key = normalizeFranchiseKey(manual).replace(/-/g, " ");
    const alias = knownSeries.find(([pattern, name]) => pattern.test(key) &&
      (key === normalizeFranchiseKey(name).replace(/-/g, " ") ||
        ["zelda", "the legend of zelda", "witcher", "biohazard", "yakuza", "like a dragon", "last of us"].includes(key)));
    return alias?.[1] ?? manual;
  }
  const base = baseChronologyTitle(game.title);
  const normalized = normalizeFranchiseKey(base).replace(/-/g, " ");
  const known = knownSeries.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];
  const stem = base.split(/[:：]|\s[-–—]\s/)[0];
  // Normalize Roman numerals with the same parser used for chronology matching.
  const numbered = normalizeChronologyTitle(stem).match(/^(.*?)\b-?\d+(?:-|$)/);
  const name = numbered ? stem.split(/\s+(?:\d|[ivxl]+\b)/i)[0].trim() : stem.trim();
  return normalizeFranchiseKey(name).length >= 2 ? name : null;
}

/** Keep Saga Chain's existing space-separated keys stable. */
export function gameLineage(game: FranchiseGame): string {
  return normalizeFranchiseKey(getFranchiseName(game) ?? game.title).replace(/-/g, " ");
}
