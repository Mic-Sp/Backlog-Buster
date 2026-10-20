// Public profile fields only. Authentication credentials never cross the server boundary.
export type PlayerProfile = {
  id: string;
  operatorName: string;
  tagline: string;
  neonAccent: "CYAN" | "GOLD" | "MAGENTA";
  avatarUrl: string | null;
  featuredTrophyIds: (number | null)[];
  updatedAt: string;
};

export type PlayerProfileInput = {
  operatorName: string;
  tagline: string;
  neonAccent: PlayerProfile["neonAccent"];
  featuredTrophyIds: (number | null)[];
  avatarUrl?: string | null;
};
