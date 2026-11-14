# 03: Inspector rail

**What to build:** A thread's inspector shows its context window by layer (system prompt, checkpoint layer, turns since, next message) with token counts, measured or estimated, and each layer's state (cached, to be written, or fresh), plus the thread's total spend, cache upkeep, cache hit rate, reasoning tokens and net cache savings. It is a right rail on desktop, closed by default, remembered per device and toggled with `⌘I`, and a bottom sheet on phones. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 1 to 16; Implementation Decisions "Inspector query" and "Layout and look".

**Blocked by:** 01 Rollups for upkeep and savings

**Status:** ready-for-agent

- [ ] One owner-only query returns the layers, their states' inputs (cache expiry, last activity, keepalive pending), the next-send estimate parts and the thread figures, priced
- [ ] Turn sizes come from the latest reply's usage (request size plus visible output, minus the stable layers); the system prompt and pinned messages are estimated (characters ÷ 4) and marked `~`
- [ ] Layer states: cached when warm, to be written at the thread's lifetime when cold, fresh for the next message; OpenAI-compatible threads show "provider caches on its own" with the reported cache read
- [ ] Thread total includes replies, title and keepalives; upkeep is keepalive spend; hit rate covers replies; savings subtract upkeep and may be negative
- [ ] Unpriced models show unknown costs; free providers show $0
- [ ] Rail closed by default, open state remembered per device, `⌘I` / Ctrl+I toggles; bottom sheet below the md breakpoint
- [ ] Tests cover layers with and without a checkpoint, warm, cold and OpenAI-compatible states, and thread figures against a seeded thread
- [ ] Checked in the browser on desktop and phone widths, light and dark
