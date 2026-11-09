"use client";

import { useUIEffects } from "@/components/ThemeProvider";
import type { ThemeTermKey } from "@/lib/custom-theme";

/** Presentation copy changes without remounting the controller or altering saved data. */
export function useLayoutCopy() {
  const { layoutMode, customTheme } = useUIEffects();
  return (cyberpunk: string, fantasy: string, term?: ThemeTermKey) => {
    const key = term ?? (cyberpunk === "Netrunner Access" ? "authTitle" : undefined);
    return (key ? customTheme?.terminology[key]?.trim() : "") || (layoutMode === "fantasy" ? fantasy : cyberpunk);
  };
}

export default function LayoutText({ cyberpunk, fantasy, term }: { cyberpunk: string; fantasy: string; term?: ThemeTermKey }) {
  const copy = useLayoutCopy();
  return copy(cyberpunk, fantasy, term);
}
