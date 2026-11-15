/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { model: string; max_tokens?: number; output_config?: { effort: string }; messages: { role: string; content: unknown }[] };
const CACHING = { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000, output_tokens: 1 };

async function setup() {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const anthropicId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-opus-5-5", displayName: "Opus", hidden: false },
        { id: "claude-haiku-5-5", displayName: "Haiku", hidden: false },
        { id: "claude-hidden", displayName: "Hidden", hidden: true },
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
  fake = fakeFetch({
    [ANTHROPIC]: { respond: () => new Response(sse(messageStart(CACHING), textDelta("ok"), messageDelta({ output_tokens: 1 }), messageStop)) },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 5, completion_tokens: 1 }) + oaiDone },
  });
  const threadId = await owner.mutation(api.chat.createThread, { providerId: anthropicId, modelId: "claude-opus-5-5", effort: "high" });
  await owner.mutation(api.chat.markActive, { threadId });
  const send = async (content: string, model?: { providerId: Id<"providers">; modelId: string }) => {
    await owner.mutation(api.chat.send, { threadId, content, model });
    await t.finishAllScheduledFunctions(() => {});
  };
  const replies = () => fake!.requests.filter((r) => (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  const thread = () => t.run((ctx) => ctx.db.get("threads", threadId));
  return { t, owner, ownerId, anthropicId, openaiId, threadId, send, replies, thread };
}

describe("reply with another model, once", () => {
  test("goes to that model with the thread's history, leaves the thread's model and cache alone", async () => {
    const s = await setup();
    await s.send("First");
    const before = (await s.thread())!;
    expect(before.cacheTouchedAt).toBeDefined();

    await s.send("Quick one", { providerId: s.openaiId, modelId: "gpt-5" });
    const oai = fake!.requests.find((r) => r.url === "https://api.openai.com/v1/chat/completions")!.body as Body;
    expect(oai.model).toBe("gpt-5");
    expect(oai.messages.map((m) => m.content)).toEqual(expect.arrayContaining(["First", "ok", "Quick one"]));
    expect(JSON.stringify(oai)).not.toContain("effort"); // no effort outside Anthropic style

    const after = (await s.thread())!;
    expect(after.modelId).toBe("claude-opus-5-5");
    expect(after.cacheTouchedAt).toBe(before.cacheTouchedAt);
    expect(after.keepaliveJobId).toBe(before.keepaliveJobId);

    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!;
    const reply = view.messages.at(-1)!;
    expect([reply.model, reply.modelName, reply.effort]).toEqual(["gpt-5", "GPT-5", undefined]);
    // Metered under the model that produced it.
    const byModel = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(byModel.filter((r) => r.dimension === "model").map((r) => r.key).sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "gpt-5"]); // Haiku: the title side job
    expect(byModel.find((r) => r.dimension === "provider" && r.key === s.openaiId)?.calls).toBe(1);
    // The inspector's cache read still comes from the thread's own model.
    expect((await s.owner.query(api.inspector.get, { threadId: s.threadId }))!.cache.lastReadTokens).toBe(0);

    await s.send("Back to normal");
    expect(s.replies().at(-1)!.model).toBe("claude-opus-5-5");
    expect((await s.thread())!.cacheTouchedAt).toBeGreaterThan(before.cacheTouchedAt!);
  });

  test("an Anthropic-style override gets the effort in force; per-message effort can't ride along", async () => {
    const s = await setup();
    await s.send("First", { providerId: s.anthropicId, modelId: "claude-haiku-5-5" });
    const body = s.replies().at(-1)!;
    expect([body.model, body.output_config]).toEqual(["claude-haiku-5-5", { effort: "high" }]);
    expect((await s.thread())!.cacheTouchedAt).toBeUndefined(); // the cache it wrote is Haiku's

    await expect(
      s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "x", effort: "low", model: { providerId: s.openaiId, modelId: "gpt-5" } }),
    ).rejects.toThrow("Change effort on a reply from the thread's own model");
    await expect(s.send("x", { providerId: s.anthropicId, modelId: "claude-hidden" })).rejects.toThrow("Model not available");
  });

  test("retry with another model becomes a new version of that reply", async () => {
    const s = await setup();
    await s.send("First");
    const first = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    await s.owner.mutation(api.chat.retry, { messageId: first._id, model: { providerId: s.openaiId, modelId: "gpt-5" } });
    await s.t.finishAllScheduledFunctions(() => {});
    const retried = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    expect(retried.model).toBe("gpt-5");
    expect(retried.siblingIds).toEqual([first._id, retried._id]);
    await s.owner.mutation(api.chat.switchBranch, { messageId: first._id });
    expect((await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!.model).toBe("claude-opus-5-5");
  });
});
