# Spec: Phase 8, redesign on the tally.chat design system

Status: ready-for-agent · Source: design system ([artifact](https://claude.ai/artifact/Qw45kew4C2KLayUTVAKnok), copied to `docs/design/system/`) and UI/UX canvas ([artifact](https://claude.ai/artifact/LEGmj3NzjXRjJCAjAnRbYZ), copied to `docs/design/ui/`) · Prompts that produced them: `docs/design/design-system-prompt.md`, `docs/design/ui-ux-prompt.md` · No backend changes; respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md)

## Problem Statement

tally.chat works, but it doesn't look or feel like one product. It is styled with the generic Wensity kit (`components/wensity/`) and a 1,200-line `globals.css` that grew one feature at a time. Numbers, the whole point of the app, sit in the same type and weight as everything else. Live state (a streaming reply, a warm cache, the focused composer) looks the same as static state. Spacing, radii and density differ from screen to screen. There is no real mobile layout: under about 900px the sidebar and inspector just squeeze the conversation.

There is now a full design system for tally.chat (tokens, holographic line utilities, motion tokens, 60 component guidelines) and a UI/UX canvas built strictly on it: a clickable prototype, 35 desktop states in light and dark, the 1024px and 390px layouts, and a 12-screen spec. The app should match them.

## Solution

Rebuild the frontend on the design system, screen by screen, with no change to behaviour or data:

- **Foundation.** The system's `globals.css`, `holo.css` and `motion.ts` replace the current styles. Geist and Geist Mono replace Inter and JetBrains Mono. `motion/react` drives springs, layout and enter/exit animation.
- **Primitives.** A small set of the system's components, built on Base UI, replaces Wensity, so every screen is assembled from the same parts.
- **Screens.** Shell and sidebar, thread view, composer and cost strip, editing and branches, inspector, budget, home and sign-in, usage, providers, settings and import, each matching its artboards in `docs/design/ui/` in both themes.
- **Signature.** Holographic lines mark only what is live, focused or important (at most three per view, following `docs/design/system/2-where-holo-goes.md`). Numbers are set in Geist Mono with tabular figures; the cost estimate rolls digit by digit; the cache ring drains; thinking shows tally ticks.
- **Responsive.** Under 1200px the inspector becomes a bottom sheet; under 900px the sidebar becomes a left sheet; at 390px the header, composer and usage page reflow as drawn.
- **Keyboard.** The spec's full shortcut set.

## User Stories

### Look and feel

1. As a user, I want every screen built from the same surfaces, type, spacing and radii, so that the app feels like one product.
2. As a user, I want numbers in a mono face with tabular figures, so that costs and token counts line up and never jitter while they update.
3. As a user, I want live things (the focused composer, a streaming reply, a warm cache, the active thread) marked with a thin holographic line, so that I can see at a glance what is happening.
4. As a user, I want no more than a few highlighted things on screen at once, so that the highlights still mean something.
5. As a user, I want light and dark themes that are each designed rather than inverted, following my OS setting, so that both are comfortable.
6. As a user, I want motion that explains a change (a message arriving, a panel opening, a branch switching) and never decorates, so that the app feels fast and calm.
7. As a user who prefers reduced motion, I want animations replaced by fades or nothing and shimmer made static, so that nothing moves that I don't want moving.
8. As a user with high contrast or forced colors on, I want holographic lines to become solid lines, so that nothing relies on the gradient.
9. As a color-blind user, I want cached, to-be-written and fresh layers told apart by texture (solid, hatched, outlined) as well as color, so that the context bar reads without color.

### Thread and composer

10. As a user, I want the conversation in a 70ch column of 16/28 prose with airy spacing between turns, so that long replies are easy to read.
11. As a user, I want a streaming reply marked with a holo rail and a blinking caret, and Stop in place of Send, so that I always know a reply is in progress.
12. As a user, I want thinking shown as tally ticks with elapsed time, so that a pause before the first token doesn't look like a hang.
13. As a user, I want each reply's metadata on one mono line that opens a cost breakdown popover, so that the detail is one click away but never in the way.
14. As a user, I want message actions (copy, retry, retry with, edit, fork, pin) to appear on hover and on keyboard focus, so that they don't clutter reading.
15. As a user, I want the composer edge to light up while I type, and the next-message estimate under it to roll digit by digit, so that the cost of what I'm writing stays visible without jumping.
16. As a user, I want attachments shown as chips with their size, tokens and price, so that I know what an image costs before I send it.
17. As a user, I want the model picker grouped by provider with each model's estimate for this send, so that the cheaper-reply choice from phase 7 is quick to read.
18. As a user, I want effort shown as rising bars and output mode as a small segmented control, so that both are readable at a glance.
19. As a user scrolled up in a long thread, I want a jump-to-latest button, so that I can get back to the end in one click.
20. As a user, I want errors to say plainly what failed and whether anything was charged, with a retry, so that a failure never leaves me guessing about money.
21. As a user, I want the condensed fold shown as a checkpoint marker that expands into its summary and pinned list, so that condensed history is still easy to find.

### Editing and branches

22. As a user, I want to edit an old message in place, with the rewrite price shown before I save, so that I know what the edit costs.
23. As a user, I want a confirmation that states the extra cost, with Continue instead as the safe default, before an edit that breaks the cache, so that I never pay for a rewrite by accident.
24. As a user, I want the branch switcher's count to slide in the direction I move, so that switching branches feels spatial.

### Inspector and budget

25. As a user, I want the inspector to show cache status with a draining ring, the context bar with a ruler, one row per layer, thread totals and Condense now, so that the money is explained in one place.
26. As a user, I want selecting a layer row to highlight its segment in the context bar, and the rows to work as a keyboard listbox, so that I can explore the context window with either hand.
27. As a user, I want the inspector to open and close by animating its width, so that the conversation reflows smoothly.
28. As a user, I want the budget banner above the composer at 80% and 100%, and a compact meter in the sidebar that mirrors it, so that my daily spend is always visible.

### Pages

29. As a new user, I want a calm sign-in card for setting my password the first time and for signing in later, with inline errors and no shaking, so that the first impression is precise.
30. As a user, I want a home screen with a centered composer, and a one-step "Add a provider to start" when nothing is set up, so that I always know the next step.
31. As a user, I want the usage page as stat tiles, a stacked daily-spend chart, a hit-rate line and tables, with one highlighted tile, so that I can analyze spend at a glance.
32. As a user, I want providers as cards with an inline add form that tests the key before saving, so that setup is clear and safe.
33. As a user, I want settings as calm rows of title, one-sentence explanation and control, saved with a toast or an inline error, so that changing a setting is predictable.
34. As a user, I want the import page built from the same parts, so that it doesn't look like a different app.

### Responsive and keyboard

35. As a user on a 1024px screen, I want the inspector as a bottom sheet, so that the conversation keeps its width.
36. As a user on a phone, I want the sidebar as a left sheet, a 52px header with 44px touch targets, a full-width composer with folded pickers, and a stacked usage page, so that tally.chat is usable on the go.
37. As a user, I want sheets to trap focus, close with Esc or a tap on the scrim, and return focus to what opened them, so that they behave like real dialogs.
38. As a keyboard user, I want the spec's shortcuts (new thread, search, focus composer, toggle inspector and sidebar, edit last message, switch branches, copy last reply, model picker, attach), shown in tooltips and menus, so that I rarely reach for the mouse.
39. As a keyboard user, I want a visible 2px focus ring on everything focusable and a tab order that follows reading order, so that I never lose my place.

## Implementation Decisions

### Sources of truth

- **Design system files** (`docs/design/system/`): `README.md` (brand book), `1-holographic-lines.md`, `2-where-holo-goes.md`, `3-motion.md`, `code/globals.css`, `code/holo.css`, `code/motion.ts`, `tokens.json`, and `components/<Name>/README.md` per component. `components/bundle.css` (`tc-*` classes) and `components/bundle.js` (`window.Tally`, React 18) are the reference implementation: they document exact sizes, paddings and states to port to Tailwind and Base UI. They are not shipped.
- **UI/UX canvas files** (`docs/design/ui/`): `Main.dc.html` (desktop prototype, every state behind presets), `Mobile.dc.html`, `Sidebar.dc.html`, `InspectorPanel.dc.html`, `Spec.dc.html` (the per-screen spec: layout, components, tokens, holo, motion, states, keyboard), and one `S*/R*/M*` artboard per state, each naming the `Main` preset it renders. When the spec text and an artboard disagree, the artboard wins; when an artboard and the system disagree, the system wins.
- The canvas lists "proposed additions" (SignInCard modes, Composer callbacks, CostBreakdown rows, InlineEditCard, CheckpointSummary, ImageThumb, JumpToLatest, Sheet side, IconButton touch size, DataTable data props, SidebarNavItem, BudgetMeter, SettingsRow). Build each as a component in the app; they use existing tokens only.

### Foundation

- `app/globals.css` becomes the system's `code/globals.css`, with `code/holo.css` beside it as `app/holo.css`. App-specific rules that remain (highlight.js theme mapped to the `code-*` tokens, markdown prose rules from the Markdown guideline) live in a short `@layer components` block after it. Nothing from the old file survives unless a screen still needs it.
- Theme stays automatic: the existing inline script toggles `.dark` on `<html>` from `prefers-color-scheme` (the system's globals already key dark on `.dark`). `themeColor` in the viewport and the manifest take `background` from each theme.
- Fonts: Geist and Geist Mono from the `geist` package through `next/font`, exposed as `--font-geist-sans` and `--font-geist-mono`.
- Motion: `motion` is added; `code/motion.ts` becomes `lib/motion.ts` unchanged except for imports; the root layout wraps the app in `<MotionConfig reducedMotion="user">`. CSS utilities (`holo-shimmer`, `cache-breathe`, `caret`) are preferred for loops; `motion/react` for springs, `layout`, `AnimatePresence` and `pathLength`.
- Icons stay `@tabler/icons-react`, outline, stroke 1.5, sizes 14, 16, 20. No sparkle icons.

### Primitives (`components/ui/`)

One file per component, built on Base UI where it provides behavior, styled with the token utilities (`bg-surface-raised`, `rounded-control`, `text-mono-sm`, `shadow-floating`, ...):

- Button (primary, secondary, outline, ghost, danger; sm, md, lg; icon, loading), IconButton (`label` required; sm, md, touch 44px), Input, Textarea, Select, Switch, Checkbox, SegmentedControl, Badge (tones per its guideline, `live`), Kbd, Tooltip, Menu, Popover, Dialog, Sheet (left, right, bottom), Toast, ProgressBar, Spinner, Divider, Skeleton, EmptyState, ErrorState.
- Holo is applied only through the `holo-*` classes and only where `2-where-holo-goes.md` allows it. Primary Button is the only button with holo.
- Wensity is removed once nothing imports it.

### Domain components

Built in `components/` from primitives, each matching its guideline: BrandMark (with draw-in), ThreadItem, CacheStatus (breathing dot, draining SVG ring, warm / cooling / cold), CostStrip (with RollingNumber), Composer, AttachmentChip, ModelMenu (grouped by provider, per-model estimates from the phase 7 query), EffortControl (1-4 bars), UserMessage, AssistantMessage, ReplyMetadata + CostBreakdown popover, BranchSwitcher, ThinkingIndicator (tally ticks), CheckpointMarker + CheckpointSummary, CodeBlock, ImageThumb, JumpToLatest, InlineEditCard, CacheBreakDialog, BudgetBanner, BudgetMeter, ContextBar (ruler, hatched and outlined segments), LayerRow, Inspector, StatTile, BarChart, LineChart, Legend, DataTable, ProviderCard, ProviderForm, SettingsRow, SignInCard.

- Charts are hand-written SVG (bars, one line, axes) as in the reference bundle; no chart library.
- Pure logic that a component depends on (rolling-number digit layout, cache ring remaining fraction, shortcut matching, money and token formatting already in `lib/format.ts`) lives in `lib/` with unit tests.

### Layout and responsive

- Desktop shell: sidebar 264 · message column centered, capped at 70ch · inspector 360 when open. Header 48, sticky, `surface-overlay` with 12px blur. Composer dock max 760 with the cost strip 8px under it.
- Breakpoints: under 1200px the inspector renders in a bottom Sheet (560 tall at 1024); under 900px the sidebar renders in a left Sheet (312 wide) opened from a header menu button; at phone width the header is 52 with 44px hit areas and the composer folds its pickers into one menu.
- One component tree per panel; the breakpoint only changes the container (column vs sheet), so state such as the selected layer survives a resize.

### Keyboard

A single `useShortcuts` hook registered in the shell, ignoring keys while an input other than the composer has focus where the shortcut would conflict:

| What | Key |
| --- | --- |
| New thread | ⌘⇧O |
| Search thread titles | ⌘K |
| Focus composer | / |
| Send / new line | ↵ / ⇧↵ |
| Stop streaming, close popover or sheet | Esc |
| Toggle inspector / sidebar | ⌘I / ⌘B |
| Edit last message (empty composer) | ↑ |
| Previous / next branch (focused message) | ⌥← / ⌥→ |
| Copy last reply | ⌘⇧C |
| Model picker | ⌘M |
| Attach image | ⌘U |

Shortcuts show in tooltips and menus with Kbd. On non-Mac platforms ⌘ reads as Ctrl.

### What does not change

No schema, Convex function or API change. Every existing feature keeps its behaviour, including features the canvas doesn't draw (reply with and retry with another model, the starting-model suggestion, the imported label, message search hits, the condense settings): they are restyled with the same primitives and placed where the nearest drawn screen suggests.

## Testing Decisions

- **Unit tests** (vitest, `lib/`) for the new pure logic: rolling-number digit columns, cache ring remaining fraction and state thresholds, shortcut matching (platform modifier, input focus rules). Existing tests stay green.
- **Browser pass per ticket** on the dev stack with Playwright, in light and dark, at 1440, 1024 and 390: compare each screen with its artboard(s) in `docs/design/ui/` (render the artboard locally or open the canvas), check holo count per view, focus rings, keyboard paths, reduced motion (`emulateMedia`), and no console errors.
- **Must-have checks**
  - Every artboard state in the canvas is reachable in the real app and matches it in both themes.
  - No more than three holo elements in any view; none on disabled, error or destructive elements.
  - All text meets 4.5:1 (3:1 at 24px and up) in both themes; every icon-only button has a label and tooltip.
  - Reduced motion: no transforms, shimmer static, caret static; `prefers-contrast: more` turns holo solid.
  - Sheets trap focus, close with Esc and scrim, and return focus.
  - Every shortcut in the table works and is listed in a tooltip or menu.
  - `bun run lint`, `bun run typecheck`, `bun run test` and `bun run build` pass.

## Out of Scope

- A manual theme switch (theme follows the OS).
- New features or behaviour changes; anything the backend would need to change.
- Shipping the reference bundle (`bundle.js`, `bundle.css`) or React 18.
- Marketing site, README screenshots beyond replacing the current ones.

## Further Notes

- The design system's README names its consumer rules ("Using this system in the app"); follow them.
- The glossary gains "holo line" (the spectral 1px edge marking live or focused state) when this ships.
