import type { DiscoveredPlayer, ProfileVisibility, RelationshipState } from "@/lib/friendship-types";

export type SocialConnection = DiscoveredPlayer & { relationship: RelationshipState; canViewProfile: boolean };
export type SocialOverview = {
  viewerId: string; profileVisibility: ProfileVisibility; connections: SocialConnection[]; truncated: boolean;
};
export type IncomingFriendRequest = {
  id: string;
  requester: Pick<DiscoveredPlayer, "id" | "operatorName" | "handle">;
};
export type IncomingFriendRequests = { viewerId: string; total: number; requests: IncomingFriendRequest[] };
export type CoopParticipant = { playerId: string; operatorName: string; handle: string | null; platform: string; status: string; hoursPlayed: number };
export type CoopMatch = {
  key: string; title: string; releaseYear: number | null; coverUrl: string | null;
  capabilities: string[]; capability: "coop" | "multiplayer" | "unknown";
  samePlatform: boolean; participants: CoopParticipant[];
};
export type CoopMatches = { games: CoopMatch[]; total: number };
export type DossierSocialContext = { target: DiscoveredPlayer; relationship: RelationshipState | "self" };
