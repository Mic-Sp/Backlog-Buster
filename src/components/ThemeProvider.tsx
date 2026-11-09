"use client";

import "./HeaderControls.css";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createUIAudio, type UISound } from "@/lib/ui-audio";
import HalloweenDecorations from "@/components/HalloweenDecorations";
import FloatingFairies from "@/components/FloatingFairies";
import { savePreferredLayoutMode } from "@/app/profile-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";

import { applyAppearance, readAppearance, type LayoutMode, type CyberpunkTheme } from "@/lib/appearance";
import { applyCustomTheme } from "@/lib/custom-theme-runtime";
import useCustomThemes, { type CustomThemesController } from "@/components/useCustomThemes";
import CustomThemeStudio from "@/components/CustomThemeStudio";
import type { CustomTheme } from "@/lib/custom-theme";

const storageKey = "backlogbuster:theme";
const soundStorageKey = "backlogbuster:ui-muted";
const legacySoundStorageKey = "backlogbuster:halloween-muted";
type ThemeEffects = { layoutMode: LayoutMode; cyberpunkTheme: CyberpunkTheme; toggleLayout: () => void; layoutSaveError: string; halloween: boolean; muted: boolean; toggle: () => void; toggleMuted: () => void; playSfx: (sound: UISound) => void;
  customTheme?: CustomTheme | null; customThemes?: CustomThemesController; selectBuiltIn?: (layout: LayoutMode, variant?: CyberpunkTheme) => void };
const ThemeContext = createContext<ThemeEffects>({ layoutMode: "cyberpunk", cyberpunkTheme: "default", toggleLayout: () => {}, layoutSaveError: "", halloween: false, muted: false, toggle: () => {}, toggleMuted: () => {}, playSfx: () => {} });

export function useUIEffects() { return useContext(ThemeContext); }

type LayoutPlayer = { id: string; preferredLayoutMode: LayoutMode };
const ThemePlayerContext = createContext<((player: LayoutPlayer | null) => void) | null>(null);

// The suspended workspace supplies request-specific data after the static shell
// renders. Keep one provider so shared controllers and audio remain mounted.
export function ThemePlayerSync({ player }: { player: LayoutPlayer | null }) {
  const syncPlayer = useContext(ThemePlayerContext);
  const id = player?.id, preferredLayoutMode = player?.preferredLayoutMode;
  useEffect(() => {
    syncPlayer?.(id && preferredLayoutMode ? { id, preferredLayoutMode } : null);
    return () => syncPlayer?.(null);
  }, [syncPlayer, id, preferredLayoutMode]);
  return null;
}

