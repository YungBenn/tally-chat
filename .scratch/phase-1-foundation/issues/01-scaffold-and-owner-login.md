# 01: Scaffold and owner login

**What to build:** A running tally.chat app (Next.js + Convex) that the instance owner can claim with a password on first run, then log in and out of. Setup can never be repeated once done. Lays down the `ownerId` convention and the test harness every later ticket uses. Spec: `docs/specs/phase-1-foundation.md`, user stories 1 to 5.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] First visit to a fresh instance shows password setup; submitting it creates the single owner account
- [ ] After setup, the setup path is closed: a second attempt is refused server-side, not just hidden in the UI
- [ ] Owner can log in, stays logged in across reloads, and can log out
- [ ] Every Convex function except setup and login rejects unauthenticated calls
- [ ] Schema convention established: every owned table carries `ownerId`
- [ ] Test harness in place: `convex-test` plus a fake fetch that replays recorded provider responses and captures outgoing request bodies, with one passing example test
- [ ] MIT LICENSE file present
