# 02: Cache status on threads

**What to build:** Each thread knows when its cache was last touched and shows whether it is warm (and until when) or cold, updating live in the thread header. Spec: user stories 24 and 25; Implementation Decisions "Keepalive: Cache touch" and "Cache status".

**Blocked by:** 01 Cache-aware Anthropic requests

**Status:** ready-for-agent

- [ ] A finished reply records `cacheTouchedAt` on its thread as the request's start time (the cache lifetime counts from the start)
- [ ] Only replies whose provider reported cache reads or writes count as touching the cache
- [ ] `getThread` returns the cache state: `cold`, or `warm` with its expiry time, given the thread's TTL
- [ ] The thread header shows the state as plain text and flips to cold when the lifetime passes, without a reload
- [ ] Tests drive time with fake timers and cover never-touched, warm and expired
