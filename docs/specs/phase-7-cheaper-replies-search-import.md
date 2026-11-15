# Spec: Phase 7, cheaper replies, full-text search and import

Status: ready-for-agent · Source: [design doc](../tallychat-design-doc.md) S6, section 9 phase 7, section 10 ("full-text message search", the T3 Chat postmortem) · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md)

## Problem Statement

Three gaps remain in everyday use.

**Paying top price for easy turns.** A thread runs on one model, so a quick "what's the capital of Peru?" in an Opus thread is billed at Opus prices. The design doc rules out automatic routing because a silent switch throws away the cache and the user's control, but I still have no easy way to pick a cheaper model for one turn, and no way to see what that would actually cost once cache warmth is counted. And when I start a new thread with a short question, nothing tells me a cheaper model would do, even though a new thread has no cache to lose.

**Finding what I said.** Search only matches thread titles. A title is six words; the thing I'm looking for ("that regex for parsing dates") is in a message.

**My history is somewhere else.** Years of conversations live in ChatGPT and Claude. To use tally.chat for real I want them here, searchable and continuable, without them ever showing up as spend.

## Solution

**Cheaper reply.** The composer gets a one-off "reply with" choice. It defaults to the thread's model, and opening it lists my models with what this one send would cost on each: the thread's model priced at its current cache state, the others priced as a cold start. Picking one sends this message to that model only; the thread stays on its model and keeps its cache. Retry gets the same list, so an overkill answer can be redone cheaper. On a new thread, if my first message looks simple and I've picked an expensive model, a one-line suggestion offers the provider's cheapest model, with both prices, and one click switches the picker. Nothing ever switches on its own.

**Full-text search.** The sidebar search finds messages as well as titles: each hit shows its thread, who said it and the matching text, and opening it jumps to that message (switching branch or opening a condensed fold if needed). Search runs as a one-off request rather than a live subscription, which keeps it off the failure path behind the T3 Chat outage the design doc warns about.

**Import.** On a new Import page I upload the conversations file from a ChatGPT or Claude data export and pick the model to continue on. Each conversation becomes a thread with its original title, date and branches; images and attachments become placeholders. Imported messages carry no usage, so they never count as spend. Imports run in the background with progress, and importing the same file again skips what's already here.

## User Stories

### Cheaper reply

1. As a user, I want to send one message to a cheaper model without changing the thread's model, so that easy turns cost less.
2. As a user, I want to see what this send would cost on each of my models before I pick, so that I choose with numbers rather than guesses.
3. As a user, I want the thread's own model priced at its current cache state and other models priced as a cold start, so that the comparison is honest about what switching throws away.
4. As a user, I want the estimate to include the expected reply length, so that output prices count too.
5. As a user, I want models without a price shown as "cost unknown", and free models as $0, so that I'm never shown a made-up number.
6. As a user, I want the one-off choice to reset after the send, so that I never stay on the cheap model by accident.
7. As a user, I want the thread's cache, keepalive and cache status untouched by a one-off reply on another model, so that the next normal turn is still cheap.
8. As a user, I want a reply from another model labelled with that model in its metadata line, so that I can tell which model said what.
9. As a user, I want "retry with" on a reply, listing the same models and estimates, so that I can redo an overkill answer cheaper.
10. As a user, I want a retry on another model to become a new version of that reply, so that I can switch back to the original with the version arrows.
11. As a user, I want spend from a one-off reply metered under the model that produced it, so that the usage page stays accurate.
12. As a user, I want effort sent on a one-off reply only when that model supports it, so that a cheaper model never gets an option it rejects.
13. As a user on a new thread, I want a suggestion to start on a cheaper model when my first message looks simple, so that I don't pay top price for a quick question.
14. As a user, I want the suggestion to show both prices for the first turn, so that I can see what I'd save.
15. As a user, I want to accept the suggestion with one click and dismiss it just as easily, so that it never gets in the way.
16. As a user, I want no suggestion once the thread has started, so that a switch never costs me a warm cache.

### Full-text search

17. As a user, I want the sidebar search to match message text as well as titles, so that I can find what was said, not just what the thread is called.
18. As a user, I want each message hit to show its thread title, who wrote it and the text around the match, so that I can tell the right hit at a glance.
19. As a user, I want title matches listed first and message matches after, so that the quick path stays quick.
20. As a user, I want opening a message hit to take me to that message in its thread, so that I don't have to scroll for it.
21. As a user, I want a hit on another branch to switch the thread to the branch containing it, so that I see the message in its real context.
22. As a user, I want a hit inside a condensed range to open the fold and scroll to it, so that condensed messages are still findable.
23. As a user, I want imported messages to be searchable too, so that my old history is useful here.
24. As a user, I want search to wait until I pause typing and to show a few dozen hits at most, so that it stays fast on a big history.
25. As a self-hoster, I want search to run as a one-off request rather than a live subscription, so that a search-index hiccup can't flood my clients with re-runs.
26. As a user, I want messages still streaming left out of results, so that I never land on a half-written reply.

