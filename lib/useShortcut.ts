"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { allowedWhileTyping, isMac, label, matches, type Shortcut } from "@/lib/shortcuts";

const typingIn = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// Runs `handler` when the shortcut is pressed anywhere in the page (spec phase 8, "Keyboard").
export function useShortcut(s: Shortcut, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const mac = isMac();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matches(e, s, mac)) return;
      if (!allowedWhileTyping(s) && typingIn(e.target)) return;
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, enabled]);
}

const noop = () => () => {};
// The shortcut's label for this platform; ⌘ style during server render, corrected on hydrate.
export function useShortcutLabel(s: Shortcut) {
  const mac = useSyncExternalStore(noop, isMac, () => true);
  return label(s, mac);
}
