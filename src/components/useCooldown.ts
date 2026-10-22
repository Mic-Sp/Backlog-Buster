"use client";

import { useCallback, useEffect, useState } from "react";
import { cooldownLabel } from "@/lib/cooldown";

export default function useCooldown() {
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const start = useCallback((value: unknown, startedAt = Date.now()) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !Number.isFinite(startedAt)) return;
    const until = startedAt + Math.min(Math.ceil(value), 86400) * 1000;
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    // A shorter concurrent response must not erase a longer provider cooldown.
    setDeadline((current) => Math.max(current, until));
    setSeconds((current) => Math.max(current, remaining));
  }, []);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return { seconds, start, label: cooldownLabel(seconds) };
}
