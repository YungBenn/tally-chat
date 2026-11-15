# Code: motion.ts

Motion tokens for `motion/react` (`code/motion.ts`): durations, easings, springs, transitions, reusable variants, living indicators and reduced-motion replacements.

```ts
// tally.chat motion tokens for motion/react
// Principles: motion explains change and state, never decorates. Fast, physical, interruptible.
// Wrap the app in <MotionConfig reducedMotion="user"> and use the `reduced` variants below
// where a pattern needs more than "skip the transform".

import { useReducedMotion, type Transition, type Variants } from "motion/react";

/* Durations in seconds (Motion's unit). CSS mirrors: 100ms / 160ms / 240ms / 400ms. */
export const duration = {
  instant: 0.1, // press, hover color
  fast: 0.16, // tooltips, menus, popovers
  base: 0.24, // branch slide, tabs, switches
  slow: 0.4, // panel resize, number roll settle, banners
  draw: 1.2, // line drawing (logo, empty states, chart lines)
  shimmer: 9, // one loop of the holo drift along a stroke
} as const;

/* Cubic-bezier easings */
export const ease = {
  standard: [0.2, 0, 0, 1], // most state changes
  enter: [0.22, 1, 0.36, 1], // things arriving (decelerate)
  exit: [0.4, 0, 1, 1], // things leaving (accelerate)
  inOut: [0.65, 0, 0.35, 1], // line drawing
} as const;

/* Springs */
export const spring = {
  /** Small, quick, a hint of overshoot: switches, segmented indicator, number digits, press release. */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  /** Default for layout: messages entering, inspector open/close, layer bars resizing. */
  smooth: { type: "spring", stiffness: 300, damping: 32, mass: 1 },
  /** Large surfaces: dialogs, sheets, the budget banner. */
  gentle: { type: "spring", stiffness: 200, damping: 28, mass: 1.1 },
} satisfies Record<string, Transition>;

export const transition = {
  hover: { duration: duration.fast, ease: ease.standard },
  press: { duration: duration.instant, ease: ease.standard },
  layout: spring.smooth,
  enter: { duration: duration.base, ease: ease.enter },
  exit: { duration: duration.fast, ease: ease.exit },
} satisfies Record<string, Transition>;

/* Press feedback for any button: <motion.button {...press}> */
export const press = { whileTap: { scale: 0.97 }, transition: transition.press } as const;

/* ---------- Variants ---------- */
export const variants = {
  /** New user message and the start of a streaming assistant reply. */
  messageEnter: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: spring.smooth },
  },
  /** Tooltips, menus, popovers (AnimatePresence). Set transformOrigin from the trigger side. */
  pop: {
    initial: { opacity: 0, scale: 0.97, y: -2 },
    animate: { opacity: 1, scale: 1, y: 0, transition: { duration: duration.fast, ease: ease.enter } },
    exit: { opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: ease.exit } },
  },
  /** Dialogs. Pair the scrim with `fade`. */
  dialog: {
    initial: { opacity: 0, scale: 0.96, y: 8 },
    animate: { opacity: 1, scale: 1, y: 0, transition: spring.gentle },
    exit: { opacity: 0, scale: 0.98, transition: { duration: duration.fast, ease: ease.exit } },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.base, ease: ease.standard } },
    exit: { opacity: 0, transition: { duration: duration.fast, ease: ease.exit } },
  },
  /** Mobile sheets: custom = "left" | "right" | "bottom". */
  sheet: {
    initial: (side: "left" | "right" | "bottom") => side === "bottom" ? { y: "100%" } : { x: side === "left" ? "-100%" : "100%" },
    animate: { x: 0, y: 0, transition: spring.gentle },
    exit: (side: "left" | "right" | "bottom") => ({
      ...(side === "bottom" ? { y: "100%" } : { x: side === "left" ? "-100%" : "100%" }),
      transition: { duration: duration.base, ease: ease.exit },
    }),
  },
  /** Toasts slide up from the bottom edge. */
  toast: {
    initial: { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: spring.smooth },
    exit: { opacity: 0, y: 8, transition: { duration: duration.fast, ease: ease.exit } },
  },
  /** Budget banner and cache-break notice: height opens, content fades. */
  banner: {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: "auto", transition: { height: spring.gentle, opacity: { duration: duration.base, delay: 0.05 } } },
    exit: { opacity: 0, height: 0, transition: { duration: duration.base, ease: ease.exit } },
  },
  /** Branch switcher `< 2/3 >`: custom = 1 (next) or -1 (previous). Use AnimatePresence mode="popLayout". */
  branchSlide: {
    initial: (dir: number) => ({ opacity: 0, x: dir * 10 }),
    animate: { opacity: 1, x: 0, transition: { duration: duration.base, ease: ease.standard } },
    exit: (dir: number) => ({ opacity: 0, x: dir * -10, transition: { duration: duration.fast, ease: ease.exit } }),
  },
  /** One digit in a rolling number. custom = digit 0-9; the column holds 0-9 stacked. */
  digit: {
    animate: (d: number) => ({ y: `${-d * 10}%`, transition: spring.snappy }),
  },
  /** Line drawing with pathLength: logo, empty state glyph, chart lines. Use sparingly (first load only). */
  lineDraw: {
    initial: { pathLength: 0, opacity: 0 },
    animate: (i: number = 0) => ({
      pathLength: 1,
      opacity: 1,
      transition: { pathLength: { duration: duration.draw, ease: ease.inOut, delay: i * 0.12 }, opacity: { duration: 0.01, delay: i * 0.12 } },
    }),
  },
  /** Usage chart bars grow from the axis, staggered by index. Set style={{ originY: 1 }}. */
  barGrow: {
    initial: { scaleY: 0 },
    animate: (i: number) => ({ scaleY: 1, transition: { ...spring.smooth, delay: i * 0.025 } }),
  },
  /** Thinking indicator: four ticks rise, then the slash. Children use `tick`. */
  thinking: { animate: { transition: { staggerChildren: 0.12, repeat: Infinity, repeatDelay: 0.6 } } },
  tick: {
    initial: { scaleY: 0.25, opacity: 0.35 },
    animate: { scaleY: [0.25, 1, 1, 0.25], opacity: [0.35, 1, 1, 0.35], transition: { duration: 1.6, ease: ease.standard, repeat: Infinity } },
  },
} satisfies Record<string, Variants>;

/* ---------- Living indicators ---------- */
/** Warm cache dot: a slow calm breath. Never faster than 4s. */
export const cachePulse = {
  animate: { opacity: [1, 0.55, 1], scale: [1, 0.8, 1] },
  transition: { duration: 4, ease: "easeInOut", repeat: Infinity },
} as const;

/** Draining ring for the 5 minute cache window. remaining: 0..1. Drive with a MotionValue updated each second. */
export const cacheRing = (remaining: number) => ({
  animate: { pathLength: remaining },
  transition: { duration: 1, ease: "linear" },
});

/** Holo shimmer: animate the CSS custom property the holo utilities read.
 *  <motion.div className="holo-border" style={{ "--holo-pos": pos }} /> or simply add the `holo-shimmer`
 *  class, which runs the same 9s drift in CSS (cheaper, preferred). */
export const holoShimmer = {
  animate: { backgroundPosition: ["0% 0%", "200% 0%"] },
  transition: { duration: duration.shimmer, ease: "linear", repeat: Infinity },
} as const;

/** Pointer-reactive sheen for a key card: map pointer x (-0.5..0.5) to the holo angle. */
export const tiltAngle = (x: number) => `${115 + x * 50}deg`;

/* ---------- Reduced motion ---------- */
/** Opacity-only replacements. Shimmer, pulse and drawing become static. */
export const reduced = {
  messageEnter: { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: duration.fast } } },
  pop: variants.fade,
  dialog: variants.fade,
  toast: variants.fade,
  banner: variants.fade,
  sheet: variants.fade,
  branchSlide: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  lineDraw: { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: 1, opacity: 1 } },
  barGrow: { initial: { scaleY: 1 }, animate: { scaleY: 1 } },
} satisfies Partial<Record<keyof typeof variants, Variants>>;

/** Pick the full or reduced variant set for a pattern. */
export function useMotionVariants<K extends keyof typeof reduced>(key: K): Variants {
  const prefersReduced = useReducedMotion();
  return (prefersReduced ? reduced[key] : variants[key]) as Variants;
}

/* Example
 * const v = useMotionVariants("messageEnter");
 * <motion.div variants={v} initial="initial" animate="animate" layout transition={transition.layout} />
 */
```
