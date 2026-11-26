/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { gate, gatedStream, messageDelta, messageStart, messageStop, sse, textDelta, thinkingBlock, type Gate } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { max_tokens: number; thinking?: unknown; messages: { role: string; content: unknown }[] };

// The first reply streams `events`; every later one just says "Next".
async function setup(events: (string | Gate)[]) {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5", effort: "high" });
  let n = 0;
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (body.max_tokens === 512) return new Response(sse(messageStart({ input_tokens: 1 }), textDelta("Title"), messageDelta({ output_tokens: 1 }), messageStop));
        n += 1;
        const next = [messageStart({ input_tokens: 1 }), textDelta("Next"), messageDelta({ output_tokens: 1 }), messageStop];
        return new Response(gatedStream(n === 1 ? events : next, init?.signal));
      },
    },
  });
  const replyRequests = () => fake!.requests.filter((r) => (r.body as Body).max_tokens !== 512).map((r) => r.body as Body);
  const assistant = async () => (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.role === "assistant")!;
  const lastReply = async () => (await owner.query(api.chat.getThread, { threadId }))!.messages.at(-1)!;
  return { t, owner, threadId, replyRequests, assistant, lastReply };
}

describe("summarized thinking", () => {
  test("replies ask for summarized thinking; title jobs do not", async () => {
    const s = await setup([messageStart({ input_tokens: 1 }), textDelta("Hi"), messageDelta({ output_tokens: 1 }), messageStop]);
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi" });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(s.replyRequests()[0].thinking).toEqual({ type: "adaptive", display: "summarized" });
    const title = fake!.requests.find((r) => (r.body as Body).max_tokens === 512)!.body as Body;
    expect(title.thinking).toBeUndefined();
  });

  test("the summary streams live, lands on the parts, and is not sent back as text", async () => {
    const hold = gate();
    const s = await setup([
      messageStart({ input_tokens: 1 }),
      ...thinkingBlock("Weighing the options.", "sig-1"),
      hold,
      textDelta("The answer."),
      messageDelta({ output_tokens: 1 }),
      messageStop,
    ]);
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hard question" });
    const running = s.t.finishAllScheduledFunctions(() => {});
    await hold.reached;
    const id = (await s.assistant())._id;
    expect(await s.owner.query(api.chat.streamingThinking, { messageId: id })).toBe("Weighing the options.");
    hold.release();
    await running;

    const done = await s.lastReply();
    expect(done.text).toBe("The answer.");
    expect(done.thinking).toBe("Weighing the options.");
    expect((await s.assistant()).parts).toEqual([
      { type: "thinking", step: 1, thinking: "Weighing the options.", signature: "sig-1" },
      { type: "text", step: 1, text: "The answer." },
    ]);

    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Follow up" });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(s.replyRequests()[1].messages.map((m) => m.content)).toEqual(["Hard question", "The answer.", "Follow up"]);
  });

  test("a reply with no thinking has no thinking and no parts", async () => {
    const s = await setup([messageStart({ input_tokens: 1 }), textDelta("Plain."), messageDelta({ output_tokens: 1 }), messageStop]);
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q" });
    await s.t.finishAllScheduledFunctions(() => {});
    expect((await s.lastReply()).thinking).toBeUndefined();
    expect((await s.assistant()).parts).toBeUndefined();
  });
});
