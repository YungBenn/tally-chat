# Spec: Phase 1, foundation

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) section 9, phase 1 · Vocabulary: [GLOSSARY.md](../../GLOSSARY.md) · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md)

## Problem Statement

I want a chat app that runs on my own server, uses my own provider keys, and tells me exactly what every message cost. Today, every multi-provider chat app either hides what was sent and billed, or records it too loosely to answer "why did this thread cost $0.40?". Before tally.chat can save me money (cache-aware history, the inspector, condensing), it must first hold my conversations in a shape that never loses or rewrites history, call my providers safely, and record every token a provider bills me for, split the way providers actually bill. If any of that is wrong at the start, every later feature is built on bad data, and some of it (the message tree, the metering dimensions, key handling) cannot be fixed later without migrating everything.

## Solution

A working single-user tally.chat instance, self-hostable with Docker, where I can:

- Set one password and log in; nobody else can spend my keys.
- Add Anthropic and OpenAI-compatible providers with a base URL and key; the key is tested, encrypted, and never shown again.
- Start a thread, send messages, and watch replies stream in, resumable if I close the tab.
- Retry a reply or fork from an earlier message without losing anything; every message is kept, and only the active branch is sent to the model.
- See, for every assistant message, the model, provider, uncached input, cache read, cache write, output and reasoning tokens, and the dollar cost, with daily totals per model, provider and thread.

The chat surface in this phase is functional, not designed; the visual design waits for the prototype decision (design doc section 12).

## User Stories

### Access

1. As the instance owner, I want to set a password on first run, so that nobody else can use my instance or my keys.
2. As the instance owner, I want the password setup to be impossible to repeat once done, so that a stranger reaching a fresh-looking page cannot claim my instance.
3. As the instance owner, I want to log in and stay logged in on my devices, so that I don't retype the password every visit.
4. As the instance owner, I want to log out, so that a shared computer doesn't keep my session.
5. As the instance owner, I want every record to belong to me as owner, so that adding more users later is a feature rather than a migration.

### Providers and keys

6. As the instance owner, I want to add a provider by name, API style, base URL and key, so that I can use any Anthropic or OpenAI-compatible endpoint.
7. As the instance owner, I want my key tested with one cheap call when I save it, so that I find a bad key now rather than mid-conversation.
8. As the instance owner, I want to see which provider a key belongs to without ever seeing the key again, so that I can tell my providers apart safely.
9. As the instance owner, I want keys encrypted at rest with a master key that is not in the database, so that a database leak does not leak my keys.
10. As the instance owner, I want keys never sent back to the browser or written to logs, so that they cannot leak through the client or log files.
11. As the instance owner, I want to replace or delete a provider's key, so that I can rotate keys.
12. As the instance owner, I want the provider's model list pulled automatically and editable by me, so that I can pick models without typing ids, and hide ones I don't use.
13. As the instance owner, I want to be told that a ChatGPT Plus or Claude Pro subscription is not an API key, so that I don't waste time pasting the wrong thing.
14. As the instance owner, I want the server to refuse provider URLs that point at private, loopback, link-local or cloud-metadata addresses by default, so that a typed URL can't be used to reach my internal network.
15. As the instance owner, I want plain http refused by default, so that keys don't travel unencrypted.
16. As the instance owner, I want redirects re-checked against the same rules, so that a public URL can't redirect into my network.
17. As a self-hoster, I want to allowlist specific private hosts (for example my Ollama box), so that I can use local models on purpose.
18. As the instance owner, I want local models priced at $0 and custom endpoints priced by me, so that my cost totals stay honest.
19. As the instance owner, I want each provider's capabilities (caching, reasoning, vision) recorded from what its responses actually report, so that the app never assumes a provider caches when it doesn't.

### Threads and messages

20. As a user, I want to start a new thread with a chosen model, so that I can begin a conversation.
21. As a user, I want to send a message and see the reply stream in, so that I don't wait for the full answer.
22. As a user, I want a reply that was streaming to still be there when I reopen the tab, so that closing the tab doesn't lose the answer or the money spent on it.
23. As a user, I want my threads synced across my devices, so that I can continue on my phone.
24. As a user, I want to retry a reply and keep the old one, so that I can compare and go back.
25. As a user, I want to send a new message from an earlier point in the thread, so that a bad answer stops riding along in every later request.
26. As a user, I want editing a past message to create a new version rather than overwrite the old one, so that nothing I wrote is lost.
27. As a user, I want only the active branch sent to the model, so that abandoned answers don't cost me tokens.
28. As a user, I want to switch which branch is active, so that I can return to an earlier version of the conversation.
29. As a user, I want to delete a whole thread for real, so that private conversations are gone when I say so.
30. As a user, I want my spend history to still include deleted threads, so that my daily totals stay accurate.
31. As a user, I want a thread title generated on my side-job model, so that titles don't cost main-model prices.
32. As a user, I want a failed or cancelled request to keep what was streamed and record whatever usage the provider reported, so that partial spend isn't invisible.
33. As a user, I want to stop a reply mid-stream, so that I don't pay for an answer I don't want.

