# Design system for tally.chat: holographic lines

## What tally.chat is

tally.chat is an open-source, self-hosted, single-user chat app for LLMs (Claude, OpenAI, OpenRouter, Ollama and other OpenAI-compatible providers). The tagline is **"Chat with any model. See what every turn costs."**

What sets it apart: it is built around the provider's prompt cache. It lays out every request so the cache can reuse it, keeps the cache warm while you read, and shows exactly what you pay for, before and after you send. Cost and context are first-class UI, not hidden in a settings page.

Users are developers and power users who bring their own API keys. They care about money, control and transparency, and they read numbers closely.

## The surfaces the system has to serve

- **Thread view**: sidebar of threads, the message list (Markdown, code blocks, images), and the composer.
- **Composer**: text input, image attach, model picker, effort control (how hard the model thinks), output mode (quick / normal / long), send/stop.
- **Cost strip**: one line under the composer, e.g. `~$0.004 next · cache warm · 87% hit`, updating live as the user types.
- **Per-reply metadata**: e.g. `Sonnet 5.5 (low) · $0.0043 · 12.4k in (87% cached) · 340 out`, clickable for a breakdown.
- **Inspector**: side panel showing the context window layer by layer (system prompt, checkpoint summary, turns, next message). Each layer is marked **cached**, **to be written** or **fresh**, with token count and price. Also shows thread totals, cache upkeep, hit rate, money saved, and a "condense now" action.
- **Cache status**: the cache is warm, cooling (close to its 5 minute expiry) or cold. Keepalive refreshes it in the background.
- **Branching**: messages form a tree. Retry, edit (fork) and switch between sibling branches (`< 2/3 >`).
- **Warnings**: cache-break warning ("editing this message costs ~$0.08 more than continuing"), soft daily budget banner at 80% and pause at 100% with an override.
- **Usage page**: 30 days of spend by day and by model, cache hit rate, keepalive spend, net savings (can be negative).
- **Providers page**: add a provider, base URL, encrypted API key, model list.
- **Settings and sign-in**: password sign-in, condense settings, side-job model, daily budget.

## Direction

I want a design system that is **very modern and beautiful**, with a **holographic line** aesthetic as its signature, applied as one coherent language across color, type, space, depth and motion.

### Signature: holographic lines

- The look is built from **thin, precise lines** (0.5-1px hairlines, outlines, grids, rules, tick marks) that carry a **holographic, iridescent sheen**: a soft spectral gradient (cyan -> violet -> pink -> amber) that shifts along the stroke, like light on a hologram sticker, foil or a prism edge.
- Holographic color lives **on lines and edges only**: borders, dividers, focus rings, outlines, progress strokes, chart lines, the logo outline. Surfaces stay calm and mostly neutral, so the effect feels premium, not loud.
- Line work is also a motif: fine technical grids, measurement ticks and tally marks (fits the name "tally" and the idea of metering), wireframe outlines, rulers on the inspector's context bar.
- Use the effect by hierarchy: most borders are plain neutral hairlines; holographic strokes are reserved for **active, focused, live or important** things (the focused composer, the active thread, a streaming reply, the warm cache indicator, primary buttons, the selected inspector layer).
- Dark mode is where it shines most (lines glowing faintly on near-black); in light mode the sheen is subtler, like foil on paper.
- Define it as reusable tokens/utilities: a `holo` gradient (conic and linear versions), a `holo-border` (gradient stroke via mask or border-image so it works on rounded corners), a `holo-ring` for focus, and a `holo-text` for rare accents such as the logo or a hero number. Give intensity levels (subtle, default, vivid).
- It must stay legible and accessible: never put body text on a holographic fill, keep plain-color fallbacks, and respect `prefers-reduced-motion` and `prefers-contrast`.

