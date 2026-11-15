# UI/UX for tally.chat

Design the complete UI/UX of **tally.chat** as a high-fidelity, clickable prototype with real motion, built **strictly on my design system**:

**Design system: https://claude.ai/artifact/Qw45kew4C2KLayUTVAKnok**

Read its README, "Holographic lines", "Where holo goes" and "Motion" sections first, and use its tokens, components (by their names: `Composer`, `CostStrip`, `Inspector`, `ContextBar`, `LayerRow`, `ReplyMetadata`, `BranchSwitcher`, `CacheStatus`, `ThreadItem`, `StatTile`, and so on) and motion tokens (`duration.*`, `ease.*`, `spring.snappy|smooth|gentle`, `variants.*`). Do not invent new colors, radii, shadows, fonts or animations. If a screen needs something the system lacks, build it from existing tokens and list it at the end as a proposed addition.

## Product in one paragraph

tally.chat is a self-hosted, single-user chat app for LLMs (Anthropic, OpenAI, OpenRouter, Ollama and any OpenAI-compatible API, with your own keys). It is built around the provider's prompt cache: it lays out every request so the cache hits, keeps the cache warm while you read, and shows what's in the context window and what every reply costs, before and after you send. Users are developers and power users who read numbers closely. Tagline: "Chat with any model. See what every turn costs."

## UX principles

1. **Reading first.** The conversation is the hero: airy, 70ch column, `prose` type. Cost information is always one glance away but never in the way.
2. **Cost before commitment.** The user sees what an action costs before doing it: the cost strip updates while typing; editing an old message shows the cache-break price first; images are priced on attach.
3. **Progressive disclosure of money.** Three levels: cost strip (one line) -> reply metadata (one line per reply, click for breakdown) -> Inspector (full context window). Each level links to the next.
4. **Calm states.** A cold cache is not an error. Budget warnings are firm but never alarming. Nothing flashes or shakes.
5. **Holo marks what's alive.** Follow "Where holo goes" exactly: at most two or three holo elements per view (focused composer, active/streaming thread, streaming reply, warm cache pill, selected layer, primary button).
6. **Motion explains change.** Every state change uses the system's motion patterns; numbers roll in place with tabular figures; everything respects reduced motion.
7. **Keyboard-first.** Everything reachable by keyboard, with visible focus rings. Show shortcuts with `Kbd` in tooltips and menus.

## App shell (desktop, 1440px)

- **Left: sidebar** (`layout-sidebar`, `surface`): brand mark, New thread button (`Kbd` hint), title search, thread list grouped by date (Today, Yesterday, Last 7 days, Older), and at the bottom nav to Usage, Providers, Settings plus a compact today's-budget meter. When searching, the groups collapse into one "Results" group.
- **Center: thread** on `background`: a slim sticky header (`layout-header`, translucent) with the thread title (editable), `CacheStatus` pill, delete thread and an Inspector toggle; the message column; the composer pinned at the bottom with the `CostStrip` under it; a "scroll to bottom" button when scrolled up.
- **Right: Inspector** (`layout-inspector`), collapsible with the `layout` width animation, open state remembered per user.
- Responsive per the system: inspector becomes a bottom sheet under 1200px, sidebar a left sheet under 900px, down to 360px (composer pickers fold into one menu).

## Screens and states to design

### 1. Sign-in (first run and returning)
- First run: "Set your password" with password + confirm, inline error "Passwords don't match".
- Returning: "Welcome back", one password field, error "Wrong password".
- Uses `SignInCard`, `tc-grid-bg` hairline grid, the mark drawing itself in once. `display` type for the heading.

### 2. Home / new thread (empty state)
- Centered greeting, the composer front and center with model picker and effort control, and the cost strip already showing the estimate for an empty message.
- Not yet set up: if no provider exists, the empty state becomes a single clear step "Add a provider to start" linking to Providers.

### 3. Thread view (the core screen) - design all of these states
- **Conversation**: `UserMessage` bubbles and full-width `AssistantMessage` with `Markdown` (headings, lists, tables, blockquote, inline code, `CodeBlock` with language label and copy). Each assistant reply ends with `ReplyMetadata`: `Sonnet 5.5 (low) · $0.0043 · 12.4k in (87% cached) · 340 out`.
- **Message actions** on hover/focus: copy, retry, edit (user messages), pin. Retry and edit create siblings, navigated with `BranchSwitcher` `< 2/3 >` (directional slide).
- **Streaming**: holo rail and caret on the reply, `ThinkingIndicator` (tally ticks) before the first token, Stop replaces Send, the thread item shows the streaming dash in the sidebar.
- **Reply hit its limit**: a "Continue" action under the reply.
- **Checkpoint**: `CheckpointMarker` "Turns 1-14 condensed" in the list, expandable to read the summary; pinned messages marked.
- **Images**: `AttachmentChip` in the composer with its estimated cost; image in the user message.
- **Errors**: failed send ("Could not send", whether anything was charged, retry), provider error, deleted thread ("This thread was deleted.").
- **Long thread**: show scroll position with the scroll-to-bottom button.

