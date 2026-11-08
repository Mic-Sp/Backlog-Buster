import type { Achievement } from "@/lib/achievements";

export function achievementPersona(achievement: Pick<Achievement, "key" | "title" | "description" | "icon">, fantasy: boolean) {
  return fantasy && achievement.key === "new-game-plus"
    ? { ...achievement, title: "The Eternal Return · New Game+", description: "Chronicle a second journey through any quest.", icon: "✧" }
    : achievement;
}
