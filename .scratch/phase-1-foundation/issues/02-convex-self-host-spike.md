# 02: Convex self-host spike

**What to build:** A one-day, throwaway proof that self-hosted Convex in Docker runs what phase 1 depends on: `persistent-text-streaming` streaming a response to a subscribed client, and `@convex-dev/aggregate` summing values by namespace. The deliverable is a findings note, not product code. Spec: user story 45; ADR 0002.

**Blocked by:** None (can start immediately)

**Status:** done (pending review)

- [x] Self-hosted Convex backend runs from Docker Compose (default SQLite) and a toy app deploys to it
- [x] A toy action streams text through `persistent-text-streaming`; a client reloading mid-stream resumes it
- [x] A toy mutation updates an `aggregate` sum by namespace and reads it back
- [x] Findings note in `docs/` covering setup steps, versions, anything that broke or needed workarounds
- [x] If findings contradict ADR 0002, an ADR change is proposed; otherwise the note says it holds
- [x] Toy app code is not merged into the product
