"use client";

import { useEffect, useState } from "react";
import { cacheState } from "@/convex/lib/cacheStatus";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Plain-text cache state for the thread header (spec phase 2; the designed chip is phase 3).
// Re-renders at the expiry moment, so it flips to cold without a reload.
export default function CacheStatus({ expiresAt }: { expiresAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  // `now` only needs refreshing at the expiry: a newer touch always moves expiresAt forward.
  useEffect(() => {
    if (expiresAt === null || expiresAt <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const state = cacheState(expiresAt, now);
  return (
    <span className="shrink-0 font-mono text-xs text-muted-foreground" title="Prompt cache for this thread">
      {state.state === "warm" ? `cache warm until ${time(state.until)}` : "cache cold"}
    </span>
  );
}
