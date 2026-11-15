"use client";

import { useCallback, useSyncExternalStore } from "react";

// Whether a media query matches, live. False during server render.
export function useMedia(query: string) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
}

// Layout breakpoints (spec phase 8, "Layout and responsive").
export const NARROW = "(max-width: 899.98px)"; // sidebar becomes a left sheet
export const COMPACT = "(max-width: 1199.98px)"; // inspector becomes a bottom sheet
