import type { Metadata } from "next";
import type { PublicDossier } from "@/lib/public-dossier";

export function buildDossierMetadata(dossier: PublicDossier | null): Metadata {
  if (!dossier) return { title: "SIGNAL LOST // Operator Not Found — Backlog Buster", robots: { index: false, follow: false } };
  const { callsign, handle } = dossier.identity;
  const { level, counts, totalXp } = dossier.card;
  const title = `${callsign} (@${handle}) // LV ${level} Netrunner Dossier — Backlog Buster`;
  const description = `${callsign} (@${handle}) is a Level ${level} Netrunner with ${counts.Completed} cleared gigs and ${totalXp.toLocaleString("en-US")} lifetime XP. Explore their public career dossier, milestones and five-star trophies.`;
  return {
    title, description,
    openGraph: { title, description, type: "profile", siteName: "Backlog Buster" },
    twitter: { card: "summary", title, description },
  };
}
