# 01: Cache-aware Anthropic requests

**What to build:** Every request to an Anthropic provider is marked for prompt caching, so a thread's history is read from cache instead of paid in full every turn. The system prompt and the checkpoint layer each get an explicit cache breakpoint, and top-level automatic caching slides a third breakpoint forward over the verbatim turns. OpenAI-compatible requests are unchanged. Spec: `docs/specs/phase-2-cache-aware-prefix.md`, user stories 1 to 9; Implementation Decisions "Request layout".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Prefactor: context assembly also reports where the checkpoint layer ends (no behaviour change; existing assembler tests stay green)
- [ ] The system prompt is sent as one text block with `cache_control`
- [ ] When a checkpoint applies, the last block of the checkpoint layer carries `cache_control`; without one, no second breakpoint
- [ ] Requests set top-level automatic caching
- [ ] Every breakpoint in a request uses the same TTL (5 minutes in this ticket); never more than 4 breakpoints
- [ ] Only blocks that need `cache_control` become content-block arrays; two consecutive turns' request prefixes are byte-identical up to the new turn
- [ ] OpenAI-compatible requests contain no `cache_control`
- [ ] Title side jobs are unaffected
