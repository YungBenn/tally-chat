# Spec: Phase 3, inspector, cost strip and usage

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) section 9 phase 3, S9, S10 and section 12 · Vocabulary: [GLOSSARY.md](../../GLOSSARY.md) · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md) · Builds on [phase 1](./phase-1-foundation.md) and [phase 2](./phase-2-cache-aware-prefix.md)

## Problem Statement

Phase 2 made long threads cheap, but I can barely see it. Each reply carries a raw line of token counts, and the header shows a plain-text cache status. I can't tell what is actually in my thread's context window, which part of it is read from cache and which part I'm paying full price for, what my next message will cost before I send it, how much keeping caches warm costs me, or whether caching is saving money at all once write premiums and keepalives are counted. Nothing warns me before I do something that throws the cache away, like editing an early message in a long thread. And I have no place to look at my spending over days, by model, or against a limit I've set for myself, nor any way to stop a runaway day.

## Solution

Every thread gets an inspector: a panel beside the chat (a bottom sheet on a phone) that lists the context window layer by layer (system prompt, checkpoint summary, the turns since, my next message), marks each as cached, about to be written, or fresh, and prices them. It also shows the thread's total spend, its cache upkeep, its cache hit rate, its reasoning tokens and the net money caching saved, which is allowed to go negative. Under the composer, a one-line cost strip shows what my next send will roughly cost while I type, the cache status and the hit rate; clicking it opens the inspector. Each reply's metadata line becomes readable (model, cost, input with its cached share, output, reasoning) and opens that turn in the inspector. The header's cache status becomes a chip with a live countdown. Editing a past message tells me beforehand what the cache break will cost, and asks for confirmation when that's more than I've said I'm comfortable with.

A `/usage` page shows the last 30 days: daily spend, spend per model, cache hit rate over time, keepalive spend and net savings. I can set a soft daily budget: a banner warns me at 80%, and at 100% sending stops until tomorrow unless I override it for the day, while keepalives and side jobs pause on their own.

## User Stories

### The inspector

1. As a user, I want a panel that shows what is in my thread's context window, so that I understand what each turn actually sends.
2. As a user, I want the context window broken into layers (system prompt, checkpoint summary with the pinned messages it covers, the turns since, my next message), so that I can see where the tokens are.
3. As a user, I want each layer's token count, so that I can see which part of the thread is large.
4. As a user, I want each layer marked as cached, to be written, or fresh, so that I know what my next send reads cheaply and what it pays full price for.
5. As a user, I want counts that came from the provider's usage shown plainly and counts that are estimates marked with `~`, so that I know which numbers to trust.
6. As a user, I want the inspector to show the thread's total spend including side jobs and keepalives, so that a thread's real cost is in one place.
7. As a user, I want the thread's cache upkeep (keepalive spend) on its own line, so that I can see what keeping the cache warm costs.
8. As a user, I want the thread's cache hit rate, so that I can see whether caching is working for this thread.
9. As a user, I want the thread's total reasoning tokens, so that I notice thinking I'm paying for.
10. As a user, I want the net money caching saved in this thread (read discount minus write premium minus upkeep), shown even when negative, so that I can see whether caching pays off.
11. As a user, I want the inspector closed by default and remembered open or closed on this device, so that the chat stays calm unless I want the numbers.
12. As a keyboard user, I want `⌘I` to toggle the inspector, so that I can open it without the mouse.
13. As a phone user, I want the inspector as a bottom sheet opened from the cost strip, so that it works on a small screen.
14. As a user of an OpenAI-compatible provider, I want the inspector to say the provider caches on its own and show what it reported, so that I'm not shown breakpoints that don't exist.
15. As a user of a model with no price, I want costs shown as unknown rather than guessed, so that the numbers never lie.
16. As a user of a free provider, I want costs shown as $0, so that local models don't look expensive.

### One turn in the inspector

17. As a user, I want to click a reply's metadata line and see that turn in the inspector, so that I can study one expensive reply.
18. As a user, I want that turn's breakdown (uncached input, cache read, cache write 5m and 1h, output, reasoning, cost, what caching saved on it), so that I can see exactly where its cost came from.

### Metadata line

