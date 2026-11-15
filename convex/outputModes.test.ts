/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
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
  persistentTextStreaming.register(t);
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
  // Reply requests only: title side jobs ask for 30 tokens.
  const replies = () =>
    fake!.requests
      .map((r) => r.body as Body)
      .filter(
        (b) =>
          b.max_tokens !== 30 &&
          (b as { max_completion_tokens?: number }).max_completion_tokens !==
            30,
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
    expect(s.replies().map((b) => b.max_tokens)).toEqual([2048, 8192, 32_000]);
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
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(2048);
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
