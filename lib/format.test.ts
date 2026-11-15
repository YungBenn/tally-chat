import { expect, test } from "vitest";
import { metaLine, tokens, usd } from "./format";

test("formats money, tokens and the metadata line like the design doc", () => {
  expect([usd(4321), usd(1_234_567), usd(0), usd(-1800)]).toEqual([
    "$0.004321",
    "$1.23",
    "$0",
    "-$0.0018",
  ]);
  expect([tokens(940), tokens(12_400), tokens(1_200_000)]).toEqual([
    "940",
    "12.4k",
    "1.2M",
  ]);
  const usage = {
    inputTokens: 1240,
    cacheReadTokens: 10_800,
    cacheWriteTokens5m: 360,
    cacheWriteTokens1h: 0,
    outputTokens: 340,
    reasoningTokens: 1430,
  };
  expect(metaLine("Sonnet 5.5", 4300, usage)).toBe(
    "Sonnet 5.5 · $0.0043 · 12.4k in (87% cached) · 340 out · 1.4k reasoning",
  );
  expect(
    metaLine("Local", undefined, {
      ...usage,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    }),
  ).toBe("Local · cost unknown · 1.6k in · 340 out");
  expect(metaLine("Sonnet 5.5", 4300, usage, "low")).toBe(
    "Sonnet 5.5 (low) · $0.0043 · 12.4k in (87% cached) · 340 out · 1.4k reasoning",
  );
});
