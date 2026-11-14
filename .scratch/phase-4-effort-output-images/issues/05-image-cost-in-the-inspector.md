# 05: Image cost in the inspector and cost strip

**What to build:** Images count toward what I see before I send: the inspector's context layers and the cost strip include each image's estimated tokens (width × height ÷ 750, capped at 4,784, marked `~`), attached-but-unsent images included. The first image added to a thread shows a cache note in the composer. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 27, 29; Implementation Decisions "Images (S4)".

**Blocked by:** 04 Images in Anthropic threads

**Status:** ready-for-agent

- [ ] Image tokens are estimated as width × height ÷ 750, capped at 4,784 per image, and marked as estimates
- [ ] The inspector's layers include images on the branch where no measured usage covers them yet
- [ ] The cost strip includes images attached to the draft
- [ ] The first image in a thread shows a cache note in the composer; its wording is provisional until phase 2 ticket 06's real-API session confirms the cache effect
- [ ] Tests cover the estimate in the inspector's layers
