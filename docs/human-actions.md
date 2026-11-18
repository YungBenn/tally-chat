# Human actions

Steps only the owner can do. The agent picks the blocked work back up once each is verified.

- [ ] Add a real Anthropic provider to the local instance (blocks: phase 2 ticket 06, verify against the real Anthropic API)
  1. Get an API key at https://console.anthropic.com/settings/keys (Create Key). A few dollars of credit covers the whole session.
  2. Run the app (`bun run dev`) and open http://localhost:3000/providers.
  3. Add a provider: name `Anthropic`, API style `Anthropic`, base URL `https://api.anthropic.com`, paste the key, then Add. The key is tested with one free call and stored encrypted; it never goes in a file.
  4. Tell the agent it's done. The verification session itself takes about an hour of wall time (a 6-minute pause, a 30-minute unfocused wait, a pause with keepalive off) and needs you there to keep the tab focused or leave it.
  Verify: `bunx convex data providers --format jsonl` lists a provider with `"apiStyle":"anthropic"` and `"baseUrl":"https://api.anthropic.com"` whose models include a 5.5 model (for example `claude-sonnet-5-5`).

- [ ] Run the tool loop against the real Anthropic API (blocks: phase 10 real-provider check; needs the Anthropic provider entry above)
  1. Add a remote MCP server on http://localhost:3000/tools (name, URL, optional bearer header) and switch "On for new threads" on.
  2. Start a new thread on a Claude 5.5 model, ask something that needs a tool, and approve the call. Repeat with effort set to high so thinking blocks go back across steps.
  3. Tell the agent it's done.
  Verify: `bunx convex data messages --format jsonl` shows a reply with `parts` holding a `toolCall`, a `toolResult` and `"status":"done"`, and no provider error.
