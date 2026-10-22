export type LayoutMode = "cyberpunk" | "fantasy";
export type CyberpunkTheme = "default" | "halloween";
export type Appearance = { layoutMode: LayoutMode; cyberpunkTheme: CyberpunkTheme };

type RootAttributes = { layoutMode?: string; cyberpunkTheme?: string; theme?: string };

export function readAppearance(root: RootAttributes): Appearance {
  let layoutMode: LayoutMode = root.layoutMode === "fantasy" ? "fantasy" : "cyberpunk";
  let cyberpunkTheme: CyberpunkTheme = root.cyberpunkTheme === "halloween" || root.theme === "halloween" ? "halloween" : "default";
  try {
    layoutMode = localStorage.getItem("backlogbuster:layout-mode") === "fantasy" ? "fantasy" : "cyberpunk";
    cyberpunkTheme = localStorage.getItem("backlogbuster:theme") === "halloween" ? "halloween" : "default";
  } catch { /* Keep root/in-memory preferences when storage is unavailable. */ }
  return { layoutMode, cyberpunkTheme };
}

export function applyAppearance(root: RootAttributes, appearance: Appearance) {
  root.layoutMode = appearance.layoutMode;
  root.cyberpunkTheme = appearance.cyberpunkTheme;
  root.theme = appearance.layoutMode === "fantasy" ? "fantasy" : appearance.cyberpunkTheme === "halloween" ? "halloween" : "cyberpunk";
}

// Runs before paint; keep storage keys and normalization aligned with readAppearance.
export const appearanceStartupScript = `try{var r=document.documentElement.dataset;r.layoutMode=localStorage.getItem("backlogbuster:layout-mode")==="fantasy"?"fantasy":"cyberpunk";r.cyberpunkTheme=localStorage.getItem("backlogbuster:theme")==="halloween"?"halloween":"default";r.theme=r.layoutMode==="fantasy"?"fantasy":r.cyberpunkTheme==="halloween"?"halloween":"cyberpunk"}catch{}`;
