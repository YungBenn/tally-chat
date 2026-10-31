# 03: Owner presence

**What to build:** A thread records when the owner was last active in it: the tab is focused and visible, or the owner is typing. This is what keepalive uses to decide whether anyone is still there. Spec: user story 12; Implementation Decisions "Keepalive: Presence".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A public, owner-only mutation records `lastActiveAt` on a thread
- [ ] The thread page calls it when the tab gains focus, when the owner types in the composer or an edit box, and at most once a minute while the tab stays focused and visible
- [ ] A hidden or unfocused tab sends nothing
- [ ] Calls are throttled client-side so typing doesn't send a mutation per keystroke
- [ ] Marking activity on a deleted or foreign thread is refused or ignored without error noise in the UI
