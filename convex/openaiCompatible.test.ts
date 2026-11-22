/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch, type Recorded } from "../test/fakeFetch";
import { gate, gatedStream, oaiDelta, oaiDone, oaiFinish } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sseResponse = (body: string): Recorded => ({ body, headers: { "content-type": "text/event-stream" } });
const reply = (usage: object, ...texts: string[]) => sseResponse(texts.map(oaiDelta).join("") + oaiFinish(usage) + oaiDone);

async function setup(opts: { baseUrl: string; model: string; key?: string; free?: boolean; allow?: string }) {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  if (opts.allow) await owner.mutation(api.settings.addAllowedHost, { host: opts.allow });
  const apiKeyEncrypted = await t.run(() => encryptSecret(opts.key ?? "sk-test"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "P", apiStyle: "openai-compatible", baseUrl: opts.baseUrl, apiKeyEncrypted, detected: "", keyCheckedAt: 0,
      free: opts.free ?? false, models: [{ id: opts.model, displayName: opts.model, hidden: false }],
    }),
  );
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: opts.model });
  return { t, owner, providerId, threadId };
}

async function sendAndFinish(s: Awaited<ReturnType<typeof setup>>, content = "Hi") {
  await s.owner.mutation(api.chat.send, { threadId: s.threadId, content });
  await s.t.finishAllScheduledFunctions(() => {});
  return (await s.owner.query(api.chat.getThread, { threadId: s.threadId as Id<"threads"> }))!.messages.at(-1)!;
}

