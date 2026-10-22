"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { FantasyCorners, HeroCrest } from "@/components/FantasyAccents";
import { useUIEffects } from "@/components/ThemeProvider";

export type SubscreenPane = "quest" | "items" | "chronicle" | "all";
const pages: { key: SubscreenPane; label: string }[] = [
  { key: "quest", label: "QUEST STATUS" },
  { key: "items", label: "ITEM SUBSCREEN" },
  { key: "chronicle", label: "CHRONICLE & INSCRIBE" },
  { key: "all", label: "ALL PANES" },
];
const SubscreenContext = createContext<{ pane: SubscreenPane; showPane: (pane: SubscreenPane) => void }>({ pane: "all", showPane: () => {} });
export function useSubscreen() { return useContext(SubscreenContext); }

/** Server-rendered workspace slots stay at stable React positions in either layout. */
export default function WorkspaceShell({ children }: { children: ReactNode }) {
  const { layoutMode, playSfx } = useUIEffects();
  const [pane, setPane] = useState<SubscreenPane>("all");
  function showPane(next: SubscreenPane) {
    if (next !== pane && layoutMode === "fantasy") playSfx("page");
    setPane(next);
  }
  function turnPage(direction: number) {
    showPane(pages[(pages.findIndex(page => page.key === pane) + direction + pages.length) % pages.length].key);
  }
  return <SubscreenContext.Provider value={{ pane, showPane }}>
    <main className="page-shell workspace-shell" data-fantasy-pane={pane}>
      <FantasyCorners />
      <header className="fantasy-workspace-banner">
        <div className="fantasy-crest" aria-hidden="true"><HeroCrest /></div>
        <div><p className="fantasy-kicker">A MOMENT BETWEEN ADVENTURES</p><h1>The Questkeeper’s Subscreen</h1><p>Your stories. Your pace. Your next adventure.</p></div>
        <span className="fantasy-pause-seal">PAUSE<br /><small>QUEST JOURNAL</small></span>
        <nav className="fantasy-page-navigation" aria-label="Pause subscreen pages">
          <button type="button" data-ui-sound="custom" aria-label="Previous subscreen page" onClick={() => turnPage(-1)}><kbd>L</kbd> ◀</button>
          <div className="fantasy-page-tabs" role="group" aria-label="Subscreen panes" onKeyDown={event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = (pages.findIndex(page => page.key === pane) + (event.key === "ArrowRight" ? 1 : -1) + pages.length) % pages.length;
            showPane(pages[next].key);
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}>
            {pages.map(page => <button type="button" key={page.key} data-ui-sound="custom" aria-pressed={pane === page.key} onClick={() => showPane(page.key)}>{page.label}</button>)}
          </div>
          <button type="button" data-ui-sound="custom" aria-label="Next subscreen page" onClick={() => turnPage(1)}>▶ <kbd>R</kbd></button>
        </nav>
      </header>
      {children}
    </main>
  </SubscreenContext.Provider>;
}
