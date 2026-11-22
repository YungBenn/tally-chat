/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { gate, gatedStream, messageDelta, messageStart, messageStop, sse, streamError, textDelta } from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CURRENT_SYSTEM_PROMPT_VERSION, SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import { ancestorIds } from "./lib/ancestors";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
// A flush runs as the action's own mutation: a deadline only a broken test reaches.
const FLUSHED = { timeout: 30_000 };
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
const KEY = "sk-ant-chat-test";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A clock that moves past the 100 ms flush interval on every read, so each streamed chunk is
// flushed as the action reads it, however fast or slow the machine is.
const flushEveryChunk = () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (now += 200));
};

async function setup(baseUrl = "https://api.anthropic.com") {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret(KEY));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "Anthropic", apiStyle: "anthropic", baseUrl, apiKeyEncrypted, detected: "Anthropic", keyCheckedAt: 0,
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }, { id: "claude-old", displayName: "Old", hidden: true }, { id: "local-mystery", displayName: "Mystery", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  return { t, owner, providerId, threadId };
}

const reply = (...texts: string[]) => ({ body: sse(...texts.map(textDelta), messageStop), headers: { "content-type": "text/event-stream" } });
const lastAssistant = async (owner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, threadId: Id<"threads">) =>
  (await owner.query(api.chat.getThread, { threadId }))!.messages.at(-1)!;

describe("threads", () => {
  test("a thread needs a visible model of the owner's provider", async () => {
    const { owner, providerId } = await setup();
    await expect(owner.mutation(api.chat.createThread, { providerId, modelId: "claude-old" })).rejects.toThrow("Model not available");
    await expect(owner.mutation(api.chat.createThread, { providerId, modelId: "nope" })).rejects.toThrow("Model not available");
  });

  test("requires the owner", async () => {
    const { t, threadId } = await setup();
    await expect(t.query(api.chat.getThread, { threadId })).rejects.toThrow("Not logged in");
    await expect(t.mutation(api.chat.send, { threadId, content: "hi" })).rejects.toThrow("Not logged in");
  });
});

describe("sending a message", () => {
  test("returns immediately with the user message and a streaming reply", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "  Hello there  " });
    const thread = (await owner.query(api.chat.getThread, { threadId }))!;
    expect(thread.title).toBe("Hello there");
    expect(thread.messages.map((m) => [m.role, m.status, m.text])).toEqual([
      ["user", "done", "Hello there"],
      ["assistant", "streaming", ""],
    ]);
    await t.finishAllScheduledFunctions(() => {});
  });

  test("streams the reply through the guard with the system prompt at the thread's version", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Hello", ", ", "world") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});

    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "done", text: "Hello, world" });
    const [request] = fake.requests;
    expect(request.headers["x-api-key"]).toBe(KEY);
    expect(request.body).toMatchObject({
      model: "claude-sonnet-5-5",
      stream: true,
      system: [{ type: "text", text: SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION] }],
      messages: [{ role: "user", content: "Hi" }],
    });
  });

  test("later turns send the whole branch and store each message's ancestors", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("One") });
    await owner.mutation(api.chat.send, { threadId, content: "First" });
    await t.finishAllScheduledFunctions(() => {});
    await owner.mutation(api.chat.send, { threadId, content: "Second" });
    await t.finishAllScheduledFunctions(() => {});

    expect(fake.requests[1].body).toMatchObject({
      messages: [
        { role: "user", content: "First" },
        { role: "assistant", content: "One" },
        { role: "user", content: "Second" },
      ],
    });
    const ids = (await owner.query(api.chat.getThread, { threadId }))!.messages.map((m) => m._id);
    const ancestors = await t.run(async (ctx) => ancestorIds(ctx, (await ctx.db.get("messages", ids[3]))!));
    expect(ancestors).toEqual(ids.slice(0, 3));
  });

  test("a trailing OpenAI-style [DONE] line (some proxies add one) still finishes the reply", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("Hi"), messageStop) + "data: [DONE]\n\n" } });
    await owner.mutation(api.chat.send, { threadId, content: "Hello" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "done", text: "Hi" });
  });

  test("cannot send while a reply is streaming", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("One") });
    await owner.mutation(api.chat.send, { threadId, content: "First" });
    await expect(owner.mutation(api.chat.send, { threadId, content: "Again" })).rejects.toThrow("Wait for the reply");
    await t.finishAllScheduledFunctions(() => {});
  });

  test("a private provider address is refused by the guard and the reply errors", async () => {
    const { t, owner, threadId } = await setup("https://10.0.0.5");
    fake = fakeFetch({});
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "error", error: expect.stringContaining("private address") });
    expect(fake.requests).toEqual([]);
  });
});

