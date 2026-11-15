# HoloLines

The holographic line system: utilities, intensity levels and where each is allowed.

Holo color lives on lines and edges only. Surfaces stay neutral, text never sits on a holo fill.

## Utilities

| Class | What it does | Use on |
| --- | --- | --- |
| `holo-border` | 1px gradient stroke via a masked `::before`, follows any `border-radius` | focused composer, active thread, selected layer, primary button, dialog frame |
| `holo-ring` | solid 2px `ring` outline plus a faint holo halo on `:focus-visible` | custom focusable surfaces (cards, rows) |
| `holo-text` | gradient clipped to text, plain `foreground` fallback | the wordmark, one hero number per page, 24px and up only |
| `holo` / `holo-fill` | linear gradient fill | progress strokes, slider fill, 1-2px marks (caret, thinking ticks) |
| `holo-conic` | conic version, pairs with `holo-spin` | rare: the logo on sign-in |
| `holo-shimmer` | gradient drifts along the stroke, 9s loop | live things: composer focused, streaming thread, live badge |
| `holo-sweep` | one light pass on hover | primary button only |
| `holo-subtle` / `holo-default` / `holo-vivid` | stroke strength 0.45 / 0.8 / 1 (x0.8 in light) | pick by importance; vivid also glows in dark |

## Rules

- Do: keep most borders plain `border` hairlines. Holo marks what is **active, focused, live or important**, at most two or three holo things per view.
- Do: give every holo-stroked control a plain fallback that still reads (`border-strong` or `ring`).
- Don't: fill a surface, button label, or body text with the gradient. Don't put holo on disabled, error or destructive elements.
- Don't: stack two holo edges on top of each other (a holo card inside a holo panel).
- In light mode the sheen is multiplied by 0.8 and never glows: foil on paper.
- `prefers-reduced-motion`: shimmer and sweep stop, the gradient stays static. `prefers-contrast: more`: strokes turn solid `foreground`. `forced-colors`: strokes become `CanvasText` borders.
