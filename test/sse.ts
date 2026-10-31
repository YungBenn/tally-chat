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
      step.reached = true;
      await step.released;
    },
  });
}

export type Gate = { reached: boolean; released: Promise<void>; release: () => void };
export function gate(): Gate {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  return { reached: false, released, release };
}

// OpenAI-compatible chat completion chunks (stream_options.include_usage puts usage in a final chunk).
const chunk = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
export const oaiDelta = (content: string) => chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content } }] });
export const oaiFinish = (usage: object) =>
  chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
  chunk({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage });
export const oaiDone = "data: [DONE]\n\n";
