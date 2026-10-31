import { v, type Infer } from "convex/values";
import generated from "./prices.generated.json";
import overrides from "./priceOverrides.json";

// One usage shape for every provider (design doc S10). inputTokens is always uncached input.
export const usageValidator = v.object({
  inputTokens: v.number(),
  cacheReadTokens: v.number(),
  cacheWriteTokens5m: v.number(),
  cacheWriteTokens1h: v.number(),
  outputTokens: v.number(), // includes reasoning tokens, which bill at output rates
  reasoningTokens: v.number(), // 0 when the provider does not report them separately
});
export type Usage = Infer<typeof usageValidator>;
export const USAGE_FIELDS = Object.keys(usageValidator.fields) as (keyof Usage)[];

export type AnthropicUsage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
};

export function normalizeAnthropicUsage(raw: AnthropicUsage) {
  const writes = raw.cache_creation_input_tokens ?? 0;
  const w1h = raw.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // Without the TTL breakdown every write is the default 5-minute lifetime.
  const w5m = raw.cache_creation?.ephemeral_5m_input_tokens ?? writes - w1h;
  const usage: Usage = {
    inputTokens: raw.input_tokens ?? 0,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheWriteTokens5m: w5m,
    cacheWriteTokens1h: w1h,
    outputTokens: raw.output_tokens ?? 0,
    reasoningTokens: raw.output_tokens_details?.thinking_tokens ?? 0,
  };
  return {
    usage,
    reports: {
      caching: raw.cache_read_input_tokens !== undefined,
      reasoning: raw.output_tokens_details?.thinking_tokens !== undefined,
    },
  };
}

// USD per token, from the vendored LiteLLM table with priceOverrides.json winning field by field.
type Price = { input?: number; output?: number; cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number };
type PriceTable = { models: Record<string, Price> };

export function priceFor(model: string, tables: PriceTable[] = [generated, overrides]): Price | null {
  const found = tables.map((t) => t.models[model]).filter((p) => p !== undefined);
  return found.length ? Object.assign({}, ...found) : null;
}

// Integer micro-dollars, or null when any billed token class has no price: never a guess.
export function costMicroUsd(usage: Usage, price: Price | null): number | null {
  if (!price) return null;
  const parts: [number, number | undefined][] = [
    [usage.inputTokens, price.input],
    [usage.cacheReadTokens, price.cacheRead],
    [usage.cacheWriteTokens5m, price.cacheWrite5m],
    [usage.cacheWriteTokens1h, price.cacheWrite1h],
    [usage.outputTokens, price.output],
  ];
  if (parts.some(([tokens, perToken]) => tokens > 0 && perToken === undefined)) return null;
  return Math.round(parts.reduce((sum, [tokens, perToken]) => sum + tokens * (perToken ?? 0), 0) * 1e6);
}
