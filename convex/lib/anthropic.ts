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

// Where a request's cache breakpoints go (spec phase 2, "Request layout"). Every breakpoint
// shares one TTL, so the longer-before-shorter rule can never be broken.
export type CacheLayout = {
  ttl: "5m" | "1h";
  layerEnd: number; // leading messages forming the checkpoint layer; 0 = none
  lastBlock?: boolean; // keepalives also mark the last message explicitly
};

export type MessagesRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  cache?: CacheLayout; // absent (side jobs): no cache_control at all
};

// The Messages API body. Breakpoints: the system prompt, the end of the checkpoint layer,
// and top-level automatic caching sliding over the verbatim turns (plus the last message for
// a keepalive): at most 4. Only marked messages become content-block arrays; the rest stay
// plain strings, so a branch's request bytes stay stable from turn to turn.
export function messagesBody(req: MessagesRequest, stream: boolean) {
  const cc = req.cache && { type: "ephemeral" as const, ttl: req.cache.ttl };
  const marked = new Set<number>();
  if (req.cache && req.cache.layerEnd > 0) marked.add(req.cache.layerEnd - 1);
  if (req.cache?.lastBlock) marked.add(req.messages.length - 1);
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: cc ? [{ type: "text" as const, text: req.system, cache_control: cc }] : req.system,
    messages: req.messages.map((m, i) =>
      marked.has(i) ? { role: m.role, content: [{ type: "text" as const, text: m.content, cache_control: cc }] } : m,
    ),
    ...(cc ? { cache_control: cc } : {}),
    stream,
  };
}

export type StreamEvent = { type: "text"; text: string } | ({ type: "usage" } & NormalizedUsage);

// Streams a Messages API reply, yielding text deltas and the usage reported so far
// (message_start carries the input side, message_delta the cumulative output).
// Throws ConvexError with the provider's message on an HTTP or in-stream error.
export async function* streamAnthropicMessage(
  req: MessagesRequest & { baseUrl: string; apiKey: string },
  guard: GuardOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await guardedFetch(
    `${req.baseUrl}/v1/messages`,
    {
      method: "POST",
      signal,
      headers: { "x-api-key": req.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(messagesBody(req, true)),
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

// A keepalive (spec phase 2): the same request as a real turn, but `max_tokens: 0` and not
// streamed, so it only refreshes the cache. Returns the usage the provider reported.
// Throws ConvexError with the provider's message on an HTTP error.
export async function sendAnthropicKeepalive(
  req: Omit<MessagesRequest, "maxTokens"> & { baseUrl: string; apiKey: string },
  guard: GuardOptions,
): Promise<NormalizedUsage> {
  const res = await guardedFetch(
    `${req.baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: { "x-api-key": req.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(messagesBody({ ...req, maxTokens: 0 }, false)),
    },
    guard,
  );
  const body = (await res.json().catch(() => null)) as { usage?: AnthropicUsage; error?: { message?: string } } | null;
  if (!res.ok || !body?.usage) {
    throw new ConvexError(`Provider error ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
  }
  return normalizeAnthropicUsage(body.usage);
}
