import { customThemeDefaults, customThemeSchema, type CustomTheme } from "@/lib/custom-theme";

type ThemeStyle = Omit<CustomTheme, "id" | "name">;
export type ThemeTemplate = { key: string; name: string; group: "builtin" | "saved"; style: ThemeStyle };
export const themeTemplateGroups = [
  { key: "builtin", name: "Built-in themes" },
  { key: "saved", name: "Saved custom themes" },
] as const;

// Reuse the same defaults as New theme rather than maintaining a second palette.
const builtInTemplates: ThemeTemplate[] = [
  { key: "builtin:cyberpunk", name: "Cyberpunk", group: "builtin", style: customThemeDefaults("cyberpunk") },
  { key: "builtin:fantasy", name: "Fantasy", group: "builtin", style: customThemeDefaults("fantasy") },
  { key: "builtin:halloween", name: "Haunted Net / Blackwall Glitch", group: "builtin", style: customThemeDefaults("cyberpunk", true) },
];

/** Saved sources come from the controller's validated, cross-tab-aware storage list. */
export function getThemeTemplates(saved: readonly CustomTheme[], editingId?: string): ThemeTemplate[] {
  return [...builtInTemplates, ...saved.filter(theme => theme.id !== editingId).map(theme => {
    const { id, name, ...style } = theme;
    return { key: `saved:${id}`, name, group: "saved" as const, style };
  })];
}

/** Copy visual fields, keeping the draft's identity separate from its source. */
export function applyThemeTemplate(draft: CustomTheme, template: ThemeTemplate): CustomTheme {
  // Zod clones nested values, so subsequent edits cannot mutate a saved source.
  return customThemeSchema.parse({ ...template.style, id: draft.id, name: draft.name.trim() ? draft.name : "My custom theme" });
}
