import { Suspense } from "react";
import GoogleAuthNotice from "@/components/GoogleAuthNotice";

export const metadata = { title: "Google account access — Backlog Buster", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
async function Content({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const status = (await searchParams).status;
  return <GoogleAuthNotice status={typeof status === "string" ? status : "failed"} />;
}
export default function Page(props: { searchParams: Promise<{ status?: string | string[] }> }) {
  return <Suspense fallback={<main className="page-shell"><p role="status">Opening Google account access…</p></main>}><Content {...props} /></Suspense>;
}
