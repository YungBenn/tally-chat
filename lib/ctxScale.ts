// The context bar's ruler (design system: ContextBar): a round scale just above what's used, so a
// small context still fills a readable share of the bar ("zoom the scale when usage is small").
// 1, 2 or 5 times a power of ten, at least 1k, with 5% headroom.
export function ctxScale(usedTokens: number) {
  const need = Math.max(1000, usedTokens * 1.05);
  let pow = 1000;
  for (;;) {
    for (const m of [1, 2, 5]) if (m * pow >= need) return m * pow;
    pow *= 10;
  }
}
