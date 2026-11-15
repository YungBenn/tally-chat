# Motion

Motion explains change and state; it never decorates. Every pattern below maps to a token in `motion.ts`.

| Pattern | Token | Reduced motion |
| --- | --- | --- |
| Holo shimmer (composer focus, streaming) | CSS `--holo-speed` 9s linear | static gradient |
| Line drawing (logo, empty states, charts) | `duration.draw` 1.2s, `ease.inOut` | drawn instantly |
| Message enter | `spring.smooth`, y 8 → 0 | opacity only |
| Number change (cost strip) | `spring.snappy` per digit | instant swap |
| Cache warm pulse | 4s ease-in-out breathe | static dot |
| Cache draining ring | linear, 1s steps over 5 minutes | static ring at remaining |
| Branch switch `< 2/3 >` | `duration.base` slide 10px with direction | crossfade |
| Popover, menu, tooltip | `variants.pop`: scale 0.97 + fade, `duration.fast` | fade |
| Dialog, sheet | `spring.gentle` | fade |
| Press | `whileTap` scale 0.97, `duration.instant` | none |

The cards in this preview run the CSS versions of those patterns so you can see the timing.
