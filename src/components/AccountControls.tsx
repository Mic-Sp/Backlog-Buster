"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { authenticate, logout } from "@/app/auth-actions";
import SafeForm from "@/components/SafeForm";
import type { CurrentPlayer } from "@/lib/player";
import "./AccountControls.css";

function LogoutButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "DISCONNECTING…" : "LOG OUT"}</button>;
}

function AuthPanel({ localArchive = false, onClose }: { localArchive?: boolean; onClose?: () => void }) {
  const [mode, setMode] = useState<"login" | "register">(localArchive ? "register" : "login");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [clientError, setClientError] = useState("");
  const [state, action, pending] = useActionState(authenticate.bind(null, mode), {});
  const pendingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId(), errorId = useId(), passwordId = useId();
  function switchMode(next: "login" | "register") {
    setClientError("");
    setPasswordVisible(false);
    setMode(next);
  }
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => {
    if (!onClose) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) { event.preventDefault(); onClose?.(); }
      if (event.key !== "Tab") return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);
  useEffect(() => { emailRef.current?.focus(); }, [mode]);
  const error = clientError || (state.mode === mode ? state.error : undefined);
  const panel = <div className="auth-panel" ref={panelRef} role={onClose ? "dialog" : undefined} aria-modal={onClose ? true : undefined} aria-labelledby={titleId} aria-busy={pending}>
    <header className="auth-heading">
      <div><p>ICE GATEWAY // OPERATOR AUTHENTICATION</p><h2 id={titleId}>{localArchive ? "Claim Your Archive" : "Netrunner Access"}</h2></div>
      {onClose && <button className="auth-close" type="button" aria-label="Close account dialog" disabled={pending} onClick={onClose}>✕</button>}
    </header>
    <p className="auth-intro">{localArchive ? "Your first account inherits this local library, XP, trophies, and dossier. Nothing is moved or deleted." : "Sign in to your private library, or register a new operator with an empty archive."}</p>
    <div className="auth-tabs" role="group" aria-label="Account access">
      <button type="button" aria-pressed={mode === "login"} disabled={pending} onClick={() => switchMode("login")}>LOGIN</button>
      <button type="button" aria-pressed={mode === "register"} disabled={pending} onClick={() => switchMode("register")}>{localArchive ? "REGISTER // CLAIM ARCHIVE" : "REGISTER // NEW ARCHIVE"}</button>
    </div>
    <form action={action} key={mode} onInvalidCapture={(event) => {
      const field = event.target;
      if (field instanceof HTMLInputElement) setClientError(field.name === "email" ? "Enter a valid email address." : field.name === "password" ? "Use a password of 8–128 characters." : `Enter a valid ${field.name === "handle" ? "handle" : "operator name"} or leave it empty.`);
    }} onSubmit={(event) => {
      setPasswordVisible(false);
      setClientError("");
      const data = new FormData(event.currentTarget);
      if (!String(data.get("email") ?? "").trim()) { event.preventDefault(); setClientError("Enter a valid email address."); return; }
      if (!String(data.get("password") ?? "").trim()) { event.preventDefault(); setClientError("Please enter a password."); return; }
      for (const name of ["email", "handle", "operatorName"]) {
        const field = event.currentTarget.elements.namedItem(name);
        if (field instanceof HTMLInputElement) {
          if (name !== "email" && field.value !== "" && !field.value.trim()) { event.preventDefault(); setClientError(`Enter a valid ${name === "handle" ? "handle" : "operator name"} or leave it empty.`); return; }
          field.value = field.value.trim();
        }
      }
    }}>
      <fieldset disabled={pending}>
        <legend className="auth-sr-only">{mode === "register" ? "Register account" : "Log in"}</legend>
        <label>Email<input ref={emailRef} type="email" name="email" autoComplete="username" maxLength={254} required spellCheck={false} autoCapitalize="none" aria-describedby={error ? errorId : undefined} /></label>
        <label htmlFor={passwordId}>Password</label>
        <div className="auth-password-field">
          <input id={passwordId} type={passwordVisible ? "text" : "password"} name="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} maxLength={128} required aria-describedby={error ? errorId : undefined} />
          <button className="auth-password-toggle" type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} aria-controls={passwordId} title={passwordVisible ? "Hide password" : "Show password"} onClick={() => setPasswordVisible((visible) => !visible)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {passwordVisible && <path d="m3 3 18 18" />}
            </svg>
          </button>
        </div>
        <p className="auth-hint">8–128 characters. Passwords are salted and hashed on the server.</p>
        {mode === "register" && <>
          <label>Handle <span>(optional)</span><input name="handle" autoComplete="off" maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,23}" title="3–24 letters, numbers, underscores or hyphens" spellCheck={false} autoCapitalize="none" placeholder="night-city-runner" /></label>
          <label>Operator name <span>(optional)</span><input name="operatorName" autoComplete="nickname" maxLength={28} placeholder="ANONYMOUS NETRUNNER" /></label>
        </>}
      </fieldset>
      {error && <p className="auth-error" role="alert" id={errorId}>{error}</p>}
      <button className="auth-submit" type="submit" disabled={pending}>{pending ? "VERIFYING IDENTITY…" : mode === "login" ? "▶ SIGN IN" : localArchive ? "⚡ CREATE ACCOUNT & CLAIM ARCHIVE" : "⚡ CREATE NETRUNNER ACCOUNT"}</button>
    </form>
    <p className="auth-hint">{localArchive ? "Only the first registration claims the local archive. Later accounts start fresh." : "Sessions expire after 7 days. Log out to revoke this device’s session."}</p>
  </div>;
  return onClose ? <div className="auth-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !pendingRef.current) onClose(); }}>{panel}</div> : panel;
}

export function AccountGate() {
  return <section className="auth-gate"><p className="auth-gate-eyebrow">ARCHIVE LOCKED // IDENTIFY YOURSELF</p><AuthPanel /></section>;
}

export default function AccountControls({ player }: { player: CurrentPlayer }) {
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  return <div className="account-controls">
    {player.isLocal ? <button className="account-claim-button" type="button" aria-haspopup="dialog" onClick={() => setIsOpen(true)}>⚡ CLAIM NETRUNNER ACCOUNT // SIGN IN</button> : <>
      <p className="account-operator"><span>CONNECTED //</span> {player.operatorName}{player.handle && <small>@{player.handle}</small>}</p>
      <SafeForm action={logout}><LogoutButton /></SafeForm>
    </>}
    {isOpen && createPortal(<AuthPanel localArchive={player.isLocal} onClose={close} />, document.body)}
  </div>;
}
