"use client";

import { useId, useState } from "react";
import { ColorModeToggle, ThemeToggle } from "@/components/ThemeProvider";

export type StandardAction = "library" | "random" | "recommendations" | "transfer";
export function requestStandardAction(action: StandardAction) {
  window.dispatchEvent(new CustomEvent("backlogbuster:standard-action", { detail: action }));
}

export function openStandardAddGame() {
  const disclosure = document.querySelector<HTMLDetailsElement>(".add-disclosure");
  if (disclosure) { disclosure.open = true; disclosure.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

export default function StandardNavigation() {
  const [themesOpen, setThemesOpen] = useState(false);
  const panelId = useId();
  return <header className="standard-header">
    <a className="standard-brand" href="#collection-title" onClick={() => requestStandardAction("library")}>Backlog Buster</a>
    <nav className="standard-navigation" aria-label="Main navigation">
      <a href="#collection-title" onClick={() => requestStandardAction("library")}>Library</a>
      <a className="standard-add-link" href="#add-title" onClick={openStandardAddGame}>+ Add Game</a>
      <button type="button" onClick={() => requestStandardAction("random")}>Random Picker</button>
      <button type="button" onClick={() => requestStandardAction("recommendations")}>Recommendations</button>
      <button type="button" onClick={() => requestStandardAction("transfer")}>Import / Export</button>
      <ColorModeToggle />
      <button type="button" aria-expanded={themesOpen} aria-controls={panelId} onClick={() => setThemesOpen(open => !open)}>Theme</button>
    </nav>
    <div id={panelId} className="standard-theme-panel" hidden={!themesOpen}><ThemeToggle /></div>
  </header>;
}
