# Mission: Token economics behind tally.chat

## Why
Ruben is building tally.chat himself from `docs/tallychat-design-doc.md`. He needs to understand every token and caching decision in that doc well enough to implement it, debug it when the bill looks wrong, and change it when the reasoning stops holding.

## Success looks like
- Can explain, with numbers, why a 10-turn chat costs 30-50x a single turn
- Can read any provider `usage` block and say what each field costs
- Can predict whether a given change (edit a message, condense, switch model, toggle thinking) breaks the prompt cache, and what that costs
- Can implement S1 (message tree), S5 (cache-aware prefix) and S10 (metering) without guessing
- Can argue for or against each S-item in the doc on its own terms

## Constraints
- Software engineer; has called an LLM API before, but tokens, caching and Convex are new
- ~25-minute lessons
- Sources: Anthropic docs first, numbers from the pricing page, never from memory

## Out of scope
- How models work internally (transformers, attention, training)
- Prompt engineering for answer quality
- Frontend/Next.js specifics
