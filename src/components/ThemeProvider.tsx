"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createHalloweenAudio, type HalloweenSound } from "@/lib/halloween-audio";
import HalloweenDecorations from "@/components/HalloweenDecorations";

const storageKey = "backlogbuster:theme";
const soundStorageKey = "backlogbuster:halloween-muted";
type ThemeEffects = { halloween: boolean; muted: boolean; toggle: () => void; toggleMuted: () => void; playHalloweenSfx: (sound: HalloweenSound) => void };
const ThemeContext = createContext<ThemeEffects>({ halloween: false, muted: false, toggle: () => {}, toggleMuted: () => {}, playHalloweenSfx: () => {} });

export function useHalloweenEffects() { return useContext(ThemeContext); }

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [halloween, setHalloween] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [audio] = useState(createHalloweenAudio);

  useEffect(() => {
    function restore(event?: StorageEvent) {
      if (event && event.key !== storageKey && event.key !== soundStorageKey && event.key !== null) return;
      let enabled = document.documentElement.dataset.theme === "halloween";
      let soundMuted = mutedRef.current;
      try {
        enabled = localStorage.getItem(storageKey) === "halloween";
        soundMuted = localStorage.getItem(soundStorageKey) === "true";
      } catch { /* Keep the in-memory preference if storage is blocked. */ }
      document.documentElement.dataset.theme = enabled ? "halloween" : "cyberpunk";
      setHalloween(enabled);
      setMuted(soundMuted);
      mutedRef.current = soundMuted;
      audio.setEnabled(enabled && !soundMuted);
    }
    // The startup script already restores the palette before paint. Synchronize
    // the controls after hydration without changing the server-rendered markup.
    const frame = requestAnimationFrame(() => restore());
    window.addEventListener("storage", restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", restore); audio.setEnabled(false); };
  }, [audio]);

  useEffect(() => {
    const onGameAdded = () => audio.play("pop");
    window.addEventListener("backlogbuster:game-added", onGameAdded);
    return () => window.removeEventListener("backlogbuster:game-added", onGameAdded);
  }, [audio]);

  function toggle() {
    const enabled = !halloween;
    setHalloween(enabled);
    document.documentElement.dataset.theme = enabled ? "halloween" : "cyberpunk";
    audio.setEnabled(enabled && !muted);
    if (enabled) audio.play("welcome");
    try { localStorage.setItem(storageKey, enabled ? "halloween" : "cyberpunk"); } catch { /* Theme switching still works without persistence. */ }
  }

  function toggleMuted() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    audio.setEnabled(halloween && !next);
    try { localStorage.setItem(soundStorageKey, String(next)); } catch { /* In-memory mute still works. */ }
    if (!next) audio.play("pop");
  }

  return <ThemeContext.Provider value={{ halloween, muted, toggle, toggleMuted, playHalloweenSfx: audio.play }}>
    {children}
    {halloween && <HalloweenDecorations />}
  </ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { halloween, muted, toggle, toggleMuted } = useContext(ThemeContext);
  return <span className="theme-controls" data-active={halloween}><button className="theme-toggle" type="button" aria-label="Halloween theme" aria-pressed={halloween} onClick={toggle} title={halloween ? "Return to Cyberpunk theme" : "Enter Haunted Net / Blackwall Glitch theme"}>
    <span aria-hidden="true">{halloween ? "◈" : "◇"}</span> HAUNTED NET: {halloween ? "ON" : "OFF"}
  </button>{halloween && <button className="halloween-sfx-toggle" type="button" onClick={toggleMuted} aria-label={muted ? "Unmute Halloween sound effects" : "Mute Halloween sound effects"} aria-pressed={!muted} title={muted ? "Unmute Halloween sound effects" : "Mute Halloween sound effects"}>
    <span aria-hidden="true">{muted ? "♪̸" : "♫"}</span>
  </button>}</span>;
}
