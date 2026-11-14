# 09: Soft budget

**What to build:** The owner can set a daily budget in Settings, or none. At 80% a dismissible banner warns; at 100% sending, retrying and editing are refused with an "override for today" action, and keepalives and title side jobs pause silently until midnight in the owner's time zone or an override. The usage page shows today's progress. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 47 to 53; Implementation Decisions "Soft budget".

**Blocked by:** 08 Usage page

**Status:** ready-for-agent

- [ ] Settings gain a daily budget (absent means none) and an override for the owner's current day
- [ ] Today's spend is today's rollups for one dimension in the owner's time zone; unpriced calls add $0
- [ ] Send, retry and edit are refused server-side at or over budget unless overridden for today; the composer shows the refusal with the override action
- [ ] The override expires with the owner's day
- [ ] Keepalives and title jobs skip silently while over budget and not overridden
- [ ] The 80% banner is dismissible for the rest of the day
- [ ] The usage page shows today's budget progress
- [ ] Tests cover refusal, override, next-day expiry, paused keepalives and titles, and unpriced calls
