# 02: Readable metadata line

**What to build:** Each reply's raw usage line becomes a muted, always-visible line that reads like `Sonnet 5.5 · $0.0043 · 12.4k in (87% cached) · 340 out · 1.4k reasoning`. While a reply streams, it shows only a live output count. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 15, 16, 19 to 22; Implementation Decisions "Metadata line, cost strip, chip and hints".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The line shows the model's display name from the provider's model list, cost, total input with its cached share, output and reasoning
- [ ] Money and token counts follow the spec's formatting rules (4 significant digits per turn, `12.4k` above 1,000)
- [ ] Unpriced models show "cost unknown"; free providers show $0
- [ ] While streaming, only a `~` output count estimated from the streamed text; no cost or cache figures until usage lands
- [ ] Checked in the browser in light and dark themes and at phone width
