import Link from "next/link";

export default function DossierSignalLost({ unavailable = false }: { unavailable?: boolean }) {
  return <main className="public-dossier-page">
    <section className="public-dossier-signal" role="status">
      <p className="public-dossier-eyebrow">NIGHT CITY // PUBLIC OPERATOR REGISTRY</p>
      <h1>{unavailable ? "SIGNAL INTERRUPTED // REGISTRY TEMPORARILY OFFLINE" : "SIGNAL LOST // OPERATOR HANDLE NOT FOUND IN NIGHT CITY REGISTRY"}</h1>
      <Link className="public-dossier-gateway" href="/" prefetch={false}>⚡ RETURN TO MAIN GATEWAY</Link>
    </section>
  </main>;
}
