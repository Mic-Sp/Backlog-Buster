"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Achievement } from "@/lib/achievements";

const storageKey = "bb_toasted_achievements";
const levelStorageKey = "bb_known_level_v1";
const soundStorageKey = "bb_sound_muted";

function playToastChime(variant: "achievement" | "level-up") {
  let context: AudioContext | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const close = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(closeTimer);
    try {
      if (context && context.state !== "closed") void context.close().catch(() => {});
    } catch {
      // Audio is optional; blocked or unavailable devices must not interrupt toasts.
    }
  };

  try {
    const AudioContextConstructor = window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const audio = new AudioContextConstructor();
    context = audio;
    // A blocked resume() may remain pending; still release its context promptly.
    closeTimer = setTimeout(close, 2500);

    const synthesize = () => {
      if (disposed || audio.state !== "running") return;
      try {
        const frequencies = variant === "level-up"
          ? [523.25, 659.25, 783.99, 987.77, 1046.5]
          : [523.25, 659.25, 783.99, 1046.5];
        const startTime = audio.currentTime + 0.01;
        frequencies.forEach((frequency, index) => {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          const start = startTime + index * 0.08;
          const duration = variant === "level-up" && index === frequencies.length - 1 ? 0.65 : 0.22;
          oscillator.type = "triangle";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.12, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
          oscillator.start(start);
          oscillator.stop(start + duration);
        });
        clearTimeout(closeTimer);
        const duration = (frequencies.length - 1) * 0.08 + (variant === "level-up" ? 0.65 : 0.22);
        closeTimer = setTimeout(close, (duration + 0.06) * 1000);
      } catch {
        close();
      }
    };

    if (audio.state === "suspended") void audio.resume().then(synthesize).catch(close);
    else synthesize();
    return close;
  } catch {
    close();
  }
}

type ToastItem = {
  key: string;
  variant: "achievement" | "level-up";
  title: string;
  description: string;
  icon: string;
  eyebrow: string;
  reward: string;
};

function readDismissedAchievements(): Set<string> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function storeDismissedAchievements(keys: Set<string>) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Notifications still work in memory when browser storage is unavailable.
  }
}

