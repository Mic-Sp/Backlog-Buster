"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLayoutCopy } from "@/components/LayoutText";
import type { SteamAuthSyncView } from "@/lib/steam-auth-sync";
import "./SteamLibrarySync.css";

const failures: Record<string, string> = {
  PRIVATE_LIBRARY: "Steam did not expose your library. In Steam Privacy Settings, set My profile and Game details to Public, then retry. Your sign-in and existing library are safe.",
  MISSING_API_KEY: "Steam sign-in succeeded. Library import is unavailable because the server’s Steam API key is not configured.",
  API_KEY_REJECTED: "Steam sign-in succeeded. The server’s Steam API key needs attention before games can be imported.",
  RATE_LIMIT: "Steam is limiting requests. Your sign-in succeeded; please retry the library import shortly.",
  TIMEOUT: "Steam library sync was interrupted. Your sign-in and existing games are safe. Retry the import or sign in with Steam again.",
};

export default function SteamLibrarySync({ initial }: { initial: SteamAuthSyncView }) {
  const copy = useLayoutCopy(), router = useRouter();
  const [seed] = useState(initial);
  const [view, setView] = useState(initial);
  const [retryWait, setRetryWait] = useState(initial.retryAfterSeconds);
  const [retry, setRetry] = useState(0);
  const [transportError, setTransportError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    let current = seed;
    async function step(forceRetry = false) {
      try {
        const run = current.status === "pending" || forceRetry;
        const response = await fetch("/api/steam/auth-sync", { method: run ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
          ...(run ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: current.requestId, retry: forceRetry }) } : {}) });
        if (!response.ok) {
          if (response.status === 401) {
            if (!disposed) { setTransportError("Sign in again to continue importing your Steam library."); setView(previous => ({ ...previous, status: "failed", canRetry: false })); }
            return;
          }
          throw new Error("Sync request unavailable");
        }
        const result: { sync: SteamAuthSyncView | null } = await response.json();
        if (disposed) return;
        if (!result.sync) { setDismissed(true); return; }
        if (result.sync.requestId !== seed.requestId) { router.refresh(); return; }
        current = result.sync; setView(current); setRetryWait(current.retryAfterSeconds); setTransportError("");
        if (current.status === "completed") { router.refresh(); return; }
        if (current.status === "failed") return;
      } catch {
        if (disposed) return;
        setTransportError("Steam sync connection interrupted. Reconnecting…");
        // Re-read the durable lease before retrying after an ambiguous network failure.
        current = { ...current, status: "running" };
      }
      if (!disposed) timer = setTimeout(() => { void step(); }, 2000);
    }
    if (retry || seed.status === "pending" || seed.status === "running") {
      void step(retry > 0);
    }
    return () => { disposed = true; clearTimeout(timer); };
  }, [seed, retry, router]); // The parent keys by request ID; refresh must not restart a completed import.

  const busy = view.status === "pending" || view.status === "running";
  useEffect(() => {
    if (!retryWait) return;
    const timer = setInterval(() => setRetryWait(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [retryWait]);
  if (dismissed) return null;
  return <section className="steam-library-sync" data-state={view.status} aria-label="Steam library sync" aria-busy={busy}>
    <div>
      <p className="steam-sync-eyebrow">{copy("STEAM UPLINK // LIBRARY IMPORT", "STEAM CONNECTION · GATHERING YOUR QUESTS")}</p>
      <h2>{busy ? "Syncing Steam library…" : view.status === "completed" ? "Steam library synced" : "Steam library import needs attention"}</h2>
      <p role={view.status === "failed" ? "alert" : "status"}>
        {transportError || (busy ? copy("Fetching your owned games, playtime and achievements. Your library will refresh automatically.", "Gathering your owned games, playtime and achievements. Your quest journal will refresh automatically.")
          : view.status === "completed" ? `${view.linked ? "Steam account verified and linked. " : ""}${view.addedCount} ${view.addedCount === 1 ? "game" : "games"} added · ${view.updatedCount} updated. Your saved progress is kept.`
            : failures[view.errorCode ?? ""] ?? "Steam sign-in succeeded, but the library import could not finish. Your existing games are safe. Please retry.")}
      </p>
    </div>
    {busy && <span className="steam-sync-spinner" aria-hidden="true" />}
    {!busy && <div className="steam-sync-actions">
      {view.status === "failed" && view.canRetry && <button type="button" disabled={retryWait > 0} onClick={() => {
        setView(previous => ({ ...previous, status: "running" })); setTransportError(""); setRetry(value => value + 1);
      }}>{retryWait ? `Retry in ${retryWait}s` : "Retry Steam sync"}</button>}
      {view.status === "failed" && !view.canRetry && <p>Start a fresh Steam sign-in or use Direct Steam Sync in your archive settings to try again.</p>}
      <button type="button" aria-label="Dismiss Steam sync notice" onClick={() => setDismissed(true)}>Dismiss</button>
    </div>}
  </section>;
}
