"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LayoutMode } from "@/lib/appearance";
import { customThemeSchema, newCustomTheme, parseCustomThemeJSON, themeColorFields, themeTermFields, type CustomTheme, type ThemeColorKey, type ThemeTermKey } from "@/lib/custom-theme";
import type { CustomThemesController } from "@/components/useCustomThemes";
import { createThemeShareUrl } from "@/lib/theme-share";
import { applyThemeTemplate, getThemeTemplates, themeTemplateGroups } from "@/lib/theme-templates";
import "./CustomThemeStudio.css";

export default function CustomThemeStudio({ controller, baseLayout, haunted }: { controller: CustomThemesController; baseLayout: LayoutMode; haunted: boolean }) {
  const [draft, setDraft] = useState<CustomTheme>(() => {
    const theme = structuredClone(controller.activeTheme ?? newCustomTheme(baseLayout, haunted));
    if (controller.sharedTheme?.id === theme.id) theme.id = newCustomTheme(theme.baseLayout).id;
    return theme;
  });
  const [hexDrafts, setHexDrafts] = useState<Partial<Record<ThemeColorKey, string>>>({});
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shareLink, setShareLink] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const controllerRef = useRef(controller);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    // Capture first so opening the studio from Account Security/authentication
    // temporarily owns keyboard focus even when that underlying dialog is open.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); controllerRef.current.closeStudio(); }
      if (event.key !== "Tab") return;
      event.stopImmediatePropagation();
      const controls = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, a[href]');
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

  const invalidHex = Object.values(hexDrafts).some(value => !/^#[0-9a-fA-F]{6}$/.test(value ?? ""));
  const exists = controller.themes.some(theme => theme.id === draft.id);
  const templates = getThemeTemplates(controller.themes, exists ? draft.id : undefined);
  function change(next: CustomTheme) {
    setDraft(next); setError(""); setMessage(""); setShareLink("");
    if (customThemeSchema.safeParse(next).success) controller.preview(next);
  }
  function load(next: CustomTheme) { setHexDrafts({}); change(structuredClone(next)); }
  function color(key: ThemeColorKey, value: string) {
    setHexDrafts(previous => ({ ...previous, [key]: value }));
    if (/^#[0-9a-fA-F]{6}$/.test(value)) change({ ...draft, colors: { ...draft.colors, [key]: value } });
  }
  function exportJSON() {
    if (invalidHex) { setError("Finish the hex colors before exporting."); return null; }
    const result = customThemeSchema.safeParse(draft);
    if (!result.success) { setError("Give your theme a name and complete its fields before exporting."); return null; }
    const content = JSON.stringify(result.data, null, 2); setJson(content); return content;
  }
  return createPortal(<div className="theme-studio-backdrop" onClick={event => { if (event.target === event.currentTarget) controller.closeStudio(); }}>
    <div className="theme-studio" data-theme-studio ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="studio-header"><div><p>YOUR PALETTE. YOUR PLAYTHROUGH.</p><h2 id={titleId}>Custom Theme Studio</h2><span>Preview the app live. Save to keep it; closing restores your selected theme.</span></div>
        <button type="button" aria-label="Close Custom Theme Studio" onClick={controller.closeStudio}>✕</button></header>
      <div className="studio-toolbar">
        <label>Edit saved theme<select aria-label="Edit saved theme" value={exists ? draft.id : ""} onChange={event => {
          const theme = controller.themes.find(theme => theme.id === event.target.value); if (theme) load(theme);
        }}><option value="">New / imported theme</option>{controller.themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
        <button type="button" onClick={() => load(newCustomTheme(draft.baseLayout))}>New theme</button>
        <button type="button" onClick={() => load({ ...draft, id: newCustomTheme(draft.baseLayout).id, name: `${draft.name.slice(0, 53)} copy` })}>Duplicate</button>
      </div>
      <div className="studio-template-picker">
        <label>Start from Template<select aria-label="Start from Template" aria-describedby={`${titleId}-template-help`} value="" onChange={event => {
          const template = templates.find(template => template.key === event.target.value);
          if (!template) return;
          load(applyThemeTemplate(draft, template)); setJson("");
          setMessage(`${template.name} copied into this draft. Save to keep it.`);
        }}>
          <option value="" disabled>Choose a theme to copy…</option>
          {themeTemplateGroups.map(group => {
            const sources = templates.filter(template => template.group === group.key);
            return sources.length > 0 && <optgroup key={group.key} label={group.name}>{sources.map(template => <option key={template.key} value={template.key}>{template.name}</option>)}</optgroup>;
          })}
        </select></label>
        <p className="studio-help" id={`${titleId}-template-help`}>Replace this draft’s colors, effects and labels. Its name stays the same. Saved source themes stay unchanged.</p>
      </div>
      <div className="studio-fields">
        <label>Theme name<input value={draft.name} onChange={event => change({ ...draft, name: event.target.value })} maxLength={60} placeholder="Midnight orchard" /></label>
        <label>Base layout<select aria-label="Base layout" value={draft.baseLayout} onChange={event => change({ ...draft, baseLayout: event.target.value as LayoutMode })}><option value="cyberpunk">Cyberpunk</option><option value="fantasy">Fantasy</option></select></label>
      </div>
      <section aria-labelledby={`${titleId}-colors`}><h3 id={`${titleId}-colors`}>01 / Color palette</h3><p className="studio-help">Pick a color or enter a six-digit hex value. Invalid hex values stay in the editor until corrected.</p>
        <div className="studio-palette-preview" aria-label="Live palette preview" style={{ background: draft.colors.background, color: draft.colors.text, borderColor: draft.colors.border, borderRadius: draft.borderRadius }}>
          <div style={{ background: draft.colors.surface, borderColor: draft.colors.border, borderRadius: draft.borderRadius }}>
            <small style={{ color: draft.colors.muted }}>YOUR NEXT ADVENTURE</small><strong style={{ color: draft.colors.text }}>{draft.terminology.libraryTitle?.trim() || (draft.baseLayout === "fantasy" ? "Your Quest Journal" : "System Playqueue")}</strong>
            <p style={{ color: draft.colors.muted }}>A palette for the stories still waiting to be played.</p><span style={{ color: draft.colors.accent, borderColor: draft.colors.accent }}>3 games · Ready when you are →</span>
          </div>
        </div>
        <div className="studio-color-grid">{(Object.entries(themeColorFields) as [ThemeColorKey, string][]).map(([key, label]) => <div className="studio-color" key={key}>
          <label htmlFor={`${titleId}-${key}`}>{label}</label><div>
            <input type="color" aria-label={`Pick ${label.toLowerCase()}`} value={draft.colors[key]} onChange={event => color(key, event.target.value)} />
            <input id={`${titleId}-${key}`} type="text" value={hexDrafts[key] ?? draft.colors[key]} onChange={event => color(key, event.target.value)} maxLength={7} spellCheck={false} autoCapitalize="none" aria-invalid={hexDrafts[key] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(hexDrafts[key]!)} />
          </div>
        </div>)}</div>
      </section>
      <section aria-labelledby={`${titleId}-effects`}><h3 id={`${titleId}-effects`}>02 / Atmosphere & shape</h3>
        <div className="studio-effects">{([['scanlines', 'Scanlines'], ['particles', 'Floating fairies / particles'], ['parchment', 'Fantasy backdrop / parchment'], ['haunted', 'Haunted decorations']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.effects[key]} onChange={event => change({ ...draft, effects: { ...draft.effects, [key]: event.target.checked } })} />{label}</label>)}</div>
        <label className="studio-radius">Border radius <output>{draft.borderRadius}px</output><input aria-label="Border radius" type="range" min={0} max={32} step={1} value={draft.borderRadius} onChange={event => change({ ...draft, borderRadius: Number(event.target.value) })} /></label>
      </section>
      <section aria-labelledby={`${titleId}-terms`}><h3 id={`${titleId}-terms`}>03 / Make it your own</h3><p className="studio-help">Optional display labels. Blank fields keep the base layout’s existing terminology. Game data and statuses stay the same.</p>
        <div className="studio-fields">{(Object.entries(themeTermFields) as [ThemeTermKey, string][]).map(([key, label]) => <label key={key}>{label}<input value={draft.terminology[key] ?? ""} maxLength={80} placeholder="Use the default label" onChange={event => change({ ...draft, terminology: { ...draft.terminology, [key]: event.target.value } })} /></label>)}</div>
      </section>
      <section aria-labelledby={`${titleId}-json`}><h3 id={`${titleId}-json`}>04 / Share a palette</h3><p className="studio-help">Copy a share link or theme JSON. Paste someone else’s JSON to validate it. Shared themes stay as a preview until you save.</p>
        <label>Theme JSON<textarea aria-label="Theme JSON" value={json} onChange={event => { setJson(event.target.value); setMessage(""); }} rows={6} maxLength={12000} spellCheck={false} placeholder='{ "id": "custom-…", "name": "…", "colors": { … } }' /></label>
        <div className="studio-actions">
          <button type="button" onClick={() => {
            if (!exportJSON()) return;
            try {
              const link = createThemeShareUrl(draft, window.location.href); setShareLink(link); setError("");
              if (!navigator.clipboard) { setMessage("Share link ready below. Select it to copy."); return; }
              void navigator.clipboard.writeText(link).then(() => setMessage("Share link copied to clipboard.")).catch(() => setMessage("Clipboard unavailable. Select the share link below to copy it."));
            } catch (cause) { setError(cause instanceof Error ? cause.message : "This theme could not be shared."); }
          }}>Copy Share Link</button>
          <button type="button" onClick={() => { const content = exportJSON(); if (!content) return;
            void navigator.clipboard?.writeText(content).then(() => setMessage("Theme JSON copied to clipboard.")).catch(() => setMessage("Clipboard unavailable. Your JSON is in the field above; select it to copy."));
            if (!navigator.clipboard) setMessage("Your JSON is in the field above; select it to copy.");
          }}>Copy theme JSON</button>
          <button type="button" onClick={() => { try { load(parseCustomThemeJSON(json)); setMessage("Theme JSON validated. Preview applied; save to keep it."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid theme JSON."); } }}>Validate & preview JSON</button>
        </div>
        {shareLink && <label>Share link<textarea aria-label="Share link" value={shareLink} readOnly rows={2} onFocus={event => event.currentTarget.select()} /></label>}
      </section>
      <p className="studio-error" role="alert">{error || (invalidHex ? "Use # followed by six hex digits for every color." : "")}</p>
      {message && <p className="studio-message" role="status">{message}</p>}
      <footer className="studio-footer"><span>Saved in this browser · Share by link or JSON</span><div className="studio-actions">
        {exists && <button className="studio-delete" type="button" onClick={() => { try { controller.remove(draft.id); setDraft(newCustomTheme(baseLayout)); setHexDrafts({}); setMessage("Custom theme deleted. The built-in themes are still available."); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Theme could not be deleted."); } }}>Delete custom theme</button>}
        <button type="button" onClick={controller.closeStudio}>Cancel preview</button>
        <button className="studio-save" type="button" disabled={invalidHex || !draft.name.trim()} onClick={() => { try { controller.save(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : "Theme could not be saved."); } }}>Save & apply theme</button>
      </div></footer>
    </div>
  </div>, document.body);
}
