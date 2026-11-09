"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { decodeThemeShare } from "@/lib/theme-share";
import type { CustomTheme } from "@/lib/custom-theme";
import type { CustomThemesController } from "@/components/useCustomThemes";
import "./SharedThemePreview.css";

function PreviewBanner({ theme, controller }: { theme: CustomTheme; controller: CustomThemesController }) {
  const [error, setError] = useState("");
  // Use the editor's paint-isolation marker so even experimental palettes keep
  // their accept/revert controls readable. This banner never traps/moves focus.
  return <section className="shared-theme-banner" data-theme-studio aria-label="Shared theme preview">
    <div><p role="status">Previewing shared theme: <strong>{theme.name}</strong></p><small>Temporary preview · save it to keep it.</small></div>
    <div className="shared-theme-actions">
      <button type="button" className="shared-theme-save" onClick={() => {
        try { controller.saveShared(); } catch (cause) { setError(cause instanceof Error ? cause.message : "This theme could not be saved. Please try again."); }
      }}>Save &amp; Apply</button>
      <button type="button" onClick={controller.dismissShared}>Dismiss / Revert</button>
    </div>
    {error && <p className="shared-theme-error" role="alert">{error}</p>}
  </section>;
}

export default function SharedThemePreview({ controller }: { controller: CustomThemesController }) {
  const params = useSearchParams();
  const values = params.getAll("theme");
  // Ambiguous/empty/malformed parameters are inert; only one complete payload is accepted.
  const payload = values.length === 1 ? values[0] : null;
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current.previewShared(decodeThemeShare(payload));
  }, [payload]);
  // Wait for saved themes to restore before offering actions that persist a list.
  if (!controller.ready || !controller.sharedTheme || controller.studioOpen) return null;
  return <PreviewBanner key={payload} theme={controller.sharedTheme} controller={controller} />;
}
