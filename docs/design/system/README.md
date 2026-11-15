tally.chat is an open-source, self-hosted chat app for LLMs, built around the provider's prompt cache. **Chat with any model. See what every turn costs.** The interface is a precise instrument: calm neutral surfaces, numbers you can trust, and thin holographic lines that mark what is live, focused or important.

Users are developers and power users with their own API keys. They read numbers closely. Design for that.

## Content fundamentals

- Write plain, short, sentence case: "Add provider", "Cache warm", "Condense now". Never Title Case, never exclamation marks, no em dashes.
- Address the user as "you"; the app never says "I" or "we". Buttons are verbs: "Override for today", "Edit anyway", "Continue instead".
- Lead with the consequence and the number: "Editing this message costs ~$0.08 more than continuing." Say whether anything was charged when something fails.
- Money: `$0.0043` (four decimals under one cent), `$12.48` above. Prefix estimates with `~`. Savings carry a sign: `+$0.43`, `-$0.02`.
- Tokens: `12.4k`, `412`, `1.2M`. Percentages without decimals: `87% hit`.
- Separate metadata with ` · `. Keep every metadata line to one line.
- No emoji, no sparkle icons, no "AI magic" language. The model's name is the only brand in the conversation.

## Color

- Build on four surfaces: `background` (canvas, message column), `surface` (sidebar, inspector), `surface-raised` (composer, cards, controls), `surface-sunken` (code, wells, tracks). Floating layers use `surface-overlay` with a 12px backdrop blur.
- Set text in `foreground`, secondary text in `foreground-muted`, tertiary in `foreground-subtle`. All three pass 4.5:1 on every surface in both themes.
- Draw dividers and card edges with `border`; control outlines with `border-strong` (3:1). Focus is always a solid 2px `ring`.
- `accent` is the warm amber money color: primary buttons, links, selected controls. Text on it is `accent-foreground`; tinted grounds use `accent-soft` with `accent-strong` text. Use amber for action, never for decoration.
- Cache layers mean the same thing everywhere (context bar, layer chips, breakdown, metadata, charts): `cached` is cheap and solid, `to-be-written` is a one-time write and always hatched, `fresh` is full price and always outlined. The texture keeps them apart for color-blind users.
- Cache temperature: `cache-warm`, `cache-cooling`, `cache-cold`. Budget: `budget-ok`, `budget-near` (80%), `budget-paused` (100%). Savings: `savings-positive`, `savings-negative`, always with a sign.
- Status colors `success`, `warning`, `danger`, `info` each have a `-soft` ground. Success is a blue-leaning teal so it never relies on a red-green split; still pair every status with an icon and a word.
- Chart series use `chart-1` to `chart-6` in order (cyan, amber, violet, vermillion, orchid, warm gray), derived from Okabe-Ito and tuned to the holo stops. `chart-6` is "other".
- Light and dark are both first-class. Dark is designed, not inverted: near-black warm neutrals, brighter holo stops, a top inner highlight on raised surfaces instead of heavier shadows.

## Holographic lines

The signature. A soft spectral gradient (`holo-cyan` → `holo-violet` → `holo-pink` → `holo-amber`) on 0.5-1px strokes, like light on foil or a prism edge. Amber is the last stop, so the spectrum flows out of the brand.

- Put holo on **lines and edges only**: borders, dividers, focus halos, progress strokes, chart lines, the logo outline. Never on surfaces, never behind text.
- Most borders stay plain `border` hairlines. Reserve holo for what is **active, focused, live or important**: the focused composer, the active thread, a streaming reply, the warm cache pill, the primary button, the selected inspector layer. Two or three holo things per view, at most.
- Choose intensity by importance: `holo-subtle` (0.45), `holo-default` (0.8), `holo-vivid` (1, glows in dark only). Light mode multiplies strength by 0.8: foil on paper.
- Use `holo-shimmer` only on live things, and `holo-sweep` only on the primary button.
- `holo-text` is for the wordmark and one hero number per page, 24px and up.
- Line work is also a motif: tally marks, ruler ticks, hairline grids (`tc-grid-bg` on empty states, sign-in and usage only).

See **Holographic lines** for the utilities and **Where holo goes** for the per-component map.

## Type

