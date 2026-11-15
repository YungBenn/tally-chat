# CacheStatus

Living indicator of the prompt cache: warm, cooling or cold, with time left.

- **warm**: `cache-warm` dot breathing slowly (4s), a holo ring that drains over the 5 minute window, subtle holo edge on the pill.
- **cooling** (last 60s): ring and dot in `cache-cooling`, still calm, no blinking.
- **cold**: plain `cache-cold` dot, no ring. Cold is a fact, not an error.
- Always says the state in words; time in mono.
