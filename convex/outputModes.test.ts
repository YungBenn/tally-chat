/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import {
  messageStart,
  messageStop,
  oaiDelta,
  oaiDone,
  sse,
  textDelta,
} from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "160.79.104.10", family: 4 }],
}));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { max_tokens?: number; system?: unknown; messages: unknown[] };
const anthropicStop = (reason: string) =>
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 9 } })}\n\n`;
const oaiFinish = (reason: string) =>
  `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n` +
  `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 5, completion_tokens: 9 } })}\n\n`;

async function setup(stopReason = "end_turn", finishReason = "stop") {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const anthropicId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base,
      name: "A",
      apiStyle: "anthropic",
      baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
      ],
    }),
  );
  const openaiId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base,
      name: "OpenAI",
      apiStyle: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-5", displayName: "GPT-5", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  fake = fakeFetch({
    [ANTHROPIC]: {
      body: sse(
        messageStart({
          input_tokens: 5,
          cache_read_input_tokens: 0,
          output_tokens: 1,
        }),
        textDelta("ok"),
        anthropicStop(stopReason),
        messageStop,
      ),
    },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish(finishReason) + oaiDone },
  });
  const thread = (providerId: Id<"providers">, modelId: string) =>
    owner.mutation(api.chat.createThread, { providerId, modelId });
  const anthropicThread = await thread(anthropicId, "claude-sonnet-5-5");
  const settle = () => t.finishAllScheduledFunctions(() => {});
  // Reply requests only: title side jobs ask for 512 tokens.
  const replies = () =>
    fake!.requests
      .map((r) => r.body as Body)
      .filter(
        (b) =>
          b.max_tokens !== 512 &&
          (b as { max_completion_tokens?: number }).max_completion_tokens !==
            512,
      );
  const last = async (threadId: Id<"threads">) =>
    (await owner.query(api.chat.getThread, { threadId }))!.messages.at(-1)!;
  return { t, owner, anthropicThread, openaiId, thread, settle, replies, last };
}

describe("output modes", () => {
  test("quick, normal (the default) and long set max_tokens; retries take a mode too", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "One",
      mode: "quick",
    });
    await s.settle();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Two",
    });
    await s.settle();
    const reply = await s.last(s.anthropicThread);
    await s.owner.mutation(api.chat.retry, {
      messageId: reply._id,
      mode: "long",
    });
    await s.settle();
    expect(s.replies().map((b) => b.max_tokens)).toEqual([8192, 8192, 32_000]);
  });

  test("OpenAI-compatible requests carry the mode's limit too", async () => {
    const s = await setup();
    const thread = await s.thread(s.openaiId, "gpt-5");
    await s.owner.mutation(api.chat.send, {
      threadId: thread,
      content: "Hi",
      mode: "quick",
    });
    await s.settle();
    const [body] = s.replies() as {
      max_tokens?: number;
      max_completion_tokens?: number;
    }[];
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(8192);
  });

  test("a reply that stops at its limit is marked truncated; one that finishes isn't", async () => {
    const cut = await setup("max_tokens");
    await cut.owner.mutation(api.chat.send, {
      threadId: cut.anthropicThread,
      content: "Write a lot",
    });
    await cut.settle();
    expect(await cut.last(cut.anthropicThread)).toMatchObject({
      status: "done",
      truncated: true,
    });

    const done = await setup();
    await done.owner.mutation(api.chat.send, {
      threadId: done.anthropicThread,
      content: "Hi",
    });
    await done.settle();
    expect((await done.last(done.anthropicThread)).truncated).toBeUndefined();

    const oai = await setup("end_turn", "length");
    const thread = await oai.thread(oai.openaiId, "gpt-5");
    await oai.owner.mutation(api.chat.send, {
      threadId: thread,
      content: "Write a lot",
    });
    await oai.settle();
    expect(await oai.last(thread)).toMatchObject({
      status: "done",
      truncated: true,
    });
  });

  test("Continue is an ordinary next turn after a cut-off reply", async () => {
    const s = await setup("max_tokens");
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Write a lot",
    });
    await s.settle();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Continue.",
    });
    await s.settle();
    const messages = (await s.owner.query(api.chat.getThread, {
      threadId: s.anthropicThread,
    }))!.messages;
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Write a lot"],
      ["assistant", "ok"],
      ["user", "Continue."],
      ["assistant", "ok"],
    ]);
  });
});

describe("output ceilings by effort", () => {
  test.each([
    ["quick", "low", 8192],
    ["quick", "high", 8192],
    ["quick", "max", 16_384],
    ["normal", "low", 8192],
    ["normal", "medium", 32_000],
    ["normal", "high", 32_000],
    ["normal", "xhigh", 64_000],
    ["long", "low", 32_000],
    ["long", "medium", 64_000],
    ["long", "max", 64_000],
  ] as const)("%s at %s asks for %i", async (mode, effort, ceiling) => {
    const s = await setup();
    const thread = await s.owner.mutation(api.chat.createThread, {
      providerId: (await s.t.run((ctx) => ctx.db.query("providers").first()))!
        ._id,
      modelId: "claude-sonnet-5-5",
      effort,
    });
    await s.owner.mutation(api.chat.send, {
      threadId: thread,
      content: "Hi",
      mode,
    });
    await s.settle();
    expect(s.replies().map((b) => b.max_tokens)).toEqual([ceiling]);
  });

  test("the ceiling is clamped to the model's known output limit", async () => {
    const { outputCeiling } = await import("./lib/outputModes");
    expect(outputCeiling("long", "max", 4096)).toBe(4096);
    expect(outputCeiling("long", "max", 128_000)).toBe(64_000);
  });

  test("quick mode stores the brevity line after the text and sends it; other modes don't", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Why is the sky blue?",
      mode: "quick",
    });
    await s.settle();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "And grass?",
    });
    await s.settle();
    const messages = await s.t.run((ctx) =>
      ctx.db
        .query("messages")
        .collect()
        .then((all) => all.filter((m) => m.role === "user")),
    );
    expect(messages[0].brevity).toBe(
      "Answer briefly: a few sentences at most, unless that would leave the answer wrong.",
    );
    expect(messages[1].brevity).toBeUndefined();
    const [first, second] = s.replies();
    const text = (m: unknown) => JSON.stringify(m);
    expect(text(first.messages.at(-1))).toContain(
      "Why is the sky blue?\\n\\nAnswer briefly: a few sentences at most, unless that would leave the answer wrong.",
    );
    // frozen: still there, same bytes, in later requests
    expect(text(second.messages[0])).toContain("Answer briefly: a few");
    expect(text(second.messages.at(-1))).not.toContain("Answer briefly");
  });

  test("messages sent before the brevity line render byte for byte as before", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Hi",
    });
    await s.settle();
    expect(JSON.stringify(s.replies()[0].messages.at(-1))).not.toContain(
      "Answer briefly",
    );
    expect(JSON.stringify(s.replies()[0].messages.at(-1))).toContain("\\n\\nHi");
  });

  test("the title request asks for 512 tokens, in both API styles", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Hi",
    });
    await s.settle();
    const thread = await s.thread(s.openaiId, "gpt-5");
    await s.owner.mutation(api.chat.send, { threadId: thread, content: "Hi" });
    await s.settle();
    const titles = fake!.requests
      .map((r) => r.body as { max_tokens?: number; max_completion_tokens?: number })
      .filter((b) => (b.max_tokens ?? b.max_completion_tokens) === 512);
    expect(titles).toHaveLength(2);
  });
});

describe("the concise system prompt", () => {
  test("new threads use version 2; a thread started on version 1 keeps it", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, {
      threadId: s.anthropicThread,
      content: "Hi",
    });
    await s.settle();
    const older = await s.thread(
      (await s.t.run((ctx) => ctx.db.query("providers").first()))!._id,
      "claude-sonnet-5-5",
    );
    await s.t.run((ctx) =>
      ctx.db.patch("threads", older, { systemPromptVersion: 1 }),
    );
    await s.owner.mutation(api.chat.send, { threadId: older, content: "Hi" });
    await s.settle();
    const [newer, old] = s
      .replies()
      .map((b) => (b.system as { text: string }[])[0].text);
    expect(newer).toBe(SYSTEM_PROMPTS[2]);
    expect(old).toBe(SYSTEM_PROMPTS[1]);
  });
});