- **Personality**: calm, precise, trustworthy, quietly premium. A well-made instrument, like a beautiful meter or a fine watch, not a flashy AI toy. Confident with numbers.
- **Avoid**: big gradient-filled backgrounds, glowing orbs, sparkle icons everywhere, heavy glassmorphism, rainbow overload, dashboard clutter, default shadcn look. The holographic effect is a fine line, not a paint bucket.
- **References in spirit**: Linear, Vercel, Raycast, Arc, Things 3. Dense where it matters (the inspector, usage), airy where people read (messages).
- **Reading first**: long assistant replies must be a pleasure to read. Comfortable measure (~68-72ch), generous line height, great code blocks.
- **Numbers are the hero**: costs, tokens and percentages use tabular figures and a mono or tabular face so columns align and values do not jitter while they update.
- **Brand color**: the current mark is a rounded square in amber/bronze `#9a6a12` with a lowercase mono "t". Keep a warm amber/gold as the solid brand accent (it hints at money), and let the holographic spectrum flow out of it (amber is one stop of the holo gradient). Propose a refreshed mark in the holographic line style, e.g. an outlined "t" or tally marks drawn with a holo stroke. Neutrals should be near-neutral so the iridescence reads cleanly.
- **Light and dark** are equally first-class. Dark mode is not just inverted; design it deliberately.

## Foundations to define

1. **Color**
   - Neutral scale (warm), brand amber scale, and semantic colors: success, warning, danger, info.
   - Semantic tokens, not raw values: `background`, `surface`, `surface-raised`, `surface-overlay`, `foreground`, `foreground-muted`, `foreground-subtle`, `border`, `border-strong`, `ring`, `accent`, `accent-foreground`, etc.
   - **Domain tokens** for cache state, used consistently everywhere (inspector layers, cost strip, reply metadata, charts):
     - `cached` (cheap, good), `to-be-written` (one-time write cost), `fresh` (full price)
     - cache `warm`, `cooling`, `cold`
     - budget `ok`, `near-limit` (80%), `paused` (100%)
     - savings positive vs negative
   - The **holographic spectrum**: the gradient stops for light and dark, plus the `holo` gradient tokens and intensity levels described above.
   - A chart palette of 6 colors that works in both themes, is colorblind-safe, and harmonizes with the holo spectrum.
   - All text pairs meet WCAG AA (4.5:1 body, 3:1 large text and UI).
2. **Typography**: a sans for UI and reading, a mono for numbers, code and token counts. Suggest a pairing (current is Inter + JetBrains Mono; propose better if you have it, e.g. Geist / Geist Mono, Inter Display). Define a type scale (display, title, heading, body, body-sm, caption, mono-sm, mono-xs) with size, line height, weight and tracking. Tabular numerals on by default for numeric styles, ligatures off in mono so URLs and numbers read literally.
3. **Spacing**: 4px base scale, layout widths (sidebar, message column, inspector), density modes (comfortable for reading, compact for data panels).
4. **Radius**: a small set (control, card, popover, pill) with one consistent logic.
5. **Elevation and materials**: lines first, shadows soft and few. Define levels for flat, raised (cards), floating (popovers, menus), and modal, and say which levels get a plain hairline vs a holographic edge. A faint background grid or line texture is allowed on empty states, sign-in and the usage page. Subtle translucency only for overlays and sticky headers.
6. **Iconography**: Tabler Icons (`@tabler/icons-react`), stroke 1.5, sizes 14/16/20. Define usage rules.
7. **Motion** (important, see below).

## Motion

The implementation will use **Motion** (`motion/react`, formerly Framer Motion) in React. Define motion as tokens and rules, not one-off animations.

- **Principles**: motion explains change and state; it never decorates. Fast, physical, interruptible. Numbers and layout never "jump".
- **Tokens**: durations (instant ~100ms, fast ~160ms, base ~240ms, slow ~400ms), easings (standard, enter, exit), and 2-3 named spring presets (e.g. `snappy`, `smooth`, `gentle`) given as Motion `{ type: "spring", stiffness, damping, mass }` or `{ bounce, duration }` values.
- **Patterns to specify**, each with the token it uses:
  - **holographic shimmer**: the gradient slowly drifts or a light sweep travels along a holo stroke (e.g. on hover of a primary button, around the focused composer, along the border of a streaming reply). Slow and subtle (several seconds per loop), animated with CSS custom properties or Motion values, GPU-cheap
  - **line drawing**: outlines, dividers, chart lines and the logo draw themselves in with `pathLength`, used sparingly on first load and for empty states
  - optional pointer-reactive sheen: the holo angle shifts slightly with the cursor on key cards, like tilting a hologram
  - message enter (new user message and streaming assistant reply)
  - streaming text and the typing / thinking indicator
  - number changes: costs and token counts roll or crossfade smoothly with tabular figures (e.g. cost strip updating while typing)
  - cache state: warm -> cooling -> cold as a living indicator (a slow, calm pulse or a draining ring for the 5 minute window), never alarming
  - inspector panel open/close and layer bars resizing with `layout` animations
  - branch switching `< 2/3 >` with a directional slide
  - popovers, menus, tooltips, dialogs, toasts (enter/exit with `AnimatePresence`)
  - budget banner and cache-break warning appearing
  - chart bars/lines drawing in on the usage page
  - hover, press (`whileTap` scale ~0.97) and focus states
