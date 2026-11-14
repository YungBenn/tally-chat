# Spec: Phase 2, cache-aware prefix and keepalive

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) section 9 phase 2, S5 · Vocabulary: [GLOSSARY.md](../../GLOSSARY.md) · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md) · Builds on [phase 1](./phase-1-foundation.md)

## Problem Statement

Every turn resends the whole branch, and today none of it is cached: every reply's usage line shows `cache read 0`, so a long thread pays full input price for its entire history on every turn. The design doc puts the difference between a cached and an uncached workload at up to 60x. Even once caching is on, chat has a trap agents don't: people pause. Anthropic's default cache lives 5 minutes, so reading a long answer for six minutes means the next turn rewrites the whole prefix at 1.25x instead of reading it at 0.05x. I want tally.chat to build every request so the provider caches as much of it as possible, and to keep that cache warm while I'm actually in the thread, without me thinking about it, and without spending money keeping caches alive for threads I've walked away from.

## Solution

Requests to Anthropic are laid out by volatility and marked for caching: the system prompt and the checkpoint layer each get an explicit cache breakpoint, and automatic caching slides a third breakpoint forward over the verbatim turns each request. While I'm active in a thread (tab focused or typing), the server sends a no-output keepalive request shortly before the 5-minute cache would expire, so my next turn reads instead of rewrites. Keepalives stop 30 minutes after my last activity, run at most once per thread no matter how many tabs are open, and are metered as side jobs so their cost is never hidden. If I turn keepalive off, threads use the 1-hour cache lifetime instead. OpenAI-compatible providers cache automatically on their own terms, so their requests are unchanged and get no keepalive.

I can see it working: the usage line under each reply shows cache reads climbing turn after turn, and the thread header says whether its cache is warm, being kept alive, or cold.

## User Stories

### Caching the prefix

1. As a user, I want my system prompt cached, so that I don't pay full price for it on every turn.
2. As a user, I want the earlier turns of my branch cached, so that a long thread costs a fraction of its history per turn.
3. As a user, I want a thread's checkpoint summary and the pinned messages after it cached, so that condensed threads also read from cache.
4. As a user, I want the cached part of each request to grow with every turn, so that I only ever pay full price for what's new.
5. As a user, I want the same branch to always produce byte-identical request prefixes, so that nothing silently breaks the cache.
6. As a user, I want switching to an older branch to reuse whatever of its prefix is still cached, so that branch hopping isn't punished more than it has to be.
7. As a user of an OpenAI-compatible provider, I want my requests left as they are, so that providers that cache automatically keep doing so.
8. As a user, I want the usage line under each reply to keep showing cache reads and writes, so that I can see caching work.
9. As a user, I want short chats that are below the provider's minimum cacheable size to simply not cache, without errors or extra cost.

### Keepalive

10. As a user, I want my thread's cache kept warm while I'm reading or typing, so that pausing to read a long answer doesn't make my next turn expensive.
11. As a user, I want keepalives to stop 30 minutes after my last activity, so that a thread I walked away from doesn't keep costing money.
12. As a user, I want "active" to mean the thread is open in a focused tab or I'm typing in it, so that a background tab doesn't keep the cache alive forever.
13. As a user with the same thread open in two tabs or devices, I want only one keepalive running for it, so that I'm not billed twice.
14. As a user, I want a keepalive to never generate output, so that it only bills a cheap cache read.
15. As a user, I want a keepalive to cover the latest reply too, so that my next turn reads everything before my new message from cache.
16. As a user, I want no keepalive while a reply is streaming, so that it never competes with or duplicates a real request.
17. As a user, I want no keepalive once the cache has already expired, so that it never pays for a full cold write on my behalf.
18. As a user, I want no keepalive for threads whose provider isn't caching, so that I never pay for refreshing nothing.
19. As a user, I want every keepalive metered as a side job and included in my daily totals, so that cache upkeep is never hidden.
20. As a user, I want to turn keepalive off in Settings, so that I can choose the 1-hour cache instead.
21. As a user with keepalive off, I want threads to use the 1-hour cache lifetime from their second turn on, so that pauses up to an hour stay cheap.
22. As a user, I want a failed keepalive to stop quietly without affecting my thread, so that upkeep problems never break chatting.
23. As a user, I want keepalives to stop for a deleted thread, so that nothing runs against data that's gone.

### Seeing it

