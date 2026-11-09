"use client";

import { useEffect, useState } from "react";
import { useLayoutCopy } from "@/components/LayoutText";
import { getAccountSecuritySummary } from "@/app/security-actions";
import type { AccountSecuritySummary } from "@/lib/account-security";
import { unwrapActionResult } from "@/lib/action-result";
import SteamAuthButton from "@/components/SteamAuthButton";

type SteamSummary = Pick<AccountSecuritySummary, "steamVerifiedId" | "steamVerifiedAt" | "steamSyncId">;
export default function SteamConnection({ summary, disabled = false }: { summary?: SteamSummary; disabled?: boolean }) {
  const copy = useLayoutCopy();
  const [loaded, setLoaded] = useState<SteamSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (summary) return;
    let disposed = false;
    void getAccountSecuritySummary().then(result => { const data = unwrapActionResult(result); if (!disposed) setLoaded(data); })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [summary]);
  const current = summary ?? loaded;
  return <section className="security-steam" aria-label="Steam verification">
    <h3>{copy("STEAM CONNECTION // VERIFIED IDENTITY", "STEAM CONNECTION · VERIFIED SEAL")}</h3>
    <p className="steam-verification-status" role="status">{current ? current.steamVerifiedId ? `✓ Steam ownership verified · ${current.steamVerifiedId}` : "Steam ownership not verified" : failed ? "Steam verification status unavailable. Reopen settings to retry." : "Checking Steam verification…"}</p>
    {current && !current.steamVerifiedId && <>
      <p className="steam-connection-hint">Verify ownership to sign in to this same account with Steam. A manually entered sync profile does not verify ownership.</p>
      <SteamAuthButton mode="link" disabled={disabled} />
    </>}
    {current?.steamVerifiedId && <p className="steam-connection-hint">Continue with Steam opens this player’s library. Your other sign-in methods are kept.</p>}
    {current?.steamSyncId && <p className="steam-connection-hint">Library sync profile: {current.steamSyncId}{current.steamSyncId === current.steamVerifiedId ? " · verified" : " · separate, unverified sync target"}. Linking keeps this profile.</p>}
  </section>;
}
