"use client";

import { useRef, useState, useTransition } from "react";
import { getSagaChronologyDebug } from "@/app/actions";
import type { SagaChronologyDebug } from "@/lib/saga-debug";
import { cooldownLabel } from "@/lib/cooldown";

const statusLabels = {
  hit: "HIT", miss: "MISS", refreshed: "MISS / REFRESHED",
  "refresh-deferred": "PARTIAL HIT / REFRESH DEFERRED", fallback: "FALLBACK",
};

export function useSagaDebuggerController({ sagaKey, scanDebug, busy, cooldownSeconds = 0, onForceRefresh, enabled = true }: {
  enabled?: boolean;
  sagaKey: string;
  scanDebug: SagaChronologyDebug | null;
  busy: boolean;
  cooldownSeconds?: number;
  onForceRefresh: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [readouts, setReadouts] = useState<Record<string, SagaChronologyDebug>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, startLoading] = useTransition();
  const loadingRef = useRef(new Set<string>());
  const isOpen = enabled && openKey === sagaKey;
  const data = enabled ? scanDebug ?? readouts[sagaKey] ?? null : null;
  const error = errors[sagaKey] ?? "";

  function setIsOpen(open: boolean) {
    if (enabled) setOpenKey(open ? sagaKey : null);
  }

  function inspect() {
    if (!enabled || !sagaKey || loadingRef.current.has(sagaKey) || busy) return;
    const key = sagaKey;
    loadingRef.current.add(key);
    setErrors(current => ({ ...current, [key]: "" }));
    startLoading(async () => {
      try {
        const result = await getSagaChronologyDebug(key);
        if ("debug" in result) setReadouts(current => ({ ...current, [key]: result.debug }));
        else setErrors(current => ({ ...current, [key]: result.error }));
      } catch {
        setErrors(current => ({ ...current, [key]: "Cache inspection unavailable. Try again; no ranks were changed." }));
      } finally { loadingRef.current.delete(key); }
    });
  }

  function forceRefresh() {
    if (!enabled || !sagaKey || busy || isLoading || cooldownSeconds > 0) return;
    setIsOpen(true);
    onForceRefresh();
  }

  return {
    busy,
    cooldownSeconds,
    forceRefresh,
    isOpen,
    setIsOpen,
    error,
    isLoading,
    data,
    inspect,
  };
}

export type SagaChronologyDebuggerController = ReturnType<typeof useSagaDebuggerController>;

export default function SagaChronologyDebugger(props: Parameters<typeof useSagaDebuggerController>[0]) {
  const controller = useSagaDebuggerController(props);
  return <SagaChronologyDebuggerView controller={controller} />;
}

