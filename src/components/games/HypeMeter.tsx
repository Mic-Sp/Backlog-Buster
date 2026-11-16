"use client";

import { useContext, useId } from "react";
import { HypeMetersContext, useHypeMeters, type HypeMetersController } from "./useHypeMeters";
import "./HypeMeter.css";

type HypeMeterProps = { gameId: number; hypeLevel?: number; title: string; compact?: boolean };
const labels: Record<number, string> = { 1: "Backburner", 2: "Interested", 3: "Hyped / Must Play" };

export default function HypeMeter(props: HypeMeterProps) {
  const shared = useContext(HypeMetersContext);
  return shared ? <HypeControl {...props} controller={shared} /> : <StandaloneHypeMeter {...props} />;
}

function StandaloneHypeMeter(props: HypeMeterProps) {
  const controller = useHypeMeters([{ id: props.gameId, hypeLevel: props.hypeLevel }]);
  return <HypeControl {...props} controller={controller} />;
}

function HypeControl({ gameId, hypeLevel = 2, title, compact = false, controller }: HypeMeterProps & { controller: HypeMetersController }) {
  const errorId = useId();
  const level = controller.levels[gameId] ?? hypeLevel;
  const next = level === 3 ? 1 : level + 1;
  const { pending = false, error = "" } = controller.changes[gameId] ?? {};
  return <span className="hype-meter" data-hype-game-id={gameId} data-hype-level={level} data-compact={compact || undefined}>
    <button type="button" className="hype-meter-button" disabled={pending} aria-busy={pending}
      aria-label={`Hype for ${title}: ${labels[level]} (${level} of 3). Set to ${labels[next]}.`}
      aria-describedby={error ? errorId : undefined} title={`${labels[level]} · Click to set ${labels[next]}`}
      onClick={event => { event.stopPropagation(); void controller.cycleHype(gameId, level); }}>
      <span className="hype-bars" aria-hidden="true">{[1, 2, 3].map(bar => <span key={bar} data-lit={bar <= level}>▮</span>)}</span>
      {!compact && <span className="hype-meter-label">{labels[level]}</span>}
    </button>
    {error && <span id={errorId} className="hype-meter-error" role="alert">{error}</span>}
  </span>;
}

export function HypedOnlyFilter({ active, onChange }: { active: boolean; onChange: (active: boolean) => void }) {
  return <button type="button" className="hype-filter" aria-pressed={active} onClick={() => onChange(!active)}>
    <span aria-hidden="true">🔥</span> Hyped Only
  </button>;
}
