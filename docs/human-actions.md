# Human actions

Steps only the owner can do. The agent picks the blocked work back up once each is verified.

- [ ] Add a real Anthropic provider to the local instance (blocks: phase 2 ticket 06, verify against the real Anthropic API)
  1. Get an API key at https://console.anthropic.com/settings/keys (Create Key). A few dollars of credit covers the whole session.
  2. Run the app (`bun run dev`) and open http://localhost:3000/providers.
  3. Add a provider: name `Anthropic`, API style `Anthropic`, base URL `https://api.anthropic.com`, paste the key, then Add. The key is tested with one free call and stored encrypted; it never goes in a file.
  4. Tell the agent it's done. The verification session itself takes about an hour of wall time (a 6-minute pause, a 30-minute unfocused wait, a pause with keepalive off) and needs you there to keep the tab focused or leave it.
  Verify: `bunx convex data providers --format jsonl` lists a provider with `"apiStyle":"anthropic"` and `"baseUrl":"https://api.anthropic.com"` whose models include a 5.5 model (for example `claude-sonnet-5-5`).
