# Motion

Motion explains change and state; it never decorates. It is fast, physical and interruptible, and numbers and layout never jump. Implementation: `motion/react` with the tokens in `code/motion.ts`; the previews here run CSS equivalents.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `duration.instant` | 100ms | press, hover color |
| `duration.fast` | 160ms | tooltips, menus, popovers, exits |
| `duration.base` | 240ms | branch slide, tabs, switches, fades |
| `duration.slow` | 400ms | panel resize, banners, number settle |
| `duration.draw` | 1.2s | line drawing |
| `duration.shimmer` | 9s | one holo drift loop |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | most state changes |
| `ease.enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | arriving |
| `ease.exit` | `cubic-bezier(0.4, 0, 1, 1)` | leaving |
| `ease.inOut` | `cubic-bezier(0.65, 0, 0.35, 1)` | line drawing |
| `spring.snappy` | stiffness 520, damping 38, mass 0.8 | switches, segmented indicator, digits |
| `spring.smooth` | stiffness 300, damping 32, mass 1 | messages, inspector, layer bars (`layout`) |
| `spring.gentle` | stiffness 200, damping 28, mass 1.1 | dialogs, sheets, banners |

## Patterns

| Pattern | How | Token | Reduced motion |
| --- | --- | --- | --- |
| Holo shimmer | gradient drifts along the stroke (`holo-shimmer`) on the focused composer, streaming thread, live badge | `duration.shimmer`, linear | static gradient |
| Holo sweep | one light pass along the primary button edge on hover | 1.2s, `ease.standard` | none |
| Pointer sheen | `--holo-angle` follows pointer x on one key card | `tiltAngle()` | off |
| Line drawing | `pathLength` 0 → 1 on logo, empty-state glyph, line chart; first load only | `variants.lineDraw` | drawn |
| Message enter | opacity 0 → 1, y 8 → 0 for new user messages and the start of a reply | `variants.messageEnter`, `spring.smooth` | opacity, 160ms |
| Streaming | text appends without animating; a holo caret blinks at the end; a holo rail sits left of the reply | caret 1s steps | caret static |
| Thinking | four tally ticks rise in sequence, then a slash | `variants.thinking`, 1.6s | static ticks |
| Number change | each digit column rolls to its value (tabular figures, fixed width) | `variants.digit`, `spring.snappy` | instant |
| Cache warm | dot breathes; ring drains over 5 minutes, ticking once a second | `cachePulse` 4s, `cacheRing` linear | static |
| Cache cooling → cold | ring color crossfades to `cache-cooling`, then the ring fades out | `duration.slow` | instant |
| Inspector open/close | grid column width with `layout`; layer bars resize with `layout` | `transition.layout` | instant |
| Branch switch | the count slides 10px in the travel direction; the message crossfades | `variants.branchSlide` | crossfade |
| Popovers, menus, tooltips | scale 0.97 + fade from the trigger side with `AnimatePresence` | `variants.pop` | fade |
| Dialogs, sheets | scale/slide in with the scrim fading | `variants.dialog`, `variants.sheet` | fade |
| Toasts | slide up 16px | `variants.toast` | fade |
| Budget banner, cache-break warning | height opens, content fades in | `variants.banner` | fade |
| Chart bars and lines | bars grow from the axis staggered 25ms; line draws in | `variants.barGrow`, `variants.lineDraw` | none |
| Hover, press, focus | color in `duration.fast`; press `whileTap` scale 0.97; focus ring appears instantly | `press` | no scale |

## Rules

- Never animate a value the user is comparing: cost and token columns change in place with tabular figures.
- Nothing loops except live state (shimmer on live things, cache breath, thinking ticks, caret). Stop loops when the state ends.
- Cache states never flash or shake. Cold is not an error.
- Everything is interruptible: use springs for anything a user can trigger twice.
