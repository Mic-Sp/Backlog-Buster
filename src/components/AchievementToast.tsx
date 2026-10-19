"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Achievement } from "@/lib/achievements";

const storageKey = "bb_toasted_achievements";

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

export default function AchievementToast({ achievements }: { achievements: Achievement[] }) {
  const [mounted, setMounted] = useState(false);
  const [toastQueue, setToastQueue] = useState<Achievement[]>([]);
  const initiallyLoadedAchievements = useRef(achievements);
  const dismissedKeys = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const activeToast = toastQueue[0] ?? null;

  useEffect(() => {
    // The portal's document.body target exists only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        return additions.length > 0 ? [...queue, ...additions] : queue;
      });
    }
  }, [achievements]);

  const dismissToast = useCallback((key: string) => {
    const stored = readDismissedAchievements();
    for (const dismissed of dismissedKeys.current) stored.add(dismissed);
    stored.add(key);
    dismissedKeys.current.add(key);
    storeDismissedAchievements(stored);
    setToastQueue((queue) => queue.filter((achievement) => achievement.key !== key));
  }, []);

  useEffect(() => {
    if (!mounted || !activeToast) return;
    const dismissTimer = setTimeout(() => dismissToast(activeToast.key), 5000);
    return () => clearTimeout(dismissTimer);
  }, [activeToast, mounted, dismissToast]);

  if (!mounted) return null;

  // Keep the overlay outside library containers, clipping, and local stacking contexts.
  return createPortal(
    <div className="achievement-toast-region" role="status" aria-live="polite" aria-atomic="true">
      {activeToast && (
        <article className="achievement-toast" key={activeToast.key}>
          <div className="achievement-toast-eyebrow">🏆 MILESTONE UNLOCKED // +{activeToast.xpAwarded.toLocaleString("en-US")} XP</div>
          <button className="achievement-toast-dismiss" type="button" aria-label={`Dismiss ${activeToast.title} achievement`} onClick={() => dismissToast(activeToast.key)}>✕</button>
          <div className="achievement-toast-body">
            <div className="achievement-toast-crest" aria-hidden="true">{activeToast.icon}</div>
            <div>
              <h2>{activeToast.title}</h2>
              <p>{activeToast.description}</p>
              <span className="achievement-toast-reward">+{activeToast.xpAwarded.toLocaleString("en-US")} XP</span>
            </div>
          </div>
          <div className="achievement-toast-timer" aria-hidden="true"><span /></div>
        </article>
      )}
    </div>,
    document.body,
  );
}
