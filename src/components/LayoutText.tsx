"use client";

import { useUIEffects } from "@/components/ThemeProvider";

/** Presentation copy changes without remounting the controller or altering saved data. */
export function useLayoutCopy() {
  const { layoutMode } = useUIEffects();
  return (cyberpunk: string, fantasy: string) => layoutMode === "fantasy" ? fantasy : cyberpunk;
}

export default function LayoutText({ cyberpunk, fantasy }: { cyberpunk: string; fantasy: string }) {
  const copy = useLayoutCopy();
  return copy(cyberpunk, fantasy);
}
