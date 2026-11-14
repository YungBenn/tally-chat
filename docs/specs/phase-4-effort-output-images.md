# Spec: Phase 4, effort, output budget, images, search and install

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) section 9 phase 4, S2, S4 (images), S7, S11, section 12 · Vocabulary: [GLOSSARY.md](../../GLOSSARY.md) · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md) · Builds on [phases 1](./phase-1-foundation.md) to [3](./phase-3-inspector-and-usage.md)

## Problem Statement

I pay for reasoning I never chose. tally.chat sends no effort setting, so a 5.5 model thinks at its own default on every turn, including "thanks" and "what's 2+2". Thinking also counts toward the reply limit, and every reply is capped at a fixed 4,096 tokens, so a reply that thinks hard can stop mid-sentence with nothing to tell me why or let me continue. I can't ask for a short answer to save money or a long one when I need it. I can't show the model a screenshot or a photo. With more than a few dozen threads I can't find an old one without scrolling. And tally.chat only runs in a browser tab: I can't install it on my phone or desktop like an app.

## Solution

Each thread starts with an effort level I pick beside the model (default `low`, the cheapest that does well for chat), and on models that allow it I can raise or lower effort for any single message without losing the cache: the composer's effort control applies from that message on. On models that don't, changing effort says what it costs first. Each send has an output mode, quick, normal or long, that sets how long the reply may be; a reply that hits its limit says so and offers Continue. The system prompt for new threads asks for concise answers, since a shorter answer is cheaper now and on every later turn. I can attach images to a message on models that accept them; they are resized in the browser before upload, sent inline, priced in the inspector, and deleted with their thread. A search box above the thread list filters threads by title. And tally.chat installs as an app from the browser.

## User Stories

### Effort

1. As a user, I want to pick an effort level when I start a thread, so that I choose how hard the model thinks before I pay for it.
2. As a user, I want new threads to default to `low` effort, so that everyday chat doesn't pay for deep reasoning.
3. As a user, I want the effort levels the model accepts (`low`, `medium`, `high`, `xhigh`, `max`) and no others, so that I can't pick something that fails.
4. As a user, I want the thread's effort sent on every request in that thread, so that the cache keeps matching.
5. As a user on a model that supports per-message effort, I want to change effort for this message and the ones after it, so that a hard question gets more thought without changing the whole thread.
6. As a user, I want a per-message effort change to keep my cache, so that raising effort for one hard turn doesn't make the history expensive.
7. As a user, I want a per-message effort change to stay exactly where I made it on every later request and keepalive, so that it never silently breaks the cache or the model's earlier thinking.
8. As a user, I want to see which effort each reply ran at, so that I can connect cost to the setting.
9. As a user on a model without per-message effort, I want changing the thread's effort to warn me what the cache break costs first, so that I don't throw away a warm cache by accident.
10. As a user of an OpenAI-compatible provider, I want no effort control I can't use, so that the composer stays honest.
11. As a user, I want the inspector to show the thread's effort and the current per-message level, so that I know what the next send will use.

### Output budget

12. As a user, I want to pick quick, normal or long for a send, so that I control how long and how expensive the reply can be.
13. As a user, I want normal to be the default, so that ordinary questions get ordinary answers.
14. As a user, I want the output mode not to affect my cache, so that switching it is always free.
15. As a user, I want a reply that hit its limit to say so, so that I know it was cut off and not finished.
16. As a user, I want a Continue action on a cut-off reply, so that I can get the rest with one tap.
17. As a user, I want Continue to be an ordinary next turn, so that it's metered and branchable like any other.
18. As a user, I want new threads to use a system prompt that asks for concise answers, so that replies are cheaper now and on every later turn.
19. As a user, I want existing threads to keep their system prompt, so that their cache isn't broken by a prompt update.
20. As a user, I want the cost strip's expected output to follow the mode I picked, so that the estimate matches the send.

### Images

