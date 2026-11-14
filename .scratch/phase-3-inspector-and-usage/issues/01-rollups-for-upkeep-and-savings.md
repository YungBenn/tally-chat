# 01: Rollups for upkeep and savings

**What to build:** Daily rollups learn two things the inspector and the usage page need. Keepalives are also rolled up under a new `upkeep` dimension keyed by thread, and every rollup row carries the net money its calls' caching saved. A thread's rows across all its days can be read in one bounded query, and existing data is backfilled once. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 7, 10, 42, 43, 45; Implementation Decisions "Rollups".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A keepalive writes an `upkeep` row for its thread alongside its model, provider and thread rows, in the same mutation that meters it
- [ ] Every metered call adds `savedMicroUsd`: cache read × (input − read price) − 5m writes × (5m write − input price) − 1h writes × (1h write − input price); 0 for free providers and unpriced models
- [ ] A thread's rollup rows across all its days are one indexed, bounded read
- [ ] A one-off backfill creates `upkeep` rows from existing keepalive side jobs and fills `savedMicroUsd` from existing replies and side jobs; running it twice changes nothing
- [ ] Thread delete keeps every rollup row, including upkeep rows
- [ ] Tests: per-day sums match their calls, including negative savings; backfill equals what metering would have written
