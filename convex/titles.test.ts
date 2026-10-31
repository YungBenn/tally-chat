/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { model: string; max_tokens?: number; system?: string; messages: { content: string }[] };
// Replies answer "Answer"; title calls (max_tokens 30) answer the given title, with usage.
const anthropicResponder = (title: string | null) => ({
  respond: (init: RequestInit | undefined) => {
    const body = JSON.parse(String(init?.body)) as Body;
    if (body.max_tokens === 30 && title === null) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
    const text = body.max_tokens === 30 ? title! : "Answer";
    return new Response(sse(messageStart({ input_tokens: 50, output_tokens: 1 }), textDelta(text), messageDelta({ output_tokens: 8 }), messageStop));
  },
});

async function setup() {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const key = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted: key, detected: "", keyCheckedAt: 0 };
  const anthropicId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "Anthropic", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-opus-5-5", displayName: "Opus", hidden: false },
        { id: "claude-haiku-5-5", displayName: "Haiku", hidden: false },
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
      ],
    }),
  );
  const openaiId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "OpenAI", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-5", displayName: "GPT-5", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId: anthropicId, modelId: "claude-opus-5-5" });
  const chat = async (content: string) => {
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const title = async () => (await owner.query(api.chat.getThread, { threadId }))!.title;
  const titleCalls = () => fake!.requests.filter((r) => (r.body as Body).max_tokens === 30 || (r.body as { max_tokens?: number; max_completion_tokens?: number }).max_completion_tokens === 30);
  return { t, owner, threadId, anthropicId, openaiId, chat, title, titleCalls };
}

describe("side-job titles", () => {
  test("by default the cheapest priced model of the thread's provider titles it after the first reply", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: anthropicResponder('"Kyoto day trip plan."') });
    await s.chat("Plan a day in Kyoto for me please");
    expect(await s.title()).toBe("Kyoto day trip plan");
    const [call] = s.titleCalls();
    expect(call.body).toMatchObject({ model: "claude-haiku-5-5" }); // cheaper than Sonnet and Opus
    expect((call.body as Body).messages[0].content).toContain("Plan a day in Kyoto");
  });

  test("the owner's side-job model is used when set, even on another provider", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setSideJobModel, { sideJobModel: { providerId: s.openaiId, modelId: "gpt-5" } });
    fake = fakeFetch({
      [ANTHROPIC]: anthropicResponder("unused"),
      [OPENAI]: {
        body: oaiDelta("Packing for rain") + oaiFinish({ prompt_tokens: 40, completion_tokens: 4 }) + oaiDone,
        headers: { "content-type": "text/event-stream" },
      },
    });
    await s.chat("What should I pack?");
    expect(await s.title()).toBe("Packing for rain");
    expect(fake.requests.filter((r) => r.url.includes("openai")).map((r) => (r.body as Body).model)).toEqual(["gpt-5"]);
  });

  test("the title call is metered as a side job and lands in the rollups", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: anthropicResponder("A title") });
    await s.chat("Hello");
    const jobs = await s.t.run((ctx) => ctx.db.query("sideJobs").collect());
    expect(jobs).toEqual([
      expect.objectContaining({ kind: "title", model: "claude-haiku-5-5", usage: expect.objectContaining({ inputTokens: 50, outputTokens: 8 }) }),
    ]);
    expect(jobs[0].costMicroUsd).toBe(Math.round(50 * 0.1 + 8 * 0.5)); // Haiku 5.5: $0.10 / $0.50 per MTok
    const haiku = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(haiku.find((r) => r.dimension === "model" && r.key === "claude-haiku-5-5")).toMatchObject({ calls: 1, inputTokens: 50 });
  });

  test("runs once per thread, not on later turns", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: anthropicResponder("First title") });
    await s.chat("One");
    await s.chat("Two");
    expect(s.titleCalls()).toHaveLength(1);
    expect(await s.title()).toBe("First title");
  });

  test("a failed title call keeps the first-message title and leaves the chat alone", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: anthropicResponder(null) });
    await s.chat("Fallback title please");
    expect(await s.title()).toBe("Fallback title please");
    const reply = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    expect(reply).toMatchObject({ status: "done", text: "Answer" });
    expect(await s.t.run((ctx) => ctx.db.query("sideJobs").collect())).toEqual([]);
  });

  test("the side-job model must be a visible model of the owner's provider", async () => {
    const s = await setup();
    await expect(
      s.owner.mutation(api.settings.setSideJobModel, { sideJobModel: { providerId: s.openaiId, modelId: "nope" } }),
    ).rejects.toThrow("Model not available");
    await s.owner.mutation(api.settings.setSideJobModel, { sideJobModel: { providerId: s.openaiId, modelId: "gpt-5" } });
    await s.owner.mutation(api.settings.setSideJobModel, { sideJobModel: null });
    expect((await s.owner.query(api.settings.get, {})).sideJobModel).toBeNull();
  });
});