export default function ThemeProvider({ children, player: initialPlayer = null }: { children: ReactNode; player?: LayoutPlayer | null }) {
  const [workspacePlayer, setWorkspacePlayer] = useState<LayoutPlayer | null | undefined>(undefined);
  const player = workspacePlayer === undefined ? initialPlayer : workspacePlayer;
  const playerId = player?.id;
  const preferredLayoutMode = player?.preferredLayoutMode;
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(player?.preferredLayoutMode ?? "cyberpunk");
  const layoutModeRef = useRef(layoutMode);
  const playerIdRef = useRef(player?.id);
  const saveQueueRef = useRef(Promise.resolve());
  const saveRequestRef = useRef(0);
  const [layoutSaveError, setLayoutSaveError] = useState("");
  const [halloween, setHalloween] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [audio] = useState(createUIAudio);
  const customThemes = useCustomThemes();
  const { activeTheme: customTheme, activeRef: customRef, ready: customReady } = customThemes;
  const effectiveLayout = customTheme?.baseLayout ?? layoutMode;

  useEffect(() => {
    playerIdRef.current = playerId;
    saveRequestRef.current++;
    if (preferredLayoutMode) layoutModeRef.current = preferredLayoutMode;
    function restore(event?: StorageEvent) {
      if (event && event.key !== "backlogbuster:layout-mode" && event.key !== storageKey && event.key !== soundStorageKey && event.key !== legacySoundStorageKey && event.key !== null) return;
      const appearance = readAppearance(document.documentElement.dataset);
      // Account preference is authoritative. Cross-tab localStorage updates
      // must not replace it with another account's device-local choice.
      if (playerId) appearance.layoutMode = layoutModeRef.current;
      const enabled = appearance.cyberpunkTheme === "halloween";
      let soundMuted = mutedRef.current;
      try {
        soundMuted = (localStorage.getItem(soundStorageKey) ?? localStorage.getItem(legacySoundStorageKey)) === "true";
      } catch { /* Keep the in-memory preference if storage is blocked. */ }
      applyAppearance(document.documentElement.dataset, customRef.current ? { layoutMode: customRef.current.baseLayout, cyberpunkTheme: "default" } : appearance);
      setLayoutMode(appearance.layoutMode);
      layoutModeRef.current = appearance.layoutMode;
      // Receiving another tab's preference must never publish a competing value.
      // Otherwise tabs with different account snapshots echo storage events forever.
      if (playerId && !event) {
        try { localStorage.setItem("backlogbuster:layout-mode", appearance.layoutMode); } catch { /* Account preference still works. */ }
      }
      setHalloween(enabled);
      setMuted(soundMuted);
      mutedRef.current = soundMuted;
      audio.setTheme((customRef.current?.baseLayout ?? appearance.layoutMode) === "fantasy" ? "fantasy" : !customRef.current && enabled ? "halloween" : "cyberpunk");
      audio.setEnabled(!soundMuted);
    }
    // The startup script already restores the palette before paint. Synchronize
    // the controls after hydration without changing the server-rendered markup.
    const frame = requestAnimationFrame(() => { setLayoutSaveError(""); restore(); });
    window.addEventListener("storage", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", restore); audio.setEnabled(false); };
  }, [audio, playerId, preferredLayoutMode, customRef]);

  useEffect(() => {
    if (!customReady) return;
    applyAppearance(document.documentElement.dataset, { layoutMode: customTheme?.baseLayout ?? layoutMode, cyberpunkTheme: customTheme ? "default" : halloween ? "halloween" : "default" });
    applyCustomTheme(document.documentElement, customTheme);
    audio.setTheme((customTheme?.baseLayout ?? layoutMode) === "fantasy" ? "fantasy" : !customTheme && halloween ? "halloween" : "cyberpunk");
  }, [customReady, customTheme, layoutMode, halloween, audio]);

  useEffect(() => {
    const onGameAdded = () => audio.play("confirm");
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("button, [role='button'], summary");
      if (!button || button.matches(":disabled, [aria-disabled='true'], [data-ui-sound='custom']")) return;
      audio.play("click");
    };
    window.addEventListener("backlogbuster:game-added", onGameAdded);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("backlogbuster:game-added", onGameAdded);
      document.removeEventListener("click", onClick, true);
    };
  }, [audio]);

  function toggle() {
    const enabled = customRef.current ? true : !halloween;
    selectBuiltIn("cyberpunk", enabled ? "halloween" : "default");
    audio.setEnabled(!muted);
    audio.play("welcome");
  }

  function toggleLayout() {
    const next = (customRef.current?.baseLayout ?? layoutModeRef.current) === "cyberpunk" ? "fantasy" : "cyberpunk";
    customThemes.select(null);
    changeLayout(next);
  }

  function changeLayout(next: LayoutMode, variant: CyberpunkTheme = halloween ? "halloween" : "default") {
    layoutModeRef.current = next;
    setLayoutMode(next);
    applyAppearance(document.documentElement.dataset, { layoutMode: next, cyberpunkTheme: variant });
    audio.setTheme(next === "fantasy" ? "fantasy" : variant === "halloween" ? "halloween" : "cyberpunk");
    audio.setEnabled(!muted);
    audio.play("page");
    try { localStorage.setItem("backlogbuster:layout-mode", next); } catch { /* In-memory switching still works. */ }
    setLayoutSaveError("");
    if (player) {
      const id = player.id, request = ++saveRequestRef.current;
      // Preserve click order when the player switches again before a save ends.
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        if (playerIdRef.current !== id) return;
        try { unwrapActionResult(await savePreferredLayoutMode(next)); }
        catch (cause) {
          if (playerIdRef.current === id && request === saveRequestRef.current) {
            setLayoutSaveError(actionErrorMessage(cause, "Layout changed on this device, but could not be saved to your account. Try switching again."));
          }
        }
      });
    }
  }

  function selectBuiltIn(next: LayoutMode, variant: CyberpunkTheme = halloween ? "halloween" : "default") {
    customThemes.select(null);
    setHalloween(variant === "halloween");
    try { localStorage.setItem(storageKey, variant === "halloween" ? "halloween" : "cyberpunk"); } catch { /* Keep in-memory selection. */ }
    if (layoutModeRef.current !== next) changeLayout(next, variant);
    else applyAppearance(document.documentElement.dataset, { layoutMode: next, cyberpunkTheme: variant });
  }

  function toggleMuted() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    audio.setEnabled(!next);
    try { localStorage.setItem(soundStorageKey, String(next)); } catch { /* In-memory mute still works. */ }
    if (!next) audio.play("confirm");
  }

  return <ThemePlayerContext.Provider value={setWorkspacePlayer}><ThemeContext.Provider value={{ layoutMode: effectiveLayout, cyberpunkTheme: customTheme ? "default" : halloween ? "halloween" : "default", toggleLayout, layoutSaveError, halloween: !customTheme && halloween, muted, toggle, toggleMuted, playSfx: audio.play,
    customTheme, customThemes, selectBuiltIn }}>
    {children}
    {(customTheme ? customTheme.effects.haunted : layoutMode === "cyberpunk" && halloween) && <HalloweenDecorations />}
    {(customTheme ? customTheme.effects.particles : layoutMode === "fantasy") && <FloatingFairies />}
    {customThemes.studioOpen && <CustomThemeStudio controller={customThemes} baseLayout={layoutMode} haunted={halloween} />}
  </ThemeContext.Provider></ThemePlayerContext.Provider>;
}

