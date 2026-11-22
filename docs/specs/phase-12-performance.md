# Spec: Phase 12, performance

Status: ready-for-agent · Source: performance research report (reports/Tally Chat performance improvements.md, 2026-11-21) and the two grilling rounds that followed · Vocabulary: [GLOSSARY.md](../../GLOSSARY.md) ("Conversation", "Cost") · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md); adds ADR 0004 (supersedes ADR 0002's streaming choice) · Builds on phases 1 to 10 and PR #18 (per-block markdown, Shiki, React Compiler)

## Problem Statement

tally.chat feels slow in ways that have nothing to do with the model.

On my phone, every page and every request goes through the public Funnel relay in Tokyo, then to Convex cloud in Sydney. A new connection takes 650-800 ms before anything comes back, each further request 180-600 ms, opening the Convex connection about 600 ms, and every query about 200 ms. On top of that, every navigation waits about 130 ms for the login check in the middleware to ask Convex whether I'm logged in.

While a reply streams, the whole thread gets slower the longer it is. Each 100 ms flush re-runs the thread query and re-sends the entire active branch: about 4 KB per turn, so roughly 400 KB per flush at 100 turns and 750 KB at 200, ten times a second. Every message row then re-renders, and so does the page on every keystroke in the composer. At 600 messages a streamed chunk costs 35 ms of script and a keystroke 22 ms, so frames drop while I type or read. React Compiler silently skips the thread page, the new-thread page and the model picker, and nothing tells me.

Sending feels late too. My message, the cleared composer and the "Thinking" placeholder only appear after the server answers, and a new thread waits on two round trips before it even navigates. Moving between threads remounts the sidebar and re-fetches everything, even for a thread I just looked at.

Smaller costs pile up: background bookkeeping on the thread document re-runs the thread query every minute; the inspector builds the history four to six times per run; KaTeX (77 KB gzip) loads on every thread whether or not a reply has math; finished stream chunks are never deleted.

## Solution

**Network first.** My devices reach tally.chat over the tailnet instead of the Funnel relay, so a request is 16-23 ms instead of hundreds. Later, Convex itself moves onto the Mac that already runs the app, reached over the tailnet, so queries take about a millisecond.

**Streaming that doesn't scale with the thread.** A reply's text streams into its own small record that only the streaming message watches. The thread itself only updates on real events (send, finish, branch switch). A flush costs the same at 10 turns as at 600.

**A thread page that only re-renders what changed.** Each message is its own memoized row that keeps its identity across updates, the composer owns its draft, and React Compiler covers every component, with a check that fails when it stops.

**Instant feedback.** My message and the reply placeholder appear the moment I press Send; a failed send puts my text back. A new thread is created and sent in one step. The login redirect is decided locally. The sidebar stays mounted across pages, and threads I visited or hover over open from cache.

**Measured, not guessed.** Every reply logs where its time to first token went, so the remaining bets are decided on real numbers.

## User Stories

### Network and hosting

1. As the owner, I want to reach tally.chat from my phone over the tailnet, so that a page load costs tens of milliseconds instead of a relay round trip through Tokyo.
2. As the owner, I want tally.chat itself to stop being reachable from the public internet once my devices use the tailnet, so that I'm not exposing a login page I never use publicly.
3. As the owner, I want my other Funnel paths (the model router and search) to keep working, so that moving tally.chat doesn't break other things I rely on.
4. As the owner, I want Convex to run on the same Mac as the app, so that every query and the live connection are local instead of crossing to Sydney.
5. As the owner, I want my phone to reach the self-hosted Convex over the tailnet with HTTPS, so that the browser can connect without anything being exposed publicly.
6. As the owner, I want my existing threads, messages, providers and settings moved into the self-hosted Convex without loss, so that switching backends is invisible apart from speed.
7. As the owner, I want the Convex cloud deployment kept untouched for 30 days after the move, so that I can fall back if something goes wrong.
8. As the owner, I want a nightly backup of the self-hosted data with 14 days kept, so that a disk failure or a bad migration doesn't cost me my history.
9. As the owner, I want backup failures logged where I can find them, so that I notice a backup that silently stopped.
10. As a self-hoster reading the docs, I want the backup setup documented in the self-hosting guide, so that I can do the same.

### Streaming

11. As the owner, I want a streaming reply to cost the same per update whether the thread has 10 turns or 600, so that long threads stay smooth.
12. As the owner, I want a reply to keep streaming in a second tab or after a reload, so that I never lose sight of a reply in progress.
13. As the owner, I want the moment a reply finishes to show its text exactly once, so that it never flickers, disappears or doubles at the handoff.
14. As the owner, I want a reply in a tool loop to show each step's text while it streams and keep it after the step ends, so that the loop reads the same as today.
15. As the owner, I want Stop to take effect at the next flush, as today, so that stopping stays as responsive as before.
16. As the owner, I want a reply that was interrupted (crash, restart, timeout) to still be closed with the text that had arrived, so that the stuck-reply sweep keeps working.
17. As the owner, I want streamed text not to pile up in the database after replies finish, so that storage doesn't grow with every reply.
18. As the owner, I want deleting a thread to remove any streaming text it left, so that nothing of a deleted thread remains.

### Rendering

19. As the owner, I want typing in the composer to re-render only the composer, so that typing in a long thread never lags.
20. As the owner, I want a streamed chunk to re-render only the streaming message, so that reading earlier messages stays smooth while a reply arrives.
21. As the owner, I want messages that didn't change to keep their rendered output across updates, so that send, finish, presence and inspector updates don't re-render the whole thread.
22. As the owner, I want per-message menus (Retry with, model picker, reply details) to mount only when I open them, so that a long thread mounts faster and holds fewer DOM nodes.
23. As the owner, I want React Compiler to optimize every component, including the thread page, the new-thread page and the model picker, so that the speedups it promises actually apply.
24. As the developer, I want lint to fail when a component stops compiling under React Compiler, so that a bailout can't slip in unnoticed again.
25. As the owner, I want finished messages offscreen to skip layout and paint, so that opening a long thread is faster.
26. As the owner, I want the cache-status dot's animation not to keep the page laying out and painting while idle, so that an open tab doesn't drain battery.

### Sending and navigation

27. As the owner, I want my message and the reply placeholder to appear the instant I press Send, so that the app feels immediate.
28. As the owner, I want the composer to clear the instant I press Send, so that I can start my next thought right away.
29. As the owner, I want a failed send (budget reached, missing key, network down) to remove the optimistic message, put my text back in the composer and show the usual error, so that I never lose what I typed.
30. As the owner, I want starting a new thread to create and send in one step and then open the thread, so that the first message of a thread is as quick as any other.
31. As the owner, I want moving between pages not to wait on a login round trip to Convex, so that navigation is instant on a slow connection.
32. As the owner, I want my session to keep refreshing its token as today, so that the faster login check never logs me out.
33. As the owner, I want an expired or missing login to still send me to sign in, so that the faster check is just as correct.
34. As the owner, I want the sidebar to stay mounted when I move between the thread, usage, providers, tools and import pages, so that it doesn't flash or re-fetch.
35. As the owner, I want a thread I visited in the last 30 minutes to open with no wait, so that switching back and forth is instant.
36. As the owner, I want hovering a thread in the sidebar to start loading it, so that it is ready by the time I click.
37. As the owner, I want a cached or prefetched thread not to count as me being in that thread, so that keepalive only pays to keep caches warm for threads I'm actually in.

### Background work and data

38. As the owner, I want presence and cache bookkeeping not to re-run the thread, inspector and thread-list queries every minute, so that an idle open thread costs nothing.
39. As the owner, I want the inspector to build the thread's history once per update, so that it stays cheap on long threads with documents.
40. As the owner, I want the thread query to look up only the checkpoint it needs, so that it doesn't build the whole history just to show the condensed fold.

### Cold loads

41. As the owner, I want KaTeX to load only when a reply contains math, so that the thread page loads 77 KB lighter.
42. As the owner, I want math to show as monospace source for the moment before KaTeX arrives, matching how code shows plain before highlighting, so that a formula never appears as raw dollar signs in a paragraph.
43. As the owner, I want a single KaTeX version installed, so that the stylesheet and the renderer always match.
44. As the owner, I want animation code to load lazily and only the fonts the first paint needs to be preloaded, so that the first load on a slow link is shorter.

### Measurement

45. As the developer, I want every reply step to log one line with how long it waited in the queue, how long its input took, when the provider's first event arrived and when the first text was saved, so that I can see where time to first token goes.
46. As the developer, I want each phase's pull request to carry before and after numbers measured the same way, so that every change is shown to pay off.
47. As the developer, I want a regression test proving a flush leaves the thread query's result unchanged, so that the main cost can't come back.

## Implementation Decisions

### Phases (one pull request each)

0. Tailnet access and reply timing logs.
1. Stream split (with ADR 0004), flush round trip and stream cleanup.
2. Thread page restructure and compiler coverage.
3. Local login check, optimistic send, one-step new thread.
4. Persistent shell, query cache, hover prefetch.
5. Thread state table and single history build.
6. Self-hosted Convex, migration and backups.
7. Cold-load polish.
8. Decided later from phase 0's numbers: windowed rendering of long threads, streaming thinking text, long-lived provider connections.

Phases 1 and 2 belong together: landing the stream split first makes the rendering work verifiable per real update.

### Network (phase 0)

- My devices use the tailnet: with Tailscale on, the same hostname resolves to the Mac directly. This needs no code.
- Taking tally.chat off the public internet is an open decision (see Further Notes): Funnel is enabled per port, not per path, and tally.chat shares its port with the router and search paths.

### Reply timing log (phase 0, permanent)

- The generate action logs one line per step when it finishes: queue wait (from the step being queued to the action starting), input time, time to the provider's first event, time to the first saved text, total, and the final status.
- The step input returns when the step was queued (the step start time, or the message's creation time for the first step).

### Streaming text (phase 1, ADR 0004)

- A new table holds one row per streaming reply: the message it belongs to and the text so far, indexed by message.
- The row is created with the reply (on send, retry and each new tool-loop step) and deleted by the finalizing mutation in the same transaction that writes the text onto the message (content, or the parts when the reply goes on to tools). No moment shows the text twice or not at all.
- The thread query returns a message's stored content only. It never reads the streaming row, so a flush doesn't re-run it.
- A new public query returns a message's streaming text for its owner, or null once the step has ended. The client subscribes only for the branch's last message while it is streaming.
- A new internal mutation appends a flush to the row and returns whether Stop was requested, so each flush is one round trip instead of two. The step input also returns the stop flag, replacing the separate check before the provider call.
- Flushing stays at 100 ms and in line with the token stream. Writing chunks in the background on a timer was considered and dropped: it changes which text a stopped reply keeps, for an estimated 2-20 ms per flush.
- The stuck-reply sweep reads the row's text when closing a reply. Thread deletion removes any row left.
- The persistent-text-streaming component is removed. The messages table keeps its old stream id field as optional legacy, never written, so existing documents still validate.
- ADR 0004 records the decision and its rejected options (keep the component; read the stream inside the thread query; HTTP-action streaming to the sending tab). ADR 0002 notes that its streaming choice is superseded.

### Thread page (phase 2)

- The thread page splits into a memoized message row taking primitive or stable props, a composer that owns its draft, and stable derived values (break costs, thread model).
- Unchanged message objects are reused across query updates, keyed by message id and compared on the fields a row renders, so rows whose message didn't change keep their identity.
- The three React Compiler bailouts are fixed: the try/catch in the thread page's send handler, the new-thread page's equivalent, and the model picker's internal error.
- A compiler coverage script runs the compiler over every component and fails on any bailout or error. It runs as part of the lint command (there is no CI).
- Per-row "Retry with" menus, model pickers and reply-details popovers mount on first open.

### Login check, sending, new thread (phase 3)

- The middleware keeps its token refresh exactly as today. Only the redirect decision changes: it reads the login token from the cookie and checks its expiry locally, without verifying the signature and without calling Convex. That is safe because the redirect only picks which page to render; Convex verifies the token on every query and mutation.
- The redirect decision is a pure function of the cookie and the current time.
- Send uses a Convex optimistic update: the user message and a streaming placeholder are added to the thread query's local result, and the composer clears. Placeholder ids never reach a mutation or an action. On failure the optimistic update is rolled back, the text returns to the composer, and the existing error toast shows.
- A new mutation creates a thread and sends its first message in one transaction; the client navigates to the thread when it returns. Thread ids stay server-generated.

### Shell and cache (phase 4)

- Every page that shows the sidebar moves under one shared layout: home, thread, usage, providers, tools and import. Sign-in stays outside.
- A query cache provider keeps subscriptions alive for 30 minutes after their component unmounts.
- Hovering a thread link in the sidebar subscribes to that thread's query through the cache.
- Keepalive is driven only by explicit presence, never by an open subscription, so cached threads don't count as being in the thread.

### Thread state and history (phase 5)

- Presence and cache bookkeeping (last active time, cache touch time and lifetime, keepalive job ids) move from the thread to a new per-thread state table, read only by the functions that need them. The thread query, the inspector and the thread list stop re-running when they change.
- A migration moves existing values, following the existing migrations pattern.
- The inspector builds the history once per run and reuses it. The thread query looks up only the latest checkpoint on the branch instead of assembling the whole history.

### Self-hosted Convex (phase 6)

- The self-hosted backend from the existing Docker setup runs on the Mac. Its two ports are exposed over tailnet-only Serve as HTTPS on 8443 (API) and 8444 (site), and those URLs are baked into the build as the public Convex URLs.
- Data moves with a Convex export from the cloud deployment and an import into the self-hosted one. The cloud deployment stays untouched for 30 days, then is deleted.
- A nightly launchd job exports the data into a backups folder in my home directory, keeps 14 days, and logs failures. The self-hosting guide documents it.

### Cold load (phase 7)

- KaTeX and its stylesheet load on demand when a message contains math. Until loaded, math renders as monospace source.
- One KaTeX version is enforced with a package override.
- Animation uses the lazy-loading variant of the motion library. Only the sans font is preloaded. The cache-status dot animates only compositor-friendly properties. Finished messages use `content-visibility: auto`.

### Schema changes

- New table for streaming text (message, text), indexed by message.
- New per-thread state table for presence and cache bookkeeping (phase 5); those fields leave the thread after migration.
- The messages table's stream id stays optional and unused.

## Testing Decisions

- **Good tests check behavior at a public seam**, not implementation details: what a query returns, what a mutation changes, what a request contained, what the redirect decides.
- **Seam 1, the existing one: public Convex functions under convex-test** with the fake provider at the HTTP boundary.
  - A flush leaves the thread query's result unchanged (the regression guard for the main cost).
  - The streaming text query returns the text so far mid-stream, and null after the step ends; the message then holds the full text.
  - A reply in a tool loop keeps each step's text in its parts, and the next step streams into a fresh row.
  - Stop requested mid-stream is seen at the next flush and keeps the text so far.
  - The stuck-reply sweep closes a reply with the row's text; deleting a thread leaves no streaming rows; a finished reply leaves no streaming row.
  - The one-step new-thread mutation creates the thread and the streaming reply together.
  - Presence and keepalive updates don't change the thread query's result (phase 5); the inspector's output is unchanged by the single history build.
- **Seam 2, new and small: the redirect decision as a pure function**, tested like the existing lib tests: valid, expired, malformed and missing tokens, and the sign-in page itself.
- **Seam 3, new: the compiler coverage script**, which is its own test and fails lint on a bailout.
- **Not committed as tests:** rendering speed (rows, composer, shell, cache, windowing) and infrastructure (tailnet, self-hosting, backups). Each pull request carries before and after numbers from a temporary harness or a manual checklist instead.
- **Prior art:** the streaming, reload and stop tests and the stuck-reply sweeper tests; the thread deletion tests; the keepalive and presence tests; the inspector tests; the pure lib tests such as the math delimiter and markdown block tests.

## Out of Scope

- Moving to TanStack Start or a Vite single-page app (saves about 38 KB gzip per cold load).
- Local-first sync (Dexie, TanStack DB, Zero, PowerSync).
- Keeping visited threads mounted with React's Activity, or `cacheComponents`.
- Full list virtualization (breaks find-in-page and scroll-to-message).
- Brotli, HTTP/3, and Bun versus Node for the server.
- Moving provider calls out of Convex, and streaming over an HTTP action to the sending tab.
- A service worker app shell (only pays off for devices without Tailscale).
- Changing the flush interval, replacing the AI SDK, the Agent component, MCP connection pooling, another Convex region, a VPS.

## Further Notes

- **Open decision, phase 0:** Funnel is per port, not per path. To take tally.chat off the public internet while keeping the router and search paths on Funnel, one side has to move to another port: either tally.chat moves to a tailnet-only port (its URL changes), or the router and search move to another Funnel port (their URLs change). Until decided, tally.chat stays on Funnel; my devices already bypass the relay over the tailnet.
- Several gains are estimates, not measurements: the phone launch total, the optimistic-send gain, instant revisits, the client-side gain of the stream split, and the provider-connection gain. Phase 0's timing log exists to check them.
- Once Convex is local (phase 6), the local login check and the query cache matter less, and client rendering becomes the main remaining cost. Stop after phase 4 or 6 if the numbers say the app is fast enough.
- No new glossary terms were needed.
