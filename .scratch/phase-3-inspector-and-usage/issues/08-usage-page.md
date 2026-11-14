# 08: Usage page

**What to build:** A `/usage` page shows the last 30 days in the owner's time zone: daily spend, spend per model, cache hit rate per day (excluding keepalive reads), keepalive spend per day, and net caching savings for 7 and 30 days, which may be negative. Spend from deleted threads still counts, and unpriced calls are flagged. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 39 to 46; Implementation Decisions "Usage page".

**Blocked by:** 01 Rollups for upkeep and savings

**Status:** ready-for-agent

- [ ] One owner-only query takes the day range from the client (queries can't read the clock) and returns per-day rows and per-model totals
- [ ] Hit rate per day excludes keepalive reads; savings subtract keepalive spend
- [ ] Unpriced calls are counted and the totals say they are a lower bound when any exist
- [ ] Plain CSS bars, no chart library; linked from the sidebar
- [ ] Tests cover the 30-day rows, per-model totals, hit rate excluding keepalives, deleted-thread spend and time-zone days
- [ ] Checked in the browser on desktop and phone widths, light and dark