describe("starting a thread in one step", () => {
  const threadCount = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.query("threads").collect()).length);

  test("creates the thread, the user message and the streaming reply together, with the choices made before sending", async () => {
    const { t, owner, providerId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Hi") });
    const threadId = await owner.mutation(api.chat.startThread, {
      providerId, modelId: "claude-sonnet-5-5", effort: "low", content: "  Hello there  ", mode: "quick",
    });
    const thread = (await owner.query(api.chat.getThread, { threadId }))!;
    expect(thread.title).toBe("Hello there");
    expect(thread.messages.map((m) => [m.role, m.status, m.text])).toEqual([
      ["user", "done", "Hello there"],
      ["assistant", "streaming", ""],
    ]);
    expect(thread.messages[1].effort).toBe("low");
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "done", text: "Hi" });
    expect((fake.requests[0].body as { max_tokens: number }).max_tokens).toBe(2048);
  });

  test("validates like creating and sending; a refused start leaves no thread", async () => {
    const { t, owner, providerId } = await setup();
    const start = (args: { modelId: string; content: string }) => owner.mutation(api.chat.startThread, { providerId, ...args });
    await expect(start({ modelId: "claude-old", content: "Hi" })).rejects.toThrow("Model not available");
    await expect(start({ modelId: "claude-sonnet-5-5", content: "   " })).rejects.toThrow("Message is empty");
    await expect(t.mutation(api.chat.startThread, { providerId, modelId: "claude-sonnet-5-5", content: "Hi" })).rejects.toThrow("Not logged in");
    expect(await threadCount(t)).toBe(1); // only setup's
  });
});

