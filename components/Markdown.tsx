"use client";

import { IconCheck, IconCopy, IconFileText } from "@tabler/icons-react";
import { Fragment, memo, useEffect, useId, useReducer, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button, IconButton } from "@/components/ui/button";
import { loadLanguage, tokensNow } from "@/lib/highlight";
import { katexReady, loadKatex, mathHtml } from "@/lib/katex";
import { remarkPlugins, splitBlocks } from "@/lib/markdownBlocks";
import { normalizeMath } from "@/lib/mathDelimiters";
import { useMedia } from "@/lib/useMedia";

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

// Text of a rendered code element.
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

// Mermaid sizes a diagram to shrink with its container, which leaves a phone unreadable labels.
// Drawn at its own width instead, a wide diagram scrolls sideways like a code block.
function naturalSize(svg: string) {
  const el = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement as unknown as SVGSVGElement;
  el.setAttribute("width", String(el.viewBox.baseVal.width));
  el.style.maxWidth = "";
  return el.outerHTML;
}

// Outside the hook: React Compiler can't compile a dynamic import().
const loadMermaid = () => import("mermaid");

/**
 * A mermaid block as a diagram, once its source parses (so a block still streaming in shows as
 * code). Mermaid loads only when a reply has a diagram, and redraws with the color scheme.
 */
function useMermaid(source: string | null) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const dark = useMedia("(prefers-color-scheme: dark)");
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (source === null) return;
    let live = true;
    const timer = setTimeout(async () => {
      const { default: mermaid } = await loadMermaid();
      // Mermaid derives shades from real colors, so it gets the design tokens' resolved values.
      const css = getComputedStyle(document.documentElement);
      const token = (name: string) => css.getPropertyValue(name).trim();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        look: "classic", // flat, like the rest of the design system (neo adds shadows and gradients)
        themeVariables: {
          darkMode: dark,
          background: token("--surface-raised"),
          primaryColor: token("--surface-sunken"),
          primaryTextColor: token("--foreground"),
          primaryBorderColor: token("--border-strong"),
          secondaryColor: token("--surface-sunken"),
          tertiaryColor: token("--surface-raised"),
          lineColor: token("--foreground-muted"),
          edgeLabelBackground: token("--surface-raised"), // the diagram's own surface (.tc-mermaid)
          textColor: token("--foreground"),
          fontFamily: getComputedStyle(document.body).fontFamily,
          fontSize: "14px",
        },
      });
      const ok = await mermaid.parse(source, { suppressErrors: true });
      const out = ok ? await mermaid.render(id, source).catch(() => null) : null;
      if (live) setSvg(out ? naturalSize(out.svg) : null);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, dark, id]);
  return svg;
}

/** Shiki tokens for a code block: null (plain text) until the highlighter and language load. */
function useTokens(source: string, lang: string) {
  const [, loaded] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let live = true;
    loadLanguage(lang).then(
      (ok) => live && ok && loaded(),
      () => {}, // offline or a failed chunk: the code stays plain
    );
    return () => {
      live = false;
    };
  }, [lang]);
  return tokensNow(source, lang);
}

/** A formula: monospace source until KaTeX loads (only once a reply has math), then typeset. */
function MathFormula({ tex, display }: { tex: string; display: boolean }) {
  // Readiness lives in state, so the compiler's memoized render redoes the math once it loads.
  const [ready, setReady] = useState(katexReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadKatex().then(
      () => live && setReady(true),
      () => {}, // offline or a failed chunk: the source stays
    );
    return () => {
      live = false;
    };
  }, [ready]);
  const html = ready ? mathHtml(tex, display) : null;
  if (display)
    return html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <div className="katex-display"><code>{tex}</code></div>;
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{tex}</code>;
}

const classOf = (node: React.ReactNode) => (node as { props?: { className?: string } })?.props?.className ?? "";

/** Fenced code (design system: CodeBlock): language header, copy, never wraps. */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const code = Array.isArray(children) ? children[0] : children;
  const lang = /language-([\w-]+)/.exec(classOf(code))?.[1] ?? "text";
  const source = textOf(children).replace(/\n$/, "");
  const [copied, copy] = useCopy(source);
  const diagram = useMermaid(lang === "mermaid" ? source : null);
  const tokens = useTokens(source, lang);
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
      {diagram ? (
        // securityLevel "strict": mermaid sanitizes the SVG it returns.
        <div className="tc-mermaid" dangerouslySetInnerHTML={{ __html: diagram }} />
      ) : (
        <pre>
          {tokens ? (
            <code>
              {tokens.map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && "\n"}
                  {line.map((t, j) => (
                    <span key={j} style={{ color: t.color, fontStyle: (t.fontStyle ?? 0) & 1 ? "italic" : undefined }}>
                      {t.content}
                    </span>
                  ))}
                </Fragment>
              ))}
            </code>
          ) : (
            children
          )}
        </pre>
      )}
    </div>
  );
}

// remark-math leaves math as code with a math-inline or math-display class (display inside a pre).
const components = {
  pre: ({ children }: { children?: React.ReactNode }) => {
    const code = Array.isArray(children) ? children[0] : children;
    return classOf(code).includes("math-display") ? (
      <MathFormula tex={textOf(children)} display />
    ) : (
      <CodeBlock>{children}</CodeBlock>
    );
  },
  code: ({ className, children }: React.ComponentProps<"code">) =>
    className?.includes("math-inline") ? (
      <MathFormula tex={textOf(children)} display={false} />
    ) : (
      <code className={className}>{children}</code>
    ),
  a: (props: React.ComponentProps<"a">) => <a {...props} target="_blank" rel="noreferrer" />,
  table: (props: React.ComponentProps<"table">) => (
    <div className="tc-table-scroll">
      <table {...props} />
    </div>
  ),
};

// One top-level block; memoized so a streaming reply re-renders only the block still growing.
const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});

export default memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? "tc-prose"}>
      {splitBlocks(normalizeMath(text)).map((block, i) => (
        <Block key={i} text={block} />
      ))}
    </div>
  );
});
