import { Suspense } from "react";
import { connection } from "next/server";
import MemberCount from "@/components/MemberCount";
import { AccountGate } from "@/components/AccountControls";

export const metadata = { title: "Netrunner Access — Backlog Buster", robots: { index: false, follow: false } };

async function Access({ searchParams }: { searchParams: Promise<{ archive?: string | string[] }> }) {
  await connection();
  const { archive } = await searchParams;
  return <main className="page-shell">
    {archive === "wiped" && <p className="archive-termination-notice" role="status">OPERATOR ARCHIVE WIPED // CONNECTION TERMINATED</p>}
    <AccountGate />
    <MemberCount />
  </main>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ archive?: string | string[] }> }) {
  return <Suspense fallback={<main className="page-shell"><p className="loading-state">INITIALIZING NETRUNNER ACCESS…</p></main>}><Access searchParams={searchParams} /></Suspense>;
}
