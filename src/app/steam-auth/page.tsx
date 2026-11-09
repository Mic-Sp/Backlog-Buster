import { Suspense } from "react";
import SteamAuthNotice from "@/components/SteamAuthNotice";

export const metadata = { title: "Steam account access — Backlog Buster", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
async function Content({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const status = (await searchParams).status;
  return <SteamAuthNotice status={typeof status === "string" ? status : "failed"} />;
}
export default function Page(props: { searchParams: Promise<{ status?: string | string[] }> }) {
  return <Suspense fallback={<main className="page-shell"><p role="status">Opening Steam account access…</p></main>}><Content {...props} /></Suspense>;
}
