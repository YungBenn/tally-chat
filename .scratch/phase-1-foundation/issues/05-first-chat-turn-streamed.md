# 05: First chat turn, streamed

**What to build:** The owner creates a thread on an Anthropic model, sends a message, and watches the reply stream in. Closing and reopening the tab resumes the stream; the owner can stop a reply mid-stream. Messages are stored as an append-only tree (ADR 0001) with `ancestorIds`. A plain, unstyled chat page is enough. Spec: user stories 20 to 23, 33; Implementation Decisions "Message tree", "Streaming", "Interactions: Send, Stop".

**Blocked by:** 03 Add an Anthropic provider

**Status:** ready-for-agent

- [ ] Owner can create a thread with a chosen provider and model
- [ ] Sending appends the user message and an assistant message with status `streaming`, and returns immediately
- [ ] The provider call runs in a scheduled action and flushes buffered chunks roughly every 100 ms, never per token
- [ ] Reloading mid-stream shows the text so far and continues streaming
- [ ] A thread open on two devices shows the same messages
- [ ] Stop aborts the provider call and marks the message `stopped`, keeping streamed content
- [ ] A provider error marks the message `error`, keeping streamed content
- [ ] Each message stores `ancestorIds`; the active branch is built in one read
- [ ] Message content never changes after its final status is written (test asserts this)
- [ ] The system prompt is sent at the thread's `systemPromptVersion`