describe("streaming, reload and stop", () => {
  test("mid-stream reads show the text so far; stop aborts the request and keeps what streamed", async () => {
    flushEveryChunk();
    const { t, owner, threadId } = await setup();
    const [g1, g2] = [gate(), gate()];
    let aborted = false;
    fake = fakeFetch({
      [MESSAGES_URL]: {
        respond: (init) => {
          init?.signal?.addEventListener("abort", () => (aborted = true));
          return new Response(gatedStream([textDelta("Hello "), g1, textDelta("world"), g2, textDelta("!"), textDelta(" more")], init?.signal));
        },
      },
    });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });

    await g1.reached;
    g1.release();
    await g2.reached;
    const { _id } = await lastAssistant(owner, threadId);
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "streaming", text: "" });
    // The provider stream is read ahead of the action, so the flush can land just after the gate.
    await vi.waitFor(async () => expect(await owner.query(api.chat.streamingText, { messageId: _id })).toBe("Hello world"), FLUSHED);

    await owner.mutation(api.chat.stop, { messageId: _id });
    g2.release();
    await t.finishInProgressScheduledFunctions();

    expect(aborted).toBe(true);
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "stopped", text: "Hello world!" });
  });

  test("a flush leaves the thread query's result unchanged; the streaming text is null once the step ends", async () => {
    flushEveryChunk();
    const { t, owner, threadId } = await setup();
    const [g1, g2] = [gate(), gate()];
    fake = fakeFetch({ [MESSAGES_URL]: { respond: (init) => new Response(gatedStream([textDelta("One "), g1, textDelta("two "), g2, textDelta("three")], init?.signal)) } });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await g1.reached;
    const before = await owner.query(api.chat.getThread, { threadId });
    const { _id } = before!.messages.at(-1)!;
    await vi.waitFor(async () => expect(await owner.query(api.chat.streamingText, { messageId: _id })).toBe("One "), FLUSHED);
    expect(await owner.query(api.chat.getThread, { threadId })).toEqual(before);

    g1.release();
    await g2.reached;
    await vi.waitFor(async () => expect(await owner.query(api.chat.streamingText, { messageId: _id })).toBe("One two "), FLUSHED);
    expect(await owner.query(api.chat.getThread, { threadId })).toEqual(before);

    g2.release();
    await t.finishInProgressScheduledFunctions();
    expect(await owner.query(api.chat.streamingText, { messageId: _id })).toBeNull();
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "done", text: "One two three" });
    expect(await t.run((ctx) => ctx.db.query("streams").collect())).toEqual([]);
  });

  test("the streaming text is the owner's only", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "Hello" });
    const { _id } = await lastAssistant(owner, threadId);
    const stranger = t.withIdentity({ subject: `${await t.run((ctx) => ctx.db.insert("users", { email: "x" }))}|s` });
    await expect(stranger.query(api.chat.streamingText, { messageId: _id })).rejects.toThrow();
    await expect(t.query(api.chat.streamingText, { messageId: _id })).rejects.toThrow("Not logged in");
    await t.finishAllScheduledFunctions(() => {});
  });

  test("a provider error marks the reply error and keeps what streamed", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("Partial"), streamError("Overloaded")) } });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "error", text: "Partial", error: "Provider error: Overloaded" });
  });

  test("an HTTP error from the provider is reported", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { status: 529, body: { error: { message: "Overloaded" } } } });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "error", error: "Provider error 529: Overloaded" });
  });

  test("content never changes after the final status is written", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Final") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    const { _id } = await lastAssistant(owner, threadId);

    await t.mutation(internal.chat.finalize, { messageId: _id, status: "error", content: "Rewritten" });
    await owner.mutation(api.chat.stop, { messageId: _id });
    const row = await t.run((ctx) => ctx.db.get("messages", _id));
    expect(row).toMatchObject({ status: "done", content: "Final" });
    expect(row!.stopRequested).toBeUndefined();
  });
});

