import { describe, expect, test } from "vitest";
import { costMicroUsd, normalizeAnthropicUsage, priceFor } from "./usage";

describe("normalizeAnthropicUsage", () => {
  test("treats cache writes without a TTL breakdown as 5-minute writes", () => {
    const { usage } = normalizeAnthropicUsage({ input_tokens: 10, cache_creation_input_tokens: 300, output_tokens: 5 });
    expect(usage).toMatchObject({ inputTokens: 10, cacheWriteTokens5m: 300, cacheWriteTokens1h: 0, outputTokens: 5 });
  });

  test("reads thinking tokens when reported", () => {
    const { usage, reports } = normalizeAnthropicUsage({ output_tokens: 900, output_tokens_details: { thinking_tokens: 700 } });
    expect(usage.reasoningTokens).toBe(700);
    expect(reports).toEqual({ caching: false, reasoning: true });
  });
});

describe("prices and cost", () => {
  test("overrides win field by field over the synced table", () => {
    const tables = [{ models: { m: { input: 1e-6, output: 2e-6 } } }, { models: { m: { output: 3e-6 } } }];
    expect(priceFor("m", tables)).toEqual({ input: 1e-6, output: 3e-6 });
    expect(priceFor("missing", tables)).toBeNull();
  });

  test("cost is unknown when a billed token class has no price", () => {
    const usage = { inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens5m: 0, cacheWriteTokens1h: 0, outputTokens: 1, reasoningTokens: 0 };
    expect(costMicroUsd(usage, { input: 1e-6, output: 1e-6 })).toBeNull();
    expect(costMicroUsd({ ...usage, cacheReadTokens: 0 }, { input: 1e-6, output: 1e-6 })).toBe(11);
    expect(costMicroUsd(usage, null)).toBeNull();
  });

  test("the synced table prices current Claude models with both cache write lifetimes and their context window", () => {
    expect(priceFor("claude-sonnet-5-5")).toEqual({ input: 2e-6, output: 1e-5, cacheRead: 1e-7, cacheWrite5m: 2.5e-6, cacheWrite1h: 4e-6, contextWindow: 1_000_000 });
  });
});
