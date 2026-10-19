"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { bulkImportGames } from "@/app/actions";
import type { LibraryGame } from "@/components/GameLibrary";
import { serializeLibraryBackup } from "@/lib/library-backup";

export default function LibraryDataVault({ games }: { games: LibraryGame[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"titles" | "json">("titles");
  const [titles, setTitles] = useState("");
  const [json, setJson] = useState("");
  const [defaultPlatform, setDefaultPlatform] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isImporting, startImporting] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = isImporting || isReading;

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) setIsOpen(false);
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const controls = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
      );
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (!first) {
        event.preventDefault();
        dialog?.focus();
      } else if (!dialog?.contains(document.activeElement) || document.activeElement === dialog ||
        (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, busy]);

  function exportBackup(format: "json" | "csv") {
    setError("");
    try {
      const blob = new Blob([serializeLibraryBackup(games, format)], {
        type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
      });
      const date = new Date();
      const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `backlog-buster-backup-${stamp}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Could not create the backup. Please try again.");
    }
  }

  function importGames() {
    if (busy) return;
    setMessage("");
    setError("");
    startImporting(async () => {
      try {
        const result = await bulkImportGames({ mode, content: mode === "titles" ? titles : json, defaultPlatform });
        setMessage(`Imported ${result.importedCount} games (${result.skippedCount} duplicates skipped)`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Import failed. Please try again.");
      }
    });
  }

  return (
    <>
      <button className="vault-trigger-button" type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => setIsOpen(true)}>
        🗄️ DATA VAULT // IMPORT &amp; EXPORT
      </button>
      {isOpen && createPortal(
        <div className="vault-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setIsOpen(false);
        }}>
          <div className="vault-modal" role="dialog" aria-modal="true" aria-labelledby="vault-title" aria-busy={busy} tabIndex={-1} ref={dialogRef}>
            <header className="vault-modal-header">
              <div><p className="eyebrow">LOCAL ARCHIVE // LIBRARY TRANSFER</p><h2 id="vault-title">Data Vault</h2></div>
              <button className="vault-close" type="button" aria-label="Close Data Vault" disabled={busy} onClick={() => setIsOpen(false)}>✕</button>
            </header>
            <section className="vault-section" aria-labelledby="vault-export-title">
              <h3 id="vault-export-title">01 // EXPORT BACKUP</h3>
              <p>Download all {games.length} games, including ratings, progress, and field logs.</p>
              <div className="vault-actions">
                <button type="button" onClick={() => exportBackup("json")}>⬇ EXPORT JSON</button>
                <button type="button" onClick={() => exportBackup("csv")}>⬇ EXPORT CSV</button>
              </div>
            </section>
            <section className="vault-section" aria-labelledby="vault-import-title">
              <h3 id="vault-import-title">02 // BULK IMPORT</h3>
              <div className="vault-tabs" role="group" aria-label="Import format">
                {(["titles", "json"] as const).map((value) => (
                  <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setMessage(""); setError(""); }}>
                    {value === "titles" ? "Quick Title List" : "Restore JSON Backup"}
                  </button>
                ))}
              </div>
              {mode === "titles" ? (
                <>
                  <p>One Title or Title | Platform per line. Only the first 25 titles are imported per batch; metadata is fetched automatically.</p>
                  <label className="vault-field">Default Platform (optional)
                    <input value={defaultPlatform} onChange={(event) => setDefaultPlatform(event.target.value)} maxLength={80} placeholder="PC, Switch, PS5…" disabled={busy} />
                  </label>
                  <label className="vault-field">Game titles
                    <textarea rows={6} value={titles} onChange={(event) => setTitles(event.target.value)} placeholder={"Cyberpunk 2077 | PC\nHades | Switch"} disabled={busy} />
                  </label>
                </>
              ) : (
                <>
                  <p>Choose or paste a JSON array of up to 200 games (500 KB maximum). Existing title/platform pairs are skipped.</p>
                  <label className="vault-field">JSON backup file
                    <input type="file" accept=".json,application/json" disabled={busy} onChange={async (event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      setError(""); setMessage("");
                      if (file.size > 500000) { setError("Choose a JSON backup under 500 KB."); return; }
                      setIsReading(true);
                      try { setJson(await file.text()); }
                      catch { setError("Could not read the selected backup."); }
                      finally { setIsReading(false); }
                    }} />
                  </label>
                  <label className="vault-field">JSON backup contents
                    <textarea rows={6} value={json} onChange={(event) => setJson(event.target.value)} placeholder='[{"title":"Hades","platform":"PC"}]' spellCheck={false} disabled={busy} />
                  </label>
                </>
              )}
              <button className="vault-import-button" type="button" onClick={importGames} disabled={busy || !(mode === "titles" ? titles : json).trim()}>
                {isReading ? "READING BACKUP…" : isImporting ? "IMPORTING GAMES…" : "IMPORT GAMES"}
              </button>
              <p className="vault-message" role="status" aria-live="polite">{message}</p>
              {error && <p className="vault-error" role="alert">{error}</p>}
            </section>
          </div>
        </div>, document.body,
      )}
    </>
  );
}
