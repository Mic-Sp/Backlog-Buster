"use client";
import { cooldownLabel } from "@/lib/cooldown";

import type { SagaChain, SagaOrderMode } from "@/lib/sagas";
import "./SagaChains.css";

type SagaSelection = { onSelect: (key: string) => void };

type SagaOrderControlsProps = {
  order: SagaOrderMode | null;
  onOrderChange: (order: SagaOrderMode) => void;
  onAutoDetect: () => void;
  isDetecting: boolean;
  cooldownSeconds?: number;
  disabled?: boolean;
};

export function SagaOrderControls({ order, onOrderChange, onAutoDetect, isDetecting, cooldownSeconds = 0, disabled = false }: SagaOrderControlsProps) {
  return (
    <div className="saga-order-controls">
      <div className="saga-order-toggle" role="group" aria-label="Saga order">
        <button type="button" aria-pressed={order === "release"} onClick={() => onOrderChange("release")}>RELEASE ORDER</button>
        <button type="button" aria-pressed={order === "timeline"} onClick={() => onOrderChange("timeline")}>TIMELINE ORDER</button>
      </div>
      <button className="saga-detect-order" type="button" disabled={isDetecting || disabled || cooldownSeconds > 0} onClick={onAutoDetect} title="Resolve and save canon ranks for this saga, replacing any existing timeline ranks">
        {cooldownSeconds > 0 ? cooldownLabel(cooldownSeconds) : isDetecting ? "⏳ SCANNING CANON…" : "🤖 AUTO-DETECT CANON ORDER"}
      </button>
    </div>
  );
}

export function SagaBadge({ saga, onSelect, layout = "default" }: { saga: SagaChain; layout?: "default" | "table" | "trophy" } & SagaSelection) {
  const cleared = saga.total >= 2 && saga.completed === saga.total;
  return (
    <button className="saga-badge" type="button" data-layout={layout} data-complete={cleared} onClick={() => onSelect(saga.key)} title={`View the full ${saga.name} saga in release-year order${cleared ? " — ★ SAGA CLEARED" : ""}`} aria-label={`${saga.name} saga: ${saga.completed}/${saga.total} cleared${cleared ? ", saga cleared" : ""}. View series timeline`}>
      {layout === "default" ? <>
        ⛓️ {saga.name} SAGA // {saga.completed}/{saga.total} CLEARED
        {cleared && <span className="saga-cleared-tag">★ SAGA CLEARED</span>}
      </> : <>
        <span aria-hidden="true">⛓️</span>
        <span className="saga-badge-name">{saga.name}</span>
        <span className="saga-badge-count">{layout === "trophy" ? `· ${saga.completed}/${saga.total}` : `(${saga.completed}/${saga.total})`}{cleared && " ★"}</span>
      </>}
    </button>
  );
}

export default function SagaChains({ chains, selectedKey, onSelect, ...orderControls }: { chains: SagaChain[]; selectedKey: string } & SagaSelection & SagaOrderControlsProps) {
  const selected = chains.find((chain) => chain.key === selectedKey);
  return (
    <details className="saga-chains-drawer">
      <summary>
        <span>⛓️ ACTIVE SAGA CHAINS</span>
        <span className="saga-chains-summary">{selected ? selected.name : `${chains.length} ${chains.length === 1 ? "CHAIN" : "CHAINS"} DETECTED`}</span>
      </summary>
      <div className="saga-chains-body">
        <label className="saga-filter-label">
          SAGA
          <select aria-label="Filter by saga" value={selected?.key ?? ""} onChange={(event) => onSelect(event.target.value)}>
            <option value="">All sagas</option>
            {chains.map((chain) => <option key={chain.key} value={chain.key}>{chain.name}{" // "}{chain.completed}/{chain.total} cleared</option>)}
          </select>
        </label>
        {selected && <SagaOrderControls {...orderControls} />}
        {chains.length ? (
          <div className="saga-chains-grid">
            {chains.map((chain) => {
              const cleared = chain.total >= 2 && chain.completed === chain.total;
              return (
                <button className="saga-chain-card" type="button" key={chain.key} aria-pressed={chain.key === selectedKey} data-complete={cleared} onClick={() => onSelect(chain.key)}>
                  <span className="saga-chain-name">{chain.name}</span>
                  <span className="saga-chain-count">{chain.completed} / {chain.total} CLEARED</span>
                  <span className="saga-chain-track" aria-hidden="true"><span style={{ width: `${Math.round(chain.completed / chain.total * 100)}%` }} /></span>
                  <span className={cleared ? "saga-cleared-tag" : "saga-chain-hint"}>{cleared ? "★ SAGA CLEARED" : "VIEW SERIES TIMELINE ↗"}</span>
                </button>
              );
            })}
          </div>
        ) : <p className="saga-chains-hint">No multi-game sagas detected yet. Use Edit Metadata → Franchise / Saga Name to connect games across different titles.</p>}
        {chains.length > 0 && <p className="saga-chains-hint">Progress covers your full library. Select a saga to switch between release and timeline order. Edit Metadata lets you override grouping and timeline ranks.</p>}
      </div>
    </details>
  );
}
