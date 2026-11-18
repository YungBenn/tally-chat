# Spec: Phase 10, tool loop with MCP

Status: ready-for-agent · Source: grilling session on the tool loop (2026-11-18), design doc S4 (tool results, superseded), S5 cache invalidation rules, section 9 · Vocabulary: [GLOSSARY.md](../../GLOSSARY.md) ("Tools") · Respects [ADR 0001](../adr/0001-append-only-message-tree.md), [ADR 0002](../adr/0002-convex-backend.md) and [ADR 0003](../adr/0003-tool-results-stay-verbatim.md) · Builds on phases 1 to 9

## Problem Statement

A reply can only be text. The model can't look anything up, read a file I keep elsewhere, or act on a service I use, unless I paste the material in myself. The only outside input is web search, and that runs once before the reply whether or not the model needs it.

MCP is now how most tools are published, so supporting MCP servers gives me the whole ecosystem without tally.chat writing integrations one by one.

The catch is the cache. Tool definitions sit at the very top of every request, and changing them invalidates everything after. Tool results land mid-thread and can be large. A tool loop done the usual way would quietly destroy the cache tally.chat exists to protect.

## Solution

**Tool servers.** A new Tools page, next to Providers, where I add remote MCP servers by URL with optional headers (a bearer token or API key, encrypted like provider keys). For each server I can test the connection, see its tools, mark single tools as always allowed, and choose whether the server is on for new threads.

**Tool set.** A new thread starts with the tools of every server that's on for new threads. Before the first message I can adjust that in the composer. When the first message is sent, the thread freezes the exact tool definitions it sent. Changing the tool set later is an explicit action that warns, with a price, that it breaks the whole cache. The inspector shows the tool definitions as the first layer, priced like the rest.

**Tool loop.** When the model asks for tools, the reply shows each tool call as a collapsible row with the tool name, arguments, status and result. Unless the tool is always allowed, the reply waits for my approval, with one prompt per step listing every call in it. Allowed calls run in parallel. A declined call tells the model I declined, and the model carries on. The loop runs at most ten steps, then offers Continue. The daily budget is checked before every step.

**Cost.** The reply's metadata line adds up all its steps. Clicking it shows each step's tokens, cache hit rate and cost. While an approval waits, keepalive keeps the cache warm.

## User Stories

### Tool servers

1. As a user, I want to add a remote MCP server by URL, so that its tools become available to my threads.
2. As a user, I want to give a server static headers such as a bearer token, stored encrypted, so that I can use servers that need a key.
3. As a user, I want to test a server and see the tools it offers, so that I know it works before a thread depends on it.
4. As a self-hoster, I want server URLs checked by the same URL guard as providers, so that a tool server can't reach my private network unless I allowlist it.
5. As a user, I want each server to have an "on for new threads" switch, so that I control what new threads pay for in tool definitions.
6. As a user, I want to mark a single tool as always allowed, so that harmless lookups don't ask me every time.
7. As a self-hoster, I want the docs to show how to run a stdio MCP server behind a small proxy container, so that local-only servers still work.

### Tool set and the cache

8. As a user, I want to adjust a new thread's tool set before the first message, so that a thread only carries the tools it needs.
9. As a user, I want a thread to keep the exact tool definitions it started with, so that a server update never breaks a warm cache.
10. As a user, I want changing an existing thread's tool set to warn me, with a price, that it breaks the cache, so that I never do it by accident.
11. As a user, I want the inspector to show the tool definitions as their own priced layer at the top, so that I can see what tools cost on every turn.
12. As a user, I want a call to a tool the server no longer offers to come back as an error the model can see, so that the thread doesn't crash.
13. As a user, I want the tools toggle hidden on models that can't call tools, so that I'm never offered something the model will reject.

### Tool loop

14. As a user, I want to approve each tool call before it runs, so that a remote server never acts without my say.
15. As a user, I want calls the model makes at once in one step to show in one approval prompt and run in parallel, so that I approve once and wait once.
16. As a user, I want declining a call to tell the model I declined and let it continue, so that it can explain or try another way.
17. As a user, I want Stop to end the reply outright, including a pending approval, so that I can always get out.
18. As a user, I want a reply to stop after ten steps with Continue, so that a looping model can't run up my bill.
19. As a user, I want the daily budget checked before every step, so that a tool loop can't run past my limit.
20. As a user, I want a call that takes longer than 60 seconds to time out as an error the model sees, so that a hung server doesn't hang my reply.
21. As a user, I want an approval I leave for 30 minutes to stop the reply with Continue, so that a forgotten tab doesn't hold the thread open.
22. As a user, I want keepalive to keep running while an approval waits, so that a slow click doesn't cost a cold cache.
23. As a user, I want each tool call shown as a collapsible row with its name, arguments, status and result, so that I can see what the model did.
24. As a user, I want tool results that aren't text replaced with a short note, so that nothing unpriced enters the context.
25. As a user, I want a very long result cut at a fixed size with a note saying so, so that one big page doesn't tax every later turn.