export function ThemeToggle() {
  const { layoutMode, toggleLayout, layoutSaveError, halloween, muted, toggle, toggleMuted, customTheme, customThemes, selectBuiltIn } = useContext(ThemeContext);
  const layoutActionLabel = layoutMode === "fantasy" ? "Switch to Cyberpunk Deck" : "Switch to Fantasy Subscreen";
  return <span className="theme-controls" data-active={halloween}><button className="layout-mode-toggle" data-ui-sound="custom" type="button" onClick={toggleLayout} title={layoutActionLabel}>{layoutActionLabel}</button>{layoutMode === "cyberpunk" && <button className="theme-toggle" data-ui-sound="custom" type="button" aria-label="Halloween theme" aria-pressed={halloween} onClick={toggle} title={halloween ? "Return to Cyberpunk theme" : "Enter Haunted Net / Blackwall Glitch theme"}>
    <span aria-hidden="true">{halloween ? "◈" : "◇"}</span> HAUNTED NET: {halloween ? "ON" : "OFF"}
  </button>}<button className="ui-sfx-toggle" data-ui-sound="custom" type="button" onClick={toggleMuted} aria-label={muted ? "Unmute UI sound effects" : "Mute UI sound effects"} aria-pressed={!muted} title={muted ? "Unmute UI sound effects" : "Mute UI sound effects"}>
    <span aria-hidden="true">{muted ? "♪̸" : "♫"}</span>
  </button>{customThemes && <>
    <select className="theme-selector" aria-label="UI theme" value={customTheme?.id ?? (layoutMode === "fantasy" ? "fantasy" : halloween ? "halloween" : "cyberpunk")} onChange={event => {
      const value = event.target.value;
      if (value.startsWith("custom-")) customThemes.select(value);
      else if (value === "fantasy") selectBuiltIn?.("fantasy");
      else selectBuiltIn?.("cyberpunk", value === "halloween" ? "halloween" : "default");
    }}>
      <optgroup label="Built-in themes"><option value="cyberpunk">Cyberpunk</option><option value="halloween">Haunted Net / Blackwall Glitch</option><option value="fantasy">Fantasy</option></optgroup>
      {customThemes.themes.length > 0 && <optgroup label="Custom themes">{customThemes.themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</optgroup>}
      {customTheme && !customThemes.themes.some(theme => theme.id === customTheme.id) && <option value={customTheme.id}>{customTheme.name} (preview)</option>}
    </select>
    <button className="theme-studio-trigger" type="button" aria-haspopup="dialog" onClick={customThemes.openStudio}>Custom Theme Studio</button>
    {customThemes.storageError && <span className="theme-save-error" role="alert">{customThemes.storageError}</span>}
  </>}{layoutSaveError && <span className="theme-save-error" role="alert">{layoutSaveError}</span>}</span>;
}
