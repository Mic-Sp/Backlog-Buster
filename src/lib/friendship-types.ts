export const profileVisibilities = ["public", "friends", "private"] as const;
export type ProfileVisibility = typeof profileVisibilities[number];
export type RelationshipState = "none" | "incoming" | "outgoing" | "friends" | "blocked";
export type RelationshipResult = { playerId: string; relationship: RelationshipState };
export type DiscoveredPlayer = { id: string; handle: string | null; operatorName: string; avatarUrl: string | null };
