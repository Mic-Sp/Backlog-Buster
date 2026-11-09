"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useLayoutCopy } from "@/components/LayoutText";
import { ThemeToggle } from "@/components/ThemeProvider";
import { FantasyCorners } from "@/components/FantasyAccents";
import useCooldown from "@/components/useCooldown";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { requestPasswordReset, resetPassword, verifyEmail } from "@/app/recovery-actions";
import "./AccountControls.css";
import "./AccountRecovery.css";

export default function AccountRecovery({ mode, token = "", valid = true, initialError = "" }: {
  mode: "forgot" | "reset" | "verify"; token?: string; valid?: boolean; initialError?: string;
}) {
  const copy = useLayoutCopy(), titleId = useId(), messageId = useId();
  const cooldown = useCooldown();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initialError);
  const [done, setDone] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  useEffect(() => {
    // Retain the token only in component memory, not browser history/referrers.
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown.seconds > 0 || !valid || done) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError(""); setPasswordVisible(false);
    try {
      const result = unwrapActionResult(mode === "forgot" ? await requestPasswordReset(form)
        : mode === "reset" ? await resetPassword(token, form) : await verifyEmail(token));
      setMessage(result.message);
      if ("retryAfterSeconds" in result) cooldown.start(result.retryAfterSeconds);
      if (mode !== "forgot") setDone(true);
    } catch (cause) { setError(actionErrorMessage(cause, "Account service unavailable. Please try again.")); }
    finally { setPending(false); }
  }

  const heading = mode === "forgot" ? "Forgot password?" : mode === "reset" ? "Choose a new password" : "Verify your email";
  return <main className="page-shell recovery-shell">
    <section className="auth-panel recovery-panel" aria-labelledby={titleId} aria-busy={pending}>
      <FantasyCorners />
      <header className="auth-heading"><div><p>{copy("ICE SECURITY GATEWAY // ACCOUNT RECOVERY", "THE ROYAL SEAL · ACCOUNT RECOVERY")}</p><h1 id={titleId}>{heading}</h1></div></header>
      <ThemeToggle />
      <p className="auth-intro">{mode === "forgot" ? copy("Recover access to your private archive. Enter your account email and we’ll send a secure reset link.", "Find your way back to the archive. Enter your account email and we’ll send a sealed recovery link.")
        : mode === "reset" ? "Use 8–128 characters. Saving your new password signs out every device."
        : "Confirm this email address for your account. You can continue signing in and using your library while verification is pending."}</p>
      {!valid && !done && !initialError && <p className="auth-error" role="alert">This link is invalid, expired, or already used. Please request a new one.</p>}
      {valid && !done && <form onSubmit={event => void submit(event)}>
        <fieldset disabled={pending}>
          <legend className="auth-sr-only">{heading}</legend>
          {mode === "forgot" && <label>Email<input type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required aria-describedby={messageId} /></label>}
          {mode === "reset" && <>
            <label>New password<input name="password" type={passwordVisible ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby={messageId} /></label>
            <label>Confirm new password<input name="confirmPassword" type={passwordVisible ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} aria-describedby={messageId} /></label>
            <button type="button" aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? "Hide passwords" : "Show passwords"}</button>
          </>}
          <button className="auth-submit" type="submit" disabled={pending || cooldown.seconds > 0}>{pending ? "PLEASE WAIT…" : cooldown.seconds > 0 ? cooldown.label : mode === "forgot" ? "Send password reset link" : mode === "reset" ? "Save new password" : "Verify email address"}</button>
        </fieldset>
      </form>}
      <div id={messageId} aria-live="polite">{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="recovery-success" role="status">{message}</p>}</div>
      {mode === "forgot" && process.env.NODE_ENV !== "production" && <p className="auth-hint">Local development: when email delivery is not configured, reset links appear in the server terminal.</p>}
      <nav className="recovery-links" aria-label="Account recovery navigation">
        <Link href="/access" prefetch={false}>Back to sign in</Link>
        {mode === "reset" && <Link href="/forgot-password" prefetch={false}>Request a new reset link</Link>}
        {mode === "verify" && <Link href="/" prefetch={false}>{done ? "Open your library" : "Resend from Account Security"}</Link>}
      </nav>
    </section>
  </main>;
}
