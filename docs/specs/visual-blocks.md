# Spec: Visual blocks

Status: ready-for-agent · Follows [ADR 0005](../adr/0005-visual-blocks-not-model-html.md) · Builds on system prompt version 3 from [answer quality](./answer-quality.md)

## Problem Statement

Some answers are better shown than told: two headline numbers and what share of the whole each is, or a short ranking. Today the model can only write those as prose or a table, so a reply like "27 of 32 merged, 5 of 32 asked" reads flat where an app like T3 Code shows big figures and a proportion bar.

T3 Code gets there by letting the model write a whole HTML page that renders in an iframe. That costs thousands of output tokens per visual, re-read on every later turn, and the look depends on the model's CSS. tally.chat exists to keep requests cheap and show what they cost, so it needs the same visual payoff for a few dozen tokens, always in its own design.

## Solution

The model can write a **visual block**: a fenced block whose language names the kind and whose body is a small JSON object. The app renders it with its own components and tokens, in light and dark, at any width. Three kinds ship:

- `stats`: one to four big figures, each with a label and an optional note.
- `split`: one bar divided into two to five parts, with a legend.
- `bars`: up to twelve labelled horizontal bars, scaled to the largest value.

Callouts use GitHub alert syntax (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`), which models already know and which stays a plain quote anywhere else.

A block still streaming shows a quiet placeholder of about its final height. A block that is malformed once its fence closes is shown as an ordinary code block, never as an error and never hidden. The syntax is taught in system prompt version 4, so new threads get it and existing threads keep version 3 and their cache.

## User Stories

### Reading

1. As a user, I want two or three headline numbers shown as large figures with labels, so that the answer's key result is visible at a glance.
2. As a user, I want a proportion shown as one divided bar with a legend, so that I see shares of a whole without reading a table.
3. As a user, I want a short ranking shown as horizontal bars with their values printed, so that I can compare items quickly and still read exact numbers.
4. As a user, I want notes, tips and warnings shown as callouts, so that what matters stands out from the prose.
5. As a user, I want every visual to match the app in light and dark, so that replies look like one product.
6. As a user, I want visuals to fit a phone screen (stats wrapping to two columns, bars full width), so that replies read well anywhere.
7. As a user, I want every number in a visual to be real text, so that I can select, copy and find it, and a screen reader reads it.

### Streaming and failure

8. As a user, I want a visual that is still streaming to hold its place quietly, so that the reply doesn't jump when it appears.
9. As a user, I want a malformed visual shown as its source in a code block, so that I never lose what the model wrote.
10. As a user, I want a model that ignores the syntax to give a normal reply, so that nothing breaks on weaker models.

### Cost and history

11. As a user, I want a visual to cost tens to hundreds of tokens, so that it doesn't tax every later turn.
12. As a user, I want existing threads untouched, so that their cache and prompt stay as they are.
13. As a user, I want exports and search to keep the block's raw text, so that the data stays readable and findable.

## Implementation Decisions

### Block syntax and schemas

A fenced code block whose language is `stats`, `split` or `bars`, body parsed with `JSON.parse` and checked against a small schema in a pure module (`lib/visualBlocks.ts`) that returns either the typed block or null. Null means "show as code".

- `stats`: `{"items":[{"value":string, "label":string, "note"?:string}]}`. 1-4 items. `value` ≤ 16 characters, `label` ≤ 60, `note` ≤ 30.
- `split`: `{"parts":[{"label":string, "value":number}]}`. 2-5 parts, values ≥ 0 with a positive sum. Shares are computed by the app, never by the model.
- `bars`: `{"rows":[{"label":string, "value":number, "display"?:string}]}`. 1-12 rows, values ≥ 0. `display` (≤ 16 characters) replaces the printed number, e.g. "42%".

Unknown keys are ignored; anything else outside the schema is invalid.

### Rendering

`components/Markdown.tsx` routes the three languages to their components, the same seam mermaid uses. Colours come by order: part *n* of a `split` gets `--chart-n`; every `bars` row uses `--chart-1`, since one series is one colour. `stats` renders as a `<dl>` with values in Geist Mono and tabular figures. Styles live in `app/components.css` next to `.tc-prose`.

### Streaming

While the reply streams and the block's fence is still open, the component shows a placeholder sized per kind. It renders once the fence closes and the body validates.

### Callouts

A small remark plugin or blockquote override turns a blockquote whose first line is `[!KIND]` into a callout with an icon and title, using the existing tokens. Unknown kinds stay plain quotes.

### System prompt version 4

Version 3's text plus a short addition to `<rendering>` (about 150-250 tokens): one minimal example per kind, when to use one (two to four headline numbers, a proportion, a short ranking), to prefer prose or a table otherwise, and never to repeat a block's numbers in the prose around it. `CURRENT_SYSTEM_PROMPT_VERSION` moves to 4; versions 1-3 stay byte for byte.

### Schema changes

None.

## Testing Decisions

- `lib/visualBlocks.ts` unit tests: a valid block of each kind, each limit just inside and just outside, bad JSON, a wrong kind, a zero-sum `split`.
- DOM tests: one per kind, checking the printed values and colours by order, plus one showing a malformed block as a code block and one for a still-open fence.
- Callout tests: each kind, an unknown kind left as a quote.
- System prompt: a test pinning versions 1-3 byte for byte (a hash of each), and version 4 containing the examples. Existing tests already read the current version through `CURRENT_SYSTEM_PROMPT_VERSION`.
- End to end: send real prompts on a real model in a new thread, watch the blocks stream in and render, and check light, dark, desktop and phone widths.

## Out of Scope

- Model-written HTML or any freeform kind (see ADR 0005).
- Line charts, pies and multi-series charts.
- Interactive visuals (hover, filters, toggles).
- A separate Inspector line for a block's tokens: they're already in the reply's output.
- Converting blocks to tables in exports.

## Tickets

Each ticket adds its own lines to system prompt version 4, which stays unpublished until the branch merges, and ends with its own check on a real model.

1. Callouts from GitHub alert syntax, creating version 4.
2. The `stats` visual block, with the shared validation, open-fence placeholder and code-block fallback.
3. The `split` and `bars` visual blocks, and an end-to-end pass over all of them.
