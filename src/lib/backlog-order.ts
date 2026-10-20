type BacklogPriorityGame = {
  id: number;
  pinnedOrder: number | null;
  backlogOrder: number | null;
  createdAt: string | Date;
};

export function compareBacklogPriority(left: BacklogPriorityGame, right: BacklogPriorityGame) {
  if (left.pinnedOrder != null || right.pinnedOrder != null) {
    if (left.pinnedOrder == null) return 1;
    if (right.pinnedOrder == null) return -1;
    const slotDifference = left.pinnedOrder - right.pinnedOrder;
    if (slotDifference) return slotDifference;
  }
  if (left.backlogOrder != null || right.backlogOrder != null) {
    if (left.backlogOrder == null) return 1;
    if (right.backlogOrder == null) return -1;
    const priorityDifference = left.backlogOrder - right.backlogOrder;
    if (priorityDifference) return priorityDifference;
  }
  // Keep the library's newest-first order for games without a custom priority.
  const createdTime = (value: string | Date) => typeof value === "string" ? Date.parse(value) : value.getTime();
  return createdTime(right.createdAt) - createdTime(left.createdAt) || right.id - left.id;
}

export function getBacklogInsertionOrder(games: (BacklogPriorityGame & { status: string })[], gameId: number, beforeGameId: number) {
  const ids = games.filter((game) => game.status === "Backlog" && game.pinnedOrder == null && game.id !== gameId)
    .sort(compareBacklogPriority).map((game) => game.id);
  const target = ids.indexOf(beforeGameId);
  if (target < 0) throw new Error("This Backlog position is no longer available. Refresh and try again.");
  ids.splice(target, 0, gameId);
  return ids;
}
