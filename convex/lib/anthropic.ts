import { ConvexError } from "convex/values";
import type { Effort } from "./effort";
import type { MessageImage } from "./images";
import type { ToolDefinition } from "./toolSet";
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
  vision?: boolean; // accepts images (spec phase 4)
  tools?: boolean; // can call tools (spec phase 10)
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
  // capabilities.image_input.supported on the Models API; some proxies (9router) report
  // capabilities.vision instead.
  const body = (await res.json()) as {
    data: {
      id: string;
      display_name?: string;
      capabilities?: {
        image_input?: { supported?: boolean };
        vision?: boolean;
      };
    }[];
  };
  const org = res.headers.get("anthropic-organization-id");
  return {
    detected: org ? `Anthropic · org ${org.slice(0, 8)}` : "Anthropic",
    models: body.data.map((m): ProviderModel => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
      hidden: false,
      vision:
        m.capabilities?.image_input?.supported ??
        m.capabilities?.vision ??
        false,
    })),
  };
}

// effort: a per-message effort change made on this user message (spec phase 4), which the
// Anthropic body emits as a beta effort-only system message right after it.
// images: stored images on a user message; the action loads them into imageData (base64)
// before the request is built.
// blocks and toolResults carry a tool loop's steps (spec phase 10, lib/toolParts): an assistant
// step's thinking, text and tool calls, then the user turn holding their results. tool_use input
// is JSON text, parsed only when the body is built.
export type AssistantBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string };
export type ToolResultBlock = { id: string; name: string; text: string; isError: boolean };
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  effort?: Effort;
  images?: MessageImage[];
  imageData?: { mediaType: MessageImage["mediaType"]; data: string }[];
  blocks?: AssistantBlock[];
  toolResults?: ToolResultBlock[];
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
  tools?: ToolDefinition[]; // a thread's frozen tool set (spec phase 10), sent as stored
};

// The Messages API body. Breakpoints: the system prompt (tools come before it, so it caches them
// too), the end of the checkpoint layer, and top-level automatic caching sliding over the verbatim
// turns (plus the latest reply for a keepalive; none when the request ends in tool results): at most 4, leaving room for a router in front
// of the API that adds a breakpoint of its own. Only marked messages become content-block arrays; the rest stay
// plain strings, so a branch's request bytes stay stable from turn to turn.
export function messagesBody(req: MessagesRequest, stream: boolean) {
  const cc = req.cache && { type: "ephemeral" as const, ttl: req.cache.ttl };
  const marked = new Set<number>();
  if (req.cache && req.cache.layerEnd > 0) marked.add(req.cache.layerEnd - 1);
  if (req.cache?.breakAt !== undefined) marked.add(req.cache.breakAt);
  const tools = req.tools?.length ? req.tools : undefined;
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    // Replies and keepalives (the cache-marked requests) ask for the thinking summary, which costs
    // nothing extra and keeps their cached prefix the same. Side jobs ask for nothing.
    ...(req.cache ? { thinking: { type: "adaptive" as const, display: "summarized" as const } } : {}),
    // Tools come first in the cached prefix; the system prompt's breakpoint covers them.
    ...(tools
      ? {
          tools: tools.map((t) => ({
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            input_schema: JSON.parse(t.inputSchema) as unknown,
          })),
        }
      : {}),
    system: cc
      ? [{ type: "text" as const, text: req.system, cache_control: cc }]
      : req.system,
    // Breakpoint indices count the branch's messages; effort messages are inserted after them.
    messages: req.messages.flatMap((m, i): object[] => {
      // A tool step is always an array of blocks; a breakpoint goes on its last block.
      if (m.blocks || m.toolResults) {
        const blocks: Record<string, unknown>[] = m.blocks
          ? m.blocks.map((b) => (b.type === "tool_use" ? { ...b, input: JSON.parse(b.input) as unknown } : { ...b }))
          : m.toolResults!.map((r) => ({
              type: "tool_result",
              tool_use_id: r.id,
              content: r.text,
              ...(r.isError ? { is_error: true } : {}),
            }));
        if (marked.has(i) && cc) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: cc };
        return [{ role: m.role, content: blocks }];
      }
      const text = marked.has(i)
        ? { type: "text" as const, text: m.content, cache_control: cc }
        : { type: "text" as const, text: m.content };
      // Images go before the text, as base64 blocks (spec phase 4).
      const images = (m.imageData ?? []).map((d) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: d.mediaType,
          data: d.data,
        },
      }));
      const message = {
        role: m.role,
        content: images.length
          ? [...images, text]
          : marked.has(i)
            ? [text]
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
    // Not on a request ending in tool results: 9router (cc/) adds its own marks to a
    // tool_use -> tool_result request, and with this one it goes over 4.
    ...(cc && !req.messages.at(-1)?.toolResults ? { cache_control: cc } : {}),
    stream,
  };
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; input: unknown } // the model asks for a tool (spec phase 10)
  | { type: "thinkingDelta"; text: string } // a piece of the thinking summary, to show live
  | { type: "thinking"; thinking: string; signature: string } // a finished thinking block, to send back unchanged in a tool loop
  | { type: "redactedThinking"; data: string }
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
  // tool_use blocks arrive as a start (id, name) and JSON fragments, per content block index.
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
  const thinkingBlocks = new Map<number, { thinking: string; signature: string }>();
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
        index?: number;
        content_block?: { type?: string; id?: string; name?: string; data?: string };
        delta?: {
          type?: string;
          text?: string;
          stop_reason?: string;
          partial_json?: string;
          thinking?: string;
          signature?: string;
        };
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
      if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use")
        toolBlocks.set(parsed.index ?? 0, {
          id: parsed.content_block.id ?? "",
          name: parsed.content_block.name ?? "",
          json: "",
        });
      if (parsed.type === "content_block_start" && parsed.content_block?.type === "thinking")
        thinkingBlocks.set(parsed.index ?? 0, { thinking: "", signature: "" });
      if (parsed.type === "content_block_start" && parsed.content_block?.type === "redacted_thinking")
        yield { type: "redactedThinking", data: parsed.content_block.data ?? "" };
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "thinking_delta") {
        const block = thinkingBlocks.get(parsed.index ?? 0);
        if (block) block.thinking += parsed.delta.thinking ?? "";
        if (parsed.delta.thinking) yield { type: "thinkingDelta", text: parsed.delta.thinking };
      }
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "signature_delta") {
        const block = thinkingBlocks.get(parsed.index ?? 0);
        if (block) block.signature += parsed.delta.signature ?? "";
      }
      if (parsed.type === "content_block_stop" && thinkingBlocks.has(parsed.index ?? 0)) {
        yield { type: "thinking", ...thinkingBlocks.get(parsed.index ?? 0)! };
        thinkingBlocks.delete(parsed.index ?? 0);
      }
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "input_json_delta") {
        const block = toolBlocks.get(parsed.index ?? 0);
        if (block) block.json += parsed.delta.partial_json ?? "";
      }
      if (parsed.type === "content_block_stop" && toolBlocks.has(parsed.index ?? 0)) {
        const { id, name, json } = toolBlocks.get(parsed.index ?? 0)!;
        toolBlocks.delete(parsed.index ?? 0);
        let input: unknown = {};
        try {
          input = json ? JSON.parse(json) : {};
        } catch {
          // a malformed argument string reaches the tool as no arguments
        }
        yield { type: "toolCall", id, name, input };
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