- Set UI and reading text in Geist; numbers, code and token counts in Geist Mono. (Fallbacks: Inter, JetBrains Mono.) Load both with `next/font` from the `geist` package.
- Use `prose` (16/28) for every message body and cap the column at `layout-message` (70ch). Use `body` (15/22) for UI, `body-sm` (13/20) for dense rows, `label` for controls, `caption` for chips and group headings, `overline` for inspector and tile labels.
- Use `display` once per screen at most (sign-in, empty states), `title` for page titles, `heading` and `subheading` for panels and cards.
- Set every number in `mono-hero`, `mono-sm` or `mono-xs` with tabular figures on, so columns align and live values never jitter. Turn ligatures off in mono so `->`, `!=` and URLs read literally.

## Space and layout

- Use the 4px scale (`space-1` = 4px … `space-16` = 64px). Gap between turns is `space-8`; padding in cards is `space-4` (compact) or `space-5` (comfortable).
- Desktop shell: sidebar `layout-sidebar` (264px) · message column centred, text capped at `layout-message` · inspector `layout-inspector` (360px). Composer max `layout-composer` (760px). Header `layout-header` (48px).
- Be airy where people read (messages) and dense where they analyze (inspector, usage): rows are `row-comfortable` (36px) in lists and `row-compact` (28px) in data panels.
- Under 1200px the inspector becomes a bottom sheet; under 900px the sidebar becomes a left sheet. Support down to 360px.

## Radius

One logic: the bigger and more contained the surface, the rounder; nested radius equals outer radius minus padding. `radius-xs` (4) for kbd, inline code and checkboxes · `radius-control` (8) for buttons and inputs · `radius-popover` (10) for menus, popovers and code blocks · `radius-card` (14) for cards, the composer and the user bubble · `radius-dialog` (18) for dialogs and sheets · `radius-pill` for badges, the cache pill and the branch switcher.

## Elevation and materials

Lines first, shadows soft and few.

| Level | Token | Edge | Used by |
| --- | --- | --- | --- |
| Flat | `shadow-none` | plain `border` | sidebar, inspector, messages |
| Raised | `shadow-raised` | plain `border` | composer at rest, cards, stat tiles, code header |
| Floating | `shadow-floating` | plain `border`; holo only if live | popovers, menus, tooltips, toasts |
| Modal | `shadow-modal` | subtle holo | dialogs, sheets |

Use translucency (`surface-overlay` + blur) only for floating layers and sticky headers.

## Iconography

Tabler Icons (`@tabler/icons-react`), outline set, stroke 1.5, at 14, 16 or 20px. Icons take `currentColor`: `foreground-muted` at rest, `foreground` on hover. Pair every status icon with a word; give every icon-only button an `aria-label` and tooltip. No sparkles. The logo files live in **Logos**.

## Motion

Motion explains change and state; it never decorates. Fast, physical, interruptible; numbers and layout never jump. Tokens live in `code/motion.ts` for `motion/react`: durations `instant` 100ms, `fast` 160ms, `base` 240ms, `slow` 400ms; easings `standard`, `enter`, `exit`; springs `snappy`, `smooth`, `gentle`. Every pattern has a reduced-motion fallback (opacity only, or none) and the holo shimmer becomes a static gradient. See **Motion**.

## Accessibility

- All text pairs meet WCAG AA (4.5:1 body, 3:1 large text and UI) in both themes; the notes on each color token name its grounds.
- Focus is visible everywhere: a solid 2px `ring` (4.5:1+ on every surface), with the holo halo layered on top, never instead.
- Never encode meaning in color or holo alone: cache layers add texture, statuses add icons and words, savings add signs.
- `prefers-reduced-motion`, `prefers-contrast: more` and `forced-colors` are handled in the holo utilities.
- Everything is keyboard reachable; Base UI (`@base-ui/react`) provides the headless behavior for Select, Menu, Dialog, Popover, Tabs, Switch, Checkbox, Radio and Slider.

## Using this system in the app

- Drop `code/globals.css` into `app/globals.css` with `code/holo.css` beside it. It defines `:root` (light) and `.dark` tokens and maps them in `@theme inline`, so `bg-surface`, `text-foreground-muted`, `border-border-strong`, `text-cached`, `rounded-card`, `shadow-floating`, `text-prose`, `text-mono-sm`, `w-sidebar`, `max-w-composer` all work.
- Import motion tokens from `code/motion.ts` and wrap the app in `<MotionConfig reducedMotion="user">`.
- The live previews here run `components/bundle.js` (`window.Tally`, React 18) and `components/bundle.css`; their class names (`tc-*`) document the exact styling to port to Tailwind and Base UI.
