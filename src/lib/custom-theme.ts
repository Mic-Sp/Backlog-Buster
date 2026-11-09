import { z } from "zod";
import type { LayoutMode } from "@/lib/appearance";

export const CUSTOM_THEMES_KEY = "backlogbuster:custom-themes:v1";
export const CUSTOM_THEME_SELECTION_KEY = "backlogbuster:custom-theme:v1";
export const MAX_CUSTOM_THEMES = 50;
export const themeColorFields = {
  background: "Primary background", surface: "Surface / card background", text: "Primary text",
  muted: "Muted text", accent: "Primary accent", border: "Border / glow",
} as const;
export const themeTermFields = {
  workspaceTitle: "Workspace heading", libraryTitle: "Library heading", statsTitle: "Player stats heading",
  inventoryTitle: "Inventory heading", deckTitle: "On Deck heading", authTitle: "Sign-in heading",
} as const;
export type ThemeColorKey = keyof typeof themeColorFields;
export type ThemeTermKey = keyof typeof themeTermFields;
export interface CustomTheme {
  id: string;
  name: string;
  baseLayout: LayoutMode;
  colors: Record<ThemeColorKey, string>;
  effects: { scanlines: boolean; particles: boolean; parchment: boolean; haunted: boolean };
  borderRadius: number;
  terminology: Partial<Record<ThemeTermKey, string>>;
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color, such as #89B4FA.");
const term = z.string().trim().max(80).optional();
export const customThemeSchema = z.object({
  id: z.string().regex(/^custom-[a-zA-Z0-9_-]{1,80}$/, "Custom theme IDs must start with custom-.").max(87),
  name: z.string().trim().min(1, "Give your theme a name.").max(60),
  baseLayout: z.enum(["cyberpunk", "fantasy"]).default("cyberpunk"),
  colors: z.object({ background: hex, surface: hex, text: hex, muted: hex, accent: hex, border: hex }).strict(),
  effects: z.object({ scanlines: z.boolean().default(false), particles: z.boolean().default(false),
    parchment: z.boolean().default(false), haunted: z.boolean().default(false) }).strict().default({ scanlines: false, particles: false, parchment: false, haunted: false }),
  borderRadius: z.number().int().min(0).max(32).default(3),
  terminology: z.object({ workspaceTitle: term, libraryTitle: term, statsTitle: term, inventoryTitle: term, deckTitle: term, authTitle: term }).strict().default({}),
}).strict() satisfies z.ZodType<CustomTheme>;

export function parseCustomThemeJSON(json: string): CustomTheme {
  if (json.length > 12000) throw new Error("Theme JSON must be smaller than 12 KB.");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("Enter valid JSON. Check quotes, commas and braces."); }
  const result = customThemeSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join(".") || "Theme"}: ${issue.message}`).slice(0, 4).join(" "));
  return result.data;
}

export function readCustomThemes(storage: Pick<Storage, "getItem">): CustomTheme[] {
  try {
    const raw = storage.getItem(CUSTOM_THEMES_KEY);
    if (!raw || raw.length > 600000) return [];
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    const themes = new Map<string, CustomTheme>();
    for (const row of rows.slice(0, MAX_CUSTOM_THEMES)) {
      const parsed = customThemeSchema.safeParse(row);
      if (parsed.success) themes.set(parsed.data.id, parsed.data);
    }
    return [...themes.values()];
  } catch { return []; }
}

export function customThemeDefaults(baseLayout: LayoutMode, haunted = false): Omit<CustomTheme, "id" | "name"> {
  return {
    baseLayout,
    colors: baseLayout === "fantasy" ? { background: "#183333", surface: "#efdfb5", text: "#30251d", muted: "#68523e", accent: "#365d3b", border: "#ad945d" }
      : haunted ? { background: "#09060f", surface: "#160e21", text: "#f4edf7", muted: "#c0afca", accent: "#b4ff72", border: "#725078" }
        : { background: "#080a0e", surface: "#0b101b", text: "#e8edf7", muted: "#94a5b9", accent: "#00f0ff", border: "#32616a" },
    effects: { scanlines: false, particles: baseLayout === "fantasy", parchment: baseLayout === "fantasy", haunted: baseLayout === "cyberpunk" && haunted },
    borderRadius: baseLayout === "fantasy" ? 8 : 3, terminology: {},
  };
}

export function newCustomTheme(baseLayout: LayoutMode, haunted = false): CustomTheme {
  return { id: `custom-${crypto.randomUUID()}`, name: "My custom theme", ...customThemeDefaults(baseLayout, haunted) };
}
