"use client";

import Link from "next/link";
import { useLayoutCopy } from "@/components/LayoutText";
import { ThemeToggle } from "@/components/ThemeProvider";
import { FantasyCorners } from "@/components/FantasyAccents";
import "./AccountControls.css";
import "./AccountRecovery.css";
import "./SteamAuth.css";

const messages: Record<string, string> = {
  state: "This Steam request expired or has already been used. Please start again from this browser.",
  cancelled: "Steam sign-in was cancelled. Your account has not changed.",
  session: "Your session changed or expired. Sign in again, then start Steam linking from Account Security.",
  conflict: "That Steam account is already verified by another player, or this player has a different verified Steam account. Sign in to the correct player account and try again.",
  failed: "Steam sign-in could not be verified. Please try again from the sign-in page or Account Security.",
  linked: "Steam ownership verified. You can now use Continue with Steam to sign in to this same player account. Your library, credentials, and saved sync profile are kept.",
};
export default function SteamAuthNotice({ status }: { status: string }) {
  const copy = useLayoutCopy();
  return <main className="page-shell recovery-shell"><section className="auth-panel recovery-panel" aria-labelledby="steam-auth-title">
    <FantasyCorners />
    <header className="auth-heading"><div><p>{copy("ICE SECURITY GATEWAY // STEAM ACCESS", "THE ROYAL SEAL · STEAM ACCESS")}</p><h1 id="steam-auth-title">{status === "linked" ? "Steam account verified" : "Steam sign-in"}</h1></div></header>
    <ThemeToggle />
    <p className={status === "linked" ? "recovery-success" : "auth-intro"} role="status">{Object.hasOwn(messages, status) ? messages[status] : messages.failed}</p>
    <nav className="steam-notice-links" aria-label="Account access"><Link href="/access" prefetch={false}>Back to sign in</Link><Link href="/" prefetch={false}>Open your library</Link></nav>
  </section></main>;
}
