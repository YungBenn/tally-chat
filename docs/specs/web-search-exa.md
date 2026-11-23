# Spec: Web search on Exa

Status: ready-for-agent · Replaces the SearXNG backend from [phase 9](../tallychat-design-doc.md) web search · Respects [ADR 0001](../adr/0001-append-only-message-tree.md) and [ADR 0002](../adr/0002-convex-backend.md)

## Problem Statement

Web search only works on a SearXNG I run myself. That means an extra container, a `settings.yml` that must enable JSON or every search fails with HTTP 403, and results that thin out or vanish whenever Google or another upstream engine blocks it for a while. The snippets are whatever the engines happened to return, not passages picked for my question.

I want web search to run on Exa, a search API built for feeding models, with nothing to host. And because Exa is paid, I want what it costs to show up in my spend and count against my daily budget, like every other call tally.chat makes.

## Solution

SearXNG goes away completely: no bundled service, no URL setting, no docs for it. Settings → Web search instead holds an **Exa API key**. I paste it once; it is encrypted like a provider key and never sent back to the browser. With a key saved, the composer's Search toggle appears, and a message sent with it on is searched on Exa before the reply, exactly as today: up to six results (title, link and a short passage Exa picked for the query) go to the model with the message, and the sources show under it.

Each search's cost, as Exa reports it, is metered: it shows on the sources line, adds to the thread's total spend in the inspector, appears in the usage page (daily spend and an "exa-search" line in the per-model breakdown) and counts toward the daily budget. A failed search costs nothing and says why, in Exa's own words ("Invalid API key", out of credits).

## User Stories

### Key

1. As a user, I want to paste an Exa API key in Settings → Web search, so that web search works without hosting anything.
2. As a user, I want the key encrypted at rest with the same master key as provider keys, so that a database dump doesn't leak it.
3. As a user, I want the key never sent to the browser, so that nothing on the client can read it.
4. As a user, I want the settings row to tell me a key is saved without showing it, so that I know search is set up.
5. As a user, I want to replace the key by pasting a new one, so that rotating it is one step.
6. As a user, I want a Remove button that clears the key, so that I can turn web search off.
7. As a user, I want the key saved on Enter or when I leave the field, like the other settings, so that it behaves consistently.
8. As a user, I want saving the key not to run a paid test search, so that pasting a key costs nothing.
9. As a user, I want leading and trailing whitespace trimmed from the pasted key, so that a sloppy paste still works.
10. As a user, I want the settings row to link to Exa's dashboard and say each search costs about a cent and counts toward spend, so that I know what I'm turning on.
11. As a user, I want the settings search to find this row for "exa", "search", "web" and "api key", so that I can get to it quickly.

### Searching

12. As a user, I want the Search toggle offered only while a key is saved, so that I never send a search that can't run.
13. As a user, I want sending with search on and no key saved to be refused with "Add an Exa API key in Settings to search the web", so that the fix is obvious.
14. As a user, I want my message searched on Exa before the reply, so that the model answers with current information.
15. As a user, I want up to six results, each with a title, link and a short passage relevant to my question, so that the model gets useful context without a flood of tokens.
16. As a user, I want each passage capped at 300 characters, so that a search adds roughly the same tokens as before.
17. As a user, I want a result without a title shown by its URL, so that every source is still identifiable.
18. As a user, I want results with broken links (no host) skipped and the next good ones used, so that every source is clickable.
19. As a user, I want the results stored once and sent with the same bytes on every later request, so that retries and later turns keep the cache.
20. As a user, I want a retry or a later turn to reuse the stored search rather than search again, so that I'm not charged twice.
21. As a user, I want editing a searched message to search again for the new text, so that results match what I asked.
22. As a user, I want the "Searching the web…" state while the search runs, so that I know why the reply hasn't started.
23. As a user, I want the sources under my message, numbered and linked, so that I can check what the model read.

### Failures

24. As a user, I want a failed search to still get a reply, told that the search failed, so that one bad call doesn't block me.
25. As a user, I want the failure reason to include Exa's message, such as "HTTP 401: Invalid API key", so that I know whether to fix the key, top up credits or wait.
26. As a user, I want a network failure reported as such, so that I can tell it apart from a bad key.
27. As a user, I want a failed search to cost nothing in my spend, so that the numbers match what Exa bills.
28. As a user, I want removing the key after sending but before the search runs to fail that search with "web search is off", so that nothing runs without a key.

