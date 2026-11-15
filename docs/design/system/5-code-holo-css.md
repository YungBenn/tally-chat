# Code: holo.css

The holographic utilities (`code/holo.css`), imported by `globals.css`. Plain classes, so they also work outside Tailwind.

```css
/* tally.chat holographic line utilities. Plain CSS, no build step.
   Needs the --holo-* and --ring color tokens (globals.css). Works on rounded corners in Chrome, Safari and Firefox
   via mask-composite (standard + -webkit-). */
@property --holo-angle { syntax: "<angle>"; inherits: true; initial-value: 115deg; }

:root, .light, [data-theme="light"] { --holo-mul: 0.8; --holo-glow-on: 0; color-scheme: light; }
.dark, [data-theme="dark"] { --holo-mul: 1; --holo-glow-on: 1; color-scheme: dark; }
:root { --holo-strength: 0.8; --holo-width: 1px; --holo-inset: 0px; --holo-speed: 9s; }

.holo-subtle { --holo-strength: 0.45; }
.holo-default { --holo-strength: 0.8; }
.holo-vivid { --holo-strength: 1; }

/* Fill (rare: progress strokes, tick marks, the logo, chart lines via SVG) */
.holo, .holo-fill {
  background: linear-gradient(var(--holo-angle), var(--holo-cyan), var(--holo-violet) 30%, var(--holo-pink) 60%, var(--holo-amber) 85%, var(--holo-cyan)) 0 0 / 200% 100%;
}
.holo-conic {
  background: conic-gradient(from var(--holo-angle), var(--holo-cyan), var(--holo-violet), var(--holo-pink), var(--holo-amber), var(--holo-cyan));
}

/* Gradient stroke that follows any border-radius */
.holo-border { position: relative; isolation: isolate; }
.holo-border::before {
  content: ""; position: absolute; inset: calc(var(--holo-inset) * -1); border-radius: inherit; padding: var(--holo-width);
  background: linear-gradient(var(--holo-angle), var(--holo-cyan), var(--holo-violet) 30%, var(--holo-pink) 60%, var(--holo-amber) 85%, var(--holo-cyan)) 0 0 / 200% 100%;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  opacity: calc(var(--holo-strength) * var(--holo-mul));
  pointer-events: none; z-index: 1;
  transition: opacity 240ms cubic-bezier(0.2, 0, 0, 1);
}
.holo-border.holo-conic::before { background: conic-gradient(from var(--holo-angle), var(--holo-cyan), var(--holo-violet), var(--holo-pink), var(--holo-amber), var(--holo-cyan)); }
/* Vivid strokes glow faintly in dark mode only */
.holo-border.holo-vivid { box-shadow: 0 0 calc(18px * var(--holo-glow-on)) calc(-4px * var(--holo-glow-on)) var(--holo-glow); }

/* Shimmer: the gradient drifts along the stroke (several seconds per loop) */
.holo-shimmer::before { animation: holo-drift var(--holo-speed) linear infinite; }
.holo-spin::before { animation: holo-spin calc(var(--holo-speed) * 0.8) linear infinite; }
@keyframes holo-drift { from { background-position: 0% 0; } to { background-position: 200% 0; } }
@keyframes holo-spin { to { --holo-angle: 475deg; } }

/* Sweep: one light pass along the stroke (primary button hover) */
.holo-sweep { position: relative; }
.holo-sweep::after {
  content: ""; position: absolute; inset: calc(var(--holo-inset) * -1); border-radius: inherit; padding: var(--holo-width);
  background: linear-gradient(100deg, transparent 35%, rgba(255,255,255,0.95) 50%, transparent 65%) -150% 0 / 250% 100% no-repeat;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  opacity: 0; pointer-events: none; z-index: 2;
}
.holo-sweep:hover::after { animation: holo-sweep 1.2s cubic-bezier(0.2, 0, 0, 1) 1; }
@keyframes holo-sweep { 0% { opacity: 0; background-position: -150% 0; } 15% { opacity: 1; } 100% { opacity: 0; background-position: 250% 0; } }

/* Focus: a solid ring you can always see, plus a faint holo halo */
.holo-ring:focus-visible, .tc-focus:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 2px;
}
.holo-ring { position: relative; }
.holo-ring:focus-visible::after {
  content: ""; position: absolute; inset: -6px; border-radius: calc(var(--holo-ring-radius, 8px) + 6px); padding: 1px;
  background: linear-gradient(var(--holo-angle), var(--holo-cyan), var(--holo-violet), var(--holo-pink), var(--holo-amber));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  opacity: calc(0.9 * var(--holo-mul)); pointer-events: none;
}

/* Holo text: logo, one hero number. 24px and up only. */
.holo-text { color: var(--foreground); }
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .holo-text {
    background: linear-gradient(var(--holo-angle), var(--holo-cyan), var(--holo-violet) 35%, var(--holo-pink) 65%, var(--holo-amber));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
}

/* Hairline grid texture (empty states, sign-in, usage) */
.tc-grid-bg {
  background-image:
    linear-gradient(var(--border-subtle) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
  background-size: 24px 24px; background-position: -1px -1px;
}

/* Accessibility fallbacks */
@media (prefers-reduced-motion: reduce) {
  .holo-shimmer::before, .holo-spin::before, .holo-sweep:hover::after { animation: none !important; }
  .tc-anim, .tc-anim * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-property: opacity !important; }
}
@media (prefers-contrast: more) {
  .holo-border::before, .holo-ring:focus-visible::after { background: var(--foreground) !important; opacity: 1 !important; }
  .holo-text { background: none !important; color: var(--foreground) !important; }
}
@media (forced-colors: active) {
  .holo-border::before, .holo-sweep::after, .holo-ring:focus-visible::after { display: none; }
  .holo-border { border: 1px solid CanvasText !important; }
}

/* Hairline grid texture for empty states, sign-in and usage */
.tc-grid-bg, .bg-grid {
  background-image: linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
  background-size: 24px 24px; background-position: -1px -1px;
}
```
