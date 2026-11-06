// Public profile fields only. Authentication credentials never cross the server boundary.
import type { ProfileVisibility } from "@/lib/friendship-types";

export type PlayerProfile = {
  id: string;
  operatorName: string;
  handle: string | null;
  profileVisibility: ProfileVisibility;
  tagline: string;
  neonAccent: "CYAN" | "GOLD" | "MAGENTA";
  preferredLayoutMode: "cyberpunk" | "fantasy";
  avatarUrl: string | null;
  // Ordered profile favorites, independent of Game.pinnedOrder. Null = automatic trophy.
  featuredTrophyIds: (number | null)[];
  updatedAt: string;
};

export type PlayerProfileInput = {
  handle?: string | null;
  operatorName: string;
  tagline: string;
  neonAccent: PlayerProfile["neonAccent"];
  featuredTrophyIds: (number | null)[];
  avatarUrl?: string | null;
};
