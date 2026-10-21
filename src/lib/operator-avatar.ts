export const avatarPresets = [
  { id: "bb", title: 'Default BB Neon Circuit Emblem' },
  { id: "kitsune", title: 'Kitsune Cyber-Mask' },
  { id: "skull", title: 'Netrunner Neural Skull' },
  { id: "samurai", title: 'Chrome Samurai Helmet' },
  { id: "cortex", title: 'AI Cortex Core' },
  { id: "terminal", title: 'Retro CRT Terminal Glyph' },
] as const;
export type AvatarPreset = typeof avatarPresets[number]['id'];
export const DEFAULT_AVATAR_URL = "/hud-logo.png";

export function isAvatarPreset(value: string): boolean {
  return avatarPresets.some(preset => value === `preset:${preset.id}`);
}
export function resolveAvatarPreset(value: string | null | undefined): AvatarPreset | null {
  if (!value?.trim()) return "bb";
  return avatarPresets.find(preset => value.trim() === `preset:${preset.id}`)?.id ?? null;
}
export function customAvatarUrl(value: string | null | undefined): string | null {
  if (!value || isAvatarPreset(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
