import type { CustomTheme } from "@/lib/custom-theme";

/** Self-contained so the same engine can run before paint and after hydration. */
export function applyCustomTheme(root: HTMLElement, theme: CustomTheme | null) {
  const tokens = { "--custom-background": "background", "--custom-surface": "surface", "--custom-text": "text", "--custom-muted": "muted", "--custom-accent": "accent", "--custom-border": "border",
    "--canvas": "background", "--paper": "surface", "--ink": "text", "--muted": "muted", "--line": "border", "--green": "accent", "--lime": "accent", "--blue": "accent", "--coral": "accent",
    "--surface": "surface", "--panel": "surface", "--gold": "accent", "--parchment": "surface", "--royal": "background", "--fairy": "accent" } as const;
  for (const [property, key] of Object.entries(tokens)) {
    if (theme) root.style.setProperty(property, theme.colors[key]);
    else root.style.removeProperty(property);
  }
  if (theme) {
    root.dataset.customTheme = theme.id;
    root.style.setProperty("--custom-radius", `${theme.borderRadius}px`);
    for (const key of ["scanlines", "particles", "parchment", "haunted"] as const) root.setAttribute(`data-custom-${key}`, String(theme.effects[key]));
    const rgb = theme.colors.background.slice(1).match(/../g)!.map(value => parseInt(value, 16));
    root.style.setProperty("color-scheme", (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150 ? "light" : "dark");
  } else {
    delete root.dataset.customTheme;
    root.style.removeProperty("--custom-radius"); root.style.removeProperty("color-scheme");
    for (const key of ["scanlines", "particles", "parchment", "haunted"]) root.removeAttribute(`data-custom-${key}`);
  }
}

// This small pre-paint guard validates every value that can reach CSS. The full
// Zod schema validates metadata/terminology and storage again after hydration.
export function restoreCustomThemeBeforePaint(root: HTMLElement, storage: Pick<Storage, "getItem">, apply: typeof applyCustomTheme) {
  try {
    const selected = storage.getItem("backlogbuster:custom-theme:v1");
    if (!selected || !/^custom-[a-zA-Z0-9_-]{1,80}$/.test(selected)) return;
    const raw = storage.getItem("backlogbuster:custom-themes:v1");
    if (!raw || raw.length > 600000) return;
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return;
    const theme = rows.slice(0, 50).find(value => value && value.id === selected);
    if (!theme || !theme.colors || !["background", "surface", "text", "muted", "accent", "border"].every(key => typeof theme.colors[key] === "string" && /^#[0-9a-fA-F]{6}$/.test(theme.colors[key]))) return;
    if (theme.baseLayout !== undefined && !["cyberpunk", "fantasy"].includes(theme.baseLayout)) return;
    if (theme.borderRadius !== undefined && (!Number.isInteger(theme.borderRadius) || theme.borderRadius < 0 || theme.borderRadius > 32)) return;
    const effects = theme.effects ?? {};
    if (!effects || typeof effects !== "object" || !["scanlines", "particles", "parchment", "haunted"].every(key => effects[key] === undefined || typeof effects[key] === "boolean")) return;
    const normalized = { id: theme.id, name: theme.name, colors: theme.colors, terminology: theme.terminology ?? {}, baseLayout: theme.baseLayout ?? "cyberpunk", borderRadius: theme.borderRadius ?? 3,
      effects: { scanlines: effects.scanlines === true, particles: effects.particles === true, parchment: effects.parchment === true, haunted: effects.haunted === true } };
    root.dataset.layoutMode = normalized.baseLayout; root.dataset.cyberpunkTheme = "default"; root.dataset.theme = normalized.baseLayout;
    apply(root, normalized);
  } catch { /* Broken or blocked browser storage must never prevent startup. */ }
}

export const customThemeStartupScript = `try{(${restoreCustomThemeBeforePaint.toString()})(document.documentElement,localStorage,${applyCustomTheme.toString()})}catch{}`;
