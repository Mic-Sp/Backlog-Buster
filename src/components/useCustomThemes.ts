"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTOM_THEMES_KEY, CUSTOM_THEME_SELECTION_KEY, MAX_CUSTOM_THEMES, customThemeSchema, readCustomThemes, type CustomTheme } from "@/lib/custom-theme";
import { clearSharedThemeUrl } from "@/lib/theme-share";

type StudioState = { themes: CustomTheme[]; selectedId: string | null; preview: CustomTheme | null; shared: CustomTheme | null };
const activeTheme = (state: StudioState) => state.preview ?? state.shared ?? state.themes.find(theme => theme.id === state.selectedId) ?? null;
export default function useCustomThemes() {
  const [state, setState] = useState<StudioState>({ themes: [], selectedId: null, preview: null, shared: null });
  const stateRef = useRef(state);
  const activeRef = useRef<CustomTheme | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [studioOpen, setStudioOpen] = useState(false);
  function commit(next: StudioState) {
    stateRef.current = next; activeRef.current = activeTheme(next);
    setState(next);
  }
  useEffect(() => {
    function restore(event?: StorageEvent) {
      if (event && event.key !== null && event.key !== CUSTOM_THEMES_KEY && event.key !== CUSTOM_THEME_SELECTION_KEY) return;
      let themes: CustomTheme[] = [];
      let selectedId: string | null = null;
      try { themes = readCustomThemes(localStorage); const id = localStorage.getItem(CUSTOM_THEME_SELECTION_KEY); selectedId = themes.some(theme => theme.id === id) ? id : null; } catch { /* Device-local theming remains available. */ }
      const next = { ...stateRef.current, themes, selectedId };
      stateRef.current = next; activeRef.current = activeTheme(next);
      setState(next); setReady(true);
    }
    const frame = requestAnimationFrame(() => restore());
    window.addEventListener("storage", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", restore); };
  }, []);
  function persist(themes: CustomTheme[], selectedId: string | null) {
    // Keep both storage keys consistent if quota or browser restrictions reject a write.
    let previousThemes: string | null = null, previousSelection: string | null = null;
    try {
      previousThemes = localStorage.getItem(CUSTOM_THEMES_KEY); previousSelection = localStorage.getItem(CUSTOM_THEME_SELECTION_KEY);
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
      if (selectedId) localStorage.setItem(CUSTOM_THEME_SELECTION_KEY, selectedId); else localStorage.removeItem(CUSTOM_THEME_SELECTION_KEY);
    } catch {
      try {
        if (previousThemes === null) localStorage.removeItem(CUSTOM_THEMES_KEY); else localStorage.setItem(CUSTOM_THEMES_KEY, previousThemes);
        if (previousSelection === null) localStorage.removeItem(CUSTOM_THEME_SELECTION_KEY); else localStorage.setItem(CUSTOM_THEME_SELECTION_KEY, previousSelection);
      } catch { /* Preserve the editor draft so it can still be exported. */ }
      throw new Error("Browser storage is unavailable or full. Export your theme JSON before closing the studio.");
    }
  }
  function save(value: CustomTheme, freshId = false) {
    const current = stateRef.current;
    const theme = customThemeSchema.parse(value);
    if (freshId || current.shared?.id === theme.id) theme.id = `custom-${crypto.randomUUID()}`;
    if (current.themes.length >= MAX_CUSTOM_THEMES && !current.themes.some(row => row.id === theme.id)) throw new Error("You can save up to 50 custom themes. Delete one to make room.");
    const themes = [...current.themes.filter(row => row.id !== theme.id), theme];
    persist(themes, theme.id); commit({ themes, selectedId: theme.id, preview: null, shared: null }); setStorageError(""); setStudioOpen(false);
    if (current.shared) clearSharedThemeUrl();
  }
  return {
    ready, themes: state.themes, selectedId: state.selectedId, activeTheme: activeTheme(state), sharedTheme: state.shared,
    activeRef, studioOpen, storageError,
    openStudio: () => setStudioOpen(true),
    closeStudio: () => { commit({ ...stateRef.current, preview: null }); setStudioOpen(false); },
    preview: (theme: CustomTheme) => commit({ ...stateRef.current, preview: customThemeSchema.parse(theme) }),
    previewShared: (value: CustomTheme | null) => {
      const shared = value ? customThemeSchema.parse(value) : null;
      if (!shared && !stateRef.current.shared) return;
      commit({ ...stateRef.current, shared });
    },
    dismissShared: () => { commit({ ...stateRef.current, shared: null }); clearSharedThemeUrl(); },
    saveShared: () => { if (stateRef.current.shared) save(stateRef.current.shared, true); },
    select: (id: string | null) => {
      const wasShared = Boolean(stateRef.current.shared);
      const selectedId = stateRef.current.themes.some(theme => theme.id === id) ? id : null;
      try {
        if (selectedId) localStorage.setItem(CUSTOM_THEME_SELECTION_KEY, selectedId); else localStorage.removeItem(CUSTOM_THEME_SELECTION_KEY);
        setStorageError("");
      } catch { setStorageError("Theme changed on this device, but browser storage could not save the selection."); }
      commit({ ...stateRef.current, selectedId, preview: null, shared: null });
      if (wasShared) clearSharedThemeUrl();
    },
    save,
    remove: (id: string) => {
      const current = stateRef.current, themes = current.themes.filter(theme => theme.id !== id);
      const selectedId = current.selectedId === id ? null : current.selectedId;
      persist(themes, selectedId); commit({ ...current, themes, selectedId, preview: null }); setStorageError("");
    },
  };
}
export type CustomThemesController = ReturnType<typeof useCustomThemes>;
