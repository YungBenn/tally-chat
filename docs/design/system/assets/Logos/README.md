# Logos

- `tally-mark.svg`: full-color mark for light grounds (`background`, `surface` light). Holo outline and ruler ticks use the light holo stops; the t is `#1b1a18`, the tally-slash crossbar `#94650f`.
- `tally-mark-dark.svg`: the same mark for dark grounds. Dark holo stops; t `#f2f0ec`, slash `#e3a93e`.
- `tally-mark-amber.svg`: single-ink version, ink `#94650f` (amber-600). For favicons under 32px, print, monochrome PWA icons. On dark grounds swap the ink to `#e3a93e`.
- `tally-app-icon.svg`: 512px PWA and home-screen icon, mark on a `#0c0c0b` tile.
- In the app, render the mark with the `Logo` component so it follows the theme; it can draw itself in once on first load.
- Wordmark: "tally" in Geist 600 at -0.03em plus ".chat" in Geist 400 `foreground-subtle`, set live in type (no outlined file yet).
- Minimum 16px. Clear space a quarter of the mark. Don't fill the square, recolor the slash, add glows, or place the mark on a holo fill.
