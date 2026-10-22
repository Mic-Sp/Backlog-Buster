import { buildDossierMetadata } from "@/lib/dossier-metadata";
import { ThemeToggle } from "@/components/ThemeProvider";
import { cache, Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getPublicDossier, getPublicDossierArtwork } from "@/lib/public-dossier";
import PublicDossierCard from "@/components/PublicDossierCard";
import DossierSignalLost from "@/components/DossierSignalLost";

const readDossier = cache(getPublicDossier);

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  try {
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
  const artwork = await getPublicDossierArtwork(dossier);
  return <main className="public-dossier-page">
    <section className="public-dossier-frame" aria-label={`${dossier.identity.callsign} public dossier`}>
      <header className="public-dossier-heading">
        <p className="public-dossier-eyebrow">PUBLIC TRANSMISSION // READ-ONLY CITIZEN DOSSIER</p>
        <h1>@{dossier.identity.handle}</h1>
        <ThemeToggle />
      </header>
      <PublicDossierCard dossier={dossier} artwork={artwork} timestamp={new Date().toISOString()} />
      <footer className="public-dossier-footer"><Link className="public-dossier-gateway" href="/" prefetch={false}>⚡ INITIALIZE YOUR OWN ARCHIVE // BACKLOG BUSTER</Link></footer>
    </section>
  </main>;
}

export default function Page({ params }: { params: Promise<{ handle: string }> }) {
  return <Suspense fallback={<main className="public-dossier-page"><p className="public-dossier-eyebrow" role="status">CONNECTING TO NIGHT CITY REGISTRY…</p></main>}><Dossier params={params} /></Suspense>;
}
