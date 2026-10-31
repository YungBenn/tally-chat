import { ConvexError } from "convex/values";
import { guardedFetch, type GuardOptions } from "./urlGuard";
import { normalizeAnthropicUsage, type AnthropicUsage, type NormalizedUsage } from "./usage";

export type ProviderModel = { id: string; displayName: string; hidden: boolean };

// GET /v1/models is free, so it doubles as the key test and the model list.
export async function fetchAnthropicModels(baseUrl: string, apiKey: string, guard: GuardOptions) {
  let res: Response;
  try {
    res = await guardedFetch(
      `${baseUrl}/v1/models?limit=1000`,
      { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } },
      guard,
    );
  } catch (err) {
    if (err instanceof ConvexError) throw err;
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

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type StreamEvent = { type: "text"; text: string } | ({ type: "usage" } & NormalizedUsage);

// Streams a Messages API reply, yielding text deltas and the usage reported so far
// (message_start carries the input side, message_delta the cumulative output).
// Throws ConvexError with the provider's message on an HTTP or in-stream error.
export async function* streamAnthropicMessage(
  req: { baseUrl: string; apiKey: string; model: string; system: string; messages: ChatMessage[]; maxTokens: number },
  guard: GuardOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await guardedFetch(
    `${req.baseUrl}/v1/messages`,
    {
      method: "POST",
      signal,
      headers: { "x-api-key": req.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        stream: true,
      }),
    },
    guard,
  );
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ConvexError(`Provider error ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let usage: AnthropicUsage = {};
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = event.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      const parsed = JSON.parse(data) as {
        type: string;
        delta?: { type: string; text?: string };
        message?: { usage?: AnthropicUsage };
        usage?: AnthropicUsage;
        error?: { message?: string };
      };
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
        yield { type: "text", text: parsed.delta.text ?? "" };
      }
      const reported = parsed.type === "message_start" ? parsed.message?.usage : parsed.type === "message_delta" ? parsed.usage : undefined;
      if (reported) {
        usage = { ...usage, ...reported };
        yield { type: "usage", ...normalizeAnthropicUsage(usage) };
      }
      if (parsed.type === "error") throw new ConvexError(`Provider error: ${parsed.error?.message ?? "unknown"}`);
    }
  }
}