export function SagaChronologyDebuggerView({ controller, part = "all" }: { controller: SagaChronologyDebuggerController; part?: "all" | "trigger" | "overlay" }) {
  const {
    busy,
    cooldownSeconds,
    forceRefresh,
    isOpen,
    setIsOpen,
    error,
    isLoading,
    data,
    inspect,
  } = controller;
  return (
    <div className="saga-debugger">
      {part !== "overlay" && <div className="saga-debug-actions">
        <button type="button" aria-expanded={isOpen} aria-controls="saga-debug-readout" onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen && !data) inspect();
        }}>🔍 {isOpen ? "HIDE" : "DEBUG"} CHRONOLOGY MATCHING</button>
        <button type="button" disabled={busy || isLoading || cooldownSeconds > 0} onClick={forceRefresh} title="Bypass the shared cache and five-minute refresh cooldown, fetch IGDB, and replace this saga's saved ranks. IGDB request limits still apply.">
          {cooldownSeconds > 0 ? cooldownLabel(cooldownSeconds) : busy ? "⏳ SCANNING…" : "🔄 FORCE REFRESH CACHE"}
        </button>
      </div>}
      {part !== "trigger" && isOpen && <section id="saga-debug-readout" className="saga-debug-readout" aria-label="Saga cache and match debugger" aria-busy={busy || isLoading}>
        <h4>🔍 SAGA CACHE &amp; MATCH DEBUGGER</h4>
        {(busy || isLoading) && <p role="status">Reading chronology telemetry…</p>}
        {error && <p role="alert">{error}</p>}
        {!data && !isLoading && !busy && <button type="button" onClick={inspect}>RETRY READOUT</button>}
        {data && <>
          <dl className="saga-debug-stats">
            <div><dt>Cache status</dt><dd>{statusLabels[data.status]}</dd></div>
            <div><dt>Data source</dt><dd>{data.source}</dd></div>
            <div><dt>Last updated (UTC)</dt><dd>{data.updatedAt ?? "No cached timestamp"}</dd></div>
            <div><dt>Canonical entries cached</dt><dd>{data.canonicalGames.length}</dd></div>
          </dl>
          {data.geminiError && <p className="saga-debug-provider-error" role="status"><strong>GEMINI ERROR // </strong>{data.geminiError}</p>}
          <details className="saga-debug-payload">
            <summary>📡 LAST GEMINI PAYLOAD (PROMPT &amp; RAW RESPONSE)</summary>
            {data.geminiPayload ? <>
              <p>{data.geminiPayload.attemptedAt ? `Attempted ${data.geminiPayload.attemptedAt}` : "No Gemini request sent (blocked or skipped before dispatch)."}{data.geminiPayload.httpStatus != null && ` // HTTP ${data.geminiPayload.httpStatus}`}</p>
              {data.geminiPayload.redacted && <p>Credentials redacted from captured text.</p>}
              {data.geminiPayload.truncated && <p>Raw response exceeded the capture limit and is truncated.</p>}
              <h5>CANDIDATE TITLES / ORIGINAL ANCHOR YEARS</h5>
              <pre>{JSON.stringify(data.geminiPayload.candidates, null, 2)}</pre>
              <details><summary>EXACT REQUEST BODY // PROMPT &amp; MODEL CONFIG</summary><pre>{data.geminiPayload.requestBody ?? "Request was not dispatched."}</pre></details>
              <h5>RAW GEMINI JSON RESPONSE // BEFORE VALIDATION</h5>
              <pre>{data.geminiPayload.rawResponse ?? "No response captured (request blocked, failed, or timed out)."}</pre>
              {data.geminiPayload.rawTimeline != null && <details><summary>RAW TIMELINE TEXT FROM RESPONSE</summary><pre>{data.geminiPayload.rawTimeline}</pre></details>}
            </> : <p>No Gemini payload captured in this view. Run a scan or Force Refresh Cache to inspect a new attempt; cache-only reads make no Gemini request.</p>}
          </details>
          <p>Canonical ranks retain global franchise positions. Library assigned ranks are compacted sequentially (1..N) in canon order; editions sharing a story slot are ordered by release year and title. Unmatched or unreleased games have no assigned rank and follow in release order. Values show the last scan or inspection.</p>
          <div className="saga-debug-table-scroll">
            <table>
              <caption>Operator library → canonical matching → saved order</caption>
              <thead><tr><th>Library title / year</th><th>Canonical title / anchor year</th><th>Canonical rank</th><th>Assigned rank</th><th>Match / unmatched reason</th></tr></thead>
              <tbody>{data.mappings.map(game => <tr key={game.id} data-unmatched={!game.matchedTitle}>
                <td>{game.title}<small>{game.releaseYear ?? "Undated"}</small></td>
                <td>{game.matchedTitle ?? "UNMATCHED"}<small>{game.anchorYear ?? "—"}</small></td>
                <td>{game.canonicalRank ?? "—"}</td>
                <td>{game.assignedRank ?? "— (Release order tail)"}</td>
                <td>{game.reason}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <details className="saga-debug-canon">
            <summary>CANONICAL PROVIDER DATA // {data.canonicalGames.length} ENTRIES</summary>
            <p>Validated public entries returned by the chronology provider and stored in the shared cache, including matching aliases.</p>
            <pre>{JSON.stringify(data.canonicalGames, null, 2)}</pre>
          </details>
        </>}
      </section>}
    </div>
  );
}
