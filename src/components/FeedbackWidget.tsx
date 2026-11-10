"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { feedbackCategories, feedbackMessageLimit, type FeedbackCategory } from "@/lib/feedback-schema";
import "./FeedbackWidget.css";

export default function FeedbackWidget() {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [pathname, setPathname] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    messageRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (status !== "success") return;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setMessage("");
      setCategory("bug");
      setStatus("idle");
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [status]);

  function launch() {
    // Read browser-only metadata on interaction; the initial HTML is stable on
    // every route, including rewrites and dynamically rendered public dossiers.
    setPathname(window.location.pathname);
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || status === "success") return;
    if (message.trim().length < 10) {
      setError("Please include at least 10 characters so we can understand your feedback.");
      setStatus("error");
      messageRef.current?.focus();
      return;
    }
    busy.current = true;
    setError("");
    setStatus("submitting");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ category, message: message.trim(), pathname, metadata: {
          userAgent: navigator.userAgent.slice(0, 1024),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        } }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new Error(response.status === 429 && retryAfter > 0
          ? `Please wait ${Math.ceil(retryAfter / 60)} minute(s) before sending more feedback. Your draft is safe.`
          : typeof result.error === "string" ? result.error : "Feedback could not be sent. Your draft is safe; please try again.");
      }
      setStatus("success");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error && cause.name === "Error" ? cause.message : "Connection interrupted. Your draft is safe; please try again.");
    } finally { busy.current = false; }
  }

  const submitting = status === "submitting";
  return <>
    <button ref={triggerRef} type="button" className="feedback-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-dialog`} onClick={launch}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M7 9h10M7 13h7" /></svg>
      <span>Feedback</span>
    </button>
    {!open && status === "success" && <div className="feedback-acknowledgment" role="status">Thanks! Your feedback was received.</div>}
    <dialog ref={dialogRef} id={`${id}-dialog`} className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} onCancel={event => { event.preventDefault(); setOpen(false); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false);
    }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="feedback-heading">
        <div><p className="feedback-eyebrow">BACKLOG BUSTER / BETA</p><h2 id={`${id}-title`}>Share feedback</h2></div>
        <button type="button" className="feedback-close" aria-label="Close feedback" onClick={() => setOpen(false)}>×</button>
      </header>
      <p id={`${id}-intro`}>Found a bug or have an idea? Help shape your next session.</p>
      <form onSubmit={submit} aria-busy={submitting}>
        <fieldset disabled={submitting || status === "success"}>
          <label htmlFor={`${id}-category`}>Category</label>
          <select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value as FeedbackCategory)}>
            {Object.entries(feedbackCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label htmlFor={`${id}-message`}>Your feedback</label>
          <textarea ref={messageRef} id={`${id}-message`} rows={5} required maxLength={feedbackMessageLimit} value={message} aria-invalid={status === "error" && message.trim().length < 10} aria-describedby={`${id}-hint${status === "error" ? ` ${id}-error` : ""}`} placeholder={category === "bug" ? "What happened, and what did you expect?" : "What would make Backlog Buster better for you?"} onChange={event => { setMessage(event.target.value); if (status === "error") { setStatus("idle"); setError(""); } }} />
          <div className="feedback-message-hint" id={`${id}-hint`}><span>10–3,000 characters</span><span>{message.length.toLocaleString("en-US")} / 3,000</span></div>
        </fieldset>
        <p className="feedback-context">Includes this page’s path, browser, and screen size, plus your account ID and email if signed in. Please leave out passwords and other sensitive details.</p>
        {status === "error" && <p className="feedback-error" id={`${id}-error`} role="alert">{error}</p>}
        <div className="feedback-status" role="status" aria-live="polite">
          {submitting && <span><i className="feedback-spinner" aria-hidden="true" /> Sending feedback…</span>}
          {status === "success" && <span>✓ Thanks! Your feedback was received.</span>}
        </div>
        <footer className="feedback-actions"><button type="button" onClick={() => setOpen(false)}>{status === "success" ? "Done" : "Cancel"}</button><button type="submit" className="feedback-submit" disabled={submitting || status === "success"}>{submitting ? "Sending…" : "Send feedback"}</button></footer>
      </form>
    </dialog>
  </>;
}
