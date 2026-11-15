import { describe, expect, test } from "vitest";
import { allowedWhileTyping, label, matches, SHORTCUTS } from "./shortcuts";

const ev = (key: string, m: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...m,
});

describe("shortcuts", () => {
  test("mod is ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(matches(ev("k", { metaKey: true }), SHORTCUTS.search, true)).toBe(true);
    expect(matches(ev("k", { ctrlKey: true }), SHORTCUTS.search, true)).toBe(false);
    expect(matches(ev("k", { ctrlKey: true }), SHORTCUTS.search, false)).toBe(true);
    expect(matches(ev("k", { metaKey: true }), SHORTCUTS.search, false)).toBe(false);
  });
  test("shift changes the key's case but still matches", () => {
    expect(matches(ev("O", { metaKey: true, shiftKey: true }), SHORTCUTS.newThread, true)).toBe(true);
    expect(matches(ev("o", { metaKey: true }), SHORTCUTS.newThread, true)).toBe(false);
  });
  test("extra modifiers don't match", () => {
    expect(matches(ev("k", { metaKey: true, shiftKey: true }), SHORTCUTS.search, true)).toBe(false);
    expect(matches(ev("/", { altKey: true }), SHORTCUTS.focusComposer, true)).toBe(false);
  });
  test("plain keys wait while typing; modified ones don't", () => {
    expect(allowedWhileTyping(SHORTCUTS.focusComposer)).toBe(false);
    expect(allowedWhileTyping(SHORTCUTS.toggleInspector)).toBe(true);
  });
  test("labels", () => {
    expect(label(SHORTCUTS.newThread, true)).toBe("⌘⇧O");
    expect(label(SHORTCUTS.newThread, false)).toBe("Ctrl+Shift+O");
    expect(label(SHORTCUTS.focusComposer, true)).toBe("/");
  });
});