### Import

27. As a user, I want to import my ChatGPT history from its data export, so that years of conversations come with me.
28. As a user, I want to import my Claude history from its data export, so that I can bring both.
29. As a user, I want tally.chat to tell which export a file is from on its own, so that I don't have to say.
30. As a user, I want to pick the model imported threads continue on, so that I can reply in them straight away.
31. As a user, I want each conversation to keep its title and original date, so that my sidebar reads like my history.
32. As a user, I want ChatGPT's edited and regenerated branches kept as branches, with the one I last viewed active, so that nothing is flattened away.
33. As a user, I want images, files and tool output in an export shown as short placeholders, so that I know something was there.
34. As a user, I want system prompts, hidden messages and tool calls left out, so that imported threads read like the conversation I saw.
35. As a user, I want imported messages to carry no cost and never count toward my budget or spend, so that the numbers stay mine.
36. As a user, I want imported threads not to get a side-job title, so that importing never spends money.
37. As a user, I want a large import to run in the background with progress, so that I can keep chatting meanwhile.
38. As a user, I want importing the same file again to skip conversations already imported, so that a retry never makes duplicates.
39. As a user, I want a clear error when a file isn't a supported export, so that I know what to upload instead.
40. As a user, I want the inspector to show what continuing an imported thread costs, and condense now to work on it before my first reply, so that continuing a long imported thread isn't a surprise.
41. As a user, I want imported threads marked as imported, so that I can tell them apart.

## Implementation Decisions

### Cheaper reply

- **One mechanism, a per-send model override.** Send and retry accept an optional model (provider and model id). The reply records the provider and model that actually ran it, as replies already do, and generation reads the reply's own provider and model instead of the thread's. The thread's model, effort setting and system prompt version don't change.
- **The thread's cache bookkeeping belongs to the thread's model.** A reply on another model doesn't update the thread's cache touch or restart its keepalive, and its usage doesn't count toward the thread's cache status. It's metered like any reply, under its own model and provider.
- **Effort** goes on a one-off reply only when the override model's provider is Anthropic style; the level is the one in force for the thread. Per-message effort changes aren't offered with an override.
- **The estimate** comes from a new public query: for the next send (or a retry of a given reply), every visible model of the owner's providers, priced as:
  - the thread's model: the existing next-send estimate (prefix at the current cache state, the draft as fresh input, expected output);
  - another model: the whole prefix as a cold start (cache-write price on Anthropic-style providers, input price elsewhere), the draft as fresh input, the same expected output at that model's output price;
  - free providers $0, unpriced models null.
  It's queried only when the list is open.
- **UI.** A compact "reply with" control in the composer shows the thread's model. Opening it lists models with their estimates, sorted by cost, the thread's model marked. A choice applies to the next send only and then resets. The retry button gains a "Retry with…" list with the same estimates for that reply's prefix.
- **Model suggestion.** A pure heuristic decides whether a first message "looks simple": short (a few hundred characters), at most a couple of lines, no code block, no images. If it does, and the selected model costs well over the provider's cheapest priced visible model (several times its input plus output price), the new-thread screen shows one line: "Looks simple: start on Haiku 5.5? ~$0.0003 instead of ~$0.004 for this turn", with Switch and a dismiss. Switch changes the picker; nothing is sent. It appears only before the first send.

### Full-text search

- **Index.** Messages gain a search index on their content, filtered by owner. Content is written once, when a message is finalized, so an index entry never changes after that. Adding the index to an existing large table can slow a deploy while it backfills; if Convex supports staging search indexes, stage it on the first deploy and enable it on the next.
- **Query.** A new public query returns title hits (the existing title search) and message hits (up to 30), skipping streaming messages and messages of deleted threads. Each message hit carries the thread id and title, the role, and a snippet: the text around the first matching term, a fixed number of characters either side, computed on the server.
- **One-off, not subscribed.** The client calls search as a one-off request (debounced, about 250 ms after typing stops) rather than a live subscription, so results don't re-run whenever the search index changes. The existing live title search moves to the same one-off call. This is the design doc's T3 Chat lesson: index changes invalidating many subscribed search queries at once.
- **Opening a hit.** The thread opens with the message as the target. If the message isn't on the active branch, the thread switches to the branch containing it (the existing branch switch from that message). If it's inside the active branch's condensed range, the fold opens. The page scrolls to the message and highlights it briefly.

### Import

