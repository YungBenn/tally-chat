// Visual blocks (ADR 0005): a fenced block whose language names a kind and whose body is small
// JSON. Pure parsing and validation; components/Markdown.tsx renders the result. A new kind adds
// one entry to SCHEMAS here and one component there.

export type StatsBlock = { kind: "stats"; items: { value: string; label: string; note?: string }[] };
export type VisualBlock = StatsBlock;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

// Each schema returns the typed block or null; unknown keys are dropped by rebuilding the object.
const SCHEMAS = {
  stats(data: Obj): StatsBlock | null {
    const { items } = data;
    if (!Array.isArray(items) || items.length < 1 || items.length > 4) return null;
    const out: StatsBlock["items"] = [];
    for (const it of items) {
      if (!isObj(it) || !text(it.value, 16) || !text(it.label, 60)) return null;
      if (it.note === undefined) out.push({ value: it.value, label: it.label });
      else if (typeof it.note === "string" && it.note.length <= 30) out.push({ value: it.value, label: it.label, note: it.note });
      else return null;
    }
    return { kind: "stats", items: out };
  },
} satisfies Record<string, (data: Obj) => VisualBlock | null>;

export const isVisualKind = (lang: string): lang is keyof typeof SCHEMAS => Object.hasOwn(SCHEMAS, lang);

/** The typed block, or null when the language isn't a visual kind or the body is outside its schema. */
export function parseVisualBlock(lang: string, source: string): VisualBlock | null {
  if (!isVisualKind(lang)) return null;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return null;
  }
  return isObj(data) ? SCHEMAS[lang](data) : null;
}

const OPENER = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w-]+)/;

/**
 * True when a top-level markdown block is a visual-kind fence still waiting for its closing line.
 * An unclosed fence runs to the end of the text, so it is the last block of a streaming reply. The
 * body can be valid JSON before the fence closes, so this reads the fence, not the parse.
 */
export function isOpenVisualFence(block: string): boolean {
  const lines = block.replace(/^\n+|\n+$/g, "").split("\n");
  const open = OPENER.exec(lines[0]);
  if (!open || !isVisualKind(open[2])) return false;
  const last = lines.length > 1 ? lines[lines.length - 1].trimEnd() : "";
  const closing = /^( {0,3})([`~]+)$/.exec(last)?.[2];
  return !(closing && closing[0] === open[1][0] && closing.length >= open[1].length);
}
