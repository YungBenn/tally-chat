# 04: Cost strip

**What to build:** Under the composer, one line reads `~$0.004 next · cache warm · 87% hit`. The estimate prices the repeated history as a cache read when warm and a cache write when cold, adds the draft (estimated while typing) and a typical reply's output, and opens the inspector when clicked. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 23 to 29; Implementation Decisions "Inspector query" (next-send estimate parts) and "Metadata line, cost strip, chip and hints".

**Blocked by:** 03 Inspector rail

**Status:** done (pending review)

- [x] The estimate uses the inspector query's priced parts plus the draft's estimate (characters ÷ 4 at the input price), debounced while typing
- [x] Warm prices the prefix at the read price; cold at the 5m or 1h write price; expected output is the mean of the branch's last 5 replies
- [x] A new thread prices the system prompt and draft as fresh input
- [x] Free providers show $0; unpriced models show cost unknown; OpenAI-compatible threads show their reported hit rate
- [x] Clicking the strip opens the inspector (the bottom sheet on phones)
- [x] Tests cover the estimate parts warm, cold (5m and 1h), free and unpriced
