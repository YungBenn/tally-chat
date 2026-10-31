# 07: OpenAI-compatible adapter

**What to build:** The owner can add any OpenAI-compatible provider (OpenAI, DeepSeek, Groq, OpenRouter, Ollama) and chat with it, with usage normalized to the same shape as Anthropic. Built on the Vercel AI SDK, reading what the SDK drops from the raw usage. Spec: user stories 18, 37, 39; Implementation Decisions "Provider layer".

**Blocked by:** 04 Outbound URL guard and private-host allowlist, 06 Metering and cost

**Status:** done (pending review)

- [x] Owner can add a provider with API style `openai-compatible` and any base URL the guard allows
- [x] Chat streams through the same path as Anthropic, including resume and stop
- [x] Cached tokens are subtracted from the prompt count so `inputTokens` is uncached input
- [x] Cache write tokens are read from the raw usage where the provider reports them
- [x] Reasoning tokens are recorded when reported
- [x] For OpenRouter, the reported `cost` is stored as-is instead of the price-table cost
- [x] Local models (for example an allowlisted Ollama) cost $0; custom endpoints use owner-entered prices from the overrides
- [x] Recorded fixtures for OpenAI, DeepSeek, OpenRouter and Ollama produce the same normalized shape for equivalent inputs (test)