19. As a user, I want each reply's metadata line to read like `Sonnet 5.5 · $0.0043 · 12.4k in (87% cached) · 340 out · 1.4k reasoning`, so that I can scan cost at a glance.
20. As a user, I want the line always visible and muted, so that it informs without competing with the answer.
21. As a user, I want a streaming reply's line to show only a live output count, never an estimated cost, so that I'm not shown numbers that will change.
22. As a user, I want the model's display name in the line, so that it reads naturally.

### Cost strip

23. As a user, I want a one-line cost strip under the composer showing roughly what my next send will cost, the cache status and the hit rate, so that I know before I send.
24. As a user, I want the estimate to update while I type, so that a long paste shows its cost before I send it.
25. As a user, I want the estimate prefixed with `~`, so that I know it is an estimate.
26. As a user, I want the estimate to price the history as a cache read when the cache is warm and as a cache write when it is cold, so that it reflects what the provider will charge.
27. As a user, I want the estimate to include a typical reply's output cost for this thread, so that it approximates the whole turn, not only the input.
28. As a user, I want to click the cost strip to open the inspector, so that the detail is one click away.
29. As a user starting a new thread, I want the strip to show what the first message costs, so that the empty state is useful too.

### Cache status chip

30. As a user, I want the header's cache status as a chip saying warm, kept alive or cold, so that I see it at a glance.
31. As a user, I want the warm chip's tooltip to count down to expiry, so that I know how long I have.
32. As a user, I want the kept-alive chip to pulse subtly, so that I can see upkeep is running.
33. As a user, I want the chip to pair color with a label, so that it works without color vision.
34. As a user, I want clicking the chip to open the inspector at its cache line, so that I can see why it is in that state.

### Cache-break hints

35. As a user, I want the Edit action on a past message to show "breaks cache · +$0.04" before I edit, so that I know what forking there costs compared with continuing.
36. As a user, I want a confirmation only when that extra cost is above my threshold, so that cheap edits stay frictionless.
37. As a user, I want to set that threshold in Settings (default $0.10), so that I decide what counts as expensive.
38. As a user, I want no hint where editing doesn't break anything (a short thread below the cacheable minimum, a cold cache), so that hints stay meaningful.

### Usage page

39. As a user, I want a `/usage` page with my daily spend for the last 30 days, so that I see my trend.
40. As a user, I want spend broken down by model, so that I know which models cost me most.
41. As a user, I want my cache hit rate per day, so that I can see whether caching keeps working over time.
42. As a user, I want keepalive spend per day, so that I can check upkeep pays for itself.
43. As a user, I want net caching savings for the last 7 and 30 days, allowed to go negative, so that I know whether caching is worth it overall.
44. As a user, I want days counted in my own time zone, so that "today" means my today.
45. As a user, I want spend from deleted threads still counted, so that deleting a thread never hides money I spent.
46. As a user, I want unpriced calls counted separately, so that I know the total is a lower bound when it is.

### Soft budget

47. As a user, I want to set a daily budget in Settings, or none, so that I can cap a runaway day.
48. As a user, I want a dismissible banner at 80% of the day's budget, so that I can slow down in time.
49. As a user, I want sending, retrying and editing blocked at 100%, so that I can't overspend by accident.
50. As a user, I want an "override for today" button when blocked, so that I can keep going when I decide it's worth it.
51. As a user, I want keepalives and side jobs to pause silently while I'm over budget and haven't overridden, so that background work never pushes me further.
52. As a user, I want today's budget progress on the usage page, so that I can see where I stand.
53. As a user, I want the budget to reset at midnight in my time zone, so that it matches my day.

## Implementation Decisions

### Layout and look

- Prototype variant A, as section 12 describes: cost strip under the composer, a metadata line under each reply, the inspector as a collapsible right rail on desktop and a bottom sheet on phones. Styling follows the current LibreChat-style UI and Wensity tokens; the cost layer (metadata lines, cost strip, inspector, chip) is dense and monospace with tabular numerals, the conversation stays calm.
- Money follows section 12: USD, per-turn amounts at 4 significant digits, totals of $1 or more at 2 decimals. Token counts abbreviate above 1,000 (`12.4k`).

### Inspector query (deep module)

One public, owner-only query takes a thread and returns everything the inspector, the cost strip and the edit hints display, priced, so the client only formats. Queries can't read the clock (as in phase 2), so it returns times (cache expiry, last activity) and the client judges warm, kept alive or cold with the existing cache status helper.

