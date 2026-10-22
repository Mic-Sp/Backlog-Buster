"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import { FantasyCorners } from "@/components/FantasyAccents";

import { startTransition, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { getAccountSecuritySummary, updateAccountCredentials, resetOperatorLibrary, wipeOperatorAccount } from "@/app/security-actions";
import { logout } from "@/app/auth-actions";
import { ActionFailure, actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import type { AccountSecuritySummary } from "@/lib/account-security";
import SafeForm from "@/components/SafeForm";
import useCooldown from "@/components/useCooldown";
import "./AccountSecurity.css";

function DeviceLogout() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "DISCONNECTING…" : "LOG OUT OF THIS DEVICE"}</button>;
}

function PasswordField({ label, name, value, onChange, visible, onToggle, required = false, autoFocus = false }: {
  label: string; name: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; required?: boolean; autoFocus?: boolean;
}) {
  const id = useId();
  return <div className="security-password-control"><label htmlFor={id}>{label}</label><div className="security-password-field">
    <input autoFocus={autoFocus} id={id} name={name} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} required={required} minLength={8} maxLength={128} autoComplete={required ? "current-password" : "new-password"} />
    <button type="button" className="security-eye-toggle" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={id} onClick={onToggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
    </button>
  </div></div>;
}

function SecurityPanel({ onClose }: { onClose: () => void }) {
  const copy = useLayoutCopy();
  const [summary, setSummary] = useState<AccountSecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dangerOpen, setDangerOpen] = useState<"reset" | "wipe" | null>(null);
  const [wipePassword, setWipePassword] = useState("");
  const [wipePhrase, setWipePhrase] = useState("");
  const [wipeVisible, setWipeVisible] = useState(false);
  const [wipeError, setWipeError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [currentVisible, setCurrentVisible] = useState(false);
  const [newVisible, setNewVisible] = useState(false);
  const cooldown = useCooldown();
  const busyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const initialRequest = useRef<ReturnType<typeof getAccountSecuritySummary> | null>(null);
  const titleId = useId();

  useEffect(() => {
    let disposed = false;
    initialRequest.current ??= getAccountSecuritySummary();
    void initialRequest.current.then(result => {
      const data = unwrapActionResult(result);
      if (!disposed) { setSummary(data); setNewEmail(data.email); }
    }).catch(cause => { if (!disposed) setError(actionErrorMessage(cause, "Security gateway unavailable. Close and reopen to retry.")); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);

  const locked = saving || deleting;
  const dangerPhrase = dangerOpen === "reset" ? "RESET LIBRARY" : "WIPE ARCHIVE";
  const canWipe = wipePassword.length >= 8 && wipePassword.length <= 128 && Boolean(wipePassword.trim()) && wipePhrase.trim().toUpperCase() === dangerPhrase;

  function setDangerMode(mode: "reset" | "wipe" | null) {
    if (busyRef.current) return;
    setDangerOpen(mode); setConfirmation(""); setWipePassword(""); setWipePhrase(""); setWipeVisible(false); setWipeError("");
  }

  function submitWipe(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setWipeVisible(false); hidePasswords();
    if (!canWipe || busyRef.current || cooldown.seconds > 0) return;
    const form = new FormData(); form.set("currentPassword", wipePassword); form.set("confirmation", wipePhrase);
    busyRef.current = true; setDeleting(true); setWipeError(""); setConfirmation("");
    startTransition(async () => {
      try {
        if (dangerOpen === "reset") {
          const result = unwrapActionResult(await resetOperatorLibrary(form));
          setDangerOpen(null); setConfirmation(result.message);
        } else {
          const result = unwrapActionResult(await wipeOperatorAccount(form));
          // A full navigation also drops private in-memory account/library state.
          window.location.replace(result.redirectTo);
        }
        setWipePassword(""); setWipePhrase(""); setCurrentPassword(""); setNewPassword("");
      } catch (cause) {
        if (cause instanceof ActionFailure) cooldown.start(cause.retryAfterSeconds);
        setWipeError(actionErrorMessage(cause, dangerOpen === "reset" ? "Library reset failed. Please try again." : "Account termination failed. Please try again."));
      } finally { busyRef.current = false; setDeleting(false); }
    });
  }

  function hidePasswords() { setCurrentVisible(false); setNewVisible(false); }
  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); hidePasswords();
    if (!summary || busyRef.current || cooldown.seconds > 0) return;
    setError(""); setConfirmation("");
    if (!currentPassword.trim()) { setError("Enter your current password to authorize changes."); return; }
    const email = newEmail.trim().toLowerCase();
    if (!newPassword && (!email || email === summary.email.toLowerCase())) { setError("Provide a changed email or a new password."); return; }
    if (newPassword && (!newPassword.trim() || newPassword.length < 8 || newPassword.length > 128)) { setError("New passwords must contain 8–128 characters and cannot be only spaces."); return; }
    const form = new FormData(); form.set("currentPassword", currentPassword); form.set("newEmail", email); form.set("newPassword", newPassword);
    busyRef.current = true; setSaving(true);
    startTransition(async () => {
      try {
        const result = unwrapActionResult(await updateAccountCredentials(form));
        setSummary(previous => previous ? { ...previous, email: result.email, sessionExpiresAt: result.sessionExpiresAt } : previous);
        setNewEmail(result.email); setCurrentPassword(""); setNewPassword(""); setConfirmation(result.message);
      } catch (cause) {
        if (cause instanceof ActionFailure) cooldown.start(cause.retryAfterSeconds);
        setError(actionErrorMessage(cause, "Security update unavailable. Please try again."));
      } finally { busyRef.current = false; setSaving(false); }
    });
  }

  return <div className="security-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
    <div className="security-modal" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading || locked}>
            <FantasyCorners />
      <header className="security-modal-heading"><div><p>{copy("ACCOUNT SECURITY // OPERATOR CREDENTIALS", "THE ROYAL SEAL · ACCOUNT SECURITY")}</p><h2 id={titleId}>{copy("ICE SECURITY GATEWAY // OPERATOR CREDENTIALS", "Guard Your Royal Seal")}</h2></div><button type="button" aria-label="Close account security" disabled={locked} onClick={onClose}>✕</button></header>
      {loading && <p role="status">VERIFYING SECURE SESSION…</p>}
      {summary && <>
        <dl className="security-account-summary">
          <div><dt>Registered Email Address</dt><dd>{summary.email}</dd></div>
          <div><dt>{copy("Operator Handle", "Adventurer Handle")}</dt><dd>{summary.handle ? `@${summary.handle}` : "Unclaimed"}</dd></div>
          <div><dt>Account Created Date</dt><dd>{new Date(summary.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</dd></div>
          <div><dt>Active Session Status</dt><dd>● ACTIVE // Expires {new Date(summary.sessionExpiresAt).toLocaleDateString("en-US")}</dd></div>
        </dl>
        <SafeForm action={logout} className="security-device-logout"><fieldset disabled={locked}><DeviceLogout /></fieldset></SafeForm>
        <form className="security-update-form" onSubmit={submit} onInvalidCapture={event => {
          hidePasswords();
          const input = event.target;
          setError(input instanceof HTMLInputElement && input.name === "newEmail" ? "Enter a valid new email address."
            : input instanceof HTMLInputElement && input.name === "currentPassword" ? !input.value.trim() ? "Enter your current password to authorize changes." : "Current password is incorrect."
            : "New passwords must contain 8–128 characters and cannot be only spaces.");
        }}>
          <fieldset disabled={locked || cooldown.seconds > 0}>
            <legend>UPDATE EMAIL &amp; PASSWORD</legend>
            <PasswordField label="Current Password" name="currentPassword" value={currentPassword} onChange={setCurrentPassword} visible={currentVisible} onToggle={() => setCurrentVisible(value => !value)} required />
            <label>New Email <span>(optional)</span><input type="email" name="newEmail" value={newEmail} onChange={event => setNewEmail(event.target.value)} autoComplete="email" maxLength={254} spellCheck={false} autoCapitalize="none" /></label>
            <PasswordField label="New Password" name="newPassword" value={newPassword} onChange={setNewPassword} visible={newVisible} onToggle={() => setNewVisible(value => !value)} />
            <p className="security-hint">8–128 characters. Passwords are salted and hashed on the server.</p>
            <button className="security-save-button" type="submit">{saving ? "VERIFYING & SECURING ARCHIVE…" : cooldown.seconds > 0 ? cooldown.label : "🔐 UPDATE SECURITY CREDENTIALS"}</button>
          </fieldset>
        </form>
      </>}
      {error && <p className="security-error" role="alert">{error}</p>}
      {confirmation && <p className="security-confirmation" role="status">{confirmation}</p>}
      {summary && <section className="security-danger-zone" aria-labelledby={`${titleId}-danger`}>
        <h3 id={`${titleId}-danger`}>{copy("⚠ DANGER ZONE // ARCHIVE TERMINATION", "⚠ DANGER ZONE · IRREVERSIBLE ARCHIVE CHANGES")}</h3>
        {(["reset", "wipe"] as const).map(mode => {
          const isReset = mode === "reset";
          const phrase = isReset ? "RESET LIBRARY" : "WIPE ARCHIVE";
          const expanded = dangerOpen === mode;
          return <div className={`security-danger-option security-${mode}-option`} key={mode}>
            <button className={isReset ? "security-reset-reveal" : "security-wipe-reveal"} type="button" disabled={locked} aria-expanded={expanded} aria-controls={`${titleId}-${mode}-confirm`} onClick={() => setDangerMode(expanded ? null : mode)}>
              {isReset ? "🔄 RESET LIBRARY & TELEMETRY (KEEP ACCOUNT)" : "🗑 WIPE OPERATOR ACCOUNT"}
            </button>
            <p>{isReset ? "Clears all games, custom priority orders, Featured Trophy selections, and unlocked achievements, resetting your operator back to Level 1 with 0 XP. Your login credentials, handle, avatar, tagline, and neon theme will be kept." : "Permanently deletes this operator profile, all games in your library, custom priority orders, and unlocked achievements. This action cannot be undone."}</p>
            {expanded && <form id={`${titleId}-${mode}-confirm`} aria-label={isReset ? "Confirm library reset" : "Confirm account wipe"} onSubmit={submitWipe} onInvalidCapture={() => { setWipeVisible(false); setWipeError(`Enter your current password and type ${phrase}.`); }}>
              <fieldset disabled={locked || cooldown.seconds > 0}>
                <PasswordField label="Current Password" name="currentPassword" value={wipePassword} onChange={setWipePassword} visible={wipeVisible} onToggle={() => setWipeVisible(value => !value)} required autoFocus />
                <label>Type {phrase} to confirm<input name="confirmation" type="text" value={wipePhrase} onChange={event => setWipePhrase(event.target.value)} autoComplete="off" spellCheck={false} maxLength={80} required /></label>
              </fieldset>
              {wipeError && <p className="security-error" role="alert">{wipeError}</p>}
              <div className="security-wipe-actions">
                <button type="button" disabled={locked} onClick={() => setDangerMode(null)}>CANCEL</button>
                <button className={isReset ? "security-reset-confirm" : "security-wipe-confirm"} type="submit" disabled={locked || cooldown.seconds > 0 || !canWipe}>{deleting ? isReset ? "RESETTING LIBRARY…" : "TERMINATING ARCHIVE…" : cooldown.seconds > 0 ? cooldown.label : isReset ? "🔄 CONFIRM LIBRARY RESET" : "⚠ PERMANENTLY WIPE ACCOUNT"}</button>
              </div>
            </form>}
          </div>;
        })}
      </section>}
    </div>
  </div>;
}

export default function AccountSecurity() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <><button className="account-security-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>⚙ ACCOUNT SECURITY</button>{open && createPortal(<SecurityPanel onClose={close} />, document.body)}</>;
}
