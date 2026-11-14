# 05: Cache status chip

**What to build:** The thread header's plain-text cache status becomes a chip: warm with a tooltip counting down to expiry, kept alive with a subtle pulse, or cold. It always pairs color with a label, and clicking it opens the inspector at its cache line. Spec: `docs/specs/phase-3-inspector-and-usage.md`, user stories 30 to 34.

**Blocked by:** 03 Inspector rail

**Status:** done (pending review)

- [x] Warm, kept alive and cold, judged on the client with the existing cache status helper, flipping live without a reload
- [x] The warm tooltip counts down to expiry
- [x] The kept-alive pulse is disabled under reduced motion
- [x] Color is never the only signal; contrast meets WCAG AA in both themes
- [x] Clicking opens the inspector scrolled to its cache line
- [x] Hidden on OpenAI-compatible threads, as today

**Note:** chip contrast measured at 4.97 to 8.47 against its background in both themes (AA needs 4.5).
