"use client";

import { useQuery } from "convex-helpers/react/cache/hooks";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ACTIVE_WINDOW_MS, cacheState } from "@/convex/lib/cacheStatus";

const NO_CACHE = { expiresAt: null, keepaliveScheduled: false, lastActiveAt: null };

// A thread's cache timing (its own query, so presence re-runs nothing else), cold while loading.
export function useThreadCache(threadId: Id<"threads">) {
  return useQuery(api.threadState.cache, { threadId }) ?? NO_CACHE;
}

// A thread's cache state judged against the current time, re-rendering at the moments it can
// change on its own (the cache expiring, the owner's activity window closing).
export function useCacheState(c: {
  expiresAt: number | null;
  keepaliveScheduled: boolean;
  lastActiveAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  // `now` only needs refreshing at those moments: newer data always moves them forward.
  useEffect(() => {
    const next = [
      c.expiresAt,
      c.lastActiveAt === null ? null : c.lastActiveAt + ACTIVE_WINDOW_MS,
    ]
      .filter((at): at is number => at !== null && at > Date.now())
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), next - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [c.expiresAt, c.lastActiveAt, now]);
  return cacheState(c.expiresAt, now, {
    scheduled: c.keepaliveScheduled,
    lastActiveAt: c.lastActiveAt,
  });
}
