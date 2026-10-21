"use client";

import { startTransition, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { getAccountSecuritySummary, updateAccountCredentials } from "@/app/security-actions";
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

function PasswordField({ label, name, value, onChange, visible, onToggle, required = false }: {
  label: string; name: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; required?: boolean;
}) {
  const id = useId();
  return <div className="security-password-control"><label htmlFor={id}>{label}</label><div className="security-password-field">
    <input id={id} name={name} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} required={required} minLength={8} maxLength={128} autoComplete={required ? "current-password" : "new-password"} />
    <button type="button" className="security-eye-toggle" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={id} onClick={onToggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>
    </button>
  </div></div>;
}

function SecurityPanel({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<AccountSecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    <div className="security-modal" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading || saving}>
      <header className="security-modal-heading"><div><p>ACCOUNT SECURITY // OPERATOR CREDENTIALS</p><h2 id={titleId}>ICE SECURITY GATEWAY // OPERATOR CREDENTIALS</h2></div><button type="button" aria-label="Close account security" disabled={saving} onClick={onClose}>✕</button></header>
      {loading && <p role="status">VERIFYING SECURE SESSION…</p>}
      {summary && <>
        <dl className="security-account-summary">
          <div><dt>Registered Email Address</dt><dd>{summary.email}</dd></div>
          <div><dt>Operator Handle</dt><dd>{summary.handle ? `@${summary.handle}` : "Unclaimed"}</dd></div>
          <div><dt>Account Created Date</dt><dd>{new Date(summary.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</dd></div>
          <div><dt>Active Session Status</dt><dd>● ACTIVE // Expires {new Date(summary.sessionExpiresAt).toLocaleDateString("en-US")}</dd></div>
        </dl>
        <SafeForm action={logout} className="security-device-logout"><fieldset disabled={saving}><DeviceLogout /></fieldset></SafeForm>
        <form className="security-update-form" onSubmit={submit} onInvalidCapture={event => {
          hidePasswords();
          const input = event.target;
          setError(input instanceof HTMLInputElement && input.name === "newEmail" ? "Enter a valid new email address."
            : input instanceof HTMLInputElement && input.name === "currentPassword" ? !input.value.trim() ? "Enter your current password to authorize changes." : "Current password is incorrect."
            : "New passwords must contain 8–128 characters and cannot be only spaces.");
        }}>
          <fieldset disabled={saving || cooldown.seconds > 0}>
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
    </div>
  </div>;
}

export default function AccountSecurity() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <><button className="account-security-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>⚙ ACCOUNT SECURITY</button>{open && createPortal(<SecurityPanel onClose={close} />, document.body)}</>;
}
