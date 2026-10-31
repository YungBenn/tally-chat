# 04: Keepalive

**What to build:** While the owner is active in a thread, the server sends a no-output keepalive shortly before the 5-minute cache expires, so pausing to read doesn't make the next turn expensive. Keepalives stop 30 minutes after the owner's last activity, never duplicate across tabs, never run when they can't help, and are metered as side jobs. Spec: user stories 10 to 19, 22, 23; Implementation Decisions "Keepalive".

**Blocked by:** 01 Cache-aware Anthropic requests, 02 Cache status on threads, 03 Owner presence

**Status:** ready-for-agent

- [ ] After a reply finalizes, one keepalive job is scheduled for `cacheTouchedAt + 4.5 minutes`; its id is stored on the thread
- [ ] A new reply cancels any pending job before scheduling its own (one job per thread, whatever the number of tabs)
- [ ] When it fires, it sends only if: the thread exists, its provider is Anthropic style, the last finished reply reported caching, the owner was active in the last 30 minutes, no reply is streaming, and the cache is still warm
- [ ] The request is `max_tokens: 0`, `stream: false`, with the same system prompt and the branch through the latest reply, an explicit breakpoint on its last block, and the same parameters as a real turn; it goes through the URL guard
- [ ] A sent keepalive updates `cacheTouchedAt` and schedules the next one
- [ ] Each keepalive is recorded in `sideJobs` with kind `keepalive` and metered into the rollups
- [ ] A failed keepalive records any usage that arrived, schedules nothing more, and leaves the thread untouched; the next reply restarts the cycle
- [ ] Thread delete: the job stops on a missing thread and the purge removes keepalive side jobs
- [ ] `getThread` reports `keepalive` while warm, scheduled and the owner is active
- [ ] Tests (fake timers, captured request bodies) cover every condition above, including two tabs producing one keepalive per window
