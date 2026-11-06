import { buildDossierMetadata } from "@/lib/dossier-metadata";
import { ThemePlayerSync, ThemeToggle } from "@/components/ThemeProvider";
import { cache, Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getPublicDossier, getPublicDossierArtwork } from "@/lib/public-dossier";
import PublicDossierCard from "@/components/PublicDossierCard";
import DossierSignalLost from "@/components/DossierSignalLost";
import { getDossierSocialContext } from "@/lib/social";
import DossierRelationshipControls from "@/components/SocialControls";
import { getCurrentPlayer } from "@/lib/player";

// React cache is request-scoped: access decisions must never be shared across viewers.
const readDossier = cache(getPublicDossier);

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  try {
    await connection();
    const { handle } = await params;
    return buildDossierMetadata(await readDossier(handle));
  } catch {
    return { title: "REGISTRY OFFLINE — Backlog Buster", robots: { index: false, follow: false } };
  }
}

async function Dossier({ params }: { params: Promise<{ handle: string }> }) {
  await connection();
  const { handle } = await params;
  let dossier;
  try { dossier = await readDossier(handle); }
  catch { return <DossierSignalLost unavailable />; }
  if (!dossier) notFound();
  // Appearance belongs to the viewer; never apply the target profile's layout.
  const viewer = await getCurrentPlayer().catch(() => null);
  const relationship = await getDossierSocialContext(dossier.identity.handle).catch(() => null);
  const artwork = await getPublicDossierArtwork(dossier);
  return <>
    <ThemePlayerSync player={viewer && !viewer.isLocal ? { id: viewer.id, preferredLayoutMode: viewer.preferredLayoutMode } : null} />
    <main className="public-dossier-page">
      <section className="public-dossier-frame" aria-label={`${dossier.identity.callsign} public dossier`}>
        <header className="public-dossier-heading">
          <p className="public-dossier-eyebrow">PUBLIC TRANSMISSION // READ-ONLY CITIZEN DOSSIER</p>
          <h1>@{dossier.identity.handle}</h1>
          <ThemeToggle />
        </header>
        {relationship && <DossierRelationshipControls key={`${relationship.target.id}:${relationship.relationship}`} context={relationship} />}
        <PublicDossierCard dossier={dossier} artwork={artwork} timestamp={new Date().toISOString()} />
        <footer className="public-dossier-footer"><Link className="public-dossier-gateway" href="/" prefetch={false}>⚡ INITIALIZE YOUR OWN ARCHIVE // BACKLOG BUSTER</Link></footer>
      </section>
    </main>
  </>;
}

export default function Page({ params }: { params: Promise<{ handle: string }> }) {
  return <Suspense fallback={<main className="public-dossier-page"><p className="public-dossier-eyebrow" role="status">CONNECTING TO NIGHT CITY REGISTRY…</p></main>}><Dossier params={params} /></Suspense>;
}
