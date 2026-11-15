# Spec: Phase 6, background condenser

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) S3, S5 "The core tension", S9, section 8.3 · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) (amended here for pins) · Builds on the checkpoint table and assembler from phase 1 and the checkpoint-layer breakpoint from phase 2

## Problem Statement

Long threads get expensive and eventually stop working. Every turn resends the whole branch, so a thread I've been working in for an afternoon carries tens of thousands of tokens of early turns I no longer need verbatim. On a provider without prompt caching I pay full price for all of it on every message. On any provider the thread keeps growing until it hits the model's context window and fails. And long contexts make answers worse.

The obvious fix, summarizing old turns, has a trap the design doc calls the hard part of this product: a summary rewrites the middle of the prefix, so the next request writes the whole prefix to the cache again instead of reading it. On a cached Anthropic thread, condensing at the wrong time costs more than it saves, and nothing tells me. Today tally.chat stores and applies checkpoints but never writes one, so neither the fix nor the protection exists.

## Solution

After a reply finishes, tally.chat checks whether the thread has grown past a threshold. If it has, it folds every turn except the last few into a summary, written by my side-job model, and saves it as a checkpoint. Messages are never touched: the summary stands in for the covered turns on that branch, and the thread still shows them behind a fold I can expand.

Before condensing, a cache veto does the math: what the summary and the next cache write cost, against what each later turn saves. If it wouldn't pay back soon enough, the condense waits, and the inspector says why ("condense on hold: pays back in ~20 turns"). The veto never lets a thread hit the context window: near the limit it condenses anyway.

I can pin a message so it's never folded into a summary, condense a thread on demand from the inspector (with the cost shown first), and turn condensing off or change its threshold in settings. Every condense is metered like any other side job.

## User Stories

### Condensing

1. As a user, I want a long thread condensed in the background after a reply, so that later turns send fewer tokens without me doing anything.
2. As a user, I want condensing never to delay a reply, so that the thread feels as fast as before.
3. As a user, I want the last few turns kept verbatim, so that the model still sees exactly what we just said.
4. As a user, I want a condense to fold whole turns only, so that a question is never separated from its answer.
5. As a user, I want short threads never condensed, so that small conversations stay exact.
6. As a user, I want condensing to happen rarely and in large chunks, so that the prompt cache isn't rewritten every few turns.
7. As a user, I want a second condense to fold the previous summary and the next turns into one new summary, so that only one summary ever sits in the context.
8. As a user, I want my original messages kept, so that condensing loses nothing I can't scroll back to.
9. As a user, I want a fork made before a checkpoint to be unaffected by it, so that branches stay independent.
10. As a user, I want editing a message inside the condensed range to start a branch without the summary, so that the edit sees the real history.
11. As a user, I want a condense that fails to change nothing, and to be tried again after a later reply, so that a provider hiccup never corrupts a thread.
12. As a user, I want a condense not to start while a reply is still streaming, so that the summary covers finished turns only.
13. As a user, I want at most one condense running per thread, so that two summaries never race.

### The cache veto

14. As a user, I want a condense skipped when it wouldn't pay for itself soon, so that condensing never quietly raises my bill.
15. As a user, I want the veto to account for the summary's own cost and the cache write it causes on the next request, so that the decision reflects what I'd actually pay.
16. As a user, I want the veto to know when a provider doesn't cache, so that uncached threads condense as soon as they pass the threshold.
17. As a user, I want a thread close to the model's context window condensed even when the veto would hold it, so that the thread never fails for being too long.
18. As a user, I want the veto re-checked after every reply, so that a thread that has grown enough condenses without me asking.
19. As a user on a free local model, I want condensing driven by the thresholds alone, so that long local threads still stay within the context window.

### Pinning

