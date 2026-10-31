# 10: Hard thread delete

**What to build:** The owner can delete a whole thread for real: its messages, checkpoints and stream data are removed. Daily spend totals still include what the thread cost. Single messages cannot be deleted. Spec: user stories 29, 30; ADR 0001 consequences.

**Blocked by:** 06 Metering and cost

**Status:** ready-for-agent

- [ ] Deleting a thread removes its messages, checkpoints and stream data
- [ ] Rollup totals are unchanged by the delete (test)
- [ ] No function exists to delete or hide a single message
- [ ] Deleting a thread with a reply still streaming stops the stream first
- [ ] Deleted threads are gone from every device's thread list
