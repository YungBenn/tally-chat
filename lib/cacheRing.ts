import type { CacheState } from "@/convex/lib/cacheStatus";

// The 5-minute window the ring drains over (a 1-hour cache shows a full ring until its last 5).
export const RING_WINDOW_MS = 5 * 60_000;
// The last minute before expiry reads as "cooling" (design system: CacheStatus).
export const COOLING_MS = 60_000;

export type CacheTemp = "warm" | "cooling" | "cold";

// What the cache pill shows at `now`: temperature, the ring's remaining fraction (0..1) and the
// time left as "4:12". Kept alive counts as warm; the pill's note says it is kept alive.
export function cacheRing(state: CacheState, now: number) {
  if (state.state === "cold") return { temp: "cold" as CacheTemp, remaining: 0, time: null };
  const left = Math.max(0, state.until - now);
  const s = Math.ceil(left / 1000);
  return {
    temp: (left <= COOLING_MS ? "cooling" : "warm") as CacheTemp,
    remaining: Math.min(1, left / RING_WINDOW_MS),
    time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
  };
}
