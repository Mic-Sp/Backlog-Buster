"use client";

import { useEffect, useRef, useState } from "react";
import NetrunnerIdCard from "@/components/NetrunnerIdCard";
import { DEFAULT_AVATAR_URL } from "@/lib/operator-avatar";
import { captureDossierPng, downloadDossier, loadDossierArtwork } from "@/lib/dossier-snapshot";
import type { PublicDossier } from "@/lib/public-dossier";

export default function PublicDossierCard({ dossier, artwork, timestamp }: { dossier: PublicDossier; artwork: Record<string, string | null>; timestamp: string }) {
  const cardRef = useRef<SVGSVGElement>(null);
  const exporting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [defaultAvatar, setDefaultAvatar] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    void loadDossierArtwork(DEFAULT_AVATAR_URL, controller.signal).then(image => {
      if (!disposed) { setDefaultAvatar(image); setReady(true); }
    }).finally(() => clearTimeout(timer));
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, []);
  async function exportSnapshot(action: "copy" | "download") {
    if (!ready || !cardRef.current || exporting.current) return;
    if (action === "copy" && (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined")) {
      setFeedback({ text: "IMAGE CLIPBOARD UNAVAILABLE // USE DOWNLOAD ID SNAPSHOT", error: true });
      return;
    }
    exporting.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const png = captureDossierPng(cardRef.current);
      void png.catch(() => {});
      if (action === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        setFeedback({ text: "ID CARD COPIED TO CLIPBOARD // READY FOR TRANSMISSION", error: false });
      } else {
        downloadDossier(await png, dossier.identity.callsign);
        setFeedback({ text: "ID SNAPSHOT DOWNLOADED // 2000 × 1360 PNG", error: false });
      }
    } catch {
      setFeedback({ text: action === "copy" ? "CLIPBOARD ACCESS FAILED // TRY DOWNLOAD ID SNAPSHOT" : "SNAPSHOT EXPORT FAILED // PLEASE TRY AGAIN", error: true });
    } finally { exporting.current = false; setBusy(false); }
  }

  return <><NetrunnerIdCard data={dossier.card} identity={dossier.identity} timestamp={timestamp} artwork={{ ...artwork, [DEFAULT_AVATAR_URL]: defaultAvatar }} cardRef={cardRef} />
    <div className="public-dossier-exports" aria-busy={busy}>
      <button type="button" disabled={busy || !ready} onClick={() => void exportSnapshot("copy")}>📋 COPY DOSSIER TO CLIPBOARD</button>
      <button type="button" disabled={busy || !ready} onClick={() => void exportSnapshot("download")}>💾 DOWNLOAD ID SNAPSHOT</button>
    </div>
    {busy && <p className="public-dossier-eyebrow" role="status">ENCODING ID SNAPSHOT…</p>}
    {feedback && <p className="public-dossier-feedback" role={feedback.error ? "alert" : "status"} data-error={feedback.error}>{feedback.text}</p>}
  </>;
}
