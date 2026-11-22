// Anthropic Messages API stream events, for fake provider responses.
const encode = (event: object) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;
export const textDelta = (text: string) => encode({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
export const streamError = (message: string) => encode({ type: "error", error: { type: "overloaded_error", message } });
export const messageStop = encode({ type: "message_stop" });
export const messageStart = (usage: object) => encode({ type: "message_start", message: { usage } });
export const messageDelta = (usage: object) => encode({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage });
export const sse = (...events: string[]) => events.join("");

// A stream that pauses at each gate until the test releases it, and errors when aborted.
export function gatedStream(steps: (string | Gate)[], signal: AbortSignal | null | undefined) {
  const queue = [...steps];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
    async pull(controller) {
      const step = queue.shift();
      if (step === undefined) return controller.close();
      if (typeof step === "string") return controller.enqueue(new TextEncoder().encode(step));
      step.arrive();
      await step.released;
    },
  });
}

// `reached` resolves when the stream gets to the gate: tests await it instead of polling a clock.
export type Gate = { reached: Promise<void>; arrive: () => void; released: Promise<void>; release: () => void };
export function gate(): Gate {
  let arrive!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((r) => (arrive = r));
  const released = new Promise<void>((r) => (release = r));
  return { reached, arrive, released, release };
}

// OpenAI-compatible chat completion chunks (stream_options.include_usage puts usage in a final chunk).
const chunk = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
export const oaiDelta = (content: string) => chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content } }] });
export const oaiFinish = (usage: object) =>
  chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
  chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage });
export const oaiDone = "data: [DONE]\n\n";

// A tool_use content block: start, argument fragments, stop (Anthropic).
export const toolUse = (index: number, id: string, name: string, ...argFragments: string[]) =>
  encode({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } }) +
  argFragments.map((partial_json) => encode({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } })).join("") +
  encode({ type: "content_block_stop", index });
export const toolUseStop = (usage: object) => encode({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage });

// An OpenAI-compatible tool call chunk (id and name first, then the arguments).
export const oaiToolCall = (index: number, id: string, name: string, args: string) =>
  chunk({
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { tool_calls: [{ index, id, type: "function", function: { name, arguments: args } }] } }],
  });
export const oaiToolFinish = (usage: object) =>
  chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
  chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage });
