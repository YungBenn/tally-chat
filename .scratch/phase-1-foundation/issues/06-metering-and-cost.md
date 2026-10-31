# 06: Metering and cost

**What to build:** Every assistant message records normalized usage (uncached input, cache read, cache write 5m, cache write 1h, output, reasoning) and its cost in integer micro-dollars from a synced price table. Daily rollups per model, provider and thread are kept as rollup documents (ADR 0002). A raw meta line under each reply shows the numbers. Spec: user stories 34 to 36, 38, 39, 41, 42, 19; design doc S10, 8.2.

**Blocked by:** 05 First chat turn, streamed

**Status:** done (pending review)

- [x] Anthropic usage is normalized to the shared shape, with `inputTokens` meaning uncached input
- [x] A sync script vendors LiteLLM's model price file; a local overrides file wins over it
- [x] Cost is computed from base input, output, cache read, and 5m and 1h write prices, stored as `costMicroUsd`
- [x] A model missing from the table records cost as unknown, never a guess
- [x] Rollups by owner and day for each of model, provider and thread are updated in the same mutation that finalizes the message
- [x] Rollup totals equal the sum of their messages (test)
- [x] Stopped and errored messages record whatever usage the provider reported
- [x] Provider capabilities (caching, reasoning) are set from observed usage fields, never assumed
- [x] Each assistant message shows a raw meta line: model, cost, input, cache read and write, output, reasoning
