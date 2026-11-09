import "server-only";

export type SteamAuthStatus = "state" | "session" | "cancelled" | "conflict" | "failed";
export class SteamOpenIDError extends Error {
  constructor(public status: SteamAuthStatus, public failure: string, public stage?: string) {
    super("Steam authentication could not be completed.");
    this.name = "SteamOpenIDError";
  }
}

export async function steamAuthStep<T>(stage: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof SteamOpenIDError) { error.stage ??= stage; throw error; }
    // Provider bodies, request URLs, signatures, cookies and DB messages stay private.
    throw new SteamOpenIDError("failed", "operation_failed", stage);
  }
}

export function logSteamAuthFailure(error: unknown, route: "authorize" | "callback", stage: string): SteamAuthStatus {
  const known = error instanceof SteamOpenIDError;
  const status = known ? error.status : "failed";
  console.error("[steam-openid]", status, { route, stage: known ? error.stage ?? stage : stage,
    failure: known ? error.failure : "operation_failed" });
  return status;
}
