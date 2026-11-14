# 02: Thread effort

**What to build:** Starting a thread on an Anthropic-style provider, I pick an effort level beside the model (default `low`), and every request in the thread sends it. Each reply shows the effort it ran at. OpenAI-compatible threads show no effort control. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 1 to 4, 8, 10, 11; Implementation Decisions "Effort (Anthropic adapter)".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The new-thread page offers `low`, `medium`, `high`, `xhigh` and `max` beside the model on Anthropic-style providers, defaulting to `low`; the thread stores its choice
- [ ] Every request in the thread sends `output_config.effort` with it, keepalives included, and no `thinking` parameter; title side jobs send `low`
- [ ] Each reply records the effort it ran at, shown in its metadata line and the turn view
- [ ] The inspector shows the thread's effort
- [ ] OpenAI-compatible threads show no effort control and send none
- [ ] Existing threads without a stored effort are treated as `low`
- [ ] Tests cover the request bodies for replies and keepalives, the default, and OpenAI-compatible threads
