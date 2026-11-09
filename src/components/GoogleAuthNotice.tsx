"use client";

import Link from "next/link";
import { useLayoutCopy } from "@/components/LayoutText";
import { ThemeToggle } from "@/components/ThemeProvider";
import { FantasyCorners } from "@/components/FantasyAccents";
import "./AccountControls.css";
import "./AccountRecovery.css";
import "./GoogleAuth.css";

const messages: Record<string, string> = {
  unavailable: "Google sign-in is not configured in this environment. You can still sign in with email and password.",
  state: "This Google sign-in request expired or could not be verified. Please start again from this browser.",
  cancelled: "Google sign-in was cancelled. Your account has not changed.",
  conflict: "That Google account is already connected to another player, or this player already has a different Google connection. Sign in to the correct account and try again.",
  session: "Your sign-in session changed or expired. Return to your account and start Google linking again from Account Security.",
  profile: "Google could not provide a verified email for this sign-in. Please use a Google account with a verified email address.",
  failed: "Google sign-in could not be completed. Please try again, or use email and password.",
  linked: "Your Google account is connected. You can now use Continue with Google to sign in to this player account.",
};

export default function GoogleAuthNotice({ status }: { status: string }) {
  const copy = useLayoutCopy();
  const message = Object.hasOwn(messages, status) ? messages[status] : messages.failed;
  return <main className="page-shell recovery-shell"><section className="auth-panel recovery-panel" aria-labelledby="google-auth-title">
    <FantasyCorners />
    <header className="auth-heading"><div><p>{copy("ICE SECURITY GATEWAY // GOOGLE ACCESS", "THE ROYAL SEAL · GOOGLE ACCESS")}</p><h1 id="google-auth-title">{status === "linked" ? "Google account linked" : "Google sign-in"}</h1></div></header>
    <ThemeToggle />
    <p className={status === "linked" ? "recovery-success" : "auth-intro"} role="status">{message}</p>
    <nav className="google-notice-links" aria-label="Account access"><Link href="/access" prefetch={false}>Back to sign in</Link><Link href="/" prefetch={false}>Open your library</Link><Link href="/forgot-password" prefetch={false}>Forgot password?</Link></nav>
  </section></main>;
}
