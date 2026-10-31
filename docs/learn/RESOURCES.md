# Token economics resources

## Knowledge

- [Anthropic: Using the Messages API, "Multiple conversational turns"](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)
  Primary source that the API is stateless and you resend full history each turn. Use for: lesson 1, request shapes.
- [Anthropic: Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
  Per-model input/output/cache prices. Use for: every cost number in every lesson. Re-check before quoting; prices change.
- [Anthropic: Glossary, "Tokens"](https://platform.claude.com/docs/en/about-claude/glossary)
  What a token is; ~3.5 English chars per token on older models, newer tokenizer ~30% more tokens. Use for: token intuition.
- [Anthropic: Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
  Exact counts per model via API. Use for: hands-on exercises.
- [Anthropic: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  Prefix matching, breakpoints, 20-block lookback, TTL, usage fields, write/read multipliers. Use for: S5 lessons. The single most important doc for this project.
- [ProjectDiscovery: How we cut LLM cost with prompt caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)
  Real-world 91.8% vs 3.2% cache hit rate story. Use for: motivating S5.
- [LLMBridge (arXiv 2410.11857)](https://arxiv.org/pdf/2410.11857)
  Measured context-size vs cost and quality. Use for: why naive truncation hurts.
- [MT-OSC (arXiv 2604.08782)](https://arxiv.org/pdf/2604.08782)
  Background condensation results. Use for: S3 lessons.
- [OpenAI Tokenizer playground](https://platform.openai.com/tokenizer)
  Visual token splitter. Different tokenizer from Claude's, but good for building intuition.

## Wisdom (Communities)

- [Anthropic Discord](https://www.anthropic.com/discord)
  Developers building on the Claude API. Use for: caching edge cases, real hit-rate numbers.
- [r/LocalLLaMA](https://reddit.com/r/LocalLLaMA)
  High-signal on tokenizers, local models, Ollama/vLLM caching. Use for: openai-compatible and local provider behavior.

## Gaps
- No high-trust source yet on Convex streaming/rollup patterns (for S10 and section 4). Find when we reach those lessons.
