# 02: Cache status on threads

**What to build:** Each thread knows when its cache was last touched and shows whether it is warm (and until when) or cold, updating live in the thread header. Spec: user stories 24 and 25; Implementation Decisions "Keepalive: Cache touch" and "Cache status".

**Blocked by:** 01 Cache-aware Anthropic requests

**Status:** done (pending review)

- [x] A finished reply records `cacheTouchedAt` on its thread as the request's start time (the cache lifetime counts from the start)
- [x] Only replies whose provider reported cache reads or writes count as touching the cache
- [x] `getThread` returns the cache state: `cold`, or `warm` with its expiry time, given the thread's TTL
- [x] The thread header shows the state as plain text and flips to cold when the lifetime passes, without a reload
- [x] Tests drive time with fake timers and cover never-touched, warm and expired

**Note:** `getThread` returns `cacheExpiresAt` (null when never touched) rather than a computed `cold`/`warm`, because Convex queries must not read the clock (their results don't update as time passes). `cacheState(expiresAt, now)` in `convex/lib/cacheStatus.ts` turns it into `cold` or `warm` with its expiry, for the header and the keepalive job alike. The header is hidden on OpenAI-compatible threads, whose cache tally.chat doesn't manage.
