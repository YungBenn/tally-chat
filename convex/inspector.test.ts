/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import {
  messageDelta,
  messageStart,
  messageStop,
  oaiDelta,
  oaiDone,
  oaiFinish,
  sse,
  textDelta,
} from "../test/sse";
import { api, internal } from "./_generated/api";
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

const SYSTEM = Math.ceil(SYSTEM_PROMPTS[1].length / 4);
// Sonnet 5.5: input $2, output $10, read $0.10, 5m write $2.50, 1h write $4 per MTok.

async function setup(replyUsages: object[], model = "claude-sonnet-5-5") {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base,
      name: "A",
      apiStyle: "anthropic",
      baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
        { id: "local-mystery", displayName: "Mystery", hidden: false },
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
  const threadId = await owner.mutation(api.chat.createThread, {
    providerId,
    modelId: model,
  });
  let reply = 0;
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const title =
          (JSON.parse(String(init?.body)) as { max_tokens: number })
            .max_tokens === 30;
        const usage = title
          ? { input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 3 }
          : replyUsages[reply++];
        return new Response(
          sse(
            messageStart(usage),
            textDelta("ok"),
            messageDelta({}),
            messageStop,
          ),
        );
      },
    },
    [OPENAI]: {
      body:
        oaiDelta("ok") +
        oaiFinish({
          prompt_tokens: 900,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 700 },
        }) +
        oaiDone,
    },
  });
  const send = async (content: string, thread: Id<"threads"> = threadId) => {
    await owner.mutation(api.chat.send, { threadId: thread, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const inspect = async (thread: Id<"threads"> = threadId) =>
    (await owner.query(api.inspector.get, { threadId: thread }))!;
  return { t, owner, ownerId, providerId, openaiId, threadId, send, inspect };
}

const usage = (o: Record<string, unknown>) => ({
  input_tokens: 10,
  cache_read_input_tokens: 0,
  output_tokens: 50,
  ...o,
});

describe("the inspector's context layers", () => {
  test("a fresh thread is only the system prompt, estimated", async () => {
    const s = await setup([]);
    expect((await s.inspect()).layers).toEqual([
      {
        kind: "system",
        label: "system prompt",
        tokens: SYSTEM,
        estimated: true,
      },
    ]);
  });

  test("turns are measured from the latest reply's usage: its request plus its visible output", async () => {
    const s = await setup([
      usage({ cache_creation_input_tokens: 2000 }),
      usage({
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 70,
        output_tokens: 80,
        output_tokens_details: { thinking_tokens: 30 },
      }),
    ]);
    await s.send("One");
    await s.send("Two");
    const { layers, next } = await s.inspect();
    // Second request: 10 uncached + 2000 read + 70 written; its reply adds 80 out minus 30 thinking.
    expect(layers[1]).toEqual({
      kind: "turns",
      label: "turns 1–2",
      tokens: 10 + 2000 + 70 + 50 - SYSTEM,
      estimated: false,
    });
    expect(next.prefixTokens).toBe(10 + 2000 + 70 + 50);
    expect(next.expectedOutputTokens).toBe(Math.round((50 + 80) / 2));
  });

  test("with a checkpoint, the layer is its stored size plus covered pins; turns start after it", async () => {
    const s = await setup([]);
    await s.t.run(async (ctx) => {
      const ids: Id<"messages">[] = [];
      const turns = [
        ["U1", "A1", true],
        ["U2", "A2", false],
        ["U3", "A3", false],
      ] as const;
      for (const [user, reply, pinned] of turns) {
        for (const [role, content] of [
          ["user", user],
          ["assistant", reply],
        ] as const) {
          ids.push(
            await ctx.db.insert("messages", {
              ownerId: s.ownerId,
              threadId: s.threadId,
              parentId: ids.at(-1),
              ancestorIds: [...ids],
              role,
              content,
              status: "done",
              pinned: role === "user" && pinned,
              ...(content === "A3"
                ? {
                    usage: {
                      inputTokens: 5,
                      cacheReadTokens: 900,
                      cacheWriteTokens5m: 100,
                      cacheWriteTokens1h: 0,
                      outputTokens: 40,
                      reasoningTokens: 0,
                    },
                  }
                : {}),
            }),
          );
        }
      }
      await ctx.db.insert("checkpoints", {
        ownerId: s.ownerId,
        threadId: s.threadId,
        coversUpToId: ids[3],
        summary: "S",
        tokens: 300,
      });
      await ctx.db.patch("threads", s.threadId, { activeLeafId: ids[5] });
    });
    const { layers } = await s.inspect();
    expect(layers[1]).toEqual({
      kind: "checkpoint",
      label: "summary + 1 pinned",
      tokens: 300 + 1,
      estimated: true,
    });
    expect(layers[2]).toEqual({
      kind: "turns",
      label: "turn 3",
      tokens: 5 + 900 + 100 + 40 - SYSTEM - 301,
      estimated: false,
    });
  });

  test("an unmeasured message after the latest reply is estimated into the turns", async () => {
    const s = await setup([usage({ cache_creation_input_tokens: 600 })]);
    await s.send("One");
    // A second turn whose reply errored before any usage: its question still goes out next time.
    await s.t.run(async (ctx) => {
      const thread = (await ctx.db.get("threads", s.threadId))!;
      const leaf = (await ctx.db.get("messages", thread.activeLeafId!))!;
      const id = await ctx.db.insert("messages", {
        ownerId: s.ownerId,
        threadId: s.threadId,
        parentId: leaf._id,
        ancestorIds: [...leaf.ancestorIds, leaf._id],
        role: "user",
        content: "x".repeat(400),
        status: "done",
        pinned: false,
      });
      await ctx.db.patch("threads", s.threadId, { activeLeafId: id });
    });
    const turns = (await s.inspect()).layers[1];
    expect(turns).toMatchObject({
      label: "turns 1–2",
      tokens: 10 + 600 + 50 - SYSTEM + 100,
      estimated: true,
    });
  });
});

describe("the next send's prices", () => {
  test("priced per token for the thread's model, with the cache write at the thread's lifetime", async () => {
    const s = await setup([]);
    expect((await s.inspect()).next.prices).toEqual({
      input: 2e-6,
      output: 1e-5,
      cacheRead: 1e-7,
      cacheWrite: 2.5e-6,
    });
    await s.t.run((ctx) =>
      ctx.db.patch("threads", s.threadId, { cacheTtl: "1h" }),
    );
    expect((await s.inspect()).next.prices?.cacheWrite).toBe(4e-6);
  });

  test("free providers price at 0; an unknown model has no price", async () => {
    const s = await setup([]);
    await s.t.run((ctx) =>
      ctx.db.patch("providers", s.providerId, { free: true }),
    );
    expect((await s.inspect()).next.prices).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const mystery = await setup([], "local-mystery");
    expect((await mystery.inspect()).next.prices).toBeNull();
  });

  test("a new thread prices the system prompt as fresh input, at the chosen model's prices", async () => {
    const s = await setup([]);
    expect(
      await s.owner.query(api.inspector.newThread, {
        providerId: s.providerId,
        modelId: "claude-sonnet-5-5",
      }),
    ).toEqual({
      systemTokens: SYSTEM,
      prices: {
        input: 2e-6,
        output: 1e-5,
        cacheRead: 1e-7,
        cacheWrite: 2.5e-6,
      },
    });
    expect(
      (
        await s.owner.query(api.inspector.newThread, {
          providerId: s.providerId,
          modelId: "local-mystery",
        })
      ).prices,
    ).toBeNull();
  });

  test("OpenAI-compatible threads are not managed and show the reported cache read", async () => {
    const s = await setup([]);
    const thread = await s.owner.mutation(api.chat.createThread, {
      providerId: s.openaiId,
      modelId: "gpt-5",
    });
    await s.send("Hi", thread);
    expect((await s.inspect(thread)).cache).toMatchObject({
      managed: false,
      lastReadTokens: 700,
    });
  });
});

describe("the thread's figures", () => {
  test("total, upkeep, hit rate over replies, savings net of upkeep, reasoning", async () => {
    const s = await setup([
      usage({
        input_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
        output_tokens: 5,
        output_tokens_details: { thinking_tokens: 4 },
      }),
    ]);
    await s.send("Hi");
    await s.t.mutation(internal.keepalive.record, {
      threadId: s.threadId,
      providerId: s.providerId,
      model: "claude-sonnet-5-5",
      startedAt: Date.now(),
      ttl: "5m",
      sent: true,
      usage: {
        inputTokens: 3,
        cacheReadTokens: 2000,
        cacheWriteTokens5m: 0,
        cacheWriteTokens1h: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
    });
    const reply = Math.round(100 * 2 + 1000 * 0.1 + 200 * 2.5 + 5 * 10);
    const title = Math.round(20 * 2 + 3 * 10);
    const keepalive = Math.round(3 * 2 + 2000 * 0.1);
    expect((await s.inspect()).thread).toEqual({
      costMicroUsd: reply + title + keepalive,
      unpricedCalls: 0,
      upkeepMicroUsd: keepalive,
      hitRate: 1000 / 1300, // the reply only: keepalive reads and the title are left out
      savedMicroUsd: 1000 * 1.9 - 200 * 0.5 - keepalive,
      reasoningTokens: 4,
    });
  });

  test("savings go negative when caching costs more than it saves", async () => {
    const s = await setup([usage({ cache_creation_input_tokens: 3000 })]);
    await s.send("Hi");
    expect((await s.inspect()).thread.savedMicroUsd).toBe(-3000 * 0.5);
  });

  test("owner only; a deleted thread is null", async () => {
    const s = await setup([]);
    await expect(
      s.t.query(api.inspector.get, { threadId: s.threadId }),
    ).rejects.toThrow("Not logged in");
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    expect(
      await s.owner.query(api.inspector.get, { threadId: s.threadId }),
    ).toBeNull();
  });
});

describe("one turn", () => {
  test("a reply's usage, cost and what caching saved on it", async () => {
    const s = await setup([
      usage({
        input_tokens: 40,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 100,
        output_tokens: 60,
      }),
    ]);
    await s.send("Hi");
    const reply = (await s.owner.query(api.chat.getThread, {
      threadId: s.threadId,
    }))!.messages.at(-1)!;
    expect(
      await s.owner.query(api.inspector.turn, { messageId: reply._id }),
    ).toEqual({
      model: "Sonnet",
      usage: {
        inputTokens: 40,
        cacheReadTokens: 3000,
        cacheWriteTokens5m: 100,
        cacheWriteTokens1h: 0,
        outputTokens: 60,
        reasoningTokens: 0,
      },
      costMicroUsd: Math.round(40 * 2 + 3000 * 0.1 + 100 * 2.5 + 60 * 10),
      savedMicroUsd: 3000 * 1.9 - 100 * 0.5,
    });
    const user = (await s.owner.query(api.chat.getThread, {
      threadId: s.threadId,
    }))!.messages[0];
    expect(
      await s.owner.query(api.inspector.turn, { messageId: user._id }),
    ).toBeNull(); // no usage
  });

  test("an unpriced model's turn has unknown cost and savings", async () => {
    const s = await setup(
      [usage({ cache_read_input_tokens: 500 })],
      "local-mystery",
    );
    await s.send("Hi");
    const reply = (await s.owner.query(api.chat.getThread, {
      threadId: s.threadId,
    }))!.messages.at(-1)!;
    expect(
      await s.owner.query(api.inspector.turn, { messageId: reply._id }),
    ).toMatchObject({
      model: "Mystery",
      costMicroUsd: null,
      savedMicroUsd: null,
    });
  });
});