describe("metering", () => {
  // claude-sonnet-5-5 per token: input 2e-6, output 1e-5, cache read 1e-7, write 5m 2.5e-6, write 1h 4e-6
  const startUsage = {
    input_tokens: 1000,
    cache_read_input_tokens: 8000,
    cache_creation_input_tokens: 2000,
    cache_creation: { ephemeral_5m_input_tokens: 1500, ephemeral_1h_input_tokens: 500 },
    output_tokens: 1,
  };
  const metered = (...texts: string[]) => ({
    body: sse(messageStart(startUsage), ...texts.map(textDelta), messageDelta({ output_tokens: 340 }), messageStop),
  });
  const rollups = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("dailyUsage").collect());

  test("records normalized usage and exact cost on the reply, and rolls it up by model, provider and thread", async () => {
    const { t, owner, threadId, providerId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: metered("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});

    const reply = await lastAssistant(owner, threadId);
    const usage = { inputTokens: 1000, cacheReadTokens: 8000, cacheWriteTokens5m: 1500, cacheWriteTokens1h: 500, outputTokens: 340, reasoningTokens: 0 };
    // 1000*2e-6 + 8000*1e-7 + 1500*2.5e-6 + 500*4e-6 + 340*1e-5 = $0.01195
    expect(reply).toMatchObject({ model: "claude-sonnet-5-5", usage, costMicroUsd: 11950 });

    const rows = await rollups(t);
    expect(rows.map((r) => [r.dimension, r.key]).sort()).toEqual(
      [["model", "claude-sonnet-5-5"], ["provider", providerId], ["thread", threadId]].sort(),
    );
    // The first reply also triggers a side-job title on the same (cheapest) model; the fake
    // provider bills it identically, so every rollup holds the reply plus the title.
    const doubled = Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, v * 2]));
    for (const row of rows) expect(row).toMatchObject({ ...doubled, calls: 2, unpricedCalls: 0, costMicroUsd: 23900 });
  });

  test("rollup totals equal the sum of their messages across threads and models", async () => {
    const { t, owner, threadId, providerId } = await setup();
    const other = await owner.mutation(api.chat.createThread, { providerId, modelId: "local-mystery" });
    fake = fakeFetch({ [MESSAGES_URL]: metered("Hi") });
    for (const [thread, text] of [[threadId, "one"], [threadId, "two"], [other, "three"]] as const) {
      await owner.mutation(api.chat.send, { threadId: thread, content: text });
      await t.finishAllScheduledFunctions(() => {});
    }

    const messages = await t.run((ctx) => ctx.db.query("messages").collect());
    const sideJobs = await t.run((ctx) => ctx.db.query("sideJobs").collect());
    const replies = [...messages.filter((m) => m.usage), ...sideJobs];
    for (const row of await rollups(t)) {
      const mine = replies.filter((m) => (row.dimension === "model" ? m.model : row.dimension === "provider" ? m.providerId : m.threadId) === row.key);
      expect(row.calls).toBe(mine.length);
      expect(row.costMicroUsd).toBe(mine.reduce((s, m) => s + (m.costMicroUsd ?? 0), 0));
      expect(row.cacheReadTokens).toBe(mine.reduce((s, m) => s + m.usage!.cacheReadTokens, 0));
      expect(row.unpricedCalls).toBe(mine.filter((m) => m.costMicroUsd === undefined).length);
    }
    const byModel = Object.fromEntries((await rollups(t)).filter((r) => r.dimension === "model").map((r) => [r.key, r]));
    // 2 replies plus 2 titles (both threads' side jobs default to the cheapest priced model).
    expect(byModel["claude-sonnet-5-5"]).toMatchObject({ calls: 4, costMicroUsd: 47800 });
    expect(byModel["local-mystery"]).toMatchObject({ calls: 1, unpricedCalls: 1, costMicroUsd: 0 });
  });

  test("a model with no price records usage but cost stays unknown, never guessed", async () => {
    const { t, owner, providerId } = await setup();
    const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "local-mystery" });
    fake = fakeFetch({ [MESSAGES_URL]: metered("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    const reply = await lastAssistant(owner, threadId);
    expect(reply.usage?.outputTokens).toBe(340);
    expect(reply.costMicroUsd).toBeUndefined();
  });

  test("a stopped reply records the usage reported before the stop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, owner, threadId } = await setup();
    const g = gate();
    fake = fakeFetch({
      [MESSAGES_URL]: { respond: (init) => new Response(gatedStream([messageStart(startUsage), textDelta("Hel"), g, textDelta("lo")], init?.signal)) },
    });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await g.reached;
    await owner.mutation(api.chat.stop, { messageId: (await lastAssistant(owner, threadId))._id });
    vi.setSystemTime(Date.now() + 200);
    g.release();
    await t.finishInProgressScheduledFunctions();

    const reply = await lastAssistant(owner, threadId);
    expect(reply).toMatchObject({ status: "stopped", usage: { inputTokens: 1000, cacheReadTokens: 8000, outputTokens: 1 } });
    expect(await rollups(t)).toHaveLength(3);
  });

  test("an error before any usage records nothing", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { status: 529, body: { error: { message: "Overloaded" } } } });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect((await lastAssistant(owner, threadId)).usage).toBeUndefined();
    expect(await rollups(t)).toEqual([]);
  });

  test("rollup days follow the owner's time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T20:00:00Z")); // already Nov 2 in Auckland (UTC+13)
    const { t, owner, threadId } = await setup();
    await owner.mutation(api.settings.setTimeZone, { timeZone: "Pacific/Auckland" });
    fake = fakeFetch({ [MESSAGES_URL]: metered("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(new Set((await rollups(t)).map((r) => r.day))).toEqual(new Set(["2026-11-02"]));
    await expect(owner.mutation(api.settings.setTimeZone, { timeZone: "Mars/Olympus" })).rejects.toThrow("Unknown time zone");
  });

  test("provider capabilities come from the usage fields it reports", async () => {
    const { t, owner, threadId, providerId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: metered("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    const provider = await t.run((ctx) => ctx.db.get("providers", providerId));
    expect(provider!.capabilities).toEqual({ caching: true, reasoning: false });
  });
});
