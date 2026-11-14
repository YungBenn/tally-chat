# 03: Per-message effort

**What to build:** On models that support it, the composer's effort control changes effort from the next message on without losing the cache: the change is stored on that user message and sent as a beta effort-only system message right after it, in the same place on every later request and keepalive. On Anthropic models without per-message support, changing effort changes the thread's level instead, after a cache-break hint says what it costs. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 5 to 7, 9, 11; Implementation Decisions "Effort (Anthropic adapter)".

**Blocked by:** 02 Thread effort

**Status:** ready-for-agent

- [ ] Supported models (Fable 5.x, Opus 5 and 5.5, Sonnet 5.5, Haiku 5.5) are an allowlist of model ids in the adapter
- [ ] The composer's effort control shows the level in force on the branch; a change applies to the next message and is stored on that user message, never changed afterwards
- [ ] The assembler emits `{role: "system", content: [], output_config: {effort}}` right after that user message, with the `mid-conversation-output-config-2026-07-01` beta header, on every request that includes it
- [ ] Later turns, retries, edits below it and keepalives repeat it byte-identically; edits that fork above it don't carry it
- [ ] Unsupported Anthropic models change the thread's level instead, behind a cache-break hint (phase 3's edit-hint estimate) and a confirmation above the owner's threshold
- [ ] The inspector shows the level the next send will use
- [ ] Tests cover placement, the header, byte stability across turns and keepalives, a fork above the change, and an unsupported model