### Cost

29. As a user, I want each successful search's cost taken from what Exa reports, so that spend matches my Exa bill.
30. As a user, I want the search cost shown on the sources line under the message, so that I see what that search cost next to what it found.
31. As a user, I want search cost included in the thread's total spend in the inspector, so that the thread total is honest.
32. As a user, I want the reply's own cost to stay model-only, so that a reply's cost still means what the model cost.
33. As a user, I want search spend in the usage page's daily totals, so that daily spend includes everything.
34. As a user, I want an "exa-search" line in the usage page's per-model breakdown with its calls and cost, so that I can see what search costs me over time.
35. As a user, I want search spend counted toward my daily budget, so that the budget really caps what I spend.
36. As a user, I want search spend from a deleted thread to keep counting in the usage page, like other spend, so that history stays accurate.
37. As a user, I want a search whose response has no cost recorded as an unpriced call, so that I'm never shown a made-up number.
38. As a user, I want search cost not to move the thread's cache hit rate or savings, so that cache figures still describe caching.

### Self-hosting

39. As a self-hoster, I want the SearXNG container, its settings file and its lines in the start and stop scripts gone, so that there is nothing left to run or update.
40. As a self-hoster, I want upgrading with a SearXNG URL already saved to deploy without errors or a migration step, so that the upgrade is one deploy.
41. As a self-hoster, I want the docs to explain the Exa key setup, so that I can turn search on.
42. As a self-hoster, I want the docs to say that Exa sees my queries tied to my account, so that I know the privacy trade compared with SearXNG.

## Implementation Decisions

### Search backend

