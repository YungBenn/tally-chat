# Tool results stay verbatim, capped, and fold only through the condenser

A tool result is stored once, inside the reply that made the tool call, and is sent word for word on every later request of that branch. Each result is capped at about 8k tokens, with a truncation note, when it is written. Nothing replaces an old result with a digest; the only way it leaves the context is the condenser folding the turn into a checkpoint, the same as any other turn. This supersedes the design doc's S4 rule ("store the raw result and keep only a short digest in context afterwards").

## Considered Options

- **Digest after the turn (S4 as written)**: shrinks later requests, but swapping a result for its digest changes bytes in the middle of the cached prefix. Every later request pays a full cache write for the rest of the thread, every time a digest lands. That is the exact cost tally.chat exists to avoid.
- **Never cap**: simplest, but one large result (a web page, a file listing) becomes a permanent per-turn tax that even a cache read can't make cheap.

## Consequences

- A cached result costs about 0.05x per later turn on Claude, so a capped verbatim result is cheaper over a thread's life than a digest that rewrites the prefix.
- The cap is applied at write time, so the stored result and the sent result are always the same bytes. Retries, keepalives and cheaper replies send what was stored.
- Documents already work this way (full text, sent every turn), so tools and documents follow one rule.
