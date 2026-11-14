# 05: Keepalive switch and the 1-hour fallback

**What to build:** The owner can turn keepalive off in Settings. With it off, pending keepalives stop and threads use the 1-hour cache lifetime from their second turn on, so pauses up to an hour stay cheap without background requests. Spec: user stories 20 and 21; Implementation Decisions "Keepalive: Off switch" and "Request layout: Lifetime".

**Blocked by:** 04 Keepalive

**Status:** done (pending review)

- [x] Settings gain `keepaliveEnabled` (absent means on) with a toggle on the Settings page
- [x] Turning it off stops pending keepalives at their next firing
- [x] With keepalive off, a thread's requests from its second turn on use `ttl: "1h"` on every breakpoint, and the thread's cache status uses the 1-hour lifetime
- [x] With keepalive on, requests stay on 5 minutes
- [x] Turning keepalive back on resumes it after the next reply

**Note:** with keepalive off, a new reply also schedules no keepalive job, so the header never claims "kept alive" while the switch is off.
