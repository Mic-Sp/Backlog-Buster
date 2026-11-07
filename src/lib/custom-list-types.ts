export const MAX_CUSTOM_LISTS = 20;
export const MAX_CUSTOM_LIST_GAMES = 50;
export type CustomListFields = { title: string; description: string | null; isRanked: boolean; isPublic: boolean };
export type CustomListData = CustomListFields & { id: string; revision: number; gameIds: number[] };
export type CustomListCommand =
  | ({ type: "create" } & CustomListFields)
  | ({ type: "update"; id: string; revision: number } & CustomListFields)
  | { type: "delete"; id: string; revision: number }
  | { type: "add" | "remove"; id: string; revision: number; gameId: number }
  | { type: "reorder"; id: string; revision: number; gameIds: number[] };
export type PublicCustomList = CustomListFields & { id: string; games: { title: string; platform: string; coverUrl: string | null }[] };
