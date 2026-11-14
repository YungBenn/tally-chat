"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const MIN_GAP_MS = 30_000; // typing never sends more than one mark per 30 seconds
const TICK_MS = 60_000; // a focused, visible tab re-marks once a minute

// Tells the server the owner is in this thread (keepalive presence, spec phase 2): when the
// tab gains focus, while typing, and once a minute while focused and visible. A hidden or
// unfocused tab sends nothing. Returns the mark function for typing handlers.
export function usePresence(threadId: Id<"threads">) {
  const markActive = useMutation(api.chat.markActive);
  const last = useRef(0);

  const mark = useCallback(() => {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    const now = Date.now();
    if (now - last.current < MIN_GAP_MS) return;
    last.current = now;
    markActive({ threadId }).catch(() => {}); // presence is best effort; never surface it
  }, [markActive, threadId]);

  useEffect(() => {
    last.current = 0; // a newly opened thread marks right away
    mark();
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    const tick = setInterval(mark, TICK_MS);
    return () => {
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
      clearInterval(tick);
    };
  }, [mark]);

  return mark;
}
