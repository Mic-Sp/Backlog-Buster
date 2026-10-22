"use client";

import { useEffect, useId, useRef, useState } from "react";
import { adminDeletePlayerAccount, adminResetPlayerPassword, adminUpdatePlayerEmail, getAdminPlayerDirectory } from "@/app/admin-actions";
import { actionErrorMessage, unwrapActionResult, type ActionError } from "@/lib/action-result";
import { isValidPassword } from "@/lib/password-validation";
import { isValidEmail, normalizeEmail } from "@/lib/email-validation";

type PlayerDirectory = Exclude<Awaited<ReturnType<typeof getAdminPlayerDirectory>>, ActionError>;
const pageSize = 10;
const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export default function AdminPlayerDirectory({ disabled, onBusyChange, onDeleted }: {
  disabled: boolean; onBusyChange: (busy: boolean) => void; onDeleted: () => Promise<void>;
}) {
  const [directory, setDirectory] = useState<PlayerDirectory | null>(null);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [emailId, setEmailId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<{ id: string; error: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ id: string; kind: "reset" | "email" | "delete" } | null>(null);
  const mutationRef = useRef(false);
  const requestRef = useRef<{ key: string; promise: ReturnType<typeof getAdminPlayerDirectory> } | null>(null);
  const headingId = useId();
  const locked = disabled || loading || Boolean(pending);

  useEffect(() => {
    let disposed = false, redirected = false;
    const key = `${page}:${version}`;
    if (requestRef.current?.key !== key) requestRef.current = { key, promise: getAdminPlayerDirectory(page, pageSize) };
    void requestRef.current.promise.then(result => {
      const data = unwrapActionResult(result);
      if (disposed) return;
      if (page > Math.max(1, data.pageCount)) {
        redirected = true; setPage(Math.max(1, data.pageCount)); return;
      }
      setDirectory(data);
    }).catch(cause => {
      if (!disposed) { setDirectory(null); setError(actionErrorMessage(cause, "Player directory unavailable. Try refreshing the directory.")); }
    }).finally(() => { if (!disposed && !redirected) setLoading(false); });
    return () => { disposed = true; };
  }, [page, version]);

  function clearSelection() { setResetId(null); setDeleteId(null); setEmailId(null); setEmail(""); setPassword(""); setFeedback(null); }
  function reload(nextPage = page) {
    if (mutationRef.current) return;
    clearSelection(); setError(""); setLoading(true); setPage(nextPage); setVersion(current => current + 1);
  }

  async function resetPassword(event: React.SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (locked || mutationRef.current || resetId !== id) return;
    if (!isValidPassword(password)) {
      setFeedback({ id, error: true, text: "New passwords must contain 8–128 characters and cannot be only spaces." }); return;
    }
    mutationRef.current = true; onBusyChange(true); setPending({ id, kind: "reset" }); setFeedback(null);
    try {
      unwrapActionResult(await adminResetPlayerPassword(id, password));
      setPassword(""); setFeedback({ id, error: false, text: "PASSWORD UPDATED // All sessions revoked. This player must sign in with the new password." });
    } catch (cause) { setFeedback({ id, error: true, text: actionErrorMessage(cause, "Password reset failed. Please try again.") }); }
    finally { mutationRef.current = false; setPending(null); onBusyChange(false); }
  }

  async function updateEmail(event: React.SubmitEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (locked || mutationRef.current || emailId !== id) return;
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setFeedback({ id, error: true, text: "Enter a valid new email address (up to 254 characters)." }); return;
    }
    if (normalized === directory?.players.find(player => player.id === id)?.email?.toLowerCase()) {
      setFeedback({ id, error: true, text: "Provide a changed email address." }); return;
    }
    mutationRef.current = true; onBusyChange(true); setPending({ id, kind: "email" }); setFeedback(null);
    try {
      const result = unwrapActionResult(await adminUpdatePlayerEmail(id, normalized));
      setDirectory(current => current ? { ...current, players: current.players.map(player => player.id === id ? { ...player, email: result.email } : player) } : null);
      setEmail(result.email);
      setFeedback({ id, error: false, text: "EMAIL UPDATED // All sessions revoked. This player must sign in with the new email address." });
    } catch (cause) { setFeedback({ id, error: true, text: actionErrorMessage(cause, "Email update failed. Please try again.") }); }
    finally { mutationRef.current = false; setPending(null); onBusyChange(false); }
  }

  async function deleteAccount(id: string) {
    // Selection alone never calls the destructive action; a separate confirmation
    // button is required, and admin status is checked again on the server.
    if (locked || mutationRef.current || deleteId !== id || directory?.players.find(player => player.id === id)?.isAdmin !== false) return;
    mutationRef.current = true; onBusyChange(true); setPending({ id, kind: "delete" }); setFeedback(null); setNotice("");
    try {
      unwrapActionResult(await adminDeletePlayerAccount(id));
      setDirectory(current => current ? { ...current, players: current.players.filter(player => player.id !== id) } : null);
      setDeleteId(null); setNotice(`ACCOUNT WIPED // ${id} and its sessions, games, and achievements were removed.`);
      setError(""); setLoading(true); setVersion(current => current + 1);
      await onDeleted();
    } catch (cause) { setFeedback({ id, error: true, text: actionErrorMessage(cause, "Account deletion failed. Please try again.") }); }
    finally { mutationRef.current = false; setPending(null); onBusyChange(false); }
  }

  return <section className="admin-directory" aria-labelledby={headingId} aria-busy={loading || Boolean(pending)}>
    <div className="admin-section-heading"><h3 id={headingId}>03 // PLAYER DIRECTORY</h3><button type="button" disabled={locked} onClick={() => reload()}>REFRESH DIRECTORY</button></div>
    <p className="admin-hint">Registered operators and account controls. Activity reflects the latest saved records.</p>
    {loading && <p className="admin-hint" role="status">LOADING PLAYER DIRECTORY…</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p className="admin-confirmation" role="status">{notice}</p>}
    {directory && <>
      <p className="admin-hint">{directory.totalCount.toLocaleString("en-US")} registered {directory.totalCount === 1 ? "account" : "accounts"}{" // Page "}{directory.page} of {Math.max(1, directory.pageCount)}</p>
      {!directory.players.length && !loading && <p className="admin-hint">No registered player accounts to display.</p>}
      <ul className="admin-player-list">{directory.players.map(player => {
        const rowId = `${headingId}-${player.id}`, resetting = resetId === player.id, editingEmail = emailId === player.id, confirming = deleteId === player.id;
        const rowFeedback = feedback?.id === player.id ? feedback : null;
        return <li className="admin-player-row" key={player.id}>
          <article aria-labelledby={rowId}>
            <header className="admin-player-heading"><div><h4 id={rowId}>{player.operatorName}</h4><p className="admin-player-identifier">{player.handle ? `@${player.handle}` : player.id}</p>{player.handle && <p className="admin-player-id">{player.id}</p>}<p className="admin-player-email">{player.email || "Email not set"}</p></div><span className="admin-role-badge" data-admin={player.isAdmin}>{player.isAdmin ? "ADMIN" : "PLAYER"}</span></header>
            <dl className="admin-player-stats">
              <div><dt>Games</dt><dd>{player.gameCount.toLocaleString("en-US")}</dd></div>
              <div><dt>XP / Level</dt><dd>{player.totalXp.toLocaleString("en-US")} XP // LV {player.level}</dd></div>
              <div><dt>Created</dt><dd><time dateTime={player.createdAt}>{dateLabel(player.createdAt)}</time></dd></div>
              <div><dt>Last Recorded Activity</dt><dd><time dateTime={player.lastRecordedActivityAt}>{dateLabel(player.lastRecordedActivityAt)}</time></dd></div>
            </dl>
            <div className="admin-player-actions">
              <button type="button" disabled={locked} aria-expanded={resetting} aria-controls={`${rowId}-reset`} onClick={() => { clearSelection(); if (!resetting) setResetId(player.id); }}>RESET PASSWORD</button>
              <button type="button" disabled={locked} aria-expanded={editingEmail} aria-controls={`${rowId}-email-edit`} onClick={() => { clearSelection(); if (!editingEmail) { setEmailId(player.id); setEmail(player.email ?? ""); } }}>UPDATE EMAIL</button>
              {!player.isAdmin && <button className="admin-delete-button" type="button" disabled={locked} aria-expanded={confirming} aria-controls={`${rowId}-delete`} onClick={() => { clearSelection(); if (!confirming) setDeleteId(player.id); }}>DELETE ACCOUNT</button>}
              {player.isAdmin && <span className="admin-hint">ADMIN ACCOUNT // DELETION PROTECTED</span>}
            </div>
            {resetting && <form className="admin-password-reset" id={`${rowId}-reset`} noValidate onSubmit={event => void resetPassword(event, player.id)}>
              <label htmlFor={`${rowId}-password`}>New password for {player.handle ? `@${player.handle}` : player.id}</label>
              <p className="admin-hint" id={`${rowId}-password-help`}>8–128 characters; cannot be only spaces. Resetting signs this player out of every device.</p>
              <input id={`${rowId}-password`} type="password" name="newPassword" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={locked} aria-describedby={`${rowId}-password-help`} />
              <div className="admin-player-actions"><button type="submit" disabled={locked}>{pending?.id === player.id && pending.kind === "reset" ? "RESETTING PASSWORD…" : "SAVE NEW PASSWORD"}</button><button type="button" disabled={locked} onClick={clearSelection}>CANCEL RESET</button></div>
            </form>}
            {editingEmail && <form className="admin-email-update" id={`${rowId}-email-edit`} noValidate onSubmit={event => void updateEmail(event, player.id)}>
              <label htmlFor={`${rowId}-email`}>New email for {player.handle ? `@${player.handle}` : player.id}</label>
              <p className="admin-hint" id={`${rowId}-email-help`}>Use a valid email address, up to 254 characters. Updating signs this player out of every device.</p>
              <input id={`${rowId}-email`} type="email" name="newEmail" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="New email address" required disabled={locked} aria-invalid={rowFeedback?.error || undefined} aria-describedby={`${rowId}-email-help${rowFeedback ? ` ${rowId}-feedback` : ""}`} />
              <div className="admin-player-actions"><button type="submit" disabled={locked}>{pending?.id === player.id && pending.kind === "email" ? "UPDATING EMAIL…" : "SAVE NEW EMAIL"}</button><button type="button" disabled={locked} onClick={clearSelection}>CANCEL EMAIL UPDATE</button></div>
            </form>}
            {confirming && <div className="admin-delete-confirmation" id={`${rowId}-delete`} role="group" aria-label={`Confirm deletion of ${player.handle ? `@${player.handle}` : player.id}`}>
              <p>Wipe {player.email ?? player.handle ?? player.id}? This permanently removes their account, sessions, games, and achievements.</p>
              <div className="admin-player-actions"><button type="button" disabled={locked} onClick={clearSelection}>CANCEL DELETION</button><button className="admin-delete-button" type="button" disabled={locked} onClick={() => void deleteAccount(player.id)}>{pending?.id === player.id && pending.kind === "delete" ? "WIPING ACCOUNT…" : "CONFIRM WIPE"}</button></div>
            </div>}
            {rowFeedback && <p id={`${rowId}-feedback`} className={rowFeedback.error ? "admin-error" : "admin-confirmation"} role={rowFeedback.error ? "alert" : "status"}>{rowFeedback.text}</p>}
          </article>
        </li>;
      })}</ul>
      <nav className="admin-directory-pages" aria-label="Player directory pages"><button type="button" disabled={locked || page <= 1} onClick={() => reload(page - 1)}>PREVIOUS PAGE</button><button type="button" disabled={locked || page >= directory.pageCount} onClick={() => reload(page + 1)}>NEXT PAGE</button></nav>
    </>}
  </section>;
}
