// What a tool call's result becomes before it is stored (spec phase 10, ADR 0003): the stored
// text is the text every later request sends, so the cap is applied here, once.

// About 8k tokens at the app's 4 characters per token estimate.
export const MAX_RESULT_CHARS = 32_000;
export const TRUNCATION_NOTE = "[result truncated at ~8k tokens]";

type Content = { type: string; text?: string }[];

// Text content joined; anything else becomes a short note so nothing unpriced enters the context.
export function resultText(content: Content | undefined): string {
  const text = (content ?? [])
    .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type === "resource_link" ? "resource link" : c.type} omitted]`))
    .join("\n");
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n${TRUNCATION_NOTE}` : text;
}
