const SNIPPET_SIDE = 60; // characters kept either side of the match

// The text around the first place any query term appears (case-insensitive), whitespace
// collapsed and cut at word boundaries where possible, with ellipses where it was cut. Search
// matches terms by prefix, so finding a term's start is enough. No match: the opening text.
export function snippet(content: string, query: string) {
  const text = content.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const at = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => lower.indexOf(term))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  let start = Math.max(0, at - SNIPPET_SIDE);
  let end = Math.min(text.length, at + SNIPPET_SIDE * 2);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(" ", end) > at ? text.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
