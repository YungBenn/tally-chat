# 11: Side-job titles

**What to build:** The owner picks a side-job model in settings; after the first reply in a thread, a title is generated on that model and the call is metered as a side job. Spec: user stories 31, 40; design doc S6 "Side jobs".

**Blocked by:** 06 Metering and cost

**Status:** done (pending review)

- [x] Settings hold a side-job model; if unset, it defaults to the cheapest model of the thread's provider
- [x] After the first assistant reply, a title is generated on the side-job model and saved on the thread
- [x] The title call's usage and cost are recorded as a side job (`sideJobs` table)
- [x] Side-job spend appears in the rollups
- [x] A failed title call leaves a fallback title and does not affect the chat
