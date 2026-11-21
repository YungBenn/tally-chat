import { ConvexError } from "convex/values";

/**
 * Rethrows a failed send as the error the composer shows: the server's own message (budget
 * reached, missing key) or a generic one. Used as `.catch(rethrowSendError)` rather than a
 * try/catch, which React Compiler can't compile around the send's conditional arguments.
 */
export function rethrowSendError(err: unknown): never {
  throw new Error(err instanceof ConvexError ? String(err.data) : "Could not send");
}
