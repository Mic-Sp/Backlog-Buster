export type ColorMode = "system" | "light" | "dark";
export type ResolvedColorMode = "light" | "dark";
export const colorModeStorageKey = "backlogbuster:color-mode";
export const colorSchemeQuery = "(prefers-color-scheme: dark)";

export function isColorMode(value: unknown): value is ColorMode {
  return value === "system" || value === "light" || value === "dark";
}
export function normalizeColorMode(value: unknown): ColorMode {
  return isColorMode(value) ? value : "system";
}
export function resolveColorMode(preference: ColorMode, prefersDark: boolean): ResolvedColorMode {
  return preference === "system" ? prefersDark ? "dark" : "light" : preference;
}
export function applyColorMode(root: { colorMode?: string; colorPreference?: string }, preference: ColorMode, prefersDark: boolean) {
  const resolved = resolveColorMode(preference, prefersDark);
  if (root.colorMode !== resolved) root.colorMode = resolved;
  if (root.colorPreference !== preference) root.colorPreference = preference;
  return resolved;
}

export function persistColorMode(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, preference: ColorMode) {
  const saved = storage.getItem(colorModeStorageKey);
  if (preference === "system") { if (saved !== null) storage.removeItem(colorModeStorageKey); }
  else if (saved !== preference) storage.setItem(colorModeStorageKey, preference);
}

/** Self-contained for use in the static shell before any app chunks load. */
export function restoreColorModeBeforePaint(root: { colorMode?: string; colorPreference?: string }, readPreference: () => string | null, prefersDark: () => boolean) {
  let preference: ColorMode = "system", dark = false;
  try { const saved = readPreference(); if (saved === "light" || saved === "dark") preference = saved; } catch { /* Follow the OS when storage is blocked. */ }
  try { dark = prefersDark(); } catch { /* Light is the fallback when matchMedia is unavailable. */ }
  root.colorPreference = preference;
  root.colorMode = preference === "system" ? dark ? "dark" : "light" : preference;
}
export const colorModeStartupScript = `(${restoreColorModeBeforePaint.toString()})(document.documentElement.dataset,()=>localStorage.getItem("backlogbuster:color-mode"),()=>window.matchMedia("(prefers-color-scheme: dark)").matches);`;
