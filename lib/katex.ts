import type { KatexOptions } from "katex";

let loading: Promise<void> | undefined;
let render: ((tex: string, options: KatexOptions) => string) | undefined;

/** Whether KaTeX has loaded; until then a formula shows as its monospace source. */
export const katexReady = () => render !== undefined;

/** KaTeX's HTML for a formula; call only once katexReady(). */
export const mathHtml = (tex: string, displayMode: boolean) => render!(tex, { displayMode, throwOnError: false });

/** Loads KaTeX and its stylesheet on first use; none of it ships until a reply has math. */
export function loadKatex(): Promise<void> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([{ default: katex }]) => {
    render = katex.renderToString;
  });
  return loading;
}
