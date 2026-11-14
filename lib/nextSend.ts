// Roughly what the next send costs, in micro-dollars (spec phase 3, cost strip): the repeated
// history at the cache read price when warm, the cache write price when cold, or the input
// price where the provider caches on its own; plus the draft at the input price and a
// typical reply's output. null when the model has no price.
export type NextSendPrices = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} | null;

export function nextSendMicroUsd(a: {
  prices: NextSendPrices;
  history: "warm" | "cold" | "provider";
  prefixTokens: number;
  draftTokens: number;
  expectedOutputTokens: number | null;
}): number | null {
  const p = a.prices;
  if (!p) return null;
  const historyPrice =
    a.history === "warm"
      ? p.cacheRead
      : a.history === "cold"
        ? p.cacheWrite
        : p.input;
  const usd =
    a.prefixTokens * historyPrice +
    a.draftTokens * p.input +
    (a.expectedOutputTokens ?? 0) * p.output;
  return Math.round(usd * 1e6);
}
