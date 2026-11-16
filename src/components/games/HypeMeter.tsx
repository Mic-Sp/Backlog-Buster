"use client";

import { useContext, useId, useState } from "react";
import { HypeMetersContext, useHypeMeters, type HypeMetersController } from "./useHypeMeters";
import type { HypeLevel } from "@/lib/hype";
import "./HypeMeter.css";

type CommonProps = { title: string; compact?: boolean };
type SavedHypeMeterProps = CommonProps & { gameId: number; hypeLevel?: number; value?: never; onChange?: never };
type LocalHypeMeterProps = CommonProps & { gameId?: never; value?: HypeLevel; onChange?: (value: HypeLevel) => void };
type HypeMeterProps = SavedHypeMeterProps | LocalHypeMeterProps;
const labels: Record<number, string> = { 1: "Backburner", 2: "Interested", 3: "Hyped / Must Play" };

export default function HypeMeter(props: HypeMeterProps) {
  const shared = useContext(HypeMetersContext);
  // Creation controls never inherit a persisted game's network controller.
  if (props.gameId === undefined) return <LocalHypeMeter {...props} />;
  return shared ? <HypeControl {...props} controller={shared} /> : <StandaloneHypeMeter {...props} />;
}

function LocalHypeMeter({ value, onChange, ...props }: LocalHypeMeterProps) {
  const [localLevel, setLocalLevel] = useState<HypeLevel>(2);
  const level = value ?? localLevel;
  return <HypeIndicator {...props} level={level} onCycle={() => {
    const next: HypeLevel = level === 3 ? 1 : level === 2 ? 3 : 2;
    if (value === undefined) setLocalLevel(next);
    onChange?.(next);
  }} />;
}

function StandaloneHypeMeter(props: SavedHypeMeterProps) {
  const controller = useHypeMeters([{ id: props.gameId, hypeLevel: props.hypeLevel }]);
  return <HypeControl {...props} controller={controller} />;
}

function HypeControl({ gameId, hypeLevel = 2, controller, ...props }: SavedHypeMeterProps & { controller: HypeMetersController }) {
  const level = controller.levels[gameId] ?? hypeLevel;
  const { pending = false, error = "" } = controller.changes[gameId] ?? {};
  return <HypeIndicator {...props} gameId={gameId} level={level} pending={pending} error={error} onCycle={() => { void controller.cycleHype(gameId, level); }} />;
}

function HypeIndicator({ gameId, level, title, compact = false, pending = false, error = "", onCycle }: CommonProps & {
  gameId?: number; level: number; pending?: boolean; error?: string; onCycle: () => void;
}) {
  const errorId = useId();
  const next = level === 3 ? 1 : level + 1;
  return <span className="hype-meter" data-hype-game-id={gameId} data-hype-level={level} data-compact={compact || undefined}>
    <button type="button" className="hype-meter-button" disabled={pending} aria-busy={pending}
      aria-label={`Hype for ${title}: ${labels[level]} (${level} of 3). Set to ${labels[next]}.`}
      aria-describedby={error ? errorId : undefined} title={`${labels[level]} · Click to set ${labels[next]}`}
      onClick={event => { event.stopPropagation(); onCycle(); }}>
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
