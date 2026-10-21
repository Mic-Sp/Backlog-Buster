"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export default function useCooldown() {
  const deadline = useRef(0);
  const [seconds, setSeconds] = useState(0);
  const start = useCallback((value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
    deadline.current = Date.now() + Math.min(Math.ceil(value), 86400) * 1000;
    setSeconds(Math.ceil((deadline.current - Date.now()) / 1000));
  }, []);
  const active = seconds > 0;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [active]);
  return { seconds, start, label: `⏳ COOLING DOWN // ${seconds}s` };
}
