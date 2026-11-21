import type { HighlighterCore, ThemedToken, ThemeRegistration } from "shiki/core";

// Syntax colors come from the design system's code-* tokens, so they follow light and dark.
const theme: ThemeRegistration = {
  name: "tally",
  type: "light",
  colors: { "editor.foreground": "var(--code-fg)", "editor.background": "transparent" },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "var(--code-comment)", fontStyle: "italic" } },
    { scope: ["keyword", "storage", "meta.decorator", "punctuation.decorator", "entity.name.function.decorator"], settings: { foreground: "var(--code-keyword)" } },
    { scope: ["string", "punctuation.definition.string", "constant.character.escape", "markup.inserted"], settings: { foreground: "var(--code-string)" } },
    { scope: ["constant", "variable.language", "variable.parameter", "meta.object-literal.key", "support.type.property-name", "entity.other.attribute-name"], settings: { foreground: "var(--code-number)" } },
    { scope: ["entity.name.function", "support.function", "entity.name.tag", "markup.heading"], settings: { foreground: "var(--code-function)" } },
    { scope: ["entity.name.type", "entity.name.class", "entity.other.inherited-class", "support.type", "support.class"], settings: { foreground: "var(--code-type)" } },
    { scope: ["punctuation", "keyword.operator", "meta.brace"], settings: { foreground: "var(--code-punct)" } },
    // Word operators read as keywords, not punctuation.
    { scope: ["keyword.operator.new", "keyword.operator.expression", "keyword.operator.logical.python", "keyword.operator.word"], settings: { foreground: "var(--code-keyword)" } },
    { scope: ["markup.deleted"], settings: { foreground: "var(--danger)" } },
  ],
};

let highlighter: Promise<HighlighterCore> | undefined;
let ready: HighlighterCore | undefined;

/** Whether the highlighter and this language have loaded; until then code stays plain. */
export const languageReady = (lang: string) => !!ready?.getLoadedLanguages().includes(lang);

/** Tokens for code whose highlighter and language are already loaded, else null. */
export function tokensNow(code: string, lang: string): ThemedToken[][] | null {
  if (!ready || !languageReady(lang)) return null;
  return ready.codeToTokensBase(code, { lang, theme: "tally" });
}

/**
 * Loads Shiki on first use, then each language once; none of it ships until a reply has code.
 * Resolves false for a language Shiki doesn't know, which stays plain text.
 */
export async function loadLanguage(lang: string): Promise<boolean> {
  const { bundledLanguages } = await import("shiki/langs");
  if (!Object.hasOwn(bundledLanguages, lang)) return false;
  highlighter ??= Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }),
  );
  const h = await highlighter;
  await h.loadLanguage(bundledLanguages[lang as keyof typeof bundledLanguages]);
  ready = h;
  return true;
}
