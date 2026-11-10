"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { useUIEffects } from "@/components/ThemeProvider";

export type WorkspaceSectionProps = {
  sectionKey: string;
  title: ReactNode;
  label: string;
  eyebrow?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headingId?: string;
  headingLevel?: 2 | 3 | 4;
  defaultOpen?: boolean;
  revealKey?: unknown;
  sectionRef?: Ref<HTMLElement>;
  pane?: "quest" | "items" | "chronicle";
  decorations?: ReactNode;
  busy?: boolean;
};

/** Keep the body mounted so closing a panel preserves forms, selections and nested disclosures. */
export default function WorkspaceSection({ sectionKey, title, label, eyebrow, summary, actions, children,
  className = "", bodyClassName, headingId, headingLevel = 3, defaultOpen = true, revealKey, sectionRef, pane, decorations, busy,
}: WorkspaceSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { layoutMode } = useUIEffects();
  const id = useId();
  const bodyId = `${id}-body`;
  const titleId = headingId ?? `${id}-title`;
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const previousReveal = useRef(revealKey);
  useEffect(() => {
    // Explicit navigation (new game, started game, saga selection) may reveal a hidden destination.
    if (previousReveal.current !== revealKey) { previousReveal.current = revealKey; setOpen(true); }
  }, [revealKey]);

  if (layoutMode === "biohazard") return <section className={`bio-file-section ${className}`} ref={sectionRef} aria-labelledby={titleId} data-workspace-section={sectionKey} aria-busy={busy}>
    <header className="bio-file-heading"><Heading id={titleId}>{title}</Heading>{summary}{actions}</header>
    <div className={bodyClassName}>{children}</div>
  </section>;

  return <section className={`workspace-section ${className}`} ref={sectionRef} aria-labelledby={titleId}
    data-workspace-section={sectionKey} data-section-open={open} data-workspace-pane={pane} aria-busy={busy}>
    {decorations}
    <div className="workspace-section-header">
      <Heading className="workspace-section-title"><button type="button" className="workspace-section-toggle"
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>
        <span className="workspace-section-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="workspace-section-copy">{eyebrow && <span className="workspace-section-eyebrow">{eyebrow}</span>}<span id={titleId}>{title}</span></span>
      </button></Heading>
      {summary !== undefined && <div className="workspace-section-summary">{summary}</div>}
      {actions && <div className="workspace-section-actions">{actions}</div>}
    </div>
    <div id={bodyId} className={bodyClassName} data-workspace-section-body hidden={!open}>{children}</div>
  </section>;
}