### Cost, retry and the rest of the app

26. As a user, I want the reply's cost line to add up every step, and a click to show each step, so that a tool loop's cost is never hidden.
27. As a user, I want Retry to run the whole tool loop again as a new version of the reply, so that retry works as it does today.
28. As a user, I want cheaper reply and retry-on-another-model to offer only tool-capable models in a thread with tools, so that I never send tool history to a model that can't read it.
29. As a user, I want the condenser to fold tool loops like any other turn, so that long tool-heavy threads still condense.
30. As a user, I want exports to include tool calls and results, so that the record is complete.
31. As a user, I want full-text search to match a reply's text but not its tool results, so that search stays fast and relevant.

## Implementation Decisions

### Tool servers

- **Transport.** Remote MCP over Streamable HTTP only, through the official MCP TypeScript SDK client, from Node actions. Every connection goes through the existing URL guard and allowlist. No stdio. The self-hosting guide gets an example of a stdio server wrapped by a proxy container in the compose file.
- **Credentials.** A server stores its URL, a name, and optional headers. Header values are encrypted with the vault, like provider API keys, and never returned to the client.
- **Tool list.** "Test" and "refresh" list the server's tools and store them on the server record (name, description, input schema). The Tools page shows that list with an "always allow" switch per tool. Always-allow is stored per server and tool name. It changes no request bytes, so it can change at any time.
- **Default.** `onForNewThreads` per server.

### Tool set

- **Freezing.** At the first send, the thread stores its tool set: for each tool, the server id, the tool name and the exact definition sent (name, description, input schema). The tool names sent to the provider are made unique per thread by prefixing the server's slug, and the stored definition is what goes on every later request, byte for byte. This mirrors how `instructions` freeze custom instructions.
- **Changing it later.** A thread menu action opens the tool picker with a cache-break warning showing the price of rewriting the whole prefix (reuse the edit-in-place dialog). Confirming replaces the thread's stored tool set. It's a thread-level change, not a message, so it applies to the whole branch from the next request on.
- **Models.** Provider models gain a `tools` flag beside `vision`, set the same way. The composer's tool picker, and sending with a non-empty tool set, need a tool-capable model. Cheaper reply and retry-on-another-model lists hide models without tools in a thread whose tool set isn't empty, with a line saying why.
- **Request layout.** Anthropic: `tools` comes first in the request, with an explicit cache breakpoint on the last tool, so tools, system and checkpoint layers each have a breakpoint and the messages layer keeps automatic caching. OpenAI-compatible: `tools` in the standard field, same order every time. The keepalive request carries the tools too, or it would warm a different prefix.

### Tool loop

- **One reply, many parts.** An assistant message gains an ordered `parts` list: text, tool call (call id, tool name, arguments, step number) and tool result (call id, text, status: ok, error, declined, timed out). `content` stays the reply's final text, made of its text parts joined, so search, titles and export keep working. A turn is still one user message plus one reply (ADR 0001 holds: parts are written while the reply is streaming and fixed at finalize).
- **Steps.** Each step is one model request. The loop runs as a chain of actions, one per step, scheduled by mutations, so no single action runs near the Convex time limit and an approval can pause between steps with no action running. A step's request sends the branch plus the reply's parts so far.
- **Approval.** After a step that asks for tool calls, if any call is for a tool that isn't always allowed, the reply goes to a waiting state with a pending approval for that step. The prompt lists every call in the step with its arguments. Allow runs them all. The user can also decline single calls. Always-allowed calls in the same step wait with the others, so the step's results go back together.
- **Running calls.** Calls in a step run in parallel. Each has a 60-second timeout. A timeout, a transport error, an MCP error, or a tool missing from the server becomes an error result with a short reason, never a failed reply.
- **Results.** Text content is joined. Any non-text content is replaced by a note such as `[image omitted]`. The text is cut at about 8k tokens (estimated with the existing token estimator) with `[result truncated at ~8k tokens]` appended. The cut is made when the result is written, so the stored bytes are the sent bytes (ADR 0003).
- **Limits.** At most ten steps per reply. When step ten asks for more tools, the reply finishes as truncated, and Continue resumes from where it left off, reusing the output-modes Continue. Before each step, the budget check runs as it does before a send. A paused budget ends the reply with the budget message.
- **Stopping.** Stop works at any point: it cancels a pending approval, aborts the step in flight, and finalizes the reply as stopped. An approval pending for 30 minutes stops the reply the same way, with Continue.
- **Keepalive.** A reply waiting on approval counts as presence for keepalive, up to the 30-minute cutoff. The keepalive prefix runs through the reply's last stored part.
- **Provider mapping.** Anthropic: `tool_use` and `tool_result` content blocks. If effort/thinking is on, the thinking blocks from earlier steps go back unchanged with their signatures, as the API requires inside a tool loop. OpenAI-compatible: `tool_calls` on the assistant message and `tool` role messages, through the AI SDK's tool-call stream parts. Both adapters emit the same normalized events (text, tool call, usage, stop).