21. As a user, I want to attach images to a message by picking, pasting or dropping them, so that I can ask about screenshots and photos.
22. As a user, I want images resized in my browser to the largest size the model reads (2,576 px on the long edge) before upload, so that I never pay for pixels the model can't use and uploads stay small.
23. As a user, I want a preview of attached images in the composer with a way to remove them, so that I send what I meant.
24. As a user, I want images shown in the message they belong to, so that the thread reads naturally.
25. As a user, I want the attach control only on models that accept images, so that I can't send something that fails.
26. As a user of an OpenAI-compatible provider, I want to mark which models accept images, so that I can use vision models there too.
27. As a user, I want the inspector and cost strip to include images' estimated token cost, so that a big screenshot's cost is visible before I send it.
28. As a user, I want images to stay in the thread's context like any other message content, so that follow-up questions about them work.
29. As a user, I want the first image in a thread flagged if it changes what the cache can reuse, so that I'm not surprised by the next turn's cost.
30. As a user, I want deleting a thread to delete its images, so that nothing I deleted lingers in storage.
31. As a user, I want a retry or a keepalive to send the same images as the original request, so that the cache matches.

### Search

32. As a user, I want a search box above the thread list, so that I can find a thread by its title.
33. As a user, I want results as I type, so that finding a thread is quick.
34. As a user, I want to clear the search with Escape or a clear button, so that I get my full list back.
35. As a user, I want only my own threads' titles searched, never message contents, so that search stays fast and predictable.

### Install

36. As a user, I want to install tally.chat as an app from my browser, so that it opens in its own window like other apps.
37. As a phone user, I want to add tally.chat to my home screen with its own icon and name, so that it feels native.
38. As a user, I want the installed app to open at my thread list, so that I land where I work.

## Implementation Decisions

### Effort (Anthropic adapter)

- **What the API allows (checked against the current Claude API reference, November 2026):** effort is `output_config.effort` with levels `low`, `medium`, `high`, `xhigh`, `max`. Thinking cannot be fully disabled on the 5.5 models (Opus 5.5 rejects it at every level; Sonnet 5.5 only via a restricted mode; Haiku 5.5 only at `high` or below), so tally.chat sends no `thinking` parameter and controls depth through effort alone. Design doc S7's "thinking off by default" becomes "effort `low` by default".
- **Thread effort** is stored on the thread when it is created (picked beside the model, default `low`) and sent on every request in the thread, keepalives included; side jobs (titles) send `low`. Changing it later changes the top-level parameter, which invalidates the messages cache; that path exists only for models without per-message effort, behind a cache-break hint built on phase 3's edit-hint estimate.
- **Per-message effort** uses the beta `mid-conversation-output-config-2026-07-01`: a `role: "system"` message with empty content and `output_config: {effort}` placed right after the user message whose reply it should govern; the level holds until changed. Supported on Fable 5.x, Opus 5 and 5.5, Sonnet 5.5 and Haiku 5.5, kept as an allowlist of model ids in the adapter (ponytail: a list in code, upgraded when the Models API exposes the capability).
- The level chosen for a message is stored on that user message when it is created (set once, never changed, per ADR 0001). The context assembler emits the effort message after it on every request that includes it, so its bytes and position never move; the header is sent whenever any such message is present.
- The composer's effort control shows the level now in force on the branch; changing it applies to the next message sent.
- Each reply records the effort it ran at, shown in its metadata line and the turn view.
- OpenAI-compatible providers get no effort control in phase 4.

### Output budget (S11)