export default function AchievementToast({ achievements, level, totalXp }: {
  achievements: Achievement[];
  level: number;
  totalXp: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [toastQueue, setToastQueue] = useState<ToastItem[]>([]);
  const initiallyLoadedAchievements = useRef(achievements);
  const dismissedKeys = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const knownLevel = useRef<number | null>(null);
  const lastChimedKey = useRef<string | null>(null);
  const activeToast = toastQueue[0] ?? null;

  useEffect(() => {
    try {
      // Read the saved preference after hydration, before enabling portal audio.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSoundMuted(localStorage.getItem(soundStorageKey) === "true");
    } catch {
      // Keep the in-memory preference if browser storage is unavailable.
    }
    // The portal's document.body target exists only after hydration.
    setMounted(true);
  }, []);

  useEffect(() => {
    for (const key of readDismissedAchievements()) dismissedKeys.current.add(key);

    if (!initialized.current) {
      const now = Date.now();
      let historicalKeysAdded = false;
      for (const achievement of initiallyLoadedAchievements.current) {
        if (achievement.unlocked && achievement.unlockedAt &&
          now - new Date(achievement.unlockedAt).getTime() > 60000 &&
          !dismissedKeys.current.has(achievement.key)) {
          dismissedKeys.current.add(achievement.key);
          historicalKeysAdded = true;
        }
      }
      initialized.current = true;
      if (historicalKeysAdded) storeDismissedAchievements(dismissedKeys.current);
    }

    const eligible = achievements.filter((achievement) =>
      achievement.unlocked && achievement.unlockedAt && !dismissedKeys.current.has(achievement.key),
    );
    if (eligible.length > 0) {
      // Reconcile external server/storage data with a pure, deduplicating updater.
      setToastQueue((queue) => {
        const queuedKeys = new Set(queue.map((achievement) => achievement.key));
        const additions = eligible.filter((achievement) => {
          if (queuedKeys.has(achievement.key)) return false;
          queuedKeys.add(achievement.key);
          return true;
        });
        return additions.length > 0 ? [...queue, ...additions.map((achievement): ToastItem => ({
          key: achievement.key,
          variant: "achievement",
          title: achievement.title,
          description: achievement.description,
          icon: achievement.icon,
          eyebrow: `🏆 MILESTONE UNLOCKED // +${achievement.xpAwarded.toLocaleString("en-US")} XP`,
          reward: `+${achievement.xpAwarded.toLocaleString("en-US")} XP`,
        }))] : queue;
      });
    }
  }, [achievements]);

  useEffect(() => {
    let previousLevel = knownLevel.current;
    try {
      const stored = sessionStorage.getItem(levelStorageKey);
      const parsed = stored === null ? null : Number(stored);
      if (parsed !== null && Number.isSafeInteger(parsed) && parsed >= 1) previousLevel = parsed;
    } catch {
      // Retain the in-memory baseline when browser storage is unavailable.
    }
    knownLevel.current = level;
    try {
      sessionStorage.setItem(levelStorageKey, String(level));
    } catch {
      // Level changes still notify while this component remains mounted.
    }
    if (previousLevel === null || level <= previousLevel) return;

    const toast: ToastItem = {
      key: `level-up-${level}`,
      variant: "level-up",
      title: `LEVEL ${level} REACHED`,
      description: `Netrunner rank upgraded from LV ${previousLevel} to LV ${level}.`,
      icon: "🔼",
      eyebrow: "⚡ SYSTEM UPGRADE // LEVEL UP!",
      reward: `${totalXp.toLocaleString("en-US")} TOTAL XP`,
    };
    setToastQueue((queue) => queue.some((item) => item.key === toast.key) ? queue : [...queue, toast]);
  }, [level, totalXp]);

  const dismissToast = useCallback((toast: ToastItem) => {
    if (toast.variant === "achievement") {
      const stored = readDismissedAchievements();
      for (const dismissed of dismissedKeys.current) stored.add(dismissed);
      stored.add(toast.key);
      dismissedKeys.current.add(toast.key);
      storeDismissedAchievements(stored);
    }
    setToastQueue((queue) => queue.filter((item) => item.key !== toast.key));
  }, []);

  useEffect(() => {
    if (!mounted || !activeToast) return;
    const dismissTimer = setTimeout(() => dismissToast(activeToast), 5000);
    return () => clearTimeout(dismissTimer);
  }, [activeToast, mounted, dismissToast]);

  const activeToastKey = activeToast?.key ?? null;
  const activeToastVariant = activeToast?.variant;
  useEffect(() => {
    if (!mounted || !activeToastKey || !activeToastVariant) {
      lastChimedKey.current = null;
      return;
    }
    if (lastChimedKey.current === activeToastKey) return;
    lastChimedKey.current = activeToastKey;
    if (!soundMuted) return playToastChime(activeToastVariant);
  }, [activeToastKey, activeToastVariant, mounted, soundMuted]);

  function toggleSound() {
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    try {
      localStorage.setItem(soundStorageKey, String(nextMuted));
    } catch {
      // The toggle still works for this mount without persistent storage.
    }
  }

  if (!mounted) return null;

  // Keep the overlay outside library containers, clipping, and local stacking contexts.
  return createPortal(
    <div className="achievement-toast-region" role="status" aria-live="polite" aria-atomic="true">
      {activeToast && (
        <article className="achievement-toast" data-variant={activeToast.variant} key={activeToast.key}>
          <div className="achievement-toast-eyebrow">{activeToast.eyebrow}</div>
          <button className="achievement-toast-dismiss achievement-toast-sound" type="button" aria-label={soundMuted ? "Unmute HUD sounds" : "Mute HUD sounds"} aria-pressed={soundMuted} onClick={toggleSound}>{soundMuted ? "🔇" : "🔊"}</button>
          <button className="achievement-toast-dismiss" type="button" aria-label={`Dismiss ${activeToast.title} ${activeToast.variant === "achievement" ? "achievement" : "notification"}`} onClick={() => dismissToast(activeToast)}>✕</button>
          <div className="achievement-toast-body">
            <div className="achievement-toast-crest" aria-hidden="true">{activeToast.icon}</div>
            <div>
              <h2>{activeToast.title}</h2>
              <p>{activeToast.description}</p>
              <span className="achievement-toast-reward">{activeToast.reward}</span>
            </div>
          </div>
          <div className="achievement-toast-timer" aria-hidden="true"><span /></div>
        </article>
      )}
    </div>,
    document.body,
  );
}
