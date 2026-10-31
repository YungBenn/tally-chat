# 05: First chat turn, streamed

**What to build:** The owner creates a thread on an Anthropic model, sends a message, and watches the reply stream in. Closing and reopening the tab resumes the stream; the owner can stop a reply mid-stream. Messages are stored as an append-only tree (ADR 0001) with `ancestorIds`. A plain, unstyled chat page is enough. Spec: user stories 20 to 23, 33; Implementation Decisions "Message tree", "Streaming", "Interactions: Send, Stop".

**Blocked by:** 03 Add an Anthropic provider

**Status:** done (pending review)

- [x] Owner can create a thread with a chosen provider and model
- [x] Sending appends the user message and an assistant message with status `streaming`, and returns immediately
- [x] The provider call runs in a scheduled internal action and flushes buffered chunks roughly every 100 ms, never per token
- [x] The stream is driven server-side, writing through `persistent-text-streaming`'s chunk mutation; no browser-called HTTP streaming endpoint exists (spike finding 1, `docs/spike-convex-self-host.md`)
- [x] The `persistent-text-streaming` version is pinned exactly, and the call into its undocumented chunk mutation lives in one place
- [x] Reloading mid-stream shows the text so far and continues streaming
- [x] A thread open on two devices shows the same messages
- [x] Stop sets a flag on the message that the streaming action checks between chunks; the action then aborts the provider request and marks the message `stopped`, keeping streamed content (the component has no cancel API, spike finding 3)
- [x] A provider error marks the message `error`, keeping streamed content
- [x] Each message stores `ancestorIds`; the active branch is built in one read
- [x] Message content never changes after its final status is written (test asserts this)
- [x] The system prompt is sent at the thread's `systemPromptVersion`
- [x] Chat requests go through the outbound URL guard (`guardedFetch` with the owner's allowlist), like key tests and model listing