### Metering

34. As a user, I want every assistant message to record uncached input, cache read, cache write, output and reasoning tokens separately, so that I can see where the cost came from.
35. As a user, I want every assistant message to record its dollar cost, so that I know what each turn cost me.
36. As a user, I want cost computed from a price table that includes cache read and both cache write prices, so that cached turns are priced correctly.
37. As a user of OpenRouter, I want the cost OpenRouter reports used as-is, so that my numbers match OpenRouter's bill.
38. As a user, I want daily totals per model, per provider and per thread, so that I can see where my money goes.
39. As a user, I want usage from different providers reported in one consistent shape, so that totals across providers add up.
40. As a user, I want side-job spend (titles) metered too, so that nothing costs money invisibly.
41. As a maintainer, I want the price table synced from an open source rather than typed by hand, so that prices stay current with little effort.
42. As a maintainer, I want a small local override file for prices, so that I can correct or add a model the upstream table lacks.
43. As a future developer of the cache features, I want the system prompt stored with a version on each thread and sent byte-identical across turns, so that phase 2 caching has a stable prefix to build on.

### Self-hosting

44. As a self-hoster, I want the backend to run from a Docker Compose setup, so that I can run tally.chat on my own machine.
45. As the maintainer, I want a one-day spike proving Convex self-hosted runs streaming and rollups end to end, so that the stack choice is validated before more is built on it.

## Implementation Decisions

### Modules

- **Auth.** Single-user password login on Convex Auth. The first-run setup creates the one owner account; afterwards account creation is closed. All tables carry `ownerId`.
- **Message tree (deep module).** Owns threads, messages and checkpoints. Interface: create thread, append message under a parent, set active leaf, get active branch for a leaf, delete thread. Enforces append-only: messages are never updated after their final write, and never deleted individually. Hides how branches are walked.
- **Context assembler (deep module).** Given a thread and its active leaf, returns the ordered message list to send: system prompt at the given version, then (if a checkpoint covers part of the branch) the latest checkpoint's summary followed by pinned messages it covers in original order, then verbatim messages after it. Phase 1 emits no cache breakpoints; it only guarantees byte-stable output for an unchanged branch.
- **Provider layer (deep module).** Interface: send(provider, model, messages, options) returning a token stream and, at the end, one normalized usage record; listModels(provider); testKey(provider). Two adapters:
  - **anthropic**: written by hand against the raw Messages API (ADR-level reason: phase 2 caching, compaction and the per-turn effort beta all live here).
  - **openai-compatible**: built on the Vercel AI SDK, reading cache write tokens and OpenRouter's `cost` from the raw usage because the SDK leaves cache writes undefined.
- **Outbound URL guard.** Every provider request goes through it: https only by default, DNS resolved and checked against private, loopback, link-local and metadata ranges, redirects followed manually and re-checked, allowlisted private hosts bypass the range check. Resolution goes through an injectable resolver.
- **Key vault.** Encrypts and decrypts provider keys with a master key from an environment variable (authenticated encryption). Decryption happens only inside the action that calls the provider. No query or mutation returns key material; the client sees only provider name, base URL, API style and key status.
- **Pricing.** A sync script vendors LiteLLM's MIT-licensed model price file into the repo; a local overrides file wins over it. Lookup by provider and model returns base input, output, cache read, 5-minute write and 1-hour write prices. Unknown model: cost recorded as unknown, never guessed.
- **Metering.** Writes normalized usage and cost onto the assistant message and updates rollups through `@convex-dev/aggregate` in the same mutation.
- **Streaming.** `persistent-text-streaming` component; the action flushes buffered chunks roughly every 100 ms, never per token.

### Schema shape (irreversible, settle as written)

```
threads:      ownerId, title, activeLeafId, modelId, providerId,
              systemPromptVersion, effort, createdAt
messages:     ownerId, threadId, parentId, ancestorIds,
              role (user | assistant | system), pinned, content,
              status (streaming | done | stopped | error),
              model, providerId, usage?, costMicroUsd?, isSideJob, createdAt
checkpoints:  ownerId, threadId, coversUpToId, summary, tokens, createdAt
providers:    ownerId, name, apiStyle (anthropic | openai-compatible),
              baseUrl, apiKeyEncrypted, models[], capabilities, createdAt
settings:     ownerId, sideJobModelId, allowlistedHosts[],
              dailySoftBudgetUsd, keepaliveEnabled
usage (normalized): inputTokens (uncached), cacheReadTokens,
              cacheWriteTokens5m, cacheWriteTokens1h, outputTokens,
              reasoningTokens
```

