export class InputError extends Error {}
export type ActionError = { error: string; status?: number; retryAfterSeconds?: number };
export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`NEURAL LINK OVERLOADED // CORTEX COOLING DOWN — RETRY IN ${retryAfterSeconds}s`);
  }
}
export class ActionFailure extends Error {
  constructor(message: string, public retryAfterSeconds?: number) { super(message); }
}

export function unwrapActionResult<T>(result: T): Exclude<T, ActionError> {
  if (result && typeof result === "object" && "error" in result && typeof result.error === "string" && result.error) {
    throw new ActionFailure(result.error, "retryAfterSeconds" in result && typeof result.retryAfterSeconds === "number" ? result.retryAfterSeconds : undefined);
  }
  return result as Exclude<T, ActionError>;
}

export function actionErrorMessage(error: unknown, fallback = "Could not save your changes. Please try again.") {
  if (error instanceof ActionFailure && error.retryAfterSeconds) return "Request limit reached. Wait for the cooldown before retrying.";
  if (error instanceof InputError || error instanceof ActionFailure) return error.message;
  if (error instanceof Error && error.name === "AuthenticationRequiredError") return "Sign in to access your library.";
  return fallback;
}

type Success<T> = T extends void ? { success: true } : T;
export async function safeAction<T>(operation: () => Promise<T>): Promise<Success<T> | ActionError> {
  try {
    const result = await operation();
    return (result === undefined ? { success: true } : result) as Success<T>;
  } catch (error) {
    return error instanceof RateLimitError ? { error: error.message, status: 429, retryAfterSeconds: error.retryAfterSeconds } : { error: actionErrorMessage(error) };
  }
}
