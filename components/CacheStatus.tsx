"use client";

import { useEffect, useState } from "react";
import { ACTIVE_WINDOW_MS, cacheState } from "@/convex/lib/cacheStatus";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Plain-text cache state for the thread header (spec phase 2; the designed chip is phase 3).
// Re-renders when the cache expires or the owner's activity window closes, so it changes
// state without a reload.
export default function CacheStatus({
  expiresAt,
  keepaliveScheduled,
  lastActiveAt,
}: {
  expiresAt: number | null;
  keepaliveScheduled: boolean;
  lastActiveAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  // `now` only needs refreshing at those moments: newer data always moves them forward.
  useEffect(() => {
    const next = [expiresAt, lastActiveAt === null ? null : lastActiveAt + ACTIVE_WINDOW_MS]
      .filter((at): at is number => at !== null && at > Date.now())
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), next - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [expiresAt, lastActiveAt, now]);
  const state = cacheState(expiresAt, now, { scheduled: keepaliveScheduled, lastActiveAt });
  const label =
    state.state === "cold"
      ? "cache cold"
      : state.state === "keepalive"
        ? "cache kept alive"
        : `cache warm until ${time(state.until)}`;
  return (
    <span className="shrink-0 font-mono text-xs text-muted-foreground" title="Prompt cache for this thread">
      {label}
    </span>
  );
}
