// Money and token formatting for the cost layer (design doc section 12).

// Per-turn amounts: 4 significant digits; totals of $1 or more: 2 decimals.
export const usd = (micro: number) =>
  `${micro < 0 ? "-" : ""}$${Math.abs(micro) >= 1e6 ? (Math.abs(micro) / 1e6).toFixed(2) : Number((Math.abs(micro) / 1e6).toPrecision(4))}`;

// 940, 12.4k, 1.2M.
export const tokens = (n: number) =>
  n < 1000
    ? String(Math.round(n))
    : n < 1e6
      ? `${Number((n / 1000).toFixed(1))}k`
      : `${Number((n / 1e6).toFixed(1))}M`;

// Rough token count for text not yet measured by a provider (characters ÷ 4).
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

type Usage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens5m: number;
  cacheWriteTokens1h: number;
  outputTokens: number;
  reasoningTokens: number;
};

// Everything the request sent: uncached input, cache reads and both cache writes.
export const totalInput = (u: Usage) =>
  u.inputTokens +
  u.cacheReadTokens +
  u.cacheWriteTokens5m +
  u.cacheWriteTokens1h;

// "Sonnet 5.5 · $0.0043 · 12.4k in (87% cached) · 340 out · 1.4k reasoning"
export function metaLine(
  model: string,
  costMicroUsd: number | undefined,
  u: Usage,
) {
  const input = totalInput(u);
  const cached = input > 0 ? Math.round((u.cacheReadTokens / input) * 100) : 0;
  return [
    model,
    costMicroUsd === undefined ? "cost unknown" : usd(costMicroUsd),
    `${tokens(input)} in${u.cacheReadTokens > 0 ? ` (${cached}% cached)` : ""}`,
    `${tokens(u.outputTokens)} out`,
    ...(u.reasoningTokens > 0
      ? [`${tokens(u.reasoningTokens)} reasoning`]
      : []),
  ].join(" · ");
}

// YYYY-MM-DD now in the owner's time zone (UTC until set): the same day the rollups use.
export const todayIn = (timeZone: string | null) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now());