### Cost and display

- **Metering.** Each step's usage is metered as it finishes, under the reply's model and provider, so rollups and the budget stay current mid-loop. The reply stores the sum plus usage per step.
- **Reply UI.** Tool calls render inline in order as collapsible rows (tool name, server, status chip, arguments, result), collapsed once done. The metadata line shows the summed cost and tokens; its breakdown lists each step.
- **Inspector.** A new top layer, "Tools", lists the thread's tool definitions with their token count and cache state, above the system prompt.
- **Export.** Markdown shows each tool call and result as a fenced block under the reply. JSON includes `parts`.
- **Search** indexes `content` only, which holds no tool results.
- **Import** is unchanged: tool messages in exports stay flattened or dropped as today.

### Schema changes (all additive and optional)

- A new `toolServers` table: owner, name, url, encrypted headers, `onForNewThreads`, cached tool list, always-allowed tool names, last test result.
- `threads` gains `toolSet` (an array of server id, sent name and the frozen definition).
- `messages` gains `parts` (replies), `steps` (usage per step), and a `waiting` status value with a `pendingApproval` (step number, call ids, requested at).
- Provider `models` entries gain `tools`.

## Testing Decisions

- **One seam, the existing one:** public Convex functions under convex-test, with a fake provider and a fake MCP server at the HTTP boundary, asserting on what each received. A browser pass on the Docker stack covers the Tools page, the composer picker, approval, the tool rows and the inspector layer.
- **Must-have checks**
  - The first send freezes the tool set. Later requests send byte-identical tool definitions after the server's tool list changes. A call to a removed tool returns an error result.
  - Anthropic requests put tools first with a breakpoint on the last tool. Keepalive sends the same tools.
  - A step with tool calls waits for approval unless every call is always allowed. Allow runs all calls in parallel. Decline sends a declined result and the loop continues. Stop cancels a pending approval.
  - A call over 60 seconds becomes a timed-out result. An unreachable server becomes an error result. Neither fails the reply.
  - Non-text results become a note. A long result is cut at the cap with the note, and the stored text equals the sent text on the next step and on a retry.
  - Step ten ends the reply as truncated, and Continue resumes. A budget pause between steps ends the reply.
  - An approval pending for 30 minutes stops the reply. Keepalive keeps running while it waits.
  - Usage is metered per step. The reply's total equals the sum of its steps. The breakdown lists each.
  - Retry creates a sibling reply that runs its own loop.
  - Cheaper reply and retry lists hide tool-less models in a thread with tools.
  - Thinking blocks are sent back unchanged across steps on Anthropic.
  - The URL guard blocks a private tool server URL unless allowlisted. Header values never reach the client.
  - Export includes tool parts. Search doesn't match text that appears only in a tool result.
- **Prior art:** the caching byte-assertion tests from phase 2, the keepalive and presence tests, the output-modes Continue tests from phase 4, the cheaper-reply tests from phase 7, and the web search tests from phase 9.

## Out of Scope

- Stdio MCP servers run by tally.chat itself (use a proxy container).
- OAuth for tool servers.
- Built-in tools, including moving web search onto the tool loop.
- Images or other non-text content in tool results.
- MCP resources, prompts and sampling: tools only.
- A per-server timeout setting; agents or saved tool setups beyond a thread's tool set.
- The Gemini adapter (phase 11).

## Further Notes

- ADR 0003 records why tool results stay verbatim instead of the design doc's digest rule.
- The glossary gained Tool server, Tool set, Tool call, Tool result, Approval, Step and Tool loop in this session.
