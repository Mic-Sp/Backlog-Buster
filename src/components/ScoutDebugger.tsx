"use client";

import type { ScoutDebug } from "@/lib/scout-debug";
import "./SagaChains.css";
import "./ScoutDebugger.css";

const money = (value: number | null) => value === null ? "Unknown model pricing" : `$${value.toFixed(6)}`;
const sources = { vector: "VECTOR", "live-ai": "GEMINI FALLBACK", "deterministic-fallback": "CURATED FALLBACK", mixed: "MIXED", none: "NO PICKS" };
const engines = { vector: "VECTOR", "gemini-fallback": "GEMINI FALLBACK", "local-fallback": "LOCAL CATALOG FALLBACK", mixed: "VECTOR + FALLBACK", none: "NO PICKS" };
const decimal = (value: number | null) => value === null ? "Unavailable" : value.toFixed(3);
const milliseconds = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)} ms`;

export default function ScoutDebugger({ debug, busy }: { debug: ScoutDebug | null; busy: boolean }) {
  return (
    <details className="saga-debugger scout-debugger">
      <summary>Scout Engine &amp; Guardrail Debugger <span>ADMIN ONLY · {busy ? "SCANNING…" : "INSPECT LAST SCAN"}</span></summary>
      <section className="saga-debug-readout" aria-label="External Scout engine diagnostics" aria-busy={busy}>
        {busy ? <p role="status">Waiting for this scan’s telemetry…</p> : !debug ? <p>Run an External Scout scan to inspect execution. Diagnostics may be omitted when access changes.</p> : <>
          <dl className="saga-debug-stats scout-debug-badges">
            <div><dt>Engine Source</dt><dd>{engines[debug.engineSource]}</dd></div>
            <div><dt>Pick Sources</dt><dd>{sources[debug.source]}</dd></div>
            <div><dt>Guardrail Status</dt><dd>{debug.fallbackTriggered ? "FALLBACK TRIGGERED" : "PASSED"} · Schema: {debug.schemaStatus}</dd></div>
            <div><dt>Anchor Game / Rating</dt><dd>{debug.anchors[0] ? `${debug.anchors[0].title} · ${debug.anchors[0].rating === null ? "Unrated" : `${debug.anchors[0].rating}★`}` : "No personal anchor"}</dd></div>
            <div><dt>Estimated Cost (USD)</dt><dd>{money(debug.estimatedCostUsd)}</dd></div>
            <div><dt>Excluded Count</dt><dd>{debug.excludedCount} owned / previously seen · {debug.filteredCount} AI candidates filtered</dd></div>
          </dl>
          <p><strong>Request UTC:</strong> <time dateTime={debug.requestedAt}>{debug.requestedAt}</time></p>
          <section aria-label="Vector retrieval metrics" className="scout-vector-metrics">
            <h4>Vector retrieval</h4>
            <dl className="saga-debug-stats scout-debug-badges">
              <div><dt>Vector Status</dt><dd>{debug.vector.status.toUpperCase()}</dd></div>
              <div><dt>Cosine Query / Total Vector Time</dt><dd>{milliseconds(debug.vector.queryLatencyMs)} / {milliseconds(debug.vector.latencyMs)}</dd></div>
              <div><dt>Taste Profile</dt><dd>{debug.vector.tasteSource ?? "Unavailable"} · {debug.vector.anchorCount} anchors</dd></div>
              <div><dt>Negative Anchors</dt><dd>{debug.vector.negativeAnchorCount} dismissed / low-rated games</dd></div>
              <div><dt>Catalog Coverage</dt><dd>{debug.vector.coverage ? `${debug.vector.coverage.current} current / ${debug.vector.coverage.total} catalog games` : "Unavailable"}</dd></div>
            </dl>
            <p>Vector version: {debug.vector.vectorVersion ?? "Unavailable"}. Retrieved {debug.vector.candidateCount}, filtered {debug.vector.filteredCount}, served {debug.vector.returnedCount}.</p>
            {debug.vector.coverage && <p>{debug.vector.coverage.embedded} embedded · {debug.vector.coverage.released} released with current vectors · {debug.vector.coverage.eligible} eligible after ownership/history exclusions.</p>}
            {debug.vector.fallbackReason && <p role="status">{debug.vector.fallbackReason}</p>}
            {debug.vector.picks.length > 0 && <div className="scout-vector-table-scroll" tabIndex={0} role="region" aria-label="Vector candidate score details">
              <table className="scout-vector-table">
                <caption>Served vector picks · weighted score components</caption>
                <thead><tr><th scope="col">Game</th><th scope="col">Cosine similarity</th><th scope="col">Hybrid score</th><th scope="col">Negative penalty</th><th scope="col">Components</th></tr></thead>
                <tbody>{debug.vector.picks.map(pick => <tr key={pick.title}>
                  <th scope="row">{pick.title}</th><td>{decimal(pick.cosineSimilarity)}</td><td>{decimal(pick.score)}</td>
                  <td>{decimal(pick.scores.negative ?? 0)}</td>
                  <td>Cosine {decimal(pick.scores.cosine)} · Series {decimal(pick.scores.series)} · Genre {decimal(pick.scores.genre)} · Playtime {decimal(pick.scores.playtime)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </section>
          <p><strong>Gemini attempt tokens ({debug.tokenBasis}):</strong> {debug.inputTokens} input / {debug.outputTokens} output · {debug.model ?? "No Gemini call"}</p>
          {debug.geminiCooldownSkipped && <p role="status">Gemini skipped: API cooldown active ({debug.geminiCooldownRemainingSeconds}s remaining). This scan uses vector and local catalog picks.</p>}
          <p><strong>Playtime:</strong> {debug.playtimeStatus}</p>
          <details className="saga-debug-payload">
            <summary>Validation, fallback reason &amp; payload preview</summary>
            <p>{debug.fallbackReason ?? (debug.engineSource === "vector" ? "Vector catalog supplied all picks; no provider request needed." : "Provider output accepted without an additional curated fallback.")}</p>
            <p>RAWG candidates rejected: {debug.metadataRejectedCount}. Recommendation results are not cached. Gemini/RAWG and curated titles fill gaps in vector catalog coverage.</p>
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
