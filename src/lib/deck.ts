export const DECK_CAPACITY = 3;
export const DECK_DRAG_TYPE = "application/x-backlogbuster-deck-game";
export type DeckDragGame = { gameId: number; source: "table" | "deck" };

export function readDeckDrag(dataTransfer: DataTransfer): DeckDragGame | null {
  try {
    const value: unknown = JSON.parse(dataTransfer.getData(DECK_DRAG_TYPE));
    if (!value || typeof value !== "object" || !("gameId" in value) || !("source" in value)) return null;
    if (typeof value.gameId !== "number" || !Number.isSafeInteger(value.gameId) || value.gameId < 1 || value.gameId > 2147483647) return null;
    if (value.source !== "table" && value.source !== "deck") return null;
    return { gameId: value.gameId, source: value.source };
  } catch {
    return null;
  }
}
