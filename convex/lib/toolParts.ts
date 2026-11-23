import { v, type Infer } from "convex/values";
import type { AssistantBlock, ChatMessage } from "./anthropic";
import { imageValidator } from "./images";
import { effortValidator } from "./effort";
import { skillPreviewValidator } from "./skills";

// A reply's ordered parts (spec phase 10): written step by step while the reply runs and never
// changed after. `content` stays the reply's text parts joined. Parts exist only on replies that
// called a tool; a reply without tools stays plain text.
export const toolStatusValidator = v.union(
  v.literal("ok"),
  v.literal("error"),
  v.literal("declined"),
  v.literal("timedOut"),
);
export type ToolStatus = Infer<typeof toolStatusValidator>;

export const partValidator = v.union(
  v.object({ type: v.literal("text"), step: v.number(), text: v.string() }),
  // Thinking comes back unchanged, signature and all, inside a tool loop (Anthropic requires it).
  v.object({ type: v.literal("thinking"), step: v.number(), thinking: v.string(), signature: v.string() }),
  v.object({ type: v.literal("redactedThinking"), step: v.number(), data: v.string() }),
  // input is JSON text, so the bytes sent on later requests are the bytes stored.
  // preview: add_skill's resolved skill, written with the call (lib/addSkill).
  v.object({ type: v.literal("toolCall"), step: v.number(), id: v.string(), name: v.string(), input: v.string(), preview: v.optional(skillPreviewValidator) }),
  v.object({ type: v.literal("toolResult"), step: v.number(), id: v.string(), text: v.string(), status: toolStatusValidator }),
);
export type Part = Infer<typeof partValidator>;

// A request message as the stored history needs it: plain text, or the blocks of a tool step.
export const chatMessageValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  effort: v.optional(effortValidator),
  images: v.optional(v.array(imageValidator)),
  blocks: v.optional(
    v.array(
      v.union(
        v.object({ type: v.literal("thinking"), thinking: v.string(), signature: v.string() }),
        v.object({ type: v.literal("redacted_thinking"), data: v.string() }),
        v.object({ type: v.literal("text"), text: v.string() }),
        v.object({ type: v.literal("tool_use"), id: v.string(), name: v.string(), input: v.string() }),
      ),
    ),
  ),
  toolResults: v.optional(
    v.array(v.object({ id: v.string(), name: v.string(), text: v.string(), isError: v.boolean() })),
  ),
});

export const MAX_STEPS = 10;
// A reply waits this long for approval before it stops (spec phase 10).
export const APPROVAL_TIMEOUT_MS = 30 * 60_000;

// The number of the step a reply is on: the one after the last step with parts.
export const nextStep = (parts: Part[] | undefined) =>
  (parts?.reduce((max, p) => Math.max(max, p.step), 0) ?? 0) + 1;

// The reply's text: its text parts, in order, one blank line apart.
export const joinText = (parts: Part[]) =>
  parts.flatMap((p) => (p.type === "text" && p.text ? [p.text] : [])).join("\n\n");

export const usedTools = (parts: Part[] | undefined) => !!parts?.some((p) => p.type === "toolCall");

// What the model is told for a call that didn't return a result.
export const RESULT_NOTE: Record<Exclude<ToolStatus, "ok">, string> = {
  error: "Error",
  declined: "The user declined this call.",
  timedOut: "Error: the call timed out after 60 seconds.",
};

// The reply as request messages: for each step, the assistant's blocks (thinking, text, tool
// calls) then the results, in the order they happened. A step whose calls don't all have a
// result (the reply was stopped or cut mid-step) is sent as its text alone, so a history never
// holds a call without its result.
export function expandParts(parts: Part[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const steps = [...new Set(parts.map((p) => p.step))].sort((a, b) => a - b);
  for (const step of steps) {
    const own = parts.filter((p) => p.step === step);
    const text = own.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
    const calls = own.filter((p) => p.type === "toolCall");
    const results = new Map(own.flatMap((p) => (p.type === "toolResult" ? [[p.id, p] as const] : [])));
    const complete = calls.length > 0 && calls.every((c) => c.type === "toolCall" && results.has(c.id));
    const thinking = own.flatMap((p): AssistantBlock[] =>
      p.type === "thinking"
        ? [{ type: "thinking", thinking: p.thinking, signature: p.signature }]
        : p.type === "redactedThinking"
          ? [{ type: "redacted_thinking", data: p.data }]
          : [],
    );
    if (complete) {
      messages.push({
        role: "assistant",
        content: text,
        blocks: [
          ...thinking,
          ...(text ? [{ type: "text" as const, text }] : []),
          ...calls.flatMap((c): AssistantBlock[] =>
            c.type === "toolCall" ? [{ type: "tool_use", id: c.id, name: c.name, input: c.input }] : [],
          ),
        ],
      });
      messages.push({
        role: "user",
        content: "",
        toolResults: calls.flatMap((c) => {
          const r = c.type === "toolCall" ? results.get(c.id) : undefined;
          return c.type === "toolCall" && r && r.type === "toolResult"
            ? [{ id: c.id, name: c.name, text: r.text, isError: r.status !== "ok" }]
            : [];
        }),
      });
    } else if (text) {
      messages.push(
        thinking.length
          ? { role: "assistant", content: text, blocks: [...thinking, { type: "text", text }] }
          : { role: "assistant", content: text },
      );
    }
  }
  return messages;
}
