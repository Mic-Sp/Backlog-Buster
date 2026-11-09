import "server-only";

import type { AuthTokenPurpose } from "@/generated/prisma/client";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function authLinkUrl(purpose: AuthTokenPurpose, token: string): string {
  const configured = process.env.APP_URL;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("APP_URL is required for transactional email.");
  const origin = new URL(configured || "http://localhost:3000");
  if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password ||
      (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) throw new Error("APP_URL must be a trusted HTTPS origin in production.");
  // Never derive password reset URLs from an untrusted Host or forwarded header.
  const url = new URL(purpose === "verify_email" ? "/verify-email" : "/reset-password", origin.origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function authEmailTemplate(purpose: AuthTokenPurpose, url: string, layoutMode: string) {
  const fantasy = layoutMode === "fantasy", verification = purpose === "verify_email";
  const heading = verification ? "Verify your email" : "Reset your password";
  const context = fantasy ? "THE ROYAL SEAL · BACKLOG BUSTER" : "ICE SECURITY GATEWAY // BACKLOG BUSTER";
  const explanation = verification
    ? "Confirm this email address for your account. You can keep signing in and using your library while verification is pending."
    : "A password reset was requested for your account. Choosing a new password signs out every device.";
  const expiry = verification ? "24 hours" : "30 minutes";
  const text = `${context}\n\n${heading}\n${explanation}\n\n${url}\n\nThis single-use link expires in ${expiry}. If you did not request this, ignore this email. Your password stays unchanged.\n`;
  const accent = fantasy ? "#e6ca81" : "#00f0ff", background = fantasy ? "#17221d" : "#0b101b";
  const html = `<html><body style="margin:0;background:${background};color:#edf4ec;font-family:${fantasy ? "Georgia,serif" : "monospace"};padding:32px"><main style="max-width:560px;margin:auto;border:1px solid ${accent};padding:28px"><p style="color:${accent}">${context}</p><h1>${heading}</h1><p style="line-height:1.7">${explanation}</p><p style="margin:32px 0"><a href="${escapeHtml(url)}" style="background:${accent};color:#101b18;padding:14px 20px;text-decoration:none">${heading}</a></p><p>This single-use link expires in ${expiry}.</p><p>If you did not request this, ignore this email. Your password stays unchanged.</p><p style="overflow-wrap:anywhere">Or open: <a style="color:${accent}" href="${escapeHtml(url)}">${escapeHtml(url)}</a></p></main></body></html>`;
  return { subject: `${heading} — Backlog Buster`, text, html };
}

export async function sendAuthEmail(email: string, purpose: AuthTokenPurpose, token: string, layoutMode = "cyberpunk") {
  const url = authLinkUrl(purpose, token);
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("Transactional email is not configured.");
    console.info(`[auth-email:development] ${purpose} to ${email}\n${url}`);
    return;
  }
  if (!process.env.EMAIL_FROM) throw new Error("EMAIL_FROM is required for transactional email.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], ...authEmailTemplate(purpose, url, layoutMode) }),
    signal: AbortSignal.timeout(10000), cache: "no-store",
  });
  // Never log the provider body: it may contain addresses, credentials or links.
  if (!response.ok) throw new Error(`Transactional email delivery failed (${response.status}).`);
}
