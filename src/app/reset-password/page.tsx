import AuthLinkPage, { type AuthLinkSearch } from "@/components/AuthLinkPage";

export const metadata = { title: "Reset password — Backlog Buster", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function Page({ searchParams }: { searchParams: AuthLinkSearch }) { return <AuthLinkPage mode="reset" searchParams={searchParams} />; }
