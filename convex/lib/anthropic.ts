import { ConvexError } from "convex/values";

export type ProviderModel = { id: string; displayName: string; hidden: boolean };

// GET /v1/models is free, so it doubles as the key test and the model list.
export async function fetchAnthropicModels(baseUrl: string, apiKey: string) {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/models?limit=1000`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
  } catch {
    throw new ConvexError("Could not reach the provider");
  }
  if (res.status === 401 || res.status === 403) throw new ConvexError("The provider rejected this key");
  if (!res.ok) throw new ConvexError(`The provider returned an error (${res.status})`);
  const body = (await res.json()) as { data: { id: string; display_name?: string }[] };
  const org = res.headers.get("anthropic-organization-id");
  return {
    detected: org ? `Anthropic · org ${org.slice(0, 8)}` : "Anthropic",
    models: body.data.map((m): ProviderModel => ({ id: m.id, displayName: m.display_name ?? m.id, hidden: false })),
  };
}