- The web search library module swaps its SearXNG client and parser for an Exa client and parser. Everything downstream of the stored search is unchanged: the stored shape (query, results of title/url/snippet, optional error), the `<web_search>` block text, the six-result cap, the 300-character snippet cap and the search token estimate of 900.
- Request: `POST https://api.exa.ai/search` with the key in the `x-api-key` header and body `{ query, type: "auto", numResults: 6, contents: { highlights: true } }`. The query stays the message text cut to 300 characters; no query rewriting.
- Parsing: keep results whose `url` is an absolute http(s) URL with a host; take the first six; title is the trimmed title or, when missing or empty, the URL; snippet is the result's highlights, trimmed and joined with " … ", then cut to 300 characters.
- A plain `fetch` replaces the URL guard: the host is a fixed public endpoint, so there is nothing for the guard or the private-host allowlist to check. The owner's search host no longer joins the allowlist.
- Non-2xx responses become `HTTP <status>: <message>` when Exa's error body has an `error` string, else `HTTP <status>`. Thrown errors keep their message, falling back to "Could not reach Exa".
- The search result carries the reported cost. Confirm the exact field name against a live response during implementation (Exa's docs show both `costDollars` and `cost_dollars`); the total is converted to micro-USD.

### Key storage

- A new optional `searchKeyEncrypted` field on the owner's settings, encrypted with the existing vault (AES-GCM under `TALLY_MASTER_KEY`), stored in the same format as provider keys.
- Saving goes through an action (encryption needs fresh randomness for the IV, which mutations don't give) that trims the key, encrypts it and writes it through an internal mutation. Empty text clears the field. No test call is made.
- The settings query returns `searchKeySet: boolean` in place of `searchUrl`; the key or its ciphertext never leaves the server.
- `setSearchUrl` is removed.

### Running a search

- The pending-search query returns the ciphertext (or null when no key is set) instead of a URL and allowlist. The reply action decrypts it and calls Exa; with no key it stores the existing "web search is off" failure.
- The send and edit paths check for a saved key instead of a URL. The send error becomes "Add an Exa API key in Settings to search the web".
- A decrypt failure (key saved under another master key) is stored as the search's error, so the reply still runs and the message says why.

### Metering

- Saving a successful search also meters it through the existing daily-rollup path with `providerId: "exa"`, `model: "exa-search"`, the message's thread as the thread key, all-zero usage, zero savings and the reported cost (null when absent, which counts as an unpriced call). Rollups and the stored search are written in the same mutation, so totals never drift from their searches.
- Because the budget sums provider rows, the usage page reads provider and model rows, and the inspector's thread total reads thread rows, search spend appears in all three with no further changes. Zero usage keeps hit rate and savings untouched.
- Failed searches write no rollups.
- The day is the owner's day at save time, as for other metered calls.

### Schema changes (additive)

- `settings.searchKeyEncrypted`: optional string.
- `settings.searchUrl`: kept as an optional field, marked legacy and unused, so deployments with a saved URL still pass schema validation. Nothing reads or writes it.
- `searches.costMicroUsd`: optional number, present on successful searches whose response reported a cost.

### UI

- Settings → Web search: the "SearXNG URL" row becomes "Exa API key": a mono password input (`autoComplete="off"`) that saves on Enter or blur through the save action. With a key saved, its placeholder reads "Key saved - paste a new one to replace" and a ghost Remove button clears it. The help text links to Exa's dashboard, says each search costs about a cent and counts toward spend, and drops the docker command. The section's search terms become "exa api key internet".
- The composer's Search toggle availability comes from `searchKeySet`.
- The sources line under a searched message appends the search cost (" · $0.007" style, using the existing USD formatter) when one was recorded.
- The inspector's "Total spend" caption gains "searches" in its list of what it covers.

### Removals

- The `searxng` service and its comments in the compose file, the `selfhost/searxng` directory, and SearXNG in the self-host start and stop scripts and their header comments.
- SearXNG sections and mentions in the README (feature list, setup line, phase table wording) and the self-hosting guide, replaced by the Exa key setup and the privacy note.

## Testing Decisions

- Good tests here exercise external behavior only: Convex functions called as the owner, with Exa faked at the HTTP boundary, asserting on what the model receives, what the thread view returns, the rollups and the budget. No assertions on internal helpers beyond the pure parser.
- **Web search integration tests** (the existing suite, moved from SearXNG fixtures to an Exa fixture keyed by `POST https://api.exa.ai/search`):
  - saving trims and stores the key encrypted; `settings.get` returns only `searchKeySet`, and no returned field contains the key or ciphertext; empty text and Remove clear it.
  - searching needs a key first, with the new error text.
  - the Exa request carries the key header and the agreed body.
  - results are sent with the message in the unchanged `<web_search>` block and shown as sources; retries and later turns reuse them byte for byte; deleting the thread removes stored searches; an edit searches again.
  - a 401 with Exa's error body yields "HTTP 401: Invalid API key" in both the model's block and the message's search status, and the reply still completes; a bare 502 yields "HTTP 502".
  - a successful search's reported cost lands on the search, in the thread total, in the usage summary's daily spend and model breakdown, and pushes the budget to reached when it crosses the limit; a failed search adds nothing; a response with no cost counts one unpriced call.
  - a saved legacy `searchUrl` doesn't break settings reads.
- **Parser unit tests** (the existing file next to the library module): host-less URLs skipped and refilled to six; highlights trimmed and joined; snippet cut at 300 characters with an ellipsis; missing title falls back to the URL.
- Prior art: the current web search integration suite (convex-test plus the fake fetch and SSE helpers), the budget and rollup suites for asserting spend, and the provider suites for asserting encrypted keys stay server-side.
- The Settings row and sources-line cost are checked by hand in the running app; no new UI test seam.

## Out of Scope

- Keeping SearXNG, or choosing between search backends.
- Model-driven search as a tool call; search stays a pre-reply step on the user's toggle.
- Rewriting the message into a better query.
- Exa's `deep` and `lite` types, summaries, full page text, domain or date filters.
- Testing the key on save.
- A separate "search" rollup dimension or usage-page section.
- Deleting the legacy `searchUrl` field from stored settings.

## Further Notes

- Exa prices searches dynamically, around $0.007 to $0.015 each at the time of writing; the reported cost, not a table, is the source of truth.
- If search latency before the first token becomes a problem, switching `type` to `lite` is a one-word change.
- The glossary has no web search terms today; "search cost" here means the metered Exa charge for one stored search.
