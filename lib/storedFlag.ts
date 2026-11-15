"use client";

import { useCallback, useSyncExternalStore } from "react";

// A per-browser on/off preference (sidebar, inspector), kept in localStorage so it survives
// page changes and reloads. Storage can be unavailable (private mode); then it just resets.
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStoredFlag(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const read = useCallback(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === "1";
    } catch {
      return fallback;
    }
  }, [key, fallback]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {}
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

// A per-browser choice among fixed values (an output mode per thread), stored like a flag.
export function useStoredChoice<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const read = useCallback(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored !== null && allowed.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback, allowed]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {}
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
