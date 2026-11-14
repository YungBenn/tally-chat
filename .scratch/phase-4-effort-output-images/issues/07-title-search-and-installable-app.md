# 07: Title search and installable app

**What to build:** A search box above the thread list filters my threads by title as I type, and Escape or a clear button brings the full list back. Separately, tally.chat installs as an app from the browser, with its own name and icon, opening at the thread list. Spec: `docs/specs/phase-4-effort-output-images.md`, user stories 32 to 38; Implementation Decisions "Title search" and "Install (PWA)".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A search index on thread titles filtered by owner; one owner-only query returns at most 20 matches
- [ ] The sidebar's search box filters as you type (debounced); Escape and a clear button reset it; message contents are never searched
- [ ] A web app manifest (name, short name, icons at the required sizes, standalone display, start at the thread list, light and dark theme colors) and the iOS head tags
- [ ] No service worker and no offline mode
- [ ] Tests cover search results and the owner filter
- [ ] Checked in the browser: searching, clearing, and the manifest and icons being served
