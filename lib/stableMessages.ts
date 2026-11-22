import { useState } from "react";

// Two query values (JSON-like: no Dates, Maps or cycles) with the same content.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * `next` with every message whose content didn't change replaced by its previous object (matched
 * by id), so memoized rows skip it. Returns `prev` itself when nothing changed.
 */
export function reuseUnchanged<M extends { _id: string }>(prev: M[] | undefined, next: M[]): M[] {
  if (!prev) return next;
  const byId = new Map(prev.map((m) => [m._id, m]));
  const out = next.map((m) => {
    const old = byId.get(m._id);
    return old && same(old, m) ? old : m;
  });
  return out.length === prev.length && out.every((m, i) => m === prev[i]) ? prev : out;
}

/** `messages` across query updates, with unchanged messages keeping their identity. */
export function useStableMessages<M extends { _id: string }>(messages: M[] | undefined): M[] | undefined {
  // The previous result lives in state (updated during render), not a ref, so React Compiler accepts it.
  const [kept, setKept] = useState<{ from: M[] | undefined; out: M[] | undefined }>({ from: messages, out: messages });
  if (kept.from === messages) return kept.out;
  const out = messages && reuseUnchanged(kept.out, messages);
  setKept({ from: messages, out });
  return out;
}
