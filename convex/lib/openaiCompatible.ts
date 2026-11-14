import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { ConvexError } from "convex/values";
import type { MessagesRequest, StreamEvent } from "./anthropic";
import type { ProviderModel } from "./anthropic";
import { guardedFetch, type GuardOptions } from "./urlGuard";
import { normalizeOpenAIUsage, type OpenAIUsage } from "./usage";

const authHeaders = (apiKey: string): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

// GET {baseUrl}/models doubles as the key test and the model list.
export async function fetchOpenAICompatibleModels(baseUrl: string, apiKey: string, guard: GuardOptions) {
  let res: Response;
  try {
    res = await guardedFetch(`${baseUrl}/models`, { headers: authHeaders(apiKey) }, guard);
  } catch (err) {
    if (err instanceof ConvexError) throw err;
    throw new ConvexError("Could not reach the provider");
  }
  if (res.status === 401 || res.status === 403) throw new ConvexError("The provider rejected this key");
  if (!res.ok) throw new ConvexError(`The provider returned an error (${res.status})`);
  const body = (await res.json()) as { data?: { id: string; name?: string }[] };
  return {
    detected: new URL(baseUrl).host,
    models: (body.data ?? []).map((m): ProviderModel => ({ id: m.id, displayName: m.name ?? m.id, hidden: false })),
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
    fetch: (input, init) => guardedFetch(input instanceof Request ? input.url : String(input), init ?? {}, guard),
  });
  const result = streamText({
    model: provider.chatModel(req.model),
    system: req.system,
    messages: req.messages,
    maxOutputTokens: req.maxTokens,
    maxRetries: 0, // a silent retry is a second bill the user never sees
    abortSignal: signal,
  });
  for await (const part of result.stream) {
    if (part.type === "text-delta") yield { type: "text", text: part.text };
    else if (part.type === "error") {
      const error = part.error;
      if (error instanceof ConvexError) throw error;
      throw new ConvexError(`Provider error: ${error instanceof Error ? error.message : "unknown"}`);
    } else if (part.type === "finish" && part.totalUsage.raw) {
      yield { type: "usage", ...normalizeOpenAIUsage(part.totalUsage.raw as OpenAIUsage) };
    }
  }
}
