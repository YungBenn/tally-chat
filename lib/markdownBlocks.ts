import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type PluggableList } from "unified";
import type { Nodes, Parent } from "mdast";

export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const MARKER = new RegExp(`^\\[!(${CALLOUT_KINDS.join("|")})\\][ \\t]*(?:\\n|$)`, "i");

/** A quote whose first line is a GitHub alert marker becomes a callout: tag it, drop the marker line. */
function remarkCallouts() {
  return (tree: Nodes) => {
    const walk = (node: Nodes) => {
      if (node.type === "blockquote") {
        const para = node.children[0];
        const text = para?.type === "paragraph" ? para.children[0] : undefined;
        const m = text?.type === "text" ? MARKER.exec(text.value) : null;
        if (m && para?.type === "paragraph" && text?.type === "text") {
          text.value = text.value.slice(m[0].length);
          if (!text.value) para.children.shift();
          if (!para.children.length) node.children.shift();
          node.data = { ...node.data, hProperties: { "data-callout": m[1].toLowerCase() } };
        }
      }
      if ("children" in node) (node as Parent).children.forEach((c) => walk(c as Nodes));
    };
    walk(tree);
  };
}

/** Markdown syntax for replies; the renderer and the block splitter read the same one. */
export const remarkPlugins: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkCallouts];

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
