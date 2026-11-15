# Holographic lines

The holo engine is five CSS utilities plus three intensity levels. They live in `code/holo.css` (plain CSS, imported by `globals.css`) and work on any `border-radius` in Chrome, Safari and Firefox.

## How it works

- **Stroke on rounded corners.** `holo-border` paints the gradient on a `::before` that inherits the element's radius, pads it by `--holo-width` (1px), and cuts out the middle with `mask-composite: exclude` (plus `-webkit-mask-composite: xor` for Safari). No `border-image`, so corners stay round.
- **Element with its own border.** Set `--holo-inset: 1px` and `border-color: transparent` on focus so the holo stroke sits exactly where the hairline was.
- **Intensity.** `opacity = --holo-strength × --holo-mul`. Strength: `holo-subtle` 0.45, `holo-default` 0.8, `holo-vivid` 1. Multiplier: 0.8 in light, 1 in dark. Vivid adds a faint `holo-glow` in dark only.
- **Motion.** `holo-shimmer` drifts the 200%-wide gradient along the stroke over `--holo-speed` (9s). `holo-spin` rotates a conic version by animating the registered `@property --holo-angle`. `holo-sweep` runs one white highlight along the stroke on hover. All are GPU-cheap (background-position or a registered angle, no layout).
- **Pointer tilt.** On a key card, set `--holo-angle` from the pointer x (115° ± 25°). See `tiltAngle` in `motion.ts`.
- **SVG strokes** (logo, chart lines, spinners, the cache ring) use a `linearGradient` with `gradientUnits="userSpaceOnUse"` and `stop-color: var(--holo-*)`, so they follow the theme. Give every gradient a unique id.

## Utilities

| Class | Purpose |
| --- | --- |
| `holo`, `holo-fill` | linear gradient fill for 1-4px marks: progress, slider fill, caret, thinking ticks |
| `holo-conic` | conic gradient; combine with `holo-border` and `holo-spin` |
| `holo-border` | gradient stroke that follows the radius |
| `holo-ring` | solid `ring` outline + holo halo on `:focus-visible` |
| `holo-text` | gradient text with `foreground` fallback, 24px+ only |
| `holo-shimmer`, `holo-spin`, `holo-sweep` | motion modifiers |
| `holo-subtle`, `holo-default`, `holo-vivid` | strength |

```html
<div class="rounded-card border border-transparent holo-border holo-shimmer holo-vivid" style="--holo-inset:1px">…</div>
<button class="rounded-control bg-accent text-accent-foreground holo-border holo-sweep">Send</button>
<span class="text-mono-hero font-mono holo-text">$412.08</span>
```

## Fallbacks

- `prefers-reduced-motion: reduce`: shimmer, spin and sweep stop; the gradient stays, static.
- `prefers-contrast: more`: holo strokes become solid `foreground`; holo text becomes `foreground`.
- `forced-colors: active`: the pseudo-elements hide and the element gets a `CanvasText` border.
- No `background-clip: text`: `holo-text` renders in `foreground`.
- Focus never depends on holo: the solid 2px `ring` is always drawn first.
