# 07: Edit cache-break hint

**What to build:** Beside Edit on a past message, a hint reads `breaks cache · +$0.04`: the estimated extra cost of forking there instead of continuing. Above a threshold the owner sets in Settings (default $0.10), starting the edit asks for confirmation once; below it, nothing blocks. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 35 to 38; Implementation Decisions "Inspector query" (edit hint) and "Soft budget" (the threshold setting).

**Blocked by:** 03 Inspector rail

**Status:** ready-for-agent

- [ ] The inspector query returns an edit estimate per user message on the branch, assuming only the system prompt and checkpoint layer stay cached
- [ ] No hint when the cache is cold, the extra cost is under one cent, or the branch is below the minimum cacheable size
- [ ] Settings gain a cache-break confirmation threshold, default $0.10
- [ ] Above it, starting an edit asks for confirmation; below it, no prompt
- [ ] Tests: the estimate grows with distance from the stable layers and is absent when cold or under one cent
