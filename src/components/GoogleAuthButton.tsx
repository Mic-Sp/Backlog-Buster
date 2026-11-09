"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import "./GoogleAuth.css";

export default function GoogleAuthButton({ mode = "signin", disabled = false }: { mode?: "signin" | "link"; disabled?: boolean }) {
  const copy = useLayoutCopy();
  const href = `/api/auth/google?mode=${mode}&theme=${copy("cyberpunk", "fantasy")}`;
  return <a className="google-oauth-button" href={disabled ? undefined : href} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
    <svg className="google-oauth-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="#4285f4" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.4c2-1.8 2.9-4.4 2.9-7.6Z" />
      <path fill="#34a853" d="M12 22c2.8 0 5.1-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1.9-3.5.9a6 6 0 0 1-5.6-4.1H2.9v2.7A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.4 13.7a6 6 0 0 1 0-3.4V7.6H2.9a10 10 0 0 0 0 8.8l3.5-2.7Z" />
      <path fill="#ea4335" d="M12 6.2c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9.1 5.6l3.5 2.7A6 6 0 0 1 12 6.2Z" />
    </svg>
    {mode === "link" ? "Link Google Account" : "Continue with Google"}
  </a>;
}