- Three modes set `max_tokens`: quick 2,048, normal 8,192, long 32,000 (all streamed, so large limits don't time out). Thinking counts toward the limit, which is why normal is twice today's 4,096.
- The mode is chosen per send in the composer (default normal, remembered per thread in the browser) and is not part of the request prefix, so it never touches the cache.
- The adapter surfaces the stop reason; a reply that stopped at its limit is stored as truncated and shows "cut off at the limit" with a Continue action. Continue sends a fixed user message ("Continue.") as an ordinary turn on the same branch; 5.5 models reject assistant prefill, so continuing in place isn't possible.
- **System prompt version 2** asks for concise answers by default. New threads get it; existing threads keep version 1 (design doc S5: a prompt change is a deliberate, versioned cache invalidation).
- The cost strip's expected output uses the recent replies' mean, capped at the chosen mode's limit.

### Images (S4)

- Images are stored in Convex file storage and referenced from the user message they were sent with (storage id, media type, width, height), fixed at creation.
- The browser downscales to at most 2,576 px on the long edge and re-encodes (JPEG for photos, PNG when the source is PNG) before uploading through an owner-only upload URL; accepted types are JPEG, PNG, GIF and WebP.
- The generation action loads the stored bytes and sends them as base64 image blocks before the message text: Anthropic image blocks, or the AI SDK's image parts for OpenAI-compatible providers. Retries, edits that keep images, and keepalives send the identical blocks.
- **Which models accept images:** Anthropic model lists record image support from the Models API's capabilities when the provider is added or refreshed; OpenAI-compatible models get an "accepts images" toggle on the Providers page, off by default.
- **Estimated image tokens:** width × height ÷ 750, capped at 4,784 per image (the high-resolution tier's ceiling), marked `~` like other estimates, and included in the inspector's layers and the cost strip.
- **First image hint:** the first image added to a thread shows a cache note in the composer; the exact cache effect is to be confirmed against the real API in phase 2 ticket 06's session, and the hint's wording follows what that shows.
- Thread delete removes the thread's stored images with its messages (the existing purge, extended).

### Title search

- A search index on thread titles filtered by owner; one owner-only query returns up to 20 matches. The sidebar's search box filters as you type (debounced) and Escape clears it. Message contents are never searched (design doc: full-text search waits for phase 7).

### Install (PWA)

- A web app manifest (name, short name, icons at the sizes browsers require, standalone display, start at the thread list, theme colors for light and dark) and the matching head tags for iOS. No service worker and no offline mode: install doesn't require one in current browsers, and offline chat with a remote provider isn't useful.

### Schema changes

```
threads:   + effort ("low" | "medium" | "high" | "xhigh" | "max"; absent = low)
messages:  + effort? (user messages: a per-message change made here)
           + images? [{ storageId, mediaType, width, height }] (user messages)
           + truncated? (assistant messages that stopped at max_tokens)
           + effort? (assistant messages: the level the reply ran at)
providers: models[] + vision? (accepts images)
threads:   + search index on title, filtered by ownerId
```

## Testing Decisions

- Same rule as earlier phases: tests exercise public Convex functions and assert on what the user or the provider observes, mostly the captured request bodies.
- **One seam (reused):** `convex-test` with the fake provider at the HTTP boundary. The browser checks the PWA manifest and install prompt, client-side image resizing, and the effort, mode and attach controls.
- **Must-have cases**
  - Thread effort is sent as `output_config.effort` on every request, keepalives included; new threads default to `low`.
  - A per-message effort change produces the system message right after its user message, with the beta header; later turns and keepalives repeat it byte-identically; unsupported models never get it.
  - Each output mode sends its `max_tokens`; a reply that stops at the limit is stored truncated; Continue appends an ordinary user turn.
  - New threads use system prompt version 2; existing threads keep version 1.
  - A message with images sends base64 image blocks before its text through both adapters; a retry and a keepalive send identical bytes; image messages to a model without image support are refused; thread delete removes the stored images.
  - Image token estimates appear in the inspector's layers.
  - Title search returns only the owner's matching threads, at most 20.
- **Prior art:** `caching.test.ts` and `keepalive.test.ts` (request-body and byte-stability assertions), `chat.test.ts` (streaming and stop reasons), `deleteThread.test.ts` (purge), `inspector.test.ts` (layers).

## Out of Scope

- Storing and replaying thinking blocks (pending phase 2 ticket 06's real-API check)
- Thinking display (summaries of the model's reasoning) and the `between_tools` thinking mode
- Suggesting a model or effort at thread start from the first message (phase 7 alongside model suggestion)
- Effort for OpenAI-compatible providers
- Documents and PDFs (S4, phase 7), image generation, audio and video
- Full-text message search and the command palette (phase 7)
- Offline mode and push notifications

## Further Notes

- **Why per-message effort is stored, not computed:** the beta's rules make the message part of history. Moving or removing it later invalidates the thinking blocks after it on models with preserved thinking, so it is written once, with its user message, and re-emitted in place forever.
- **Effort and the cache:** the top-level `output_config.effort` is part of what the messages cache keys on, so a thread's starting effort is fixed for it; per-message effort exists precisely to change effort without that cost.
- The 2,048 / 8,192 / 32,000 limits and the concise prompt are starting points; tune them from truncation rates and output tokens once replies carry the mode.
