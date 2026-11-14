"use client";

import { useEffect, useState } from "react";
import { useCacheState } from "@/lib/useCacheState";
import { cn } from "@/lib/utils";

const CHIP = {
  warm: {
    label: "warm",
    color: "text-[var(--cache-warm)] bg-[var(--cache-warm-soft)]",
  },
  keepalive: {
    label: "kept alive",
    color: "text-[var(--cache-keep)] bg-[var(--cache-keep-soft)]",
  },
  cold: {
    label: "cold",
    color: "text-[var(--cache-cold)] bg-[var(--cache-cold-soft)]",
  },
};

// "4:32" until the cache expires.
const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// The thread header's cache status chip (spec phase 3): warm with a countdown to expiry in its
// tooltip, kept alive with a subtle pulse, or cold. Clicking opens the inspector at its cache line.
export default function CacheStatus({
  onOpen,
  ...cache
}: {
  expiresAt: number | null;
  keepaliveScheduled: boolean;
  lastActiveAt: number | null;
  onOpen: () => void;
}) {
  const state = useCacheState(cache);
  // Ticks once a second while warm, only to keep the tooltip's countdown current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.state === "cold") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [state.state]);
  const chip = CHIP[state.state];
  const title =
    state.state === "cold"
      ? "Prompt cache cold: the next send writes the history to the cache again"
      : `Prompt cache ${chip.label}: expires in ${countdown(state.until - now)}${state.state === "keepalive" ? ", refreshed while you're here" : ""}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      aria-label={`Cache ${chip.label}. Open the inspector`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-medium transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--primitive-ring)] focus-visible:outline-none",
        chip.color,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-current",
          state.state === "keepalive" && "motion-safe:animate-pulse",
        )}
      />
      cache {chip.label}
    </button>
  );
}
