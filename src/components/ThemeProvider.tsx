"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createUIAudio, type UISound } from "@/lib/ui-audio";
import HalloweenDecorations from "@/components/HalloweenDecorations";

import { applyAppearance, readAppearance, type LayoutMode, type CyberpunkTheme } from "@/lib/appearance";

const storageKey = "backlogbuster:theme";
const soundStorageKey = "backlogbuster:ui-muted";
const legacySoundStorageKey = "backlogbuster:halloween-muted";
type ThemeEffects = { layoutMode: LayoutMode; cyberpunkTheme: CyberpunkTheme; toggleLayout: () => void; halloween: boolean; muted: boolean; toggle: () => void; toggleMuted: () => void; playSfx: (sound: UISound) => void };
const ThemeContext = createContext<ThemeEffects>({ layoutMode: "cyberpunk", cyberpunkTheme: "default", toggleLayout: () => {}, halloween: false, muted: false, toggle: () => {}, toggleMuted: () => {}, playSfx: () => {} });

export function useUIEffects() { return useContext(ThemeContext); }

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("cyberpunk");
  const [halloween, setHalloween] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [audio] = useState(createUIAudio);

  useEffect(() => {
    function restore(event?: StorageEvent) {
      if (event && event.key !== "backlogbuster:layout-mode" && event.key !== storageKey && event.key !== soundStorageKey && event.key !== legacySoundStorageKey && event.key !== null) return;
      const appearance = readAppearance(document.documentElement.dataset);
      const enabled = appearance.cyberpunkTheme === "halloween";
      let soundMuted = mutedRef.current;
      try {
        soundMuted = (localStorage.getItem(soundStorageKey) ?? localStorage.getItem(legacySoundStorageKey)) === "true";
      } catch { /* Keep the in-memory preference if storage is blocked. */ }
      applyAppearance(document.documentElement.dataset, appearance);
      setLayoutMode(appearance.layoutMode);
      setHalloween(enabled);
      setMuted(soundMuted);
      mutedRef.current = soundMuted;
      audio.setTheme(appearance.layoutMode === "fantasy" ? "fantasy" : enabled ? "halloween" : "cyberpunk");
      audio.setEnabled(!soundMuted);
    }
    // The startup script already restores the palette before paint. Synchronize
    // the controls after hydration without changing the server-rendered markup.
    const frame = requestAnimationFrame(() => restore());
    window.addEventListener("storage", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", restore); audio.setEnabled(false); };
  }, [audio]);

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
    const next = layoutMode === "cyberpunk" ? "fantasy" : "cyberpunk";
    setLayoutMode(next);
    applyAppearance(document.documentElement.dataset, { layoutMode: next, cyberpunkTheme: halloween ? "halloween" : "default" });
    audio.setTheme(next === "fantasy" ? "fantasy" : halloween ? "halloween" : "cyberpunk");
    audio.setEnabled(!muted);
    audio.play("page");
    try { localStorage.setItem("backlogbuster:layout-mode", next); } catch { /* In-memory switching still works. */ }
  }

  function toggleMuted() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    audio.setEnabled(!next);
    try { localStorage.setItem(soundStorageKey, String(next)); } catch { /* In-memory mute still works. */ }
    if (!next) audio.play("confirm");
  }

  return <ThemeContext.Provider value={{ layoutMode, cyberpunkTheme: halloween ? "halloween" : "default", toggleLayout, halloween, muted, toggle, toggleMuted, playSfx: audio.play }}>
    {children}
    {layoutMode === "cyberpunk" && halloween && <HalloweenDecorations />}
  </ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { layoutMode, toggleLayout, halloween, muted, toggle, toggleMuted } = useContext(ThemeContext);
  const layoutActionLabel = layoutMode === "fantasy" ? "Switch to Cyberpunk Deck" : "Switch to Fantasy Subscreen";
  return <span className="theme-controls" data-active={halloween}><button className="layout-mode-toggle" data-ui-sound="custom" type="button" onClick={toggleLayout} title={layoutActionLabel}>{layoutActionLabel}</button>{layoutMode === "cyberpunk" && <button className="theme-toggle" data-ui-sound="custom" type="button" aria-label="Halloween theme" aria-pressed={halloween} onClick={toggle} title={halloween ? "Return to Cyberpunk theme" : "Enter Haunted Net / Blackwall Glitch theme"}>
    <span aria-hidden="true">{halloween ? "◈" : "◇"}</span> HAUNTED NET: {halloween ? "ON" : "OFF"}
  </button>}<button className="ui-sfx-toggle" data-ui-sound="custom" type="button" onClick={toggleMuted} aria-label={muted ? "Unmute UI sound effects" : "Mute UI sound effects"} aria-pressed={!muted} title={muted ? "Unmute UI sound effects" : "Mute UI sound effects"}>
    <span aria-hidden="true">{muted ? "♪̸" : "♫"}</span>
  </button></span>;
}
