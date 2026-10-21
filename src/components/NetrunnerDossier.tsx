"use client";

import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";

import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OperatorAvatar from "@/components/OperatorAvatar";
import { avatarPresets, customAvatarUrl, DEFAULT_AVATAR_URL, resolveAvatarPreset } from "@/lib/operator-avatar";
import NetrunnerIdCard from "@/components/NetrunnerIdCard";
import { dossierAccents, dossierIdentityFromProfile, type DossierAccent, type DossierData, type DossierIdentity } from "@/lib/dossier";
import { savePlayerProfile } from "@/app/profile-actions";
import type { PlayerProfile } from "@/lib/player-profile-types";
import { captureDossierPng, downloadDossier, loadDossierArtwork } from "@/lib/dossier-snapshot";
import "./NetrunnerDossier.css";

export default function NetrunnerDossier({ data }: { data: DossierData }) {
  const [isOpen, setIsOpen] = useState(false);
  const [identity, setIdentity] = useState<DossierIdentity>(() => dossierIdentityFromProfile(data.profile, data.trophies));
  const identityRef = useRef(identity);
  const savedIdentityKey = useRef(JSON.stringify(identity));
  const savedProfile = useRef<PlayerProfile>(data.profile);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [publicHandle, setPublicHandle] = useState(data.profile.handle ?? "");
  const [handlePrompt, setHandlePrompt] = useState("");
  const customizeRef = useRef<HTMLDetailsElement>(null);
  const handleInputRef = useRef<HTMLInputElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const [timestamp, setTimestamp] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [artworkState, setArtworkState] = useState<{ key: string; images: Record<string, string | null> }>({ key: "", images: {} });
  const artworkCache = useRef(new Map<string, string>());
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const artworkKey = useMemo(() => JSON.stringify([...new Set([
    DEFAULT_AVATAR_URL,
    ...(customAvatarUrl(identity.avatarUrl) ? [customAvatarUrl(identity.avatarUrl)!] : []),
    ...identity.showcase.flatMap((id) => {
      const cover = data.trophies.find((game) => game.id === id)?.coverUrl;
      return cover ? [cover] : [];
    }),
  ])]), [identity.showcase, data.trophies, identity.avatarUrl]);
  const artworkReady = artworkState.key === artworkKey;
  const missingArtwork = artworkReady && identity.showcase.some(id => {
    const game = data.trophies.find(trophy => trophy.id === id);
    return game && (!game.coverUrl || !artworkState.images[game.coverUrl]);
  });

  function openDossier() {
    const profile = data.profile.updatedAt >= savedProfile.current.updatedAt ? data.profile : savedProfile.current;
    const next = dossierIdentityFromProfile(profile, data.trophies);
    identityRef.current = next;
    savedIdentityKey.current = JSON.stringify(next);
    setIdentity(next);
    setSaveStatus("saved");
    setPublicHandle(profile.handle ?? "");
    setHandlePrompt("");
    setTimestamp(new Date().toISOString());
    setFeedback(null);
    setIsOpen(true);
  }

  // Serialize saves and drain the newest draft if editing continues during a request.
  // Revalidated props must not overwrite a newer draft that is still being typed.
  const persistLatest = useCallback((): Promise<boolean> => {
    if (saveInFlight.current) return saveInFlight.current;
    const task = (async () => {
      try {
        while (JSON.stringify(identityRef.current) !== savedIdentityKey.current) {
          const draft = identityRef.current;
          const key = JSON.stringify(draft);
          setSaveStatus("saving");
          savedProfile.current = unwrapActionResult(await savePlayerProfile({
            operatorName: draft.callsign, handle: draft.handle, tagline: draft.tagline, avatarUrl: draft.avatarUrl,
            neonAccent: draft.accent.toUpperCase() as PlayerProfile["neonAccent"],
            featuredTrophyIds: draft.showcase,
          }));
          setPublicHandle(savedProfile.current.handle ?? "");
          if (savedProfile.current.handle) setHandlePrompt("");
          savedIdentityKey.current = key;
          if (JSON.stringify(identityRef.current) === key) {
            const normalized = { ...draft, avatarUrl: savedProfile.current.avatarUrl, callsign: savedProfile.current.operatorName, handle: savedProfile.current.handle ?? "", tagline: savedProfile.current.tagline };
            identityRef.current = normalized;
            savedIdentityKey.current = JSON.stringify(normalized);
            setIdentity(normalized);
          }
        }
        setSaveStatus("saved");
        return true;
      } catch (cause) {
        setSaveError(actionErrorMessage(cause, "Profile save failed. Your draft is still here."));
        setSaveStatus("error");
        return false;
      }
    })();
    saveInFlight.current = task;
    void task.then(() => { saveInFlight.current = null; });
    return task;
  }, []);

  function saveIdentity() {
    if (saveInFlight.current) return;
    // Urgent feedback must render before the Server Action transition completes.
    setSaveStatus("saving");
    startTransition(async () => { await persistLatest(); });
  }

  function customize(next: DossierIdentity) {
    identityRef.current = next;
    setIdentity(next);
    setSaveStatus("pending");
    setSaveError("");
  }

  const closeDossier = useCallback(() => {
    if (busyRef.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    startTransition(async () => {
      if (await persistLatest()) setIsOpen(false);
      closingRef.current = false;
      setClosing(false);
    });
  }, [persistLatest]);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLInputElement>('input[name="callsign"]')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDossier();
      }
      if (event.key !== "Tab") return;
      const controls = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]');
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [isOpen, closeDossier]);

  useEffect(() => {
    if (!isOpen || busy) return;
    const timer = window.setInterval(() => setTimestamp(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, busy]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let cancelled = false;
    const urls = JSON.parse(artworkKey) as string[];
    void Promise.all(urls.map(async (url) => {
      const image = artworkCache.current.get(url) ?? await loadDossierArtwork(url, controller.signal);
      if (image) {
        // Bound memory while browsing different showcases during a long session.
        if (artworkCache.current.size >= 24) artworkCache.current.delete(artworkCache.current.keys().next().value!);
        artworkCache.current.set(url, image);
      }
      return [url, image] as const;
    })).then((entries) => {
      window.clearTimeout(timeout);
      if (!cancelled) setArtworkState({ key: artworkKey, images: Object.fromEntries(entries) });
    });
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [isOpen, artworkKey]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), feedback.error ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copyPublicLink() {
    if (busyRef.current || closingRef.current) return;
    if (!publicHandle) {
      setHandlePrompt("Claim and save a unique handle first to activate your public dossier link.");
      if (customizeRef.current) customizeRef.current.open = true;
      handleInputRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      handleInputRef.current?.focus({ preventScroll: true });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dossier/${encodeURIComponent(publicHandle)}`);
      setFeedback({ text: "PUBLIC DOSSIER LINK COPIED // READY FOR TRANSMISSION", error: false });
    } catch {
      setFeedback({ text: "CLIPBOARD ACCESS FAILED // COPY THE PUBLIC LINK SHOWN BELOW", error: true });
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function exportSnapshot(action: "copy" | "download") {
    if (!cardRef.current || !artworkReady || busyRef.current) return;
    if (action === "copy" && (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined")) {
      setFeedback({ text: "IMAGE CLIPBOARD UNAVAILABLE // USE DOWNLOAD ID SNAPSHOT", error: true });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const png = captureDossierPng(cardRef.current);
      // ClipboardItem receives the promise during the click, retaining user activation.
      void png.catch(() => {});
      if (action === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        setFeedback({ text: "ID CARD COPIED TO CLIPBOARD // READY FOR TRANSMISSION", error: false });
      } else {
        downloadDossier(await png, identity.callsign);
        setFeedback({ text: "ID SNAPSHOT DOWNLOADED // 2000 × 1360 PNG", error: false });
      }
    } catch {
      setFeedback({ text: action === "copy" ? "CLIPBOARD ACCESS FAILED // TRY DOWNLOAD ID SNAPSHOT" : "SNAPSHOT EXPORT FAILED // PLEASE TRY AGAIN", error: true });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button className="dossier-trigger-button" ref={triggerRef} type="button" aria-haspopup="dialog" onClick={openDossier}>🪪 NETRUNNER DOSSIER</button>
      {isOpen && createPortal(
        <div className="dossier-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeDossier(); }}>
          <div className="dossier-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || closing}>
            <header className="dossier-modal-heading">
              <div><p>IDENTITY VERIFICATION // CAREER ARCHIVE</p><h2 id={titleId}>Netrunner Dossier</h2></div>
              <button className="dossier-close-button" type="button" aria-label="Close Netrunner dossier" disabled={busy || closing} onClick={closeDossier}>✕</button>
            </header>
            <div className="dossier-card-preview" aria-label="Shareable ID card preview">
              <NetrunnerIdCard data={data} identity={identity} timestamp={timestamp} artwork={artworkState.images} artworkLoading={!artworkReady} cardRef={cardRef} />
            </div>
            <p className="dossier-artwork-status" role="status">{!artworkReady ? "SYNCING PORTRAIT & TROPHY ARTWORK…" : missingArtwork ? "Some artwork is offline. The snapshot includes the offline tiles shown above." : "SNAPSHOT READY // HIGH-RESOLUTION PNG"}</p>

            <details className="dossier-customize" ref={customizeRef} open>
              <summary>⚙ PERSONALIZE IDENTITY</summary>
              <fieldset disabled={busy || closing || saveStatus === "saving"}>
                <legend className="dossier-sr-only">Customize your shareable identity card</legend>
                <div className="dossier-avatar-controls">
                  <p className="dossier-avatar-label">Operator Avatar</p>
                  <div className="dossier-avatar-presets" role="group" aria-label="Operator Avatar">
                    {avatarPresets.map((preset) => <button key={preset.id} className="dossier-avatar-preset" type="button" title={preset.title} aria-label={preset.title} aria-pressed={resolveAvatarPreset(identity.avatarUrl) === preset.id} onClick={() => customize({ ...identity, avatarUrl: preset.id === "bb" ? null : `preset:${preset.id}` })}>
                      <OperatorAvatar avatarUrl={preset.id === "bb" ? null : `preset:${preset.id}`} alt={preset.title} />
                    </button>)}
                  </div>
                  <label>Custom Avatar Image URL <span>(optional)</span><input name="avatarUrl" type="text" inputMode="url" autoComplete="url" maxLength={2048} placeholder="https://example.com/avatar.png" value={resolveAvatarPreset(identity.avatarUrl) ? "" : identity.avatarUrl ?? ""} onChange={(event) => customize({ ...identity, avatarUrl: event.target.value })} /></label>
                  <p className="dossier-avatar-help">Choose an emblem or paste an HTTP/HTTPS image URL. Unavailable images use the default BB emblem.</p>
                </div>
                <div className="dossier-identity-fields">
                  <label>Operator name<input name="callsign" value={identity.callsign} maxLength={28} placeholder="ANONYMOUS NETRUNNER" onChange={(event) => customize({ ...identity, callsign: event.target.value })} /></label>
                  <label>Handle <span>(optional)</span><input ref={handleInputRef} name="handle" value={identity.handle} maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="night-city-runner" aria-describedby={`${titleId}-handle-help`} onChange={(event) => customize({ ...identity, handle: event.target.value })} /><small id={`${titleId}-handle-help`}>3–32 lowercase letters, numbers or hyphens.</small>{handlePrompt && <span className="dossier-handle-prompt" role="alert">{handlePrompt}</span>}</label>
                  <label>Personal tagline<input name="tagline" value={identity.tagline} maxLength={64} onChange={(event) => customize({ ...identity, tagline: event.target.value })} /></label>
                  <label>Neon accent<select aria-label="Neon accent" value={identity.accent} onChange={(event) => customize({ ...identity, accent: event.target.value as DossierAccent })}>{Object.keys(dossierAccents).map((accent) => <option key={accent} value={accent}>{accent.toUpperCase()}</option>)}</select></label>
                </div>
                <div className="dossier-showcase-fields">
                  {Array.from({ length: 3 }, (_, index) => <label key={index}>Featured trophy {String(index + 1).padStart(2, "0")}
                    <select aria-label={`Featured trophy ${String(index + 1).padStart(2, "0")}`} value={data.trophies.some((game) => game.id === identity.showcase[index]) ? identity.showcase[index] ?? "" : ""} onChange={(event) => {
                      const showcase = [...identity.showcase];
                      showcase[index] = event.target.value ? Number(event.target.value) : null;
                      customize({ ...identity, showcase });
                    }}>
                      <option value="">Empty slot</option>
                      {data.trophies.map((game) => <option key={game.id} value={game.id} disabled={identity.showcase.some((id, otherIndex) => otherIndex !== index && id === game.id)}>{game.title}</option>)}
                    </select>
                  </label>)}
                </div>
              </fieldset>
              <button className="dossier-save-identity" type="button" disabled={busy || closing || saveStatus === "saving"} onClick={saveIdentity}>{saveStatus === "saving" ? "SAVING IDENTITY…" : "💾 SAVE IDENTITY TO ARCHIVE"}</button>
              <div className="dossier-profile-status" data-state={saveStatus}>
                <span role={saveStatus === "error" ? "alert" : "status"}>{saveStatus === "saved" ? "✓ IDENTITY SAVED TO OPERATOR CLOUD ARCHIVE" : saveStatus === "error" ? saveError : saveStatus === "pending" ? "UNSAVED IDENTITY CHANGES" : "SYNCING PLAYER IDENTITY…"}</span>
                {saveStatus === "error" && <button type="button" onClick={saveIdentity}>RETRY SAVE</button>}
              </div>
              <p>Identity preferences are saved to your operator’s cloud archive and follow your account across browsers. Showcase slots feature completed games rated five stars.</p>
            </details>
            {publicHandle && <div className="dossier-share-preview"><span>PUBLIC ARCHIVE // <code>/dossier/{publicHandle}</code></span><a className="dossier-public-open" href={`/dossier/${encodeURIComponent(publicHandle)}`} target="_blank" rel="noopener noreferrer">↗ OPEN PUBLIC PAGE</a></div>}
            <div className="dossier-export-actions">
              <button className="dossier-share-button" type="button" disabled={busy || closing || saveStatus === "saving"} onClick={() => void copyPublicLink()}>🔗 COPY PUBLIC DOSSIER LINK</button>
              <button className="dossier-copy-button" type="button" disabled={busy || closing || !artworkReady} onClick={() => void exportSnapshot("copy")}>📋 COPY DOSSIER TO CLIPBOARD</button>
              <button className="dossier-download-button" type="button" disabled={busy || closing || !artworkReady} onClick={() => void exportSnapshot("download")}>💾 DOWNLOAD ID SNAPSHOT</button>
            </div>
            {busy && <p className="dossier-artwork-status" role="status">ENCODING ID SNAPSHOT…</p>}
          </div>
          {feedback && <div className="dossier-feedback" role={feedback.error ? "alert" : "status"} data-error={feedback.error}>{feedback.text}</div>}
        </div>, document.body,
      )}
    </>
  );
}
