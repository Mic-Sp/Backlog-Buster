import "server-only";

export type GoogleOAuthReason = "unavailable" | "state" | "cancelled" | "conflict" | "session" | "profile" | "failed";
type FailureDetail = {
  stage?: string; httpStatus?: number; providerError?: string;
  expectedOrigin?: string; storedOrigin?: string; cookiePresent?: boolean; statePresent?: boolean;
};

export class GoogleOAuthError extends Error {
  constructor(public reason: GoogleOAuthReason, public failure: string = reason, public detail: FailureDetail = {}, options?: ErrorOptions) {
    super(reason, options);
    this.name = "GoogleOAuthError";
  }
}

export async function googleOAuthStep<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof GoogleOAuthError) { error.detail.stage ??= stage; throw error; }
    throw new GoogleOAuthError("failed", "operation_failed", { stage }, { cause: error });
  }
}

// Never include error_description, response bodies, error.message or stacks:
// Google and database errors can contain credentials, queries or user data.
const providerErrors = new Set([
  "invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope",
  "access_denied", "server_error", "temporarily_unavailable", "redirect_uri_mismatch", "invalid_token",
  "disallowed_useragent", "org_internal", "admin_policy_enforced",
]);
export function safeGoogleProviderError(value: unknown): string {
  return typeof value === "string" && providerErrors.has(value) ? value : "unrecognized_provider_error";
}

export function googleDiagnosticOrigin(value: string): string {
  try { return new URL(value).origin; } catch { return "invalid_origin"; }
}

export function logGoogleOAuthFailure(error: unknown, context: {
  route: "authorize" | "callback"; stage: string; requestUrl: string; canonicalOrigin?: string;
}): GoogleOAuthReason {
  const oauthError = error instanceof GoogleOAuthError ? error : null;
  const underlying = oauthError?.cause ?? error;
  const record = underlying && typeof underlying === "object" ? underlying as Record<string, unknown> : {};
  const meta = record.meta && typeof record.meta === "object" ? record.meta as Record<string, unknown> : {};
  const code = typeof record.code === "string" && /^(P\d{4}|[0-9A-Z]{5}|E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NOTFOUND|AI_AGAIN)|ERR_(?:JWT|JWS|JWKS|JOSE|JWE)_[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(record.code) ? record.code : undefined;
  const reason = oauthError?.reason ?? "failed";
  console.error("[google-oauth]", reason, {
    route: context.route, stage: oauthError?.detail.stage ?? context.stage,
    failure: oauthError?.failure ?? "unexpected_error",
    requestOrigin: googleDiagnosticOrigin(context.requestUrl),
    ...(context.canonicalOrigin ? { canonicalOrigin: googleDiagnosticOrigin(context.canonicalOrigin) } : {}),
    ...(oauthError?.detail ?? {}),
    ...(code ? { errorCode: code } : {}),
    ...(["AuthSecret", "GoogleOAuthAttempt", "Player", "PlayerSession"].includes(String(meta.modelName)) ? { model: meta.modelName } : {}),
    ...(typeof record.claim === "string" && ["iss", "aud", "exp", "iat", "nbf", "sub", "nonce", "azp", "email", "email_verified"].includes(record.claim) ? { claim: record.claim } : {}),
    ...(underlying instanceof Error ? { errorType: ["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError", "PrismaClientKnownRequestError", "PrismaClientInitializationError", "JWTExpired", "JWTClaimValidationFailed", "JWKSTimeout", "JWSSignatureVerificationFailed"].includes(underlying.name) ? underlying.name : "OAuthOperationError" } : {}),
  });
  return reason;
}
