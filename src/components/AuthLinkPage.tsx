import { Suspense } from "react";
import { connection } from "next/server";
import AccountRecovery from "@/components/AccountRecovery";
import { isAuthLinkValid } from "@/lib/auth-tokens";

export type AuthLinkSearch = Promise<{ token?: string | string[] }>;

async function Content({ mode, searchParams }: { mode: "verify" | "reset"; searchParams: AuthLinkSearch }) {
  await connection();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && raw.length === 43 ? raw : "";
  let valid = false, initialError = "";
  try { valid = await isAuthLinkValid(token, mode === "verify" ? "verify_email" : "reset_password"); }
  catch { initialError = "Account service unavailable. Open the original email link again shortly."; }
  // Merely opening the page never consumes a link (email scanners are harmless).
  return <AccountRecovery mode={mode} token={token} valid={valid} initialError={initialError} />;
}

export default function AuthLinkPage(props: { mode: "verify" | "reset"; searchParams: AuthLinkSearch }) {
  return <Suspense fallback={<main className="page-shell"><p role="status">Opening secure account link…</p></main>}><Content {...props} /></Suspense>;
}
