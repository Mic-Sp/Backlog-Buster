import AuthLinkPage, { type AuthLinkSearch } from "@/components/AuthLinkPage";

export const metadata = { title: "Verify email — Backlog Buster", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function Page({ searchParams }: { searchParams: AuthLinkSearch }) { return <AuthLinkPage mode="verify" searchParams={searchParams} />; }
