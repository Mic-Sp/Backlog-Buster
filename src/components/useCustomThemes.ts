"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTOM_THEMES_KEY, CUSTOM_THEME_SELECTION_KEY, MAX_CUSTOM_THEMES, customThemeSchema, readCustomThemes, type CustomTheme } from "@/lib/custom-theme";

type StudioState = { themes: CustomTheme[]; selectedId: string | null; preview: CustomTheme | null };
export default function useCustomThemes() {
  const [state, setState] = useState<StudioState>({ themes: [], selectedId: null, preview: null });
  const stateRef = useRef(state);
  const activeRef = useRef<CustomTheme | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [studioOpen, setStudioOpen] = useState(false);
  function commit(next: StudioState) {
    stateRef.current = next; activeRef.current = next.preview ?? next.themes.find(theme => theme.id === next.selectedId) ?? null;
    setState(next);
  }
  useEffect(() => {
    function restore(event?: StorageEvent) {
      if (event && event.key !== null && event.key !== CUSTOM_THEMES_KEY && event.key !== CUSTOM_THEME_SELECTION_KEY) return;
      let themes: CustomTheme[] = [];
      let selectedId: string | null = null;
      try { themes = readCustomThemes(localStorage); const id = localStorage.getItem(CUSTOM_THEME_SELECTION_KEY); selectedId = themes.some(theme => theme.id === id) ? id : null; } catch { /* Device-local theming remains available. */ }
      const next = { themes, selectedId, preview: stateRef.current.preview };
      stateRef.current = next; activeRef.current = next.preview ?? themes.find(theme => theme.id === selectedId) ?? null;
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
  return {
    ready, themes: state.themes, selectedId: state.selectedId, activeTheme: state.preview ?? state.themes.find(theme => theme.id === state.selectedId) ?? null,
    activeRef, studioOpen, storageError,
    openStudio: () => setStudioOpen(true),
    closeStudio: () => { commit({ ...stateRef.current, preview: null }); setStudioOpen(false); },
    preview: (theme: CustomTheme) => commit({ ...stateRef.current, preview: customThemeSchema.parse(theme) }),
    select: (id: string | null) => {
      const selectedId = stateRef.current.themes.some(theme => theme.id === id) ? id : null;
      try {
        if (selectedId) localStorage.setItem(CUSTOM_THEME_SELECTION_KEY, selectedId); else localStorage.removeItem(CUSTOM_THEME_SELECTION_KEY);
        setStorageError("");
      } catch { setStorageError("Theme changed on this device, but browser storage could not save the selection."); }
      commit({ ...stateRef.current, selectedId, preview: null });
    },
    save: (value: CustomTheme) => {
      const theme = customThemeSchema.parse(value), current = stateRef.current;
      if (current.themes.length >= MAX_CUSTOM_THEMES && !current.themes.some(row => row.id === theme.id)) throw new Error("You can save up to 50 custom themes. Delete one to make room.");
      const themes = [...current.themes.filter(row => row.id !== theme.id), theme];
      persist(themes, theme.id); commit({ themes, selectedId: theme.id, preview: null }); setStorageError(""); setStudioOpen(false);
    },
    remove: (id: string) => {
      const current = stateRef.current, themes = current.themes.filter(theme => theme.id !== id);
      const selectedId = current.selectedId === id ? null : current.selectedId;
      persist(themes, selectedId); commit({ themes, selectedId, preview: null }); setStorageError("");
    },
  };
}
export type CustomThemesController = ReturnType<typeof useCustomThemes>;
