# Rich answers are visual blocks the app renders, not HTML the model writes

When a reply is better shown than told (a few headline numbers, a proportion, a short ranking), the model writes a visual block: a fenced block whose language names the kind (`stats`, `bars`) and whose body is a small JSON object. The app validates it and renders it with its own components and design tokens. A block that is still streaming shows a placeholder; one that fails to parse or validate after its fence closes is shown as an ordinary code block. Callouts use GitHub alert syntax (`> [!NOTE]`) instead of a block. The syntax is taught in the system prompt, so it arrives with a new prompt version and older threads keep theirs.

## Considered Options

- **Model-written HTML in a sandboxed iframe (T3 Code's `html_render`)**: anything is expressible, but one visual costs 3-20k output tokens, is re-read on every later turn, can be cut off by the effort-scaled output ceiling, and looks only as good as the model's CSS. It also needs a sandbox, a CSP and height messaging. T3 pairs it with a headless-Chrome preview so the model can check its own render; a Convex action can't run one.
- **Mermaid charts (`pie`, `xychart-beta`)**: already installed, but themed through Mermaid's own config, heavy to load, and generic-looking next to the rest of the app.
- **Markdown only**: free, but stat panels and proportions end up as tables or prose.

## Consequences

- A visual costs tens to hundreds of tokens, so it fits a product built on showing what each request costs.
- Every visual is on-brand in light and dark by construction; the model supplies data, never styling.
- Expressiveness is limited to the kinds the app ships. A freeform HTML escape hatch can still be added later as its own kind without changing existing ones.
- Exports and search see the raw fenced JSON, which stays readable.
