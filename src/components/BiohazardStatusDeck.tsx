"use client";

import { type ReactNode } from "react";
import { useUIEffects } from "@/components/ThemeProvider";
import { useSafeRoom } from "@/components/WorkspaceShell";
import OperatorAvatar from "@/components/OperatorAvatar";
import { operativeCondition, safeRoomModes } from "@/lib/biohazard";

export function BioResearchEmblem() {
  return <svg className="bio-emblem" viewBox="0 0 100 100" aria-label="Red and white eight-wedge research emblem" role="img">
    {Array.from({ length: 8 }, (_, index) => <path key={index} d="M50 50L29 0H71Z" transform={`rotate(${index * 45} 50 50)`} fill={index % 2 ? "#d9d8ce" : "#a3312c"} stroke="#242622" strokeWidth="1.5" />)}
  </svg>;
}

/** The streamed server summary supplies both presentations; only one is mounted. */
export default function BiohazardStatusDeck({ children, legacy, name, avatarUrl, rank, xp, activeGames, completed, total }: {
  children: ReactNode; legacy: ReactNode; name: string; avatarUrl: string | null; rank: number; xp: number; activeGames: number; completed: number; total: number;
}) {
  const { layoutMode, playSfx, customTheme } = useUIEffects();
  const { mode, showMode } = useSafeRoom();
  if (layoutMode !== "biohazard") return legacy;
  const condition = operativeCondition(activeGames);
  return <header className="bio-status-deck" aria-label="Medical and operative status">
    <div className="bio-deck-title"><span>B.B. / BIO-RESEARCH DIVISION</span><span>PERSONNEL TERMINAL · 1998</span></div>
    <div className="bio-medical-row">
      <div className="bio-operative-card"><OperatorAvatar avatarUrl={avatarUrl} alt={`${name} operative portrait`} /><div><small>OPERATIVE ID / AUTHORIZED</small><h1>{customTheme?.terminology.workspaceTitle?.trim() || "Safe Room"}</h1><strong>{name}</strong><p>RANK {String(rank).padStart(2, "0")} · {xp.toLocaleString("en-US")} XP</p></div></div>
      <button type="button" className="bio-ecg" data-condition={condition} data-ui-sound="custom" onClick={() => playSfx("pulse")} aria-label={`Workload condition ${condition}. ${activeGames} active games. Play ECG pulse.`} title="Workload: Fine 0–2 active games, Caution 3–5, Danger 6+. Click for ECG tone.">
        <span>CONDITION <small>{activeGames} ACTIVE</small></span><svg viewBox="0 0 300 65" aria-hidden="true"><path d="M0 38H65L72 32L79 40L88 38L98 38L106 8L115 59L124 29L135 38H180L187 32L194 40L203 38H300" /></svg><strong>{condition}</strong>
      </button>
      <div className="bio-research-seal"><BioResearchEmblem /><span>CONTAINMENT<br />{completed} / {total} CLEARED</span></div>
    </div>
    <div className="bio-personnel-tools">{children}</div>
    <nav className="bio-mode-tabs" aria-label="Safe Room subscreens" onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = (safeRoomModes.findIndex(item => item.key === mode) + (event.key === "ArrowRight" ? 1 : -1) + safeRoomModes.length) % safeRoomModes.length;
      showMode(safeRoomModes[index].key);
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
    }}>{safeRoomModes.map(item => <button key={item.key} type="button" data-ui-sound="custom" aria-pressed={mode === item.key} onClick={() => showMode(item.key)}>{item.label}</button>)}</nav>
  </header>;
}
