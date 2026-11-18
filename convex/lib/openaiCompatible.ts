import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema, streamText, tool } from "ai";
import { ConvexError } from "convex/values";
import type { MessagesRequest, StreamEvent } from "./anthropic";
import type { ProviderModel } from "./anthropic";
import { guardedFetch, type GuardOptions } from "./urlGuard";
import { normalizeOpenAIUsage, type OpenAIUsage } from "./usage";

const authHeaders = (apiKey: string): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

// GET {baseUrl}/models doubles as the key test and the model list.
export async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string,
  guard: GuardOptions,
) {
  let res: Response;
  try {
    res = await guardedFetch(
      `${baseUrl}/models`,
      { headers: authHeaders(apiKey) },
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
  const body = (await res.json()) as { data?: { id: string; name?: string }[] };
  return {
    detected: new URL(baseUrl).host,
    models: (body.data ?? []).map((m): ProviderModel => ({
      id: m.id,
      displayName: m.name ?? m.id,
      hidden: false,
    })),
  };
}

// ponytail: OpenAI-compatible APIs send usage only in the final chunk, so a stopped
// reply records no usage at all even though the provider bills what it generated.
// Streams a chat completion through the AI SDK, with the URL guard as its fetch.
// The SDK leaves cache writes and OpenRouter's cost out of its usage, so usage is
// normalized from the provider's raw usage object instead.
export async function* streamOpenAICompatible(
  req: MessagesRequest & { baseUrl: string; apiKey: string }, // req.cache is ignored: these providers cache on their own
  guard: GuardOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const provider = createOpenAICompatible({
    name: "tally",
    baseURL: req.baseUrl,
    apiKey: req.apiKey || undefined,
    includeUsage: true,
    fetch: (input, init) =>
      guardedFetch(
        input instanceof Request ? input.url : String(input),
        init ?? {},
        guard,
      ),
  });
  const result = streamText({
    model: provider.chatModel(req.model),
    system: req.system,
    // Only role and content go to the SDK; images become image parts before the text.
    messages: req.messages.map((m) =>
      m.role === "user" && m.imageData?.length
        ? {
            role: "user" as const,
            content: [
              ...m.imageData.map((d) => ({
                type: "image" as const,
                image: d.data,
                mediaType: d.mediaType,
              })),
              { type: "text" as const, text: m.content },
            ],
          }
        : { role: m.role, content: m.content },
    ),
    // A thread's frozen tools, in stored order, with no execute: the SDK reports the model's call
    // as a tool-call part and tally.chat's own loop runs it (spec phase 10).
    ...(req.tools?.length
      ? {
          tools: Object.fromEntries(
            req.tools.map((t) => [
              t.name,
              tool({ description: t.description, inputSchema: jsonSchema(JSON.parse(t.inputSchema)) }),
            ]),
          ),
        }
      : {}),
    maxOutputTokens: req.maxTokens,
    maxRetries: 0, // a silent retry is a second bill the user never sees
    abortSignal: signal,
  });
  for await (const part of result.stream) {
    if (part.type === "text-delta") yield { type: "text", text: part.text };
    else if (part.type === "tool-call")
      yield { type: "toolCall", id: part.toolCallId, name: part.toolName, input: part.input };
    else if (part.type === "error") {
      const error = part.error;
      if (error instanceof ConvexError) throw error;
      throw new ConvexError(
        `Provider error: ${error instanceof Error ? error.message : "unknown"}`,
      );
    } else if (part.type === "finish") {
      if (part.totalUsage.raw)
        yield {
          type: "usage",
          ...normalizeOpenAIUsage(part.totalUsage.raw as OpenAIUsage),
        };
      yield { type: "stop", truncated: part.finishReason === "length" };
    }
  }
}
