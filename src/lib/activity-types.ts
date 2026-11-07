export type GameActivityMetadata = { title: string; platform: string; rating?: number; review?: string; reviewSpoiler?: boolean };
export type AchievementActivityMetadata = { achievementKey: string; title: string };
export type ImportActivityMetadata = { source: "backup" | "titles"; importedCount: number };
export type ActivityPayload =
  | { type: "game_started" | "game_completed" | "game_flatlined" | "rating_logged"; metadata: GameActivityMetadata }
  | { type: "achievement_unlocked"; metadata: AchievementActivityMetadata }
  | { type: "library_imported"; metadata: ImportActivityMetadata };
export type FriendActivity = ActivityPayload & {
  id: string; createdAt: string;
  actor: { id: string; handle: string | null; operatorName: string; avatarUrl: string | null };
};
export type ActivityFeedCursor = { createdAt: string; id: string };
export type ActivityFeedPage = { items: FriendActivity[]; nextCursor: ActivityFeedCursor | null };
