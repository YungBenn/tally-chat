import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type PluggableList } from "unified";

/** Markdown syntax for replies; the renderer and the block splitter read the same one. */
export const remarkPlugins: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];

const parser = unified().use(remarkParse).use(remarkPlugins);

/**
 * Splits markdown at its top-level blocks, so a streaming reply re-renders only the block still
 * growing. Text with link or footnote definitions stays whole: a reference and its definition
 * must render together.
 */
export function splitBlocks(text: string): string[] {
  const nodes = parser.parse(text).children;
  if (nodes.length < 2 || nodes.some((n) => n.type === "definition" || n.type === "footnoteDefinition"))
    return [text];
  const starts = nodes.map((n, i) => (i === 0 ? 0 : n.position!.start.offset!));
  return starts.map((start, i) => text.slice(start, starts[i + 1]));
}