describe("OpenAI-compatible chat", () => {
  test("streams through the guard with a bearer key, the system prompt and usage requested", async () => {
    const s = await setup({ baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    fake = fakeFetch({ "POST https://api.openai.com/v1/chat/completions": reply({ prompt_tokens: 10, completion_tokens: 2 }, "Hel", "lo") });
    expect(await sendAndFinish(s)).toMatchObject({ status: "done", text: "Hello" });

    const [req] = fake.requests;
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.body).toMatchObject({
      model: "gpt-5",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system" }, { role: "user", content: "Hi" }],
    });
  });

  test("a provider error is reported on the reply", async () => {
    const s = await setup({ baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    fake = fakeFetch({ "POST https://api.openai.com/v1/chat/completions": { status: 401, body: { error: { message: "Incorrect API key" } } } });
    expect(await sendAndFinish(s)).toMatchObject({ status: "error", error: expect.stringContaining("Incorrect API key") });
  });

  test("stop aborts the request and keeps what streamed", async () => {
    // Past the 100 ms flush interval on every read: each chunk is flushed as the action reads it.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (now += 200));
    const s = await setup({ baseUrl: "https://api.openai.com/v1", model: "gpt-5" });
    const g = gate();
    let aborted = false;
    fake = fakeFetch({
      "POST https://api.openai.com/v1/chat/completions": {
        respond: (init) => {
          init?.signal?.addEventListener("abort", () => (aborted = true));
          return new Response(gatedStream([oaiDelta("Hello "), g, oaiDelta("world"), oaiDelta(" more")], init?.signal), {
            headers: { "content-type": "text/event-stream" },
          });
        },
      },
    });
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi" });
    await g.reached;
    const { _id } = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    // The stream is read ahead of the action: stop once the first chunk is really flushed.
    await vi.waitFor(async () => expect(await s.owner.query(api.chat.streamingText, { messageId: _id })).toBe("Hello "), { timeout: 30_000 });
    await s.owner.mutation(api.chat.stop, { messageId: _id });
    g.release();
    await s.t.finishInProgressScheduledFunctions();

    expect(aborted).toBe(true);
    const last = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    expect(last).toMatchObject({ status: "stopped", text: "Hello world" });
  });
});

describe("usage from OpenAI-compatible providers", () => {
  // Same traffic everywhere: 10,000 prompt tokens of which 8,000 were cached, 300 output.
  const shared = { inputTokens: 2000, cacheReadTokens: 8000, cacheWriteTokens1h: 0, outputTokens: 300 };
  test.each([
    {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5",
      usage: { prompt_tokens: 10000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 8000 }, completion_tokens_details: { reasoning_tokens: 120 } },
      expected: { ...shared, cacheWriteTokens5m: 0, reasoningTokens: 120 },
      cost: 2000 * 1.25 + 8000 * 0.125 + 300 * 10, // micro-USD: gpt-5 per MTok 1.25 / 0.125 / 10
    },
    {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      usage: { prompt_tokens: 10000, completion_tokens: 300, prompt_cache_hit_tokens: 8000, prompt_cache_miss_tokens: 2000 },
      expected: { ...shared, cacheWriteTokens5m: 0, reasoningTokens: 0 },
      cost: Math.round(2000 * 0.28 + 8000 * 0.028 + 300 * 0.42),
    },
    {
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-5-5",
      usage: { prompt_tokens: 10500, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 500 }, cost: 0.0123 },
      expected: { ...shared, cacheWriteTokens5m: 500, reasoningTokens: 0 },
      cost: 12300, // OpenRouter's own figure, as-is
    },
  ])("$name: uncached input, cache reads and writes, reasoning, cost", async ({ baseUrl, model, usage, expected, cost }) => {
    const s = await setup({ baseUrl, model });
    fake = fakeFetch({ [`POST ${baseUrl}/chat/completions`]: reply(usage, "Hi") });
    expect(await sendAndFinish(s)).toMatchObject({ usage: expected, costMicroUsd: cost });
    const provider = await s.t.run((ctx) => ctx.db.get("providers", s.providerId));
    expect(provider!.capabilities?.caching).toBe(true);
  });

  test("Ollama: a free provider reports no cache fields and costs $0", async () => {
    const s = await setup({ baseUrl: "http://192.168.1.20:11434/v1", model: "llama3", key: "", free: true, allow: "192.168.1.20:11434" });
    fake = fakeFetch({ "POST http://192.168.1.20:11434/v1/chat/completions": reply({ prompt_tokens: 10000, completion_tokens: 300 }, "Hi") });
    const last = await sendAndFinish(s);
    expect(last).toMatchObject({
      usage: { inputTokens: 10000, cacheReadTokens: 0, cacheWriteTokens5m: 0, cacheWriteTokens1h: 0, outputTokens: 300, reasoningTokens: 0 },
      costMicroUsd: 0,
    });
    expect(fake.requests[0].headers.authorization).toBeUndefined();
    const provider = await s.t.run((ctx) => ctx.db.get("providers", s.providerId));
    expect(provider!.capabilities).toEqual({ caching: false, reasoning: false });
  });
});

describe("adding an OpenAI-compatible provider", () => {
  test("lists models from /models, keeps /v1 in the base URL, and allows no key for a local server", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    await owner.mutation(api.settings.addAllowedHost, { host: "192.168.1.20:11434" });
    fake = fakeFetch({ "GET http://192.168.1.20:11434/v1/models": { body: { data: [{ id: "llama3" }, { id: "qwen3" }] } } });
    await owner.action(api.providerActions.add, {
      name: "Ollama", apiStyle: "openai-compatible", baseUrl: "http://192.168.1.20:11434/v1/", apiKey: "", free: true,
    });
    const [p] = await owner.query(api.providers.list, {});
    expect(p).toMatchObject({ baseUrl: "http://192.168.1.20:11434/v1", detected: "192.168.1.20:11434", free: true });
    expect(p.models.map((m) => m.id)).toEqual(["llama3", "qwen3"]);
  });

  test("an Anthropic provider still needs a key", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    fake = fakeFetch({});
    await expect(
      owner.action(api.providerActions.add, { name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: " " }),
    ).rejects.toThrow("API key is required");
  });
});
