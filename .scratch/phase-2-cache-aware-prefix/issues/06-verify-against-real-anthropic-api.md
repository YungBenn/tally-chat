# 06: Verify against the real Anthropic API

**What to build:** Proof with a real key that the cache is actually hit, which the fake provider cannot show. Run together with the owner, who supplies the key. Spec: Further Notes "Verification with a real key" and "Thinking blocks".

**Blocked by:** 04 Keepalive, 05 Keepalive switch and the 1-hour fallback

**Status:** blocked on owner: see `docs/human-actions.md` (add a real Anthropic provider)

- [ ] A multi-turn thread on a 5.5 model: cache read grows each turn once the prefix passes the minimum cacheable size
- [ ] With the tab focused, a 6-minute pause keeps the cache warm (the next turn reads, the keepalive appears as a side job with a small cost)
- [ ] With the tab unfocused for over 30 minutes, keepalives stop
- [ ] With keepalive off, a pause of over 5 minutes still reads from the 1-hour cache
- [ ] Not replaying the model's thinking blocks causes no errors on this account; findings recorded in the spec's Further Notes
- [ ] Cost figures cross-checked against the Anthropic console for the session
