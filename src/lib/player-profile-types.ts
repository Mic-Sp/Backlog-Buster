// Public profile fields only. Authentication credentials never cross the server boundary.
export type PlayerProfile = {
  id: string;
  operatorName: string;
  handle: string | null;
  tagline: string;
  neonAccent: "CYAN" | "GOLD" | "MAGENTA";
  preferredLayoutMode: "cyberpunk" | "fantasy";
  avatarUrl: string | null;
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
