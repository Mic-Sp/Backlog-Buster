"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import "./SteamAuth.css";

export default function SteamAuthButton({ mode = "signin", disabled = false }: { mode?: "signin" | "link"; disabled?: boolean }) {
  const copy = useLayoutCopy();
  return <a className="steam-auth-button" href={disabled ? undefined : `/api/auth/steam?mode=${mode}&theme=${copy("cyberpunk", "fantasy")}`}
    aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="16.5" cy="7.5" r="5" /><circle cx="16.5" cy="7.5" r="2.6" /><circle cx="7" cy="17" r="3.5" />
      <path d="m9.5 19 6.2-6.5M5 14 1 12m0 4 5 3m4-4 2-5" />
    </svg>
    <span>{mode === "link" ? "Verify & Link with Steam" : "Continue with Steam"}</span>
  </a>;
}