### 4. Composer and cost strip
- States: empty, typing (cost strip number rolls with `variants.digit`), focused (the vivid holo shimmer edge, the signature moment), with images, streaming (Stop), disabled because the budget is paused.
- Controls: attach images, model picker (grouped by provider), effort control (1-4 rising bars, per thread, changeable per message), output mode `SegmentedControl` (quick / normal / long), send.
- `CostStrip`: `~$0.004 next · cache warm · 87% hit`. Clicking it opens the Inspector.

### 5. Reply cost breakdown
- Clicking `ReplyMetadata` opens a `Popover` with that turn's breakdown: input split into cached / written / fresh tokens with prices, output tokens (thinking "included in output, billed at the output price"), total, and the model and effort used.

### 6. Inspector
- `CacheStatus` with its draining 5-minute ring (warm -> cooling -> cold) and a note when keepalive is on.
- `ContextBar` stacked bar plus `LayerRow`s: system prompt, checkpoint summary + pinned, turns since checkpoint, next message; each with state chip (cached / to be written / fresh), tokens and price. Selecting a layer highlights its bar segment (the one holo element here).
- "This thread" totals: total spend, cache upkeep, cache hit rate, cache saved (signed), with a "Replies only" toggle.
- "Condense now" button, with its disabled reason when it would not pay off ("Condensing now would never pay for itself") and an error state ("Could not condense").

### 7. Editing an old message (cache-break flow)
- Click edit on an old user message -> inline edit in place.
- If the cost of breaking the cache is above the user's threshold, show `CacheBreakWarning` before sending: "Editing this message costs ~$0.08 more than continuing." Actions: "Edit anyway" (primary) and "Continue instead". Then the new branch appears with the `BranchSwitcher`.

### 8. Budget
- 80%: `BudgetBanner` warning above the composer, "Dismiss for today".
- 100%: "Daily budget reached." Composer paused, "Override for today" action.
- Sidebar budget meter reflects the same state (`budget-ok`, `budget-near`, `budget-paused`).

### 9. Usage
- Page title, today's budget progress, then a row of `StatTile`s: "Spent, 30 days", "Cache saved, 7 days", "Cache hit rate", "Cache upkeep" (one highlighted tile with `holo-text` on its value).
- "Daily spend" `BarChart` for 30 days stacked by model with `Legend`, bars growing in; hit-rate `LineChart` drawing in.
- "By day" and "By model" `DataTable`s with mono tabular numbers. Net savings can be negative: show it honestly with `savings-negative` and a sign.
- Empty state for a fresh install.

### 10. Providers
- List of `ProviderCard`s (name, API style Anthropic / OpenAI-compatible, base URL, key status, model count).
- "Add a provider" `ProviderForm`: name, API style, base URL, API key, "Free provider (local models): record every reply as $0". States: testing key ("Testing key..."), success, failure with a clear reason.
- Inside a provider: model list with show/hide toggle, editable display name, "accepts images" flag, refresh models ("Could not refresh the models"), replace API key.

### 11. Settings
`SettingsSection`s, each a short title, one-sentence explanation and its control:
- Side-job model (cheap model for titles and condensing)
- Cache keepalive: "Keep caches warm while I'm in a thread"
- Condensing: "Condense long threads automatically", threshold in tokens, turns kept word for word
- Cache-break confirmation: confirm above $X
- Daily budget in US dollars ("No budget" when empty)
- Time zone
- Private host allowlist: list of hosts in mono with remove, "Add host" (e.g. `192.168.1.20:11434`)
- Saved feedback with a `Toast`, inline errors ("Could not save").

### 12. Mobile (390px)
Thread view, sidebar sheet, inspector bottom sheet, composer with folded pickers, usage page. Touch targets 44px.

## Key flows to prototype (clickable, with motion)

1. First run: set password -> empty home -> add a provider (test key) -> first message -> streaming reply -> metadata appears.
2. Send while watching the cost strip roll, open the breakdown popover, then open the Inspector from the cost strip.
3. Read for a while: cache pill goes warm -> cooling -> cold (speed it up in the prototype).
4. Edit an old message -> cache-break warning -> new branch -> switch branches.
5. Hit 80% then 100% budget -> override for today.
6. Mobile: open sidebar, switch thread, open inspector sheet.

## Deliverables

1. Every screen and state above, in **light and dark**, at 1440px and 390px (plus 1024px for the thread view).
2. A clickable prototype of the six flows, using the system's motion tokens and patterns.
3. A short spec per screen: layout grid and widths, which components and tokens it uses, holo placement (checked against "Where holo goes"), motion used per interaction, empty / loading / error states, and keyboard behavior and shortcuts.
4. A list of any components or tokens you had to add, proposed as additions to the design system.

## Constraints

- Implementation target: Next.js 16, React 19, Tailwind CSS v4, Base UI, Tabler Icons, Motion (`motion/react`). Keep designs buildable with these.
- Copy: plain, short, sentence case, "you" voice, buttons are verbs, no emoji, no em dashes. Money `$0.0043` under one cent, `~` for estimates, signed savings. Separate metadata with ` · `.
- Accessibility: WCAG AA in both themes, visible 2px focus ring, never color or holo alone for meaning, reduced motion handled.
