"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createUIAudio, type UISound } from "@/lib/ui-audio";
import HalloweenDecorations from "@/components/HalloweenDecorations";
import { savePreferredLayoutMode } from "@/app/profile-actions";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";

import { applyAppearance, readAppearance, type LayoutMode, type CyberpunkTheme } from "@/lib/appearance";

const storageKey = "backlogbuster:theme";
const soundStorageKey = "backlogbuster:ui-muted";
const legacySoundStorageKey = "backlogbuster:halloween-muted";
type ThemeEffects = { layoutMode: LayoutMode; cyberpunkTheme: CyberpunkTheme; toggleLayout: () => void; layoutSaveError: string; halloween: boolean; muted: boolean; toggle: () => void; toggleMuted: () => void; playSfx: (sound: UISound) => void };
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
      applyAppearance(document.documentElement.dataset, appearance);
      setLayoutMode(appearance.layoutMode);
      layoutModeRef.current = appearance.layoutMode;
      if (playerId) {
        try { localStorage.setItem("backlogbuster:layout-mode", appearance.layoutMode); } catch { /* Account preference still works. */ }
      }
      setHalloween(enabled);
      setMuted(soundMuted);
      mutedRef.current = soundMuted;
      audio.setTheme(appearance.layoutMode === "fantasy" ? "fantasy" : enabled ? "halloween" : "cyberpunk");
      audio.setEnabled(!soundMuted);
    }
    // The startup script already restores the palette before paint. Synchronize
    // the controls after hydration without changing the server-rendered markup.
    const frame = requestAnimationFrame(() => { setLayoutSaveError(""); restore(); });
    window.addEventListener("storage", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", restore); audio.setEnabled(false); };
  }, [audio, playerId, preferredLayoutMode]);

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
    const enabled = !halloween;
    setHalloween(enabled);
    applyAppearance(document.documentElement.dataset, { layoutMode, cyberpunkTheme: enabled ? "halloween" : "default" });
    audio.setTheme(layoutMode === "fantasy" ? "fantasy" : enabled ? "halloween" : "cyberpunk");
    audio.setEnabled(!muted);
    audio.play("welcome");
    try { localStorage.setItem(storageKey, enabled ? "halloween" : "cyberpunk"); } catch { /* Theme switching still works without persistence. */ }
  }

  function toggleLayout() {
    const next = layoutModeRef.current === "cyberpunk" ? "fantasy" : "cyberpunk";
    layoutModeRef.current = next;
    setLayoutMode(next);
    applyAppearance(document.documentElement.dataset, { layoutMode: next, cyberpunkTheme: halloween ? "halloween" : "default" });
    audio.setTheme(next === "fantasy" ? "fantasy" : halloween ? "halloween" : "cyberpunk");
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

  function toggleMuted() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    audio.setEnabled(!next);
    try { localStorage.setItem(soundStorageKey, String(next)); } catch { /* In-memory mute still works. */ }
    if (!next) audio.play("confirm");
  }

  return <ThemePlayerContext.Provider value={setWorkspacePlayer}><ThemeContext.Provider value={{ layoutMode, cyberpunkTheme: halloween ? "halloween" : "default", toggleLayout, layoutSaveError, halloween, muted, toggle, toggleMuted, playSfx: audio.play }}>
    {children}
    {layoutMode === "cyberpunk" && halloween && <HalloweenDecorations />}
  </ThemeContext.Provider></ThemePlayerContext.Provider>;
}

export function ThemeToggle() {
  const { layoutMode, toggleLayout, layoutSaveError, halloween, muted, toggle, toggleMuted } = useContext(ThemeContext);
  const layoutActionLabel = layoutMode === "fantasy" ? "Switch to Cyberpunk Deck" : "Switch to Fantasy Subscreen";
  return <span className="theme-controls" data-active={halloween}><button className="layout-mode-toggle" data-ui-sound="custom" type="button" onClick={toggleLayout} title={layoutActionLabel}>{layoutActionLabel}</button>{layoutMode === "cyberpunk" && <button className="theme-toggle" data-ui-sound="custom" type="button" aria-label="Halloween theme" aria-pressed={halloween} onClick={toggle} title={halloween ? "Return to Cyberpunk theme" : "Enter Haunted Net / Blackwall Glitch theme"}>
    <span aria-hidden="true">{halloween ? "◈" : "◇"}</span> HAUNTED NET: {halloween ? "ON" : "OFF"}
  </button>}<button className="ui-sfx-toggle" data-ui-sound="custom" type="button" onClick={toggleMuted} aria-label={muted ? "Unmute UI sound effects" : "Mute UI sound effects"} aria-pressed={!muted} title={muted ? "Unmute UI sound effects" : "Mute UI sound effects"}>
    <span aria-hidden="true">{muted ? "♪̸" : "♫"}</span>
  </button>{layoutSaveError && <span className="theme-save-error" role="alert">{layoutSaveError}</span>}</span>;
}
