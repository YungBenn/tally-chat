# 01: Output modes and Continue

**What to build:** Each send has an output mode, quick, normal or long, chosen in the composer (default normal, remembered per thread in the browser), which sets how long the reply may be. A reply that stops at its limit says it was cut off and offers Continue, which sends an ordinary next turn. New threads use a system prompt that asks for concise answers; existing threads keep theirs. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 12 to 20; Implementation Decisions "Output budget (S11)".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Quick, normal and long send `max_tokens` of 2,048, 8,192 and 32,000, through both adapters
- [ ] The mode is chosen per send, defaults to normal, and is remembered per thread in the browser; it never changes the request prefix
- [ ] The adapters surface the stop reason; a reply that stopped at the limit is stored as truncated and its metadata line says "cut off at the limit"
- [ ] Continue on a cut-off reply sends "Continue." as an ordinary user turn on the same branch (metered, retryable, branchable)
- [ ] System prompt version 2 asks for concise answers; new threads use it, existing threads keep version 1
- [ ] The cost strip's expected output is capped at the chosen mode's limit
- [ ] Tests cover each mode's `max_tokens`, the truncated flag, Continue, and the prompt version per thread
- [ ] Checked in the browser: the mode control, a cut-off reply and Continue
