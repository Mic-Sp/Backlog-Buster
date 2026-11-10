export type LayoutMode = "cyberpunk" | "fantasy" | "biohazard";
export function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "cyberpunk" || value === "fantasy" || value === "biohazard";
}
export function normalizeLayoutMode(value: unknown): LayoutMode {
  return isLayoutMode(value) ? value : "cyberpunk";
}
export type CyberpunkTheme = "default" | "halloween";
export type Appearance = { layoutMode: LayoutMode; cyberpunkTheme: CyberpunkTheme };

type RootAttributes = { layoutMode?: string; cyberpunkTheme?: string; theme?: string; playerLayout?: string };

export function readAppearance(root: RootAttributes): Appearance {
  let layoutMode: LayoutMode = normalizeLayoutMode(root.layoutMode);
  let cyberpunkTheme: CyberpunkTheme = root.cyberpunkTheme === "halloween" || root.theme === "halloween" ? "halloween" : "default";
  try {
    layoutMode = normalizeLayoutMode(localStorage.getItem("backlogbuster:layout-mode"));
    cyberpunkTheme = localStorage.getItem("backlogbuster:theme") === "halloween" ? "halloween" : "default";
  } catch { /* Keep root/in-memory preferences when storage is unavailable. */ }
  return { layoutMode: isLayoutMode(root.playerLayout) ? root.playerLayout : layoutMode, cyberpunkTheme };
}

export function applyAppearance(root: RootAttributes, appearance: Appearance) {
  const theme = appearance.layoutMode !== "cyberpunk" ? appearance.layoutMode : appearance.cyberpunkTheme === "halloween" ? "halloween" : "cyberpunk";
  if (root.layoutMode !== appearance.layoutMode) root.layoutMode = appearance.layoutMode;
  if (root.cyberpunkTheme !== appearance.cyberpunkTheme) root.cyberpunkTheme = appearance.cyberpunkTheme;
  if (root.theme !== theme) root.theme = theme;
}

// Runs before paint; keep storage keys and normalization aligned with readAppearance.
export const appearanceStartupScript = `try{var r=document.documentElement.dataset;var saved=localStorage.getItem("backlogbuster:layout-mode");var modes=["cyberpunk","fantasy","biohazard"];r.layoutMode=modes.includes(r.playerLayout)?r.playerLayout:modes.includes(saved)?saved:"cyberpunk";r.cyberpunkTheme=localStorage.getItem("backlogbuster:theme")==="halloween"?"halloween":"default";r.theme=r.layoutMode!=="cyberpunk"?r.layoutMode:r.cyberpunkTheme==="halloween"?"halloween":"cyberpunk"}catch{}`;
