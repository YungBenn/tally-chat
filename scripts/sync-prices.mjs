// Vendors LiteLLM's MIT-licensed model price table into convex/lib/prices.generated.json,
// trimmed to chat models and the fields cost metering and condensing need. Run: npm run sync-prices
import { writeFileSync } from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OUT = new URL("../convex/lib/prices.generated.json", import.meta.url);
const FIELDS = {
  input_cost_per_token: "input",
  output_cost_per_token: "output",
  cache_read_input_token_cost: "cacheRead",
  cache_creation_input_token_cost: "cacheWrite5m",
  cache_creation_input_token_cost_above_1hr: "cacheWrite1h",
  max_input_tokens: "contextWindow", // for the condenser's context-window override (spec phase 6)
  max_output_tokens: "maxOutput", // clamps the output ceiling (answer quality ticket 07)
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`LiteLLM price table: HTTP ${res.status}`);
const source = await res.json();

const models = {};
for (const [id, entry] of Object.entries(source).sort(([a], [b]) => a.localeCompare(b))) {
  if (entry?.mode !== "chat" || typeof entry.input_cost_per_token !== "number") continue;
  const price = {};
  for (const [from, to] of Object.entries(FIELDS)) if (typeof entry[from] === "number") price[to] = entry[from];
  models[id] = price;
}

writeFileSync(
  OUT,
  JSON.stringify({ _generated: `by scripts/sync-prices.mjs from ${SOURCE}; do not edit, use priceOverrides.json`, models }, null, 1) + "\n",
);
console.log(`Wrote ${Object.keys(models).length} chat models to ${OUT.pathname}`);
