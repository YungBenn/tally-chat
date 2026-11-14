import { v, type Infer } from "convex/values";

// Prompt-cache lifetimes tally.chat asks Anthropic for (spec phase 2, "Request layout").
export const cacheTtlValidator = v.union(v.literal("5m"), v.literal("1h"));
export type CacheTtl = Infer<typeof cacheTtlValidator>;
export const CACHE_TTL_MS: Record<CacheTtl, number> = { "5m": 5 * 60_000, "1h": 60 * 60_000 };

// When a thread's cache expires, or null if nothing ever touched it.
export function cacheExpiresAt(thread: { cacheTouchedAt?: number; cacheTtl?: CacheTtl }) {
  return thread.cacheTouchedAt === undefined ? null : thread.cacheTouchedAt + CACHE_TTL_MS[thread.cacheTtl ?? "5m"];
}

// Warm or cold at `now`. Queries can't read the clock, so getThread returns the expiry and
// the client (and the keepalive job) judge it against the current time with this.
export type CacheState = { state: "cold" } | { state: "warm"; until: number };
export function cacheState(expiresAt: number | null, now: number): CacheState {
  return expiresAt !== null && now < expiresAt ? { state: "warm", until: expiresAt } : { state: "cold" };
}
