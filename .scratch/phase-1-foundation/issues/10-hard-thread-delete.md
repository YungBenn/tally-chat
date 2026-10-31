# 10: Hard thread delete

**What to build:** The owner can delete a whole thread for real: its messages, checkpoints and stream data are removed. Daily spend totals still include what the thread cost. Single messages cannot be deleted. Spec: user stories 29, 30; ADR 0001 consequences.

**Blocked by:** 06 Metering and cost

**Status:** done (pending review)

- [x] Deleting a thread removes its messages, checkpoints and stream data
- [x] Rollup totals are unchanged by the delete (test)
- [x] No function exists to delete or hide a single message
- [x] Deleting a thread with a reply still streaming stops the stream first
- [x] Deleted threads are gone from every device's thread list