20. As a user, I want to pin a message, so that it's never folded into a summary.
21. As a user, I want pinned messages inside a condensed range sent verbatim right after the summary, in their original order, so that what I pinned stays exact.
22. As a user, I want pinned messages left out of the summary's input, so that their content isn't paid for twice.
23. As a user, I want to unpin a message I pinned by mistake, as long as it hasn't been condensed yet, so that pins are easy to correct.
24. As a user, I want a condensed message's pin state fixed, and the UI to say so, so that I never change the context of a summary that's already written.
25. As a user, I want pinning a message in the recent turns not to change what the next request sends, so that pinning never breaks the cache by itself.

### Seeing it

26. As a user, I want condensed turns shown behind a fold ("Turns 1-8 condensed"), so that the thread shows what the model sees.
27. As a user, I want to expand the fold and read the original turns, so that nothing is hidden for good.
28. As a user, I want to read the summary that stands in for those turns, so that I can check what the model remembers.
29. As a user, I want pinned messages from a condensed range shown outside the fold, so that I can see they're still sent verbatim.
30. As a user, I want the inspector's checkpoint layer labelled with the turns it covers ("summary of turns 1-8 + 2 pinned"), so that I know what it replaced.
31. As a user, I want the inspector to show when the next condense will happen ("next condense in ~8k tok"), so that it never surprises me.
32. As a user, I want the inspector to say when a condense is on hold and why ("pays back in ~20 turns"), so that I understand the veto.
33. As a user, I want the inspector to show a condense in progress, so that I know why the cache status is about to change.
34. As a user, I want the cache status to show cold after a condense until the new prefix is cached, so that the cost strip's estimate stays honest.
35. As a user, I want the new prefix cached right after a condense while I'm still in the thread, so that my next message reads from the cache instead of paying the write.

### Control

36. As a user, I want a "condense now" control in the inspector, so that I can condense a thread before a topic change.
37. As a user, I want "condense now" to show what it will cost first (the summary and the cache rewrite) and to ask when that's over my confirm threshold, so that it's never a surprise.
38. As a user, I want "condense now" to skip the veto and the thresholds but still keep the recent turns, so that a manual condense does what I asked without dropping the latest context.
39. As a user, I want to turn condensing off in settings, so that I can keep threads exact if I prefer.
40. As a user, I want to change the condense threshold and how many recent turns stay verbatim, so that I can tune it to how I work.

### Cost

41. As a user, I want every condense metered as a side job with its own cost, so that I see what condensing spends.
42. As a user, I want condense spend in the thread's total and on the usage page, so that the numbers still add up.
43. As a user, I want summaries written by my side-job model, so that condensing runs on the cheap model I chose.
44. As a user, I want a thread's checkpoints deleted with it, so that deleting a thread removes everything it held.

## Implementation Decisions

### One summarizer for every provider

- Every condense is a side-job summary on the owner's side-job model (the setting, or the cheapest priced model of the thread's own provider, as titles use today), whatever the thread's adapter. The design doc planned Anthropic's on-demand compaction beta for Anthropic threads because rewriting history yourself invalidates replayed thinking blocks. tally.chat stores replies as text and never replays thinking, so that reason doesn't apply, and one path keeps checkpoints provider-neutral and a thread free to change models. The design doc's S3 is updated to match.
- The summary request is non-streaming, text only, with a fixed summary prompt that is versioned like the system prompts. Its input is the previous checkpoint's summary (if any) followed by the newly folded messages as a role-labelled transcript. Pinned messages are left out, and images are replaced by a short placeholder (the side-job model may not accept images). The output is capped at a fixed summary budget.
- An empty summary, an error or a truncated summary writes no checkpoint. The thread records the failure for the inspector, and the next reply tries again.
- A successful summary inserts one checkpoint (`coversUpToId`, the summary text, its measured token count) and one side-job row of a new kind, `condense`. It's metered in the model, provider and thread rollups, not the upkeep dimension.

### When to condense

