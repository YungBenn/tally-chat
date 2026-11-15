# BrandMark

The refreshed mark: a holo-outlined rounded square, a lowercase t whose crossbar is a tally slash in `accent`, and four ruler ticks along the base.

- Use the full-color mark (`Logos/tally-mark.svg` or `Tally.Logo`) on `background` and `surface` in both themes. The t is drawn in `foreground`, so the component adapts; the SVG files come in a light-ground and a dark-ground version.
- Use the single-ink amber mark (`tally-mark-amber.svg`, ink `#94650f`) where gradients can't render: favicons under 32px, print, PWA monochrome icon.
- The wordmark is "tally" in Geist 600 plus ".chat" in `foreground-subtle` 400. Lowercase always.
- Minimum size 16px. Clear space: one quarter of the mark on every side.
- Draw the mark in with `pathLength` once on first load and on sign-in. Never loop it.
- Don't fill the square, recolor the slash, add glows or sparkles, or set the mark on a holo fill.
