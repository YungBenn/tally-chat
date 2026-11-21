import { v, type Infer } from "convex/values";

// Prompt-cache lifetimes tally.chat asks Anthropic for (spec phase 2, "Request layout").
export const cacheTtlValidator = v.union(v.literal("5m"), v.literal("1h"));
export type CacheTtl = Infer<typeof cacheTtlValidator>;
export const CACHE_TTL_MS: Record<CacheTtl, number> = { "5m": 5 * 60_000, "1h": 60 * 60_000 };

// When a thread's cache expires, or null if nothing ever touched it.
export function cacheExpiresAt(thread: { cacheTouchedAt?: number; cacheTtl?: CacheTtl }) {
  return thread.cacheTouchedAt === undefined ? null : thread.cacheTouchedAt + CACHE_TTL_MS[thread.cacheTtl ?? "5m"];
}

// The lifetime a request asks for, given how many messages precede its reply. With keepalive off,
// pauses up to an hour stay cheap from the second turn on (the first turn's prefix is too short
// to be worth a 2x write). On, keepalive covers the pauses.
export function requestCacheTtl(keepaliveEnabled: boolean | undefined, ancestors: number): CacheTtl {
  return keepaliveEnabled === false && ancestors > 1 ? "1h" : "5m";
}

// Keepalives stop this long after the owner's last activity in a thread.
export const ACTIVE_WINDOW_MS = 30 * 60_000;

// The cache at `now`: cold, warm until its expiry, or kept alive (warm, a keepalive pending
// and the owner active). Queries can't read the clock, so getThread returns the raw fields
// and the client and the keepalive job judge them against the current time with this.
export type CacheState = { state: "cold" } | { state: "warm" | "keepalive"; until: number };
export function cacheState(
  expiresAt: number | null,
  now: number,
  keepalive?: { scheduled: boolean; lastActiveAt: number | null },
): CacheState {
  if (expiresAt === null || now >= expiresAt) return { state: "cold" };
  const active = keepalive?.lastActiveAt != null && now - keepalive.lastActiveAt <= ACTIVE_WINDOW_MS;
  return { state: keepalive?.scheduled && active ? "keepalive" : "warm", until: expiresAt };
}
