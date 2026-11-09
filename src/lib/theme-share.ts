import { customThemeSchema, type CustomTheme } from "@/lib/custom-theme";

export const MAX_THEME_SHARE_LENGTH = 8192;

// Small transit checksum, not authentication. Every decoded value still passes
// the strict theme schema; a shared URL never supplies CSS, scripts or asset URLs.
function checksum(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
function base64url(binary: string) { return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

export function encodeThemeShare(theme: CustomTheme): string {
  const validated = customThemeSchema.parse(theme);
  const bytes = new TextEncoder().encode(JSON.stringify(validated));
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  const value = `v1.${base64url(binary)}.${checksum(bytes)}`;
  if (value.length > MAX_THEME_SHARE_LENGTH) throw new Error("This theme is too large for a share link. Share its JSON instead.");
  return value;
}

/** Invalid, oversized, noncanonical, corrupt or schema-invalid payloads are inert. */
export function decodeThemeShare(value: unknown): CustomTheme | null {
  if (typeof value !== "string" || value.length > MAX_THEME_SHARE_LENGTH) return null;
  const match = /^v1\.([A-Za-z0-9_-]+)\.([a-f0-9]{8})$/.exec(value);
  if (!match || match[1].length % 4 === 1) return null;
  try {
    const encoded = match[1];
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4));
    if (base64url(binary) !== encoded) return null;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (checksum(bytes) !== match[2]) return null;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = customThemeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Copy only origin + pathname + theme; never forward unrelated/private query data. */
export function createThemeShareUrl(theme: CustomTheme, currentUrl: string): string {
  const url = new URL(currentUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Open the app in a browser to create a share link.");
  const shared = new URL(url.pathname, url.origin);
  shared.searchParams.set("theme", encodeThemeShare(theme));
  return shared.toString();
}

/** Preserve all other query values, the path, and fragment when accepting/dismissing. */
export function withoutSharedTheme(url: string): string {
  const current = new URL(url);
  current.searchParams.delete("theme");
  return `${current.pathname}${current.search}${current.hash}`;
}

export function clearSharedThemeUrl() {
  if (typeof window !== "undefined" && new URL(window.location.href).searchParams.has("theme")) {
    // Next's native-history integration retains its internal state. Passing the
    // existing state back instead bypasses its useSearchParams notification.
    window.history.replaceState(null, "", withoutSharedTheme(window.location.href));
  }
}
