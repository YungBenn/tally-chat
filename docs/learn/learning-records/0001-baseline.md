# Baseline: has called an LLM API, tokens and caching are new

Ruben has sent requests to an LLM API and read responses, but does not yet understand tokens, why cost grows with conversation length, or prompt caching. He has not used Convex or HTTP-style caching concepts. Start from tokens and statelessness; do not assume caching vocabulary.
