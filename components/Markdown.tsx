"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={className}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
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

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const code = Array.isArray(children) ? children[0] : children;
  const className =
    (code as { props?: { className?: string } })?.props?.className ?? "";
  const lang = /language-([\w-]+)/.exec(className)?.[1] ?? "text";
  return (
    <div className="code-block">
      <div className="flex h-9 items-center justify-between pr-1.5 pl-4 font-mono text-xs text-muted-foreground">
        {lang}
        <CopyButton
          text={textOf(children).replace(/\n$/, "")}
          label="Copy code"
          className="icon-action"
        />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

// Memoized so a streaming reply re-parses only when its own text changes.
export default memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={{
          pre: CodeBlock,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          table: (props) => (
            <div className="overflow-x-auto">
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
