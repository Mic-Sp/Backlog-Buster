"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import { FantasyCorners } from "@/components/FantasyAccents";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminPruneExpiredSessions, getAdminSystemOverview, purgeSagaChronologyCache } from "@/app/admin-actions";
import { actionErrorMessage, unwrapActionResult, type ActionError } from "@/lib/action-result";
import AdminPlayerDirectory from "@/components/AdminPlayerDirectory";
import "./AdminControlPanel.css";

type SystemOverview = Exclude<Awaited<ReturnType<typeof getAdminSystemOverview>>, ActionError>;

function AdminPanel({ onClose, currentPlayerId, currentPlayerIsOwner }: { onClose: () => void; currentPlayerId: string; currentPlayerIsOwner: boolean }) {
  const copy = useLayoutCopy();
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [managingPlayers, setManagingPlayers] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const requestRef = useRef<{ version: number; promise: ReturnType<typeof getAdminSystemOverview> } | null>(null);
  const busyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId(), descriptionId = useId();
  const locked = purging || pruning || managingPlayers;
  const onPlayerBusyChange = useCallback((busy: boolean) => { busyRef.current = busy; setManagingPlayers(busy); }, []);
  const onAccountsChanged = useCallback(async () => {
    setOverview(null); setError("");
    try { setOverview(unwrapActionResult(await getAdminSystemOverview())); }
    catch (cause) { setError(actionErrorMessage(cause, "Account updated. Refresh the overview to reload system counts.")); }
  }, []);

  useEffect(() => {
    let disposed = false;
    // Reuse the first request across Strict Mode's effect replay.
    if (requestRef.current?.version !== requestVersion) {
      requestRef.current = { version: requestVersion, promise: getAdminSystemOverview() };
    }
    void requestRef.current.promise.then(result => {
      const data = unwrapActionResult(result);
      if (!disposed) setOverview(data);
    }).catch(cause => {
      if (!disposed) { setOverview(null); setError(actionErrorMessage(cause, "System telemetry unavailable. Try again.")); }
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [requestVersion]);

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
      if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [onClose]);

  function refresh() {
    if (loading || busyRef.current) return;
    setError(""); setLoading(true); setRequestVersion(version => version + 1);
  }

  async function purgeCache() {
    if (loading || busyRef.current || !overview) return;
    busyRef.current = true; setPurging(true); setError(""); setConfirmation("");
    try {
      const result = unwrapActionResult(await purgeSagaChronologyCache({ kind: "all" }));
      setConfirmation(`CACHE RESET COMPLETE // ${result.deletedCount.toLocaleString("en-US")} saga ${result.deletedCount === 1 ? "record" : "records"} cleared.`);
      // Read current counts again: another scan may already have rebuilt a saga.
      setOverview(null);
      try { setOverview(unwrapActionResult(await getAdminSystemOverview())); }
      catch (cause) { setError(actionErrorMessage(cause, "Cache cleared. Telemetry refresh failed; try refreshing the overview.")); }
    } catch (cause) { setError(actionErrorMessage(cause, "Cache reset failed. Please try again.")); }
    finally { busyRef.current = false; setPurging(false); }
  }

  async function pruneSessions() {
    if (loading || busyRef.current) return;
    busyRef.current = true; setPruning(true); setError(""); setConfirmation("");
    try {
      const result = unwrapActionResult(await adminPruneExpiredSessions());
      setConfirmation(`SESSION PRUNE COMPLETE // ${result.deletedCount.toLocaleString("en-US")} expired session ${result.deletedCount === 1 ? "record" : "records"} removed.`);
    } catch (cause) { setError(actionErrorMessage(cause, "Session pruning failed. Please try again.")); }
    finally { busyRef.current = false; setPruning(false); }
  }

  return <div className="admin-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
    <div className="admin-modal" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={loading || locked}>
            <FantasyCorners />
      <header className="admin-modal-heading">
        <div><p>ADMIN // OVERWATCH</p><h2 id={titleId}>{copy("Admin Control Panel", "Royal Administration")}</h2></div>
        <button type="button" aria-label="Close admin control panel" disabled={locked} onClick={onClose}>✕</button>
      </header>
      <p className="admin-hint" id={descriptionId}>{copy("System telemetry, chronology maintenance, and player account controls.", "Realm records, saga chronology maintenance, and player account controls.")}</p>
      <section aria-labelledby={`${titleId}-telemetry`}>
        <div className="admin-section-heading"><h3 id={`${titleId}-telemetry`}>{copy("01 // SYSTEM TELEMETRY", "I · REALM RECORDS")}</h3><button type="button" disabled={loading || locked} onClick={refresh}>REFRESH OVERVIEW</button></div>
        {loading && <p className="admin-hint" role="status">{copy("CONNECTING TO SYSTEM TELEMETRY…", "OPENING THE ROYAL LEDGER…")}</p>}
        {overview && <dl className="admin-telemetry">
          <div><dt>Registered Accounts</dt><dd>{overview.registeredAccountCount.toLocaleString("en-US")}</dd></div>
          <div><dt>Admin Accounts</dt><dd>{overview.adminAccountCount.toLocaleString("en-US")}</dd></div>
          <div><dt>Total Tracked Games</dt><dd>{overview.trackedGameCount.toLocaleString("en-US")}</dd></div>
          <div><dt>Cached Saga Catalogs</dt><dd>{overview.cachedSagaCount.toLocaleString("en-US")}</dd></div>
        </dl>}
      </section>
      <section className="admin-maintenance" aria-labelledby={`${titleId}-maintenance`}>
        <h3 id={`${titleId}-maintenance`}>02 // CACHE &amp; SESSION MAINTENANCE</h3>
        <p className="admin-hint">Clear all shared saga chronology caches. Saved game orders stay intact; future scans rebuild cached timelines.</p>
        <div className="admin-maintenance-actions"><button className="admin-purge-button" type="button" disabled={loading || locked || !overview} onClick={() => void purgeCache()}>{purging ? "CLEARING CACHE // REFRESHING TELEMETRY…" : "RESET SAGA CHRONOLOGY CACHE"}</button><button type="button" disabled={loading || locked} onClick={() => void pruneSessions()}>{pruning ? "PRUNING EXPIRED SESSIONS…" : "PRUNE EXPIRED SESSIONS"}</button></div>
        <p className="admin-hint">Session pruning removes expired login records across all accounts. Active sessions stay connected.</p>
      </section>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {confirmation && <p className="admin-confirmation" role="status">{confirmation}</p>}
      <AdminPlayerDirectory currentPlayerId={currentPlayerId} currentPlayerIsOwner={currentPlayerIsOwner} disabled={loading || locked} onBusyChange={onPlayerBusyChange} onAccountsChanged={onAccountsChanged} />
    </div>
  </div>;
}

export default function AdminControlPanel({ currentPlayerId, currentPlayerIsOwner }: { currentPlayerId: string; currentPlayerIsOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button className="admin-panel-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>ADMIN // OVERWATCH</button>
    {open && createPortal(<AdminPanel onClose={close} currentPlayerId={currentPlayerId} currentPlayerIsOwner={currentPlayerIsOwner} />, document.body)}
  </>;
}