24. As a user, I want the thread header to say whether its cache is warm (and until when), being kept alive, or cold, so that I know what my next turn will cost.
25. As a user, I want the cache state to update live, so that I can watch a keepalive refresh it.

## Implementation Decisions

### Request layout (Anthropic adapter)

- The assembler's output stays as it is (ticket 09): system prompt, then the checkpoint layer (summary plus covered pinned messages) when one applies, then verbatim turns, then the new user message. Phase 2 adds where the cache breakpoints go; it does not reorder anything.
- **Breakpoint 1:** the system prompt is sent as a single text block with `cache_control`.
- **Breakpoint 2:** when a checkpoint applies, the last block of the checkpoint layer (the summary message, or the last pinned message after it) gets `cache_control`. Without a checkpoint there is no breakpoint 2.
- **Sliding breakpoint:** top-level automatic caching (`cache_control: {type: "ephemeral"}` on the request) marks the last cacheable block each request; the 20-block lookback finds the previous turn's entry because a chat turn adds only a few blocks.
- That is at most 3 of the 4 allowed breakpoints. Messages are sent as content-block arrays only where a block needs `cache_control`; everything else stays a plain string, so request bytes stay stable across turns.
- **Lifetime:** every breakpoint in one request uses the same TTL, so the longer-before-shorter ordering rule can never be violated. 5 minutes by default; 1 hour when the owner has keepalive off and the thread is past its first turn.
- No `thinking` or `effort` parameter is sent in phase 2 (effort controls are phase 4). Keepalives send exactly the same parameters as real turns, which the caching docs require for the keepalive's entry to be the one real traffic hits.
- OpenAI-compatible requests are unchanged: no `cache_control`, no keepalive.

### Keepalive

- **Presence:** a public mutation records that the owner is active in a thread (`lastActiveAt` on the thread). The thread page calls it when the tab gains focus, while typing, and at most once a minute while the tab stays focused and visible. Presence lives on the thread document, so no new table.
- **Cache touch:** each request that touches the cache (a real reply or a keepalive) records `cacheTouchedAt` on the thread as the request's start time, since the cache lifetime counts from the start of the request.
- **Scheduling:** after a reply finalizes, or after a keepalive, one keepalive job is scheduled for `cacheTouchedAt + 4.5 minutes`. Its scheduled-function id is stored on the thread; a new reply cancels any pending job before scheduling its own, which also deduplicates across tabs and devices.
- **When the job fires, it sends only if all of these hold:**
  - keepalive is on for the owner
  - the thread still exists and its provider is the Anthropic API style
  - the last finished reply on the branch reported cache reads or writes (the provider is caching and the prefix is above the minimum size)
  - `lastActiveAt` is within the last 30 minutes
  - no reply is streaming in the thread
  - the cache is still warm (`cacheTouchedAt` within 5 minutes), so a keepalive never pays for a cold write
- **The request:** the same system prompt and the same assembled branch the next turn would send, up to and including the latest reply, with an explicit breakpoint on its last block. `max_tokens: 0`, `stream: false`, through the URL guard like every other provider call. `max_tokens: 0` is rejected with streaming, structured outputs, forced tool choice, Batches, and thinking type `enabled`; none apply here.
- **Metering:** each keepalive is recorded in `sideJobs` with kind `keepalive` and metered through the same path as replies and titles, so it lands in the daily rollups.
- **Failure:** a failed keepalive records any usage that arrived, schedules nothing further, and changes nothing else. The next reply restarts the cycle.
- **Off switch:** `keepaliveEnabled` in settings, default on, with a toggle in Settings. Turning it off cancels pending jobs on their next firing (the job checks the setting).
- Deleting a thread needs no extra work: the job finds the thread gone and stops. The purge also removes `sideJobs` rows of kind `keepalive`.

### Cache status

- `getThread` returns the thread's cache state: `cold` (never touched, or `cacheTouchedAt` older than its lifetime), `warm` with the time it expires, or `keepalive` when warm and a keepalive is scheduled and the owner is active. The thread header shows it as plain text; the designed chip (U11) is phase 3.

### Schema changes

```
threads:   + lastActiveAt?, cacheTouchedAt?, cacheTtl? ("5m" | "1h"), keepaliveJobId?
settings:  + keepaliveEnabled?          // absent = on
sideJobs:  kind: "title" | "keepalive"
```

## Testing Decisions

