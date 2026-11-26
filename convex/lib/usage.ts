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

// A reply's usage is the sum of its steps' (spec phase 10); with one step it is that step's.
export const sumUsage = (steps: Usage[]): Usage => {
  const total = Object.fromEntries(USAGE_FIELDS.map((f) => [f, 0])) as Usage;
  for (const s of steps) for (const f of USAGE_FIELDS) total[f] += s[f];
  return total;
};
// undefined when any step has no price: a partial cost would be a guess.
export const sumCost = (costs: (number | undefined)[]) =>
  costs.some((c) => c === undefined) ? undefined : costs.reduce<number>((a, c) => a + c!, 0);

export type AnthropicUsage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
};

export type NormalizedUsage = {
  usage: Usage;
  reports: { caching: boolean; reasoning: boolean };
  reportedCostMicroUsd?: number; // a provider-reported cost (OpenRouter) wins over the price table
};

export function normalizeAnthropicUsage(raw: AnthropicUsage): NormalizedUsage {
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

// Raw usage from OpenAI-compatible APIs. Fields vary by provider: OpenAI, Groq and
// OpenRouter nest cache counts in prompt_tokens_details; DeepSeek reports hit/miss.
export type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_cache_hit_tokens?: number;
  cost?: number; // OpenRouter, USD
};

export function normalizeOpenAIUsage(raw: OpenAIUsage): NormalizedUsage {
  const cached = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens;
  const writes = raw.prompt_tokens_details?.cache_write_tokens ?? 0;
  const reasoning = raw.completion_tokens_details?.reasoning_tokens;
  return {
    usage: {
      // prompt_tokens counts cached and written tokens too; inputTokens is uncached only.
      inputTokens: Math.max(0, (raw.prompt_tokens ?? 0) - (cached ?? 0) - writes),
      cacheReadTokens: cached ?? 0,
      cacheWriteTokens5m: writes, // short-lived writes; providers name their own TTLs
      cacheWriteTokens1h: 0,
      outputTokens: raw.completion_tokens ?? 0,
      reasoningTokens: reasoning ?? 0,
    },
    reports: { caching: cached !== undefined, reasoning: reasoning !== undefined },
    ...(typeof raw.cost === "number" ? { reportedCostMicroUsd: Math.round(raw.cost * 1e6) } : {}),
  };
}

// USD per token, from the vendored LiteLLM table with priceOverrides.json winning field by field.
type Price = { input?: number; output?: number; cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number; contextWindow?: number; maxOutput?: number };
type PriceTable = { models: Record<string, Price> };

// A router or proxy may prefix the upstream model id ("cc/claude-sonnet-5-5"); when the full id
// isn't in the table, the id after the last "/" is priced instead.
export function priceFor(model: string, tables: PriceTable[] = [generated, overrides]): Price | null {
  const lookup = (id: string) => {
    const found = tables.map((t) => t.models[id]).filter((p) => p !== undefined);
    return found.length ? (Object.assign({}, ...found) as Price) : null;
  };
  const base = model.slice(model.lastIndexOf("/") + 1);
  return lookup(model) ?? (base && base !== model ? lookup(base) : null);
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

// What caching saved on one call, in integer micro-dollars: the read discount minus the write
// premiums, against paying base input for the same tokens. Negative when writes outweigh reads.
// 0 without the prices to tell (a missing input price, or a missing price for a class used).
export function cacheSavingsMicroUsd(usage: Usage, price: Price | null): number {
  if (price?.input === undefined) return 0;
  const parts: [number, number | undefined][] = [
    [usage.cacheReadTokens, price.cacheRead],
    [usage.cacheWriteTokens5m, price.cacheWrite5m],
    [usage.cacheWriteTokens1h, price.cacheWrite1h],
  ];
  if (parts.some(([tokens, perToken]) => tokens > 0 && perToken === undefined)) return 0;
  const input = price.input;
  const saved = parts.reduce((sum, [tokens, perToken]) => sum + tokens * (input - (perToken ?? input)), 0);
  return Math.round(saved * 1e6);
}