- **Reduced motion**: every pattern has a `prefers-reduced-motion` fallback (opacity only, or none). Holo shimmer becomes a static gradient.

## Components to include

Show each in light and dark, with all states (default, hover, active, focus-visible, disabled, loading, error) and sizes where relevant.

- **Primitives**: Button (primary, secondary, ghost, outline, danger; sm/md/lg; icon button), Input, Textarea, Select, Checkbox, Switch, Radio, Segmented control, Slider, Tooltip, Popover, Dropdown menu, Dialog, Sheet/Drawer, Toast, Tabs, Badge, Kbd, Avatar, Skeleton, Spinner, Progress bar, Divider, Empty state.
- **Chat**:
  - App shell: sidebar (thread list, search, new thread, grouped by date), header, main column, collapsible inspector
  - Thread list item (title, active, hover, unread/streaming state)
  - User message bubble and assistant message (full width, no bubble), with actions (copy, retry, edit, pin, fork)
  - Reply metadata line and its expanded cost breakdown popover
  - Branch switcher `< 2/3 >`
  - Markdown rendering: headings, lists, tables, blockquote, inline code, code block with language label and copy button, syntax highlighting theme for both modes
  - Image attachment chip and preview with its estimated cost
  - Composer: multiline input, attach, model picker, effort control, output mode, send / stop, disabled while paused by budget
  - Cost strip
  - Cache status indicator (warm / cooling / cold)
  - Thinking / streaming indicator, "Continue" for a reply that hit its limit
  - Checkpoint marker in the message list ("turns 1-14 condensed")
- **Inspector**: context window stacked bar, layer rows (name, tokens, state chip, price), thread totals, hit rate, savings, condense now button.
- **Feedback**: budget banner (80% warning, 100% paused with override), cache-break warning dialog, error and retry states, provider connection error.
- **Data**: stat tile (value, label, delta), bar chart (spend by day, stacked by model), line chart (hit rate), table (by model), legend.
- **Forms/pages**: provider card and form, settings sections, sign-in card.

## Deliverables

1. A visual design system page, itself showcasing the holographic line style: foundations (color, type, spacing, radius, elevation, icons, motion) and the full component library above.
2. **Tokens as CSS custom properties** for Tailwind CSS v4 (`@theme inline` plus `:root` and a `.dark` class), semantic names as listed, so I can drop them into `app/globals.css`.
3. The holographic utilities (`holo`, `holo-border`, `holo-ring`, `holo-text`, intensity levels) as CSS that works with rounded corners in Chrome, Safari and Firefox.
4. Motion tokens as a small TypeScript module (durations, easings, spring presets, and a few reusable `variants`) for `motion/react`.
5. Short usage guidance per component: when to use it, do and don't, and where holographic lines are and are not allowed.
6. A sample composition: the thread view with sidebar, a conversation with a code block and branch switcher, composer with cost strip, and the inspector open, in both light and dark.

## Technical context

- Next.js 16 (App Router), React 19, Tailwind CSS v4, Base UI (`@base-ui/react`) for headless primitives, Tabler Icons, Motion for animation.
- Desktop first, fully responsive down to mobile (360px); installable as a PWA. On mobile the sidebar and inspector become sheets.
- Accessibility: keyboard navigable, visible focus rings, WCAG AA contrast, reduced motion respected.
- Copy style: plain, short, sentence case. No em dashes.
