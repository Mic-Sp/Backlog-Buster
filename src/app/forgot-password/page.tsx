import AccountRecovery from "@/components/AccountRecovery";

export const metadata = { title: "Forgot password — Backlog Buster", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function Page() { return <AccountRecovery mode="forgot" />; }
