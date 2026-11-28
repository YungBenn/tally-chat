// Visual blocks (ADR 0005): a fenced block whose language names a kind and whose body is small
// JSON. Pure parsing and validation; components/Markdown.tsx renders the result. A new kind adds
// one entry to SCHEMAS here and one component there.

export type StatsBlock = { kind: "stats"; items: { value: string; label: string; note?: string }[] };
export type SplitBlock = { kind: "split"; parts: { label: string; value: number }[] };
export type BarsBlock = { kind: "bars"; rows: { label: string; value: number; display?: string }[] };
export type VisualBlock = StatsBlock | SplitBlock | BarsBlock;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

// Shared by split and bars: {label, value >= 0, display?}, rebuilt so unknown keys are dropped.
function labelled(items: unknown[], withDisplay: true): { label: string; value: number; display?: string }[] | null;
function labelled(items: unknown[]): { label: string; value: number }[] | null;
function labelled(items: unknown[], withDisplay = false) {
  const out: { label: string; value: number; display?: string }[] = [];
  for (const it of items) {
    if (!isObj(it) || !text(it.label, 60) || typeof it.value !== "number" || !Number.isFinite(it.value) || it.value < 0) return null;
    const row: (typeof out)[number] = { label: it.label, value: it.value };
    if (withDisplay && it.display !== undefined) {
      if (!text(it.display, 16)) return null;
      row.display = it.display;
    }
    out.push(row);
  }
  return out;
}

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
  split(data: Obj): SplitBlock | null {
    const { parts } = data;
    if (!Array.isArray(parts) || parts.length < 2 || parts.length > 5) return null;
    const out = labelled(parts);
    const sum = out?.reduce((s, p) => s + p.value, 0) ?? 0;
    return out && sum > 0 && Number.isFinite(sum) ? { kind: "split", parts: out } : null;
  },
  bars(data: Obj): BarsBlock | null {
    const { rows } = data;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 12) return null;
    const out = labelled(rows, true);
    return out ? { kind: "bars", rows: out } : null;
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

const OPENER = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w-]*)/;

/**
 * True when the text ends inside a visual-kind fence still waiting for its closing line. An unclosed
 * fence runs to the end of the text, so it is at the tail of a streaming reply, however many blocks
 * precede it. The body can be valid JSON before the fence closes, so this reads the fences, not the parse.
 */
export function isOpenVisualFence(text: string): boolean {
  let open: RegExpExecArray | null = null;
  for (const line of text.split("\n")) {
    if (!open) {
      open = OPENER.exec(line);
      continue;
    }
    const closing = /^( {0,3})([`~]+)$/.exec(line.trimEnd())?.[2];
    if (closing && closing[0] === open[1][0] && closing.length >= open[1].length) open = null;
  }
  return !!open && isVisualKind(open[2]);
}
