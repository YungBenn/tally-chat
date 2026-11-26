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
const MAX_RESULTS = 6;
// queries: every query run, query being the first; absent on searches from before rewriting.
// costMicroUsd: what Exa reported the search cost; absent when it reported none.
// rewriteCostMicroUsd: what the query rewrite cost, when it ran and was priced.
export type StoredSearch = {
  query: string;
  queries?: string[];
  results: SearchResult[];
  error?: string;
  costMicroUsd?: number;
  rewriteCostMicroUsd?: number;
  // Absent is format 1; searches are written as format 2 (SEARCH_FORMAT).
  format?: number;
};
export const SEARCH_FORMAT = 2;

// The raw message as the query: what a failed rewrite falls back to.
export const searchQuery = (text: string) => text.slice(0, 300);

export const REWRITE_SYSTEM =
  "You write web search queries. Given the recent conversation and the user's new message, reply with a JSON array of one to three standalone search queries that find what the new message needs. Each query must make sense without the conversation. Use several queries only when the message asks about separate things. Reply with the JSON array only.";
export const REWRITE_TURNS = 6; // messages of the branch the rewrite reads
export const REWRITE_EXCERPT = 1500; // characters of each
export const REWRITE_MAX_TOKENS = 512; // thinking models spend tokens before the array, like a title
export const REWRITE_TIMEOUT_MS = 5000;

export function rewritePrompt(turns: { role: "user" | "assistant"; text: string }[], message: string, date?: string): string {
  return [
    ...(date ? [`Today's date: ${date}`, ""] : []),
    "Recent conversation:",
    ...turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.slice(0, REWRITE_EXCERPT)}`),
    "",
    `New message: ${message.slice(0, REWRITE_EXCERPT)}`,
  ].join("\n");
}

// One to three queries from the rewrite's reply, each clipped to 300 characters; null when the
// reply is not a JSON array with a usable query (the caller falls back to the raw message).
export function parseQueries(text: string): string[] | null {
  // The model may wrap the array in a code fence or a sentence.
  const array = text.match(/\[[\s\S]*\]/)?.[0];
  if (!array) return null;
  try {
    const parsed: unknown = JSON.parse(array);
    if (!Array.isArray(parsed)) return null;
    const queries = parsed
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 3);
    return queries.length ? queries : null;
  } catch {
    return null;
  }
}

// Each query's results in query order, a URL once, at most six.
export function mergeResults(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((r) => !seen.has(r.url) && seen.add(r.url))
    .slice(0, MAX_RESULTS);
}

// What a search adds before it runs: 6 results with up to 1,500-character passages, about
// 3,000 tokens.
// ponytail: a fixed guess for unsent and unmeasured turns; measured usage replaces it after.
export const SEARCH_TOKENS_ESTIMATE = 3000;
// What Exa charges for a search before it reports the cost: $0.007 for an auto search with
// highlights, as measured.
// ponytail: a fixed guess; Exa's prices or a deep search can cost more, so read it from the
// last stored searches if the estimate drifts.
export const SEARCH_FEE_MICRO_USD_ESTIMATE = 7000;
const MAX_SNIPPET = 1500; // also the highlights budget asked of Exa
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
      body: JSON.stringify({ query, type: "auto", numResults: MAX_RESULTS, contents: { highlights: { query, maxCharacters: MAX_SNIPPET } } }),
      // The reply waits on the search, so a stalled Exa can't hold it for long.
      signal: AbortSignal.timeout(15_000),
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
    if (err instanceof DOMException && err.name === "TimeoutError")
      return { query, results: [], error: "Exa didn't answer within 15 seconds" };
    return { query, results: [], error: err instanceof Error && err.message ? err.message : "Could not reach Exa" };
  }
}

// What the model sees with the message: after its text for format 1 searches, before it for
// format 2 (so the question ends the message). Changing this text changes the bytes of every
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
  const open = search.format === undefined ? `query=${JSON.stringify(search.query)}` : `queries=${JSON.stringify(search.queries ?? [search.query])}`;
  return [`<web_search ${open}>`, ...body, "</web_search>"].join("\n");
}
