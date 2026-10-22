"use client";

import { useLayoutCopy } from "@/components/LayoutText";
import { FantasyCorners } from "@/components/FantasyAccents";

import { unwrapActionResult } from "@/lib/action-result";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { bulkImportGames, exportLibraryBackup } from "@/app/actions";
import type { LibraryGame } from "@/components/GameLibrary";
import { MAX_IMPORT_BYTES } from "@/lib/library-import";

export function useLibraryDataVaultController({ games }: { games: LibraryGame[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"titles" | "json" | "csv">("titles");
  const [titles, setTitles] = useState("");
  const [json, setJson] = useState("");
  const [defaultPlatform, setDefaultPlatform] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const requestInFlight = useRef(false);
  const [isImporting, startImporting] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busy = isImporting || isReading || isExporting;

  useEffect(() => {
    if (!isOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      // Restore to the current layout's trigger; the previous one may have unmounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      triggerRef.current?.focus();
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

  async function exportBackup(format: "json" | "csv") {
    if (busy || requestInFlight.current) return;
    requestInFlight.current = true; setIsExporting(true);
    setError(""); setMessage("");
    try {
      const backup = unwrapActionResult(await exportLibraryBackup(format));
      const blob = new Blob([backup.content], {
        type: format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the backup. Please try again.");
    } finally { requestInFlight.current = false; setIsExporting(false); }
  }

  function importGames() {
    if (busy || requestInFlight.current) return;
    requestInFlight.current = true;
    setMessage("");
    setError("");
    startImporting(async () => {
      try {
        const result = unwrapActionResult(await bulkImportGames({ mode, content: mode === "titles" ? titles : json, defaultPlatform }));
        setMessage(`Imported ${result.importedCount} games (${result.duplicateCount} duplicates skipped, ${result.invalidCount} invalid/blank rows skipped)`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Import failed. Please try again.");
      } finally { requestInFlight.current = false; }
    });
  }

  function open() { setIsOpen(true); }
  function close() { if (!busy) setIsOpen(false); }

  return {
    open,
    close,
    games,
    isOpen,
    setIsOpen,
    mode,
    setMode,
    titles,
    setTitles,
    json,
    setJson,
    defaultPlatform,
    setDefaultPlatform,
    message,
    setMessage,
    error,
    setError,
    isReading,
    setIsReading,
    isImporting,
    triggerRef,
    dialogRef,
    busy,
    exportBackup,
    importGames,
  };
}

export type LibraryDataVaultController = ReturnType<typeof useLibraryDataVaultController>;

export default function LibraryDataVault(props: Parameters<typeof useLibraryDataVaultController>[0]) {
  const controller = useLibraryDataVaultController(props);
  return <LibraryDataVaultView controller={controller} />;
}

export function LibraryDataVaultView({ controller, part = "all" }: { controller: LibraryDataVaultController; part?: "all" | "trigger" | "overlay" }) {
  const copy = useLayoutCopy();
  const {
    open,
    close,
    games,
    isOpen,
    setIsOpen,
    mode,
    setMode,
    titles,
    setTitles,
    json,
    setJson,
    defaultPlatform,
    setDefaultPlatform,
    message,
    setMessage,
    error,
    setError,
    isReading,
    setIsReading,
    isImporting,
    triggerRef,
    dialogRef,
    busy,
    exportBackup,
    importGames,
  } = controller;
  return (
    <>
      {part !== "overlay" && (<button className="vault-trigger-button" type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={isOpen} onClick={open}>
        🗄️ DATA VAULT // IMPORT &amp; EXPORT
      </button>)}
      {part !== "trigger" && isOpen && createPortal(
        <div className="vault-modal-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setIsOpen(false);
        }}>
          <div className="vault-modal" role="dialog" aria-modal="true" aria-labelledby="vault-title" aria-busy={busy} tabIndex={-1} ref={dialogRef}>
            <FantasyCorners />
            <header className="vault-modal-header">
              <div><p className="eyebrow">{copy("LOCAL ARCHIVE // LIBRARY TRANSFER", "THE KINGDOM’S RECORDS · IMPORT & EXPORT")}</p><h2 id="vault-title">{copy("Data Vault", "Royal Archive")}</h2></div>
              <button className="vault-close" type="button" aria-label={copy("Close Data Vault", "Close royal archive")} disabled={busy} onClick={close}>✕</button>
            </header>
            <section className="vault-section" aria-labelledby="vault-export-title">
              <h3 id="vault-export-title">{copy("01 // EXPORT BACKUP", "I · PRESERVE YOUR CHRONICLE")}</h3>
              <p>{copy(`Download your signed-in operator’s full library, including ratings, progress, and field logs (${games.length} games currently shown). A live session is required for import and export.`, `Preserve your signed-in adventurer’s full quest journal, including ratings, progress, and notes (${games.length} quests currently shown). A live session is required for import and export.`)}</p>
              <div className="vault-actions">
                <button type="button" disabled={busy} onClick={() => exportBackup("json")}>⬇ EXPORT JSON</button>
                <button type="button" disabled={busy} onClick={() => exportBackup("csv")}>⬇ EXPORT CSV</button>
              </div>
            </section>
            <section className="vault-section" aria-labelledby="vault-import-title">
              <h3 id="vault-import-title">{copy("02 // BULK IMPORT", "II · RESTORE YOUR QUEST SCROLLS")}</h3>
              <div className="vault-tabs" role="group" aria-label="Import format">
                {(["titles", "json", "csv"] as const).map((value) => (
                  <button key={value} type="button" disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setMessage(""); setError(""); }}>
                    {value === "titles" ? "Quick Title List" : value === "json" ? "Restore JSON Backup" : "Restore CSV Backup"}
                  </button>
                ))}
              </div>
              {mode === "titles" ? (
                <>
                  <p>One Title or Title | Platform per line. Maximum 25 rows per batch; metadata is fetched automatically.</p>
                  <label className="vault-field">Default Platform (optional)
                    <input value={defaultPlatform} onChange={(event) => setDefaultPlatform(event.target.value)} maxLength={80} placeholder="PC, Switch, PS5…" disabled={busy} />
                  </label>
                  <label className="vault-field">Game titles
                    <textarea rows={6} maxLength={MAX_IMPORT_BYTES} value={titles} onChange={(event) => setTitles(event.target.value)} placeholder={"Cyberpunk 2077 | PC\nHades | Switch"} disabled={busy} />
                  </label>
                </>
              ) : (
                <>
                  <p>Restore up to 200 games (500 KB maximum). Duplicate title/platform pairs in your own library and invalid/blank rows are skipped. Ownership and XP fields are never trusted.</p>
                  <label className="vault-field">{mode.toUpperCase()} backup file
                    <input type="file" accept={mode === "json" ? ".json,application/json" : ".csv,text/csv"} disabled={busy} onChange={async (event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      setError(""); setMessage("");
                      if (file.size > MAX_IMPORT_BYTES) { setError("Choose a backup under 500 KB."); return; }
                      setIsReading(true);
                      try { setJson(await file.text()); }
                      catch { setError("Could not read the selected backup."); }
                      finally { setIsReading(false); }
                    }} />
                  </label>
                  <label className="vault-field">{mode.toUpperCase()} backup contents
                    <textarea rows={6} maxLength={MAX_IMPORT_BYTES} value={json} onChange={(event) => setJson(event.target.value)} placeholder={mode === "json" ? '[{"title":"Hades","platform":"PC"}]' : "title,platform\nHades,PC"} spellCheck={false} disabled={busy} />
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
