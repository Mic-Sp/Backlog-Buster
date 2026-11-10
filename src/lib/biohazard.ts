export const safeRoomModes = [
  { key: "box", label: "ITEM BOX" },
  { key: "equipped", label: "EQUIPPED / QUICK SLOTS" },
  { key: "files", label: "FILES & LOGS" },
  { key: "radar", label: "FIELD RECON / RADAR" },
  { key: "save", label: "TYPEWRITER // SAVE" },
] as const;
export type SafeRoomMode = typeof safeRoomModes[number]["key"];

/** Workload indicator, never a claim about the player's real health. */
export function operativeCondition(activeGames: number): "FINE" | "CAUTION" | "DANGER" {
  return activeGames >= 6 ? "DANGER" : activeGames >= 3 ? "CAUTION" : "FINE";
}
