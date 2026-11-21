"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HoloGradient } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/overlay";
import { cacheRing, type CacheTemp } from "@/lib/cacheRing";
import { useCacheState } from "@/lib/useCacheState";
import { cn } from "@/lib/utils";

const R = 5.25;
const C = 2 * Math.PI * R;

/** The ring and dot alone: warm breathes with a holo ring, cooling turns amber, cold is a plain dot. */
export function CacheGlyph({ temp, remaining }: { temp: CacheTemp; remaining: number }) {
  const id = useId();
  const ring = useRef<SVGCircleElement>(null);
  const last = useRef(remaining);
  // The ring drains a tenth of a pixel a second, so those steps snap; only a refill eases.
  // Easing every step would repaint the ring every frame for as long as the cache is warm.
  useLayoutEffect(() => {
    ring.current?.toggleAttribute("data-ease", Math.abs(remaining - last.current) > 0.02);
    last.current = remaining;
  }, [remaining]);
  // The dot is an HTML element, not an SVG circle, so its breathing runs on the compositor
  // instead of re-painting every frame while the cache is warm.
  return (
    <span className="tc-cache-glyph" aria-hidden>
      <svg width={14} height={14} viewBox="0 0 14 14">
        <defs>
          <HoloGradient id={id} x2={14} y2={14} />
        </defs>
        <circle cx={7} cy={7} r={R} stroke="var(--border)" strokeWidth={1.25} fill="none" />
        {temp !== "cold" && (
          <circle
            ref={ring}
            className="tc-cache-ring"
            cx={7}
            cy={7}
            r={R}
            stroke={temp === "warm" ? `url(#${id})` : "var(--cache-cooling)"}
            strokeWidth={1.25}
            fill="none"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - remaining)}
            strokeLinecap="round"
          />
        )}
      </svg>
      <i className="tc-cache-dot" style={{ background: `var(--cache-${temp})` }} />
    </span>
  );
}

// Ticks once a second while the cache is warm, so the ring drains and the time counts down.
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [live]);
  return now;
}

/** A thread's cache temperature at this moment, for the pill, the cost strip and the inspector. */
export function useCacheTemp(cache: {
  expiresAt: number | null;
  keepaliveScheduled: boolean;
  lastActiveAt: number | null;
}) {
  const state = useCacheState(cache);
  const now = useNow(state.state !== "cold");
  const ring = cacheRing(state, now);
  const keptAlive = state.state === "keepalive";
  // A kept-alive cache is refreshed before it expires, so it never reads as cooling.
  return { ...ring, temp: keptAlive && ring.temp === "cooling" ? ("warm" as const) : ring.temp, keptAlive };
}

/**
 * The thread header's cache pill (design system: CacheStatus). Always says the state in words,
 * time in mono; warm gets a subtle holo edge. Clicking opens the inspector at its cache section.
 */
export default function CacheStatus({
  onOpen,
  ...cache
}: {
  expiresAt: number | null;
  keepaliveScheduled: boolean;
  lastActiveAt: number | null;
  onOpen: () => void;
}) {
  const { temp, remaining, time, keptAlive } = useCacheTemp(cache);
  const note =
    temp === "cold"
      ? "The next send writes the history to the cache again"
      : keptAlive
        ? "Kept warm while you're in this thread"
        : `Expires in ${time} unless you send`;
  return (
    <Tooltip content={note}>
      <button
        type="button"
        onClick={onOpen}
        className={cn("tc-cache", temp === "warm" && "holo-border holo-subtle")}
        data-state={temp}
        aria-label={`Cache ${temp}${time ? `, ${time} left` : ""}. Open the inspector`}
      >
        <CacheGlyph temp={temp} remaining={remaining} />
        cache {temp}
        {time && <span className="tc-num">{time}</span>}
      </button>
    </Tooltip>
  );
}
