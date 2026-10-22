"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createUIAudio, type UISound } from "@/lib/ui-audio";
import HalloweenDecorations from "@/components/HalloweenDecorations";

const storageKey = "backlogbuster:theme";
const soundStorageKey = "backlogbuster:ui-muted";
const legacySoundStorageKey = "backlogbuster:halloween-muted";
type ThemeEffects = { halloween: boolean; muted: boolean; toggle: () => void; toggleMuted: () => void; playSfx: (sound: UISound) => void };
const ThemeContext = createContext<ThemeEffects>({ halloween: false, muted: false, toggle: () => {}, toggleMuted: () => {}, playSfx: () => {} });

export function useUIEffects() { return useContext(ThemeContext); }

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [halloween, setHalloween] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [audio] = useState(createUIAudio);

  useEffect(() => {
    function restore(event?: StorageEvent) {
      if (event && event.key !== storageKey && event.key !== soundStorageKey && event.key !== legacySoundStorageKey && event.key !== null) return;
      let enabled = document.documentElement.dataset.theme === "halloween";
      let soundMuted = mutedRef.current;
      try {
        enabled = localStorage.getItem(storageKey) === "halloween";
        soundMuted = (localStorage.getItem(soundStorageKey) ?? localStorage.getItem(legacySoundStorageKey)) === "true";
      } catch { /* Keep the in-memory preference if storage is blocked. */ }
      document.documentElement.dataset.theme = enabled ? "halloween" : "cyberpunk";
      setHalloween(enabled);
      setMuted(soundMuted);
      mutedRef.current = soundMuted;
      audio.setTheme(enabled ? "halloween" : "cyberpunk");
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
    document.documentElement.dataset.theme = enabled ? "halloween" : "cyberpunk";
    audio.setTheme(enabled ? "halloween" : "cyberpunk");
    audio.setEnabled(!muted);
    audio.play("welcome");
    try { localStorage.setItem(storageKey, enabled ? "halloween" : "cyberpunk"); } catch { /* Theme switching still works without persistence. */ }
  }

  function toggleMuted() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    audio.setEnabled(!next);
    try { localStorage.setItem(soundStorageKey, String(next)); } catch { /* In-memory mute still works. */ }
    if (!next) audio.play("confirm");
  }

  return <ThemeContext.Provider value={{ halloween, muted, toggle, toggleMuted, playSfx: audio.play }}>
    {children}
    {halloween && <HalloweenDecorations />}
  </ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { halloween, muted, toggle, toggleMuted } = useContext(ThemeContext);
  return <span className="theme-controls" data-active={halloween}><button className="theme-toggle" data-ui-sound="custom" type="button" aria-label="Halloween theme" aria-pressed={halloween} onClick={toggle} title={halloween ? "Return to Cyberpunk theme" : "Enter Haunted Net / Blackwall Glitch theme"}>
    <span aria-hidden="true">{halloween ? "◈" : "◇"}</span> HAUNTED NET: {halloween ? "ON" : "OFF"}
  </button><button className="ui-sfx-toggle" data-ui-sound="custom" type="button" onClick={toggleMuted} aria-label={muted ? "Unmute UI sound effects" : "Mute UI sound effects"} aria-pressed={!muted} title={muted ? "Unmute UI sound effects" : "Mute UI sound effects"}>
    <span aria-hidden="true">{muted ? "♪̸" : "♫"}</span>
  </button></span>;
}
