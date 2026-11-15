import { ConvexError } from "convex/values";
import type { Effort } from "./effort";
import { guardedFetch, type GuardOptions } from "./urlGuard";
import {
  normalizeAnthropicUsage,
  type AnthropicUsage,
  type NormalizedUsage,
} from "./usage";

export type ProviderModel = {
  id: string;
  displayName: string;
  hidden: boolean;
};

// GET /v1/models is free, so it doubles as the key test and the model list.
export async function fetchAnthropicModels(
  baseUrl: string,
  apiKey: string,
  guard: GuardOptions,
) {
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
  if (res.status === 401 || res.status === 403)
    throw new ConvexError("The provider rejected this key");
  if (!res.ok)
    throw new ConvexError(`The provider returned an error (${res.status})`);
  const body = (await res.json()) as {
    data: { id: string; display_name?: string }[];
  };
  const org = res.headers.get("anthropic-organization-id");
  return {
    detected: org ? `Anthropic · org ${org.slice(0, 8)}` : "Anthropic",
    models: body.data.map((m): ProviderModel => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
      hidden: false,
    })),
  };
}

// effort: a per-message effort change made on this user message (spec phase 4), which the
// Anthropic body emits as a beta effort-only system message right after it.
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  effort?: Effort;
};

const PER_MESSAGE_EFFORT_BETA = "mid-conversation-output-config-2026-07-01";
// Models that accept per-message effort (Claude API reference, Nov 2026; Fable 5 itself doesn't).
// ponytail: a list in code; read it from the Models API once it exposes the capability.
const PER_MESSAGE_EFFORT_MODELS = new Set([
  "claude-fable-5-1",
  "claude-fable-5-2",
  "claude-mythos-5-1",
  "claude-mythos-5-2",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
]);
// Proxies prefix ids ("cc/claude-sonnet-5-5"); the model is the last segment.
export const supportsPerMessageEffort = (model: string) =>
  PER_MESSAGE_EFFORT_MODELS.has(model.split("/").at(-1) ?? model);

// Request headers: the per-message effort beta only when a request carries such a message.
const requestHeaders = (apiKey: string, messages: ChatMessage[]) => ({
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
  ...(messages.some((m) => m.effort)
    ? { "anthropic-beta": PER_MESSAGE_EFFORT_BETA }
    : {}),
});

// Where a request's cache breakpoints go (spec phase 2, "Request layout"). Every breakpoint
// shares one TTL, so the longer-before-shorter rule can never be broken.
export type CacheLayout = {
  ttl: "5m" | "1h";
  layerEnd: number; // leading messages forming the checkpoint layer; 0 = none
  breakAt?: number; // keepalives also mark this message (the latest reply) explicitly
};

export type MessagesRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  cache?: CacheLayout; // absent (side jobs): no cache_control at all
  effort?: Effort; // output_config.effort; absent: the model's own default
};

// The Messages API body. Breakpoints: the system prompt, the end of the checkpoint layer,
// and top-level automatic caching sliding over the verbatim turns (plus the latest reply for
// a keepalive): at most 4. Only marked messages become content-block arrays; the rest stay
// plain strings, so a branch's request bytes stay stable from turn to turn.
export function messagesBody(req: MessagesRequest, stream: boolean) {
  const cc = req.cache && { type: "ephemeral" as const, ttl: req.cache.ttl };
  const marked = new Set<number>();
  if (req.cache && req.cache.layerEnd > 0) marked.add(req.cache.layerEnd - 1);
  if (req.cache?.breakAt !== undefined) marked.add(req.cache.breakAt);
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    system: cc
      ? [{ type: "text" as const, text: req.system, cache_control: cc }]
      : req.system,
    // Breakpoint indices count the branch's messages; effort messages are inserted after them.
    messages: req.messages.flatMap((m, i) => {
      const message = {
        role: m.role,
        content: marked.has(i)
          ? [{ type: "text" as const, text: m.content, cache_control: cc }]
          : m.content,
      };
      return m.effort
        ? [
            message,
            {
              role: "system" as const,
              content: [] as never[],
              output_config: { effort: m.effort },
            },
          ]
        : [message];
    }),
    ...(cc ? { cache_control: cc } : {}),
    stream,
  };
}

export type StreamEvent =
  | { type: "text"; text: string }
  | ({ type: "usage" } & NormalizedUsage)
  | { type: "stop"; truncated: boolean }; // truncated: the reply stopped at max_tokens

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
      headers: requestHeaders(req.apiKey, req.messages),
      body: JSON.stringify(messagesBody(req, true)),
    },
    guard,
  );
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new ConvexError(
      `Provider error ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`,
    );
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
      const data = event
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      // Some proxies (9router) end Anthropic streams with an OpenAI-style "[DONE]" line.
      if (!data || data === "[DONE]") continue;
      const parsed = JSON.parse(data) as {
        type: string;
        delta?: { type?: string; text?: string; stop_reason?: string };
        message?: { usage?: AnthropicUsage };
        usage?: AnthropicUsage;
        error?: { message?: string };
      };
      if (
        parsed.type === "content_block_delta" &&
        parsed.delta?.type === "text_delta"
      ) {
        yield { type: "text", text: parsed.delta.text ?? "" };
      }
      if (parsed.type === "message_delta" && parsed.delta?.stop_reason) {
        yield {
          type: "stop",
          truncated: parsed.delta.stop_reason === "max_tokens",
        };
      }
      const reported =
        parsed.type === "message_start"
          ? parsed.message?.usage
          : parsed.type === "message_delta"
            ? parsed.usage
            : undefined;
      if (reported) {
        usage = { ...usage, ...reported };
        yield { type: "usage", ...normalizeAnthropicUsage(usage) };
      }
      if (parsed.type === "error")
        throw new ConvexError(
          `Provider error: ${parsed.error?.message ?? "unknown"}`,
        );
    }
  }
}

// Follows the latest reply in a keepalive: 5.5 models reject a conversation that ends on an
// assistant message (no prefill), and with max_tokens 0 nothing is generated for it anyway.
export const KEEPALIVE_NUDGE: ChatMessage = { role: "user", content: "." };

// A keepalive (spec phase 2): the same request as a real turn through the latest reply, with
// an explicit breakpoint on that reply so the cached prefix is exactly what the next turn
// shares, then KEEPALIVE_NUDGE; `max_tokens: 0` and not streamed, so it only refreshes the
// cache. Returns the usage the provider reported. Throws ConvexError on an HTTP error.
export async function sendAnthropicKeepalive(
  req: Omit<MessagesRequest, "maxTokens" | "cache"> & {
    cache: CacheLayout;
    baseUrl: string;
    apiKey: string;
  },
  guard: GuardOptions,
): Promise<NormalizedUsage> {
  const messages = [...req.messages, KEEPALIVE_NUDGE];
  const cache = { ...req.cache, breakAt: req.messages.length - 1 };
  const res = await guardedFetch(
    `${req.baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: requestHeaders(req.apiKey, messages),
      body: JSON.stringify(
        messagesBody({ ...req, messages, cache, maxTokens: 0 }, false),
      ),
    },
    guard,
  );
  const body = (await res.json().catch(() => null)) as {
    usage?: AnthropicUsage;
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.usage) {
    throw new ConvexError(
      `Provider error ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`,
    );
  }
  return normalizeAnthropicUsage(body.usage);
}
