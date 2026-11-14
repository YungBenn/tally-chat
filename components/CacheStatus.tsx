"use client";

import { useCacheState } from "@/lib/useCacheState";

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Plain-text cache state for the thread header (spec phase 2; ticket 05 of phase 3 makes it a chip).
export default function CacheStatus(props: {
  expiresAt: number | null;
  keepaliveScheduled: boolean;
  lastActiveAt: number | null;
}) {
  const state = useCacheState(props);
  const label =
    state.state === "cold"
      ? "cache cold"
      : state.state === "keepalive"
        ? "cache kept alive"
        : `cache warm until ${time(state.until)}`;
  return (
    <span
      className="shrink-0 font-mono text-xs text-muted-foreground"
      title="Prompt cache for this thread"
    >
      {label}
    </span>
  );
}
