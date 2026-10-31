# 09: Checkpoint-aware context assembly

**What to build:** The context assembler honors checkpoints: when a checkpoint covers part of the active branch, the request carries the system prompt, the latest checkpoint's summary, the pinned messages it covers in original order, then the verbatim messages after it. Assembly is byte-identical for an unchanged branch. No condenser yet; tests seed checkpoints directly. Spec: Implementation Decisions "Context assembler"; design doc S1, 8.1.

**Blocked by:** 08 Retry, edit and branch switching

**Status:** done (pending review)

- [x] With no checkpoint on the branch, the request is system prompt then the full branch
- [x] With checkpoints, only the latest one on the branch is applied
- [x] Pinned messages inside the covered range follow the summary in original order
- [x] A fork made before a checkpoint never sees it
- [x] "Turn 40 of a thread condensed twice and forked once" produces the expected ordered context (test)
- [x] Assembling the same branch twice yields byte-identical system and message content (test)
- [x] Bumping `systemPromptVersion` is the only thing that changes the system prompt bytes