- **Layers for the next send on the active branch**, in request order:
  - **System prompt:** tokens estimated from its text (characters ÷ 4), marked estimated.
  - **Checkpoint layer** (only when a checkpoint applies): the checkpoint's stored token count plus the covered pinned messages (estimated).
  - **Turns since the checkpoint:** measured from usage. The latest reply's request size (uncached input + cache read + both cache writes) plus that reply's visible output (output minus reasoning, since thinking is not replayed) is the size of everything the next send repeats; subtract the system prompt and checkpoint layer. Falls back to an estimate when the branch has no reply with usage yet.
  - **Next message:** the client adds the draft's estimate (characters ÷ 4).
- **Layer states:** with an Anthropic-style provider and a warm cache, every layer up to the latest reply is `cached`; with a cold cache, they are `written` at the thread's lifetime (5m or 1h); the next message is `fresh`. With an OpenAI-compatible provider, the state is `provider` (caches on its own) and the latest reply's reported cache read is shown instead.
- **Next-send estimate parts:** the repeated prefix's tokens and its per-token price (cache read price when warm, cache write price for the thread's lifetime when cold), the input price for the draft, and an expected output cost (mean output of the branch's last 5 replies at the output price). Free providers price at 0; a model missing from the price table returns no price and the UI says cost unknown.
- **Thread figures:** total spend (every call metered against the thread: replies, title, keepalives), cache upkeep (keepalive spend), cache hit rate over replies (cache read ÷ (uncached input + cache read + cache writes)), reasoning tokens, and net cache savings. All come from the daily rollups (below), summed across the thread's days.
- **Edit hint per user message on the branch:** the estimated extra cost of editing that message instead of continuing. The estimate assumes only the explicit-breakpoint layers (system prompt and checkpoint layer) are still cached, since older cache entries expire, so everything from the end of those layers to the edited message is priced as a cache write and compared with the next send's estimate. No hint when the result is under one cent, the cache is cold, or the branch is below the minimum cacheable size.

### Rollups (extends phase 1 metering)

- **New dimension `upkeep`**, keyed by thread, written only by keepalives, alongside their model, provider and thread rows. Daily keepalive spend and per-thread upkeep both read from it.
- **New field `savedMicroUsd`** on every rollup row: per call, cache read tokens × (input price − read price) − 5m writes × (5m write price − input price) − 1h writes × (1h write price − input price). Zero for free providers and for models without a price. Upkeep is subtracted at display time, not stored, so a row's savings stay what that call's caching did.
- **New index** on owner, dimension, key and day, so a thread's rows across all its days are one bounded read.
- **Backfill, run once:** create `upkeep` rows from existing keepalive side jobs and fill `savedMicroUsd` from existing replies and side jobs. Days use each call's creation time in the owner's current time zone; that is the only approximation, and these rows are from phase 2's few days of use.
- Thread delete keeps every rollup row, as today; upkeep rows survive too.

### Metadata line, cost strip, chip and hints (UI)

- **Metadata line:** model display name (from the provider's model list), cost, total input with cached share, output, reasoning. While streaming, only a live output count (`~` estimated from the streamed text). Clicking it opens the inspector on that turn, which shows the reply's stored usage and cost and what caching saved on it.
- **Cost strip:** `~$0.004 next · cache warm · 87% hit`. The draft estimate is debounced; the provider's token counting endpoint is never called. On a new thread with no history, it prices the system prompt and draft as fresh input.
- **Cache status chip:** replaces phase 2's plain text. Warm (tooltip counting down to expiry), kept alive (subtle pulse, respecting reduced motion) or cold, always with a label; clicking opens the inspector at its cache line.
- **Edit hint:** the inspector's per-message edit cost appears beside Edit as `breaks cache · +$0.04`. Above the owner's threshold, starting the edit asks for confirmation once; below it, nothing blocks.
- **Keyboard:** `⌘I` (Ctrl+I elsewhere) toggles the inspector.

### Usage page

- One public, owner-only query takes a day range (the client passes today in the owner's time zone, since queries can't read the clock) and returns per-day rows for the last 30 days: spend, unpriced calls, cache hit rate (excluding keepalive reads, which would inflate it), keepalive spend, savings; plus per-model totals for the range and today's budget state.
- Charts are plain CSS bars; no chart library.

### Soft budget

- Settings gain `dailyBudgetMicroUsd` (absent means no budget), `budgetOverrideDay` (the owner's day the override applies to) and `cacheBreakConfirmMicroUsd` (absent means $0.10).
- Today's spend is the sum of today's rollup rows for one dimension (provider), in the owner's time zone.
- **Enforcement is server-side**, in the send, retry and edit mutations: at or over budget and not overridden for today, they refuse with a message the composer shows next to an "override for today" action. Keepalive and title jobs check the same condition and skip silently.
- The 80% banner is client-side and dismissible for the rest of the day.
- Unpriced calls add $0 to today's spend; the usage page says the total is a lower bound when there are any.

### Schema changes

```
dailyUsage:  dimension: + "upkeep";  + savedMicroUsd
             + index by owner, dimension, key, day
settings:    + dailyBudgetMicroUsd?, budgetOverrideDay?, cacheBreakConfirmMicroUsd?
```

## Testing Decisions

- Same rule as phases 1 and 2: tests exercise public Convex functions and assert on what the user or the provider observes. No unit tests of the inspector's arithmetic helpers or the rollup internals.
- **One seam (reused):** `convex-test` with the fake provider at the HTTP boundary and fake timers, as in `chat.test.ts`, `caching.test.ts` and `keepalive.test.ts`. Client formatting and layout are checked in the browser, end to end, not by tests.
- **Must-have cases**
  - The inspector's layers for a thread with and without a checkpoint: measured turn sizes from seeded usage, estimated system prompt, states for warm, cold and OpenAI-compatible threads.
  - Next-send estimate parts priced at read price when warm, at the 5m or 1h write price when cold, at 0 for a free provider, and unpriced for an unknown model.
  - Thread total equals the sum of every call metered against it (replies, title, keepalives); upkeep equals its keepalives; hit rate and savings match hand-computed values for a seeded thread, including negative savings.
  - The edit hint grows with the edited message's distance from the end of the stable layers, and is absent when cold or below one cent.
  - Rollups: a keepalive writes an upkeep row; `savedMicroUsd` sums per day match their calls; thread delete leaves them all.
  - The backfill produces the same rows as metering would have for seeded phase 2 data, and running it twice changes nothing.
  - The usage query's 30-day rows, per-model totals, hit rate excluding keepalive reads, and days in the owner's time zone.
  - Budget: send, retry and edit are refused at 100% and allowed after the override for today; the override expires the next day; keepalives and titles skip while over budget; unpriced calls don't count.
- **Prior art:** `caching.test.ts` (request and status assertions), `keepalive.test.ts` (fake timers, side jobs, rollups), `titles.test.ts` (side-job metering), `deleteThread.test.ts` (rollups surviving delete), `settings.test.ts`.

## Out of Scope

- The condenser and its inspector line ("next condense in ~8k tok"), condensed-history bars and the condense-now control (phase 6)
- Cache-break hints for model switches, effort changes and images, which arrive with those features (phases 4 and 7); phase 3 builds the hint mechanism and uses it for Edit
- Switching model on an existing thread, the cheaper-reply button and model suggestions (phase 7)
- The command palette (`⌘K`) and other shortcuts beyond `⌘I`
- A display currency other than USD
- Exact token counting through a provider endpoint or a bundled tokenizer
- A branch minimap in the inspector

## Further Notes

- **Why estimates are rough:** characters ÷ 4 is close for English prose and drifts for code and other languages. It is only used for the system prompt, pinned messages in a checkpoint layer, the draft and a streaming reply; everything the provider already measured is shown as measured. A bundled tokenizer is a later improvement, not a phase 3 need.
- **Keepalive accounting:** keepalive reads are real cache reads but not a measure of whether turns hit the cache, so hit rate excludes them, while savings subtract keepalive spend. Both choices follow the design doc's metrics table ("keepalive spend vs cold re-reads avoided").
- **Edit hint conservatism:** the hint assumes the worst plausible case (only the stable layers survive). It can overstate the cost of editing a recent message within the last few minutes; it never understates it.
- Per design doc section 12, a throwaway prototype of the cost layer exists (`prototypes/cost-layer-ui.html`); variant A is the one chosen here.