- **Formats.** The conversations JSON file from either export, detected by shape:
  - **ChatGPT** (`conversations.json`): each conversation is a node map with parent and children links and a current node. Kept: user and assistant messages with text parts. Text parts are joined; image and file parts become placeholders. Dropped: system, tool and hidden messages, and empty nodes. A dropped node's children attach to its nearest kept ancestor, so the tree stays connected, and consecutive same-role messages on one path are merged. The current node's nearest kept ancestor becomes the active leaf. The model slug, when present, is kept on each assistant message.
  - **Claude** (`conversations.json`): each conversation is a list of human and assistant messages; text blocks are joined, attachments and files become placeholders, and a parent message reference, when present, builds a tree. The latest message is the active leaf.
  - Anything else is refused with "This isn't a ChatGPT or Claude conversations.json export". Zip archives are out of scope: the page says which file to take out of the export.
- **Pipeline.** The browser uploads the file to storage. A mutation records an import (source detected later, chosen continue model, status, counts) and schedules a background action. The action reads and parses the file, then writes each conversation through an internal mutation (very long conversations in several chunks). Progress counts update as it goes. It stops before the action time limit and schedules a continuation from the conversation index it reached. The uploaded file is deleted when the import finishes or fails.
- **Data written.** One thread per conversation:
  - provider and model: the chosen continue model;
  - title: the export's title, or the first message's start;
  - original start time: a new optional field, also given to existing threads by a backfill, so the sidebar orders and groups threads by when they started;
  - imported-from source and external id, with an index used to skip duplicates;
  - title already requested, so no side-job title runs.
  Messages are written root first with parent and ancestor ids, as `done`, with no usage and no cost, and the original model slug where known. Being append-only and usage-free, imported history adds nothing to rollups, budgets or spend (ADR 0001).
- **Re-import.** A conversation whose source and external id already exist for the owner is skipped and counted as skipped.
- **UI.** A new Import page, linked from Settings:
  - a file picker that names the file to take from each export;
  - the continue-model picker;
  - a list of recent imports with status, counts (imported, skipped) and any error.
  Imported threads show a small "imported" label in the thread header.
- **Continuing an imported thread** is an ordinary send: its first reply sends the whole imported branch, which the inspector already prices. Condense now (phase 6) works on imported threads before the first reply, because imported replies are finished.

### Schema changes (all additive and optional)

- `threads` gains `startedAt` (backfilled for existing threads, then used for ordering), and `importedFrom` (source and external id) with an index for duplicate checks.
- `messages` gains a search index on `content` filtered by `ownerId`.
- A new `imports` table holds owner, storage id, source, chosen provider and model, status, counts and error.
- Replies already store their own provider and model; no change.

## Testing Decisions

- **One seam, the existing one:** public Convex functions under convex-test, with fake providers at the HTTP boundary, asserting on what providers received and on what public queries return. Export parsing is tested through the import functions with small fixture files in each format, including branches, hidden nodes, images and tool messages. A browser pass on the Docker stack covers the reply-with control, the suggestion, the search UI and the Import page.
- **Must-have checks**
  - A one-off send on another model goes to that model with the thread's history; the reply records that model; the thread's model, cache touch and keepalive are unchanged; the next normal send goes to the thread's model; usage is metered under the override model.
  - Effort is sent on an override only for Anthropic-style providers.
  - "Retry with" creates a sibling reply on the chosen model.
  - Estimates: the thread's model at cache state, others at cold-start prices, free at $0, unpriced null; sorted by cost.
  - The suggestion heuristic flags short plain messages and not long, multi-line, code or image ones; it suggests only when the price gap is large.
  - Search finds message text and titles, scoped to the owner, skips streaming messages, caps results and returns snippets around the match.
  - Opening a hit on another branch switches to it; a hit in a condensed range is reported as covered.
  - The ChatGPT fixture imports as threads with branches, the right active leaf, merged same-role runs, placeholders and no system or tool messages; the Claude fixture imports linear and parented conversations.
  - Imported messages have no usage; rollups, the budget and thread totals are unchanged by an import; no title side job runs.
  - Re-importing skips existing conversations; an unsupported file fails with the stated error; a long import continues across actions; the uploaded file is deleted at the end.
  - Threads sort by their start time, imported ones by their original date.
- **Prior art:** the branching and retry tests (versions), the inspector estimate tests from phase 3, the title-search tests from phase 4, the condense-now tests from phase 6, and the side-job title tests.

## Out of Scope

- The Gemini adapter, lazy documents (S4) and tools, including web search: a later phase. Documents need an embeddings provider and chunk retrieval; the design doc keeps tools out of v1.
- Automatic per-turn routing (design doc S6: revisit only with data).
- Zip uploads; importing images, files or attachments themselves; exports from other apps.
- Searching inside summaries or imported attachments; search filters (by date, model or thread).
- Exporting tally.chat history.
- Paginating the sidebar beyond its current recent-threads limit (search finds the rest).

## Further Notes

- The cheaper-reply estimate is the design doc's "make the cost math visible" applied per turn: on a warm thread, the list will often show that the thread's own model is cheaper than a small model starting cold. That's the point; S6 rejects auto-routing for exactly this reason.
- The glossary gains "cheaper reply" (a reply sent once to a model other than the thread's) and "imported thread" when this ships.
