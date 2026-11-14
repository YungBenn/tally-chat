# 06: One turn in the inspector

**What to build:** Clicking a reply's metadata line opens the inspector on that turn: its uncached input, cache read, cache writes (5m and 1h), output, reasoning, cost, and what caching saved on it. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 17 and 18.

**Blocked by:** 02 Readable metadata line, 03 Inspector rail

**Status:** done (pending review)

- [x] The metadata line is a control (keyboard reachable) that opens the inspector focused on that reply
- [x] The turn view shows the reply's stored usage and cost and its caching savings, priced like the rollups
- [x] Unpriced and free replies read as elsewhere
- [x] A way back to the thread view
- [x] Tests cover the turn's savings against a hand-computed value
