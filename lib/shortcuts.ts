// Keyboard shortcuts (spec phase 8, "Keyboard"). "mod" is ⌘ on Apple platforms and Ctrl elsewhere.
export type Shortcut = { key: string; mod?: boolean; shift?: boolean; alt?: boolean };

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

// Whether a key event is this shortcut. Letters compare case-insensitively (Shift changes case).
export function matches(e: KeyLike, s: Shortcut, mac: boolean) {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const stray = mac ? e.ctrlKey : e.metaKey;
  return (
    e.key.toLowerCase() === s.key.toLowerCase() &&
    mod === !!s.mod &&
    !stray &&
    e.shiftKey === !!s.shift &&
    e.altKey === !!s.alt
  );
}

// Plain-key shortcuts ("/", "↑") must not fire while the user types in a field; modified ones may.
export function allowedWhileTyping(s: Shortcut) {
  return !!s.mod;
}

// "⌘⇧O" on a Mac, "Ctrl+Shift+O" elsewhere.
export function label(s: Shortcut, mac: boolean) {
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  if (mac) return `${s.alt ? "⌥" : ""}${s.mod ? "⌘" : ""}${s.shift ? "⇧" : ""}${key}`;
  return [s.mod && "Ctrl", s.alt && "Alt", s.shift && "Shift", key].filter(Boolean).join("+");
}

export const SHORTCUTS = {
  newThread: { key: "o", mod: true, shift: true },
  search: { key: "k", mod: true },
  toggleSidebar: { key: "b", mod: true },
  toggleInspector: { key: "i", mod: true },
  focusComposer: { key: "/" },
  copyLastReply: { key: "c", mod: true, shift: true },
  modelPicker: { key: "m", mod: true },
  attach: { key: "u", mod: true },
} satisfies Record<string, Shortcut>;