- `ancestorIds` is denormalized on every message so building a branch is one read, not N. Chats stay far below document size limits at realistic lengths.
- Cost is stored as integer micro-dollars so rollups never accumulate float error.
- `inputTokens` always means uncached input. Adapters subtract cached tokens where a provider's prompt count includes them (OpenAI-style), and pass through where it excludes them (Anthropic).
- Cache writes are split by lifetime because they are priced differently (1.25x vs 2x on Anthropic).
- A message moves from `streaming` to a final status exactly once; content is immutable after that. This is the only permitted update.
- Rollup namespaces: owner, then day, then one of model, provider, thread. Summed fields: every usage field plus cost.
- Thread delete removes the thread's messages, checkpoints and stream data; rollup entries are kept.

### Interactions

- Send: append user message, insert an assistant message with status `streaming`, schedule the provider action, return immediately. The action assembles context, calls the adapter, flushes chunks, then writes final status, usage and cost in one mutation.
- Retry: a new assistant message with the same parent user message. Edit: a new user message with the same parent as the edited one. Both set the active leaf.
- Stop: marks the stream as cancelled; the action aborts the provider call and records any usage it received.
- Capabilities are set from observed usage fields (for example, the first response that reports cache read tokens sets caching to confirmed).
- Title generation runs as a side job on the side-job model after the first assistant reply, metered with `isSideJob`.

## Testing Decisions

- **Good tests here exercise external behaviour only**: call a public Convex function, then assert on what a user or the provider would observe (stored messages, active branch, usage and cost, rollup totals, what the provider received, what the client can read). No test reaches into adapter internals or the assembler directly.
- **Seam 1: Convex public functions with a fake provider at the HTTP boundary.** Tests use `convex-test` and replace outbound fetch with a fake that replays recorded Anthropic and OpenAI-compatible responses (including streamed, cached, reasoning, error and OpenRouter-with-cost cases) and captures each request body. This covers the tree, branching, retry and edit, thread delete, the assembler (including a seeded checkpoint and pinned messages), usage normalization per provider, cost from the price table, OpenRouter cost passthrough, rollups, key encryption, and that no client-facing query returns key material.
- **Seam 2: injected DNS resolver in the URL guard.** Covers private, loopback, link-local, metadata, IPv6 and IPv4-mapped addresses, allowlisted hosts, http refusal, and a public URL redirecting into a private range.
- **Must-have cases**
  - "Render turn 40 of a thread condensed twice and forked once" returns the right ordered context (the design doc's schema test, section 8.1).
  - The same branch assembled twice yields byte-identical system and message content.
  - An abandoned branch never appears in any provider request.
  - A request through each adapter produces the same normalized usage shape for equivalent inputs.
  - Rollup totals equal the sum of their messages after sends, side jobs and a thread delete.
- **Prior art**: none yet, greenfield repo. Follow the `convex-test` documentation patterns.

## Out of Scope

- Cache breakpoints, automatic caching, 1-hour lifetime and keepalive (phase 2, S5)
- Inspector, cost strip, `/usage` page, cache status chip and all visual design (phase 3 and section 12; awaiting the prototype decision)
- Soft budget enforcement (phase 3, alongside its UI)
- Fork and edit UI affordances, branch switcher, effort controls, output modes, images, title search, PWA (phase 4); the data model supports fork and edit now
- Docker Compose packaging and setup guide for end users (phase 5); phase 1 only runs the spike
- Condenser and compaction (phase 6); phase 1 only stores and reads checkpoints
- Gemini adapter, documents, import, full-text search, tools, model suggestion and cheaper-reply (phase 7)
- Multi-user accounts and a public instance

## Further Notes

- `ancestorIds`, split cache-write lifetimes and integer micro-dollar cost were confirmed by the owner and folded into the design doc (S1, S10, 8.1, 8.2).
- DNS rebinding: if the action runtime cannot pin a connection to the validated address, there is a window between check and connect. Note it in the self-hosting guide; private-host allowlisting is the owner's explicit opt-in anyway.
- The Convex self-host spike should record findings (setup steps, component compatibility, anything that broke) as a short note in `docs/`, and raise an ADR change if it contradicts ADR 0002.
- Price-table sync source and override rules are in the design doc, section 10.