- Finalizing a reply as done schedules a condense check for its thread, off the request path. The thread holds at most one pending or running condense (a job reference on the thread, like the keepalive's), so checks never race.
- The check measures the turns layer on the active branch, the verbatim turns after the latest checkpoint, using the same token figures the inspector shows (measured where a reply reported usage, estimated otherwise).
- It condenses when all of these hold: condensing is on; the thread's context totals at least the minimum thread size (default 10k tokens); the turns layer is at least the condense threshold (default 30k tokens); there are more verbatim turns than the number kept (default 6); and the cache veto allows it.
- The fold covers whole turns from just after the latest checkpoint up to the turn before the kept ones. `coversUpToId` is the reply that ends the last folded turn. A turn whose reply is still streaming, stopped mid-way or errored is never the last folded turn.
- A condense always reads and writes against the branch that was active when it started. Since checkpoints apply only to branches that contain `coversUpToId`, a branch switch during a condense needs no special handling.

### The cache veto

- The veto estimates **payback turns**: the condense's one-off cost divided by what each later turn saves.
  - One-off cost: the summary call at the side-job model's prices (input: previous summary plus folded text; output: the expected summary, a quarter of what it reads up to the summary budget), plus, when the thread's provider caches, the next request's cache write of the new prefix (summary, pins and kept turns) minus the cache read of the old prefix it replaces.
  - Saving per turn: the tokens removed (folded tokens minus summary tokens) at the price the thread pays for them each turn: the cache-read price when the provider caches, the input price when it doesn't. Whether a provider caches comes from the capabilities learned from its usage fields.
- It holds the condense when payback exceeds the limit (default 10 turns).
- With no price for the thread's or the side-job model, or on a free provider, the veto doesn't apply and the thresholds alone decide.
- **Context-window override:** when the branch's context (checkpoint layer plus turns layer) reaches half the model's context window, condense even if the veto would hold. The price sync keeps each model's context window from the same source it reads prices from. A model without a known window gets no override.
- The condense job and the inspector compute the same plan from the same data, so the inspector's status (on hold, with the payback estimate) is always current; only a failed attempt is stored on the thread.
- The cost example that shapes the default: folding 30k tokens out of a 36k cached Sonnet 5.5 prefix, summarized by Haiku 5.5, pays back after about 7 turns; on an uncached provider it pays back in under one. Folding a single 5k turn out of a 30k cached prefix takes over 100 turns, which is why small, frequent condenses are held. The veto is what keeps condensing from raising the bill, the trap in design doc section 8.3.

### After a checkpoint lands

- The thread's cache status is reset to cold, because its prefix changed. The cost strip and inspector then price the next send as a write.
- If the owner is active in the thread, a keepalive is scheduled straight away so the new prefix is cached before the next send. It's metered as cache upkeep like any other keepalive. If the owner isn't active, nothing is sent and the next message pays the write once.

### Pinning

- Pinning sets the message's existing `pinned` flag. It's the one change a message can get after it's written besides its streaming status. ADR 0001 is amended to say so, and why it's safe: the flag affects request bytes only once a checkpoint covers the message.
- The owner can pin or unpin a message on the active branch while no checkpoint of the thread covers it. Once covered, the pin state is fixed. The assembler already emits covered pins verbatim after the summary, in order.
- Pinned messages are excluded from the summary input and from the veto's "tokens removed".

### Condense now

- The inspector's "condense now" runs the same condense, skipping the thresholds and the veto. It still keeps the configured number of recent turns, and is unavailable when there's no turn to fold.
- Before it runs, the inspector shows the estimated cost (summary plus cache rewrite) and the payback estimate. Above the owner's existing cache-break confirm threshold it asks first, the same way an expensive edit does.

### Settings

- New owner settings, all optional with defaults: condensing on or off (on), condense threshold (30k tokens), turns kept verbatim (6), minimum thread size (10k tokens), payback limit (10 turns). The settings page shows on/off, the threshold and turns kept; the other two keep their defaults until there's a reason to expose them.

### Inspector and thread UI

- The checkpoint layer is labelled with the turns it covers and its pin count ("summary of turns 1-8 + 2 pinned").
- A condense line shows one of: "next condense in ~N tok", "condense on hold: pays back in ~N turns", "condensing…", "last condense failed: <reason>", or "condensing off".
- The thread shows the covered turns behind a fold ("Turns 1-8 condensed"), with the summary and an expand control. Covered pinned messages are shown outside the fold. Each message gets a pin control on hover; covered messages show their pin state as fixed.
- Deleting a thread already removes its checkpoints. Condense side jobs follow the existing side-job deletion and rollup rules.

### Schema changes (all additive and optional)

- `sideJobs.kind` gains `condense`.
- `threads` gains the pending condense job reference and the last condense check outcome.
- `settings` gains the five condense settings.
- `checkpoints` is unchanged.
- The generated price table gains each model's context window.

## Testing Decisions

- **One seam, the existing one:** public Convex functions run under convex-test, with a fake provider at the HTTP boundary, asserting on what the provider actually received (the request bytes and cache breakpoints) and on what public queries return. Tests drive the app the way the UI does: send, finalize, run the scheduled functions, query the thread and the inspector. No test reaches into internals. A browser pass on the Docker stack covers the fold, pinning and condense-now UI.
- **Must-have checks**
  - A thread past the threshold condenses after a reply: the side-job model receives the previous summary plus the folded turns, without pinned messages, with images as placeholders; a checkpoint is written; and the next send's request carries summary, pins and the kept turns, with the checkpoint-layer breakpoint at the end of that layer.
  - A short thread, a thread under the threshold, and a thread with no more than the kept number of turns don't condense.
  - The fold ends on a whole turn and never on a streaming, stopped or errored reply.
  - A second condense rolls the previous summary into the new one, and only the newest checkpoint is applied.
  - The veto holds a condense on a cached, priced thread whose payback exceeds the limit, allows it on an uncached provider, doesn't apply on a free or unpriced model, and is overridden near the context window. The inspector shows each outcome.
  - A failed or empty summary writes no checkpoint, records the failure, and retries after the next reply.
  - Only one condense runs per thread at a time.
  - Pin and unpin work on uncovered messages and are refused on covered ones. Pinning an uncovered message doesn't change the next request's bytes.
  - A fork made before a checkpoint, and an edit inside the condensed range, send no summary.
  - Condense now runs below the threshold and despite the veto, keeps the recent turns, and its estimate is shown before it runs.
  - After a checkpoint, the cache status is cold. With the owner active, a keepalive sends the new prefix.
  - The condense side job is metered in the model, provider and thread rollups and appears in the thread total; deleting the thread removes its checkpoints.
  - Turning condensing off stops automatic condensing but not condense now.
- **Prior art:** the checkpoint and assembler tests from phase 1 (including "render turn 40 of a thread condensed twice and forked once"), the caching tests from phase 2 that assert breakpoint placement, the keepalive and title side-job tests, and the inspector tests from phase 3.

## Out of Scope

- Anthropic's on-demand compaction beta (`compact-2026-09-04`). Revisit if tally.chat ever replays thinking blocks.
- A summary-quality eval that asks the model a fact from a condensed turn (the design doc's drift check).
- Summaries that describe images (vision on the side-job model); images in a folded range become placeholders, and pinning keeps them.
- Editing or deleting a summary, or "uncondensing" a thread. Forking before the checkpoint gives an uncondensed branch.
- Per-thread condense settings.
- Condensing inside the request path, or partial-turn folds.
- Documents and tool results (phase 7).

## Further Notes

- This phase changes the design doc in one place: S3's Anthropic path becomes the shared side-job path, for the reason above. The design doc and ADR 0001 (the pin amendment) are updated with the implementation.
- The veto turns the design doc's rule "let cache hit rate veto a condense" into a price calculation. That makes it testable, explainable in the inspector, and correct for providers without caching. The defaults (30k threshold, 6 turns kept, 10k minimum, 10-turn payback) are starting points to tune from the usage page's cache metrics.
- Condensing trades exactness for cost and context room. The fold, the readable summary, pins and the off switch are what keep that trade visible and reversible.
