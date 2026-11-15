// The smallest of 1, 2 or 5 times a power of ten that is at least `v` (chart axes, rulers).
export function niceCeil(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * pow >= v * (1 - 1e-9)) return m * pow;
  return 10 * pow;
}

// The context bar's ruler (design system: ContextBar): a round scale just above what's used, so a
// small context still fills a readable share of the bar ("zoom the scale when usage is small").
// At least 1k, with 5% headroom.
export const ctxScale = (usedTokens: number) => niceCeil(Math.max(1000, usedTokens * 1.05));