- Same rule as phase 1: tests exercise public Convex functions and assert on what the provider or the user observes. No unit tests of the adapter's request builder or the keepalive scheduler internals.
- **Seam 1 (reused):** `convex-test` with the fake provider at the HTTP boundary, asserting on captured request bodies. Time is driven with Vitest fake timers through `convex-test`'s scheduler, as the stop, delete and sweeper tests already do. Activity comes through the public presence mutation.
- **Must-have cases**
  - Requests carry `cache_control` on the system prompt, on the checkpoint layer only when a checkpoint applies, and top-level automatic caching; never more than 4 breakpoints.
  - Two consecutive turns produce request prefixes where the second starts with the first's bytes (plus the reply).
  - All breakpoints in a request share one TTL; with keepalive off, the second turn onward uses `1h`.
  - OpenAI-compatible requests contain no `cache_control`.
  - With the owner active, a keepalive fires about 4.5 minutes after a reply, with `max_tokens: 0`, `stream: false`, the latest reply included, and the same system prompt and parameters as a real turn; then again 4.5 minutes later.
  - No keepalive when the owner was last active over 30 minutes ago, when keepalive is off, when a reply is streaming, when the cache already expired, when the provider reported no caching, or for an OpenAI-compatible provider.
  - Two tabs marking activity produce one keepalive per window, not two.
  - A new reply cancels the pending keepalive and schedules a fresh one.
  - Keepalives are recorded as `sideJobs` of kind `keepalive` and their usage appears in the rollups.
  - A failed keepalive leaves the thread and its next turn unaffected.
  - `getThread` reports `cold`, `warm` and `keepalive` correctly as time passes.
- **Prior art:** `chat.test.ts` (request-body assertions), `context.test.ts` (seeded branches and checkpoints), `deleteThread.test.ts` and `sweeper.test.ts` (fake time and scheduled work), `titles.test.ts` (side-job metering).

## Out of Scope

- The inspector, cost strip, cache-break hints, designed cache status chip and `/usage` page (phase 3)
- Effort and thinking controls, including per-turn effort (phase 4)
- The condenser and the cache veto on condensing (phase 6); phase 2 only places the checkpoint-layer breakpoint
- Pre-send cost estimates and token counting
- Keepalive or explicit caching for OpenAI-compatible and Gemini providers
- Cache diagnostics (the beta `diagnostics` field) and thinking-block replay

## Further Notes

- **Prices that make keepalive worth it** (5.5 models): a keepalive reads the prefix at 0.05x on Opus and Sonnet 5.5, 0.1x on Haiku 5.5, 0.025x on Fable 5.1. Thirty idle minutes cost at most six reads (0.3x on Sonnet), against a 1.25x rewrite on return or a 2x write for the 1-hour lifetime.
- **Thinking blocks:** Opus and Sonnet 5.5 think adaptively by default and return (empty, omitted-display) thinking blocks that tally.chat does not store or replay. Requests stay consistent because they never include them. Whether omitting them interacts with preserved-thinking enforcement on new accounts should be checked against a real key during this phase; if it does, replaying them is a separate ticket.
- **Verification with a real key:** the fake provider can't prove the cache is hit. Before closing the phase, run a real multi-turn Anthropic thread and confirm `cache read` grows each turn and stays warm across a 6-minute pause with the tab focused.
- The 1-hour rule ("from the second turn on") and the 4.5-minute keepalive interval are deliberately simple starting points; tune them from the cache hit rate once phase 3 shows it.
- **No prefill on 5.5 models (found 2026-11-15, through 9router):** a keepalive that ends on the latest reply is rejected with `400 invalid_request_error: This model does not support assistant message prefill. The conversation must end with a user message.` Keepalives therefore keep the explicit breakpoint on the latest reply (so the cached prefix is exactly what the next turn shares) and append a one-character user message, `"."`, after it. With `max_tokens: 0` nothing is generated; the extra message is a token or two of uncached input.
- **Through 9router (Claude Code backend):** replies read the cache turn over turn (4,161 tokens on turn 2) and a keepalive read 4,262 and wrote 42. 9router adds its own 1-hour breakpoint (a reply reported `cache write 3,594 / 567` for 5m / 1h), ends Anthropic streams with an OpenAI-style `data: [DONE]` line (now ignored), and the non-streamed keepalive reported 2,004 uncached input tokens that tally's request doesn't account for. Check that last one against the real API in ticket 06.

