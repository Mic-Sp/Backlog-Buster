"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { InputError, safeAction } from "@/lib/action-result";
import { isValidEmail, normalizeEmail } from "@/lib/email-validation";
import { isValidPassword } from "@/lib/password-validation";
import { consumeAuthToken, invalidLinkMessage, isAuthLinkValid } from "@/lib/auth-tokens";
import { hashPassword } from "@/lib/auth-crypto";
import { deliverAuthEmail } from "@/lib/auth-email";
import { getCredentialSession } from "@/lib/account-security";

export async function requestPasswordReset(formData: FormData) {
  return safeAction(async () => {
    const raw = formData instanceof FormData ? formData.get("email") : null;
    if (typeof raw !== "string" || !isValidEmail(normalizeEmail(raw))) throw new InputError("Enter a valid email address.");
    const email = normalizeEmail(raw);
    after(() => deliverAuthEmail(email, "reset_password"));
    return { message: "If an account matches that email, a password reset link will be sent. You can request another link in one minute.", retryAfterSeconds: 60 };
  });
}

export async function resendVerificationEmail() {
  return safeAction(async () => {
    const { player } = await getCredentialSession();
    if (!player.email) throw new InputError("Add an email address in Account Security first.");
    after(() => deliverAuthEmail(player.email!, "verify_email", player.id));
    return { message: "Verification requested. Check your inbox; you can request another link in one minute.", retryAfterSeconds: 60 };
  });
}

export async function verifyEmail(token: string) {
  return safeAction(async () => {
    await consumeAuthToken(token, "verify_email");
    revalidatePath("/", "layout");
    return { message: "Email verified. Your account is ready." };
  });
}

export async function resetPassword(token: string, formData: FormData) {
  return safeAction(async () => {
    const password = formData instanceof FormData ? formData.get("password") : null;
    const confirmation = formData instanceof FormData ? formData.get("confirmPassword") : null;
    if (typeof password !== "string" || !isValidPassword(password)) throw new InputError("Use a password of 8–128 characters; it cannot be only spaces.");
    if (confirmation !== password) throw new InputError("Passwords do not match.");
    if (!await isAuthLinkValid(token, "reset_password")) throw new InputError(invalidLinkMessage);
    await consumeAuthToken(token, "reset_password", await hashPassword(password));
    // Do not automatically sign in or clear a cookie belonging to another
    // player. All sessions for the reset account were revoked transactionally.
    revalidatePath("/", "layout");
    return { message: "Password updated. All devices have been signed out. Sign in with your new password." };
  });
}
