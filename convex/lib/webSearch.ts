import { v, type Infer } from "convex/values";

// Web search: before a reply, search Exa for the user's message and
// send the results with it. Results are stored once and rendered the same way on every later
// request, so the message's bytes, and the cache built on them, never change.

export const searchResultValidator = v.object({
  title: v.string(),
  url: v.string(),
  snippet: v.string(),
});
export type SearchResult = Infer<typeof searchResultValidator>;
// costMicroUsd: what Exa reported the search cost; absent when it reported none.
export type StoredSearch = { query: string; results: SearchResult[]; error?: string; costMicroUsd?: number };

// ponytail: the message text is the query; rewriting it into a better query costs a model call.
export const searchQuery = (text: string) => text.slice(0, 300);

const MAX_RESULTS = 6;
// What a search adds before it runs: 6 results with 300-character snippets measured
// about 870 tokens.
// ponytail: a fixed guess for unsent and unmeasured turns; measured usage replaces it after.
export const SEARCH_TOKENS_ESTIMATE = 900;
const MAX_SNIPPET = 300;
const clip = (s: string) => (s.length > MAX_SNIPPET ? `${s.slice(0, MAX_SNIPPET - 1)}…` : s);

export function parseExa(json: unknown): SearchResult[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is { title?: unknown; url: string; highlights?: unknown } => typeof r?.url === "string")
    // Links without a host are useless as a source and a waste of tokens, so skip them before
    // taking the first few.
    .filter((r) => /^https?:\/\/[^/\s]/i.test(r.url))
    .slice(0, MAX_RESULTS)
    .map((r) => {
      const title = typeof r.title === "string" ? r.title.trim() : "";
      const highlights = Array.isArray(r.highlights) ? r.highlights.filter((h): h is string => typeof h === "string") : [];
      return {
        title: title || r.url,
        url: r.url,
        snippet: clip(highlights.map((h) => h.trim()).filter(Boolean).join(" … ")),
      };
    });
}

// Exa's search API. Its host is fixed and public, so a plain fetch needs no URL guard.
export async function searchExa(apiKey: string, query: string): Promise<StoredSearch> {
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query, type: "auto", numResults: MAX_RESULTS, contents: { highlights: true } }),
    });
    if (!res.ok) {
      // Exa's error body is { error: "Invalid API key" } and the like.
      const message = await res.json().then((b: { error?: unknown }) => b?.error, () => undefined);
      return { query, results: [], error: typeof message === "string" && message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}` };
    }
    const json = await res.json();
    const cost = (json as { costDollars?: { total?: unknown } })?.costDollars?.total;
    return {
      query,
      results: parseExa(json),
      ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { costMicroUsd: Math.round(cost * 1e6) } : {}),
    };
  } catch (err) {
    return { query, results: [], error: err instanceof Error && err.message ? err.message : "Could not reach Exa" };
  }
}

// What the model sees after the message text. Changing this text changes the bytes of every
// searched message, so treat it like a system prompt.
export function searchBlock(search: StoredSearch): string {
  const body = search.error
    ? [`The web search failed (${search.error}), so there are no results.`]
    : search.results.length === 0
      ? ["The web search returned no results."]
      : [
          "Results of a web search run for this message. Use them where they help, and cite sources by URL.",
          ...search.results.flatMap((r, i) => ["", `[${i + 1}] ${r.title}`, r.url, ...(r.snippet ? [r.snippet] : [])]),
        ];
  return [`<web_search query=${JSON.stringify(search.query)}>`, ...body, "</web_search>"].join("\n");
}
