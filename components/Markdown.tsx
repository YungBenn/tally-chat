"use client";

import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconCopy,
  IconFileText,
  IconInfoCircle,
  IconMessageExclamation,
} from "@tabler/icons-react";
import { Fragment, memo, useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button, IconButton } from "@/components/ui/button";
import { languageReady, loadLanguage, tokensNow } from "@/lib/highlight";
import { katexReady, loadKatex, mathHtml } from "@/lib/katex";
import { type CalloutKind, remarkPlugins, splitBlocks } from "@/lib/markdownBlocks";
import { normalizeMath } from "@/lib/mathDelimiters";
import { isOpenVisualFence, isVisualKind, parseVisualBlock, type VisualBlock } from "@/lib/visualBlocks";
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
  // The loaded language lives in state, so the compiler's memoized render highlights once it loads.
  const [loaded, setLoaded] = useState(() => (languageReady(lang) ? lang : null));
  useEffect(() => {
    let live = true;
    loadLanguage(lang).then(
      (ok) => live && ok && setLoaded(lang),
      () => {}, // offline or a failed chunk: the code stays plain
    );
    return () => {
      live = false;
    };
  }, [lang]);
  return loaded === lang ? tokensNow(source, lang) : null;
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
    // The placeholder has KaTeX's own wrapping (a div around span.katex-display), so it lays out
    // the same and the formula takes its place without moving what follows.
    return html ? (
      <div dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <div>
        <span className="katex-display">
          <code>{tex}</code>
        </span>
      </div>
    );
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

const CALLOUTS: Record<CalloutKind, { title: string; Icon: typeof IconInfoCircle }> = {
  note: { title: "Note", Icon: IconInfoCircle },
  tip: { title: "Tip", Icon: IconBulb },
  important: { title: "Important", Icon: IconMessageExclamation },
  warning: { title: "Warning", Icon: IconAlertTriangle },
  caution: { title: "Caution", Icon: IconAlertOctagon },
};

const langOf = (children: React.ReactNode) => {
  const code = Array.isArray(children) ? children[0] : children;
  return /language-([\w-]+)/.exec(classOf(code))?.[1] ?? "text";
};

/** A visual block (ADR 0005) in the app's own design. Real text throughout, so it selects and reads aloud. */
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const px = (n: number) => `${Math.round(n * 100) / 100}%`;

function VisualBlockView({ block }: { block: VisualBlock }) {
  if (block.kind === "split") {
    const total = block.parts.reduce((s, p) => s + p.value, 0);
    const share = block.parts.map((p) => (p.value / total) * 100);
    // A share under 1% reads "<1%"; a rounded share never claims 100% while another part has some.
    const pct = (v: number) => (v === 100 ? "100%" : v > 0 && v < 1 ? "<1%" : `${Math.min(99, Math.round(v))}%`);
    const colour = (i: number) => ({ "--c": `var(--chart-${i + 1})` }) as React.CSSProperties;
    return (
      <div className="tc-split">
        <div className="tc-split-bar" aria-hidden>
          {block.parts.map((_, i) => share[i] > 0 && <span key={i} style={{ ...colour(i), "--w": px(share[i]) } as React.CSSProperties} />)}
        </div>
        <ul className="tc-split-legend">
          {block.parts.map((p, i) => (
            <li key={i} style={colour(i)}>
              <span className="tc-split-label">{p.label}</span>
              <span className="tc-split-value">{num(p.value)}</span>
              <span className="tc-split-pct">{pct(share[i])}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (block.kind === "bars") {
    const max = Math.max(...block.rows.map((r) => r.value));
    return (
      <ul className="tc-bars">
        {block.rows.map((r, i) => (
          <li key={i}>
            <span className="tc-bar-label">{r.label}</span>
            <span className="tc-bar-value">{r.display ?? num(r.value)}</span>
            <span className="tc-bar-track" aria-hidden>
              {r.value > 0 && <span style={{ "--w": px((r.value / max) * 100) } as React.CSSProperties} />}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="tc-stats">
      {block.items.map((it, i) => (
        <div key={i} className="tc-stat">
          <dt>{it.label}</dt>
          <dd className="tc-stat-value">{it.value}</dd>
          {it.note && <dd className="tc-stat-note">{it.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// remark-math leaves math as code with a math-inline or math-display class (display inside a pre).
const components = {
  pre: ({ children }: { children?: React.ReactNode }) => {
    const code = Array.isArray(children) ? children[0] : children;
    if (classOf(code).includes("math-display")) return <MathFormula tex={textOf(children)} display />;
    const block = parseVisualBlock(langOf(children), textOf(children).replace(/\n$/, ""));
    return block ? <VisualBlockView block={block} /> : <CodeBlock>{children}</CodeBlock>;
  },
  code: ({ className, children }: React.ComponentProps<"code">) =>
    className?.includes("math-inline") ? (
      <MathFormula tex={textOf(children)} display={false} />
    ) : (
      <code className={className}>{children}</code>
    ),
  blockquote: ({ children, ...props }: React.ComponentProps<"blockquote"> & { "data-callout"?: CalloutKind }) => {
    const kind = props["data-callout"];
    if (!kind) return <blockquote>{children}</blockquote>;
    const { title, Icon } = CALLOUTS[kind];
    return (
      <div className="tc-callout" data-callout={kind} role="note">
        <div className="tc-callout-title">
          <Icon size={16} stroke={1.5} aria-hidden />
          <span>{title}</span>
        </div>
        {children}
      </div>
    );
  },
  a: (props: React.ComponentProps<"a">) => <a {...props} target="_blank" rel="noreferrer" />,
  table: (props: React.ComponentProps<"table">) => (
    <div className="tc-table-scroll">
      <table {...props} />
    </div>
  ),
};

// A visual block whose fence is still open holds its place quietly while the reply streams, instead of
// showing partial JSON. A reply that finished with the fence open shows the code: the text is final.
// Only the fence that runs to the end of the block is open; earlier closed ones render normally.
const openFenceComponents = (text: string, mode: "streaming" | "done") => ({
  ...components,
  pre: ({ children, node }: { children?: React.ReactNode; node?: { position?: { end: { offset?: number } } } }) => {
    const open = isVisualKind(langOf(children)) && (node?.position?.end.offset ?? 0) >= text.trimEnd().length;
    if (!open) return components.pre({ children });
    return mode === "streaming" ? <div className="tc-visual-ph" aria-hidden /> : <CodeBlock>{children}</CodeBlock>;
  },
});

// ponytail: open-fence placeholder covers top-level fences only; extend if models start nesting visual blocks in lists or quotes.
// One top-level block; memoized so a streaming reply re-renders only the block still growing.
const Block = memo(function Block({ text, openFence }: { text: string; openFence: "streaming" | "done" | null }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={openFence ? openFenceComponents(text, openFence) : components}
    >
      {text}
    </ReactMarkdown>
  );
});

/** `streaming`: this text is still arriving, so an open visual fence is a placeholder. Once the reply is done it is code. */
export default memo(function Markdown({
  text,
  className,
  streaming = false,
}: {
  text: string;
  className?: string;
  streaming?: boolean;
}) {
  const blocks = splitBlocks(normalizeMath(text));
  return (
    <div className={className ?? "tc-prose"}>
      {blocks.map((block, i) => (
        <Block
          key={i}
          text={block}
          openFence={i === blocks.length - 1 && isOpenVisualFence(block) ? (streaming ? "streaming" : "done") : null}
        />
      ))}
    </div>
  );
});
