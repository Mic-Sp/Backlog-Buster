import type { Achievement } from "@/lib/achievements";
import type { PlayerProfile } from "@/lib/player-profile-types";

export type DossierGame = { id: number; title: string; platform: string; coverUrl: string | null; earnedXp: number; review?: string | null; reviewSpoiler?: boolean };
export type DossierData = {
  profile: PlayerProfile;
  level: number;
  totalXp: number;
  counts: { Backlog: number; Playing: number; Completed: number; Flatlined: number };
  activeHours: number;
  completionRate: number;
  avgRating: number | null;
  achievements: Achievement[];
  trophies: DossierGame[];
  // All owned choices locally; only displayed tiles on the public DTO.
  showcaseGames?: DossierGame[];
};

export type DossierCardData = Omit<DossierData, "profile">;

export const dossierAccents = { cyan: "#00f0ff", gold: "#fcee0a", magenta: "#ff2a6d" } as const;
export type DossierAccent = keyof typeof dossierAccents;
export type DossierIdentity = { avatarUrl: string | null; handle: string; callsign: string; tagline: string; accent: DossierAccent; showcase: (number | null)[] };

export function getStreetCred(level: number) {
  if (level >= 15) return "Night City Legend";
  if (level >= 10) return "Afterlife Elite";
  if (level >= 6) return "Veteran Netrunner";
  if (level >= 3) return "Chrome Runner";
  return "Street Kid";
}

export const DOSSIER_SHOWCASE_CAPACITY = 3;

/** Keep declared favorites separate from automatic tiles, including during saves. */
export function resolveDossierShowcase(selections: readonly unknown[], games: readonly DossierGame[], trophies: readonly DossierGame[]) {
  const used = new Set<number>();
  const slots = Array.from({ length: DOSSIER_SHOWCASE_CAPACITY }, (_, index) => {
    const game = games.find(game => game.id === selections[index]);
    if (!game || used.has(game.id)) return null;
    used.add(game.id);
    return { game, pinned: true };
  });
  return slots.map(slot => {
    if (slot) return slot;
    const game = trophies.find(game => !used.has(game.id));
    if (!game) return null;
    used.add(game.id);
    return { game, pinned: false };
  });
}

export function defaultDossierIdentity(): DossierIdentity {
  return { avatarUrl: null, handle: "", callsign: "ANONYMOUS NETRUNNER", tagline: "One more gig. One more legend.", accent: "cyan", showcase: Array(DOSSIER_SHOWCASE_CAPACITY).fill(null) };
}

export function readDossierIdentity(value: unknown, games: DossierGame[]): DossierIdentity {
  const defaults = defaultDossierIdentity();
  if (!value || typeof value !== "object") return defaults;
  const saved = value as Record<string, unknown>;
  const ids = new Set(games.map((game) => game.id));
  const used = new Set<number>();
  const selections = Array.isArray(saved.showcase) ? saved.showcase : defaults.showcase;
  return {
    avatarUrl: typeof saved.avatarUrl === "string" ? saved.avatarUrl.trim() || null : null,
    handle: typeof saved.handle === "string" ? saved.handle.trim().toLowerCase() : "",
    callsign: typeof saved.callsign === "string" ? saved.callsign.trim().slice(0, 28) || defaults.callsign : defaults.callsign,
    tagline: typeof saved.tagline === "string" ? saved.tagline.trim().slice(0, 64) || defaults.tagline : defaults.tagline,
    accent: typeof saved.accent === "string" && Object.hasOwn(dossierAccents, saved.accent) ? saved.accent as DossierAccent : defaults.accent,
    showcase: Array.from({ length: 3 }, (_, index) => {
      const id: unknown = selections[index];
      if (typeof id !== "number" || !ids.has(id) || used.has(id)) return null;
      used.add(id);
      return id;
    }),
  };
}

export function dossierIdentityFromProfile(profile: Pick<PlayerProfile, "operatorName" | "handle" | "tagline" | "neonAccent" | "avatarUrl" | "featuredTrophyIds">, games: DossierGame[]): DossierIdentity {
  return readDossierIdentity({
    avatarUrl: profile.avatarUrl, handle: profile.handle, callsign: profile.operatorName, tagline: profile.tagline, accent: profile.neonAccent.toLowerCase(),
    showcase: profile.featuredTrophyIds.length ? profile.featuredTrophyIds : undefined,
  }, games);
}

export function dossierTitleLines(title: string, limit = 29): string[] {
  const words = title.trim().split(/\s+/);
  const lines = [""];
  for (const word of words) {
    const last = lines.length - 1;
    if (lines[last] && `${lines[last]} ${word}`.length > limit) lines.push(word);
    else lines[last] = `${lines[last]} ${word}`.trim();
  }
  return lines.slice(0, 2).map((line, index) => line.length > limit || (index === 1 && lines.length > 2) ? `${line.slice(0, limit - 1)}…` : line);
}
