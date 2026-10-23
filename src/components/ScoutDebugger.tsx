"use client";

import type { ScoutDebug } from "@/lib/scout-debug";
import "./SagaChains.css";
import "./ScoutDebugger.css";

const money = (value: number | null) => value === null ? "Unknown model pricing" : `$${value.toFixed(6)}`;
const sources = { "live-ai": "LIVE AI", "deterministic-fallback": "DETERMINISTIC FALLBACK", mixed: "AI + FALLBACK", none: "NO PICKS" };

export default function ScoutDebugger({ debug, busy }: { debug: ScoutDebug | null; busy: boolean }) {
  return (
    <details className="saga-debugger scout-debugger">
      <summary>AI &amp; Guardrail Debugger <span>ADMIN ONLY · {busy ? "SCANNING…" : "INSPECT LAST SCAN"}</span></summary>
      <section className="saga-debug-readout" aria-label="External Scout AI diagnostics" aria-busy={busy}>
        {busy ? <p role="status">Waiting for this scan’s telemetry…</p> : !debug ? <p>Run an External Scout scan to inspect execution. Diagnostics may be omitted when access changes.</p> : <>
          <dl className="saga-debug-stats scout-debug-badges">
            <div><dt>Data Source</dt><dd>{sources[debug.source]}</dd></div>
            <div><dt>Guardrail Status</dt><dd>{debug.fallbackTriggered ? "FALLBACK TRIGGERED" : "PASSED"} · Schema: {debug.schemaStatus}</dd></div>
            <div><dt>Anchor Game / Rating</dt><dd>{debug.anchors[0] ? `${debug.anchors[0].title} · ${debug.anchors[0].rating === null ? "Unrated" : `${debug.anchors[0].rating}★`}` : "No AI seed"}</dd></div>
            <div><dt>Estimated Cost (USD)</dt><dd>{money(debug.estimatedCostUsd)}</dd></div>
            <div><dt>Excluded Count</dt><dd>{debug.excludedCount} owned / previously seen · {debug.filteredCount} AI candidates filtered</dd></div>
          </dl>
          <p><strong>Request UTC:</strong> <time dateTime={debug.requestedAt}>{debug.requestedAt}</time></p>
          <p><strong>Gemini attempt tokens ({debug.tokenBasis}):</strong> {debug.inputTokens} input / {debug.outputTokens} output · {debug.model ?? "No Gemini call"}</p>
          <p><strong>Playtime:</strong> {debug.playtimeStatus}</p>
          <details className="saga-debug-payload">
            <summary>Validation, fallback reason &amp; payload preview</summary>
            <p>{debug.fallbackReason ?? "AI schema accepted; no catalog fallback needed."}</p>
            <p>RAWG candidates rejected: {debug.metadataRejectedCount}. Recommendation results are not cached; the curated catalog is a local deterministic fallback.</p>
            <p>Catalog serving cost is zero. Estimated Gemini attempt cost: {money(debug.attemptedCallCostUsd)}. Paid standard text rates; actual billing, free tier and retries may differ. Estimates include the system prompt; provider counts include reported thinking tokens.</p>
            <pre>{JSON.stringify({ validationIssues: debug.validationIssues, anchors: debug.anchors, picks: debug.picks }, null, 2)}</pre>
            <h4>Prompt context preview (bounded / redacted)</h4>
            <pre>{debug.promptPreview || "No prompt sent."}</pre>
            <h4>Raw answer preview (bounded / redacted; thoughts excluded)</h4>
            <pre>{debug.responsePreview || "No answer captured."}</pre>
          </details>
        </>}
      </section>
    </details>
  );
}
