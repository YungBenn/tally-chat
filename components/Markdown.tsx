"use client";

import { IconCheck, IconCopy, IconFileText } from "@tabler/icons-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Button, IconButton } from "@/components/ui/button";

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  return [copied, copy] as const;
}

/** Icon-only copy for message actions; swaps to a check for 1.6s. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopy(text);
  return (
    <IconButton
      icon={copied ? <IconCheck /> : <IconCopy />}
      label={copied ? "Copied" : label}
      size="sm"
      onClick={copy}
    />
  );
}

// Text of a rendered code element (highlighting wraps it in spans).
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

/** Fenced code (design system: CodeBlock): language header, copy, never wraps. */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const code = Array.isArray(children) ? children[0] : children;
  const className = (code as { props?: { className?: string } })?.props?.className ?? "";
  const lang = /language-([\w-]+)/.exec(className)?.[1] ?? "text";
  const [copied, copy] = useCopy(textOf(children).replace(/\n$/, ""));
  return (
    <div className="tc-code">
      <div className="tc-code-head">
        <span className="tc-code-lang">
          <IconFileText size={13} stroke={1.5} />
          {lang}
        </span>
        <Button size="sm" variant="ghost" icon={copied ? <IconCheck /> : <IconCopy />} onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

// Memoized so a streaming reply re-parses only when its own text changes.
export default memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? "tc-prose"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={{
          pre: CodeBlock,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          table: (props) => (
            <div className="tc-table-scroll">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
